from __future__ import annotations

import os
import time
from typing import Any, Iterator
from urllib.parse import quote

import cv2

# TCP suele ser más estable en LAN/Windows que UDP.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")


def rtsp_url(dev: dict[str, Any], channel: int = 1, subtype: int = 1, rtsp_port: int = 554) -> str:
    custom = dev.get("rtspUrl") or dev.get("rtsp_url")
    if custom and str(custom).strip().startswith("rtsp://"):
        return str(custom).strip()
    user = quote(str(dev.get("username") or ""), safe="")
    password = quote(str(dev.get("password") or ""), safe="")
    host = str(dev.get("host") or "").strip()
    port = int(rtsp_port) or 554
    # subtype 0 = principal (16:9), 1 = extra 1 (recorte 4:3), 2 = extra 2 (vertical nativo facial)
    return (
        f"rtsp://{user}:{password}@{host}:{port}"
        f"/cam/realmonitor?channel={int(channel) or 1}&subtype={int(subtype)}"
    )


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def iter_mjpeg(
    dev: dict[str, Any],
    channel: int = 1,
    subtype: int = 2,
    jpeg_quality: int | None = None,
    max_width: int = 720,
    force_size: tuple[int, int] | None = None,
    target_fps: float | None = None,
) -> Iterator[bytes]:
    """
    force_size: (width, height). Si se indica, reescala cada frame a ese tamaño
    (p.ej. 272×480 del display ASI) para que el live coincida con la pantalla del lector.
    target_fps: tope de encode (OpenCV come CPU si no se limita). Env: AGENT_LIVE_FPS.
    """
    if jpeg_quality is None:
        jpeg_quality = _env_int("AGENT_LIVE_JPEG_QUALITY", 42)
    if target_fps is None:
        target_fps = _env_float("AGENT_LIVE_FPS", 5.0)

    sub = int(subtype)
    url = rtsp_url(dev, channel=channel, subtype=sub)
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:  # noqa: BLE001
        pass

    if not cap.isOpened() and sub != 1:
        # Fallback a stream extra estándar si el subtipo solicitado no abre
        sub = 1
        url = rtsp_url(dev, channel=channel, subtype=sub)
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:  # noqa: BLE001
            pass

    if not cap.isOpened():
        raise RuntimeError("No se pudo abrir el RTSP del lector (¿puerto 554 / stream extra?)")

    fails = 0
    min_interval = 1.0 / max(1.0, float(target_fps))
    next_emit = 0.0
    try:
        while True:
            # grab() descarga sin decodificar; retrieve solo cuando vamos a emitir
            ok = cap.grab()
            if not ok:
                fails += 1
                if fails > 40:
                    raise RuntimeError("Se cortó el RTSP del lector")
                time.sleep(0.08)
                continue
            fails = 0
            now = time.monotonic()
            if now < next_emit:
                continue
            ok, frame = cap.retrieve()
            if not ok or frame is None:
                continue
            next_emit = now + min_interval
            h, w = frame.shape[:2]

            if force_size:
                tw, th = int(force_size[0]), int(force_size[1])
                # Si el RTSP viene apaisado y el destino es vertical (ASI), rotar 90° antes de estirar
                if tw < th and w >= h:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
                    h, w = frame.shape[:2]
                frame = cv2.resize(frame, (tw, th), interpolation=cv2.INTER_AREA)
            elif w > max_width:
                frame = cv2.resize(frame, (max_width, max(1, int(h * max_width / w))), interpolation=cv2.INTER_AREA)

            ok, buf = cv2.imencode(
                ".jpg",
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)],
            )
            if not ok:
                continue
            jpg = buf.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(jpg)).encode("ascii") + b"\r\n\r\n" + jpg + b"\r\n"
            )
    finally:
        cap.release()
