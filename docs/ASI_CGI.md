# ASI Dahua — CGI del manual vs RTSP

Fuente: [DAHUA ACCESS CONTROL PRODUCTS INTEGRATION INSTRUCTION](https://files.dahua.support/Solutions/Access%20Control%20Solution/Integration/DAHUA%20ACCESS%20CONTROL%20PRODUCTS%20INTEGRATION%20INSTRUCTION%20Ver1.0.pdf) (Access Control, no el CGI genérico de cámara/NVR).

En AccesoPro el lector de este predio es un **ASI-6214S**. El encoder de video es el mismo SoC que el motor facial: **no mezclar `snapshot.cgi` con un cliente RTSP**.

## Qué usa AccesoPro (solo comandos del PDF)

| Uso | Protocolo | Comando | Notas |
|-----|-----------|---------|--------|
| Live portería | RTSP TCP 554 | `/cam/realmonitor?channel=1&subtype=1` | Extra 1. `subtype=0` es principal y satura la cara. `subtype=2` solo si el equipo declara extra 2; este ASI no lo usa para AccesoCam. El totem 272×480 no es un subtype CGI. |
| Eventos en vivo | HTTP CGI Digest | `eventManager.cgi?action=attach&codes=[AccessControl]&heartbeat=5` | Heartbeat cada 5 s (rango 1–60 del manual). |
| Historial / cursor RecNo | RPC `RecordFinder` (cola reciente) + CGI `recordFinder` de respaldo | El CGI `find&count=N` devuelve los **más viejos**; por eso el agent pide los últimos por RPC. |
| Abrir | CGI | `accessControl.cgi?action=openDoor&channel=1` | |
| Personas / cara | CGI | `FaceInfoManager.cgi`, `recordUpdater` AccessControlCard | Alta, foto de enroll, baja. |
| Foto del **evento** | CGI | `snapManager.cgi?action=attachFileProc` o URL del registro (`URL` / `SnapURL`) | JPEG cuando ocurre AccessControl. No es live. |

## Qué no se usa en el ASI (aunque exista en cámaras)

| Invento / otro producto | Por qué no |
|-------------------------|------------|
| `snapshot.cgi` en bucle (live MJPEG) | Misma tubería que el facial. 401/timeout y cara congelada. |
| `rtsp://…/Streaming/Channels/102` | Path Hikvision. El PDF de acceso usa `/cam/realmonitor`. |
| `eventManager` `codes=[FaceRecognition]` | Código de IVS de cámara, no del PDF de Access Control. |
| ISAPI `/ISAPI/Streaming/channels/…/picture` | Hikvision. |
| Abrir el extra **y** el main a la vez | Dos clientes RTSP al mismo SoC. |

`snapshot.cgi` puntual (enroll «foto del lector») **solo** si no hay hub RTSP abierto contra esa IP.

## Un cliente de video por IP

Varias pestañas / Ingreso+Salida reutilizan un hub MJPEG en el agent (`apps/agent/app/live.py`), clave = **host** del lector. Chrome nunca abre `rtsp://`.

## Probar si el lector está trabado (sin snapshot.cgi)

No usar `snapshot.cgi` como ping: puede trabarlo más.

1. Cerrar AccesoCam y la web de preview del ASI.
2. Anotar `recNo` en `GET :8790/health` → `readers` (o cursor).
3. Pasar una cara conocida (botón **Probar lector** en portería, o a mano).
4. A ~8–10 s: `recNo` subió y hay toast → facial OK.
5. `recNo` igual y attach con heartbeat → **motor de cara/video colgado**. Cortar live, esperar 15 s, repetir. Si sigue: reiniciar el ASI.
6. Attach caído (`attachOk=false`) → CGI/red/401, no hace falta reiniciar el SoC primero.

Health del agent: `attachOk`, `lastHeartbeatAt`, `recNo`, `lastRecNoAt`, `rtspClients`, `stuckHint` (`ok` / `attach_down` / `face_stuck`).
