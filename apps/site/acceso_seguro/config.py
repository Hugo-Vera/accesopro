from __future__ import annotations
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
import yaml

BASE_DIR = Path(__file__).parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    app_name: str = "AccesoSeguro"
    debug: bool = False

    # Seguridad JWT
    secret_key: str = "CAMBIA-ESTO-EN-PRODUCCION-usa-openssl-rand-hex-32"
    algorithm: str = "HS256"
    token_expire_minutes: int = 480  # 8 horas

    # === DATABASE / POSTGRESQL ===
    # El sistema utiliza exclusivamente PostgreSQL como motor de base de datos.
    # Evitamos SQLite para soportar alta concurrencia, acceso multi-usuario y escalabilidad.
    # La cadena de conexión se extrae por defecto de config.yaml si no está sobrescrita en un archivo `.env`.
    db_url: str = "postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/fastalpr"

    # === ALPR ===
    camera_source_in: str = ""         # URL RTSP, indice webcam, o vacio (INGRESO)
    camera_source_out: str = ""        # URL RTSP, indice webcam, o vacio (SALIDA)
    detector_model: str = "yolo-v9-t-384-license-plate-end2end"
    ocr_model: str = "cct-s-v2-global-model"
    ocr_device: str = "auto"           # auto | cpu | cuda
    inference_every_n: int = 8
    min_ocr_conf: float = 0.60
    min_detector_conf: float = 0.40
    readings_to_confirm: int = 2       # lecturas consistentes para confirmar patente
    readings_window_sec: float = 4.0   # ventana de tiempo para las N lecturas

    # === Filtro de formato de patente ===
    plate_filter_enabled: bool = True
    plate_filter_countries: list = ["AR", "BR", "UY", "PY", "CL"]  # Códigos ISO

    # === Relay / Arduino ===
    relay_port: str = ""               # "COM3" / "/dev/ttyUSB0" — vacio = simulado
    relay_baudrate: int = 9600
    relay_max_open_sec_in: int = 0   # watchdog emergencia ingreso (0 = desactivado)
    relay_max_open_sec_out: int = 0  # watchdog emergencia salida (0 = desactivado)

    # === Barreras Individuales (Nuevo) ===
    # Ingreso (IN)
    barrier_type_in: str = "simulated"       # disabled | simulated | com | ip
    barrier_port_in: str = ""
    barrier_baudrate_in: int = 9600
    barrier_ip_in: str = ""
    barrier_ip_port_in: int = 80
    barrier_ip_protocol_in: str = "tcp"      # tcp | http
    barrier_ip_cmd_open_in: str = ""
    barrier_ip_cmd_close_in: str = ""
    barrier_max_open_sec_in: int = 0

    # Salida (OUT)
    barrier_type_out: str = "simulated"      # disabled | simulated | com | ip
    barrier_port_out: str = ""
    barrier_baudrate_out: int = 9600
    barrier_ip_out: str = ""
    barrier_ip_port_out: int = 80
    barrier_ip_protocol_out: str = "tcp"     # tcp | http
    barrier_ip_cmd_open_out: str = ""
    barrier_ip_cmd_close_out: str = ""
    barrier_max_open_sec_out: int = 0

    # === ROI ===
    roi_enabled: bool = False
    roi_x: float = 0.0
    roi_y: float = 0.0
    roi_w: float = 1.0
    roi_h: float = 1.0

    # === ROI Salida (OUT) ===
    roi_out_enabled: bool = False
    roi_out_x: float = 0.0
    roi_out_y: float = 0.0
    roi_out_w: float = 1.0
    roi_out_h: float = 1.0

    # === Control de acceso ===
    # patente | dni | ambos | combinado
    auth_mode: str = "ambos"
    require_dni_qr: bool = True        # False = solo patente alcanza para abrir
    dedup_window_sec: float = 8.0      # ignorar misma patente por N segundos tras apertura
    match_window_sec: float = 15.0     # segundos para que lleguen patente + DNI
    allow_exit_without_entry: bool = True # Permite o rechaza la salida si no hay estadia abierta
    auto_register: bool = True            # Registro automático de visitas desconocidas

    # === Lector QR (DNI argentino) ===
    qr_source_type_in: str = "camera"  # "camera", "com", "both", "disabled"
    qr_camera_source_in: str = "0"     # indice de webcam USB o URL (IN)
    qr_com_port_in: str = ""           # COM4 (si type=com o both)

    qr_source_type_out: str = "camera"
    qr_camera_source_out: str = ""     # indice de webcam USB o URL (OUT)
    qr_com_port_out: str = ""          # COM5

    # === Camara de evidencia (foto al confirmar lectura) ===
    snapshot_camera_source_in: str = ""
    snapshot_enabled_in: bool = False
    snapshot_trigger_in: str = "ambos"
    snapshot_count_in: int = 1

    snapshot_camera_source_out: str = ""
    snapshot_enabled_out: bool = False
    snapshot_trigger_out: str = "ambos"
    snapshot_count_out: int = 1

    # === Purga de Evidencias / Disk Cleanup ===
    evidence_retention_days: int = 90  # Dias de retencion de evidencias

    # === Permisos de Roles ===
    vigilador_manual_trigger: bool = True
    propietario_auth_visits: bool = True

    # === Apertura Automatica (Nuevo) ===
    barrier_auto_open_in: bool = True
    barrier_auto_open_out: bool = True

    # === Superposición de Alerta en Pantalla (HUD) ===
    hud_overlay_enabled_in: bool = True
    hud_overlay_position_in: str = "bottom-left"
    hud_overlay_enabled_out: bool = True
    hud_overlay_position_out: str = "bottom-right"

    # === Ahorro de CPU / Detección de Movimiento ===
    motion_detection_enabled_in: bool = True
    motion_threshold_in: float = 0.005
    motion_cooldown_sec_in: float = 3.0
    motion_detection_enabled_out: bool = True
    motion_threshold_out: float = 0.005
    motion_cooldown_sec_out: float = 3.0




settings = Settings()


def _apply_legacy_yaml_defaults() -> None:
    """
    Compatibilidad con el sistema anterior (config.yaml raiz).
    Toma los mismos campos de video/modelo/sistema para que AccesoSeguro
    arranque con la misma camara, ROI y umbrales que ya funcionaban.
    """
    cfg_path = BASE_DIR.parent / "config.yaml"
    if not cfg_path.exists():
        return
    try:
        data = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        video = data.get("video") or {}
        video_salida = data.get("video_salida") or {}
        modelo = data.get("modelo") or {}
        sistema = data.get("sistema") or {}
        db = data.get("db") or {}
        
        # Base de Datos Postgres (extraída de config.yaml)
        # Leemos los parámetros para forzar la conexión a PostgreSQL, ignorando "engine".
        user = db.get("user", "postgres")
        pwd = db.get("password", "postgres")
        host = db.get("host", "127.0.0.1")
        port = db.get("port", 5432)
        name = db.get("name", "fastalpr")
        settings.db_url = f"postgresql+psycopg2://{user}:{pwd}@{host}:{port}/{name}"

        # Camara y frecuencia
        src_in = str(video.get("fuente_in") or video.get("fuente") or "").strip()
        if src_in:
            settings.camera_source_in = src_in
            
        # Camara OUT: permitir vacio explicito (no arrancar worker)
        if "fuente_out" in video:
            settings.camera_source_out = str(video.get("fuente_out") or "").strip()
        elif "fuente" in video_salida:
            settings.camera_source_out = str(video_salida.get("fuente") or "").strip()
        else:
            src_out = str(video.get("fuente_out") or video_salida.get("fuente") or "").strip()
            if src_out:
                settings.camera_source_out = src_out
        if "frecuencia_inferencia" in video:
            settings.inference_every_n = max(1, int(video.get("frecuencia_inferencia") or settings.inference_every_n))

        # ROI (IN)
        if "roi_enabled" in video:
            settings.roi_enabled = bool(video.get("roi_enabled"))
        if "roi_x" in video:
            settings.roi_x = float(video.get("roi_x") or settings.roi_x)
        if "roi_y" in video:
            settings.roi_y = float(video.get("roi_y") or settings.roi_y)
        if "roi_w" in video:
            settings.roi_w = float(video.get("roi_w") or settings.roi_w)
        if "roi_h" in video:
            settings.roi_h = float(video.get("roi_h") or settings.roi_h)
        if "hud_overlay_enabled" in video:
            settings.hud_overlay_enabled_in = bool(video.get("hud_overlay_enabled"))
        if "hud_overlay_position" in video:
            settings.hud_overlay_position_in = str(video.get("hud_overlay_position") or settings.hud_overlay_position_in)
        if "motion_detection_enabled" in video:
            settings.motion_detection_enabled_in = bool(video.get("motion_detection_enabled"))
        if "motion_threshold" in video:
            settings.motion_threshold_in = float(video.get("motion_threshold") or settings.motion_threshold_in)
        if "motion_cooldown_sec" in video:
            settings.motion_cooldown_sec_in = float(video.get("motion_cooldown_sec") or settings.motion_cooldown_sec_in)

        # ROI (OUT) — se almacena en video_salida
        if "roi_enabled" in video_salida:
            settings.roi_out_enabled = bool(video_salida.get("roi_enabled"))
        if "roi_x" in video_salida:
            settings.roi_out_x = float(video_salida.get("roi_x") or settings.roi_out_x)
        if "roi_y" in video_salida:
            settings.roi_out_y = float(video_salida.get("roi_y") or settings.roi_out_y)
        if "roi_w" in video_salida:
            settings.roi_out_w = float(video_salida.get("roi_w") or settings.roi_out_w)
        if "roi_h" in video_salida:
            settings.roi_out_h = float(video_salida.get("roi_h") or settings.roi_out_h)
        if "hud_overlay_enabled" in video_salida:
            settings.hud_overlay_enabled_out = bool(video_salida.get("hud_overlay_enabled"))
        if "hud_overlay_position" in video_salida:
            settings.hud_overlay_position_out = str(video_salida.get("hud_overlay_position") or settings.hud_overlay_position_out)
        if "motion_detection_enabled" in video_salida:
            settings.motion_detection_enabled_out = bool(video_salida.get("motion_detection_enabled"))
        if "motion_threshold" in video_salida:
            settings.motion_threshold_out = float(video_salida.get("motion_threshold") or settings.motion_threshold_out)
        if "motion_cooldown_sec" in video_salida:
            settings.motion_cooldown_sec_out = float(video_salida.get("motion_cooldown_sec") or settings.motion_cooldown_sec_out)

        # Umbrales del modelo legado
        if "confianza_avg_ocr" in modelo:
            settings.min_ocr_conf = float(modelo.get("confianza_avg_ocr") or settings.min_ocr_conf)
        if "confianza_detector" in modelo:
            settings.min_detector_conf = float(modelo.get("confianza_detector") or settings.min_detector_conf)
        if "ocr_device" in modelo:
            settings.ocr_device = str(modelo.get("ocr_device") or settings.ocr_device)

        # Deduplicacion (si existiera en sistema legado)
        if "dedup_window_sec" in sistema:
            settings.dedup_window_sec = max(0.0, float(sistema.get("dedup_window_sec") or settings.dedup_window_sec))

        if "match_window_sec" in sistema:
            settings.match_window_sec = max(1.0, float(sistema.get("match_window_sec") or settings.match_window_sec))

        if "auto_register" in sistema:
            settings.auto_register = bool(sistema.get("auto_register"))

        # Modo de acceso (nuevo) o compatibilidad con require_dni_qr (legado)
        mode_raw = str(sistema.get("auth_mode") or "").strip().lower()
        if mode_raw in {"patente", "dni", "ambos", "combinado"}:
            settings.auth_mode = mode_raw
        else:
            settings.auth_mode = "ambos" if settings.require_dni_qr else "patente"

        # Mantener compatibilidad hacia atras
        settings.require_dni_qr = settings.auth_mode == "ambos"

        # Camaras extra (legado y nuevo)
        if "qr_camera_source_in" in sistema:
            settings.qr_camera_source_in = str(sistema.get("qr_camera_source_in") or settings.qr_camera_source_in)
        elif "qr_camera_source" in sistema:
            settings.qr_camera_source_in = str(sistema.get("qr_camera_source") or settings.qr_camera_source_in)
            
        if "qr_camera_source_out" in sistema:
            settings.qr_camera_source_out = str(sistema.get("qr_camera_source_out") or settings.qr_camera_source_out)
        
        if "qr_source_type_in" in sistema:
            settings.qr_source_type_in = str(sistema.get("qr_source_type_in") or settings.qr_source_type_in)
        elif "qr_source_type" in sistema:
            settings.qr_source_type_in = str(sistema.get("qr_source_type") or settings.qr_source_type_in)
            
        if "qr_source_type_out" in sistema:
            settings.qr_source_type_out = str(sistema.get("qr_source_type_out") or settings.qr_source_type_out)
        elif "qr_source_type" in sistema:
            settings.qr_source_type_out = str(sistema.get("qr_source_type") or settings.qr_source_type_out)
            
        if "qr_com_port_in" in sistema:
            settings.qr_com_port_in = str(sistema.get("qr_com_port_in") or settings.qr_com_port_in)
        elif "qr_com_port" in sistema:
            settings.qr_com_port_in = str(sistema.get("qr_com_port") or settings.qr_com_port_in)
            
        if "qr_com_port_out" in sistema:
            settings.qr_com_port_out = str(sistema.get("qr_com_port_out") or settings.qr_com_port_out)
        elif "qr_com_port" in sistema:
            settings.qr_com_port_out = str(sistema.get("qr_com_port") or settings.qr_com_port_out)

        if "snapshot_camera_source_in" in sistema:
            settings.snapshot_camera_source_in = str(sistema.get("snapshot_camera_source_in") or settings.snapshot_camera_source_in)
        elif "snapshot_camera_source" in sistema:
            settings.snapshot_camera_source_in = str(sistema.get("snapshot_camera_source") or settings.snapshot_camera_source_in)
            
        if "snapshot_enabled_in" in sistema:
            settings.snapshot_enabled_in = bool(sistema.get("snapshot_enabled_in"))
        if "snapshot_trigger_in" in sistema:
            settings.snapshot_trigger_in = str(sistema.get("snapshot_trigger_in") or settings.snapshot_trigger_in)
        if "snapshot_count_in" in sistema:
            settings.snapshot_count_in = int(sistema.get("snapshot_count_in") or settings.snapshot_count_in)

        if "snapshot_camera_source_out" in sistema:
            settings.snapshot_camera_source_out = str(sistema.get("snapshot_camera_source_out") or settings.snapshot_camera_source_out)
        if "snapshot_enabled_out" in sistema:
            settings.snapshot_enabled_out = bool(sistema.get("snapshot_enabled_out"))
        if "snapshot_trigger_out" in sistema:
            settings.snapshot_trigger_out = str(sistema.get("snapshot_trigger_out") or settings.snapshot_trigger_out)
        if "snapshot_count_out" in sistema:
            settings.snapshot_count_out = int(sistema.get("snapshot_count_out") or settings.snapshot_count_out)

        # Filtro de formato de patente
        if "plate_filter_enabled" in sistema:
            settings.plate_filter_enabled = bool(sistema.get("plate_filter_enabled"))
        if "plate_filter_countries" in sistema:
            countries = sistema.get("plate_filter_countries")
            if isinstance(countries, list):
                settings.plate_filter_countries = [str(c).upper() for c in countries]

        # Retencion de evidencias / Disk Cleanup
        if "evidence_retention_days" in sistema:
            settings.evidence_retention_days = max(1, int(sistema.get("evidence_retention_days") or settings.evidence_retention_days))

        # Permisos de Roles
        if "vigilador_manual_trigger" in sistema:
            settings.vigilador_manual_trigger = bool(sistema.get("vigilador_manual_trigger"))
        if "propietario_auth_visits" in sistema:
            settings.propietario_auth_visits = bool(sistema.get("propietario_auth_visits"))
        if "barrier_auto_open_in" in sistema:
            settings.barrier_auto_open_in = bool(sistema.get("barrier_auto_open_in"))
        if "barrier_auto_open_out" in sistema:
            settings.barrier_auto_open_out = bool(sistema.get("barrier_auto_open_out"))

        # Configuración de Barreras (individuales y legado)
        barreras = data.get("barreras") or {}
        relay_legacy = data.get("relay") or {}

        # IN
        settings.barrier_type_in = str(barreras.get("type_in") or barreras.get("type") or "").strip().lower()
        if settings.barrier_type_in not in {"disabled", "simulated", "com", "ip"}:
            legacy_port = str(relay_legacy.get("port") or settings.relay_port or "").strip()
            if legacy_port:
                settings.barrier_type_in = "com"
            else:
                settings.barrier_type_in = "simulated"

        settings.barrier_port_in = str(barreras.get("port_in") or barreras.get("port") or relay_legacy.get("port") or settings.relay_port or "").strip()
        settings.barrier_baudrate_in = int(barreras.get("baudrate_in") or barreras.get("baudrate") or relay_legacy.get("baudrate") or settings.relay_baudrate or 9600)
        settings.barrier_ip_in = str(barreras.get("ip_in") or "").strip()
        settings.barrier_ip_port_in = int(barreras.get("ip_port_in") or 80)
        settings.barrier_ip_protocol_in = str(barreras.get("ip_protocol_in") or "tcp").strip().lower()
        settings.barrier_ip_cmd_open_in = str(barreras.get("ip_cmd_open_in") or "").strip()
        settings.barrier_ip_cmd_close_in = str(barreras.get("ip_cmd_close_in") or "").strip()
        settings.barrier_max_open_sec_in = int(barreras.get("max_open_sec_in") or relay_legacy.get("max_open_sec_in") or settings.relay_max_open_sec_in or 0)

        # OUT
        settings.barrier_type_out = str(barreras.get("type_out") or barreras.get("type") or "").strip().lower()
        if settings.barrier_type_out not in {"disabled", "simulated", "com", "ip"}:
            legacy_port = str(relay_legacy.get("port") or settings.relay_port or "").strip()
            if legacy_port:
                settings.barrier_type_out = "com"
            else:
                settings.barrier_type_out = "simulated"

        settings.barrier_port_out = str(barreras.get("port_out") or barreras.get("port") or relay_legacy.get("port") or settings.relay_port or "").strip()
        settings.barrier_baudrate_out = int(barreras.get("baudrate_out") or barreras.get("baudrate") or relay_legacy.get("baudrate") or settings.relay_baudrate or 9600)
        settings.barrier_ip_out = str(barreras.get("ip_out") or "").strip()
        settings.barrier_ip_port_out = int(barreras.get("ip_port_out") or 80)
        settings.barrier_ip_protocol_out = str(barreras.get("ip_protocol_out") or "tcp").strip().lower()
        settings.barrier_ip_cmd_open_out = str(barreras.get("ip_cmd_open_out") or "").strip()
        settings.barrier_ip_cmd_close_out = str(barreras.get("ip_cmd_close_out") or "").strip()
        settings.barrier_max_open_sec_out = int(barreras.get("max_open_sec_out") or relay_legacy.get("max_open_sec_out") or settings.relay_max_open_sec_out or 0)


        # Clamp final ROI (IN)
        settings.roi_x = max(0.0, min(1.0, settings.roi_x))
        settings.roi_y = max(0.0, min(1.0, settings.roi_y))
        settings.roi_w = max(0.05, min(1.0, settings.roi_w))
        settings.roi_h = max(0.05, min(1.0, settings.roi_h))
        settings.roi_x = min(settings.roi_x, 1.0 - settings.roi_w)
        settings.roi_y = min(settings.roi_y, 1.0 - settings.roi_h)

        # Clamp final ROI (OUT)
        settings.roi_out_x = max(0.0, min(1.0, settings.roi_out_x))
        settings.roi_out_y = max(0.0, min(1.0, settings.roi_out_y))
        settings.roi_out_w = max(0.05, min(1.0, settings.roi_out_w))
        settings.roi_out_h = max(0.05, min(1.0, settings.roi_out_h))
        settings.roi_out_x = min(settings.roi_out_x, 1.0 - settings.roi_out_w)
        settings.roi_out_y = min(settings.roi_out_y, 1.0 - settings.roi_out_h)
    except Exception:
        # No romper startup por errores de parseo legacy.
        return


_apply_legacy_yaml_defaults()
