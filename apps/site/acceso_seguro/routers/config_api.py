from __future__ import annotations
import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import get_current_operator, require_rol
from ..database import get_db
from ..models import Operador, Deteccion
from ..services.alpr import get_alpr, ALPRService
from ..config import settings

router = APIRouter(prefix="/api", tags=["config"])

# ── helper ────────────────────────────────────────────────────────────────────
# GET endpoints are visible to any logged-in user (except propietario).
# POST (write) endpoints require admin or supervisor.
from fastapi import HTTPException

def get_non_propietario(op: Operador = Depends(get_current_operator)):
    if op.rol == "propietario":
        raise HTTPException(status_code=403, detail="Sin permisos")
    return op

_any_user = Depends(get_non_propietario)
_supervisor = Depends(require_rol("admin", "supervisor"))


# ── /api/status (extended) ────────────────────────────────────────────────────
@router.get("/status")
def alpr_status(_op: Operador = _any_user):
    return {
        "in": get_alpr("in").status(),
        "out": get_alpr("out").status(),
    }


# ── /api/config — runtime performance settings ────────────────────────────────
@router.get("/config")
def get_config(sentido: str = "in", _op: Operador = _any_user):
    return get_alpr(sentido).get_runtime_config()


@router.post("/config")
def set_config(payload: dict, sentido: str = "in", _op: Operador = _supervisor):
    persist = bool(payload.pop("persist", False))

    # Guardar fuentes actuales para detectar si cambiaron
    old_src_in = settings.camera_source_in
    old_src_out = settings.camera_source_out

    # Aplicar config a ambas instancias (para que ambos tomen los umbrales globales)
    for s in ["in", "out"]:
        get_alpr(s).set_runtime_config(payload, persist=(persist and s == "in"))

    # Solo reiniciar si las fuentes de cámara cambiaron
    if settings.camera_source_in != old_src_in:
        get_alpr("in").restart(settings.camera_source_in)
    if settings.camera_source_out != old_src_out:
        get_alpr("out").restart(settings.camera_source_out)

    # Recargar el estado lógico del relay en caliente
    from ..services.relay import relay
    relay.reload()

    return {"ok": True}


# ── /api/camera-config ────────────────────────────────────────────────────────
@router.get("/camera-config")
def get_camera_config(sentido: str = "in", _op: Operador = _any_user):
    return get_alpr(sentido).get_camera_config()


@router.post("/camera-config")
def set_camera_config(payload: dict, sentido: str = "in", _op: Operador = _supervisor):
    persist = bool(payload.pop("persist", True))
    svc = get_alpr(sentido)
    was_running = svc.running
    res = svc.set_camera_config(payload, persist=persist)
    if was_running:
        svc.stop()
        import time
        time.sleep(0.1)
        svc.start()
    return res


# ── /api/camera-test ─────────────────────────────────────────────────────────
@router.post("/camera-test")
def test_camera(payload: dict, sentido: str = "in", _op: Operador = _supervisor):
    return get_alpr(sentido).test_camera_config(payload)


# ── /api/roi ─────────────────────────────────────────────────────────────────
@router.get("/roi")
def get_roi(sentido: str = "in", _op: Operador = _any_user):
    return get_alpr(sentido).get_roi()


@router.post("/roi")
def set_roi(payload: dict, sentido: str = "in", _op: Operador = _supervisor):
    persist = bool(payload.pop("persist", True))
    return get_alpr(sentido).set_roi(payload, persist=persist)


# ── /api/stats/hourly ─────────────────────────────────────────────────────────
@router.get("/stats/hourly")
def stats_hourly(sentido: str = "in", _op: Operador = _any_user):
    return get_alpr(sentido).stats_hourly()


# ── /api/stats ────────────────────────────────────────────────────────────────
@router.get("/stats")
def alpr_stats(sentido: str = "in", _op: Operador = _any_user):
    return get_alpr(sentido).stats()


# ── /api/start y /api/stop ─────────────────────────────────────────────────────
@router.post("/start")
def start_stream(sentido: str = "in", _op: Operador = _supervisor):
    svc = get_alpr(sentido)
    if svc.running:
        return {"ok": False, "msg": f"El stream {sentido} ya está corriendo"}
    svc.start()
    return {"ok": True, "msg": f"Stream {sentido} iniciado"}


@router.post("/stop")
def stop_stream(sentido: str = "in", _op: Operador = _supervisor):
    get_alpr(sentido).stop()
    return {"ok": True, "msg": f"Stream {sentido} detenido"}


# ── /api/detections ────────────────────────────────────────────────────────────
@router.get("/detections")
def get_detections(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str = Query(""),
    sentido: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _op: Operador = _any_user,
):
    query = db.query(Deteccion)
    if sentido:
        query = query.filter(Deteccion.sentido == sentido)
    if q:
        query = query.filter(Deteccion.patente.ilike(f"%{q}%"))
        
    query = query.order_by(Deteccion.fecha_hora.desc())
    total = query.count()
    rows = query.offset(offset).limit(limit).all()
    
    items = []
    for r in rows:
        thumb_path = f"/{r.thumb_path}" if r.thumb_path else ""
        foto_path = f"/{r.foto_path}" if r.foto_path else ""
        foto_evidencia_path = f"/{r.foto_evidencia_path}" if r.foto_evidencia_path else ""
        items.append({
            "id": r.id,
            "fecha": r.fecha_hora.isoformat() if r.fecha_hora else "",
            "sentido": r.sentido,
            "patente": r.patente,
            "ocr_conf": r.ocr_conf,
            "detector_conf": r.detector_conf,
            "region": r.region,
            "thumb_b64": thumb_path,
            "car_b64": foto_path,
            "foto_b64": foto_path,
            "foto_evidencia_b64": foto_evidencia_path,
            "autorizado": r.autorizado,
        })
    return {"total": total, "items": items}


@router.post("/detections/clear")
def clear_detections(db: Session = Depends(get_db), _op: Operador = _supervisor):
    get_alpr("in").clear_detections()
    get_alpr("out").clear_detections()
    db.query(Deteccion).delete()
    db.commit()
    return {"ok": True}


# ── /api/com-ports y /api/test-com-port ────────────────────────────────────────

@router.get("/com-ports")
def get_com_ports(_op: Operador = _supervisor):
    import serial.tools.list_ports
    ports = serial.tools.list_ports.comports()
    return [{"port": p.device, "desc": p.description} for p in ports]

@router.post("/test-com-port")
def test_com_port(payload: dict, _op: Operador = _supervisor):
    port = payload.get("port", "").strip()
    if not port:
        return {"ok": False, "msg": "Puerto vacío"}
    import serial
    import time
    try:
        ser = serial.Serial(port, baudrate=9600, timeout=0.5)
        start_t = time.time()
        buffer = ""
        while time.time() - start_t < 3.0:
            if ser.in_waiting > 0:
                buffer += ser.read(ser.in_waiting).decode(errors="ignore")
            time.sleep(0.05)
        ser.close()
        
        if buffer.strip():
            return {"ok": True, "msg": "Datos RAW leídos:\n" + buffer.strip()}
        else:
            return {"ok": True, "msg": "Conexión abierta OK, pero no se recibió nada (¿escaneaste un QR?)."}
    except Exception as exc:
        err_msg = str(exc)
        if "PermissionError" in err_msg or "Acceso denegado" in err_msg:
            return {"ok": False, "msg": f"El puerto {port} ya está en uso. ¡Esto suele ser una buena señal! Significa que el motor en segundo plano ya se adueñó del lector. Si quieres probar los datos crudos aquí, pon el Modo en 'Desactivado', Guarda, y vuelve a Probar."}
        return {"ok": False, "msg": f"Error abriendo puerto: {exc}"}


# ── /api/subsystems — panel granular de control ───────────────────────────────

@router.get("/subsystems")
def get_subsystems(_op: Operador = _any_user):
    """Estado de cada subsistema por sentido."""
    from ..services.qr import get_qr
    from ..services.relay import relay
    from ..config import settings

    def _qr_status(sentido: str) -> dict:
        qr = get_qr(sentido)
        return qr.status()

    def _alpr_status(sentido: str) -> dict:
        svc = get_alpr(sentido)
        return {
            "running": svc.running,
            "source": svc.mask_source_for_display(svc._get_source()) if svc._get_source() else "(no configurada)",
            "frame_id": svc.frame_id,
            "last_error": svc.last_error,
        }

    return {
        "alpr_in": _alpr_status("in"),
        "alpr_out": _alpr_status("out"),
        "qr_in": _qr_status("in"),
        "qr_out": _qr_status("out"),
        "relay": relay.status(),
        "auth_mode": settings.auth_mode,
        "snapshot_enabled_in": settings.snapshot_enabled_in,
        "snapshot_enabled_out": settings.snapshot_enabled_out,
    }


@router.post("/subsystems/toggle")
def toggle_subsystem(payload: dict, _op: Operador = _supervisor):
    """
    Activa o desactiva un subsistema individual.
    payload: { "subsystem": "alpr_in"|"alpr_out"|"qr_in"|"qr_out", "action": "start"|"stop" }
    """
    from ..services.qr import get_qr
    from ..config import settings
    import time as _time

    sub = payload.get("subsystem", "")
    action = payload.get("action", "")

    if sub == "alpr_in":
        svc = get_alpr("in")
        if action == "stop":
            svc.stop()
        else:
            svc.start()
        return {"ok": True, "msg": f"ALPR IN {'detenido' if action == 'stop' else 'iniciado'}"}

    elif sub == "alpr_out":
        svc = get_alpr("out")
        if action == "stop":
            svc.stop()
        else:
            svc.start()
        return {"ok": True, "msg": f"ALPR OUT {'detenido' if action == 'stop' else 'iniciado'}"}

    elif sub == "qr_in":
        qr = get_qr("in")
        if action == "stop":
            qr.stop()
        else:
            qr.restart()
        return {"ok": True, "msg": f"QR IN {'detenido' if action == 'stop' else 'reiniciado'}"}

    elif sub == "qr_out":
        qr = get_qr("out")
        if action == "stop":
            qr.stop()
        else:
            qr.restart()
        return {"ok": True, "msg": f"QR OUT {'detenido' if action == 'stop' else 'reiniciado'}"}

    elif sub == "snapshot_in":
        settings.snapshot_enabled_in = (action != "stop")
        ALPRService._persist_config({"snapshot_enabled_in": settings.snapshot_enabled_in}, sentido="in")
        return {"ok": True, "msg": f"Evidencia IN {'desactivada' if action == 'stop' else 'activada'}"}

    elif sub == "snapshot_out":
        settings.snapshot_enabled_out = (action != "stop")
        ALPRService._persist_config({"snapshot_enabled_out": settings.snapshot_enabled_out}, sentido="out")
        return {"ok": True, "msg": f"Evidencia OUT {'desactivada' if action == 'stop' else 'activada'}"}

    return {"ok": False, "msg": f"Subsistema desconocido: {sub}"}



@router.get("/detections/export.csv")
def export_detections_csv(db: Session = Depends(get_db), _op: Operador = _any_user):
    rows = db.query(Deteccion).order_by(Deteccion.fecha_hora.desc()).all()
    items = []
    for r in rows:
        items.append({
            "fecha": r.fecha_hora.isoformat() if r.fecha_hora else "",
            "patente": r.patente,
            "frame_id": r.id,
            "ocr_conf": r.ocr_conf,
            "detector_conf": r.detector_conf,
            "region": r.region,
        })
    output = io.StringIO()
    fields = ["fecha", "patente", "frame_id", "ocr_conf", "detector_conf", "region"]
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(items)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=detecciones.csv"},
    )


# ── Configuración de Evidencia y Purga Manual ─────────────────────────────────

@router.get("/config/evidence")
def get_evidence_config(_op: Operador = _any_user):
    return {"evidence_retention_days": settings.evidence_retention_days}


@router.post("/config/evidence")
def set_evidence_config(payload: dict, _op: Operador = _supervisor):
    days = payload.get("evidence_retention_days")
    if days is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Falta el campo 'evidence_retention_days'")
    try:
        days_int = int(days)
        if days_int < 1:
            raise ValueError()
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="El valor de días de retención debe ser un entero positivo mayor o igual a 1")

    settings.evidence_retention_days = days_int
    ALPRService._persist_config({"evidence_retention_days": days_int}, sentido="in")
    
    # También actualizar el runtime config de las instancias cargadas
    for s in ["in", "out"]:
        get_alpr(s).set_runtime_config({"evidence_retention_days": days_int}, persist=False)
        
    return {"ok": True, "evidence_retention_days": days_int}


@router.post("/evidencia/purge-manual")
def set_purge_manual(payload: dict, _op: Operador = _supervisor):
    desde_str = payload.get("desde")
    hasta_str = payload.get("hasta")
    if not desde_str or not hasta_str:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Faltan las fechas 'desde' o 'hasta'")
    try:
        import datetime as datetime_module
        desde_date = datetime_module.datetime.strptime(desde_str, "%Y-%m-%d").date()
        hasta_date = datetime_module.datetime.strptime(hasta_str, "%Y-%m-%d").date()
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Use YYYY-MM-DD")
        
    from ..services.detection_store import purge_manual
    res = purge_manual(desde_date, hasta_date, operador_id=_op.id, ip="127.0.0.1")
    return res


@router.post("/test-qr-camera")
def test_qr_camera(payload: dict, _op: Operador = _supervisor):
    return {"ok": False, "msg": "El modo de escaneo QR por cámara CCTV ha sido descontinuado por limitaciones ópticas de resolución."}


