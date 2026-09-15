from __future__ import annotations

import re
import threading
import time
from collections import deque
from typing import Any

import requests
from requests.auth import HTTPBasicAuth, HTTPDigestAuth
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TIMEOUT = 6

_cgi_mu = threading.Lock()
_cgi_inflight = 0
_cgi_by_kind: dict[str, int] = {}
_cgi_recent: deque[dict[str, Any]] = deque(maxlen=40)
_cgi_window: deque[float] = deque()
_host_locks: dict[str, threading.RLock] = {}
_host_locks_mu = threading.Lock()


def _host_lock(base: str) -> threading.RLock:
    with _host_locks_mu:
        lock = _host_locks.get(base)
        if lock is None:
            lock = threading.RLock()
            _host_locks[base] = lock
        return lock


def cgi_kind(path: str) -> str:
    p = (path or "").lower()
    if "eventmanager" in p:
        return "attach"
    if "rpc2_loadfile" in p or "filemanager" in p:
        return "filemanager"
    if "recordfinder" in p:
        return "recordfinder"
    if "snapshot.cgi" in p:
        return "snapshot"
    if "rpc2_login" in p:
        return "rpc_login"
    if "/rpc2" in p:
        return "rpc"
    if "faceinfomanager" in p:
        return "face"
    if "recordupdater" in p:
        return "record_update"
    if "configmanager" in p:
        return "config"
    if "magicbox" in p:
        return "probe"
    if "accesscontrol.cgi" in p:
        return "door"
    return "other"


def _cgi_begin(kind: str) -> float:
    global _cgi_inflight
    with _cgi_mu:
        _cgi_inflight += 1
        _cgi_by_kind[kind] = _cgi_by_kind.get(kind, 0) + 1
    return time.perf_counter()


def _cgi_end(kind: str, path: str, t0: float, ok: bool, err: str | None = None) -> None:
    global _cgi_inflight
    ms = int((time.perf_counter() - t0) * 1000)
    now = time.time()
    with _cgi_mu:
        _cgi_inflight = max(0, _cgi_inflight - 1)
        _cgi_window.append(now)
        while _cgi_window and now - _cgi_window[0] > 60:
            _cgi_window.popleft()
        rec: dict[str, Any] = {"t": int(now), "kind": kind, "path": (path or "")[:96], "ms": ms, "ok": ok}
        if err:
            rec["err"] = err[:160]
        _cgi_recent.appendleft(rec)


def cgi_stats() -> dict[str, Any]:
    now = time.time()
    with _cgi_mu:
        while _cgi_window and now - _cgi_window[0] > 60:
            _cgi_window.popleft()
        return {
            "inflight": _cgi_inflight,
            "last60s": len(_cgi_window),
            "byKind": dict(_cgi_by_kind),
            "recent": list(_cgi_recent)[:16],
        }


"""Nodos que se sondean en el descubrimiento del firmware (Fase 0). Ver `raw_config_dump`."""
CONFIG_PROBE_NODES = (
    "QRCode",
    "AccessControl",
    "BackEndComparison",
    "CardNoTransmission",
    "AccessGeneral",
    "FaceSnapshot",
    "AccessTimeSchedule[0]",
)


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
        self._rpc_sid: str | None = None
        self._rpc_sid_at = 0.0

    def _get(self, path: str) -> str:
        url = f"{self.base}{path}"
        kind = cgi_kind(path)
        last_error: Exception | None = None
        with _host_lock(self.base):
            t0 = _cgi_begin(kind)
            try:
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
                        _cgi_end(kind, path, t0, True)
                        return res.text
                    except Exception as exc:  # noqa: BLE001
                        last_error = exc
                raise last_error or RuntimeError("Sin respuesta del equipo Dahua")
            except Exception as exc:
                _cgi_end(kind, path, t0, False, str(exc))
                raise

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
        path = f"/cgi-bin/snapshot.cgi?channel={channel}"
        url = f"{self.base}{path}"
        kind = "snapshot"
        last_error: Exception | None = None
        with _host_lock(self.base):
            t0 = _cgi_begin(kind)
            try:
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
                        _cgi_end(kind, path, t0, True)
                        return res.content, ctype.split(";")[0].strip() or "image/jpeg"
                    except Exception as exc:  # noqa: BLE001
                        last_error = exc
                raise last_error or RuntimeError("Sin snapshot del equipo")
            except Exception as exc:
                _cgi_end(kind, path, t0, False, str(exc))
                raise

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

    def _extract_json_object(self, text: str) -> dict[str, Any] | None:
        import json

        brace = text.find("{")
        if brace < 0:
            return None
        depth = 0
        in_str = False
        esc = False
        for i in range(brace, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        data = json.loads(text[brace : i + 1])
                    except Exception:
                        return None
                    return data if isinstance(data, dict) else None
        return None

    def _parse_event_content(self, content: str) -> dict[str, Any] | None:
        blob = content.strip()
        if not blob or blob.lower().startswith("heartbeat"):
            return None
        data = self._extract_json_object(blob)
        if isinstance(data, dict):
            inner = data.get("data") if isinstance(data.get("data"), dict) else None
            if inner is None and isinstance(data.get("Data"), dict):
                inner = data.get("Data")
            return {**data, **(inner or {})} if inner else data
        res: dict[str, Any] = {}
        for part in blob.replace("\n", ";").split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                res[k.strip()] = v.strip()
        return res if res else None

    def stream_events(self, on_heartbeat=None):
        """Attach HTTP del ASI (PDF Access Control: codes=[AccessControl], heartbeat=5)."""
        url = (
            f"{self.base}/cgi-bin/eventManager.cgi"
            "?action=attach&codes=[AccessControl]&heartbeat=5"
        )
        last_error: Exception | None = None
        for auth in (
            HTTPDigestAuth(self.username, self.password),
            HTTPBasicAuth(self.username, self.password),
        ):
            try:
                with self.session.get(url, auth=auth, stream=True, timeout=(8.0, 25.0), verify=False) as res:
                    if res.status_code in (401, 403):
                        last_error = RuntimeError(f"attach HTTP {res.status_code}")
                        continue
                    if res.status_code != 200:
                        raise RuntimeError(f"attach HTTP {res.status_code}")
                    if on_heartbeat:
                        on_heartbeat()
                    buf = ""
                    for chunk in res.iter_content(chunk_size=512):
                        if not chunk:
                            continue
                        buf += chunk.decode("utf-8", errors="ignore")
                        if len(buf) > 250_000:
                            buf = buf[-80_000:]
                        while True:
                            cut = -1
                            seplen = 0
                            for sep in ("\r\n--", "\n--", "\r\n\r\n", "\n\n"):
                                idx = buf.find(sep)
                                if idx >= 0 and (cut < 0 or idx < cut):
                                    cut = idx
                                    seplen = len(sep)
                            if cut < 0:
                                if "data=" in buf and buf.rstrip().endswith("}"):
                                    ev = self._parse_event_content(buf)
                                    buf = ""
                                    if ev:
                                        yield ev
                                break
                            part, buf = buf[:cut], buf[cut + seplen :]
                            low = part.lower()
                            if "heartbeat" in low and "data=" not in low:
                                if on_heartbeat:
                                    on_heartbeat()
                                continue
                            if "accesscontrol" in low or "facerecognition" in low or "data=" in low or "{" in part:
                                ev = self._parse_event_content(part)
                                if ev:
                                    yield ev
                    return
            except Exception as extra:  # noqa: BLE001
                print(f"Dahua attach {self.base}: {extra}")
                last_error = extra
                continue
        if last_error:
            raise last_error

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
        kind = cgi_kind(path)
        with _host_lock(self.base):
            t0 = _cgi_begin(kind)
            try:
                for auth in (
                    HTTPDigestAuth(self.username, self.password),
                    HTTPBasicAuth(self.username, self.password),
                ):
                    try:
                        res = self.session.request(method, url, auth=auth, timeout=timeout, verify=False, **kwargs)
                        if res.status_code in (401, 403):
                            last_error = RuntimeError(f"HTTP {res.status_code}")
                            continue
                        _cgi_end(kind, path, t0, True)
                        return res
                    except Exception as exc:  # noqa: BLE001
                        last_error = exc
                raise last_error or RuntimeError("Sin respuesta del equipo Dahua")
            except Exception as exc:
                _cgi_end(kind, path, t0, False, str(exc))
                raise

    def _rpc_login(self, force: bool = False) -> str | None:
        import hashlib

        if not force and self._rpc_sid and (time.time() - self._rpc_sid_at) < 45:
            return self._rpc_sid
        kind = "rpc_login"
        path = "/RPC2_Login"
        with _host_lock(self.base):
            t0 = _cgi_begin(kind)
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
                    self._rpc_sid = None
                    _cgi_end(kind, path, t0, False, "sin realm")
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
                    self._rpc_sid = str(r2.get("session") or "")
                    self._rpc_sid_at = time.time()
                    _cgi_end(kind, path, t0, True)
                    return self._rpc_sid
                self._rpc_sid = None
                _cgi_end(kind, path, t0, False, "login rejected")
            except Exception as exc:  # noqa: BLE001
                self._rpc_sid = None
                _cgi_end(kind, path, t0, False, str(exc))
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
        kind = cgi_kind(method)
        with _host_lock(self.base):
            t0 = _cgi_begin(kind)
            try:
                res = self.session.post(
                    f"{self.base}/RPC2",
                    json=payload,
                    timeout=8,
                )
                data = res.json()
                _cgi_end(kind, method, t0, True)
                return data if isinstance(data, dict) else {}
            except Exception as exc:  # noqa: BLE001
                self._rpc_sid = None
                _cgi_end(kind, method, t0, False, str(exc))
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

    def list_persons(self, count: int = 200, fingerprints: bool = False, include_faces: bool = False) -> dict[str, Any]:
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

                    # AccessFace.list trae JPEG de todas las caras: solo si la UI lo pide.
                    if include_faces:
                        f_resp = self._rpc_send("AccessFace.list", {"UserIDList": user_ids}, session_id=sid)
                        for f in f_resp.get("params", {}).get("FaceDataList", []):
                            if f.get("UserID"):
                                rpc_faces[str(f["UserID"])] = f

                    if fingerprints:
                        for uid in user_ids[:30]:
                            fp_resp = self._rpc_send(
                                "AccessFingerprint.startFind",
                                {"Condition": {"UserID": uid}},
                                session_id=sid,
                            )
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
        card_type: int = 0,
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

        # Una persona admite varias tarjetas: se actualiza solo la fila UserID+CardNo.
        # Si el UserID existe con otro CardNo, se inserta una fila nueva (hasta 5).
        existing_recno = None
        try:
            persons_list = self.list_persons(500).get("persons", [])
            for p in persons_list:
                same_user = str(p.get("userId")).strip() == uid
                same_card = str(p.get("cardNo")).strip() == card
                if same_user and same_card:
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
                f"CardType={int(card_type)}",
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
                f"CardType={int(card_type)}",
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
                    same_user = str(p.get("userId")).strip() == uid
                    same_card = str(p.get("cardNo")).strip() == card
                    if same_user and same_card:
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

    def remove_card(self, *, user_id: str | None = None, card_no: str | None = None, rec_no: str | None = None) -> dict[str, Any]:
        """Baja una sola credencial (tarjeta o QR replicado como CardNo) sin tocar la cara."""
        from urllib.parse import quote

        rec = rec_no
        if not rec:
            try:
                persons_list = self.list_persons(500).get("persons", [])
                for p in persons_list:
                    same_user = not user_id or str(p.get("userId")).strip() == str(user_id).strip()
                    same_card = not card_no or str(p.get("cardNo")).strip() == str(card_no).strip()
                    if same_user and same_card and (user_id or card_no):
                        rec = p.get("recNo")
                        break
            except Exception:
                pass
        if not rec:
            return {"ok": False, "error": "No se encontró esa credencial en el lector"}
        path = f"/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&recno={quote(str(rec))}"
        res = self._request("GET", path, timeout=12)
        body = (res.text or "").strip()
        if res.status_code >= 400 or (body and body.upper().startswith("ERROR")):
            return {"ok": False, "error": body[:300] or f"HTTP {res.status_code}"}
        return {"ok": True, "response": body[:200] or "OK"}

    def get_access_control(self) -> dict[str, Any]:
        text = self._get("/cgi-bin/configManager.cgi?action=getConfig&name=AccessControl")
        info: dict[str, str] = {}
        for line in text.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                info[k.strip()] = v.strip()
        return {"ok": True, "raw": info}

    def raw_config_dump(self, nodes: list[str] | None = None) -> dict[str, Any]:
        """Volcado sin filtrar de nodos de config: para medir el firmware, no para operar.

        `QRCode` y `AccessControl` existen seguro. El resto es sondeo para ubicar el
        "Card No. Pass-through" del bloque Back-end Comparison del manual, que no
        sabemos en qué nodo vive en este firmware.
        """
        out: dict[str, Any] = {}
        for node in nodes or list(CONFIG_PROBE_NODES):
            try:
                text = self._get(f"/cgi-bin/configManager.cgi?action=getConfig&name={node}")
            except Exception as exc:  # noqa: BLE001
                out[node] = {"ok": False, "error": str(exc)[:200]}
                continue
            lines: dict[str, str] = {}
            for line in text.splitlines():
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                lines[k.strip().replace("table.", "")] = v.strip()
            if not lines:
                out[node] = {"ok": False, "error": (text or "").strip()[:200] or "sin datos"}
                continue
            out[node] = {"ok": True, "count": len(lines), "lines": lines}
        return {"ok": True, "nodes": out}

    def raw_person_rows(self, count: int = 20) -> dict[str, Any]:
        """Filas crudas de AccessControlCard para leer UserType, CardType, UseTime y ValidDate
        tal como los guarda el equipo. Incluye el texto sin parsear porque la forma exacta de
        las claves es justamente lo que hay que medir."""
        text = self._get(
            f"/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCard&count={int(count) or 20}"
        )
        rows = parse_table(text)
        return {"ok": True, "count": len(rows), "rows": rows, "raw": text[:6000]}

    def set_unlock_methods(
        self,
        *,
        face: bool = True,
        fingerprint: bool = False,
        card: bool = False,
        password: bool = False,
    ) -> dict[str, Any]:
        """Solo el nodo AccessControl. El QR se maneja aparte con `set_qr_config`, que es
        pass-through al back-end y no un método más de esta lista."""
        method = 0
        if password:
            method |= 1
        if fingerprint:
            method |= 2
        if card:
            method |= 4
        if face:
            method |= 8
        parts: list[str] = []
        if card:
            parts.append("Card")
        if fingerprint:
            parts.append("FingerPrint")
        if face:
            parts.append("Face")
        if password:
            parts.append("Password")
        open_method = ",".join(parts) if parts else "Face"
        flags = [
            f"AccessControl[0].FaceEnable={'true' if face else 'false'}",
            f"AccessControl[0].FingerEnable={'true' if fingerprint else 'false'}",
            f"AccessControl[0].CardEnable={'true' if card else 'false'}",
            f"AccessControl[0].PwdEnable={'true' if password else 'false'}",
            f"AccessControl[0].Method={method}",
            f"AccessControl[0].OpenMethod={open_method}",
        ]
        query = "&".join(flags)
        res = self._request("GET", f"/cgi-bin/configManager.cgi?action=setConfig&{query}", timeout=8)
        body = (res.text or "").strip()
        return {
            "ok": res.status_code == 200,
            "methods": {
                "face": face,
                "fingerprint": fingerprint,
                "card": card,
                "password": password,
            },
            "accessControl": body[:300],
        }

    def inspect(self) -> dict[str, Any]:
        """Config liviana del lector. Sin snapshot.cgi, RecordFinder ni FileManager."""

        def pick_lines(text: str, pred) -> dict[str, str]:
            out: dict[str, str] = {}
            for line in text.splitlines():
                if "=" not in line:
                    continue
                if not pred(line):
                    continue
                k, v = line.split("=", 1)
                out[k.strip().replace("table.", "")] = v.strip()
            return out

        info = self.system_info()
        door = self.door_status(1)
        ac: dict[str, str] = {}
        try:
            text = self._get("/cgi-bin/configManager.cgi?action=getConfig&name=AccessControl")
            ac = pick_lines(
                text,
                lambda line: (
                    any(
                        x in line
                        for x in (
                            "FaceEnable",
                            "FingerEnable",
                            "CardEnable",
                            "PwdEnable",
                            "OpenMethod",
                            "UnlockHoldInterval",
                            "MaliciousAccessControlEnable",
                        )
                    )
                    or (".Method=" in line and "TimeSchedule" not in line)
                ),
            )
        except Exception as exc:  # noqa: BLE001
            ac = {"error": str(exc)[:160]}
        rtsp: dict[str, str] = {}
        try:
            text = self._get("/cgi-bin/configManager.cgi?action=getConfig&name=RTSP")
            rtsp = pick_lines(text, lambda line: "Enable" in line or "RTSP.Port=" in line)
        except Exception as exc:  # noqa: BLE001
            rtsp = {"error": str(exc)[:160]}
        face_snap: dict[str, str] = {}
        try:
            text = self._get("/cgi-bin/configManager.cgi?action=getConfig&name=FaceSnapshot")
            face_snap = pick_lines(text, lambda _line: True)
        except Exception as exc:  # noqa: BLE001
            face_snap = {"error": str(exc)[:160]}
        qr: dict[str, Any] = {}
        try:
            qr = self.get_qr_config()
        except Exception as exc:  # noqa: BLE001
            qr = {"error": str(exc)[:160]}
        return {
            "ok": True,
            "system": {
                "deviceType": info.get("deviceType") or info.get("updateSerial"),
                "serial": info.get("serialNumber"),
                "hardware": info.get("hardwareVersion"),
                "processor": info.get("processor"),
            },
            "door": door.get("status"),
            "accessControl": ac,
            "rtsp": rtsp,
            "faceSnapshot": face_snap,
            "qr": qr,
        }



