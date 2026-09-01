from __future__ import annotations
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Persona, PersonaVehiculo, AuditLog, Operador
from ..auth import get_current_operator, require_rol

router = APIRouter(prefix="/api/personas", tags=["personas"])


# ── Schemas ─────────────────────
class PersonaIn(BaseModel):
    dni: str
    nombre: str
    apellido: str
    sexo: Optional[str] = None
    fecha_nacimiento: Optional[str] = None  # YYYY-MM-DD
    tramite: Optional[str] = None
    hora_desde: Optional[str] = None  # HH:MM
    hora_hasta: Optional[str] = None  # HH:MM
    activo: bool = True
    notas: Optional[str] = None
    foto_path: Optional[str] = None
    patentes: Optional[str] = None  # Comma-separated list of plates


def _to_dict(p: Persona) -> dict:
    plates = [pv.vehiculo.patente for pv in p.vinculos if pv.vehiculo]
    return {
        "id": p.id,
        "dni": p.dni,
        "nombre": p.nombre,
        "apellido": p.apellido,
        "sexo": p.sexo,
        "fecha_nacimiento": p.fecha_nacimiento.isoformat() if p.fecha_nacimiento else None,
        "tramite": p.tramite,
        "hora_desde": p.hora_desde.strftime("%H:%M") if p.hora_desde else None,
        "hora_hasta": p.hora_hasta.strftime("%H:%M") if p.hora_hasta else None,
        "activo": p.activo,
        "notas": p.notas,
        "foto_path": p.foto_path,
        "fecha_alta": p.fecha_alta.isoformat() if p.fecha_alta else "",
        "patentes": ", ".join(plates),
        "vehiculos": [
            {
                "id": pv.vehiculo.id,
                "patente": pv.vehiculo.patente,
                "descripcion": pv.vehiculo.descripcion,
                "puede_conducir": pv.puede_conducir,
            }
            for pv in p.vinculos
            if pv.vehiculo
        ],
    }


def _parse_time(s: str | None) -> dt.time | None:
    if not s:
        return None
    try:
        return dt.time.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, f"Hora invalida: {s} — usar formato HH:MM")


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/")
def list_personas(
    activo: Optional[bool] = None,
    q: Optional[str] = Query(default=None, description="Filtro nombre, apellido o DNI"),
    db: Session = Depends(get_db),
    _op: Operador = Depends(get_current_operator),
):
    if _op.rol == "propietario":
        raise HTTPException(status_code=403, detail="Sin permisos")
    query = db.query(Persona)
    if activo is not None:
        query = query.filter(Persona.activo.is_(activo))
    if q:
        like = f"%{q}%"
        query = query.filter(
            Persona.nombre.ilike(like)
            | Persona.apellido.ilike(like)
            | Persona.dni.like(like)
        )
    return [_to_dict(p) for p in query.order_by(Persona.apellido).all()]


@router.get("/latest-dni")
def get_latest_dni(
    _op: Operador = Depends(get_current_operator),
):
    """Retorna el último DNI leído por el lector QR o COM recently."""
    import time
    from ..services.access import access_controller
    dni_data = access_controller._pending_dni
    if dni_data and (time.time() - access_controller._dni_ts) < 60:  # Valid for 60 seconds
        return {
            "ok": True,
            "dni": dni_data.dni,
            "nombre": dni_data.nombre,
            "apellido": dni_data.apellido,
            "sexo": dni_data.sexo,
            "nacimiento": dni_data.nacimiento,
            "tramite": dni_data.tramite or "",
        }
    return {"ok": False, "message": "No se leyó ningún DNI recientemente (último minuto)"}


@router.post("/photo")
def upload_photo(
    file: UploadFile = File(...),
    _op: Operador = Depends(require_rol("admin", "supervisor")),
):
    """Sube y almacena una foto de perfil de una persona con nombre único."""
    import uuid
    import shutil
    from pathlib import Path
    
    router_dir = Path(__file__).parent
    upload_dir = router_dir.parent / "static" / "uploads" / "profile_photos"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    ext = Path(file.filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png"}:
        raise HTTPException(400, "Formato de imagen inválido. Usar JPG o PNG.")
        
    filename = f"{uuid.uuid4()}{ext}"
    dest_path = upload_dir / filename
    
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"ok": True, "url": f"/static/uploads/profile_photos/{filename}"}


@router.get("/{pid}")
def get_persona(pid: int, db: Session = Depends(get_db), _op = Depends(get_current_operator)):
    p = db.get(Persona, pid)
    if not p:
        raise HTTPException(404, "Persona no encontrada")
    return _to_dict(p)


@router.post("/", status_code=201)
def create_persona(
    data: PersonaIn,
    db: Session = Depends(get_db),
    op: Operador = Depends(require_rol("admin", "supervisor")),
):
    dni_norm = data.dni.strip()
    if db.query(Persona).filter(Persona.dni == dni_norm).first():
        raise HTTPException(400, f"DNI {dni_norm} ya esta registrado")
    p = Persona(
        dni=dni_norm,
        nombre=data.nombre.strip(),
        apellido=data.apellido.strip(),
        sexo=data.sexo,
        fecha_nacimiento=dt.date.fromisoformat(data.fecha_nacimiento) if data.fecha_nacimiento else None,
        tramite=data.tramite,
        hora_desde=_parse_time(data.hora_desde),
        hora_hasta=_parse_time(data.hora_hasta),
        activo=data.activo,
        notas=data.notas,
        foto_path=data.foto_path,
    )
    db.add(p)
    db.flush()  # Para tener p.id disponible para los vínculos de patentes
    
    # Procesar patentes
    _sync_persona_patentes(db, p, data.patentes)
    
    db.commit()
    db.refresh(p)
    _write_audit(db, "personas", "CREATE", p.id, op.id)
    return _to_dict(p)


@router.put("/{pid}")
def update_persona(
    pid: int,
    data: PersonaIn,
    db: Session = Depends(get_db),
    op: Operador = Depends(require_rol("admin", "supervisor")),
):
    p = db.get(Persona, pid)
    if not p:
        raise HTTPException(404)
    dni_norm = data.dni.strip()
    dup = db.query(Persona).filter(Persona.dni == dni_norm, Persona.id != pid).first()
    if dup:
        raise HTTPException(400, f"DNI {dni_norm} ya pertenece a otra persona")
    p.dni = dni_norm
    p.nombre = data.nombre.strip()
    p.apellido = data.apellido.strip()
    p.sexo = data.sexo
    p.fecha_nacimiento = dt.date.fromisoformat(data.fecha_nacimiento) if data.fecha_nacimiento else None
    p.tramite = data.tramite
    p.hora_desde = _parse_time(data.hora_desde)
    p.hora_hasta = _parse_time(data.hora_hasta)
    p.activo = data.activo
    p.notas = data.notas
    p.foto_path = data.foto_path
    
    # Procesar patentes
    _sync_persona_patentes(db, p, data.patentes)
    
    db.commit()
    _write_audit(db, "personas", "UPDATE", p.id, op.id)
    return _to_dict(p)


@router.delete("/{pid}")
def delete_persona(
    pid: int,
    db: Session = Depends(get_db),
    op: Operador = Depends(require_rol("admin")),
):
    p = db.get(Persona, pid)
    if not p:
        raise HTTPException(404)
    p.activo = False
    db.commit()
    _write_audit(db, "personas", "DELETE", p.id, op.id)
    return {"ok": True}


def _sync_persona_patentes(db: Session, p: Persona, patentes_str: str | None) -> None:
    from ..models import Vehiculo, PersonaVehiculo
    if patentes_str is None:
        return
        
    plates = [plt.strip().upper() for plt in patentes_str.split(",") if plt.strip()]
    existing_vehicles = {v.patente: v for v in db.query(Vehiculo).filter(Vehiculo.patente.in_(plates)).all()}
    
    # Crear vehículos inexistentes
    for plate in plates:
        if plate not in existing_vehicles:
            new_v = Vehiculo(
                patente=plate,
                descripcion=f"Vinculado a {p.apellido}, {p.nombre}",
                propietario=f"{p.apellido}, {p.nombre}",
                activo=True,
                requiere_dni=True
            )
            db.add(new_v)
            db.flush()
            existing_vehicles[plate] = new_v
            
    # Eliminar vínculos viejos
    target_veh_ids = {v.id for v in existing_vehicles.values()}
    db.query(PersonaVehiculo).filter(
        PersonaVehiculo.persona_id == p.id,
        ~PersonaVehiculo.vehiculo_id.in_(target_veh_ids)
    ).delete(synchronize_session=False)
    
    # Crear nuevos vínculos
    existing_vinculos = {pv.vehiculo_id for pv in p.vinculos}
    for v in existing_vehicles.values():
        if v.id not in existing_vinculos:
            db.add(PersonaVehiculo(
                persona_id=p.id,
                vehiculo_id=v.id,
                puede_conducir=True
            ))


def _write_audit(db: Session, tabla: str, op: str, fila_id: int, operador_id: int) -> None:
    db.add(AuditLog(tabla=tabla, operacion=op, fila_id=fila_id, operador_id=operador_id))
    db.commit()
