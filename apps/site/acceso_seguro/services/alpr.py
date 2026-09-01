from __future__ import annotations
import base64
import datetime as dt
import logging
import re
import statistics
import threading
import time
import urllib.parse
from collections import deque
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np
from fast_alpr import ALPR

from ..config import settings

logger = logging.getLogger("alpr_service")

# --- Disyuntor de circuito (Circuit Breaker) para fuentes caídas ---
_offline_sources: dict[str, float] = {}
_offline_lock = threading.Lock()
_capture_init_lock = threading.Lock()

def is_source_offline(source: str | int) -> bool:
    if not isinstance(source, str):
        return False
    now = time.time()
    with _offline_lock:
        cooldown_until = _offline_sources.get(source, 0.0)
        if now < cooldown_until:
            return True
    return False

def mark_source_offline(source: str | int, cooldown_sec: float = 30.0) -> None:
    if not isinstance(source, str):
        return
    now = time.time()
    with _offline_lock:
        _offline_sources[source] = now + cooldown_sec

def mark_source_online(source: str | int) -> None:
    if not isinstance(source, str):
        return
    with _offline_lock:
        if source in _offline_sources:
            del _offline_sources[source]


def safe_video_capture(source: str | int, timeout_ms: int = 2500, bypass_cooldown: bool = False) -> cv2.VideoCapture:
    """
    Inicializa cv2.VideoCapture de manera segura evitando bloqueos del GIL y colisiones de hilos.
    Configura timeouts explicitos de conexion y lectura para el backend de FFMPEG.
    Si la fuente está caída en cooldown offline, retorna una captura vacía de inmediato (a menos que se indique bypass_cooldown).
    """
    # Forzar transporte TCP antes de inicializar cualquier captura
    import os
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

    if not bypass_cooldown and is_source_offline(source):
        logger.warning(f"[ALPR] Fuente {source} en cooldown offline. Evitando conexion para prevenir bloqueo.")
        return cv2.VideoCapture()

    cap_src = int(source) if str(source).isdigit() else source
    params = []
    if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
        params.extend([cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms])
    if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
        params.extend([cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms])

    if isinstance(cap_src, str) and cap_src.startswith(("rtsp://", "rtsps://", "http://", "https://")):
        try:
            with _capture_init_lock:
                cap = cv2.VideoCapture(cap_src, cv2.CAP_FFMPEG, params)
            if cap.isOpened():
                mark_source_online(source)
                return cap
            else:
                mark_source_offline(source)
        except Exception as exc:
            logger.warning(f"[ALPR] Error al abrir con FFMPEG y parametros: {exc}. Reintentando constructor estandar...")
            try:
                with _capture_init_lock:
                    cap = cv2.VideoCapture(cap_src)
                if cap.isOpened():
                    mark_source_online(source)
                    return cap
                else:
                    mark_source_offline(source)
            except Exception:
                mark_source_offline(source)
                return cv2.VideoCapture()
    else:
        try:
            with _capture_init_lock:
                cap = cv2.VideoCapture(cap_src)
            return cap
        except Exception:
            return cv2.VideoCapture()

    return cv2.VideoCapture()




def _now_iso() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


class ALPRService:
    """
    Servicio ALPR continuo.

    - Lee frames de la camara configurada.
    - Requiere N lecturas consistentes dentro de una ventana de tiempo
      antes de disparar el callback (anti-falso-positivo).
    - Persiste el ultimo JPEG para el stream MJPEG.
    """

    def __init__(self, sentido: str = "in") -> None:
        self.sentido = sentido
        self.alpr = ALPR(
            detector_model=settings.detector_model,
            ocr_model=settings.ocr_model,
            ocr_device=settings.ocr_device,
            detector_conf_thresh=settings.min_detector_conf,
        )
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._active_thread: threading.Thread | None = None
        self.running = False
        self.frame_id = 0
        self.last_inference_ms = 0.0
        self.last_error = ""
        self.latest_jpeg: bytes = b""
        self._readings: deque[tuple[str, float]] = deque(maxlen=30)
        self._confirmed_cooldown: dict[str, float] = {}  # plate -> last_confirmed_time
        self._on_detection: list[Callable[[dict[str, Any]], None]] = []
        # Runtime-tuneable config (shadows settings, changeable without restart)
        self._inference_every_n: int = settings.inference_every_n
        self._min_ocr_conf: float = settings.min_ocr_conf
        self._min_detector_conf: float = settings.min_detector_conf
        # ROI (normalized 0-1) — per-sentido
        if sentido == "out":
            self.roi_enabled: bool = settings.roi_out_enabled
            self.roi_x: float = settings.roi_out_x
            self.roi_y: float = settings.roi_out_y
            self.roi_w: float = settings.roi_out_w
            self.roi_h: float = settings.roi_out_h
            
            # Motion detection (CPU Saver)
            self.motion_detection_enabled: bool = settings.motion_detection_enabled_out
            self.motion_threshold: float = settings.motion_threshold_out
            self.motion_cooldown_sec: float = settings.motion_cooldown_sec_out
        else:
            self.roi_enabled: bool = settings.roi_enabled
            self.roi_x: float = settings.roi_x
            self.roi_y: float = settings.roi_y
            self.roi_w: float = settings.roi_w
            self.roi_h: float = settings.roi_h
            
            # Motion detection (CPU Saver)
            self.motion_detection_enabled: bool = settings.motion_detection_enabled_in
            self.motion_threshold: float = settings.motion_threshold_in
            self.motion_cooldown_sec: float = settings.motion_cooldown_sec_in

        self._prev_roi_gray: np.ndarray | None = None
        self._motion_cooldown_until: float = 0.0
        # Stats
        self.dedup_skipped: int = 0
        self.processed_frames: int = 0
        self.detections: deque[dict[str, Any]] = deque(maxlen=500)
        self._lock = threading.Lock()
        self._last_raw_frame: np.ndarray | None = None
        self._last_frame_time: float = 0.0
        self._set_status_frame("Iniciando servicio de camara...")
        self._start()

    # ── API publica ────────────────────────────────────────────────────────
    def register_on_detection(self, cb: Callable[[dict[str, Any]], None]) -> None:
        self._on_detection.append(cb)

    def start(self) -> None:
        """Inicia el worker si no está corriendo."""
        if not self.running:
            self._stop.clear()
            self._start()

    def stop(self) -> None:
        """Detiene el worker."""
        self._stop.set()
        self.running = False
        self._active_thread = None

    def restart(self, new_source: str | None = None) -> None:
        self._stop.set()
        self._active_thread = None
        time.sleep(0.5)
        if new_source:
            if self.sentido == "in":
                settings.camera_source_in = new_source
            else:
                settings.camera_source_out = new_source
        self.running = False
        self._start()

    def stats(self) -> dict[str, Any]:
        """Estadísticas de detecciones en memoria (hoy / última hora)."""
        now_dt = dt.datetime.now()
        today = now_dt.date()
        last_hour_start = now_dt - dt.timedelta(hours=1)
        items = list(self.detections)
        today_count = 0
        last_hour_count = 0
        for d in items:
            try:
                ts = dt.datetime.fromisoformat(d.get("fecha", ""))
            except (ValueError, TypeError):
                continue
            if ts.date() == today:
                today_count += 1
            if ts >= last_hour_start:
                last_hour_count += 1
        return {
            "total": len(items),
            "today": today_count,
            "last_hour": last_hour_count,
            "processed_frames": self.processed_frames,
            "dedup_skipped": self.dedup_skipped,
        }

    def clear_detections(self) -> None:
        self.detections.clear()

    def status(self) -> dict:
        alpr_active = (time.time() < self._motion_cooldown_until) if self.motion_detection_enabled else True
        return {
            "running": self.running,
            "frame_id": self.frame_id,
            "processed_frames": self.processed_frames,
            "last_inference_ms": self.last_inference_ms,
            "last_error": self.last_error,
            "source": self.mask_source_for_display(self._get_source()) if self._get_source() else "(no configurada)",
            "sentido": self.sentido,
            "dedup_skipped": self.dedup_skipped,
            "detections_total": len(self.detections),
            "alpr_active": alpr_active,
            "runtime_config": {
                "inference_every_n": self._inference_every_n,
                "filter_min_ocr_conf": self._min_ocr_conf,
                "filter_min_detector_conf": self._min_detector_conf,
                "dedup_window_sec": settings.dedup_window_sec,
                "ocr_device": settings.ocr_device,
                "auth_mode": settings.auth_mode,
                "qr_camera_source": settings.qr_camera_source_in if self.sentido == "in" else settings.qr_camera_source_out,
                "snapshot_camera_source": settings.snapshot_camera_source_in if self.sentido == "in" else settings.snapshot_camera_source_out,
                "evidence_retention_days": settings.evidence_retention_days,
                "motion_detection_enabled": self.motion_detection_enabled,
                "motion_threshold": self.motion_threshold,
                "motion_cooldown_sec": self.motion_cooldown_sec,
            },
            "roi": self.get_roi(),
        }

    # ── Arranque ───────────────────────────────────────────────────────────
    def _get_source(self) -> str:
        if self.sentido == "in":
            return settings.camera_source_in.strip()
        return settings.camera_source_out.strip()

    def _start(self) -> None:
        source = self._get_source()
        if not source:
            self.last_error = "camera_source no configurada"
            logger.warning("[ALPR] %s", self.last_error)
            self._set_status_frame("Camara no configurada. Configurala en la pestaña Configuracion.")
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._active_thread = self._thread
        self.running = True
        self._thread.start()
        logger.info(f"[ALPR] Worker iniciado — fuente: {source}")

    # ── Worker ─────────────────────────────────────────────────────────────
    def _worker(self) -> None:
        source = self._get_source()
        cap_src = int(source) if source.isdigit() else source

        local_id = 0
        last_no_signal_update = 0.0
        current_thread = threading.current_thread()
        
        retry_delay = 1.0  # Inicia en 1.0 segundo
        max_retry_delay = 8.0  # Límite máximo de 8 segundos para evitar esperas excesivas cuando la cámara ya está disponible
        
        while not self._stop.is_set() and self._active_thread is current_thread:
            logger.info(f"[ALPR] Conectando a fuente de cámara: {source}")
            cap = safe_video_capture(cap_src, timeout_ms=2500, bypass_cooldown=True)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            if not cap.isOpened():
                self.last_error = f"No se pudo abrir: {source}"
                logger.error(f"[ALPR] {self.last_error}. Reintentando en {retry_delay:.1f} segundos...")
                self._set_status_frame("No se pudo abrir la camara. Reintentando...")
                cap.release()
                
                # Esperar retry_delay segundos con stop checks antes de reintentar
                steps = int(retry_delay * 10)
                for _ in range(steps):
                    if self._stop.is_set() or self._active_thread is not current_thread:
                        break
                    time.sleep(0.1)
                
                # Incrementar exponencialmente y limitar al máximo establecido
                retry_delay = min(retry_delay * 2, max_retry_delay)
                continue

            # Reiniciar delay al conectar con éxito
            retry_delay = 1.0
            logger.info(f"[ALPR] Conexión establecida con éxito: {source}")
            
            try:
                while not self._stop.is_set() and self._active_thread is current_thread:
                    ok, frame = cap.read()
                    if not ok or frame is None or frame.size == 0:
                        logger.warning("[ALPR] Stream de cámara perdido o frame vacío. Reabriendo...")
                        now_t = time.time()
                        if now_t - last_no_signal_update >= 1.0:
                            self._set_status_frame("Sin señal o frame vacío. Reintentando...")
                            last_no_signal_update = now_t
                        break

                    with self._lock:
                        self._last_raw_frame = frame.copy()
                        self._last_frame_time = time.time()

                    self.frame_id = local_id

                    # === DETECCION DE MOVIMIENTO (AHORRO DE CPU) ===
                    alpr_active = True
                    if self.motion_detection_enabled:
                        fh, fw = frame.shape[:2]
                        if self.roi_enabled and self.roi_w > 0 and self.roi_h > 0:
                            rx = max(0, int(self.roi_x * fw))
                            ry = max(0, int(self.roi_y * fh))
                            rw = max(1, int(self.roi_w * fw))
                            rh = max(1, int(self.roi_h * fh))
                            motion_zone = frame[ry:ry + rh, rx:rx + rw]
                        else:
                            motion_zone = frame

                        m_h, m_w = motion_zone.shape[:2]
                        if m_w > 0 and m_h > 0:
                            target_w = 160
                            target_h = int(m_h * (target_w / m_w))
                            if target_h <= 0:
                                target_h = 120
                            small_zone = cv2.resize(motion_zone, (target_w, target_h), interpolation=cv2.INTER_AREA)
                            gray_zone = cv2.cvtColor(small_zone, cv2.COLOR_BGR2GRAY)
                            gray_zone = cv2.GaussianBlur(gray_zone, (5, 5), 0)

                            if self._prev_roi_gray is not None and self._prev_roi_gray.shape == gray_zone.shape:
                                frame_diff = cv2.absdiff(self._prev_roi_gray, gray_zone)
                                _, thresh = cv2.threshold(frame_diff, 20, 255, cv2.THRESH_BINARY)
                                changed_pixels = np.sum(thresh == 255)
                                total_pixels = thresh.size
                                change_ratio = changed_pixels / total_pixels
                                if change_ratio >= self.motion_threshold:
                                    self._motion_cooldown_until = time.time() + self.motion_cooldown_sec
                            self._prev_roi_gray = gray_zone

                        alpr_active = time.time() < self._motion_cooldown_until

                    # ── SIEMPRE actualizar stream ANTES de inferencia ──
                    # Esto evita el efecto "rebobinar" cuando la inferencia bloquea el hilo.
                    disp_h, disp_w = frame.shape[:2]
                    if disp_w > 960 and disp_h > 0:
                        scale = 960 / disp_w
                        new_h = max(1, int(disp_h * scale))
                        stream_frame = cv2.resize(frame, (960, new_h))
                    else:
                        stream_frame = frame.copy()

                    # --- Dibujar badge de ALPR en stream normal ---
                    badge_txt = "ALPR: ESCANEANDO" if alpr_active else "ALPR: STANDBY"
                    badge_col = (76, 209, 55) if alpr_active else (149, 175, 192) # BGR: Verde esmeralda, Gris
                    overlay = stream_frame.copy()
                    (tw, th), _ = cv2.getTextSize(badge_txt, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                    cv2.rectangle(overlay, (15, 15), (25 + tw, 35 + th), (20, 20, 28), -1)
                    cv2.addWeighted(overlay, 0.75, stream_frame, 0.25, 0, stream_frame)
                    cv2.rectangle(stream_frame, (15, 15), (25 + tw, 35 + th), badge_col, 1, cv2.LINE_AA)
                    cv2.putText(stream_frame, badge_txt, (20, 20 + th), cv2.FONT_HERSHEY_SIMPLEX, 0.45, badge_col, 1, cv2.LINE_AA)

                    _, enc_j = cv2.imencode(".jpg", stream_frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
                    if enc_j is not None:
                        self.latest_jpeg = enc_j.tobytes()

                    if local_id % self._inference_every_n == 0:
                        t0 = time.perf_counter()
                        if not alpr_active:
                            # Standby: saltar inferencia
                            results = []
                            self.last_inference_ms = 0.0
                            display = frame.copy()
                            # Dibujar ROI en standby en gris
                            if self.roi_enabled and self.roi_w > 0 and self.roi_h > 0:
                                rx = max(0, int(self.roi_x * fw))
                                ry = max(0, int(self.roi_y * fh))
                                rw = max(1, int(self.roi_w * fw))
                                rh = max(1, int(self.roi_h * fh))
                                cv2.rectangle(display, (rx, ry), (rx + rw, ry + rh), (149, 175, 192), 1)
                        else:
                            # ROI crop o completo
                            fh, fw = frame.shape[:2]
                            roi_offset_x = 0
                            roi_offset_y = 0
                            if self.roi_enabled and self.roi_w > 0 and self.roi_h > 0:
                                rx = max(0, int(self.roi_x * fw))
                                ry = max(0, int(self.roi_y * fh))
                                rw = max(1, int(self.roi_w * fw))
                                rh = max(1, int(self.roi_h * fh))
                                roi_crop = frame[ry:ry + rh, rx:rx + rw]
                                results = self.alpr.predict(roi_crop)
                                roi_offset_x = rx
                                roi_offset_y = ry
                            else:
                                results = self.alpr.predict(frame)
                            self.last_inference_ms = round((time.perf_counter() - t0) * 1000, 2)
                            self.processed_frames += 1
                            display = frame.copy()

                            # Dibujar ROI en display
                            if self.roi_enabled and self.roi_w > 0 and self.roi_h > 0:
                                rx = max(0, int(self.roi_x * fw))
                                ry = max(0, int(self.roi_y * fh))
                                rw = max(1, int(self.roi_w * fw))
                                rh = max(1, int(self.roi_h * fh))
                                cv2.rectangle(display, (rx, ry), (rx + rw, ry + rh), (255, 180, 0), 2)

                        for res in results:
                            bbox = res.detection.bounding_box
                            ocr = res.ocr
                            if ocr is None:
                                continue

                            # Calcular confianza OCR (puede ser lista o float)
                            conf_raw = ocr.confidence
                            if isinstance(conf_raw, list) and conf_raw:
                                ocr_conf = float(statistics.mean(conf_raw))
                            elif isinstance(conf_raw, (int, float)):
                                ocr_conf = float(conf_raw)
                            else:
                                ocr_conf = 0.0

                            det_conf = float(res.detection.confidence)
                            plate = (ocr.text or "").strip().upper()
                            if not plate:
                                continue

                            # Dibujar en pantalla
                            x1 = int(bbox.x1 + roi_offset_x)
                            y1 = int(bbox.y1 + roi_offset_y)
                            x2 = int(bbox.x2 + roi_offset_x)
                            y2 = int(bbox.y2 + roi_offset_y)
                            cv2.rectangle(display, (x1, y1), (x2, y2), (36, 255, 12), 2)
                            lbl = f"{plate} {ocr_conf*100:.0f}%"
                            cv2.putText(display, lbl, (x1, max(20, y1 - 8)),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 4, cv2.LINE_AA)
                            cv2.putText(display, lbl, (x1, max(20, y1 - 8)),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

                            # Filtros de confianza
                            if ocr_conf < self._min_ocr_conf:
                                continue
                            if det_conf < self._min_detector_conf:
                                continue

                            # ── Filtro de formato de patente por país ──
                            if settings.plate_filter_enabled:
                                from .plate_validator import is_valid_plate
                                if not is_valid_plate(plate, settings.plate_filter_countries):
                                    logger.debug(f"[ALPR] Patente descartada (formato inválido): {plate}")
                                    continue
                            # ── Deduplicación: no re-confirmar misma patente en ventana ──
                            now_t = time.time()
                            last_seen = self._confirmed_cooldown.get(plate, 0)
                            if now_t - last_seen < settings.dedup_window_sec:
                                self.dedup_skipped += 1
                                continue

                            # Limpiar cooldowns viejos (> 60s)
                            expired = [p for p, t in self._confirmed_cooldown.items() if now_t - t > 60]
                            for p in expired:
                                del self._confirmed_cooldown[p]

                            # Acumular lecturas para confirmacion
                            self._readings.append((plate, now_t))

                            # Verificar si hay N lecturas consistentes en la ventana
                            now_t = time.time()
                            recent = [(p, t) for p, t in self._readings
                                      if now_t - t <= settings.readings_window_sec]
                            count = sum(1 for p, _ in recent if p == plate)

                            if count >= settings.readings_to_confirm:
                                # Miniaturas
                                fh2, fw2 = frame.shape[:2]
                                bx1 = max(0, int(bbox.x1 + roi_offset_x))
                                by1 = max(0, int(bbox.y1 + roi_offset_y))
                                bx2 = min(fw2, int(bbox.x2 + roi_offset_x))
                                by2 = min(fh2, int(bbox.y2 + roi_offset_y))
                                thumb_b64 = ""
                                if bx2 > bx1 and by2 > by1:
                                    crop = frame[by1:by2, bx1:bx2]
                                    th = 96
                                    ratio = th / max(1, crop.shape[0])
                                    tw = max(1, int(crop.shape[1] * ratio))
                                    crop_r = cv2.resize(crop, (tw, th), interpolation=cv2.INTER_AREA)
                                    ok_t, enc_t = cv2.imencode(".jpg", crop_r, [cv2.IMWRITE_JPEG_QUALITY, 86])
                                    if ok_t:
                                        thumb_b64 = "data:image/jpeg;base64," + base64.b64encode(enc_t.tobytes()).decode()
                                # Foto de auto de la cámara principal ALPR (frame reducido)
                                car_b64 = ""
                                sfh, sfw = frame.shape[:2]
                                tw2 = min(960, sfw)
                                car_frame = cv2.resize(frame, (tw2, max(1, int(sfh * tw2 / max(1, sfw)))), interpolation=cv2.INTER_AREA) if tw2 < sfw else frame
                                ok_c, enc_c = cv2.imencode(".jpg", car_frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
                                if ok_c:
                                    car_b64 = "data:image/jpeg;base64," + base64.b64encode(enc_c.tobytes()).decode()
                                
                                # Foto escena completa de la cámara principal ALPR (full quality)
                                _, enc = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
                                foto_b64 = "data:image/jpeg;base64," + base64.b64encode(enc.tobytes()).decode()

                                # La foto de evidencia se captura de manera asíncrona en un hilo separado
                                # para evitar congelar el frame/stream en tiempo real y acelerar el acceso.
                                foto_evidencia_b64 = ""
                                threading.Thread(
                                    target=self._capture_and_save_evidence_async,
                                    args=(plate, self.sentido),
                                    daemon=True
                                ).start()

                                det_data = {
                                    "sentido": self.sentido,
                                    "patente": plate,
                                    "fecha": _now_iso(),
                                    "frame_id": local_id,
                                    "ocr_conf": round(ocr_conf, 4),
                                    "detector_conf": round(det_conf, 4),
                                    "region": str(ocr.region or ""),
                                    "foto_b64": foto_b64,
                                    "thumb_b64": thumb_b64,
                                    "car_b64": car_b64,
                                    "foto_evidencia_b64": foto_evidencia_b64,
                                }
                                logger.info(f"[ALPR] Patente confirmada: {plate} "
                                            f"(OCR={ocr_conf:.2f} DET={det_conf:.2f})")

                                # Guardar en memoria (sin foto completa para ahorrar RAM)
                                det_compact = {k: v for k, v in det_data.items() if k not in ('foto_b64', 'foto_evidencia_b64')}
                                self.detections.appendleft(det_compact)

                                for cb in self._on_detection:
                                    try:
                                        cb(det_data)
                                    except Exception as exc:
                                        logger.error(f"[ALPR] Callback error: {exc}")

                                # Limpiar buffer y registrar cooldown
                                self._readings.clear()
                                self._confirmed_cooldown[plate] = time.time()

                        # Actualizar stream con frame anotado (con bounding boxes)
                        disp_h2, disp_w2 = display.shape[:2]
                        if disp_w2 > 960 and disp_h2 > 0:
                            scale2 = 960 / disp_w2
                            new_h2 = max(1, int(disp_h2 * scale2))
                            display = cv2.resize(display, (960, new_h2))

                        # --- Dibujar badge de ALPR en frame anotado ---
                        overlay = display.copy()
                        (tw, th), _ = cv2.getTextSize(badge_txt, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                        cv2.rectangle(overlay, (15, 15), (25 + tw, 35 + th), (20, 20, 28), -1)
                        cv2.addWeighted(overlay, 0.75, display, 0.25, 0, display)
                        cv2.rectangle(display, (15, 15), (25 + tw, 35 + th), badge_col, 1, cv2.LINE_AA)
                        cv2.putText(display, badge_txt, (20, 20 + th), cv2.FONT_HERSHEY_SIMPLEX, 0.45, badge_col, 1, cv2.LINE_AA)

                        _, enc_a = cv2.imencode(".jpg", display, [cv2.IMWRITE_JPEG_QUALITY, 50])
                        if enc_a is not None:
                            self.latest_jpeg = enc_a.tobytes()

                    local_id += 1
            except Exception as exc:
                self.last_error = f"Worker loop error: {exc}"
                logger.exception("[ALPR] Error en ciclo del worker")
                self._set_status_frame(f"Error de lectura: {exc}")
            finally:
                cap.release()
                time.sleep(1.0)

        self.running = False

    def _set_status_frame(self, message: str) -> None:
        """Genera un JPEG de estado para evitar pantalla negra en el stream."""
        img = np.zeros((720, 1280, 3), dtype=np.uint8)
        img[:] = (18, 20, 28)
        cv2.putText(img, "AccesoSeguro", (40, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (110, 130, 255), 3, cv2.LINE_AA)
        cv2.putText(img, message[:110], (40, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.82, (230, 230, 230), 2, cv2.LINE_AA)
        cv2.putText(img, dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), (40, 690), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (170, 170, 170), 1, cv2.LINE_AA)
        ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if ok and enc is not None:
            self.latest_jpeg = enc.tobytes()


    # ── Camera config ─────────────────────────────────────────────────────────

    @staticmethod
    def mask_source_for_display(source: str) -> str:
        return re.sub(r"(rtsp://[^:/@]+:)([^@]+)(@)", r"\1***\3", source or "", flags=re.IGNORECASE)

    @staticmethod
    def _parse_camera_source(source: str) -> dict:
        result = {
            "host": "", "port": 554, "user": "", "password": "",
            "channel": 1, "subtype": 0, "path": "/cam/realmonitor",
            "custom_source": source or "", "use_custom_source": False,
        }
        if not source or source.strip().isdigit():
            return result
        try:
            p = urllib.parse.urlparse(source)
            if p.scheme not in ("rtsp", "rtsps"):
                result["use_custom_source"] = True
                return result
            result["host"] = p.hostname or ""
            result["port"] = p.port or 554
            result["user"] = urllib.parse.unquote(p.username or "")
            result["password"] = urllib.parse.unquote(p.password or "")
            result["path"] = p.path or "/cam/realmonitor"
            qs = urllib.parse.parse_qs(p.query)
            result["channel"] = int(qs.get("channel", ["1"])[0])
            result["subtype"] = int(qs.get("subtype", ["0"])[0])
        except Exception:
            result["use_custom_source"] = True
        return result

    @staticmethod
    def _build_camera_source(payload: dict) -> str:
        if payload.get("use_custom_source"):
            return (payload.get("custom_source") or "").strip()
        host = (payload.get("host") or "").strip()
        if not host:
            return ""
        port = int(payload.get("port") or 554)
        user = (payload.get("user") or "").strip()
        password = payload.get("password") or ""
        channel = int(payload.get("channel") or 1)
        subtype = int(payload.get("subtype") or 0)
        path = (payload.get("path") or "/cam/realmonitor").strip()
        if not path.startswith("/"):
            path = f"/{path}"
        if user:
            creds = urllib.parse.quote(user, safe="")
            if password:
                creds += ":" + urllib.parse.quote(password, safe="")
            creds += "@"
        else:
            creds = ""
        return f"rtsp://{creds}{host}:{port}{path}?channel={channel}&subtype={subtype}"

    def get_camera_config(self) -> dict:
        src = self._get_source()
        cam = self._parse_camera_source(src)
        cam["password"] = ""  # never send password back
        cam["custom_source_masked"] = self.mask_source_for_display(cam.get("custom_source", ""))
        return {"camera": cam, "source_masked": self.mask_source_for_display(src)}

    def set_camera_config(self, payload: dict, persist: bool = True) -> dict:
        # If password is empty and we're updating, keep the old one
        if not payload.get("password"):
            old = self._parse_camera_source(self._get_source())
            payload = {**payload, "password": old.get("password", "")}
        new_src = self._build_camera_source(payload)
        update_dict = {}
        if self.sentido == "in":
            settings.camera_source_in = new_src
            update_dict["camera_source_in"] = new_src
        else:
            settings.camera_source_out = new_src
            update_dict["camera_source_out"] = new_src
        if persist:
            self._persist_config(update_dict, sentido=self.sentido)
        self.restart(new_src)
        return {"ok": True, "source_masked": self.mask_source_for_display(new_src)}

    def test_camera_config(self, payload: dict) -> dict:
        if not payload.get("password"):
            old = self._parse_camera_source(self._get_source())
            payload = {**payload, "password": old.get("password", "")}
        src = self._build_camera_source(payload)
        masked = self.mask_source_for_display(src)
        if not src:
            return {"ok": False, "message": "Sin fuente configurada", "source_masked": ""}
        try:
            cap_src = int(src) if src.isdigit() else src
            cap = safe_video_capture(cap_src, timeout_ms=4000)
            ok = cap.isOpened()
            if ok:
                ret, _ = cap.read()
                ok = ret
            cap.release()
            return {"ok": ok, "message": "Conexión OK" if ok else "Sin respuesta de la cámara", "source_masked": masked}
        except Exception as exc:
            return {"ok": False, "message": str(exc), "source_masked": masked}

    # ── ROI ───────────────────────────────────────────────────────────────────

    def get_roi(self) -> dict:
        return {
            "roi_enabled": self.roi_enabled,
            "roi_x": self.roi_x,
            "roi_y": self.roi_y,
            "roi_w": self.roi_w,
            "roi_h": self.roi_h,
        }

    def set_roi(self, payload: dict, persist: bool = True) -> dict:
        with self._lock:
            self.roi_enabled = bool(payload.get("roi_enabled", False))
            self.roi_x = float(payload.get("roi_x", 0.0))
            self.roi_y = float(payload.get("roi_y", 0.0))
            self.roi_w = max(0.05, float(payload.get("roi_w", 1.0)))
            self.roi_h = max(0.05, float(payload.get("roi_h", 1.0)))
        if persist:
            self._persist_config({
                "roi_enabled": self.roi_enabled,
                "roi_x": self.roi_x, "roi_y": self.roi_y,
                "roi_w": self.roi_w, "roi_h": self.roi_h,
            }, sentido=self.sentido)
        return self.get_roi()

    # ── Runtime config ────────────────────────────────────────────────────────

    def get_runtime_config(self) -> dict:
        return {
            "inference_every_n": self._inference_every_n,
            "filter_min_ocr_conf": self._min_ocr_conf,
            "filter_min_detector_conf": self._min_detector_conf,
            "dedup_window_sec": settings.dedup_window_sec,
            "ocr_device": settings.ocr_device,
            "auth_mode": settings.auth_mode,
            "auto_register": settings.auto_register,
            
            "qr_camera_source_in": settings.qr_camera_source_in,
            "qr_camera_source_out": settings.qr_camera_source_out,
            "qr_source_type_in": settings.qr_source_type_in,
            "qr_source_type_out": settings.qr_source_type_out,
            "qr_com_port_in": settings.qr_com_port_in,
            "qr_com_port_out": settings.qr_com_port_out,

            "snapshot_camera_source_in": settings.snapshot_camera_source_in,
            "snapshot_enabled_in": settings.snapshot_enabled_in,
            "snapshot_trigger_in": settings.snapshot_trigger_in,
            "snapshot_count_in": settings.snapshot_count_in,

            "snapshot_camera_source_out": settings.snapshot_camera_source_out,
            "snapshot_enabled_out": settings.snapshot_enabled_out,
            "snapshot_trigger_out": settings.snapshot_trigger_out,
            "snapshot_count_out": settings.snapshot_count_out,
            
            "camera_source_in": settings.camera_source_in,
            "camera_source_out": settings.camera_source_out,

            "plate_filter_enabled": settings.plate_filter_enabled,
            "plate_filter_countries": settings.plate_filter_countries,
            "evidence_retention_days": settings.evidence_retention_days,

            # === Barreras Individuales ===
            "barrier_type_in": settings.barrier_type_in,
            "barrier_port_in": settings.barrier_port_in,
            "barrier_baudrate_in": settings.barrier_baudrate_in,
            "barrier_ip_in": settings.barrier_ip_in,
            "barrier_ip_port_in": settings.barrier_ip_port_in,
            "barrier_ip_protocol_in": settings.barrier_ip_protocol_in,
            "barrier_ip_cmd_open_in": settings.barrier_ip_cmd_open_in,
            "barrier_ip_cmd_close_in": settings.barrier_ip_cmd_close_in,
            "barrier_max_open_sec_in": settings.barrier_max_open_sec_in,

            "barrier_type_out": settings.barrier_type_out,
            "barrier_port_out": settings.barrier_port_out,
            "barrier_baudrate_out": settings.barrier_baudrate_out,
            "barrier_ip_out": settings.barrier_ip_out,
            "barrier_ip_port_out": settings.barrier_ip_port_out,
            "barrier_ip_protocol_out": settings.barrier_ip_protocol_out,
            "barrier_ip_cmd_open_out": settings.barrier_ip_cmd_open_out,
            "barrier_ip_cmd_close_out": settings.barrier_ip_cmd_close_out,
            "vigilador_manual_trigger": settings.vigilador_manual_trigger,
            "propietario_auth_visits": settings.propietario_auth_visits,
            "barrier_auto_open_in": settings.barrier_auto_open_in,
            "barrier_auto_open_out": settings.barrier_auto_open_out,
            "hud_overlay_enabled_in": settings.hud_overlay_enabled_in,
            "hud_overlay_position_in": settings.hud_overlay_position_in,
            "hud_overlay_enabled_out": settings.hud_overlay_enabled_out,
            "hud_overlay_position_out": settings.hud_overlay_position_out,

            # === Detección de Movimiento ===
            "motion_detection_enabled_in": settings.motion_detection_enabled_in,
            "motion_threshold_in": settings.motion_threshold_in,
            "motion_cooldown_sec_in": settings.motion_cooldown_sec_in,
            "motion_detection_enabled_out": settings.motion_detection_enabled_out,
            "motion_threshold_out": settings.motion_threshold_out,
            "motion_cooldown_sec_out": settings.motion_cooldown_sec_out,
        }

    def set_runtime_config(self, payload: dict, persist: bool = True) -> dict:
        device_changed = False
        qr_changed = False
        barrier_changed = False
        with self._lock:
            if "inference_every_n" in payload:
                self._inference_every_n = max(1, int(payload["inference_every_n"]))
            if "filter_min_ocr_conf" in payload:
                self._min_ocr_conf = float(payload["filter_min_ocr_conf"])
            if "filter_min_detector_conf" in payload:
                self._min_detector_conf = float(payload["filter_min_detector_conf"])
            if "dedup_window_sec" in payload:
                settings.dedup_window_sec = max(0.0, float(payload["dedup_window_sec"]))
            if "ocr_device" in payload and payload["ocr_device"] != settings.ocr_device:
                settings.ocr_device = payload["ocr_device"]
                device_changed = True
            if "auth_mode" in payload:
                mode = str(payload["auth_mode"] or "").strip().lower()
                if mode in {"patente", "dni", "ambos", "combinado"}:
                    settings.auth_mode = mode
                    settings.require_dni_qr = mode == "ambos"
            if "auto_register" in payload:
                settings.auto_register = bool(payload["auto_register"])
            if "vigilador_manual_trigger" in payload:
                settings.vigilador_manual_trigger = bool(payload["vigilador_manual_trigger"])
            if "propietario_auth_visits" in payload:
                settings.propietario_auth_visits = bool(payload["propietario_auth_visits"])
            if "barrier_auto_open_in" in payload:
                settings.barrier_auto_open_in = bool(payload["barrier_auto_open_in"])
            if "barrier_auto_open_out" in payload:
                settings.barrier_auto_open_out = bool(payload["barrier_auto_open_out"])
            
            # DNI Cameras
            if "qr_camera_source_in" in payload:
                settings.qr_camera_source_in = str(payload["qr_camera_source_in"] or "").strip()
                qr_changed = True
            if "qr_camera_source_out" in payload:
                settings.qr_camera_source_out = str(payload["qr_camera_source_out"] or "").strip()
                qr_changed = True
            if "qr_source_type_in" in payload:
                settings.qr_source_type_in = str(payload["qr_source_type_in"] or "camera").strip()
                qr_changed = True
            if "qr_source_type_out" in payload:
                settings.qr_source_type_out = str(payload["qr_source_type_out"] or "camera").strip()
                qr_changed = True
            if "qr_com_port_in" in payload:
                settings.qr_com_port_in = str(payload["qr_com_port_in"] or "").strip()
                qr_changed = True
            if "qr_com_port_out" in payload:
                settings.qr_com_port_out = str(payload["qr_com_port_out"] or "").strip()
                qr_changed = True
            # Snapshot Cameras IN
            if "snapshot_camera_source_in" in payload:
                settings.snapshot_camera_source_in = str(payload["snapshot_camera_source_in"] or "").strip()
            if "snapshot_enabled_in" in payload:
                settings.snapshot_enabled_in = bool(payload["snapshot_enabled_in"])
            if "snapshot_trigger_in" in payload:
                settings.snapshot_trigger_in = str(payload["snapshot_trigger_in"] or "ambos")
            if "snapshot_count_in" in payload:
                settings.snapshot_count_in = int(payload["snapshot_count_in"] or 1)
                
            # Snapshot Cameras OUT
            if "snapshot_camera_source_out" in payload:
                settings.snapshot_camera_source_out = str(payload["snapshot_camera_source_out"] or "").strip()
            if "snapshot_enabled_out" in payload:
                settings.snapshot_enabled_out = bool(payload["snapshot_enabled_out"])
            if "snapshot_trigger_out" in payload:
                settings.snapshot_trigger_out = str(payload["snapshot_trigger_out"] or "ambos")
            if "snapshot_count_out" in payload:
                settings.snapshot_count_out = int(payload["snapshot_count_out"] or 1)

            # ALPR Cameras
            if "camera_source_in" in payload:
                settings.camera_source_in = str(payload["camera_source_in"] or "").strip()
            if "camera_source_out" in payload:
                settings.camera_source_out = str(payload["camera_source_out"] or "").strip()

            # Filtro de formato de patente
            if "plate_filter_enabled" in payload:
                settings.plate_filter_enabled = bool(payload["plate_filter_enabled"])
            if "plate_filter_countries" in payload:
                countries = payload["plate_filter_countries"]
                if isinstance(countries, list):
                    settings.plate_filter_countries = [str(c).upper() for c in countries]
            if "evidence_retention_days" in payload:
                settings.evidence_retention_days = max(1, int(payload["evidence_retention_days"]))

            # Barreras IN
            if "barrier_type_in" in payload:
                settings.barrier_type_in = str(payload["barrier_type_in"] or "simulated").strip()
                barrier_changed = True
            if "barrier_port_in" in payload:
                settings.barrier_port_in = str(payload["barrier_port_in"] or "").strip()
                barrier_changed = True
            if "barrier_baudrate_in" in payload:
                settings.barrier_baudrate_in = int(payload["barrier_baudrate_in"] or 9600)
                barrier_changed = True
            if "barrier_ip_in" in payload:
                settings.barrier_ip_in = str(payload["barrier_ip_in"] or "").strip()
                barrier_changed = True
            if "barrier_ip_port_in" in payload:
                settings.barrier_ip_port_in = int(payload["barrier_ip_port_in"] or 80)
                barrier_changed = True
            if "barrier_ip_protocol_in" in payload:
                settings.barrier_ip_protocol_in = str(payload["barrier_ip_protocol_in"] or "tcp").strip()
                barrier_changed = True
            if "barrier_ip_cmd_open_in" in payload:
                settings.barrier_ip_cmd_open_in = str(payload["barrier_ip_cmd_open_in"] or "").strip()
                barrier_changed = True
            if "barrier_ip_cmd_close_in" in payload:
                settings.barrier_ip_cmd_close_in = str(payload["barrier_ip_cmd_close_in"] or "").strip()
                barrier_changed = True
            if "barrier_max_open_sec_in" in payload:
                settings.barrier_max_open_sec_in = int(payload["barrier_max_open_sec_in"] or 0)
                barrier_changed = True

            # Barreras OUT
            if "barrier_type_out" in payload:
                settings.barrier_type_out = str(payload["barrier_type_out"] or "simulated").strip()
                barrier_changed = True
            if "barrier_port_out" in payload:
                settings.barrier_port_out = str(payload["barrier_port_out"] or "").strip()
                barrier_changed = True
            if "barrier_baudrate_out" in payload:
                settings.barrier_baudrate_out = int(payload["barrier_baudrate_out"] or 9600)
                barrier_changed = True
            if "barrier_ip_out" in payload:
                settings.barrier_ip_out = str(payload["barrier_ip_out"] or "").strip()
                barrier_changed = True
            if "barrier_ip_port_out" in payload:
                settings.barrier_ip_port_out = int(payload["barrier_ip_port_out"] or 80)
                barrier_changed = True
            if "barrier_ip_protocol_out" in payload:
                settings.barrier_ip_protocol_out = str(payload["barrier_ip_protocol_out"] or "tcp").strip()
                barrier_changed = True
            if "barrier_ip_cmd_open_out" in payload:
                settings.barrier_ip_cmd_open_out = str(payload["barrier_ip_cmd_open_out"] or "").strip()
                barrier_changed = True
            if "barrier_ip_cmd_close_out" in payload:
                settings.barrier_ip_cmd_close_out = str(payload["barrier_ip_cmd_close_out"] or "").strip()
                barrier_changed = True
            if "barrier_max_open_sec_out" in payload:
                settings.barrier_max_open_sec_out = int(payload["barrier_max_open_sec_out"] or 0)
                barrier_changed = True

            if "hud_overlay_enabled_in" in payload:
                settings.hud_overlay_enabled_in = bool(payload["hud_overlay_enabled_in"])
            if "hud_overlay_position_in" in payload:
                settings.hud_overlay_position_in = str(payload["hud_overlay_position_in"] or "bottom-left").strip()
            if "hud_overlay_enabled_out" in payload:
                settings.hud_overlay_enabled_out = bool(payload["hud_overlay_enabled_out"])
            if "hud_overlay_position_out" in payload:
                settings.hud_overlay_position_out = str(payload["hud_overlay_position_out"] or "bottom-right").strip()

            # Ahorro de CPU / Detección de Movimiento IN
            if "motion_detection_enabled_in" in payload:
                settings.motion_detection_enabled_in = bool(payload["motion_detection_enabled_in"])
                if self.sentido == "in":
                    self.motion_detection_enabled = settings.motion_detection_enabled_in
            if "motion_threshold_in" in payload:
                settings.motion_threshold_in = float(payload["motion_threshold_in"])
                if self.sentido == "in":
                    self.motion_threshold = settings.motion_threshold_in
            if "motion_cooldown_sec_in" in payload:
                settings.motion_cooldown_sec_in = float(payload["motion_cooldown_sec_in"])
                if self.sentido == "in":
                    self.motion_cooldown_sec = settings.motion_cooldown_sec_in

            # Ahorro de CPU / Detección de Movimiento OUT
            if "motion_detection_enabled_out" in payload:
                settings.motion_detection_enabled_out = bool(payload["motion_detection_enabled_out"])
                if self.sentido == "out":
                    self.motion_detection_enabled = settings.motion_detection_enabled_out
            if "motion_threshold_out" in payload:
                settings.motion_threshold_out = float(payload["motion_threshold_out"])
                if self.sentido == "out":
                    self.motion_threshold = settings.motion_threshold_out
            if "motion_cooldown_sec_out" in payload:
                settings.motion_cooldown_sec_out = float(payload["motion_cooldown_sec_out"])
                if self.sentido == "out":
                    self.motion_cooldown_sec = settings.motion_cooldown_sec_out

        if persist:
            self._persist_config({
                "inference_every_n": self._inference_every_n,
                "min_ocr_conf": self._min_ocr_conf,
                "min_detector_conf": self._min_detector_conf,
                "dedup_window_sec": settings.dedup_window_sec,
                "ocr_device": settings.ocr_device,
                "auth_mode": settings.auth_mode,
                "auto_register": settings.auto_register,
                
                "qr_camera_source_in": settings.qr_camera_source_in,
                "qr_camera_source_out": settings.qr_camera_source_out,
                "qr_source_type_in": settings.qr_source_type_in,
                "qr_source_type_out": settings.qr_source_type_out,
                "qr_com_port_in": settings.qr_com_port_in,
                "qr_com_port_out": settings.qr_com_port_out,
                
                "snapshot_camera_source_in": settings.snapshot_camera_source_in,
                "snapshot_enabled_in": settings.snapshot_enabled_in,
                "snapshot_trigger_in": settings.snapshot_trigger_in,
                "snapshot_count_in": settings.snapshot_count_in,
                
                "snapshot_camera_source_out": settings.snapshot_camera_source_out,
                "snapshot_enabled_out": settings.snapshot_enabled_out,
                "snapshot_trigger_out": settings.snapshot_trigger_out,
                "snapshot_count_out": settings.snapshot_count_out,
                
                "camera_source_in": settings.camera_source_in,
                "camera_source_out": settings.camera_source_out,

                "plate_filter_enabled": settings.plate_filter_enabled,
                "plate_filter_countries": settings.plate_filter_countries,
                "evidence_retention_days": settings.evidence_retention_days,

                "barrier_type_in": settings.barrier_type_in,
                "barrier_port_in": settings.barrier_port_in,
                "barrier_baudrate_in": settings.barrier_baudrate_in,
                "barrier_ip_in": settings.barrier_ip_in,
                "barrier_ip_port_in": settings.barrier_ip_port_in,
                "barrier_ip_protocol_in": settings.barrier_ip_protocol_in,
                "barrier_ip_cmd_open_in": settings.barrier_ip_cmd_open_in,
                "barrier_ip_cmd_close_in": settings.barrier_ip_cmd_close_in,
                "barrier_max_open_sec_in": settings.barrier_max_open_sec_in,

                "barrier_type_out": settings.barrier_type_out,
                "barrier_port_out": settings.barrier_port_out,
                "barrier_baudrate_out": settings.barrier_baudrate_out,
                "barrier_ip_out": settings.barrier_ip_out,
                "barrier_ip_port_out": settings.barrier_ip_port_out,
                "barrier_ip_protocol_out": settings.barrier_ip_protocol_out,
                "barrier_ip_cmd_open_out": settings.barrier_ip_cmd_open_out,
                "barrier_ip_cmd_close_out": settings.barrier_ip_cmd_close_out,
                "barrier_max_open_sec_out": settings.barrier_max_open_sec_out,
                "vigilador_manual_trigger": settings.vigilador_manual_trigger,
                "propietario_auth_visits": settings.propietario_auth_visits,
                "barrier_auto_open_in": settings.barrier_auto_open_in,
                "barrier_auto_open_out": settings.barrier_auto_open_out,
                "hud_overlay_enabled_in": settings.hud_overlay_enabled_in,
                "hud_overlay_position_in": settings.hud_overlay_position_in,
                "hud_overlay_enabled_out": settings.hud_overlay_enabled_out,
                "hud_overlay_position_out": settings.hud_overlay_position_out,

                # Motion detection
                "motion_detection_enabled_in": settings.motion_detection_enabled_in,
                "motion_threshold_in": settings.motion_threshold_in,
                "motion_cooldown_sec_in": settings.motion_cooldown_sec_in,
                "motion_detection_enabled_out": settings.motion_detection_enabled_out,
                "motion_threshold_out": settings.motion_threshold_out,
                "motion_cooldown_sec_out": settings.motion_cooldown_sec_out,
            }, sentido=self.sentido)
        if device_changed:
            self.reload_alpr(settings.ocr_device)
        if qr_changed:
            from .qr import get_qr
            get_qr("in").restart()
            get_qr("out").restart()
        if barrier_changed:
            from .relay import relay
            relay.reload()
        return self.get_runtime_config()

    def _capture_snapshot_frame(self) -> np.ndarray | None:
        src = ""
        if self.sentido == "in" and settings.snapshot_enabled_in:
            src = str(settings.snapshot_camera_source_in or "").strip()
            if not src:
                src = self._get_source()
        elif self.sentido == "out" and settings.snapshot_enabled_out:
            src = str(settings.snapshot_camera_source_out or "").strip()
            if not src:
                src = self._get_source()
            
        if not src:
            return None

        # Si la fuente de captura coincide con la de ALPR, reutilizar el último fotograma válido en memoria
        if src == self._get_source():
            with self._lock:
                if self._last_raw_frame is not None and (time.time() - self._last_frame_time < 5.0):
                    logger.info(f"[ALPR] Reutilizando ultimo fotograma en memoria para evidencia ({self.sentido})")
                    return self._last_raw_frame.copy()
            logger.warning(f"[ALPR] Sin fotograma fresco en memoria para evidencia ({self.sentido}) de la misma fuente.")
            return None
            
        logger.info(f"[ALPR] Capturando instantánea de evidencia ({self.sentido}) desde: {src}")
        cap_src = int(src) if src.isdigit() else src
        cap = safe_video_capture(cap_src, timeout_ms=2500)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        try:
            if not cap.isOpened():
                return None
            ok, frame = cap.read()
            if not ok or frame is None or frame.size == 0:
                return None
            return frame
        except Exception:
            return None
        finally:
            cap.release()

    def _capture_and_save_evidence_async(self, plate: str, sentido: str) -> None:
        """Captura e inserta/actualiza la foto de evidencia en segundo plano para no congelar el stream."""
        try:
            enabled = settings.snapshot_enabled_in if sentido == "in" else settings.snapshot_enabled_out
            trigger = settings.snapshot_trigger_in if sentido == "in" else settings.snapshot_trigger_out
            if not (enabled and trigger in {"patente", "ambos"}):
                return

            # Capturar fotograma de la cámara de evidencia
            shot = self._capture_snapshot_frame()
            if shot is None:
                return

            import cv2
            from ..database import SessionLocal
            from ..models import Deteccion, Acceso

            now = dt.datetime.now()
            ts = now.strftime("%Y%m%d_%H%M%S")
            subdir = now.strftime("%Y-%m-%d")
            
            # Directorio de evidencias
            evi_dir = Path(__file__).resolve().parent.parent.parent / "evidencia" / subdir
            evi_dir.mkdir(parents=True, exist_ok=True)
            
            filename = f"{ts}_{plate}_{sentido}_evidence.jpg"
            fpath = evi_dir / filename
            
            # Guardar en disco
            cv2.imwrite(str(fpath), shot, [cv2.IMWRITE_JPEG_QUALITY, 88])
            rel_path = f"evidencia/{subdir}/{filename}"
            
            # Esperar una fracción de segundo para asegurarnos de que los callbacks de inserción hayan terminado
            time.sleep(0.3)
            
            # Actualizar DB
            db = SessionLocal()
            try:
                # 1. Actualizar última Deteccion de esta patente/sentido de los últimos 10 segundos
                limite = now - dt.timedelta(seconds=10)
                det = db.query(Deteccion).filter(
                    Deteccion.patente == plate,
                    Deteccion.sentido == sentido,
                    Deteccion.fecha_hora >= limite
                ).order_by(Deteccion.id.desc()).first()
                if det:
                    det.foto_evidencia_path = rel_path
                    db.add(det)
                    
                # 2. Actualizar último Acceso de esta patente/sentido de los últimos 10 segundos
                acceso = db.query(Acceso).filter(
                    Acceso.patente == plate,
                    Acceso.sentido == sentido,
                    Acceso.fecha_hora >= limite
                ).order_by(Acceso.id.desc()).first()
                if acceso:
                    acceso.foto_evidencia_path = rel_path
                    db.add(acceso)
                    
                db.commit()
                logger.info(f"[ALPR] Evidencia en segundo plano guardada para {plate} ({sentido}) -> {rel_path}")
            finally:
                db.close()
                
        except Exception as exc:
            logger.error(f"[ALPR] Error en captura de evidencia en segundo plano: {exc}")

    def reload_alpr(self, device: str) -> None:
        """Re-initialize ALPR with a new device (cpu/cuda/auto)."""
        try:
            self.alpr = ALPR(
                detector_model=settings.detector_model,
                ocr_model=settings.ocr_model,
                ocr_device=device,
                detector_conf_thresh=self._min_detector_conf,
            )
            logger.info(f"[ALPR] Dispositivo cambiado a: {device}")
        except Exception as exc:
            logger.error(f"[ALPR] Error recargando modelo: {exc}")

    # ── Stats ─────────────────────────────────────────────────────────────────

    def stats_hourly(self) -> dict:
        """Hourly counts for today + daily counts for last 7 days from accesos DB, separated by sense (in/out)."""
        from ..database import SessionLocal
        from ..models import Acceso
        from sqlalchemy import func

        db = SessionLocal()
        try:
            today = dt.date.today()
            today_start = dt.datetime.combine(today, dt.time.min)
            today_end = dt.datetime.combine(today, dt.time.max)

            from sqlalchemy import extract, cast

            hourly_rows = (
                db.query(
                    extract('hour', Acceso.fecha_hora).label("hr"),
                    Acceso.sentido.label("sentido"),
                    func.count().label("cnt"),
                )
                .filter(Acceso.fecha_hora >= today_start, Acceso.fecha_hora <= today_end)
                .group_by(extract('hour', Acceso.fecha_hora), Acceso.sentido)
                .all()
            )
            
            in_map = {}
            out_map = {}
            for r in hourly_rows:
                hr = int(r.hr)
                if r.sentido == "in":
                    in_map[hr] = r.cnt
                else:
                    out_map[hr] = r.cnt
                    
            today_labels = [f"{h:02d}:00" for h in range(24)]
            today_in = [in_map.get(h, 0) for h in range(24)]
            today_out = [out_map.get(h, 0) for h in range(24)]
            today_counts = [today_in[i] + today_out[i] for i in range(24)]

            seven_days_ago = today - dt.timedelta(days=6)
            start_7 = dt.datetime.combine(seven_days_ago, dt.time.min)
            from sqlalchemy import Date
            daily_rows = (
                db.query(
                    cast(Acceso.fecha_hora, Date).label("day"),
                    Acceso.sentido.label("sentido"),
                    func.count().label("cnt"),
                )
                .filter(Acceso.fecha_hora >= start_7)
                .group_by(cast(Acceso.fecha_hora, Date), Acceso.sentido)
                .all()
            )
            
            in_day_map = {}
            out_day_map = {}
            for r in daily_rows:
                day_str = str(r.day)
                if r.sentido == "in":
                    in_day_map[day_str] = r.cnt
                else:
                    out_day_map[day_str] = r.cnt
                    
            day7_labels = [(seven_days_ago + dt.timedelta(days=i)).isoformat() for i in range(7)]
            day7_in = [in_day_map.get(d, 0) for d in day7_labels]
            day7_out = [out_day_map.get(d, 0) for d in day7_labels]
            day7_counts = [day7_in[i] + day7_out[i] for i in range(7)]

            total_db = db.query(func.count(Acceso.id)).scalar() or 0
        finally:
            db.close()

        return {
            "today": {
                "labels": today_labels,
                "counts": today_counts,
                "in": today_in,
                "out": today_out
            },
            "last7days": {
                "labels": day7_labels,
                "counts": day7_counts,
                "in": day7_in,
                "out": day7_out
            },
            "dedup_skipped": self.dedup_skipped,
            "date": today.isoformat(),
            "total_db": total_db,
        }

    # ── Persist helper ────────────────────────────────────────────────────────

    @staticmethod
    def _persist_config(updates: dict, sentido: str = "in") -> None:
        """Write updates to config.yaml if it exists next to this package."""
        import yaml
        cfg_path = Path(__file__).parent.parent.parent / "config.yaml"
        cfg = {}
        if cfg_path.exists():
            try:
                text = cfg_path.read_text(encoding="utf-8")
                cfg = yaml.safe_load(text) or {}
            except Exception:
                pass

        try:

            # Escribir solo en secciones estructuradas (video/modelo/sistema)
            # para evitar duplicación de claves en el YAML.

            video = cfg.setdefault("video", {}) if isinstance(cfg.get("video"), dict) or "video" not in cfg else cfg["video"]
            modelo = cfg.setdefault("modelo", {}) if isinstance(cfg.get("modelo"), dict) or "modelo" not in cfg else cfg["modelo"]
            sistema = cfg.setdefault("sistema", {}) if isinstance(cfg.get("sistema"), dict) or "sistema" not in cfg else cfg["sistema"]
            video_salida = cfg.setdefault("video_salida", {}) if isinstance(cfg.get("video_salida"), dict) or "video_salida" not in cfg else cfg["video_salida"]
            barreras = cfg.setdefault("barreras", {}) if isinstance(cfg.get("barreras"), dict) or "barreras" not in cfg else cfg["barreras"]

            # Determinar la sección de ROI según sentido
            roi_target = video_salida if sentido == "out" else video

            if "camera_source" in updates:
                video["fuente"] = updates["camera_source"]
            if "inference_every_n" in updates:
                video["frecuencia_inferencia"] = int(updates["inference_every_n"])
            if "roi_enabled" in updates:
                roi_target["roi_enabled"] = bool(updates["roi_enabled"])
            if "roi_x" in updates:
                roi_target["roi_x"] = float(updates["roi_x"])
            if "roi_y" in updates:
                roi_target["roi_y"] = float(updates["roi_y"])
            if "roi_w" in updates:
                roi_target["roi_w"] = float(updates["roi_w"])
            if "roi_h" in updates:
                roi_target["roi_h"] = float(updates["roi_h"])

            if "min_ocr_conf" in updates:
                modelo["confianza_avg_ocr"] = float(updates["min_ocr_conf"])
            if "min_detector_conf" in updates:
                modelo["confianza_detector"] = float(updates["min_detector_conf"])
            if "ocr_device" in updates:
                modelo["ocr_device"] = str(updates["ocr_device"])
            if "dedup_window_sec" in updates:
                sistema["dedup_window_sec"] = float(updates["dedup_window_sec"])
            if "auth_mode" in updates:
                sistema["auth_mode"] = str(updates["auth_mode"])
            if "auto_register" in updates:
                sistema["auto_register"] = bool(updates["auto_register"])
            if "vigilador_manual_trigger" in updates:
                sistema["vigilador_manual_trigger"] = bool(updates["vigilador_manual_trigger"])
            if "propietario_auth_visits" in updates:
                sistema["propietario_auth_visits"] = bool(updates["propietario_auth_visits"])
            if "barrier_auto_open_in" in updates:
                sistema["barrier_auto_open_in"] = bool(updates["barrier_auto_open_in"])
            if "barrier_auto_open_out" in updates:
                sistema["barrier_auto_open_out"] = bool(updates["barrier_auto_open_out"])
            if "qr_camera_source_in" in updates:
                sistema["qr_camera_source_in"] = str(updates["qr_camera_source_in"])
            if "qr_camera_source_out" in updates:
                sistema["qr_camera_source_out"] = str(updates["qr_camera_source_out"])
            if "qr_source_type_in" in updates:
                sistema["qr_source_type_in"] = str(updates["qr_source_type_in"])
            if "qr_source_type_out" in updates:
                sistema["qr_source_type_out"] = str(updates["qr_source_type_out"])
            if "qr_com_port_in" in updates:
                sistema["qr_com_port_in"] = str(updates["qr_com_port_in"])
            if "qr_com_port_out" in updates:
                sistema["qr_com_port_out"] = str(updates["qr_com_port_out"])
            if "snapshot_camera_source_in" in updates:
                sistema["snapshot_camera_source_in"] = str(updates["snapshot_camera_source_in"])
            if "snapshot_enabled_in" in updates:
                sistema["snapshot_enabled_in"] = bool(updates["snapshot_enabled_in"])
            if "snapshot_trigger_in" in updates:
                sistema["snapshot_trigger_in"] = str(updates["snapshot_trigger_in"])
            if "snapshot_count_in" in updates:
                sistema["snapshot_count_in"] = int(updates["snapshot_count_in"])

            if "snapshot_camera_source_out" in updates:
                sistema["snapshot_camera_source_out"] = str(updates["snapshot_camera_source_out"])
            if "snapshot_enabled_out" in updates:
                sistema["snapshot_enabled_out"] = bool(updates["snapshot_enabled_out"])
            if "snapshot_trigger_out" in updates:
                sistema["snapshot_trigger_out"] = str(updates["snapshot_trigger_out"])
            if "snapshot_count_out" in updates:
                sistema["snapshot_count_out"] = int(updates["snapshot_count_out"])

            if "camera_source_in" in updates:
                video["fuente_in"] = str(updates["camera_source_in"])
                video["fuente"] = str(updates["camera_source_in"])
            if "camera_source_out" in updates:
                video["fuente_out"] = str(updates["camera_source_out"])
                video_salida["fuente"] = str(updates["camera_source_out"])

            if "plate_filter_enabled" in updates:
                sistema["plate_filter_enabled"] = bool(updates["plate_filter_enabled"])
            if "plate_filter_countries" in updates:
                sistema["plate_filter_countries"] = updates["plate_filter_countries"]
            if "evidence_retention_days" in updates:
                sistema["evidence_retention_days"] = int(updates["evidence_retention_days"])

            # Barreras IN
            if "barrier_type_in" in updates:
                barreras["type_in"] = str(updates["barrier_type_in"])
            if "barrier_port_in" in updates:
                barreras["port_in"] = str(updates["barrier_port_in"])
            if "barrier_baudrate_in" in updates:
                barreras["baudrate_in"] = int(updates["barrier_baudrate_in"])
            if "barrier_ip_in" in updates:
                barreras["ip_in"] = str(updates["barrier_ip_in"])
            if "barrier_ip_port_in" in updates:
                barreras["ip_port_in"] = int(updates["barrier_ip_port_in"])
            if "barrier_ip_protocol_in" in updates:
                barreras["ip_protocol_in"] = str(updates["barrier_ip_protocol_in"])
            if "barrier_ip_cmd_open_in" in updates:
                barreras["ip_cmd_open_in"] = str(updates["barrier_ip_cmd_open_in"])
            if "barrier_ip_cmd_close_in" in updates:
                barreras["ip_cmd_close_in"] = str(updates["barrier_ip_cmd_close_in"])
            if "barrier_max_open_sec_in" in updates:
                barreras["max_open_sec_in"] = int(updates["barrier_max_open_sec_in"])

            # Barreras OUT
            if "barrier_type_out" in updates:
                barreras["type_out"] = str(updates["barrier_type_out"])
            if "barrier_port_out" in updates:
                barreras["port_out"] = str(updates["barrier_port_out"])
            if "barrier_baudrate_out" in updates:
                barreras["baudrate_out"] = int(updates["barrier_baudrate_out"])
            if "barrier_ip_out" in updates:
                barreras["ip_out"] = str(updates["barrier_ip_out"])
            if "barrier_ip_port_out" in updates:
                barreras["ip_port_out"] = int(updates["barrier_ip_port_out"])
            if "barrier_ip_protocol_out" in updates:
                barreras["ip_protocol_out"] = str(updates["barrier_ip_protocol_out"])
            if "barrier_ip_cmd_open_out" in updates:
                barreras["ip_cmd_open_out"] = str(updates["barrier_ip_cmd_open_out"])
            if "barrier_ip_cmd_close_out" in updates:
                barreras["ip_cmd_close_out"] = str(updates["barrier_ip_cmd_close_out"])
            if "barrier_max_open_sec_out" in updates:
                barreras["max_open_sec_out"] = int(updates["barrier_max_open_sec_out"])

            if "hud_overlay_enabled_in" in updates:
                video["hud_overlay_enabled"] = bool(updates["hud_overlay_enabled_in"])
            if "hud_overlay_position_in" in updates:
                video["hud_overlay_position"] = str(updates["hud_overlay_position_in"])
            if "hud_overlay_enabled_out" in updates:
                video_salida["hud_overlay_enabled"] = bool(updates["hud_overlay_enabled_out"])
            if "hud_overlay_position_out" in updates:
                video_salida["hud_overlay_position"] = str(updates["hud_overlay_position_out"])

            if "motion_detection_enabled_in" in updates:
                video["motion_detection_enabled"] = bool(updates["motion_detection_enabled_in"])
            if "motion_threshold_in" in updates:
                video["motion_threshold"] = float(updates["motion_threshold_in"])
            if "motion_cooldown_sec_in" in updates:
                video["motion_cooldown_sec"] = float(updates["motion_cooldown_sec_in"])

            if "motion_detection_enabled_out" in updates:
                video_salida["motion_detection_enabled"] = bool(updates["motion_detection_enabled_out"])
            if "motion_threshold_out" in updates:
                video_salida["motion_threshold"] = float(updates["motion_threshold_out"])
            if "motion_cooldown_sec_out" in updates:
                video_salida["motion_cooldown_sec"] = float(updates["motion_cooldown_sec_out"])

            cfg_path.write_text(yaml.dump(cfg, allow_unicode=True), encoding="utf-8")
        except Exception as exc:
            logger.warning(f"[ALPR] No se pudo persistir config: {exc}")


# Instancias ALPR (IN / OUT)
_alpr_instances: dict[str, ALPRService] = {}


def get_alpr(sentido: str = "in") -> ALPRService:
    global _alpr_instances
    if sentido not in _alpr_instances:
        _alpr_instances[sentido] = ALPRService(sentido=sentido)
    return _alpr_instances[sentido]

def get_all_alpr() -> dict[str, ALPRService]:
    return _alpr_instances
