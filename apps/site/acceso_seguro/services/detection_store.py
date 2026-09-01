"""
Servicio para guardar TODAS las detecciones ALPR a disco y DB.
Guarda fotos de evidencia y recortes de patente en /evidencia/
"""
from __future__ import annotations

import base64
import datetime as dt
import gc
import logging
import os
import shutil
import threading
import time
from pathlib import Path

from ..database import SessionLocal
from ..models import Deteccion, AuditLog
from ..config import settings

logger = logging.getLogger(__name__)

# Directorio de evidencias
EVIDENCIA_DIR = Path(__file__).resolve().parent.parent.parent / "evidencia"
EVIDENCIA_DIR.mkdir(exist_ok=True)


def _save_b64_image(b64_data: str, subdir: str, filename: str) -> str | None:
    """Decodifica base64 y guarda como JPEG. Retorna ruta relativa."""
    if not b64_data:
        return None
    try:
        # Quitar header data:image/jpeg;base64,
        if "," in b64_data:
            b64_data = b64_data.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_data)
        
        dest_dir = EVIDENCIA_DIR / subdir
        dest_dir.mkdir(parents=True, exist_ok=True)
        
        fpath = dest_dir / filename
        fpath.write_bytes(img_bytes)
        return f"evidencia/{subdir}/{filename}"
    except Exception as exc:
        logger.warning(f"[STORE] Error guardando imagen: {exc}")
        return None


def save_detection(det_data: dict) -> None:
    """Guarda una detección ALPR completa (foto + DB). Thread-safe."""
    threading.Thread(target=_save_detection_sync, args=(det_data,), daemon=True).start()


def _save_detection_sync(det_data: dict) -> None:
    """Guarda sincrónicamente (se ejecuta en hilo separado)."""
    try:
        now = dt.datetime.now()
        sentido = det_data.get("sentido", "in")
        patente = det_data.get("patente", "UNKNOWN")
        ts = now.strftime("%Y%m%d_%H%M%S")
        subdir = now.strftime("%d-%m-%Y")
        
        # Guardar foto de evidencia (escena completa de la cámara principal)
        foto_path = _save_b64_image(
            det_data.get("foto_b64", ""),
            subdir,
            f"{ts}_{patente}_{sentido}_scene.jpg"
        )
        
        # Guardar recorte de patente (thumbnail)
        thumb_path = _save_b64_image(
            det_data.get("thumb_b64", ""),
            subdir,
            f"{ts}_{patente}_{sentido}_plate.jpg"
        )

        # Guardar foto de evidencia extra (segunda cámara)
        foto_evidencia_path = _save_b64_image(
            det_data.get("foto_evidencia_b64", ""),
            subdir,
            f"{ts}_{patente}_{sentido}_evidence.jpg"
        )
        
        # Guardar en DB
        db = SessionLocal()
        try:
            det = Deteccion(
                fecha_hora=now,
                sentido=sentido,
                patente=patente,
                ocr_conf=float(det_data.get("ocr_conf") or 0),
                detector_conf=float(det_data.get("detector_conf") or 0),
                region=det_data.get("region", ""),
                foto_path=foto_path,
                thumb_path=thumb_path,
                foto_evidencia_path=foto_evidencia_path,
                autorizado=None,  # Se actualiza cuando access controller decide
            )
            db.add(det)
            db.commit()
            logger.info(f"[STORE] Detección guardada: {patente} ({sentido}) id={det.id}")
        finally:
            db.close()
            
    except Exception as exc:
        logger.error(f"[STORE] Error guardando detección: {exc}")


def run_cleanup() -> None:
    """
    Busca subdirectorios en EVIDENCIA_DIR que tengan formato de fecha
    %d-%m-%Y o %Y-%m-%d, y elimina aquellos que superen la retención
    configurada en settings.evidence_retention_days.
    Registra el evento en AuditLog de base de datos.
    """
    retention_days = settings.evidence_retention_days
    logger.info(f"[CLEANUP] Iniciando tarea de purga automática de fotos. Retención: {retention_days} días.")
    
    if not EVIDENCIA_DIR.exists():
        return

    now = dt.datetime.now()
    deleted_folders = []
    total_files_deleted = 0

    # Iterar sobre las carpetas dentro del directorio de evidencia
    for item in EVIDENCIA_DIR.iterdir():
        if item.is_dir():
            folder_name = item.name
            folder_date = None
            
            # Intentar parsear formato DD-MM-YYYY
            try:
                folder_date = dt.datetime.strptime(folder_name, "%d-%m-%Y")
            except ValueError:
                pass
            
            # Si falla, intentar parsear formato heredado YYYY-MM-DD
            if not folder_date:
                try:
                    folder_date = dt.datetime.strptime(folder_name, "%Y-%m-%d")
                except ValueError:
                    pass
            
            # Si se pudo parsear la fecha, validar antigüedad
            if folder_date:
                age_days = (now - folder_date).days
                if age_days > retention_days:
                    try:
                        # Contar archivos antes de borrar
                        files_in_folder = list(item.glob("*"))
                        files_count = len(files_in_folder)
                        
                        # Eliminar el directorio recursivamente
                        shutil.rmtree(item)
                        deleted_folders.append(folder_name)
                        total_files_deleted += files_count
                        logger.info(f"[CLEANUP] Carpeta purgada con éxito: {folder_name} ({files_count} archivos eliminados).")
                    except Exception as e:
                        logger.error(f"[CLEANUP] Error al eliminar la carpeta {folder_name}: {e}")

    # Si se eliminó algo, registrar en la tabla AuditLog de la base de datos
    if deleted_folders:
        db = SessionLocal()
        try:
            audit = AuditLog(
                fecha=now,
                tabla="evidencia",
                operacion="DELETE",
                fila_id=None,
                datos=f"Limpieza automatica de evidencias. Carpetas eliminadas: {', '.join(deleted_folders)}. Total archivos borrados: {total_files_deleted}. Días de retención configurados: {retention_days}.",
                operador_id=None,
                ip="127.0.0.1"
            )
            db.add(audit)
            db.commit()
            logger.info(f"[CLEANUP] Registro de auditoría guardado con éxito. ID: {audit.id}")
        except Exception as e:
            logger.error(f"[CLEANUP] Error al guardar registro en AuditLog: {e}")
        finally:
            db.close()
    else:
        logger.info("[CLEANUP] No se encontraron evidencias antiguas para purgar.")
    
    # Liberar memoria de imágenes decodificadas y referencias de purga
    gc.collect()


def start_cleanup_scheduler() -> None:
    """Lanza el programador de limpieza en un hilo separado de fondo (daemon)."""
    threading.Thread(target=_cleanup_loop, daemon=True, name="DiskCleanupThread").start()
    logger.info("[CLEANUP] Programador de purga de evidencias en segundo plano iniciado.")


def _cleanup_loop() -> None:
    # Correr una vez inmediatamente al arrancar para limpiar directorios antiguos al inicio
    try:
        run_cleanup()
    except Exception as exc:
        logger.error(f"[CLEANUP] Error en la ejecución inicial de limpieza: {exc}")

    while True:
        # Esperar 24 horas (86400 segundos) para la próxima ejecución
        time.sleep(86400)
        try:
            run_cleanup()
        except Exception as exc:
            logger.error(f"[CLEANUP] Error en la tarea de limpieza programada: {exc}")


def purge_manual(desde: dt.date, hasta: dt.date, operador_id: int | None = None, ip: str = "127.0.0.1") -> dict:
    """
    Elimina físicamente las carpetas de evidencia en el rango de fechas [desde, hasta] inclusive.
    Registra la acción en AuditLog.
    """
    logger.info(f"[CLEANUP] Iniciando purga manual de fotos. Rango: {desde} a {hasta}.")
    
    if not EVIDENCIA_DIR.exists():
        return {"success": True, "carpetas_eliminadas": 0, "archivos_eliminados": 0, "carpetas_nombres": []}

    now = dt.datetime.now()
    deleted_folders = []
    total_files_deleted = 0

    # Iterar sobre las carpetas dentro del directorio de evidencia
    for item in EVIDENCIA_DIR.iterdir():
        if item.is_dir():
            folder_name = item.name
            folder_date = None
            
            # Intentar parsear formato DD-MM-YYYY
            try:
                folder_date = dt.datetime.strptime(folder_name, "%d-%m-%Y")
            except ValueError:
                pass
            
            # Si falla, intentar parsear formato heredado YYYY-MM-DD
            if not folder_date:
                try:
                    folder_date = dt.datetime.strptime(folder_name, "%Y-%m-%d")
                except ValueError:
                    pass
            
            # Si se pudo parsear la fecha, validar si está dentro del rango
            if folder_date:
                f_date = folder_date.date()
                if desde <= f_date <= hasta:
                    try:
                        # Contar archivos antes de borrar
                        files_in_folder = list(item.glob("*"))
                        files_count = len(files_in_folder)
                        
                        # Eliminar el directorio recursivamente
                        shutil.rmtree(item)
                        deleted_folders.append(folder_name)
                        total_files_deleted += files_count
                        logger.info(f"[CLEANUP] Carpeta purgada con éxito (manual): {folder_name} ({files_count} archivos eliminados).")
                    except Exception as e:
                        logger.error(f"[CLEANUP] Error al eliminar la carpeta {folder_name} (manual): {e}")

    # Si se eliminó algo, registrar en la tabla AuditLog de la base de datos
    if deleted_folders:
        db = SessionLocal()
        try:
            audit = AuditLog(
                fecha=now,
                tabla="evidencia",
                operacion="DELETE",
                fila_id=None,
                datos=f"Limpieza manual de evidencias. Rango: {desde} a {hasta}. Carpetas eliminadas: {', '.join(deleted_folders)}. Total archivos borrados: {total_files_deleted}.",
                operador_id=operador_id,
                ip=ip
            )
            db.add(audit)
            db.commit()
            logger.info(f"[CLEANUP] Registro de auditoría guardado con éxito. ID: {audit.id}")
        except Exception as e:
            logger.error(f"[CLEANUP] Error al guardar registro en AuditLog: {e}")
        finally:
            db.close()
            
    # Forzar recolección de basura tras purgar manualmente
    gc.collect()
            
    return {
        "success": True,
        "carpetas_eliminadas": len(deleted_folders),
        "archivos_eliminados": total_files_deleted,
        "carpetas_nombres": deleted_folders
    }


