from __future__ import annotations
import logging
import threading
import time

from ..config import settings

logger = logging.getLogger("relay")


class BarrierDevice:
    """
    Representa una barrera fisica individual (Entrada o Salida).
    Soporta los siguientes modos (settings.barrier_type_*):
      - disabled: Desactivada.
      - simulated: Simulada, escribe en los logs del sistema.
      - com: Puerto COM (Arduino/Serial) con hilo de escucha dedicado.
      - ip: Controlador Relay IP (TCP raw string / HTTP GET).
    """

    def __init__(self, sentido: str) -> None:
        self.sentido = sentido
        self._ser = None
        self._is_open = False
        self._opened_at = 0.0
        self._running = True
        self._lock = threading.RLock()
        self.on_sensor_pulse = None  # Se define externamente para propagar la masa metalica
        self.reload()

    def reload(self) -> None:
        """Carga y aplica la configuracion actual de Settings."""
        with self._lock:
            self._close_connection()

            if self.sentido == "in":
                self.type = settings.barrier_type_in
                self.port = settings.barrier_port_in
                self.baudrate = settings.barrier_baudrate_in
                self.ip = settings.barrier_ip_in
                self.ip_port = settings.barrier_ip_port_in
                self.ip_protocol = settings.barrier_ip_protocol_in
                self.ip_cmd_open = settings.barrier_ip_cmd_open_in
                self.ip_cmd_close = settings.barrier_ip_cmd_close_in
                self.max_open_sec = settings.barrier_max_open_sec_in
            else:
                self.type = settings.barrier_type_out
                self.port = settings.barrier_port_out
                self.baudrate = settings.barrier_baudrate_out
                self.ip = settings.barrier_ip_out
                self.ip_port = settings.barrier_ip_port_out
                self.ip_protocol = settings.barrier_ip_protocol_out
                self.ip_cmd_open = settings.barrier_ip_cmd_open_out
                self.ip_cmd_close = settings.barrier_ip_cmd_close_out
                self.max_open_sec = settings.barrier_max_open_sec_out

            self._running = True
            if self.type == "com":
                self._connect_serial()

    def _close_connection(self) -> None:
        """Detiene hilos y cierra puerto serial si existe."""
        self._running = False
        with self._lock:
            if self._ser:
                try:
                    self._ser.close()
                except Exception:
                    pass
                self._ser = None

    def _connect_serial(self) -> None:
        port = self.port.strip()
        if not port:
            logger.warning(f"[BARRIER {self.sentido.upper()}] Puerto COM no configurado - operando simulado")
            return
        threading.Thread(target=self._serial_worker, daemon=True).start()

    def _serial_worker(self) -> None:
        port = self.port.strip()
        import serial
        retry_delay = 1.0
        max_retry_delay = 8.0

        while self._running:
            try:
                # Intentar abrir puerto serial
                ser = serial.Serial(port=port, baudrate=self.baudrate, timeout=1.0)
                with self._lock:
                    self._ser = ser
                retry_delay = 1.0  # Reiniciar delay al conectar con éxito
                logger.info(f"[BARRIER {self.sentido.upper()}] Conectado exitosamente en {port} a {self.baudrate} baudios")

                # Bucle de lectura de eventos seriales
                while self._running and self._ser:
                    line = self._ser.readline().decode(errors="ignore").strip()
                    if not line:
                        continue
                    logger.debug(f"[BARRIER {self.sentido.upper()}] <- {line}")
                    # Manejar pulsos de paso (masa metálica detectada)
                    if line == "PASSED_IN" and self.on_sensor_pulse:
                        self.on_sensor_pulse("in")
                    elif line == "PASSED_OUT" and self.on_sensor_pulse:
                        self.on_sensor_pulse("out")
                    elif line == "PASSED" and self.on_sensor_pulse:
                        self.on_sensor_pulse(self.sentido)

            except Exception as exc:
                with self._lock:
                    if self._ser:
                        try:
                            self._ser.close()
                        except Exception:
                            pass
                        self._ser = None

                logger.warning(
                    f"[BARRIER {self.sentido.upper()}] Error en conexión serial COM ({port}): {exc}. "
                    f"Reintentando en {retry_delay:.1f} segundos..."
                )

                # Espera segura e interrumpible
                steps = int(retry_delay * 10)
                for _ in range(steps):
                    if not self._running:
                        break
                    time.sleep(0.1)

                retry_delay = min(retry_delay * 2, max_retry_delay)

    def open(self) -> bool:
        with self._lock:
            if self.type == "disabled":
                logger.warning(f"[BARRIER {self.sentido.upper()}] Apertura denegada: Barrera desactivada")
                return False

            self._is_open = True
            self._opened_at = time.time()

            if self.type == "simulated":
                logger.info(f"[BARRIER {self.sentido.upper()} SIMULADA] Comando ABRIR")

            elif self.type == "com":
                cmd = "OPEN_IN" if self.sentido == "in" else "OPEN_OUT"
                if self._ser:
                    try:
                        self._ser.write(f"{cmd}\n".encode())
                        logger.info(f"[BARRIER {self.sentido.upper()} COM] -> {cmd}")
                    except Exception as exc:
                        logger.error(f"[BARRIER {self.sentido.upper()} COM] Error enviando comando: {exc}")
                        return False
                else:
                    logger.warning(f"[BARRIER {self.sentido.upper()} COM] Sin conexion serial - operacion simulada")

            elif self.type == "ip":
                ip_addr = self.ip.strip()
                if not ip_addr:
                    logger.error(f"[BARRIER {self.sentido.upper()} IP] Direccion IP vacia")
                    return False

                cmd = self.ip_cmd_open.strip()
                if self.ip_protocol == "tcp":
                    import socket
                    try:
                        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        sock.settimeout(3.0)
                        sock.connect((ip_addr, self.ip_port))
                        sock.sendall(cmd.encode("utf-8"))
                        sock.close()
                        logger.info(f"[BARRIER {self.sentido.upper()} TCP] -> {cmd} a {ip_addr}:{self.ip_port}")
                    except Exception as exc:
                        logger.error(f"[BARRIER {self.sentido.upper()} TCP] Error de socket a {ip_addr}: {exc}")
                        return False
                else:  # http
                    import urllib.request
                    url = cmd
                    if not url.startswith("http://") and not url.startswith("https://"):
                        url = f"http://{ip_addr}:{self.ip_port}/{url.lstrip('/')}"
                    try:
                        req = urllib.request.Request(url, method="GET")
                        with urllib.request.urlopen(req, timeout=3.0) as response:
                            _ = response.read()
                        logger.info(f"[BARRIER {self.sentido.upper()} HTTP] GET a {url} exitoso")
                    except Exception as exc:
                        logger.error(f"[BARRIER {self.sentido.upper()} HTTP] GET a {url} fallido: {exc}")
                        return False

            logger.info(f"[BARRIER {self.sentido.upper()}] Barrera ABIERTA")
            return True

    def close(self) -> bool:
        with self._lock:
            if self.type == "disabled":
                return False

            self._is_open = False
            self._opened_at = 0.0

            if self.type == "simulated":
                logger.info(f"[BARRIER {self.sentido.upper()} SIMULADA] Comando CERRAR")

            elif self.type == "com":
                cmd = "CLOSE_IN" if self.sentido == "in" else "CLOSE_OUT"
                if self._ser:
                    try:
                        self._ser.write(f"{cmd}\n".encode())
                        logger.info(f"[BARRIER {self.sentido.upper()} COM] -> {cmd}")
                    except Exception as exc:
                        logger.error(f"[BARRIER {self.sentido.upper()} COM] Error enviando comando: {exc}")
                        return False
                else:
                    logger.warning(f"[BARRIER {self.sentido.upper()} COM] Sin conexion serial - operacion simulada")

            elif self.type == "ip":
                ip_addr = self.ip.strip()
                if not ip_addr:
                    logger.error(f"[BARRIER {self.sentido.upper()} IP] Direccion IP vacia")
                    return False

                cmd = self.ip_cmd_close.strip()
                if self.ip_protocol == "tcp":
                    import socket
                    try:
                        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        sock.settimeout(3.0)
                        sock.connect((ip_addr, self.ip_port))
                        sock.sendall(cmd.encode("utf-8"))
                        sock.close()
                        logger.info(f"[BARRIER {self.sentido.upper()} TCP] -> {cmd} a {ip_addr}:{self.ip_port}")
                    except Exception as exc:
                        logger.error(f"[BARRIER {self.sentido.upper()} TCP] Error de socket a {ip_addr}: {exc}")
                        return False
                else:  # http
                    import urllib.request
                    url = cmd
                    if not url.startswith("http://") and not url.startswith("https://"):
                        url = f"http://{ip_addr}:{self.ip_port}/{url.lstrip('/')}"
                    try:
                        req = urllib.request.Request(url, method="GET")
                        with urllib.request.urlopen(req, timeout=3.0) as response:
                            _ = response.read()
                        logger.info(f"[BARRIER {self.sentido.upper()} HTTP] GET a {url} exitoso")
                    except Exception as exc:
                        logger.error(f"[BARRIER {self.sentido.upper()} HTTP] GET a {url} fallido: {exc}")
                        return False

            logger.info(f"[BARRIER {self.sentido.upper()}] Barrera CERRADA")
            return True


class RelayController:
    """
    Controlador centralizado que administra e interactua con
    las dos barreras individuales de Entrada y Salida.
    """

    def __init__(self) -> None:
        self.in_barrier = BarrierDevice("in")
        self.out_barrier = BarrierDevice("out")

        # Vincular callbacks de pulso de masa metalica
        self.in_barrier.on_sensor_pulse = self._handle_pulse
        self.out_barrier.on_sensor_pulse = self._handle_pulse

        self.on_sensor_pulse = None  # Definido por access_controller / eventos
        self.on_watchdog_close = None  # Definido por access_controller para auditoría
        self._running = True
        threading.Thread(target=self._watchdog_loop, daemon=True).start()

    def _handle_pulse(self, sentido: str) -> None:
        if self.on_sensor_pulse:
            self.on_sensor_pulse(sentido)

    def reload(self) -> None:
        """Propaga cambios de Settings a ambas barreras."""
        logger.info("[RELAY] Recargando configuracion de barreras")
        self.in_barrier.reload()
        self.out_barrier.reload()

    def open(self, sentido: str = "in") -> bool:
        if sentido == "in":
            return self.in_barrier.open()
        else:
            return self.out_barrier.open()

    def close(self, sentido: str = "in") -> bool:
        if sentido == "in":
            return self.in_barrier.close()
        else:
            return self.out_barrier.close()

    def ping(self) -> bool:
        logger.info("[RELAY] Ping recibido")
        return True

    def status(self) -> dict:
        now = time.time()
        elap_in = round(now - self.in_barrier._opened_at, 1) if self.in_barrier._is_open else 0.0
        elap_out = round(now - self.out_barrier._opened_at, 1) if self.out_barrier._is_open else 0.0
        return {
            "open_in": self.in_barrier._is_open,
            "open_out": self.out_barrier._is_open,
            "in": self.in_barrier._is_open,
            "out": self.out_barrier._is_open,
            "simulated": self.in_barrier.type == "simulated" or self.out_barrier.type == "simulated",
            "port": self.in_barrier.port if self.in_barrier.type == "com" else "simulado/ip",
            "open_since_sec_in": elap_in,
            "open_since_sec_out": elap_out,
            "in_open_since": elap_in,
            "out_open_since": elap_out,
            "max_open_sec_in": self.in_barrier.max_open_sec,
            "max_open_sec_out": self.out_barrier.max_open_sec,
            "barrier_in_status": self.in_barrier.type,
            "barrier_out_status": self.out_barrier.type,
        }

    def _watchdog_loop(self) -> None:
        while self._running:
            time.sleep(1)
            now = time.time()

            # Watchdog Entrada
            if self.in_barrier._is_open and self.in_barrier._opened_at > 0:
                if self.in_barrier.max_open_sec > 0 and (now - self.in_barrier._opened_at) >= self.in_barrier.max_open_sec:
                    logger.warning("[RELAY WATCHDOG] Cierre forzado IN por timeout")
                    self.in_barrier.close()
                    if self.on_watchdog_close:
                        try:
                            self.on_watchdog_close("in")
                        except Exception as exc:
                            logger.error(f"[RELAY] Error en callback on_watchdog_close (in): {exc}")

            # Watchdog Salida
            if self.out_barrier._is_open and self.out_barrier._opened_at > 0:
                if self.out_barrier.max_open_sec > 0 and (now - self.out_barrier._opened_at) >= self.out_barrier.max_open_sec:
                    logger.warning("[RELAY WATCHDOG] Cierre forzado OUT por timeout")
                    self.out_barrier.close()
                    if self.on_watchdog_close:
                        try:
                            self.on_watchdog_close("out")
                        except Exception as exc:
                            logger.error(f"[RELAY] Error en callback on_watchdog_close (out): {exc}")


relay = RelayController()
