from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable

PlateCallback = Callable[[str, str, float], None]


def normalize_plate(raw: str) -> str:
    return "".join(ch for ch in raw.upper() if ch.isalnum())


class AlprWorker:
    def __init__(self, on_plate: PlateCallback) -> None:
        self.on_plate = on_plate
        self._stop = threading.Event()
        self._threads: dict[str, threading.Thread] = {}
        self._alpr = None
        self._last: dict[str, tuple[str, float]] = {}

    def _engine(self):
        if self._alpr is not None:
            return self._alpr
        from fast_alpr import ALPR

        try:
            self._alpr = ALPR(
                detector_model="yolo-v9-t-384-license-plate-end2end",
                ocr_model="argentinian-plates-cnn-synth-model",
            )
        except Exception:
            self._alpr = ALPR(
                detector_model="yolo-v9-t-384-license-plate-end2end",
                ocr_model="cct-xs-v2-global-model",
            )
        return self._alpr

    def sync(self, cameras: list[dict[str, Any]]) -> None:
        # ALPR principal = apps/site (AccesoSeguro). El worker del agent
        # solo si AGENT_ALPR=1 (YOLO + OpenCV satura CPU en Windows).
        if os.environ.get("AGENT_ALPR", "0").strip() != "1":
            return
        wanted = {cam["id"]: cam for cam in cameras if cam.get("rtspUrl")}
        for cam_id in list(self._threads):
            if cam_id not in wanted:
                self._threads.pop(cam_id, None)
        for cam_id, cam in wanted.items():
            if cam_id in self._threads and self._threads[cam_id].is_alive():
                continue
            t = threading.Thread(target=self._loop, args=(cam,), daemon=True)
            self._threads[cam_id] = t
            t.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self, cam: dict[str, Any]) -> None:
        try:
            import cv2
        except ImportError:
            print("ALPR: falta opencv-python-headless")
            return
        cam_id = cam["id"]
        url = cam["rtspUrl"]
        print(f"ALPR camara {cam.get('name')} -> {url.split('@')[-1] if '@' in url else url}")
        while not self._stop.is_set():
            cap = cv2.VideoCapture(url)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not cap.isOpened():
                print(f"ALPR no abre RTSP ({cam.get('name')}), reintento en 8s")
                time.sleep(8)
                continue
            frame_i = 0
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    break
                frame_i += 1
                if frame_i % 8 != 0:
                    continue
                try:
                    engine = self._engine()
                    results = engine.predict(frame)
                except Exception as exc:  # noqa: BLE001
                    print(f"ALPR error: {exc}")
                    time.sleep(2)
                    continue
                for item in results or []:
                    text, conf = _read_result(item)
                    if not text or conf < 0.45:
                        continue
                    plate = normalize_plate(text)
                    if len(plate) < 5:
                        continue
                    prev = self._last.get(cam_id)
                    now = time.time()
                    if prev and prev[0] == plate and now - prev[1] < 30:
                        continue
                    self._last[cam_id] = (plate, now)
                    self.on_plate(cam_id, plate, conf)
            cap.release()
            time.sleep(3)


def _read_result(item: Any) -> tuple[str, float]:
    ocr = getattr(item, "ocr", None) or getattr(item, "plate", None)
    if ocr is None:
        return "", 0.0
    text = getattr(ocr, "text", None) or getattr(item, "text", "") or ""
    conf = getattr(ocr, "confidence", None) or getattr(item, "confidence", 0) or 0
    try:
        conf_f = float(conf)
        if conf_f > 1:
            conf_f = conf_f / 100.0
    except (TypeError, ValueError):
        conf_f = 0.0
    return str(text), conf_f
