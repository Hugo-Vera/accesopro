from __future__ import annotations

import re
from typing import Any

import requests
from requests.auth import HTTPBasicAuth, HTTPDigestAuth
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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
        port_num = int(port or 80)
        scheme = "https" if port_num in (443, 8443) else "http"
        self.base = f"{scheme}://{host}:{port_num}"
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.verify = False

    def _get(self, path: str) -> str:
        url = f"{self.base}{path}"
        last_error: Exception | None = None
        for auth in (
            HTTPDigestAuth(self.username, self.password),
            HTTPBasicAuth(self.username, self.password),
        ):
            try:
                res = self.session.get(url, auth=auth, timeout=TIMEOUT, verify=False)
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
                res = self.session.get(url, auth=auth, timeout=TIMEOUT, verify=False)
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

    def access_records(self, count: int = 50, start_time: int | None = None) -> list[dict[str, str]]:
        url = f"/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&count={count}"
        if start_time:
            url += f"&StartTime={int(start_time)}"
        text = self._get(url)
        return parse_table(text)

    def clear_access_records(self) -> dict[str, Any]:
        """Borra todos los registros de accesos en la memoria física del equipo Dahua ASI."""
        text = self._get("/cgi-bin/recordUpdater.cgi?action=clear&name=AccessControlCardRec")
        ok = "ok" in text.lower() or "success" in text.lower()
        return {"ok": ok, "response": text.strip()}

    def get_record_snapshot(self, snapshot_url: str) -> tuple[bytes, str]:
        """Descarga la foto exacta tomada por el equipo Dahua durante la validación de acceso."""
        if not snapshot_url:
            raise RuntimeError("Falta URL de snapshot")
        clean_url = snapshot_url.strip()
        if not clean_url.startswith("/"):
            clean_url = f"/{clean_url}"
        sid = self._rpc_login()
        if not sid:
            raise RuntimeError("Fallo de autenticación RPC con el equipo Dahua")
        inst = self._rpc_send("FileManager.factory.instance", session_id=sid)
        obj_id = inst.get("result")
        if not obj_id:
            raise RuntimeError(f"No se pudo inicializar FileManager: {inst}")
        dl = self._rpc_send("FileManager.downloadFile", {"fileName": clean_url}, object_id=obj_id, session_id=sid)
        if not dl.get("result"):
            raise RuntimeError(f"El equipo Dahua no encontró la captura solicitada ({clean_url})")
        load_path = f"/RPC2_Loadfile{clean_url}"
        res = self._request("GET", load_path, cookies={"DhWebClientSessionID": sid, "session": sid})
        if res.status_code != 200 or len(res.content) < 50:
            raise RuntimeError(f"No se pudo descargar la imagen (HTTP {res.status_code})")
        ctype = res.headers.get("Content-Type", "") or "image/jpeg"
        return res.content, ctype.split(";")[0].strip() or "image/jpeg"

    def _parse_event_content(self, content: str) -> dict[str, Any] | None:
        import json
        import re
        m = re.search(r"data\s*=\s*(\{.*?\})", content, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(1))
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
        res: dict[str, Any] = {}
        for part in content.split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                res[k.strip()] = v.strip()
        return res if res else None

    def stream_events(self):
        """Abre un stream HTTP multipart continuo contra el terminal Dahua para recibir eventos instantáneos en tiempo real sin polling."""
        url = f"{self.base}/cgi-bin/eventManager.cgi?action=attach&codes=[AccessControl]"
        for auth in (
            HTTPDigestAuth(self.username, self.password),
            HTTPBasicAuth(self.username, self.password),
        ):
            try:
                with self.session.get(url, auth=auth, stream=True, timeout=(6.0, None), verify=False) as res:
                    if res.status_code in (401, 403):
                        continue
                    if res.status_code != 200:
                        break
                    buf: list[str] = []
                    for raw_line in res.iter_lines():
                        if raw_line is None:
                            continue
                        line = raw_line.decode("utf-8", errors="ignore").strip()
                        if not line:
                            continue
                        if line.startswith("--"):
                            if buf:
                                content = " ".join(buf)
                                buf.clear()
                                if "AccessControl" in content or "data=" in content:
                                    ev = self._parse_event_content(content)
                                    if ev:
                                        yield ev
                            continue
                        buf.append(line)
                    return
            except Exception:
                pass

    def probe(self) -> dict[str, Any]:
        info = self.system_info()
        model = info.get("updateSerial") or info.get("deviceType") or info.get("type") or info.get("table.deviceType")
        return {
            "ok": True,
            "deviceType": model,
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
                res = self.session.request(method, url, auth=auth, timeout=timeout, verify=False, **kwargs)
                if res.status_code in (401, 403):
                    last_error = RuntimeError(f"HTTP {res.status_code}")
                    continue
                return res
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise last_error or RuntimeError("Sin respuesta del equipo Dahua")

    def _rpc_login(self) -> str | None:
        import hashlib
        try:
            r1_res = self.session.post(
                f"{self.base}/RPC2_Login",
                json={
                    "method": "global.login",
                    "params": {"userName": self.username, "password": "", "clientType": "Web3.0"},
                    "id": 1,
                    "session": 0,
                },
                timeout=5,
            )
            r1 = r1_res.json()
            params = r1.get("params") or {}
            session = r1.get("session") or 0
            realm = params.get("realm") or ""
            random = params.get("random") or ""
            if not realm or not random:
                return None

            def md5_upper(s: str) -> str:
                return hashlib.md5(s.encode("utf-8")).hexdigest().upper()

            c_upper = md5_upper(f"{self.username}:{realm}:{self.password}")
            pwd_upper = md5_upper(f"{self.username}:{random}:{c_upper}")

            r2_res = self.session.post(
                f"{self.base}/RPC2_Login",
                json={
                    "method": "global.login",
                    "params": {
                        "userName": self.username,
                        "password": pwd_upper,
                        "clientType": "Web3.0",
                        "authorityType": "Default",
                    },
                    "id": 2,
                    "session": session,
                },
                timeout=5,
            )
            r2 = r2_res.json()
            if r2.get("result"):
                return str(r2.get("session") or "")
        except Exception:
            pass
        return None

    def _rpc_send(self, method: str, params: Any = None, object_id: Any = None, session_id: str | None = None) -> dict[str, Any]:
        sid = session_id or self._rpc_login()
        if not sid:
            return {}
        payload: dict[str, Any] = {
            "method": method,
            "params": params,
            "id": 10,
            "session": sid,
        }
        if object_id is not None:
            payload["object"] = object_id
        try:
            res = self.session.post(
                f"{self.base}/RPC2",
                json=payload,
                timeout=8,
            )
            return res.json()
        except Exception:
            return {}

    def get_latest_access_records(self, count: int = 5) -> list[dict[str, Any]]:
        sid = self._rpc_login()
        if not sid:
            return []
        try:
            cr = self._rpc_send("RecordFinder.factory.create", {"name": "AccessControlCardRec"}, session_id=sid)
            obj = cr.get("result")
            if not obj:
                return []
            self._rpc_send("RecordFinder.startFind", {"condition": None}, object_id=obj, session_id=sid)
            qs = self._rpc_send("RecordFinder.getQuerySize", None, object_id=obj, session_id=sid)
            total = int(qs.get("params", {}).get("count") or 0)
            records: list[dict[str, Any]] = []
            if total > 0:
                cnt = min(count, total)
                offset = max(0, total - cnt)
                rec = self._rpc_send("RecordFinder.doSeekFind", {"count": cnt, "offset": offset}, object_id=obj, session_id=sid)
                records = rec.get("params", {}).get("records") or []
            self._rpc_send("RecordFinder.stopFind", None, object_id=obj, session_id=sid)
            self._rpc_send("RecordFinder.destroy", None, object_id=obj, session_id=sid)
            return records
        except Exception:
            return []

    def list_persons(self, count: int = 200) -> dict[str, Any]:
        text = self._get(
            f"/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCard&count={int(count) or 200}"
        )
        rows = parse_table(text)
        user_ids = []
        for r in rows:
            uid = (r.get("UserID") or r.get("userId") or "").strip()
            if uid and uid not in user_ids:
                user_ids.append(uid)

        rpc_users: dict[str, Any] = {}
        rpc_faces: dict[str, Any] = {}
        rpc_fps: dict[str, int] = {}

        if user_ids:
            try:
                sid = self._rpc_login()
                if sid:
                    u_resp = self._rpc_send("AccessUser.list", {"UserIDList": user_ids}, session_id=sid)
                    for u in u_resp.get("params", {}).get("Users", []):
                        if u.get("UserID"):
                            rpc_users[str(u["UserID"])] = u

                    f_resp = self._rpc_send("AccessFace.list", {"UserIDList": user_ids}, session_id=sid)
                    for f in f_resp.get("params", {}).get("FaceDataList", []):
                        if f.get("UserID"):
                            rpc_faces[str(f["UserID"])] = f

                    for uid in user_ids[:30]:
                        fp_resp = self._rpc_send("AccessFingerprint.startFind", {"Condition": {"UserID": uid}}, session_id=sid)
                        rpc_fps[uid] = int(fp_resp.get("params", {}).get("Total") or 0)
            except Exception:
                pass

        people = []
        for r in rows:
            uid = (r.get("UserID") or r.get("userId") or "").strip()
            u_info = rpc_users.get(uid) or {}
            f_info = rpc_faces.get(uid) or {}
            fp_count = rpc_fps.get(uid, 0)

            photos = f_info.get("PhotoData") or []
            photo_b64 = photos[0] if photos else None

            v_start = u_info.get("ValidFrom") or r.get("ValidDateStart") or "1970-01-01 00:00:00"
            v_end = u_info.get("ValidTo") or r.get("ValidDateEnd") or "2037-12-31 23:59:59"
            t_sections = u_info.get("TimeSections") or []
            period_idx = int(t_sections[0]) if t_sections else (int(r.get("TimeSections[0]") or 255))
            pwd = u_info.get("Password") or r.get("Password") or ""

            people.append(
                {
                    "userId": uid,
                    "name": u_info.get("UserName") or r.get("CardName") or r.get("UserName") or r.get("name") or "",
                    "cardNo": r.get("CardNo") or r.get("cardNo") or "",
                    "recNo": r.get("RecNo") or r.get("recNo") or "",
                    "cardStatus": r.get("CardStatus") or "",
                    "password": pwd,
                    "validDateStart": v_start,
                    "validDateEnd": v_end,
                    "periodIndex": period_idx,
                    "userType": int(u_info.get("UserType") if u_info.get("UserType") is not None else (r.get("UserType") or 0)),
                    "useTime": int(u_info.get("UseTime") if u_info.get("UseTime") is not None else (r.get("UseTime") or 0)),
                    "photoBase64": photo_b64,
                    "faceCount": len(photos),
                    "fingerprintCount": fp_count,
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
        valid_date_start: str | None = None,
        valid_date_end: str | None = None,
        period_index: int | None = None,
        user_type: int = 0,
        use_time: int = 0,
    ) -> dict[str, Any]:
        from urllib.parse import quote

        uid = str(user_id).strip()
        card = str(card_no).strip()
        if not uid or not card:
            return {"ok": False, "error": "Faltan UserID o CardNo"}

        v_start = (valid_date_start or "1970-01-01 00:00:00").strip()
        v_end = (valid_date_end or "2037-12-31 23:59:59").strip()
        period = 255 if period_index is None else int(period_index)

        # Verificar si la persona ya existe en el lector para actualizarla en lugar de duplicar
        existing_recno = None
        try:
            persons_list = self.list_persons(500).get("persons", [])
            for p in persons_list:
                if str(p.get("userId")).strip() == uid or str(p.get("cardNo")).strip() == card:
                    existing_recno = p.get("recNo")
                    break
        except Exception:
            pass

        if existing_recno:
            # En Dahua ASI, la actualización requiere recno en minúsculas
            params = [
                "action=update",
                "name=AccessControlCard",
                f"recno={quote(str(existing_recno))}",
                f"CardName={quote(name.strip() or uid)}",
                f"CardNo={quote(card)}",
                f"UserID={quote(uid)}",
                "CardStatus=0",
                f"CardType=0",
                f"UserType={int(user_type)}",
                f"UseTime={int(use_time)}",
                f"ValidDateStart={quote(v_start)}",
                f"ValidDateEnd={quote(v_end)}",
                f"TimeSections[0]={period}",
            ]
        else:
            params = [
                "action=insert",
                "name=AccessControlCard",
                f"CardName={quote(name.strip() or uid)}",
                f"CardNo={quote(card)}",
                f"UserID={quote(uid)}",
                "CardStatus=0",
                f"CardType=0",
                f"UserType={int(user_type)}",
                f"UseTime={int(use_time)}",
                f"ValidDateStart={quote(v_start)}",
                f"ValidDateEnd={quote(v_end)}",
                f"TimeSections[0]={period}",
            ]

        if password:
            params.append(f"Password={quote(str(password))}")
        for i, door in enumerate(doors or [0]):
            params.append(f"Doors[{i}]={int(door)}")

        path = "/cgi-bin/recordUpdater.cgi?" + "&".join(params)
        res = self._request("GET", path, timeout=12)
        body = (res.text or "").strip()

        # Si el insert falló porque el registro ya existía, intentar update
        if not existing_recno and (res.status_code >= 400 or (body and body.upper().startswith("ERROR"))):
            try:
                persons_list = self.list_persons(500).get("persons", [])
                for p in persons_list:
                    if str(p.get("userId")).strip() == uid or str(p.get("cardNo")).strip() == card:
                        existing_recno = p.get("recNo")
                        break
                if existing_recno:
                    params[0] = "action=update"
                    params.insert(2, f"recno={quote(str(existing_recno))}")
                    path2 = "/cgi-bin/recordUpdater.cgi?" + "&".join(params)
                    res = self._request("GET", path2, timeout=12)
                    body = (res.text or "").strip()
            except Exception:
                pass

        if res.status_code >= 400 or (body and body.upper().startswith("ERROR")):
            return {"ok": False, "error": body[:300] or f"HTTP {res.status_code}", "response": body[:300]}
        return {"ok": True, "userId": uid, "cardNo": card, "name": name, "recNo": existing_recno, "response": body[:200] or "OK"}

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
            # Intentar update si ya existía rostro
            res2 = self._request(
                "POST",
                "/cgi-bin/FaceInfoManager.cgi?action=update",
                data=json.dumps(payload),
                headers={"Content-Type": "application/json"},
                timeout=30,
            )
            body2 = (res2.text or "").strip()
            if res2.status_code >= 400 or (body2 and "Error" in body2 and "OK" not in body2.upper()):
                err_text = "El lector no reconoció un rostro válido en la foto (asegurar buena luz y rostro de frente)" if ("Bad Request" in (body2 or body)) else (body2 or body or f"HTTP {res.status_code}")[:300]
                return {
                    "ok": False,
                    "error": err_text,
                    "response": (body2 or body)[:300],
                }
            return {"ok": True, "userId": uid, "response": body2[:200] or "OK", "updated": True}
        return {"ok": True, "userId": uid, "response": body[:200] or "OK"}

    def get_qr_config(self) -> dict[str, Any]:
        text = self._get("/cgi-bin/configManager.cgi?action=getConfig&name=QRCode")
        info: dict[str, str] = {}
        for line in text.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                info[k.strip()] = v.strip()
        enabled = info.get("table.QRCode.TransmissionEnable", "").lower() == "true"
        valid_time = int(info.get("table.QRCode.ValidTime", 10) or 10)
        return {"ok": True, "transmissionEnable": enabled, "validTime": valid_time, "raw": info}

    def set_qr_config(self, enable: bool = True, valid_time: int = 15) -> dict[str, Any]:
        en_str = "true" if enable else "false"
        res1 = self._request("GET", f"/cgi-bin/configManager.cgi?action=setConfig&QRCode.TransmissionEnable={en_str}", timeout=6)
        res2 = self._request("GET", f"/cgi-bin/configManager.cgi?action=setConfig&QRCode.ValidTime={int(valid_time)}", timeout=6)
        return {
            "ok": res1.status_code == 200 and res2.status_code == 200,
            "transmissionEnable": enable,
            "validTime": valid_time,
            "res1": res1.text.strip(),
            "res2": res2.text.strip(),
        }

    def get_time_schedules(self, count: int = 16) -> list[dict[str, Any]]:
        schedules = []
        for idx in range(min(count, 32)):
            try:
                text = self._get(f"/cgi-bin/configManager.cgi?action=getConfig&name=AccessTimeSchedule[{idx}]")
                if "Error" in text and "table.AccessTimeSchedule" not in text:
                    continue
                info: dict[str, str] = {}
                for line in text.splitlines():
                    if "=" in line:
                        k, v = line.split("=", 1)
                        info[k.strip()] = v.strip()
                enabled = info.get(f"table.AccessTimeSchedule[{idx}].Enable", "").lower() == "true"
                # 7 days (0=Sunday to 6=Saturday) x up to 4 sections
                days: list[list[str]] = []
                for day in range(7):
                    day_slots: list[str] = []
                    for slot in range(4):
                        key = f"table.AccessTimeSchedule[{idx}].TimeSchedule[{day}][{slot}]"
                        val = info.get(key, "1 00:00:00-00:00:00")
                        day_slots.append(val)
                    days.append(day_slots)
                schedules.append({
                    "index": idx,
                    "label": f"Periodo {idx + 1}" if idx > 0 else "Periodo 1 (Base)",
                    "enabled": enabled,
                    "days": days,
                })
            except Exception:
                continue
        return schedules

    def set_time_schedule(self, index: int, enable: bool, days: list[list[str]]) -> dict[str, Any]:
        idx = int(index)
        params = [f"AccessTimeSchedule[{idx}].Enable={'true' if enable else 'false'}"]
        for day_idx, slots in enumerate(days[:7]):
            for slot_idx, val in enumerate(slots[:4]):
                params.append(f"AccessTimeSchedule[{idx}].TimeSchedule[{day_idx}][{slot_idx}]={val.strip()}")
        query = "&".join(params)
        res = self._request("GET", f"/cgi-bin/configManager.cgi?action=setConfig&{query}", timeout=10)
        return {"ok": res.status_code == 200, "status": res.status_code, "text": res.text.strip()}

    def listen_card(self, timeout_sec: int = 15) -> dict[str, Any]:
        import time
        t0 = time.time()
        start_rec_no = None
        try:
            initial = self.get_latest_access_records(3)
            if initial:
                start_rec_no = max([int(r.get("RecNo") or 0) for r in initial])
        except Exception:
            pass

        while time.time() - t0 < timeout_sec:
            time.sleep(0.5)
            try:
                latest = self.get_latest_access_records(5)
                for r in latest:
                    rec_no = int(r.get("RecNo") or 0)
                    card = str(r.get("CardNo") or "").strip()
                    if (start_rec_no is None or rec_no > start_rec_no) and card:
                        return {
                            "ok": True,
                            "cardNo": card,
                            "userId": str(r.get("UserID") or ""),
                            "name": str(r.get("CardName") or ""),
                            "time": str(r.get("CreateTime") or ""),
                        }
            except Exception:
                pass
        return {"ok": False, "timeout": True, "error": "Tiempo de espera agotado. No se detectó ninguna tarjeta aproximada al lector."}

    def remove_person(self, *, user_id: str | None = None, rec_no: str | None = None, card_no: str | None = None) -> dict[str, Any]:
        from urllib.parse import quote

        rec = rec_no
        if not rec:
            try:
                persons_list = self.list_persons(500).get("persons", [])
                for p in persons_list:
                    if (user_id and str(p.get("userId")).strip() == str(user_id).strip()) or (card_no and str(p.get("cardNo")).strip() == str(card_no).strip()):
                        rec = p.get("recNo")
                        break
            except Exception:
                pass

        if not rec:
            return {"ok": False, "error": f"No se encontró el registro en el lector para eliminar (ID: {user_id or card_no})"}

        # Dahua ASI requiere recno en minúsculas
        path = f"/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&recno={quote(str(rec))}"
        res = self._request("GET", path, timeout=12)
        body = (res.text or "").strip()

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


