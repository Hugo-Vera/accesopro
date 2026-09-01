from __future__ import annotations
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

import cv2

logger = logging.getLogger("qr_service")


@dataclass
class DNIData:
    """
    Datos extraidos del QR del DNI argentino.
    """

    dni: str
    nombre: str
    apellido: str
    sexo: str
    nacimiento: str
    raw: str = field(default="", repr=False)
    tramite: str = ""
    ejemplar: str = ""

    @classmethod
    def from_qr_string(cls, raw: str) -> "DNIData | None":
        """Parsea string QR del DNI argentino. Retorna None si no es valido."""
        try:
            raw_s = raw.strip()
            parts = [p.strip() for p in raw_s.split("@")]
            if parts and parts[0] == "":
                parts.pop(0)
            if len(parts) < 6:
                return None
                
            # Formato estandar moderno provisto por el usuario:
            # 0: Tramite (digitos)
            # 1: Apellido
            # 2: Nombre
            # 3: DNI (digitos)
            # 4: Ejemplar (un caracter, ej: D) o Sexo
            # 5: Nacimiento (fecha DD/MM/YY)
            # 6: Emision (fecha DD/MM/YY)
            
            if len(parts) >= 6 and parts[3].isdigit() and len(parts[4]) == 1 and "/" in parts[5]:
                return cls(
                    tramite=parts[0],
                    apellido=parts[1],
                    nombre=parts[2],
                    dni=parts[3],
                    ejemplar=parts[4],
                    sexo="",
                    nacimiento=parts[5],
                    raw=raw_s
                )
            
            # Caso alternativo o legado
            offset = 1 if parts[0].isdigit() else 0
            tramite = parts[0] if offset == 1 else ""
            p_apellido = parts[offset]
            p_nombre = parts[offset + 1] if len(parts) > offset + 1 else ""
            p_sexo = parts[offset + 2] if len(parts) > offset + 2 else ""
            p_dni = parts[offset + 3] if len(parts) > offset + 3 else ""
            p_nacimiento = parts[offset + 5] if len(parts) > offset + 5 else ""
            p_ejemplar = ""
            
            if p_sexo.isdigit() and len(p_sexo) >= 7 and len(p_dni) == 1:
                p_ejemplar = p_dni
                p_dni = p_sexo
                p_sexo = ""
                if len(parts) > offset + 4 and "/" in parts[offset + 4]:
                    p_nacimiento = parts[offset + 4]
                elif len(parts) > offset + 5 and "/" in parts[offset + 5]:
                    p_nacimiento = parts[offset + 5]
            
            return cls(
                apellido=p_apellido,
                nombre=p_nombre,
                sexo=p_sexo,
                dni=p_dni,
                nacimiento=p_nacimiento,
                tramite=tramite,
                ejemplar=p_ejemplar,
                raw=raw_s,
            )
        except Exception:
            return None

    def nombre_completo(self) -> str:
        return f"{self.nombre} {self.apellido}"


class QRService:
    """
    Lector continuo de QR de DNI argentino desde camara.

    Corre en hilo daemon. Dispara callbacks registrados cuando detecta un DNI valido.
    Incluye deduplicacion para no disparar el mismo DNI dos veces en pocos segundos.
    """

    def __init__(self, sentido: str = "in") -> None:
        self.sentido = sentido
        from ..config import settings
        if self.sentido == "in":
            self._source_type = settings.qr_source_type_in
            self._camera_source = str(settings.qr_camera_source_in)
            self._com_port = str(settings.qr_com_port_in)
        else:
            self._source_type = settings.qr_source_type_out
            self._camera_source = str(settings.qr_camera_source_out)
            self._com_port = str(settings.qr_com_port_out)
            
        self._detector = cv2.QRCodeDetector()
        self._callbacks: list[Callable[[DNIData], None]] = []
        self._running = False
        self._threads: list[threading.Thread] = []
        self._last_dni: str = ""
        self._last_ts: float = 0.0
        self._dedup_sec: float = 5.0
        self.latest_jpeg: bytes = b""
        self.last_error: str = ""
        self._active_thread_cam: threading.Thread | None = None
        self._active_thread_com: threading.Thread | None = None

    def register_on_scan(self, cb: Callable[[DNIData], None]) -> None:
        self._callbacks.append(cb)

    def start(self) -> None:
        if self._running or self._source_type == "disabled":
            return
        self._running = True
        self._threads = []
        
        if self._source_type in ["camera", "both"]:
            logger.info(f"[QR {self.sentido.upper()}] Modo de escaneo por camara CCTV descontinuado por limitaciones fisicas de resolucion.")
            self.last_error = "Modo camara descontinuado"
            
        if self._source_type in ["com", "both"]:
            port = str(self._com_port).strip()
            if not port:
                self.last_error = "Puerto COM no configurado"
                logger.warning(f"[QR {self.sentido.upper()}] {self.last_error}")
            else:
                t_com = threading.Thread(target=self._worker_com, daemon=True)
                self._active_thread_com = t_com
                self._threads.append(t_com)
                t_com.start()
                
        if not self._threads:
            self._running = False
            
        logger.info(f"[QR {self.sentido.upper()}] Servicio iniciado — tipo: {self._source_type}")

    def stop(self) -> None:
        self._running = False
        self._active_thread_cam = None
        self._active_thread_com = None

    def restart(self) -> None:
        self.stop()
        time.sleep(0.25)
        from ..config import settings
        if self.sentido == "in":
            self._source_type = settings.qr_source_type_in
            self._camera_source = str(settings.qr_camera_source_in)
            self._com_port = str(settings.qr_com_port_in)
        else:
            self._source_type = settings.qr_source_type_out
            self._camera_source = str(settings.qr_camera_source_out)
            self._com_port = str(settings.qr_com_port_out)
        self.start()

    def status(self) -> dict:
        return {
            "running": self._running,
            "type": self._source_type,
            "camera_source": self._camera_source,
            "com_port": self._com_port,
            "last_error": self.last_error,
        }

    # ── Workers ────────────────────────────────────────────────────────────

    def _process_qr_data(self, data: str) -> None:
        if not data or "@" not in data:
            return
        dni_data = DNIData.from_qr_string(data)
        if dni_data and dni_data.dni:
            now = time.time()
            if dni_data.dni != self._last_dni or (now - self._last_ts) > self._dedup_sec:
                self._last_dni = dni_data.dni
                self._last_ts = now
                logger.info(f"[QR {self.sentido.upper()}] DNI leido: {dni_data.dni} — {dni_data.nombre_completo()}")
                for cb in self._callbacks:
                    try:
                        # Append the sentido to the dni_data so the access_controller knows where it came from
                        setattr(dni_data, "sentido", self.sentido)
                        cb(dni_data)
                    except Exception as exc:
                        logger.error(f"[QR {self.sentido.upper()}] Callback error: {exc}")

    def _worker_com(self) -> None:
        port = self._com_port.strip()
        if not port:
            self.last_error = "Puerto COM no configurado"
            logger.warning("[QR %s] %s", self.sentido.upper(), self.last_error)
            current_thread = threading.current_thread()
            if self._active_thread_com is current_thread:
                if not self._active_thread_cam or not self._active_thread_cam.is_alive():
                    self._running = False
            return

        import serial
        current_thread = threading.current_thread()
        retry_delay = 1.0
        max_retry_delay = 10.0

        while self._running and self._active_thread_com is current_thread:
            try:
                ser = serial.Serial(port, baudrate=9600, timeout=1.0)
                self.last_error = ""
                retry_delay = 1.0  # Reiniciar delay al conectar
                logger.info(f"[QR {self.sentido.upper()}] Escuchando COM port: {port}")
                
                buffer = ""
                while self._running and self._active_thread_com is current_thread:
                    if ser.in_waiting > 0:
                        chunk = ser.read(ser.in_waiting).decode(errors="ignore")
                        logger.debug(f"[COM {port}] RAW: {repr(chunk)}")
                        buffer += chunk
                        if '\r' in buffer or '\n' in buffer:
                            lines = buffer.replace('\r', '\n').split('\n')
                            for line in lines[:-1]:
                                line = line.strip()
                                if line:
                                    self._process_qr_data(line)
                            buffer = lines[-1]
                    time.sleep(0.05)
                ser.close()
                logger.info(f"[QR {self.sentido.upper()}] COM port {port} cerrado.")
            except Exception as exc:
                self.last_error = f"Error en COM {port}: {exc}"
                logger.error(f"[QR {self.sentido.upper()}] {self.last_error}. Reintentando en {retry_delay:.1f}s...")
                
                # Esperar retry_delay segundos antes de reintentar
                steps = int(retry_delay * 10)
                for _ in range(steps):
                    if not self._running or self._active_thread_com is not current_thread:
                        break
                    time.sleep(0.1)
                
                retry_delay = min(retry_delay * 2, max_retry_delay)

        current_thread = threading.current_thread()
        if self._active_thread_com is current_thread:
            # Solo detiene la bandera global running si no hay hilo de camara activo
            if not self._active_thread_cam or not self._active_thread_cam.is_alive():
                self._running = False

    def _worker_camera(self) -> None:
        pass


# Singleton
_qr_instances: dict[str, QRService] = {}


def get_qr(sentido: str = "in") -> QRService:
    if sentido not in _qr_instances:
        _qr_instances[sentido] = QRService(sentido)
    return _qr_instances[sentido]
