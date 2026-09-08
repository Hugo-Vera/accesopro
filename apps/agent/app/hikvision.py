"""Cliente ISAPI mínimo para cámaras / NVR Hikvision (probe + snapshot)."""
from __future__ import annotations

import base64
import re
from typing import Any
from xml.etree import ElementTree as ET

import requests
from requests.auth import HTTPBasicAuth, HTTPDigestAuth
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TIMEOUT = 6


def looks_like_hikvision(dev: dict[str, Any] | None) -> bool:
    if not dev:
        return False
    brand = str(dev.get("cameraBrand") or dev.get("camera_brand") or "").strip().lower()
    if brand == "hikvision":
        return True
    url = str(dev.get("rtspUrl") or dev.get("rtsp_url") or "")
    return bool(re.search(r"Streaming/Channels|/h264/ch|ISAPI/Streaming", url, re.I))


def hikvision_picture_channel(channel: int = 1, subtype: int = 0) -> int:
    ch = max(1, int(channel) or 1)
    stream = 2 if int(subtype or 0) == 1 else 1
    return ch * 100 + stream


class HikvisionClient:
    def __init__(self, host: str, username: str, password: str, port: int = 80) -> None:
        port_num = int(port or 80)
        scheme = "https" if port_num in (443, 8443) else "http"
        self.base = f"{scheme}://{host}:{port_num}"
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.verify = False

    def probe(self) -> dict[str, Any]:
        text = self._get("/ISAPI/System/deviceInfo")
        info = _xml_flat(text)
        model = info.get("model") or info.get("devicename") or info.get("devicetype")
        serial = info.get("serialnumber") or info.get("macaddress")
        if not model and not serial:
            raise RuntimeError("El equipo no respondió como Hikvision (ISAPI)")
        return {
            "ok": True,
            "deviceType": model,
            "serial": serial,
            "brand": "hikvision",
            "raw": {k: v for k, v in info.items() if k in ("model", "devicename", "serialnumber", "firmwareversion")},
        }

    def snapshot(self, channel: int = 1) -> dict[str, Any]:
        raw, ctype = self.snapshot_jpeg(channel)
        return {
            "ok": True,
            "contentType": ctype,
            "imageBase64": base64.b64encode(raw).decode("ascii"),
            "bytes": len(raw),
        }

    def snapshot_jpeg(self, channel: int = 1) -> tuple[bytes, str]:
        code = hikvision_picture_channel(channel, 0)
        path = f"/ISAPI/Streaming/channels/{code}/picture"
        last_error: Exception | None = None
        for auth in (
            HTTPDigestAuth(self.username, self.password),
            HTTPBasicAuth(self.username, self.password),
        ):
            try:
                res = self.session.get(
                    f"{self.base}{path}",
                    auth=auth,
                    timeout=TIMEOUT,
                    verify=False,
                    headers={"Accept": "image/jpeg"},
                )
                if res.status_code in (401, 403):
                    last_error = RuntimeError(f"HTTP {res.status_code}")
                    continue
                res.raise_for_status()
                ctype = res.headers.get("Content-Type", "") or "image/jpeg"
                if "image" not in ctype and not res.content.startswith(b"\xff\xd8"):
                    raise RuntimeError("El equipo no devolvió una imagen")
                return res.content, ctype.split(";")[0].strip() or "image/jpeg"
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise last_error or RuntimeError("Sin snapshot del equipo Hikvision")

    def _get(self, path: str) -> str:
        last_error: Exception | None = None
        for auth in (
            HTTPDigestAuth(self.username, self.password),
            HTTPBasicAuth(self.username, self.password),
        ):
            try:
                res = self.session.get(f"{self.base}{path}", auth=auth, timeout=TIMEOUT, verify=False)
                if res.status_code in (401, 403):
                    last_error = RuntimeError(f"HTTP {res.status_code}")
                    continue
                res.raise_for_status()
                return res.text
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise last_error or RuntimeError("Sin respuesta del equipo Hikvision")


def _xml_flat(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return out
    for el in root.iter():
        tag = el.tag.split("}")[-1].strip().lower()
        if el.text and el.text.strip():
            out[tag] = el.text.strip()
    return out
