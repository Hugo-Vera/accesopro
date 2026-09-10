from __future__ import annotations

import os
import threading
import time
from typing import Any, Iterator
from urllib.parse import quote, urlparse

import cv2
import numpy as np

# TCP suele ser más estable en LAN/Windows que UDP.
# stimeout en microsegundos: no esperar 30s si el NAT no entrega el stream.
_ffmpeg_opts = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS") or "rtsp_transport;tcp"
if "stimeout" not in _ffmpeg_opts:
    _ffmpeg_opts = f"{_ffmpeg_opts}|stimeout;4000000"
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = _ffmpeg_opts


def rtsp_url(dev: dict[str, Any], channel: int = 1, subtype: int = 1, rtsp_port: int = 554) -> str:
    """Arma RTSP con host/puerto/clave actuales. No reutiliza URL vieja (IP o 'clave' de relleno)."""
    user = quote(str(dev.get("username") or ""), safe="")
    password = quote(str(dev.get("password") or ""), safe="")
    host = str(dev.get("host") or "").strip()
    port = int(dev.get("rtspPort") or dev.get("rtsp_port") or rtsp_port or 554)
    ch = int(channel) or 1
    sub = int(subtype)
    custom = str(dev.get("rtspUrl") or dev.get("rtsp_url") or "").strip()
    if "Streaming/Channels" in custom:
        code = ch * 100 + (2 if sub in (1, 2) else 1)
        return f"rtsp://{user}:{password}@{host}:{port}/Streaming/Channels/{code}"
    path = "/cam/realmonitor"
    if custom.startswith("rtsp://"):
        try:
            parsed = urlparse(custom)
            if parsed.path and parsed.path != "/":
                path = parsed.path
        except Exception:
            pass
    # subtype 0 = principal, 1 = extra 1, 2 = extra 2 (vertical ASI)
    return f"rtsp://{user}:{password}@{host}:{port}{path}?channel={ch}&subtype={sub}"


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


def _pack_jpeg(jpg: bytes) -> bytes:
    return (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n"
        b"Content-Length: " + str(len(jpg)).encode("ascii") + b"\r\n\r\n" + jpg + b"\r\n"
    )


def _fit_frame(
    frame: Any,
    jpeg_quality: int,
    max_width: int,
    force_size: tuple[int, int] | None,
) -> bytes | None:
    h, w = frame.shape[:2]
    if force_size:
        tw, th = int(force_size[0]), int(force_size[1])
        if tw < th and w >= h:
            frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
        frame = cv2.resize(frame, (tw, th), interpolation=cv2.INTER_AREA)
    elif w > max_width:
        frame = cv2.resize(frame, (max_width, max(1, int(h * max_width / w))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)])
    if not ok:
        return None
    return buf.tobytes()


def _open_rtsp_limited(url: str, timeout: float = 5.0) -> Any | None:
    """Abre RTSP sin bloquear el live 30s si el NAT no autentica el stream."""
    box: list[Any] = []

    def worker() -> None:
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:  # noqa: BLE001
            pass
        if not cap.isOpened():
            cap.release()
            return
        if not cap.grab():
            cap.release()
            return
        box.append(cap)

    t = threading.Thread(target=worker, daemon=True, name="rtsp-open")
    t.start()
    t.join(timeout)
    if box:
        return box[0]
    return None


def _snapshot_jpeg(dev: dict[str, Any], channel: int) -> bytes:
    from .dahua import DahuaClient
    from .hikvision import HikvisionClient, looks_like_hikvision

    host = str(dev.get("host") or "")
    user = str(dev.get("username") or "")
    password = str(dev.get("password") or "")
    port = int(dev.get("port") or 80)
    if looks_like_hikvision(dev):
        return HikvisionClient(host, user, password, port).snapshot_jpeg(channel)[0]
    return DahuaClient(host, user, password, port).snapshot_jpeg(channel)[0]


def iter_snapshot_mjpeg(
    dev: dict[str, Any],
    channel: int = 1,
    jpeg_quality: int = 52,
    max_width: int = 720,
    force_size: tuple[int, int] | None = None,
    target_fps: float = 4.0,
) -> Iterator[bytes]:
    """Live por snapshot CGI (HTTP). Sirve cuando el RTSP no atraviesa el NAT."""
    min_interval = 1.0 / max(1.0, float(target_fps))
    fails = 0
    host = str(dev.get("host") or "")
    http_port = int(dev.get("port") or 80)
    print(f"Live snapshot CGI host={host} http={http_port} channel={channel}")
    while True:
        started = time.monotonic()
        try:
            raw = _snapshot_jpeg(dev, channel)
            fails = 0
        except Exception as exc:  # noqa: BLE001
            fails += 1
            if fails > 12:
                raise RuntimeError(f"Sin snapshot del lector: {exc}") from exc
            time.sleep(0.45)
            continue
        frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            jpg = raw
        else:
            packed = _fit_frame(frame, jpeg_quality, max_width, force_size)
            jpg = packed if packed else raw
        yield _pack_jpeg(jpg)
        wait = min_interval - (time.monotonic() - started)
        if wait > 0:
            time.sleep(wait)


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
    Si el RTSP no abre (NAT / digest), pasa a snapshot CGI por HTTP.
    """
    if jpeg_quality is None:
        jpeg_quality = _env_int("AGENT_LIVE_JPEG_QUALITY", 52)
    if target_fps is None:
        target_fps = _env_float("AGENT_LIVE_FPS", 8.0)

    prefer_snap = os.environ.get("AGENT_LIVE_PREFER_SNAPSHOT", "").strip() in {"1", "true", "yes"}
    sub = int(subtype)
    cap = None
    wait = _env_float("AGENT_LIVE_RTSP_WAIT", 12.0)
    # Extra 1 (640×480) es el que suele atravesar NAT; el 2 vertical a menudo no.
    if str(dev.get("deviceType") or "") == "asi_facial":
        try_subs = [1, 0] if sub != 0 else [0, 1]
    else:
        try_subs = [sub] if sub == 1 else [sub, 1]
    if not prefer_snap:
        host = str(dev.get("host") or "")
        port = int(dev.get("rtspPort") or dev.get("rtsp_port") or 554)
        for try_sub in try_subs:
            url = rtsp_url(dev, channel=channel, subtype=try_sub)
            cap = _open_rtsp_limited(url, timeout=wait)
            if cap is not None:
                print(f"Live RTSP host={host} port={port} subtype={try_sub}", flush=True)
                break
        if cap is None:
            print(f"Live RTSP no abrio host={host} port={port}, fallback snapshot", flush=True)

    if cap is None:
        snap_fps = _env_float("AGENT_LIVE_SNAPSHOT_FPS", 4.0)
        yield from iter_snapshot_mjpeg(
            dev,
            channel=channel,
            jpeg_quality=jpeg_quality,
            max_width=max_width,
            force_size=force_size,
            target_fps=snap_fps,
        )
        return

    fails = 0
    min_interval = 1.0 / max(1.0, float(target_fps))
    next_emit = 0.0
    try:
        while True:
            ok = cap.grab()
            if not ok:
                fails += 1
                if fails > 40:
                    print("Live RTSP cortado, paso a snapshot CGI")
                    break
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
            jpg = _fit_frame(frame, jpeg_quality, max_width, force_size)
            if not jpg:
                continue
            yield _pack_jpeg(jpg)
    except Exception as exc:  # noqa: BLE001
        print(f"Live RTSP error, paso a snapshot CGI: {exc}")
    finally:
        cap.release()

    snap_fps = _env_float("AGENT_LIVE_SNAPSHOT_FPS", 4.0)
    yield from iter_snapshot_mjpeg(
        dev,
        channel=channel,
        jpeg_quality=jpeg_quality,
        max_width=max_width,
        force_size=force_size,
        target_fps=snap_fps,
    )
