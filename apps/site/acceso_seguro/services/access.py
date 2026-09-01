from __future__ import annotations
import datetime as dt
import logging
import threading
import time
from typing import Any

from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal
from ..models import Vehiculo, Persona, PersonaVehiculo, Acceso, Estadia, Deteccion
from .relay import relay
from .qr import DNIData
from .events import dispatcher

logger = logging.getLogger("access_control")


class AccessController:
    """
    Orquesta la validacion de acceso vehicular.
    Soporta flujos de INGRESO y SALIDA.
    Integra estado de sensores y eventos WebSocket.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending_plate: dict[str, dict[str, Any] | None] = {"in": None, "out": None}
        self._pending_dni: DNIData | None = None
        self._plate_ts: dict[str, float] = {"in": 0.0, "out": 0.0}
        self._dni_ts: float = 0.0
        self._match_window_sec: float = max(1.0, float(settings.match_window_sec))
        
        self._last_open_plate: dict[str, str] = {"in": "", "out": ""}
        self._last_open_ts: dict[str, float] = {"in": 0.0, "out": 0.0}
        
        self.recent_events: list[dict[str, Any]] = []
        self._max_recent: int = 50

        # Conectar callback del relay
        relay.on_sensor_pulse = self.sensor_close
        relay.on_watchdog_close = self.watchdog_close

    @staticmethod
    def _auth_mode() -> str:
        mode = str(getattr(settings, "auth_mode", "ambos") or "ambos").strip().lower()
        if mode not in {"patente", "dni", "ambos", "combinado"}:
            return "ambos" if settings.require_dni_qr else "patente"
        return mode

    # ── Callbacks ──────────────────────────────────────────────────────────
    def on_plate_detected(self, det: dict[str, Any]) -> None:
        plate = str(det.get("patente") or "").strip().upper()
        sentido = det.get("sentido", "in")
        if not plate:
            return

        now = time.time()
        with self._lock:
            # Anti-tailgating por sentido
            if (plate == self._last_open_plate[sentido]
                    and (now - self._last_open_ts[sentido]) < settings.dedup_window_sec):
                logger.debug(f"[ACCESS] {plate} ignorado (dedup) en {sentido}")
                return
            self._pending_plate[sentido] = det
            self._plate_ts[sentido] = now
            logger.info(f"[ACCESS] Patente candidata ({sentido}): {plate}")

        # Notificar a frontend via WebSocket que detectamos patente
        dispatcher.dispatch("PLATE_READ", {
            "sentido": sentido,
            "patente": plate,
            "status": "waiting_auth",
            "message": "Evaluando acceso..."
        })

        self._try_grant(sentido)

    def on_dni_scanned(self, dni_data: DNIData, sentido: str | None = None) -> None:
        now = time.time()
        sentido_inferido = sentido
        
        with self._lock:
            self._pending_dni = dni_data
            self._dni_ts = now
            logger.info(f"[ACCESS] DNI candidato: {dni_data.dni} (sentido={sentido})")
            
            if not sentido_inferido:
                sentido_inferido = "in"
                # Inferir sentido basado en que barrera tiene una patente esperando
                if self._pending_plate["out"] and (now - self._plate_ts["out"]) < self._match_window_sec:
                    sentido_inferido = "out"
                elif self._pending_plate["in"] and (now - self._plate_ts["in"]) < self._match_window_sec:
                    sentido_inferido = "in"

        dispatcher.dispatch("DNI_READ", {
            "dni": dni_data.dni,
            "nombre": dni_data.nombre,
            "apellido": dni_data.apellido,
            "sexo": dni_data.sexo,
            "nacimiento": dni_data.nacimiento,
            "tramite": dni_data.tramite,
            "nombre_completo": dni_data.nombre_completo(),
            "sentido": sentido_inferido
        })

        self._try_grant(sentido_inferido)
        # Intentar tambien en el otro sentido por las dudas
        otro_sentido = "out" if sentido_inferido == "in" else "in"
        self._try_grant(otro_sentido)

    # ── Lógica de decisión ──────────────────────────────────────────────────
    def _try_grant(self, sentido: str) -> None:
        with self._lock:
            now = time.time()
            mode = self._auth_mode()
            
            plate_det = self._pending_plate[sentido]
            plate_present = (
                plate_det is not None
                and (now - self._plate_ts[sentido]) < self._match_window_sec
            )
            dni_present = (
                self._pending_dni is not None
                and (now - self._dni_ts) < self._match_window_sec
            )

            plate_data = plate_det if plate_present else None
            dni_data = self._pending_dni if dni_present else None

            if mode == "ambos":
                if not (plate_present and dni_present):
                    if plate_present:
                        dispatcher.dispatch("PLATE_READ", {
                            "sentido": sentido,
                            "patente": plate_data.get("patente"),
                            "status": "waiting_dni",
                            "message": "Esperando DNI..."
                        })
                    return
            elif mode == "patente":
                if not plate_present: return
                dni_data = None
            elif mode == "dni":
                if not dni_present: return
                plate_data = None
            else:  # combinado
                if not (plate_present or dni_present): return

        # Evaluar fuera del lock
        self._evaluate(plate_data, dni_data, sentido)

    def _evaluate(self, plate_data: dict[str, Any] | None, dni_data: DNIData | None, sentido: str) -> None:
        """Evaluación asíncrona de acceso en dos fases independientes para latencia cero."""
        # Lanzar la evaluación completa en un flujo no bloqueante para garantizar respuesta ultra rápida
        def _async_evaluate_pipeline():
            db: Session = SessionLocal()
            try:
                mode = self._auth_mode()
                plate = str((plate_data or {}).get("patente") or "").upper() or None
                now = dt.datetime.now()
                auto_reg = getattr(settings, "auto_register", True)
                temp_id = -int(time.time() * 1000)

                # =========================================================================
                # FASE 1: DECISIÓN RÁPIDA (FAST PATH)
                # =========================================================================
                
                # 1. Obtener objetos básicos de la BD (solo lectura)
                vehiculo = None
                if plate:
                    vehiculo = db.query(Vehiculo).filter(Vehiculo.patente == plate).first()
                
                persona = None
                if dni_data:
                    persona = db.query(Persona).filter(Persona.dni == dni_data.dni).first()

                # Decidir de forma preliminar y rápida (sin transacciones pesadas ni escrituras)
                # Si auto_register está activo, aun si no existen, la decisión es autorizada.
                # Para evitar duplicar la lógica, usamos un mock temporal para la evaluación rápida si no existen
                mock_vehiculo = vehiculo
                if not vehiculo and plate and auto_reg:
                    mock_vehiculo = Vehiculo(patente=plate, activo=True, descripcion="Auto-registrado")
                
                mock_persona = persona
                if not persona and dni_data and auto_reg:
                    mock_persona = Persona(dni=dni_data.dni, nombre=dni_data.nombre, apellido=dni_data.apellido, activo=True)

                resultado, motivo, lote = self._decide(db, mock_vehiculo, mock_persona, plate, dni_data, sentido, now)

                # Si es autorizado o manual, activar acción física de inmediato
                if resultado in {"autorizado", "manual"}:
                    if plate:
                        with self._lock:
                            self._last_open_plate[sentido] = plate
                            self._last_open_ts[sentido] = time.time()
                    
                    # Disparar la barrera física al milisegundo de forma independiente
                    auto_open = settings.barrier_auto_open_in if sentido == "in" else settings.barrier_auto_open_out
                    if auto_open:
                        try:
                            # Lanzar la apertura en un hilo daemon secundario para que el relay no demore al pipeline
                            threading.Thread(target=relay.open, args=(sentido,), daemon=True).start()
                        except Exception as exc:
                            logger.error(f"[ACCESS] Fallo al iniciar apertura física: {exc}")

                # Emitir de forma preliminar e inmediata el evento al dashboard/Websockets
                event = {
                    "id": temp_id,
                    "fecha": now.isoformat(timespec="seconds"),
                    "sentido": sentido,
                    "patente": plate,
                    "dni": dni_data.dni if dni_data else None,
                    "resultado": resultado,
                    "motivo": motivo,
                    "modo": mode,
                    "vehiculo": mock_vehiculo.descripcion if mock_vehiculo else None,
                    "persona": f"{mock_persona.nombre} {mock_persona.apellido}" if mock_persona else None,
                    "lote": lote,
                }
                with self._lock:
                    self.recent_events.insert(0, event)
                    if len(self.recent_events) > self._max_recent:
                        self.recent_events.pop()
                    self._pending_plate[sentido] = None
                    self._pending_dni = None

                logger.info(f"[ACCESS-FAST] {sentido.upper()} | {plate or '-'} → {resultado}: {motivo}")

                # Despachar el resultado visual al instante
                dispatcher.dispatch("ACCESS_RESULT", {
                    "sentido": sentido,
                    "patente": plate,
                    "resultado": resultado,
                    "motivo": motivo,
                    "id": temp_id
                })

                # =========================================================================
                # FASE 2: PROCESAMIENTO E IO PESADO EN SEGUNDO PLANO
                # =========================================================================

                def _bg_heavy_processing():
                    db_heavy = SessionLocal()
                    try:
                        # 1. Ejecutar auto-registros reales y persistentes en BD si corresponde
                        heavy_vehiculo = None
                        if plate:
                            heavy_vehiculo = db_heavy.query(Vehiculo).filter(Vehiculo.patente == plate).first()
                            if not heavy_vehiculo and auto_reg:
                                heavy_vehiculo = Vehiculo(patente=plate, activo=True, descripcion="Auto-registrado")
                                db_heavy.add(heavy_vehiculo)
                                db_heavy.commit()
                                db_heavy.refresh(heavy_vehiculo)
                                logger.info(f"[ACCESS-BG] Auto-registro de vehículo en BD: {plate}")
                            elif heavy_vehiculo and not heavy_vehiculo.activo and auto_reg:
                                if heavy_vehiculo.estado != "bloqueado":
                                    heavy_vehiculo.activo = True
                                    db_heavy.commit()
                                    logger.info(f"[ACCESS-BG] Reactivación de vehículo en BD: {plate}")
                            
                            if heavy_vehiculo and not heavy_vehiculo.activo:
                                heavy_vehiculo = None

                        heavy_persona = None
                        if dni_data:
                            heavy_persona = db_heavy.query(Persona).filter(Persona.dni == dni_data.dni).first()
                            if not heavy_persona and auto_reg:
                                heavy_persona = Persona(
                                    dni=dni_data.dni,
                                    nombre=dni_data.nombre,
                                    apellido=dni_data.apellido,
                                    sexo=dni_data.sexo,
                                    tramite=dni_data.tramite,
                                    activo=True
                                )
                                if dni_data.nacimiento:
                                    try:
                                        d, m, y = dni_data.nacimiento.split("/")
                                        heavy_persona.fecha_nacimiento = dt.date(int(y), int(m), int(d))
                                    except Exception:
                                        pass
                                db_heavy.add(heavy_persona)
                                db_heavy.commit()
                                db_heavy.refresh(heavy_persona)
                                logger.info(f"[ACCESS-BG] Auto-registro de persona en BD: {dni_data.dni}")
                            
                            elif heavy_persona:
                                heavy_persona.nombre = dni_data.nombre
                                heavy_persona.apellido = dni_data.apellido
                                heavy_persona.sexo = dni_data.sexo
                                heavy_persona.tramite = dni_data.tramite
                                if dni_data.nacimiento:
                                    try:
                                        d, m, y = dni_data.nacimiento.split("/")
                                        heavy_persona.fecha_nacimiento = dt.date(int(y), int(m), int(d))
                                    except Exception:
                                        pass
                                if not heavy_persona.activo and auto_reg:
                                    if heavy_persona.estado != "bloqueado":
                                        heavy_persona.activo = True
                                        logger.info(f"[ACCESS-BG] Reactivación de persona en BD: {dni_data.dni}")
                                db_heavy.commit()

                            if heavy_persona and not heavy_persona.activo:
                                heavy_persona = None

                        # Crear vínculo auto-registrado si corresponde
                        if auto_reg and heavy_vehiculo and heavy_persona:
                            vinculo = db_heavy.query(PersonaVehiculo).filter(
                                PersonaVehiculo.vehiculo_id == heavy_vehiculo.id,
                                PersonaVehiculo.persona_id == heavy_persona.id
                            ).first()
                            if not vinculo:
                                vinculo = PersonaVehiculo(
                                    persona_id=heavy_persona.id,
                                    vehiculo_id=heavy_vehiculo.id,
                                    puede_conducir=True
                                )
                                db_heavy.add(vinculo)
                                db_heavy.commit()
                                logger.info(f"[ACCESS-BG] Vínculo auto-registrado: {heavy_persona.nombre} <-> {heavy_vehiculo.patente}")

                        # 2. Copiar fotos de la última detección
                        det_rec = None
                        if plate:
                            limite_ts = now - dt.timedelta(seconds=15)
                            det_rec = db_heavy.query(Deteccion).filter(
                                Deteccion.patente == plate,
                                Deteccion.sentido == sentido,
                                Deteccion.fecha_hora >= limite_ts
                            ).order_by(Deteccion.id.desc()).first()

                        foto_ent = det_rec.foto_path if (det_rec and sentido == "in") else None
                        foto_sal = det_rec.foto_path if (det_rec and sentido == "out") else None
                        foto_evidencia = det_rec.foto_evidencia_path if det_rec else None

                        # 3. Capturar instantánea de evidencia (RTSP/Cámara lenta)
                        enabled = settings.snapshot_enabled_in if sentido == "in" else settings.snapshot_enabled_out
                        trigger = settings.snapshot_trigger_in if sentido == "in" else settings.snapshot_trigger_out
                        if enabled and trigger in {"dni", "ambos"} and dni_data:
                            try:
                                from .alpr import get_alpr
                                shot = get_alpr(sentido)._capture_snapshot_frame()
                                if shot is not None:
                                    import cv2
                                    from pathlib import Path
                                    subdir = now.strftime("%Y-%m-%d")
                                    ts = now.strftime("%Y%m%d_%H%M%S")
                                    dest_dir = Path(__file__).resolve().parent.parent.parent / "evidencia" / subdir
                                    dest_dir.mkdir(parents=True, exist_ok=True)
                                    filename = f"dni_{ts}_{dni_data.dni}_{sentido}_evidence.jpg"
                                    fpath = dest_dir / filename
                                    cv2.imwrite(str(fpath), shot, [cv2.IMWRITE_JPEG_QUALITY, 88])
                                    foto_evidencia = f"evidencia/{subdir}/{filename}"
                                    
                                    if sentido == "in" and not foto_ent:
                                        foto_ent = foto_evidencia
                                    elif sentido == "out" and not foto_sal:
                                        foto_sal = foto_evidencia
                            except Exception as exc:
                                logger.warning(f"[ACCESS-BG] Error asíncrono capturando foto de evidencia: {exc}")

                        # 4. Insertar registro persistente de Acceso
                        acceso = Acceso(
                            fecha_hora=now,
                            sentido=sentido,
                            patente=plate,
                            vehiculo_id=heavy_vehiculo.id if heavy_vehiculo else None,
                            dni=dni_data.dni if dni_data else None,
                            persona_id=heavy_persona.id if heavy_persona else None,
                            resultado=resultado,
                            motivo=motivo,
                            ocr_conf=float((plate_data or {}).get("ocr_conf") or 0),
                            detector_conf=float((plate_data or {}).get("detector_conf") or 0),
                            foto_entrada_path=foto_ent,
                            foto_salida_path=foto_sal,
                            foto_evidencia_path=foto_evidencia,
                            lote=lote,
                            relay_abierto_en=now if resultado in {"autorizado", "manual"} else None
                        )
                        db_heavy.add(acceso)
                        db_heavy.commit()
                        db_heavy.refresh(acceso)
                        real_id = acceso.id

                        # Vincular detección si corresponde
                        if det_rec:
                            det_rec.autorizado = (resultado in {"autorizado", "manual"})
                            det_rec.acceso_id = real_id
                            if foto_evidencia and not det_rec.foto_evidencia_path:
                                det_rec.foto_evidencia_path = foto_evidencia
                            db_heavy.commit()

                        # 5. Gestionar la estadía
                        if resultado == "autorizado":
                            self._gestionar_estadia(db_heavy, acceso, heavy_vehiculo, heavy_persona, sentido, now)

                        # 6. Actualizar en memoria el ID temporal con el ID real definitivo y las fotos grabadas
                        with self._lock:
                            for ev in self.recent_events:
                                if ev.get("id") == temp_id:
                                    ev["id"] = real_id
                                    ev["vehiculo"] = heavy_vehiculo.descripcion if heavy_vehiculo else None
                                    ev["persona"] = f"{heavy_persona.nombre} {heavy_persona.apellido}" if heavy_persona else None
                                    ev["lote"] = lote
                                    break

                        logger.info(f"[ACCESS-BG] Registro guardado con éxito. Acceso ID: {real_id}")

                    except Exception as exc:
                        logger.error(f"[ACCESS-BG] Excepción crítica en procesamiento pesado: {exc}")
                    finally:
                        db_heavy.close()

                # Lanzar el hilo de procesamiento pesado
                threading.Thread(target=_bg_heavy_processing, daemon=True).start()

            except Exception as exc:
                logger.error(f"[ACCESS] Excepción en evaluación asíncrona: {exc}")
            finally:
                db.close()

        # Lanzar toda la evaluación en un hilo daemon de fondo
        threading.Thread(target=_async_evaluate_pipeline, daemon=True).start()

    def _decide(
        self, db: Session, vehiculo: Vehiculo | None, persona: Persona | None,
        plate: str | None, dni_data: DNIData | None, sentido: str, now: dt.datetime
    ) -> tuple[str, str, str | None]:
        
        # 1. Reglas Generales (Horarios y Bloqueos)
        if vehiculo:
            if vehiculo.estado == "bloqueado":
                return "denegado_patente", "Vehículo bloqueado", None
            if vehiculo.fecha_vencimiento and vehiculo.fecha_vencimiento < now:
                return "denegado_patente", "Acceso de vehículo vencido", None
            if vehiculo.hora_desde and vehiculo.hora_hasta:
                current_t = now.time()
                if not (vehiculo.hora_desde <= current_t <= vehiculo.hora_hasta):
                    return "denegado_patente", "Fuera de horario permitido", None
                    
        if persona:
            if persona.estado == "bloqueado":
                return "denegado_dni", "Persona bloqueada", None
            if persona.hora_desde and persona.hora_hasta:
                current_t = now.time()
                if not (persona.hora_desde <= current_t <= persona.hora_hasta):
                    return "denegado_dni", "Persona fuera de horario permitido", None

        # 2. Check Pre-Autorizaciones (Visitas Temporales cargadas por Propietario)
        if settings.propietario_auth_visits:
            from ..models import PreAutorizacion
            pa_match = None
            if plate:
                pa_match = db.query(PreAutorizacion).filter(
                    PreAutorizacion.patente == plate,
                    PreAutorizacion.activo == True,
                    PreAutorizacion.fecha_desde <= now,
                    PreAutorizacion.fecha_hasta >= now
                ).first()
            if not pa_match and dni_data:
                pa_match = db.query(PreAutorizacion).filter(
                    PreAutorizacion.dni == dni_data.dni,
                    PreAutorizacion.activo == True,
                    PreAutorizacion.fecha_desde <= now,
                    PreAutorizacion.fecha_hasta >= now
                ).first()

            if pa_match:
                desc_pa = f"Pre-autorizado Lote {pa_match.lote}"
                if pa_match.nombre or pa_match.apellido:
                    desc_pa += f": {pa_match.nombre or ''} {pa_match.apellido or ''}".strip()
                return "autorizado", desc_pa, pa_match.lote

        # 3. Validar salida sin entrada previa (si es OUT y allow_exit_without_entry is False)
        if sentido == "out" and not settings.allow_exit_without_entry:
            # Buscar estadia abierta
            estadia = None
            if vehiculo:
                estadia = db.query(Estadia).filter(Estadia.vehiculo_id == vehiculo.id, Estadia.fecha_salida.is_(None)).first()
            if not estadia and persona:
                estadia = db.query(Estadia).filter(Estadia.persona_id == persona.id, Estadia.fecha_salida.is_(None)).first()
            
            if not estadia:
                return "denegado_ambos", "Salida denegada: No registra ingreso previo", None

        # 4. Validacion por modo
        mode = self._auth_mode()
        
        if mode == "patente":
            if vehiculo: return "autorizado", f"{vehiculo.descripcion or (plate or 'vehiculo')} — validado por patente", None
            return "denegado_patente", f"Patente {(plate or '-')} no autorizada", None

        if mode == "dni":
            if persona: return "autorizado", f"{persona.nombre} {persona.apellido} — validado por DNI", None
            return "denegado_dni", f"DNI {dni_data.dni if dni_data else '-'} no autorizado", None

        if mode == "combinado":
            if vehiculo and persona:
                vinculo = db.query(PersonaVehiculo).filter(
                    PersonaVehiculo.vehiculo_id == vehiculo.id, PersonaVehiculo.persona_id == persona.id
                ).first()
                if vinculo and vinculo.puede_conducir:
                    return "autorizado", f"{persona.nombre} en {vehiculo.descripcion or plate}", None
            if vehiculo: return "autorizado", f"{vehiculo.descripcion or plate} — validado patente", None
            if persona: return "autorizado", f"{persona.nombre} — validado DNI", None
            return "denegado_ambos", "Sin autorización", None

        # Modo "ambos"
        if vehiculo is None:
            return "denegado_patente", f"Patente {(plate or '-')} no autorizada", None
            
        need_dni = mode == "ambos" and vehiculo.requiere_dni
        if not need_dni:
            return "autorizado", f"{vehiculo.descripcion or plate} — solo patente", None

        if dni_data is None: return "denegado_dni", "Se requiere DNI", None
        if persona is None: return "denegado_dni", f"DNI no autorizado", None

        vinculo = db.query(PersonaVehiculo).filter(
            PersonaVehiculo.vehiculo_id == vehiculo.id, PersonaVehiculo.persona_id == persona.id
        ).first()
        if not vinculo: return "denegado_dni", f"{persona.nombre} no habilitado para {plate}", None
        if not vinculo.puede_conducir: return "denegado_dni", f"{persona.nombre} no puede conducir", None

        return "autorizado", f"{persona.nombre} en {vehiculo.descripcion or plate}", None

    def _gestionar_estadia(
        self, db: Session, acceso: Acceso, vehiculo: Vehiculo | None, persona: Persona | None, sentido: str, now: dt.datetime
    ) -> None:
        """Crea o cierra la estadia segun el sentido."""
        if sentido == "in":
            # Crear nueva estadia
            estadia = Estadia(
                vehiculo_id=vehiculo.id if vehiculo else None,
                persona_id=persona.id if persona else None,
                acceso_in_id=acceso.id,
                fecha_ingreso=now
            )
            db.add(estadia)
            db.commit()
        else:
            # Buscar la estadia mas antigua sin cerrar para este vehiculo o persona
            estadia = None
            if vehiculo:
                estadia = db.query(Estadia).filter(
                    Estadia.vehiculo_id == vehiculo.id, Estadia.fecha_salida.is_(None)
                ).order_by(Estadia.fecha_ingreso.asc()).first()
            if not estadia and persona:
                estadia = db.query(Estadia).filter(
                    Estadia.persona_id == persona.id, Estadia.fecha_salida.is_(None)
                ).order_by(Estadia.fecha_ingreso.asc()).first()
                
            if estadia:
                estadia.fecha_salida = now
                estadia.acceso_out_id = acceso.id
                db.commit()
                # Calcular minutos
                diff = now - estadia.fecha_ingreso
                mins = int(diff.total_seconds() / 60)
                logger.info(f"[ESTADIA] Vehículo salió. Tiempo dentro: {mins} minutos.")
            else:
                logger.warning(f"[ESTADIA] Vehículo salió sin entrada registrada (Acceso ID: {acceso.id})")

    # ── Interacción de Hardware / Relay ──────────────────────────────────────
    def sensor_close(self, sentido: str) -> None:
        """Llamado asíncronamente por Relay cuando el vehículo pasa el sensor."""
        logger.info(f"[ACCESS] Sensor de barrera {sentido.upper()} cruzado. Cerrando barrera.")
        
        now = dt.datetime.now()
        temp_id = -int(time.time() * 1000)

        # 1. Feedback visual instantaneo en memoria e historial
        event = {
            "id": temp_id,
            "fecha": now.isoformat(timespec="seconds"),
            "sentido": sentido,
            "resultado": "sensor_close",
            "motivo": "Paso de vehículo detectado (Masa metálica)",
            "lote": None,
        }
        with self._lock:
            self.recent_events.insert(0, event)
            if len(self.recent_events) > self._max_recent:
                self.recent_events.pop()

        # 2. Despachar a los websockets inmediatamente para que la UI se entere
        dispatcher.dispatch("ACCESS_RESULT", {
            "sentido": sentido,
            "resultado": "sensor_close",
            "motivo": "Paso de vehículo detectado (Masa metálica)",
            "id": temp_id
        })

        # 3. Lanzar hilo de fondo para BD y Relay
        def _bg_sensor_close():
            db = SessionLocal()
            try:
                # Buscar el ultimo acceso autorizado de este sentido
                acc = db.query(Acceso).filter(
                    Acceso.sentido == sentido,
                    Acceso.resultado.in_({"autorizado", "manual"})
                ).order_by(Acceso.id.desc()).first()
                
                if acc and acc.relay_cerrado_en is None:
                    acc.relay_cerrado_en = now
                
                # Registrar un evento de tipo sensor_close
                acceso = Acceso(
                    fecha_hora=now,
                    sentido=sentido,
                    resultado="sensor_close",
                    motivo="Paso de vehículo detectado (Masa metálica)",
                    relay_cerrado_en=now,
                )
                db.add(acceso)
                db.commit()
                db.refresh(acceso)
                real_id = acceso.id

                # Actualizar el ID real en memoria
                with self._lock:
                    for ev in self.recent_events:
                        if ev.get("id") == temp_id:
                            ev["id"] = real_id
                            break
            except Exception as exc:
                logger.error(f"[ACCESS] Error asincrono en sensor_close (BD): {exc}")
            finally:
                db.close()

            # Cerrar relay
            try:
                relay.close(sentido)
            except Exception as exc:
                logger.error(f"[ACCESS] Error asincrono en sensor_close (Relay): {exc}")

        threading.Thread(target=_bg_sensor_close, daemon=True).start()

    def watchdog_close(self, sentido: str) -> None:
        """Cierre automático por timeout (watchdog) de forma asíncrona y no bloqueante."""
        now = dt.datetime.now()
        temp_id = -int(time.time() * 1000)

        # 1. Feedback visual instantáneo en memoria e historial
        event = {
            "id": temp_id,
            "fecha": now.isoformat(timespec="seconds"),
            "sentido": sentido,
            "resultado": "timeout_close",
            "motivo": "Cierre automático por timeout",
            "lote": None,
        }
        with self._lock:
            self.recent_events.insert(0, event)
            if len(self.recent_events) > self._max_recent:
                self.recent_events.pop()

        # 2. Despachar a los websockets inmediatamente para que la UI se entere
        dispatcher.dispatch("ACCESS_RESULT", {
            "sentido": sentido,
            "resultado": "timeout_close",
            "motivo": "Cierre automático por timeout",
            "id": temp_id
        })

        # 3. Lanzar hilo de fondo para BD
        def _bg_watchdog_close():
            db = SessionLocal()
            try:
                # Buscar el último acceso autorizado de este sentido
                acc = db.query(Acceso).filter(
                    Acceso.sentido == sentido,
                    Acceso.resultado.in_({"autorizado", "manual"})
                ).order_by(Acceso.id.desc()).first()
                
                if acc and acc.relay_cerrado_en is None:
                    acc.relay_cerrado_en = now
                
                acceso = Acceso(
                    fecha_hora=now,
                    sentido=sentido,
                    resultado="timeout_close",
                    motivo="Cierre automático por timeout",
                    relay_cerrado_en=now,
                )
                db.add(acceso)
                db.commit()
                db.refresh(acceso)
                real_id = acceso.id

                # Actualizar el ID real en memoria
                with self._lock:
                    for ev in self.recent_events:
                        if ev.get("id") == temp_id:
                            ev["id"] = real_id
                            break
            except Exception as exc:
                logger.error(f"[ACCESS] Error asincrono en watchdog_close (BD): {exc}")
            finally:
                db.close()

        threading.Thread(target=_bg_watchdog_close, daemon=True).start()

    def manual_close(self, operador_id: int, sentido: str = "in") -> dict[str, Any]:
        """Cierre manual desde panel web de forma asincrona y no bloqueante."""
        now = dt.datetime.now()
        temp_id = -int(time.time() * 1000)

        # 1. Feedback visual instantaneo en memoria e historial
        event = {
            "id": temp_id,
            "fecha": now.isoformat(timespec="seconds"),
            "sentido": sentido,
            "resultado": "manual_close",
            "motivo": "Cierre manual comandado",
            "lote": None,
        }
        with self._lock:
            self.recent_events.insert(0, event)
            if len(self.recent_events) > self._max_recent:
                self.recent_events.pop()

        # 2. Despachar a los websockets inmediatamente para que la UI se entere
        dispatcher.dispatch("ACCESS_RESULT", {
            "sentido": sentido,
            "resultado": "manual_close",
            "motivo": "Cierre manual comandado",
            "id": temp_id
        })

        # 3. Lanzar hilo de fondo para BD y Relay
        def _bg_manual_close():
            db = SessionLocal()
            try:
                acceso = Acceso(
                    fecha_hora=now,
                    sentido=sentido,
                    resultado="manual_close",
                    operador_id=operador_id,
                    motivo="Cierre manual comandado",
                    relay_cerrado_en=now,
                )
                db.add(acceso)
                db.commit()
                db.refresh(acceso)
                real_id = acceso.id

                # Actualizar el ID real en memoria
                with self._lock:
                    for ev in self.recent_events:
                        if ev.get("id") == temp_id:
                            ev["id"] = real_id
                            break
            except Exception as exc:
                logger.error(f"[ACCESS] Error asincrono en manual_close (BD): {exc}")
            finally:
                db.close()

            # Cerrar relay de forma independiente
            try:
                relay.close(sentido)
            except Exception as exc:
                logger.error(f"[ACCESS] Error asincrono en manual_close (Relay): {exc}")

        threading.Thread(target=_bg_manual_close, daemon=True).start()

        return {"ok": True, "acceso_id": temp_id, "mensaje": f"Barrera {sentido.upper()} cerrada"}


    def manual_open(self, operador_id: int, sentido: str = "in", notas: str = "", lote: str | None = None) -> dict[str, Any]:
        """Apertura manual desde panel web de forma asincrona y no bloqueante."""
        now = dt.datetime.now()
        temp_id = -int(time.time())

        # 1. Feedback visual instantaneo en memoria e historial
        event = {
            "id": temp_id,
            "fecha": now.isoformat(timespec="seconds"),
            "sentido": sentido,
            "resultado": "manual",
            "motivo": notas or "Apertura manual",
            "lote": lote,
        }
        with self._lock:
            self.recent_events.insert(0, event)
            if len(self.recent_events) > self._max_recent:
                self.recent_events.pop()

        # 2. Despachar a los websockets inmediatamente para que la UI se entere
        dispatcher.dispatch("ACCESS_RESULT", {
            "sentido": sentido,
            "resultado": "manual",
            "motivo": notas or "Apertura manual",
            "id": temp_id
        })

        # 3. Lanzar hilo de fondo para BD y Relay
        def _bg_manual_open():
            db = SessionLocal()
            try:
                acceso = Acceso(
                    fecha_hora=now,
                    sentido=sentido,
                    resultado="manual",
                    operador_id=operador_id,
                    notas=notas or "Apertura manual",
                    relay_abierto_en=dt.datetime.now(),
                    lote=lote,
                )
                db.add(acceso)
                db.commit()
                db.refresh(acceso)
                real_id = acceso.id

                # Actualizar el ID real en memoria
                with self._lock:
                    for ev in self.recent_events:
                        if ev.get("id") == temp_id:
                            ev["id"] = real_id
                            break
            except Exception as exc:
                logger.error(f"[ACCESS] Error asincrono en manual_open (BD): {exc}")
            finally:
                db.close()

            # Abrir relay de forma independiente
            try:
                relay.open(sentido)
            except Exception as exc:
                logger.error(f"[ACCESS] Error asincrono en manual_open (Relay): {exc}")

        threading.Thread(target=_bg_manual_open, daemon=True).start()

        return {"ok": True, "acceso_id": temp_id, "mensaje": f"Barrera {sentido.upper()} abierta"}

# Singleton
access_controller = AccessController()
