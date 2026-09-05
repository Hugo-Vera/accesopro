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


def iter_mjpeg(
    dev: dict[str, Any],
    channel: int = 1,
    subtype: int = 2,
    jpeg_quality: int = 65,
    max_width: int = 1280,
) -> Iterator[bytes]:
    sub = int(subtype)
    url = rtsp_url(dev, channel=channel, subtype=sub)
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
    except Exception:  # noqa: BLE001
        pass

    if not cap.isOpened() and sub != 1:
        # Fallback a stream extra estándar si el subtipo solicitado no abre
        sub = 1
        url = rtsp_url(dev, channel=channel, subtype=sub)
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
        except Exception:  # noqa: BLE001
            pass

    if not cap.isOpened():
        raise RuntimeError("No se pudo abrir el RTSP del lector (¿puerto 554 / stream extra?)")

    fails = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                fails += 1
                if fails > 40:
                    raise RuntimeError("Se cortó el RTSP del lector")
                time.sleep(0.05)
                continue
            fails = 0
            h, w = frame.shape[:2]
            if w > max_width:
                frame = cv2.resize(frame, (max_width, max(1, int(h * max_width / w))))
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
