"""Bridge HTTP: AccesoPro API → motor LAN (misma máquina)."""
from __future__ import annotations

import datetime as dt
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Operador, Persona, PreAutorizacion

router = APIRouter(prefix="/api/accesopro", tags=["accesopro"])

MARKER = "ACCESOPRO:"


def _bridge_key() -> str:
    return (os.environ.get("ACCESOPRO_BRIDGE_KEY") or "accesopro-bridge").strip()


def verify_bridge(x_accesopro_key: str | None = Header(default=None)) -> None:
    if not x_accesopro_key or x_accesopro_key.strip() != _bridge_key():
        raise HTTPException(401, "Bridge key inválida")


class PreAuthIn(BaseModel):
    accesopro_id: str
    lote: str
    patente: Optional[str] = None
    dni: Optional[str] = None
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    fecha_desde: str
    fecha_hasta: str
    activo: bool = True


class RevokeIn(BaseModel):
    accesopro_id: str


class ResidentIn(BaseModel):
    lote: str
    dni: str
    nombre: str
    categoria: str = "propietario"


def _parse_dt(raw: str) -> dt.datetime:
    try:
        return dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        cleaned = raw.strip().replace(" ", "T")[:19]
        return dt.datetime.strptime(cleaned, "%Y-%m-%dT%H:%M:%S")


def _operador_lote(db: Session, lote: str) -> Operador:
    op = (
        db.query(Operador)
        .filter(Operador.lote == lote, Operador.rol == "propietario", Operador.activo == True)
        .first()
    )
    if op:
        return op
    admin = db.query(Operador).filter(Operador.rol == "admin", Operador.activo == True).first()
    if not admin:
        raise HTTPException(500, "No hay operador admin en el motor")
    return admin


def _marker_id(apellido: str | None) -> str | None:
    if not apellido or not apellido.startswith(MARKER):
        return None
    return apellido[len(MARKER):]


@router.post("/pre-autorizaciones", dependencies=[Depends(verify_bridge)])
def sync_pre_autorizacion(data: PreAuthIn, db: Session = Depends(get_db)):
    op = _operador_lote(db, data.lote)
    marker = f"{MARKER}{data.accesopro_id}"
    existing = db.query(PreAutorizacion).filter(PreAutorizacion.apellido == marker).first()
    desde = _parse_dt(data.fecha_desde)
    hasta = _parse_dt(data.fecha_hasta)
    patente = data.patente.strip().upper() if data.patente else None
    dni = data.dni.strip() if data.dni else None
    if existing:
        existing.patente = patente
        existing.dni = dni
        existing.nombre = data.nombre
        existing.fecha_desde = desde
        existing.fecha_hasta = hasta
        existing.activo = data.activo
        existing.lote = data.lote
        db.commit()
        return {"ok": True, "id": existing.id, "updated": True}
    pa = PreAutorizacion(
        lote=data.lote,
        propietario_id=op.id,
        patente=patente,
        dni=dni,
        nombre=data.nombre,
        apellido=marker,
        fecha_desde=desde,
        fecha_hasta=hasta,
        activo=data.activo,
    )
    db.add(pa)
    db.commit()
    db.refresh(pa)
    return {"ok": True, "id": pa.id}


@router.post("/pre-autorizaciones/revoke", dependencies=[Depends(verify_bridge)])
def revoke_pre_autorizacion(data: RevokeIn, db: Session = Depends(get_db)):
    marker = f"{MARKER}{data.accesopro_id}"
    rows = db.query(PreAutorizacion).filter(PreAutorizacion.apellido == marker).all()
    for row in rows:
        row.activo = False
    db.commit()
    return {"ok": True, "revoked": len(rows)}


@router.post("/residentes", dependencies=[Depends(verify_bridge)])
def sync_residente(data: ResidentIn, db: Session = Depends(get_db)):
    dni = data.dni.strip()
    persona = db.query(Persona).filter(Persona.dni == dni).first()
    partes = data.nombre.strip().split(" ", 1)
    nombre = partes[0]
    apellido = partes[1] if len(partes) > 1 else ""
    notas = f"{data.categoria};lote:{data.lote}"
    if persona:
        persona.nombre = nombre
        persona.apellido = apellido
        persona.activo = True
        persona.notas = notas
    else:
        persona = Persona(dni=dni, nombre=nombre, apellido=apellido, activo=True, notas=notas)
        db.add(persona)
    db.commit()
    return {"ok": True, "dni": dni}
