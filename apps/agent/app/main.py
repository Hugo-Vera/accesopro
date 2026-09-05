from __future__ import annotations

import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from .alpr import AlprWorker
from .dahua import DahuaClient
from .live import iter_mjpeg

API = os.environ.get("ACCESOPRO_API_URL", "http://localhost:8787").rstrip("/")
TOKEN = os.environ.get("SITE_AGENT_TOKEN", "accesopro-demo-agent")
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

_stop = threading.Event()
_primed_dahua: set[str] = set()
_seen_records: set[str] = set()
_config: dict[str, Any] = {"dahua": [], "actuators": [], "cameras": [], "plates": []}


def api_get(path: str) -> dict[str, Any]:
    with httpx.Client(timeout=8.0) as client:
        res = client.get(f"{API}{path}", headers=HEADERS)
        res.raise_for_status()
        return res.json()


def api_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    with httpx.Client(timeout=8.0) as client:
        res = client.post(f"{API}{path}", headers=HEADERS, json=payload)
        res.raise_for_status()
        return res.json()


def on_plate(camera_id: str, plate: str, confidence: float) -> None:
    try:
        result = api_post(
            "/agent/events",
            {
                "type": "plate",
                "payload": {"cameraId": camera_id, "plate": plate, "confidence": round(confidence, 3)},
            },
        )
        print(f"Chapa {plate} ({confidence:.2f})")
        actuator_id = result.get("openActuatorId")
        if actuator_id:
            _open(actuator_id)
    except Exception as exc:  # noqa: BLE001
        print(f"No se pudo enviar chapa: {exc}")


alpr = AlprWorker(on_plate)


def _device(device_id: str) -> dict[str, Any] | None:
    for dev in _config.get("dahua", []):
        if dev["id"] == device_id:
            return dev
    return None


def _client(dev: dict[str, Any]) -> DahuaClient:
    return DahuaClient(dev["host"], dev["username"], dev["password"], int(dev.get("port") or 80))


def _open(actuator_id: str) -> dict[str, Any]:
    act = next((a for a in _config.get("actuators", []) if a["id"] == actuator_id), None)
    if not act:
        return {"ok": False, "error": "Actuador desconocido"}
    if act["driver"] == "dahua" and act.get("dahuaDeviceId"):
        dev = _device(act["dahuaDeviceId"])
        if not dev:
            return {"ok": False, "error": "Equipo Dahua no encontrado"}
        text = _client(dev).open_door(int(act.get("dahuaChannel") or 1))
        return {"ok": True, "driver": "dahua", "response": text[:300]}
    if act["driver"] in ("http", "ip") and act.get("httpUrl"):
        with httpx.Client(timeout=5.0) as client:
            res = client.get(act["httpUrl"])
            return {"ok": res.is_success, "status": res.status_code}
    if act["driver"] == "engine":
        return {"ok": False, "error": "Este actuador lo abre AccesoPro contra el motor LAN"}
    return {"ok": False, "error": f"Driver no soportado: {act['driver']}"}


_device_backoffs: dict[str, float] = {}
_device_initialized: set[str] = set()
_last_person_access: dict[str, float] = {}
_seen_records: set[str] = set()


def _poll_dahua() -> None:
    now = time.time()
    for dev in _config.get("dahua", []):
        if dev.get("deviceType") == "camera_ip":
            continue
        dev_id = dev.get("id")
        if not dev_id:
            continue
        if _device_backoffs.get(dev_id, 0) > now:
            continue
        try:
            records = _client(dev).access_records(30)
            if dev_id in _device_backoffs:
                _device_backoffs.pop(dev_id, None)
        except Exception as exc:  # noqa: BLE001
            _device_backoffs[dev_id] = now + 40.0
            print(f"Dahua {dev.get('name')} (pausado 40s): {exc}")
            continue

        if dev_id not in _device_initialized:
            for rec in records:
                stamp = rec.get("CreateTime") or rec.get("Time") or rec.get("UTC") or ""
                rec_no = rec.get("RecNo") or rec.get("Index") or ""
                _seen_records.add(f"{dev_id}:{rec_no}:{stamp}")
            _device_initialized.add(dev_id)
            continue

        for rec in records:
            _dispatch_access_event(dev, rec)


def _dispatch_access_event(dev: dict[str, Any], rec: dict[str, Any]) -> None:
    now = time.time()
    dev_id = dev.get("id") or ""
    stamp = rec.get("CreateTime") or rec.get("Time") or rec.get("UTC") or str(int(now))
    rec_no = rec.get("RecNo") or rec.get("Index") or ""
    key = f"{dev_id}:{rec_no}:{stamp}"
    if key in _seen_records:
        return
    _seen_records.add(key)
    if len(_seen_records) > 3000:
        _seen_records.clear()

    status_code = str(rec.get("Status") or "0")
    is_approved = status_code == "1"
    method_code = str(rec.get("Method") or "")
    method_name = "remote" if method_code in ("4", 4) else "facial" if method_code in ("15", 15) else "card" if method_code in ("1", 1) else "fingerprint" if method_code in ("2", 2) else "qr" if method_code in ("6", 6) else "password" if method_code in ("3", 3) else "other"
    person_name = rec.get("CardName") or rec.get("UserID") or ("Apertura remota" if method_name == "remote" else ("Rostro no identificado" if not is_approved else "Usuario Facial"))

    # Debounce de 3 segundos por persona para evitar spam
    person_identifier = str(rec.get("UserID") or rec.get("CardNo") or rec.get("CardName") or "anon")
    debounce_key = f"{dev_id}:{person_identifier}:{is_approved}"
    last_event_time = _last_person_access.get(debounce_key, 0)
    if abs(now - last_event_time) < 3.0:
        return
    _last_person_access[debounce_key] = now

    try:
        api_post(
            "/agent/events",
            {
                "type": "dahua_access",
                "payload": {
                    "deviceId": dev_id,
                    "deviceName": dev.get("name"),
                    "method": method_name,
                    "methodCode": method_code,
                    "status": status_code,
                    "approved": is_approved,
                    "personName": person_name,
                    "userId": rec.get("UserID") or "",
                    "cardNo": rec.get("CardNo") or "",
                    "recNo": rec_no,
                    "rawTime": stamp,
                    "snapshotUrl": rec.get("URL") or "",
                    **rec,
                },
            },
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Evento Dahua no enviado: {exc}")


def _run_command(cmd: dict[str, Any]) -> dict[str, Any]:
    action = cmd.get("action")
    payload = cmd.get("payload") or {}
    if action == "open":
        return _open(payload.get("actuatorId"))
    if action == "probe_dahua":
        dev = _device(payload.get("deviceId"))
        if not dev and payload.get("host") and payload.get("username"):
            dev = payload
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        return _client(dev).probe()
    if action == "dahua_door_status":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        return _client(dev).door_status(int(payload.get("channel") or 1))
    if action == "dahua_open":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        text = _client(dev).open_door(int(payload.get("channel") or 1))
        return {"ok": True, "response": text[:300]}
    if action == "dahua_snapshot":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        return _client(dev).snapshot(int(payload.get("channel") or 1))
    if action == "dahua_person_list":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        return _client(dev).list_persons(int(payload.get("count") or 200))
    if action == "dahua_person_enroll":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        client = _client(dev)
        user_id = str(payload.get("userId") or "").strip()
        name = str(payload.get("name") or "").strip() or user_id
        card_no = str(payload.get("cardNo") or "").strip() or user_id
        password = payload.get("password")
        photo = payload.get("photoBase64")
        if not user_id:
            return {"ok": False, "error": "Falta userId"}
        created = client.upsert_person(
            user_id=user_id,
            name=name,
            card_no=card_no,
            password=str(password) if password else None,
            valid_date_start=payload.get("validDateStart"),
            valid_date_end=payload.get("validDateEnd"),
            period_index=payload.get("periodIndex"),
            user_type=int(payload.get("userType") or 0),
            use_time=int(payload.get("useTime") or 0),
        )
        if not created.get("ok"):
            return created
        face = None
        if photo:
            face = client.add_face_photo(user_id, name, str(photo))
            if not face.get("ok"):
                return {
                    "ok": False,
                    "error": f"Usuario creado pero la cara falló: {face.get('error')}",
                    "person": created,
                    "face": face,
                }
        # QR de acceso = CardNo (el ASI lo lee si QR unlock está on)
        return {
            "ok": True,
            "person": created,
            "face": face,
            "qrPayload": card_no,
            "hint": "El QR contiene el CardNo. En el ASI debe estar habilitada la lectura de QR.",
        }
    if action == "dahua_person_delete":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        return _client(dev).remove_person(
            user_id=payload.get("userId"),
            rec_no=payload.get("recNo"),
            card_no=payload.get("cardNo"),
        )
    if action == "dahua_qr_get_config":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        return _client(dev).get_qr_config()
    if action == "dahua_qr_set_config":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        enable = bool(payload.get("transmissionEnable", True))
        valid_time = int(payload.get("validTime") or 15)
        return _client(dev).set_qr_config(enable, valid_time)
    if action == "dahua_schedules_get":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        count = int(payload.get("count") or 16)
        return {"ok": True, "schedules": _client(dev).get_time_schedules(count)}
    if action == "dahua_schedule_set":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        idx = int(payload.get("index") or 0)
        enable = bool(payload.get("enabled", True))
        days = payload.get("days") or []
        return _client(dev).set_time_schedule(idx, enable, days)
    if action == "dahua_card_listen":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        timeout = int(payload.get("timeout") or 15)
        return _client(dev).listen_card(timeout)
    if action == "dahua_clear_records":
        dev = _device(payload.get("deviceId"))
        if not dev:
            return {"ok": False, "error": "Equipo no encontrado"}
        res = _client(dev).clear_access_records()
        _seen_records.clear()
        _last_person_access.clear()
        _device_last_times[dev["id"]] = int(time.time())
        return res
    return {"ok": False, "error": f"Acción desconocida: {action}"}


def _commands_worker() -> None:
    while not _stop.is_set():
        try:
            res = api_get("/agent/commands")
            cmds = res.get("commands") or []
            for cmd in cmds:
                try:
                    result = _run_command(cmd)
                    api_post(
                        f"/agent/commands/{cmd['id']}/result",
                        {"ok": bool(result.get("ok")), "result": result, "error": result.get("error")},
                    )
                except Exception as exc:  # noqa: BLE001
                    api_post(
                        f"/agent/commands/{cmd['id']}/result",
                        {"ok": False, "error": str(exc)},
                    )
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.35)


def _heartbeat_worker() -> None:
    while not _stop.is_set():
        try:
            api_post("/agent/heartbeat", {})
            cfg = api_get("/agent/config")
            if cfg:
                _config.update(cfg)
                alpr.sync(_config.get("cameras") or [])
        except Exception as exc:  # noqa: BLE001
            print(f"Heartbeat worker: {exc}")
        time.sleep(3.5)


def _dahua_stream_worker() -> None:
    time.sleep(2.0)
    while not _stop.is_set():
        for dev in _config.get("dahua", []):
            if dev.get("deviceType") == "camera_ip":
                continue
            try:
                client = _client(dev)
                for event in client.stream_events():
                    if _stop.is_set():
                        break
                    if isinstance(event, dict):
                        _dispatch_access_event(dev, event)
            except Exception as exc:  # noqa: BLE001
                pass
        time.sleep(2.0)


def _dahua_poller_worker() -> None:
    time.sleep(1.0)
    while not _stop.is_set():
        try:
            _poll_dahua()
        except Exception as exc:  # noqa: BLE001
            print(f"Poller worker: {exc}")
        time.sleep(0.5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    t_cmd = threading.Thread(target=_commands_worker, daemon=True, name="CommandsWorker")
    t_hb = threading.Thread(target=_heartbeat_worker, daemon=True, name="HeartbeatWorker")
    t_poll = threading.Thread(target=_dahua_poller_worker, daemon=True, name="PollerWorker")
    t_stream = threading.Thread(target=_dahua_stream_worker, daemon=True, name="StreamWorker")
    t_cmd.start()
    t_hb.start()
    t_poll.start()
    t_stream.start()
    print(f"AccesoPro agent multithreaded workers started -> {API}")
    yield
    _stop.set()
    alpr.stop()


app = FastAPI(title="AccesoPro Site Agent", version="0.2.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "ok": True,
        "role": "site-agent",
        "product": "AccesoPro",
        "cameras": len(_config.get("cameras") or []),
        "dahua": len(_config.get("dahua") or []),
    }


def _authorize(authorization: str | None, token: str | None) -> None:
    expected = TOKEN
    got = None
    if authorization and authorization.lower().startswith("bearer "):
        got = authorization.split(" ", 1)[1].strip()
    elif token:
        got = token.strip()
    if not got or got != expected:
        raise HTTPException(status_code=401, detail="Token inválido")


@app.get("/dahua/{device_id}/snapshot")
def dahua_snapshot(
    device_id: str,
    channel: int = 1,
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    """JPEG directo del lector (para live de portería vía API)."""
    _authorize(authorization, token)
    if not _config.get("dahua"):
        try:
            _config.update(api_get("/agent/config"))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"Sin config: {exc}") from exc
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    try:
        raw, ctype = _client(dev).snapshot_jpeg(int(channel) or 1)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=raw, media_type=ctype, headers={"Cache-Control": "no-store"})


@app.get("/dahua/{device_id}/record-snapshot")
def dahua_record_snapshot(
    device_id: str,
    url: str = Query(..., description="Ruta de captura guardada en Dahua"),
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    """Descarga de la captura exacta del evento de acceso desde el lector Dahua ASI."""
    _authorize(authorization, token)
    if not _config.get("dahua"):
        try:
            _config.update(api_get("/agent/config"))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"Sin config: {exc}") from exc
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    try:
        raw, ctype = _client(dev).get_record_snapshot(url)
        return Response(content=raw, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc



def _ensure_dahua_config() -> None:
    if _config.get("dahua"):
        return
    try:
        _config.update(api_get("/agent/config"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Sin config: {exc}") from exc


@app.get("/dahua/{device_id}/live")
def dahua_live(
    device_id: str,
    channel: int = 1,
    subtype: int = 2,
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    """MJPEG fluido desde RTSP (subtype 2 = stream nativo vertical en lectores faciales ASI, con fallback a 1)."""
    _authorize(authorization, token)
    _ensure_dahua_config()
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    try:
        sub = int(subtype)
    except (TypeError, ValueError):
        sub = 2
    ch = int(channel) or 1

    def gen():
        try:
            yield from iter_mjpeg(dev, channel=ch, subtype=sub)
        except Exception as exc:  # noqa: BLE001
            # Un frame JPEG de error no rompe el multipart; el cliente reintenta.
            print(f"Live RTSP error: {exc}")

    return StreamingResponse(
        gen(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Connection": "close",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/dahua/{device_id}/qr-config")
def dahua_qr_config_get(
    device_id: str,
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    _authorize(authorization, token)
    _ensure_dahua_config()
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    return _client(dev).get_qr_config()


@app.post("/dahua/{device_id}/qr-config")
def dahua_qr_config_post(
    device_id: str,
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    _authorize(authorization, token)
    _ensure_dahua_config()
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    enable = bool(payload.get("transmissionEnable", True))
    valid_time = int(payload.get("validTime") or 15)
    return _client(dev).set_qr_config(enable, valid_time)


@app.get("/dahua/{device_id}/schedules")
def dahua_schedules_get(
    device_id: str,
    count: int = 16,
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    _authorize(authorization, token)
    _ensure_dahua_config()
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    return {"ok": True, "schedules": _client(dev).get_time_schedules(count)}


@app.post("/dahua/{device_id}/schedules")
def dahua_schedules_post(
    device_id: str,
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    _authorize(authorization, token)
    _ensure_dahua_config()
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    idx = int(payload.get("index") or 0)
    enable = bool(payload.get("enabled", True))
    days = payload.get("days") or []
    return _client(dev).set_time_schedule(idx, enable, days)


@app.post("/dahua/{device_id}/listen-card")
def dahua_listen_card(
    device_id: str,
    payload: dict[str, Any] | None = None,
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    _authorize(authorization, token)
    _ensure_dahua_config()
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    timeout = int((payload or {}).get("timeout") or 15)
    return _client(dev).listen_card(timeout)

