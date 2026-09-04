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

    def door_status(self, channel: int = 1) -> dict[str, Any]:
        text = self._get(f"/cgi-bin/accessControl.cgi?action=getDoorStatus&channel={channel}")
        info: dict[str, str] = {}
        for line in text.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                info[k.strip()] = v.strip()
        status = info.get("Info.status") or info.get("status") or text.strip()
        return {"ok": True, "status": status, "raw": info or {"text": text[:200]}}

    def snapshot(self, channel: int = 1) -> dict[str, Any]:
        import base64

        raw, ctype = self.snapshot_jpeg(channel)
        return {
            "ok": True,
            "contentType": ctype,
            "imageBase64": base64.b64encode(raw).decode("ascii"),
            "bytes": len(raw),
        }

    def snapshot_jpeg(self, channel: int = 1) -> tuple[bytes, str]:
        url = f"{self.base}/cgi-bin/snapshot.cgi?channel={channel}"
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
                ctype = res.headers.get("Content-Type", "") or "image/jpeg"
                if "image" not in ctype and not res.content.startswith(b"\xff\xd8"):
                    raise RuntimeError("El equipo no devolvió una imagen")
                return res.content, ctype.split(";")[0].strip() or "image/jpeg"
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise last_error or RuntimeError("Sin snapshot del equipo")

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

    def _request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        url = f"{self.base}{path}"
        last_error: Exception | None = None
        timeout = kwargs.pop("timeout", TIMEOUT)
        for auth in (
            HTTPDigestAuth(self.username, self.password),
            HTTPBasicAuth(self.username, self.password),
        ):
            try:
                res = self.session.request(method, url, auth=auth, timeout=timeout, **kwargs)
                if res.status_code in (401, 403):
                    last_error = RuntimeError(f"HTTP {res.status_code}")
                    continue
                return res
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise last_error or RuntimeError("Sin respuesta del equipo Dahua")

    def list_persons(self, count: int = 200) -> dict[str, Any]:
        text = self._get(
            f"/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCard&count={int(count) or 200}"
        )
        rows = parse_table(text)
        people = []
        for r in rows:
            people.append(
                {
                    "userId": r.get("UserID") or r.get("userId") or "",
                    "name": r.get("CardName") or r.get("UserName") or r.get("name") or "",
                    "cardNo": r.get("CardNo") or r.get("cardNo") or "",
                    "recNo": r.get("RecNo") or r.get("recNo") or "",
                    "cardStatus": r.get("CardStatus") or "",
                    "raw": r,
                }
            )
        return {"ok": True, "persons": people, "count": len(people)}

    def upsert_person(
        self,
        *,
        user_id: str,
        name: str,
        card_no: str,
        password: str | None = None,
        doors: list[int] | None = None,
    ) -> dict[str, Any]:
        from urllib.parse import quote

        uid = str(user_id).strip()
        card = str(card_no).strip()
        if not uid or not card:
            return {"ok": False, "error": "Faltan UserID o CardNo"}
        params = [
            "action=insert",
            "name=AccessControlCard",
            f"CardName={quote(name.strip() or uid)}",
            f"CardNo={quote(card)}",
            f"UserID={quote(uid)}",
            "CardStatus=0",
            "CardType=0",
        ]
        if password:
            params.append(f"Password={quote(str(password))}")
        for i, door in enumerate(doors or [0]):
            params.append(f"Doors[{i}]={int(door)}")
        path = "/cgi-bin/recordUpdater.cgi?" + "&".join(params)
        res = self._request("GET", path, timeout=12)
        body = (res.text or "").strip()
        if res.status_code >= 400 or (body and body.upper().startswith("ERROR")):
            return {"ok": False, "error": body[:300] or f"HTTP {res.status_code}", "response": body[:300]}
        return {"ok": True, "userId": uid, "cardNo": card, "name": name, "response": body[:200] or "OK"}

    def add_face_photo(self, user_id: str, name: str, photo_jpeg_b64: str) -> dict[str, Any]:
        import json

        uid = str(user_id).strip()
        raw = photo_jpeg_b64.strip()
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        raw = "".join(raw.split())
        if not uid or not raw:
            return {"ok": False, "error": "Faltan UserID o foto"}
        payload = {
            "UserID": uid,
            "Info": {
                "UserName": name.strip() or uid,
                "PhotoData": [raw],
            },
        }
        res = self._request(
            "POST",
            "/cgi-bin/FaceInfoManager.cgi?action=add",
            data=json.dumps(payload),
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        body = (res.text or "").strip()
        if res.status_code >= 400 or (body and "Error" in body and "OK" not in body.upper()):
            # algunos firmware responden Error si ya existe: intentar update
            res2 = self._request(
                "POST",
                "/cgi-bin/FaceInfoManager.cgi?action=update",
                data=json.dumps(payload),
                headers={"Content-Type": "application/json"},
                timeout=30,
            )
            body2 = (res2.text or "").strip()
            if res2.status_code >= 400 or (body2 and "Error" in body2 and "OK" not in body2.upper()):
                return {
                    "ok": False,
                    "error": (body2 or body or f"HTTP {res.status_code}")[:300],
                    "response": (body2 or body)[:300],
                }
            return {"ok": True, "userId": uid, "response": body2[:200] or "OK", "updated": True}
        return {"ok": True, "userId": uid, "response": body[:200] or "OK"}

    def remove_person(self, *, user_id: str | None = None, rec_no: str | None = None, card_no: str | None = None) -> dict[str, Any]:
        from urllib.parse import quote

        if rec_no:
            path = f"/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&RecNo={quote(str(rec_no))}"
        elif card_no:
            path = f"/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&CardNo={quote(str(card_no))}"
        elif user_id:
            path = f"/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&UserID={quote(str(user_id))}"
        else:
            return {"ok": False, "error": "Falta UserID, CardNo o RecNo"}
        res = self._request("GET", path, timeout=12)
        body = (res.text or "").strip()
        # borrar cara si hay user
        face_msg = None
        if user_id:
            try:
                fres = self._request(
                    "GET",
                    f"/cgi-bin/FaceInfoManager.cgi?action=remove&UserID={quote(str(user_id))}",
                    timeout=12,
                )
                face_msg = (fres.text or "")[:120]
            except Exception as exc:  # noqa: BLE001
                face_msg = str(exc)
        if res.status_code >= 400 or (body and body.upper().startswith("ERROR")):
            return {"ok": False, "error": body[:300] or f"HTTP {res.status_code}", "face": face_msg}
        return {"ok": True, "response": body[:200] or "OK", "face": face_msg}
