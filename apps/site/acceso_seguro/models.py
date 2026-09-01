"""
Modelos de SQLAlchemy diseñados para PostgreSQL.
Define el esquema relacional de AccesoSeguro.
"""
from __future__ import annotations
import datetime as dt
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


# ─────────────────────────────────────────────
#  Vehiculos
# ─────────────────────────────────────────────
class Vehiculo(Base):
    __tablename__ = "vehiculos"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    patente: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    descripcion: Mapped[str | None] = mapped_column(Text)
    propietario: Mapped[str | None] = mapped_column(String(200))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    requiere_dni: Mapped[bool] = mapped_column(Boolean, default=True)  # False = solo patente
    estado: Mapped[str] = mapped_column(String(20), default="activo") # activo | bloqueado
    hora_desde: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    hora_hasta: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    notas: Mapped[str | None] = mapped_column(Text)
    fecha_alta: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.now)
    fecha_vencimiento: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)

    vinculos: Mapped[list[PersonaVehiculo]] = relationship(
        "PersonaVehiculo", back_populates="vehiculo", cascade="all, delete-orphan"
    )
    accesos: Mapped[list[Acceso]] = relationship(
        "Acceso", foreign_keys="Acceso.vehiculo_id", back_populates="vehiculo_rel"
    )


# ─────────────────────────────────────────────
#  Personas
# ─────────────────────────────────────────────
class Persona(Base):
    __tablename__ = "personas"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    dni: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    nombre: Mapped[str] = mapped_column(String(100))
    apellido: Mapped[str] = mapped_column(String(100))
    sexo: Mapped[str | None] = mapped_column(String(10))
    fecha_nacimiento: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    tramite: Mapped[str | None] = mapped_column(String(50), nullable=True)
    foto_path: Mapped[str | None] = mapped_column(String(500))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    estado: Mapped[str] = mapped_column(String(20), default="activo") # activo | bloqueado
    hora_desde: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    hora_hasta: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    notas: Mapped[str | None] = mapped_column(Text)
    fecha_alta: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.now)

    vinculos: Mapped[list[PersonaVehiculo]] = relationship(
        "PersonaVehiculo", back_populates="persona", cascade="all, delete-orphan"
    )


# ─────────────────────────────────────────────
#  Relacion M:N Persona <-> Vehiculo
# ─────────────────────────────────────────────
class PersonaVehiculo(Base):
    __tablename__ = "persona_vehiculo"

    persona_id: Mapped[int] = mapped_column(ForeignKey("personas.id"), primary_key=True)
    vehiculo_id: Mapped[int] = mapped_column(ForeignKey("vehiculos.id"), primary_key=True)
    puede_conducir: Mapped[bool] = mapped_column(Boolean, default=True)
    fecha_alta: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.now)

    persona: Mapped[Persona] = relationship("Persona", back_populates="vinculos")
    vehiculo: Mapped[Vehiculo] = relationship("Vehiculo", back_populates="vinculos")


# ─────────────────────────────────────────────
#  Operadores del sistema web
# ─────────────────────────────────────────────
class Operador(Base):
    __tablename__ = "operadores"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    rol: Mapped[str] = mapped_column(String(20), default="viewer")  # admin | supervisor | viewer
    lote: Mapped[str | None] = mapped_column(String(50), nullable=True)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    ultimo_acceso: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)

    accesos: Mapped[list[Acceso]] = relationship("Acceso", back_populates="operador_rel")


# ─────────────────────────────────────────────
#  Registro de accesos (INMUTABLE — solo INSERT)
# ─────────────────────────────────────────────
class Acceso(Base):
    __tablename__ = "accesos"
    __table_args__ = (
        Index("idx_accesos_fecha_patente", "fecha_hora", "patente"),
        Index("idx_accesos_fecha_dni", "fecha_hora", "dni"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    fecha_hora: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.now, index=True)
    sentido: Mapped[str] = mapped_column(String(10), default="in", index=True) # in | out
    patente: Mapped[str | None] = mapped_column(String(20), index=True)
    vehiculo_id: Mapped[int | None] = mapped_column(ForeignKey("vehiculos.id"), nullable=True)
    dni: Mapped[str | None] = mapped_column(String(20))
    persona_id: Mapped[int | None] = mapped_column(ForeignKey("personas.id"), nullable=True)
    # autorizado | denegado_patente | denegado_dni | denegado_ambos | timeout | manual
    resultado: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    motivo: Mapped[str | None] = mapped_column(Text)
    ocr_conf: Mapped[float | None] = mapped_column(Float)
    detector_conf: Mapped[float | None] = mapped_column(Float)
    foto_entrada_path: Mapped[str | None] = mapped_column(String(500))
    foto_salida_path: Mapped[str | None] = mapped_column(String(500))
    foto_evidencia_path: Mapped[str | None] = mapped_column(String(500))
    relay_abierto_en: Mapped[dt.datetime | None] = mapped_column(DateTime)
    relay_cerrado_en: Mapped[dt.datetime | None] = mapped_column(DateTime)
    operador_id: Mapped[int | None] = mapped_column(ForeignKey("operadores.id"), nullable=True)
    lote: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    notas: Mapped[str | None] = mapped_column(Text)

    vehiculo_rel: Mapped[Vehiculo | None] = relationship(
        "Vehiculo", foreign_keys=[vehiculo_id], back_populates="accesos"
    )
    operador_rel: Mapped[Operador | None] = relationship("Operador", back_populates="accesos")


# ─────────────────────────────────────────────
#  Estadías (Visitas)
# ─────────────────────────────────────────────
class Estadia(Base):
    __tablename__ = "estadias"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    vehiculo_id: Mapped[int | None] = mapped_column(ForeignKey("vehiculos.id"), nullable=True, index=True)
    persona_id: Mapped[int | None] = mapped_column(ForeignKey("personas.id"), nullable=True, index=True)
    acceso_in_id: Mapped[int] = mapped_column(ForeignKey("accesos.id"), nullable=False)
    acceso_out_id: Mapped[int | None] = mapped_column(ForeignKey("accesos.id"), nullable=True)
    fecha_ingreso: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.now, index=True)
    fecha_salida: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)

    vehiculo: Mapped[Vehiculo | None] = relationship("Vehiculo")
    persona: Mapped[Persona | None] = relationship("Persona")
    acceso_in: Mapped[Acceso] = relationship("Acceso", foreign_keys=[acceso_in_id])
    acceso_out: Mapped[Acceso | None] = relationship("Acceso", foreign_keys=[acceso_out_id])


# ─────────────────────────────────────────────
#  Audit log de cambios en la DB
# ─────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    fecha: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.now, index=True)
    tabla: Mapped[str] = mapped_column(String(50))
    operacion: Mapped[str] = mapped_column(String(10))  # CREATE | UPDATE | DELETE
    fila_id: Mapped[int | None] = mapped_column(Integer)
    datos: Mapped[str | None] = mapped_column(Text)      # JSON serializado
    operador_id: Mapped[int | None] = mapped_column(ForeignKey("operadores.id"), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(50))


# ─────────────────────────────────────────────
#  Detecciones ALPR (TODAS, autorizadas o no)
# ─────────────────────────────────────────────
class Deteccion(Base):
    __tablename__ = "detecciones"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    fecha_hora: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.now, index=True)
    sentido: Mapped[str] = mapped_column(String(10), default="in", index=True)  # in | out
    patente: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    ocr_conf: Mapped[float | None] = mapped_column(Float)
    detector_conf: Mapped[float | None] = mapped_column(Float)
    region: Mapped[str | None] = mapped_column(String(20))
    foto_path: Mapped[str | None] = mapped_column(String(500))     # foto evidencia (scene)
    foto_evidencia_path: Mapped[str | None] = mapped_column(String(500))
    thumb_path: Mapped[str | None] = mapped_column(String(500))    # recorte de patente
    autorizado: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # null=pendiente
    acceso_id: Mapped[int | None] = mapped_column(ForeignKey("accesos.id"), nullable=True)


# ─────────────────────────────────────────────
#  Pre-Autorizaciones de visitas por Propietario
# ─────────────────────────────────────────────
class PreAutorizacion(Base):
    __tablename__ = "pre_autorizaciones"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    lote: Mapped[str] = mapped_column(String(50), index=True)
    propietario_id: Mapped[int] = mapped_column(ForeignKey("operadores.id"), index=True)
    patente: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    dni: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    nombre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    apellido: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fecha_desde: Mapped[dt.datetime] = mapped_column(DateTime, nullable=False)
    fecha_hasta: Mapped[dt.datetime] = mapped_column(DateTime, nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    fecha_alta: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.now)

    propietario: Mapped[Operador] = relationship("Operador")
