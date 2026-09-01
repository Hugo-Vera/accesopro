from __future__ import annotations
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Vehiculo, PersonaVehiculo, AuditLog, Operador
from ..auth import get_current_operator, require_rol

router = APIRouter(prefix="/api/vehiculos", tags=["vehiculos"])


# ── Schemas ────────────────────────────────────────────────────────────────

class VehiculoIn(BaseModel):
    patente: str
    descripcion: Optional[str] = None
    propietario: Optional[str] = None
    activo: bool = True
    requiere_dni: bool = True
    notas: Optional[str] = None
    fecha_vencimiento: Optional[str] = None  # ISO date YYYY-MM-DD
    hora_desde: Optional[str] = None  # HH:MM
    hora_hasta: Optional[str] = None  # HH:MM


def _to_dict(v: Vehiculo) -> dict:
    return {
        "id": v.id,
        "patente": v.patente,
        "descripcion": v.descripcion,
        "propietario": v.propietario,
        "activo": v.activo,
        "requiere_dni": v.requiere_dni,
        "notas": v.notas,
        "fecha_alta": v.fecha_alta.isoformat() if v.fecha_alta else "",
        "fecha_vencimiento": v.fecha_vencimiento.isoformat() if v.fecha_vencimiento else None,
        "hora_desde": v.hora_desde.strftime("%H:%M") if v.hora_desde else None,
        "hora_hasta": v.hora_hasta.strftime("%H:%M") if v.hora_hasta else None,
        "personas": [
            {
                "id": pv.persona.id,
                "nombre": f"{pv.persona.nombre} {pv.persona.apellido}",
                "dni": pv.persona.dni,
                "puede_conducir": pv.puede_conducir,
            }
            for pv in v.vinculos
            if pv.persona
        ],
    }


def _parse_fecha(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, f"Fecha invalida: {s} — usar formato YYYY-MM-DD")


def _parse_time(s: str | None) -> dt.time | None:
    if not s:
        return None
    try:
        return dt.time.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, f"Hora invalida: {s} — usar formato HH:MM")


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/")
def list_vehiculos(
    activo: Optional[bool] = None,
    q: Optional[str] = Query(default=None, description="Filtro patente o propietario"),
    db: Session = Depends(get_db),
    _op: Operador = Depends(get_current_operator),
):
    if _op.rol == "propietario":
        raise HTTPException(status_code=403, detail="Sin permisos")
    query = db.query(Vehiculo)
    if activo is not None:
        query = query.filter(Vehiculo.activo.is_(activo))
    if q:
        like = f"%{q.upper()}%"
        query = query.filter(
            (Vehiculo.patente.like(like)) | (Vehiculo.propietario.ilike(f"%{q}%"))
        )
    return [_to_dict(v) for v in query.order_by(Vehiculo.patente).all()]


@router.get("/{vid}")
def get_vehiculo(vid: int, db: Session = Depends(get_db), _op = Depends(get_current_operator)):
    v = db.get(Vehiculo, vid)
    if not v:
        raise HTTPException(404, "Vehiculo no encontrado")
    return _to_dict(v)


@router.post("/", status_code=201)
def create_vehiculo(
    data: VehiculoIn,
    db: Session = Depends(get_db),
    op: Operador = Depends(require_rol("admin", "supervisor")),
):
    patente_norm = data.patente.strip().upper()
    if db.query(Vehiculo).filter(Vehiculo.patente == patente_norm).first():
        raise HTTPException(400, f"La patente {patente_norm} ya esta registrada")
    v = Vehiculo(
        patente=patente_norm,
        descripcion=data.descripcion,
        propietario=data.propietario,
        activo=data.activo,
        requiere_dni=data.requiere_dni,
        notas=data.notas,
        fecha_vencimiento=_parse_fecha(data.fecha_vencimiento),
        hora_desde=_parse_time(data.hora_desde),
        hora_hasta=_parse_time(data.hora_hasta),
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    _write_audit(db, "vehiculos", "CREATE", v.id, op.id)
    return _to_dict(v)


@router.put("/{vid}")
def update_vehiculo(
    vid: int,
    data: VehiculoIn,
    db: Session = Depends(get_db),
    op: Operador = Depends(require_rol("admin", "supervisor")),
):
    v = db.get(Vehiculo, vid)
    if not v:
        raise HTTPException(404)
    # Validar que la nueva patente no choque con otro registro
    patente_norm = data.patente.strip().upper()
    dup = db.query(Vehiculo).filter(Vehiculo.patente == patente_norm, Vehiculo.id != vid).first()
    if dup:
        raise HTTPException(400, f"La patente {patente_norm} ya pertenece a otro vehiculo")
    v.patente = patente_norm
    v.descripcion = data.descripcion
    v.propietario = data.propietario
    v.activo = data.activo
    v.requiere_dni = data.requiere_dni
    v.notas = data.notas
    v.fecha_vencimiento = _parse_fecha(data.fecha_vencimiento)
    v.hora_desde = _parse_time(data.hora_desde)
    v.hora_hasta = _parse_time(data.hora_hasta)
    db.commit()
    _write_audit(db, "vehiculos", "UPDATE", v.id, op.id)
    return _to_dict(v)


@router.delete("/{vid}")
def delete_vehiculo(
    vid: int,
    db: Session = Depends(get_db),
    op: Operador = Depends(require_rol("admin")),
):
    v = db.get(Vehiculo, vid)
    if not v:
        raise HTTPException(404)
    v.activo = False  # soft delete
    db.commit()
    _write_audit(db, "vehiculos", "DELETE", v.id, op.id)
    return {"ok": True}


# ── Vinculacion persona ↔ vehiculo ─────────────────────────────────────────

class VinculoIn(BaseModel):
    puede_conducir: bool = True


@router.post("/{vid}/persona/{pid}")
def vincular_persona(
    vid: int,
    pid: int,
    data: VinculoIn = VinculoIn(),
    db: Session = Depends(get_db),
    op = Depends(require_rol("admin", "supervisor")),
):
    from ..models import Persona
    if not db.get(Vehiculo, vid):
        raise HTTPException(404, "Vehiculo no encontrado")
    if not db.get(Persona, pid):
        raise HTTPException(404, "Persona no encontrada")
    vinculo = db.query(PersonaVehiculo).filter_by(vehiculo_id=vid, persona_id=pid).first()
    if vinculo:
        vinculo.puede_conducir = data.puede_conducir
    else:
        vinculo = PersonaVehiculo(vehiculo_id=vid, persona_id=pid, puede_conducir=data.puede_conducir)
        db.add(vinculo)
    db.commit()
    return {"ok": True}


@router.delete("/{vid}/persona/{pid}")
def desvincular_persona(
    vid: int,
    pid: int,
    db: Session = Depends(get_db),
    _op = Depends(require_rol("admin", "supervisor")),
):
    vinculo = db.query(PersonaVehiculo).filter_by(vehiculo_id=vid, persona_id=pid).first()
    if vinculo:
        db.delete(vinculo)
        db.commit()
    return {"ok": True}


# ── Helpers ────────────────────────────────────────────────────────────────

def _write_audit(db: Session, tabla: str, op: str, fila_id: int, operador_id: int) -> None:
    db.add(AuditLog(tabla=tabla, operacion=op, fila_id=fila_id, operador_id=operador_id))
    db.commit()
