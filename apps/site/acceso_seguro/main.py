from __future__ import annotations
import os

# Forzar transporte TCP para evitar bloqueos de hilos (GIL) en OpenCV
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

import logging
from pathlib import Path

import asyncio
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import settings
from .database import init_db
from .routers import auth, vehiculos, personas, accesos, relay, stream, propietario
from .routers.config_api import router as config_router
from .services.alpr import get_alpr
from .services.qr import get_qr
from .services.access import access_controller
from .services.events import dispatcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")

BASE = Path(__file__).parent

app = FastAPI(
    title="AccesoSeguro",
    description="Sistema de control de acceso vehicular — ALPR + QR DNI + Arduino",
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
)

# Archivos estaticos
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")
# Fotos de evidencia
_evi_dir = BASE.parent / "evidencia"
_evi_dir.mkdir(exist_ok=True)
app.mount("/evidencia", StaticFiles(directory=str(_evi_dir)), name="evidencia")
templates = Jinja2Templates(directory=str(BASE / "templates"))

# Routers de API
app.include_router(auth.router)
app.include_router(vehiculos.router)
app.include_router(personas.router)
app.include_router(accesos.router)
app.include_router(relay.router)
app.include_router(stream.router)
app.include_router(config_router)
app.include_router(propietario.router)


@app.on_event("startup")
async def _startup() -> None:
    logger.info("=" * 55)
    logger.info("  AccesoSeguro — iniciando sistema")
    logger.info("=" * 55)

    # Inicializar base de datos (crea tablas + admin:admin)
    init_db()
    logger.info("DB inicializada")

    # Registrar callback de deteccion ALPR → control de acceso + almacenamiento
    from .services.detection_store import save_detection, start_cleanup_scheduler

    # Iniciar programador de limpieza de fotos
    start_cleanup_scheduler()
    
    alpr_in = get_alpr("in")
    alpr_in.register_on_detection(access_controller.on_plate_detected)
    alpr_in.register_on_detection(save_detection)  # guardar TODA detección en DB+disco
    if alpr_in.running:
        logger.info(f"ALPR IN activo — fuente: {settings.camera_source_in}")
    else:
        logger.warning(f"ALPR IN inactivo: {alpr_in.last_error}")

    alpr_out = get_alpr("out")
    alpr_out.register_on_detection(access_controller.on_plate_detected)
    alpr_out.register_on_detection(save_detection)  # guardar TODA detección en DB+disco
    if alpr_out.running:
        logger.info(f"ALPR OUT activo — fuente: {settings.camera_source_out}")
    else:
        logger.warning(f"ALPR OUT inactivo: {alpr_out.last_error}")

    # Iniciar servicio QR (camara DNI) IN
    qr_in = get_qr("in")
    qr_in.register_on_scan(lambda data: access_controller.on_dni_scanned(data, "in"))
    qr_in.start()
    logger.info(f"QR DNI IN iniciado — fuente: {settings.qr_camera_source_in}")

    # Iniciar servicio QR (camara DNI) OUT
    qr_out = get_qr("out")
    qr_out.register_on_scan(lambda data: access_controller.on_dni_scanned(data, "out"))
    qr_out.start()
    logger.info(f"QR DNI OUT iniciado — fuente: {settings.qr_camera_source_out}")

    logger.info(f"Relay: {'SIMULADO' if not settings.relay_port else settings.relay_port}")
    logger.info(f"Modo de validacion: {settings.auth_mode}")
    logger.info("-" * 55)
    logger.info("Panel web → http://127.0.0.1:5051")
    logger.info("Credenciales por defecto: admin / admin")
    logger.info("=" * 55)


# ── Paginas web ─────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={"app_name": settings.app_name},
    )


# ── Endpoints adicionales ───────────────────────────────────────────────────

@app.get("/api/events/recent")
def recent_events():
    """Ultimos N eventos de acceso (cache en memoria, no requiere auth para el dashboard)."""
    return {"events": access_controller.recent_events}


@app.get("/api/config/info")
def config_info():
    """Informacion no sensible de configuracion activa."""
    return {
        "camera_source_in": settings.camera_source_in or "(no configurada)",
        "camera_source_out": settings.camera_source_out or "(no configurada)",
        "relay_port": settings.relay_port or "(simulado)",
        "auth_mode": settings.auth_mode,
        "require_dni_qr": settings.require_dni_qr,
        "min_ocr_conf": settings.min_ocr_conf,
        "readings_to_confirm": settings.readings_to_confirm,
    }

@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    await websocket.accept()
    q = dispatcher.subscribe()
    try:
        while True:
            msg = await q.get()
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        dispatcher.unsubscribe(q)
