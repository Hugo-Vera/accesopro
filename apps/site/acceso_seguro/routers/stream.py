from __future__ import annotations
import asyncio
import time
import cv2
import numpy as np

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..services.alpr import get_alpr
from ..services.qr import get_qr

router = APIRouter(tags=["stream"])

_BOUNDARY = "frame"
_fallback_cache: dict[tuple[str, str, str], bytes] = {}


def _get_fallback_frame(sentido: str) -> bytes:
    """Genera una imagen dark-mode de estado premium usando OpenCV para evitar feeds rotos."""
    svc = get_qr(sentido)
    t_type = svc._source_type
    com_port = svc._com_port
    err = svc.last_error

    if t_type == "disabled":
        status_text = "LECTOR QR DESACTIVADO"
        sub_text = "Modifique la configuracion para activarlo"
    elif t_type == "com":
        status_text = "MODO PISTOLA COM"
        sub_text = f"Puerto: {com_port or 'NO CONFIGURADO'}"
    else:  # camera o both
        if err:
            status_text = "CAMARA OFFLINE"
            sub_text = f"Error: {err}"
        else:
            status_text = "INICIALIZANDO CAMARA"
            sub_text = f"Fuente: {svc._camera_source}"

    cache_key = (sentido, status_text, sub_text)
    if cache_key in _fallback_cache:
        return _fallback_cache[cache_key]

    # Crear imagen premium dark mode 640x360
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    img[:] = (25, 18, 15)  # Fondo gris-azul muy oscuro

    # Borde sutil y linea de acento azul superior
    cv2.rectangle(img, (15, 15), (625, 345), (80, 60, 45), 2)
    cv2.line(img, (15, 15), (625, 15), (216, 180, 0), 4)

    # Titulo principal
    title = f"ESCANER QR DNI ({sentido.upper()})"
    cv2.putText(img, title, (40, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (240, 240, 240), 2, cv2.LINE_AA)
    cv2.line(img, (40, 95), (600, 95), (60, 50, 40), 1)

    # Estado y descripcion corta
    color_estado = (0, 165, 255) if "OFFLINE" in status_text or "DESACTIVADO" in status_text else (150, 220, 0)
    cv2.putText(img, status_text, (40, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color_estado, 2, cv2.LINE_AA)

    if len(sub_text) > 50:
        sub_text = sub_text[:47] + "..."
    cv2.putText(img, sub_text, (40, 210), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 170, 180), 1, cv2.LINE_AA)

    # Pie de pagina
    cv2.putText(img, "SISTEMA DE CONTROL DE ACCESO SEGURO", (40, 305), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 110, 120), 1, cv2.LINE_AA)

    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    res = enc.tobytes() if ok else b""
    _fallback_cache[cache_key] = res
    return res


@router.get("/video_feed/{sentido}")
async def video_feed(sentido: str):
    """MJPEG stream de la camara ALPR."""
    async def _generate():
        svc = get_alpr(sentido)
        while True:
            frame = svc.latest_jpeg
            if frame:
                yield (
                    b"--" + _BOUNDARY.encode() + b"\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + frame
                    + b"\r\n"
                )
            await asyncio.sleep(0.12)  # ~8 fps preview (el productor ya throttlea el JPEG)

    return StreamingResponse(
        _generate(),
        media_type=f"multipart/x-mixed-replace; boundary={_BOUNDARY}",
    )


@router.get("/video_feed_qr")
async def video_feed_qr_default():
    """MJPEG stream de la camara QR (DNI) por defecto (entrada)."""
    return await video_feed_qr("in")


@router.get("/video_feed_qr/{sentido}")
async def video_feed_qr(sentido: str):
    """MJPEG stream de la camara QR (DNI) por sentido (in/out)."""
    async def _generate():
        svc = get_qr(sentido)
        while True:
            frame = svc.latest_jpeg
            if not frame:
                frame = await asyncio.to_thread(_get_fallback_frame, sentido)
            yield (
                b"--" + _BOUNDARY.encode() + b"\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + frame
                + b"\r\n"
            )
            await asyncio.sleep(0.15)  # ~6-7 fps

    return StreamingResponse(
        _generate(),
        media_type=f"multipart/x-mixed-replace; boundary={_BOUNDARY}",
    )


@router.get("/video_feed_evidence/{sentido}")
async def video_feed_evidence(sentido: str):
    """MJPEG stream en vivo de la camara de evidencia para testear visibilidad."""
    import cv2
    from pathlib import Path
    from ..config import settings

    async def _generate():
        src = ""
        if sentido == "in":
            src = str(settings.snapshot_camera_source_in or "").strip()
            if not src:
                src = get_alpr("in")._get_source()
        elif sentido == "out":
            src = str(settings.snapshot_camera_source_out or "").strip()
            if not src:
                src = get_alpr("out")._get_source()

        if not src:
            return

        cap_src = int(src) if src.isdigit() else src
        
        def _init_cap(source):
            params = []
            if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
                params.extend([cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 2500])
            if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
                params.extend([cv2.CAP_PROP_READ_TIMEOUT_MSEC, 2500])
            
            if isinstance(source, str) and source.startswith(("rtsp://", "rtsps://", "http://", "https://")):
                try:
                    c = cv2.VideoCapture(source, cv2.CAP_FFMPEG, params)
                    if c.isOpened():
                        c.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                        return c
                except Exception:
                    pass
            c = cv2.VideoCapture(source)
            c.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            return c

        cap = await asyncio.to_thread(_init_cap, cap_src)
        last_frame_bytes = None

        try:
            while True:
                ok, frame = await asyncio.to_thread(cap.read)
                if not ok or frame is None or frame.size == 0:
                    if last_frame_bytes:
                        yield (
                            b"--" + _BOUNDARY.encode() + b"\r\n"
                            b"Content-Type: image/jpeg\r\n\r\n"
                            + last_frame_bytes
                            + b"\r\n"
                        )
                    else:
                        # Generar un frame elegante offline para mantener el socket activo
                        offline_img = np.zeros((360, 640, 3), dtype=np.uint8)
                        offline_img[:] = (20, 20, 20)
                        cv2.putText(offline_img, f"Camara Evidencia {sentido.upper()} Offline", (50, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (100, 100, 255), 2, cv2.LINE_AA)
                        _, offline_enc = cv2.imencode(".jpg", offline_img, [cv2.IMWRITE_JPEG_QUALITY, 50])
                        yield (
                            b"--" + _BOUNDARY.encode() + b"\r\n"
                            b"Content-Type: image/jpeg\r\n\r\n"
                            + offline_enc.tobytes()
                            + b"\r\n"
                        )
                    await asyncio.sleep(0.2)
                    continue

                def _process_frame(f):
                    h, w = f.shape[:2]
                    if w > 640 and h > 0:
                        scale = 640 / w
                        new_h = max(1, int(h * scale))
                        f = cv2.resize(f, (640, new_h))
                    ok_j, enc = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 50])
                    return ok_j, enc

                ok_j, enc = await asyncio.to_thread(_process_frame, frame)
                if ok_j:
                    last_frame_bytes = enc.tobytes()
                    yield (
                        b"--" + _BOUNDARY.encode() + b"\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n"
                        + last_frame_bytes
                        + b"\r\n"
                    )
                await asyncio.sleep(0.08)  # ~12 fps
        except Exception:
            pass
        finally:
            await asyncio.to_thread(cap.release)

    return StreamingResponse(
        _generate(),
        media_type=f"multipart/x-mixed-replace; boundary={_BOUNDARY}",
    )




@router.get("/api/stream/status")
def stream_status():
    svc = get_alpr("in")
    qr = get_qr("in")
    return {
        "alpr": svc.status(),
        "qr": qr.status(),
    }

