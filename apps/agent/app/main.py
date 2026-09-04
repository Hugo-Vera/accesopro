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


def _poll_dahua() -> None:
    for dev in _config.get("dahua", []):
        try:
            records = _client(dev).access_records(20)
        except Exception as exc:  # noqa: BLE001
            print(f"Dahua {dev.get('name')}: {exc}")
            continue
        primed = dev["id"] in _primed_dahua
        for rec in records:
            stamp = rec.get("CreateTime") or rec.get("Time") or ""
            key = f"{dev['id']}:{stamp}:{rec.get('CardNo','')}:{rec.get('UserID','')}:{rec.get('Method','')}"
            if key in _seen_records:
                continue
            _seen_records.add(key)
            if len(_seen_records) > 400:
                _seen_records.clear()
            if not primed:
                continue
            try:
                api_post(
                    "/agent/events",
                    {
                        "type": "dahua_access",
                        "payload": {
                            "deviceId": dev["id"],
                            "deviceName": dev.get("name"),
                            **rec,
                        },
                    },
                )
            except Exception as exc:  # noqa: BLE001
                print(f"Evento Dahua no enviado: {exc}")
        _primed_dahua.add(dev["id"])


def _run_command(cmd: dict[str, Any]) -> dict[str, Any]:
    action = cmd.get("action")
    payload = cmd.get("payload") or {}
    if action == "open":
        return _open(payload.get("actuatorId"))
    if action == "probe_dahua":
        dev = _device(payload.get("deviceId"))
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
    return {"ok": False, "error": f"Acción desconocida: {action}"}


def loop() -> None:
    dahua_tick = 0
    while not _stop.is_set():
        try:
            api_post("/agent/heartbeat", {})
            _config.update(api_get("/agent/config"))
            alpr.sync(_config.get("cameras") or [])
            cmds = api_get("/agent/commands").get("commands") or []
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
            dahua_tick += 1
            if dahua_tick % 4 == 0:
                _poll_dahua()
        except Exception as exc:  # noqa: BLE001
            print(f"Agent: {exc}")
        time.sleep(1.2)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    t = threading.Thread(target=loop, daemon=True)
    t.start()
    print(f"AccesoPro agent -> {API}")
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
    subtype: int = 1,
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    """MJPEG fluido desde RTSP (subtype 1 = stream extra)."""
    _authorize(authorization, token)
    _ensure_dahua_config()
    dev = _device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    sub = 0 if int(subtype) == 0 else 1
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
