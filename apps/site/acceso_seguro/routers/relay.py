from __future__ import annotations
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..services.relay import relay
from ..services.access import access_controller
from ..models import Operador
from ..auth import require_rol
from ..config import settings

router = APIRouter(prefix="/api/relay", tags=["relay"])


@router.get("/status")
def relay_status():
    return relay.status()


class OpenRequest(BaseModel):
    notas: str = ""
    sentido: str = "in"
    lote: str | None = None


@router.post("/open")
def manual_open(
    req: OpenRequest = OpenRequest(),
    op: Operador = Depends(require_rol("admin", "supervisor", "vigilador")),
):
    if op.rol == "vigilador" and not settings.vigilador_manual_trigger:
        raise HTTPException(status_code=403, detail="Apertura manual deshabilitada para vigiladores")
    return access_controller.manual_open(op.id, req.sentido, req.notas, req.lote)


class CloseRequest(BaseModel):
    sentido: str = "in"

@router.post("/close")
def manual_close(
    req: CloseRequest = CloseRequest(),
    op: Operador = Depends(require_rol("admin", "supervisor", "vigilador")),
):
    if op.rol == "vigilador" and not settings.vigilador_manual_trigger:
        raise HTTPException(status_code=403, detail="Apertura manual deshabilitada para vigiladores")
    return access_controller.manual_close(op.id, req.sentido)


class SimulateRequest(BaseModel):
    patente: str = ""
    dni: str = ""
    sentido: str = "in"


@router.post("/simulate")
def simulate_access(
    req: SimulateRequest,
    _op: Operador = Depends(require_rol("admin", "supervisor")),
):
    def run_simulation():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        async def _async_sim():
            if req.patente:
                det_data = {
                    "sentido": req.sentido,
                    "patente": req.patente.strip().upper(),
                    "ocr_conf": 0.95,
                    "detector_conf": 0.98,
                    "region": "AR",
                    "foto_b64": "",
                    "thumb_b64": "",
                    "car_b64": "",
                    "foto_evidencia_b64": "",
                }
                access_controller.on_plate_detected(det_data)
                await asyncio.sleep(1.5)
            
            if req.dni:
                from ..services.qr import DNIData
                dni_obj = DNIData(
                    dni=req.dni.strip(),
                    nombre="Simulado",
                    apellido="Acceso",
                    sexo="M",
                    nacimiento="15/08/1990",
                    tramite="123456789",
                )
                access_controller.on_dni_scanned(dni_obj, req.sentido)
        
        loop.run_until_complete(_async_sim())
        loop.close()

    import threading
    threading.Thread(target=run_simulation, daemon=True).start()
    return {"ok": True, "message": "Simulación iniciada en segundo plano"}


@router.post("/simulate_passed")
def simulate_passed(
    req: CloseRequest,
    _op: Operador = Depends(require_rol("admin", "supervisor")),
):
    access_controller.sensor_close(req.sentido)
    return {"ok": True, "mensaje": f"Pase por masa metálica simulado para barrera {req.sentido}"}

