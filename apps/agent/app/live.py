from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from typing import Any, Iterator
from urllib.parse import quote, urlparse

import cv2
import numpy as np

# TCP suele ser más estable en LAN/Windows que UDP.
_ffmpeg_opts = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS") or "rtsp_transport;tcp"
if "stimeout" not in _ffmpeg_opts:
    _ffmpeg_opts = f"{_ffmpeg_opts}|stimeout;4000000"
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = _ffmpeg_opts

_ASI_TYPES = {"asi_facial", "vto_intercom", "access_controller"}


def _is_asi_reader(dev: dict[str, Any]) -> bool:
    return str(dev.get("deviceType") or "").strip().lower() in _ASI_TYPES


def _hub_key(dev: dict[str, Any]) -> str:
    """Un RTSP por IP del lector, no por fila de dispositivo."""
    host = str(dev.get("host") or "").strip().lower()
    return host or str(dev.get("id") or "live")


def rtsp_url(dev: dict[str, Any], channel: int = 1, subtype: int = 1, rtsp_port: int = 554) -> str:
    """Arma RTSP con host/puerto/clave actuales. No reutiliza URL vieja (IP o 'clave' de relleno)."""
    user = quote(str(dev.get("username") or ""), safe="")
    password = quote(str(dev.get("password") or ""), safe="")
    host = str(dev.get("host") or "").strip()
    port = int(dev.get("rtspPort") or dev.get("rtsp_port") or rtsp_port or 554)
    ch = int(channel) or 1
    sub = int(subtype)
    custom = str(dev.get("rtspUrl") or dev.get("rtsp_url") or "").strip()
    # ASI/VTO: PDF Access Control = /cam/realmonitor extra 1. Nunca Hikvision ni main.
    if _is_asi_reader(dev):
        return f"rtsp://{user}:{password}@{host}:{port}/cam/realmonitor?channel=1&subtype=1"
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


def _cover_to(frame: Any, tw: int, th: int) -> Any:
    """Recorte tipo evidencia (384×640) sin rotar ni pedir snapshot.cgi."""
    h, w = frame.shape[:2]
    scale = max(tw / max(w, 1), th / max(h, 1))
    nw = max(tw, int(round(w * scale)))
    nh = max(th, int(round(h * scale)))
    frame = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_AREA)
    x = max(0, (nw - tw) // 2)
    y = max(0, (nh - th) // 2)
    return frame[y : y + th, x : x + tw]


def _fit_frame(
    frame: Any,
    jpeg_quality: int,
    max_width: int,
    force_size: tuple[int, int] | None,
) -> bytes | None:
    h, w = frame.shape[:2]
    if force_size:
        tw, th = int(force_size[0]), int(force_size[1])
        frame = _cover_to(frame, tw, th)
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


def _placeholder_jpeg(message: str = "Sin live") -> bytes:
    img = np.zeros((240, 320, 3), dtype=np.uint8)
    img[:] = (18, 14, 8)
    cv2.putText(
        img,
        message,
        (70, 126),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.72,
        (168, 168, 168),
        1,
        cv2.LINE_AA,
    )
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
    return buf.tobytes() if ok else b""


def iter_placeholder_mjpeg(message: str = "Sin live") -> Iterator[bytes]:
    packed = _pack_jpeg(_placeholder_jpeg(message))
    while True:
        yield packed
        time.sleep(1.0)


def _live_try_subs(dev: dict[str, Any], requested: int) -> list[int]:
    """ASI: solo extra 1. Nunca main (0): satura el motor facial."""
    if _is_asi_reader(dev):
        return [1]
    sub = int(requested)
    if sub == 1:
        return [1]
    return [sub, 1]


def _ffmpeg_q(jpeg_quality: int) -> int:
    """Mapea calidad JPEG 1–100 a -q:v de ffmpeg (2 nítido, 31 peor)."""
    q = int(round((100 - max(1, min(100, jpeg_quality))) / 8))
    return max(3, min(12, q))


def _iter_jpegs_from_pipe(read_fn) -> Iterator[bytes]:
    buf = b""
    while True:
        chunk = read_fn(8192)
        if not chunk:
            break
        buf += chunk
        while True:
            soi = buf.find(b"\xff\xd8")
            if soi < 0:
                buf = buf[-1:] if buf else b""
                break
            if soi:
                buf = buf[soi:]
            eoi = buf.find(b"\xff\xd9", 2)
            if eoi < 0:
                break
            jpg = buf[: eoi + 2]
            buf = buf[eoi + 2 :]
            if len(jpg) > 200:
                yield jpg


def iter_ffmpeg_rtsp(
    dev: dict[str, Any],
    channel: int,
    subtype: int,
    jpeg_quality: int,
    max_width: int,
    target_fps: float,
) -> Iterator[bytes]:
    """
    RTSP extra → MJPEG con ffmpeg (un solo recode, baja latencia).
    El browser no habla rtsp://; este pipe es el camino corto.
    """
    bin_path = shutil.which("ffmpeg")
    if not bin_path:
        return
    url = rtsp_url(dev, channel=channel, subtype=subtype)
    host = str(dev.get("host") or "")
    port = int(dev.get("rtspPort") or dev.get("rtsp_port") or 554)
    fps = max(4, min(12, int(round(float(target_fps)))))
    width = max(320, min(1280, int(max_width)))
    # Extra 1 entero: scale al ancho, sin crop. El CSS hace contain en AccesoCam.
    vf = f"scale={width}:-2"
    cmd = [
        bin_path,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "nobuffer",
        "-flags",
        "low_delay",
        "-probesize",
        "1000000",
        "-analyzeduration",
        "1000000",
        "-rtsp_transport",
        "tcp",
        "-timeout",
        "8000000",
        "-i",
        url,
        "-an",
        "-r",
        str(fps),
        "-vf",
        vf,
        "-q:v",
        str(_ffmpeg_q(jpeg_quality)),
        "-f",
        "mpjpeg",
        "-boundary_tag",
        "frame",
        "pipe:1",
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    err_chunks: list[bytes] = []
    first_frame = threading.Event()

    def _drain_err() -> None:
        try:
            if not proc.stderr:
                return
            while True:
                chunk = proc.stderr.read(1024)
                if not chunk:
                    break
                err_chunks.append(chunk)
                if sum(len(x) for x in err_chunks) > 8000:
                    del err_chunks[:-6]
        except Exception:  # noqa: BLE001
            return

    def _watchdog() -> None:
        if first_frame.wait(12):
            return
        print(f"Live ffmpeg sin frames en 12s host={host} port={port} subtype={subtype}", flush=True)
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            return

    threading.Thread(target=_drain_err, daemon=True, name="ffmpeg-err").start()
    threading.Thread(target=_watchdog, daemon=True, name="ffmpeg-watch").start()
    print(f"Live ffmpeg RTSP host={host} port={port} subtype={subtype} fps={fps}", flush=True)
    n = 0
    try:
        if not proc.stdout:
            return
        for jpg in _iter_jpegs_from_pipe(proc.stdout.read):
            n += 1
            if n == 1:
                first_frame.set()
            yield _pack_jpeg(jpg)
    finally:
        first_frame.set()
        try:
            proc.kill()
            proc.wait(timeout=2)
        except Exception:  # noqa: BLE001
            pass
        if n == 0:
            err = b"".join(err_chunks).decode("utf-8", "replace").replace("\n", " ").strip()
            print(
                f"Live ffmpeg no entrego host={host} port={port} subtype={subtype} err={err[:400]}",
                flush=True,
            )


def iter_mjpeg(
    dev: dict[str, Any],
    channel: int = 1,
    subtype: int = 1,
    jpeg_quality: int | None = None,
    max_width: int = 720,
    force_size: tuple[int, int] | None = None,
    target_fps: float | None = None,
) -> Iterator[bytes]:
    """Live del dashboard: RTSP extra 1 via ffmpeg. Sin snapshot.cgi (traba el ASI)."""
    if jpeg_quality is None:
        jpeg_quality = _env_int("AGENT_LIVE_JPEG_QUALITY", 52)
    if target_fps is None:
        target_fps = _env_float("AGENT_LIVE_FPS", 6.0 if _is_asi_reader(dev) else 12.0)

    try_subs = _live_try_subs(dev, subtype)
    host = str(dev.get("host") or "")
    port = int(dev.get("rtspPort") or dev.get("rtsp_port") or 554)
    is_asi = _is_asi_reader(dev)

    if shutil.which("ffmpeg"):
        for try_sub in try_subs:
            got = False
            for packed in iter_ffmpeg_rtsp(
                dev,
                channel=channel,
                subtype=try_sub,
                jpeg_quality=jpeg_quality,
                max_width=max_width,
                target_fps=target_fps,
            ):
                got = True
                yield packed
            if got:
                return
            print(f"Live ffmpeg no entrego host={host} port={port} subtype={try_sub}", flush=True)
        if is_asi:
            print(f"Live RTSP no abrio host={host} port={port} extra=1, sin OpenCV ni snapshot CGI", flush=True)
            return

    wait = _env_float("AGENT_LIVE_RTSP_WAIT", 12.0)
    cap = None
    for try_sub in try_subs:
        url = rtsp_url(dev, channel=channel, subtype=try_sub)
        cap = _open_rtsp_limited(url, timeout=wait)
        if cap is not None:
            print(f"Live OpenCV RTSP host={host} port={port} subtype={try_sub}", flush=True)
            break
    if cap is None:
        print(f"Live RTSP no abrio host={host} port={port} extra=1, sin snapshot CGI", flush=True)
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
                    print("Live RTSP cortado, sin snapshot CGI")
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
        print(f"Live RTSP error, sin snapshot CGI: {exc}")
    finally:
        cap.release()


class _LiveHub:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cv = threading.Condition(self.lock)
        self.jpeg: bytes | None = None
        self.users = 0
        self.stop = threading.Event()
        self.thread: threading.Thread | None = None


_hubs: dict[str, _LiveHub] = {}
_hubs_lock = threading.Lock()


def hub_stats() -> dict[str, dict[str, Any]]:
    with _hubs_lock:
        return {
            key: {
                "users": hub.users,
                "alive": bool(hub.thread and hub.thread.is_alive()),
            }
            for key, hub in _hubs.items()
        }


def rtsp_clients_for_host(host: str) -> int:
    key = str(host or "").strip().lower()
    if not key:
        return 0
    with _hubs_lock:
        hub = _hubs.get(key)
        return int(hub.users) if hub else 0


def stop_hub_for_host(host: str) -> int:
    """Corta el RTSP de esa IP. El attach CGI y la cara recuperan el SoC."""
    key = str(host or "").strip().lower()
    if not key:
        return 0
    with _hubs_lock:
        hub = _hubs.get(key)
        if not hub:
            return 0
        n = int(hub.users)
        hub.stop.set()
        with hub.cv:
            hub.cv.notify_all()
        return n


def iter_mjpeg_shared(
    dev: dict[str, Any],
    channel: int = 1,
    subtype: int = 1,
    jpeg_quality: int | None = None,
    max_width: int = 720,
    force_size: tuple[int, int] | None = None,
    target_fps: float | None = None,
) -> Iterator[bytes]:
    """Un solo RTSP por IP: varias pestañas reutilizan el último JPEG."""
    key = _hub_key(dev)
    if _is_asi_reader(dev):
        channel = 1
        subtype = 1
        if max_width > 640:
            max_width = 640
        force_size = None
        if target_fps is None:
            target_fps = _env_float("AGENT_LIVE_FPS", 6.0)
    with _hubs_lock:
        hub = _hubs.get(key)
        if hub is None:
            hub = _LiveHub()
            _hubs[key] = hub
        hub.users += 1
        if hub.users > 2:
            print(f"Live hub users={hub.users} host={key} (proxy sin abort?)", flush=True)
        if hub.thread is None or not hub.thread.is_alive():
            hub.stop.clear()
            hub.thread = threading.Thread(
                target=_hub_producer,
                args=(hub, dev, channel, subtype, jpeg_quality, max_width, force_size, target_fps),
                daemon=True,
                name=f"live-hub-{key[:8]}",
            )
            hub.thread.start()
    last: bytes | None = None
    try:
        while not hub.stop.is_set():
            with hub.cv:
                hub.cv.wait(timeout=1.0)
                frame = hub.jpeg
            if frame and frame is not last:
                last = frame
                yield _pack_jpeg(frame)
    finally:
        with _hubs_lock:
            hub.users -= 1
            if hub.users <= 0:
                hub.stop.set()


def _sleep_hub(hub: _LiveHub, seconds: float) -> None:
    deadline = time.time() + max(0.4, float(seconds))
    while time.time() < deadline and hub.users > 0:
        time.sleep(0.4)


def _hub_producer(
    hub: _LiveHub,
    dev: dict[str, Any],
    channel: int,
    subtype: int,
    jpeg_quality: int | None,
    max_width: int,
    force_size: tuple[int, int] | None,
    target_fps: float | None,
) -> None:
    host = str(dev.get("host") or "")
    placeholder = _placeholder_jpeg("Sin live")
    backoff = 4.0
    while hub.users > 0 and not hub.stop.is_set():
        if hub.stop.is_set() and hub.users <= 0:
            break
        n = 0
        try:
            for packed in iter_mjpeg(
                dev,
                channel=channel,
                subtype=subtype,
                jpeg_quality=jpeg_quality,
                max_width=max_width,
                force_size=force_size,
                target_fps=target_fps,
            ):
                if hub.stop.is_set() or hub.users <= 0:
                    break
                n += 1
                raw = packed
                marker = b"\r\n\r\n"
                idx = packed.find(marker)
                if idx >= 0:
                    raw = packed[idx + len(marker) :].rstrip(b"\r\n")
                with hub.cv:
                    hub.jpeg = raw
                    hub.cv.notify_all()
        except Exception as exc:  # noqa: BLE001
            print(f"Live hub producer: {exc}", flush=True)
        if hub.users <= 0:
            break
        if n == 0:
            with hub.cv:
                hub.jpeg = placeholder
                hub.cv.notify_all()
            wait = min(40.0, backoff)
            print(f"Live hub reintenta RTSP host={host} en {wait:.0f}s", flush=True)
            backoff = min(40.0, backoff * 2.0)
        else:
            backoff = 4.0
            wait = 5.0
            print(f"Live hub RTSP cortado host={host}, reintenta en {wait:.0f}s", flush=True)
        _sleep_hub(hub, wait)
