from __future__ import annotations
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Operador, PreAutorizacion, Acceso
from ..auth import get_current_operator

router = APIRouter(prefix="/api/propietario", tags=["propietario"])


def require_propietario(current: Operador = Depends(get_current_operator)):
    if current.rol not in ("propietario", "admin"):
        raise HTTPException(status_code=403, detail="Acceso denegado: rol inválido")
    if current.rol == "propietario":
        from ..config import settings
        if not settings.propietario_auth_visits:
            raise HTTPException(status_code=403, detail="La creación de pre-autorizaciones para propietarios está desactivada")
        if not current.lote:
            raise HTTPException(status_code=400, detail="El propietario debe tener un lote asignado")
    return current


class PreAutorizacionIn(BaseModel):
    patente: Optional[str] = None
    dni: Optional[str] = None
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    fecha_desde: str
    fecha_hasta: str


def _parse_datetime(s: str) -> dt.datetime:
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            return dt.datetime.strptime(s.strip(), "%Y-%m-%d %H:%M")
        except ValueError:
            try:
                return dt.datetime.strptime(s.strip(), "%Y-%m-%d")
            except ValueError:
                raise HTTPException(400, f"Formato de fecha inválido: {s}")


@router.get("/autorizaciones")
def list_autorizaciones(
    db: Session = Depends(get_db),
    current: Operador = Depends(require_propietario),
):
    query = db.query(PreAutorizacion).filter(
        PreAutorizacion.propietario_id == current.id,
        PreAutorizacion.activo == True
    )
    rows = query.order_by(PreAutorizacion.fecha_alta.desc()).all()
    return [
        {
            "id": r.id,
            "lote": r.lote,
            "patente": r.patente,
            "dni": r.dni,
            "nombre": r.nombre,
            "apellido": r.apellido,
            "fecha_desde": r.fecha_desde.isoformat(),
            "fecha_hasta": r.fecha_hasta.isoformat(),
            "activo": r.activo,
            "fecha_alta": r.fecha_alta.isoformat(),
        }
        for r in rows
    ]


@router.post("/autorizaciones")
def create_autorizacion(
    data: PreAutorizacionIn,
    db: Session = Depends(get_db),
    current: Operador = Depends(require_propietario),
):
    patente_norm = data.patente.strip().upper() if data.patente else None
    dni_norm = data.dni.strip() if data.dni else None
    
    if not patente_norm and not dni_norm:
        raise HTTPException(400, "Debe especificar al menos una Patente o un DNI para autorizar")
        
    desde = _parse_datetime(data.fecha_desde)
    hasta = _parse_datetime(data.fecha_hasta)
    
    if hasta <= desde:
        raise HTTPException(400, "La fecha de fin debe ser posterior a la fecha de inicio")
        
    pa = PreAutorizacion(
        lote=current.lote,
        propietario_id=current.id,
        patente=patente_norm,
        dni=dni_norm,
        nombre=data.nombre.strip() if data.nombre else None,
        apellido=data.apellido.strip() if data.apellido else None,
        fecha_desde=desde,
        fecha_hasta=hasta,
        activo=True,
    )
    db.add(pa)
    db.commit()
    db.refresh(pa)
    return {
        "id": pa.id,
        "lote": pa.lote,
        "patente": pa.patente,
        "dni": pa.dni,
        "nombre": pa.nombre,
        "apellido": pa.apellido,
        "fecha_desde": pa.fecha_desde.isoformat(),
        "fecha_hasta": pa.fecha_hasta.isoformat(),
        "activo": pa.activo,
    }


@router.delete("/autorizaciones/{aid}")
def delete_autorizacion(
    aid: int,
    db: Session = Depends(get_db),
    current: Operador = Depends(require_propietario),
):
    pa = db.query(PreAutorizacion).filter(
        PreAutorizacion.id == aid,
        PreAutorizacion.propietario_id == current.id
    ).first()
    if not pa:
        raise HTTPException(404, "Pre-autorización no encontrada o no pertenece a su lote")
    pa.activo = False
    db.commit()
    return {"ok": True}


@router.get("/historial")
def get_historial(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current: Operador = Depends(require_propietario),
):
    query = db.query(Acceso).filter(Acceso.lote == current.lote)
    query = query.order_by(Acceso.fecha_hora.desc())
    total = query.count()
    rows = query.offset(offset).limit(limit).all()
    
    items = []
    for r in rows:
        foto_evidencia_path = f"/{r.foto_evidencia_path}" if r.foto_evidencia_path else ""
        items.append({
            "id": r.id,
            "fecha": r.fecha_hora.isoformat() if r.fecha_hora else "",
            "sentido": r.sentido,
            "patente": r.patente,
            "dni": r.dni,
            "resultado": r.resultado,
            "motivo": r.motivo,
            "foto_evidencia": foto_evidencia_path,
        })
    return {"total": total, "items": items}
