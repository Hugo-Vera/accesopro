"""
Módulo de base de datos exclusivo para PostgreSQL.
Se asume el uso de PostgreSQL vía psycopg2 para todas las transacciones de negocio.
Las migraciones automáticas se ejecutan a través de SQLAlchemy.
"""
from __future__ import annotations
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

engine = create_engine(settings.db_url, echo=settings.debug)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Crea tablas y siembra usuario admin por defecto si no existe."""
    from . import models  # noqa: importa todos los modelos para registrarlos
    Base.metadata.create_all(bind=engine)
    
    # Migraciones manuales para columnas nuevas (SQLAlchemy create_all no altera tablas existentes)
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE personas ADD COLUMN IF NOT EXISTS sexo VARCHAR(10)"))
            conn.execute(text("ALTER TABLE personas ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE"))
            conn.execute(text("ALTER TABLE personas ADD COLUMN IF NOT EXISTS tramite VARCHAR(50)"))
            conn.execute(text("ALTER TABLE detecciones ADD COLUMN IF NOT EXISTS foto_evidencia_path VARCHAR(500)"))
            conn.execute(text("ALTER TABLE accesos ADD COLUMN IF NOT EXISTS foto_evidencia_path VARCHAR(500)"))
            
            # Columnas de roles
            conn.execute(text("ALTER TABLE operadores ADD COLUMN IF NOT EXISTS lote VARCHAR(50)"))
            conn.execute(text("ALTER TABLE accesos ADD COLUMN IF NOT EXISTS lote VARCHAR(50)"))
            
            # Asegurar columnas del modelo AuditLog en la tabla audit_log si no existen
            conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS fecha TIMESTAMP WITHOUT TIME ZONE"))
            conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS tabla VARCHAR(50)"))
            conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS operacion VARCHAR(10)"))
            conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS fila_id INTEGER"))
            conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS datos TEXT"))
            conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS operador_id INTEGER"))
            conn.execute(text("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip VARCHAR(50)"))
            
            # Quitar restricción NOT NULL de columnas heredadas de audit_log
            try:
                conn.execute(text("ALTER TABLE audit_log ALTER COLUMN action DROP NOT NULL"))
            except Exception:
                pass
            
            # Crear indices compuestos en la tabla de accesos si no existen
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_accesos_fecha_patente ON accesos (fecha_hora, patente)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_accesos_fecha_dni ON accesos (fecha_hora, dni)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_accesos_lote ON accesos (lote)"))
            
            conn.commit()
        except Exception:
            pass
            
    _seed_operators()


def _seed_operators() -> None:
    from .models import Operador
    from .auth import hash_password
    db = SessionLocal()
    try:
        # admin (admin/admin)
        if db.query(Operador).filter(Operador.username == "admin").count() == 0:
            db.add(Operador(
                username="admin",
                password_hash=hash_password("admin"),
                rol="admin",
                activo=True,
            ))
        # vigilador (guard/guard)
        if db.query(Operador).filter(Operador.username == "guard").count() == 0:
            db.add(Operador(
                username="guard",
                password_hash=hash_password("guard"),
                rol="vigilador",
                activo=True,
            ))
        # propietario (owner101/owner101, lote 101)
        if db.query(Operador).filter(Operador.username == "owner101").count() == 0:
            db.add(Operador(
                username="owner101",
                password_hash=hash_password("owner101"),
                rol="propietario",
                lote="101",
                activo=True,
            ))
        db.commit()
    finally:
        db.close()
