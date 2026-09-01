from __future__ import annotations
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Operador
from ..auth import verify_password, create_token, get_current_operator, hash_password, require_rol

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/token")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    op = (
        db.query(Operador)
        .filter(Operador.username == form.username, Operador.activo.is_(True))
        .first()
    )
    if not op or not verify_password(form.password, op.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    op.ultimo_acceso = dt.datetime.now()
    db.commit()
    token = create_token({"sub": op.username, "rol": op.rol, "lote": op.lote})
    return {
        "access_token": token,
        "token_type": "bearer",
        "rol": op.rol,
        "username": op.username,
        "lote": op.lote,
    }


@router.get("/me")
def me(current: Operador = Depends(get_current_operator)):
    return {
        "id": current.id,
        "username": current.username,
        "rol": current.rol,
        "lote": current.lote,
        "ultimo_acceso": current.ultimo_acceso.isoformat() if current.ultimo_acceso else None,
    }


@router.get("/operadores")
def list_operadores(
    db: Session = Depends(get_db),
    _op: Operador = Depends(require_rol("admin")),
):
    ops = db.query(Operador).all()
    return [
        {"id": o.id, "username": o.username, "rol": o.rol, "lote": o.lote, "activo": o.activo}
        for o in ops
    ]


class _OpCreate:
    pass


from pydantic import BaseModel
from typing import Optional


class OperadorCreate(BaseModel):
    username: str
    password: str
    rol: str = "viewer"
    lote: Optional[str] = None


@router.post("/operadores")
def create_operador(
    data: OperadorCreate,
    db: Session = Depends(get_db),
    _op: Operador = Depends(require_rol("admin")),
):
    if db.query(Operador).filter(Operador.username == data.username).first():
        raise HTTPException(400, f"Usuario '{data.username}' ya existe")
    if data.rol not in ("admin", "supervisor", "viewer", "vigilador", "propietario"):
        raise HTTPException(400, "rol debe ser admin, supervisor, viewer, vigilador o propietario")
    if data.rol == "propietario" and not data.lote:
        raise HTTPException(400, "El rol propietario requiere especificar un lote")
    op = Operador(
        username=data.username,
        password_hash=hash_password(data.password),
        rol=data.rol,
        lote=data.lote,
        activo=True,
    )
    db.add(op)
    db.commit()
    db.refresh(op)
    return {"id": op.id, "username": op.username, "rol": op.rol, "lote": op.lote}


@router.delete("/operadores/{oid}")
def deactivate_operador(
    oid: int,
    db: Session = Depends(get_db),
    current: Operador = Depends(require_rol("admin")),
):
    if oid == current.id:
        raise HTTPException(400, "No puedes desactivar tu propio usuario")
    op = db.get(Operador, oid)
    if not op:
        raise HTTPException(404)
    op.activo = False
    db.commit()
    return {"ok": True}


class OperadorUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    rol: Optional[str] = None
    lote: Optional[str] = None
    activo: Optional[bool] = None


@router.put("/operadores/{oid}")
def update_operador(
    oid: int,
    data: OperadorUpdate,
    db: Session = Depends(get_db),
    current: Operador = Depends(require_rol("admin")),
):
    op = db.get(Operador, oid)
    if not op:
        raise HTTPException(404, "Operador no encontrado")
    if oid == current.id and data.activo is False:
        raise HTTPException(400, "No puedes desactivar tu propio usuario")
    
    if data.username is not None:
        exists = db.query(Operador).filter(Operador.username == data.username, Operador.id != oid).first()
        if exists:
            raise HTTPException(400, f"Usuario '{data.username}' ya existe")
        op.username = data.username
        
    if data.password is not None and data.password.strip() != "":
        op.password_hash = hash_password(data.password)
        
    if data.rol is not None:
        if data.rol not in ("admin", "supervisor", "viewer", "vigilador", "propietario"):
            raise HTTPException(400, "rol debe ser admin, supervisor, viewer, vigilador o propietario")
        op.rol = data.rol
        
    if data.lote is not None:
        op.lote = data.lote
        
    if op.rol == "propietario" and not op.lote:
        raise HTTPException(400, "El rol propietario requiere especificar un lote")
        
    if data.activo is not None:
        op.activo = data.activo
        
    db.commit()
    db.refresh(op)
    return {"id": op.id, "username": op.username, "rol": op.rol, "lote": op.lote, "activo": op.activo}
