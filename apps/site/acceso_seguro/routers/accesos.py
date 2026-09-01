from __future__ import annotations
import datetime as dt
from typing import Optional
import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Acceso, Operador
from ..auth import get_current_operator
from fastapi import HTTPException

router = APIRouter(prefix="/api/accesos", tags=["accesos"])


def check_not_propietario(op: Operador = Depends(get_current_operator)):
    if op.rol == "propietario":
        raise HTTPException(status_code=403, detail="Sin permisos")
    return op


def _to_dict(a: Acceso) -> dict:
    return {
        "id": a.id,
        "fecha_hora": a.fecha_hora.isoformat(timespec="seconds") if a.fecha_hora else "",
        "patente": a.patente,
        "dni": a.dni,
        "resultado": a.resultado,
        "motivo": a.motivo,
        "ocr_conf": a.ocr_conf,
        "detector_conf": a.detector_conf,
        "vehiculo": a.vehiculo_rel.descripcion if a.vehiculo_rel else None,
        "persona": (
            f"{a.operador_rel.username}" if a.operador_rel and a.resultado == "manual"
            else None
        ),
        "relay_abierto_en": a.relay_abierto_en.isoformat() if a.relay_abierto_en else None,
        "relay_cerrado_en": a.relay_cerrado_en.isoformat() if a.relay_cerrado_en else None,
        "foto_entrada_path": a.foto_entrada_path,
        "foto_salida_path": a.foto_salida_path,
        "foto_evidencia_path": a.foto_evidencia_path,
        "notas": a.notas,
    }


@router.get("/")
def list_accesos(
    patente: Optional[str] = None,
    resultado: Optional[str] = None,
    desde: Optional[str] = Query(default=None, description="ISO datetime"),
    hasta: Optional[str] = Query(default=None, description="ISO datetime"),
    limit: int = Query(default=200, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
    _op: Operador = Depends(check_not_propietario),
):
    q = db.query(Acceso)
    if patente:
        q = q.filter(Acceso.patente.ilike(f"%{patente.upper()}%"))
    if resultado:
        q = q.filter(Acceso.resultado == resultado)
    if desde:
        try:
            q = q.filter(Acceso.fecha_hora >= dt.datetime.fromisoformat(desde))
        except ValueError:
            pass
    if hasta:
        try:
            q = q.filter(Acceso.fecha_hora <= dt.datetime.fromisoformat(hasta))
        except ValueError:
            pass

    total = q.count()
    rows = q.order_by(Acceso.fecha_hora.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_to_dict(a) for a in rows]}


@router.get("/{aid}")
def get_acceso(aid: int, db: Session = Depends(get_db), _op = Depends(check_not_propietario)):
    a = db.get(Acceso, aid)
    if not a:
        from fastapi import HTTPException
        raise HTTPException(404)
    return _to_dict(a)


@router.get("/stats/hourly")
def stats_hourly(
    dias: int = Query(default=1, le=7, description="Dias atras (1-7)"),
    db: Session = Depends(get_db),
    _op: Operador = Depends(check_not_propietario),
):
    """Devuelve conteo de accesos por hora para los ultimos N dias."""
    desde = dt.datetime.now() - dt.timedelta(days=dias)
    rows = (
        db.query(Acceso.fecha_hora, Acceso.resultado)
        .filter(Acceso.fecha_hora >= desde)
        .all()
    )
    buckets: dict[str, dict[str, int]] = {}
    for fecha_hora, resultado in rows:
        hora_key = fecha_hora.strftime("%Y-%m-%d %H:00")
        if hora_key not in buckets:
            buckets[hora_key] = {"autorizado": 0, "denegado": 0}
        if resultado == "autorizado" or resultado == "manual":
            buckets[hora_key]["autorizado"] += 1
        elif resultado.startswith("denegado"):
            buckets[hora_key]["denegado"] += 1

    labels = sorted(buckets.keys())
    return {
        "labels": labels,
        "autorizado": [buckets[l]["autorizado"] for l in labels],
        "denegado": [buckets[l]["denegado"] for l in labels],
    }


@router.get("/stats/totales")
def stats_totales(
    db: Session = Depends(get_db),
    _op: Operador = Depends(check_not_propietario),
):
    """Contadores generales del dia de hoy."""
    hoy_inicio = dt.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    q = db.query(Acceso).filter(Acceso.fecha_hora >= hoy_inicio)
    total = q.count()
    autorizados = q.filter(
        (Acceso.resultado == "autorizado") | (Acceso.resultado == "manual")
    ).count()
    denegados = q.filter(Acceso.resultado.like("denegado%")).count()
    return {
        "hoy_total": total,
        "hoy_autorizado": autorizados,
        "hoy_denegado": denegados,
    }


# ── /api/accesos/detecciones ──────────────────────────────────────────────────
from ..models import Deteccion

@router.get("/detecciones")
def list_detecciones(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, le=200),
    sentido: Optional[str] = Query(default=None),
    patente: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _op: Operador = Depends(check_not_propietario),
):
    """Lista todas las detecciones ALPR desde la DB (paginado)."""
    q = db.query(Deteccion).order_by(Deteccion.fecha_hora.desc())
    if sentido:
        q = q.filter(Deteccion.sentido == sentido)
    if patente:
        q = q.filter(Deteccion.patente.ilike(f"%{patente}%"))
    total = q.count()
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
        "items": [
            {
                "id": d.id,
                "fecha_hora": d.fecha_hora.isoformat(timespec="seconds") if d.fecha_hora else "",
                "sentido": d.sentido,
                "patente": d.patente,
                "ocr_conf": d.ocr_conf,
                "detector_conf": d.detector_conf,
                "region": d.region,
                "foto_path": d.foto_path,
                "foto_evidencia_path": d.foto_evidencia_path,
                "thumb_path": d.thumb_path,
                "autorizado": d.autorizado,
            }
            for d in items
        ],
    }


@router.get("/detecciones/hourly")
def detecciones_hourly(
    dias: int = Query(default=1, le=7),
    db: Session = Depends(get_db),
    _op: Operador = Depends(check_not_propietario),
):
    """Conteo de detecciones por hora para gráfico del dashboard."""
    desde = dt.datetime.now() - dt.timedelta(days=dias)
    rows = (
        db.query(Deteccion.fecha_hora, Deteccion.sentido)
        .filter(Deteccion.fecha_hora >= desde)
        .all()
    )
    buckets: dict[str, dict[str, int]] = {}
    for fecha_hora, sentido in rows:
        hora_key = fecha_hora.strftime("%Y-%m-%d %H:00")
        if hora_key not in buckets:
            buckets[hora_key] = {"in": 0, "out": 0}
        if sentido in ("in", "out"):
            buckets[hora_key][sentido] += 1

    labels = sorted(buckets.keys())
    return {
        "labels": labels,
        "in": [buckets[l]["in"] for l in labels],
        "out": [buckets[l]["out"] for l in labels],
    }


@router.get("/export/csv")
def export_accesos_csv(
    patente: Optional[str] = None,
    resultado: Optional[str] = None,
    desde: Optional[str] = Query(default=None),
    hasta: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _op: Operador = Depends(check_not_propietario),
):
    q = db.query(Acceso)
    if patente:
        q = q.filter(Acceso.patente.ilike(f"%{patente.upper()}%"))
    if resultado:
        q = q.filter(Acceso.resultado == resultado)
    if desde:
        try:
            q = q.filter(Acceso.fecha_hora >= dt.datetime.fromisoformat(desde))
        except ValueError:
            pass
    if hasta:
        try:
            q = q.filter(Acceso.fecha_hora <= dt.datetime.fromisoformat(hasta))
        except ValueError:
            pass

    rows = q.order_by(Acceso.fecha_hora.desc()).all()
    
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    
    # Headers
    writer.writerow([
        "Fecha/Hora", "Patente", "DNI", "Resultado", "Motivo", 
        "Conf. OCR", "Conf. Det.", "Vehiculo", "Operador", 
        "Relay Abierto", "Relay Cerrado", "Notas"
    ])
    
    for a in rows:
        writer.writerow([
            a.fecha_hora.isoformat() if a.fecha_hora else "",
            a.patente or "",
            a.dni or "",
            a.resultado or "",
            a.motivo or "",
            a.ocr_conf or "",
            a.detector_conf or "",
            a.vehiculo_rel.descripcion if a.vehiculo_rel else "",
            a.operador_rel.username if a.operador_rel else "",
            a.relay_abierto_en.isoformat() if a.relay_abierto_en else "",
            a.relay_cerrado_en.isoformat() if a.relay_cerrado_en else "",
            a.notas or ""
        ])
        
    output.seek(0)
    
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=historial_accesos.csv"}
    )
