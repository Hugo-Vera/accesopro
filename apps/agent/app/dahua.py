from __future__ import annotations

import re
from typing import Any

import requests
from requests.auth import HTTPBasicAuth, HTTPDigestAuth

TIMEOUT = 6


def parse_table(text: str) -> list[dict[str, str]]:
    rows: dict[int, dict[str, str]] = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        match = re.search(r"\[(\d+)\]\.(.+)$", key.strip())
        if match:
            idx = int(match.group(1))
            rows.setdefault(idx, {})[match.group(2)] = value.strip()
    return [rows[i] for i in sorted(rows)]


class DahuaClient:
    def __init__(self, host: str, username: str, password: str, port: int = 80) -> None:
        self.base = f"http://{host}:{port}"
        self.username = username
        self.password = password
        self.session = requests.Session()

    def _get(self, path: str) -> str:
        url = f"{self.base}{path}"
        last_error: Exception | None = None
        for auth in (
            HTTPDigestAuth(self.username, self.password),
            HTTPBasicAuth(self.username, self.password),
        ):
            try:
                res = self.session.get(url, auth=auth, timeout=TIMEOUT)
                if res.status_code in (401, 403):
                    last_error = RuntimeError(f"HTTP {res.status_code}")
                    continue
                res.raise_for_status()
                return res.text
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise last_error or RuntimeError("Sin respuesta del equipo Dahua")

    def system_info(self) -> dict[str, str]:
        text = self._get("/cgi-bin/magicBox.cgi?action=getSystemInfo")
        info: dict[str, str] = {}
        for line in text.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                info[k.strip()] = v.strip()
        return info

    def open_door(self, channel: int = 1) -> str:
        return self._get(f"/cgi-bin/accessControl.cgi?action=openDoor&channel={channel}")

    def access_records(self, count: int = 30) -> list[dict[str, str]]:
        text = self._get(
            f"/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&count={count}"
        )
        return parse_table(text)

    def probe(self) -> dict[str, Any]:
        info = self.system_info()
        return {
            "ok": True,
            "deviceType": info.get("deviceType") or info.get("type") or info.get("table.deviceType"),
            "serial": info.get("serialNumber") or info.get("table.serialNumber"),
            "raw": {k: v for k, v in info.items() if k in ("deviceType", "serialNumber", "hardwareVersion", "updateSerial")},
        }
