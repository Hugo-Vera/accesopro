# ASI Dahua — CGI del manual vs RTSP

Fuente: [DAHUA ACCESS CONTROL PRODUCTS INTEGRATION INSTRUCTION](https://files.dahua.support/Solutions/Access%20Control%20Solution/Integration/DAHUA%20ACCESS%20CONTROL%20PRODUCTS%20INTEGRATION%20INSTRUCTION%20Ver1.0.pdf) (Access Control, no el CGI genérico de cámara/NVR).

En AccesoPro el lector de este predio es un **ASI-6214S**. El encoder de video es el mismo SoC que el motor facial: **no mezclar `snapshot.cgi` con un cliente RTSP**.

## Qué usa AccesoPro (solo comandos del PDF)

| Uso | Protocolo | Comando | Notas |
|-----|-----------|---------|--------|
| Live portería | RTSP TCP 554 | `/cam/realmonitor?channel=1&subtype=1` | Extra 1 entero. ffmpeg solo escala (sin crop). AccesoCam hace `contain` en el recuadro. `subtype=0` satura la cara. |
| Eventos en vivo | HTTP CGI Digest | `eventManager.cgi?action=attach&codes=[AccessControl]&heartbeat=5` | **Única consulta continua.** Heartbeat cada 5 s. |
| Historial / cursor RecNo | RPC `RecordFinder` | **Solo si el attach cayó.** Con attach sano queda apagado: un login+6 RPC cada 8 s trababa el SoC. |
| Abrir | CGI | `accessControl.cgi?action=openDoor&channel=1` | Puntual. |
| Personas / cara | CGI | `FaceInfoManager.cgi`, `recordUpdater` AccessControlCard | Alta, foto de enroll, baja. El reconcile **no** baja JPEG de todas las caras. |
| Foto del **evento** | RPC `FileManager` + `/RPC2_Loadfile` | **Una vez**, desde el **agent**, al toque (si el JPEG no está, reintento 120/250/450 ms). Se guarda en `apps/api/data/evidence/{site}/{eventId}.jpg`. Toast, historial, Eventos y Evidencia leen `GET /api/events/:id/photo`. El browser **no** pega FileManager. |

## Qué no se usa en el ASI (aunque exista en cámaras)

| Invento / otro producto | Por qué no |
|-------------------------|------------|
| `snapshot.cgi` en bucle (live MJPEG) | Misma tubería que el facial. 401/timeout y cara congelada. |
| `rtsp://…/Streaming/Channels/102` | Path Hikvision. El PDF de acceso usa `/cam/realmonitor`. |
| `eventManager` `codes=[FaceRecognition]` | Código de IVS de cámara, no del PDF de Access Control. |
| ISAPI `/ISAPI/Streaming/channels/…/picture` | Hikvision. |
| Abrir el extra **y** el main a la vez | Dos clientes RTSP al mismo SoC. |
| RecordFinder en paralelo al attach | CGI vivo + RPC de historial = SoC saturado, RecNo deja de subir. |
| 80 miniaturas FileManager (Eventos / Evidencia) | Cada foto es login RPC + descarga. Congela la cara. |

`snapshot.cgi` puntual (enroll «foto del lector») **solo** si no hay hub RTSP abierto contra esa IP.

## Totem del ASI vs AccesoCam

La pantalla del ASI-6214S es el **UI del equipo**. La foto de evidencia 384×640 sale del evento (`SnapURL`), no es live. AccesoCam, si se enciende, muestra el extra 1 **completo** (`contain`, sin recorte). El extra comparte SoC con la cara: en este predio el attach se cae si el live queda abierto. AccesoCam arranca apagado. Pedir SnapURL en bucle o el main (`subtype=0`) también traba.

La web del propio ASI (pestaña **DAHUA ACCESS CONTROL**) usa el mismo SoC: dejarla abierta traba la cara igual que AccesoCam.

## Un cliente de video por IP

Varias pestañas / Ingreso+Salida reutilizan un hub MJPEG en el agent (`apps/agent/app/live.py`), clave = **host** del lector. Chrome nunca abre `rtsp://`.

El MJPEG pasa Next → API → agent. Si el browser corta el `<img>` (scroll, refresh, error), **hay que abortar** esas conexiones. Si no, `rtspHubs.users` sube (8–9) y el ffmpeg queda prendido aunque quede una sola pestaña. Health: `rtspHubs` debería quedar en **1** con AccesoCam abierto.

## Monitoreo (sin snapshot.cgi)

Health: `GET :8790/health` (también `cgi` = inflight / last60s / byKind / recent).

| Campo | Cómo leerlo |
|-------|-------------|
| `attachOk` | Heartbeat del eventManager ≤ 15 s. CGI vivo. |
| `streamLive` | El attach está conectado (no hace falta un pase). |
| `recNo` / `recAgeSec` | Último pase visto. Si `recAgeSec` > 180 y nadie pasó cara: `stuckHint=idle`. |
| `pollerActive` | `true` solo con attach caído (ahí sí corre RecordFinder). |
| `rtspClients` | Debe ser 0 con AccesoCam apagado. |
| `cgi.last60s` | Con attach sano debería ser ~0 (salvo un openDoor o la copia de foto de un pase). |
| `stuckHint` | `ok` / `idle` / `attach_down` / `face_stuck`. |

Config del lector (on demand, liviano): `GET :8790/dahua/{id}/inspect` o API `GET /api/dahua/{id}/inspect`.

Probar si está trabado:

1. Cerrar AccesoCam y la web de preview del ASI.
2. Anotar `recNo` y `cgi.last60s` en health.
3. Pasar una cara conocida (botón **Probar lector** en portería, o a mano).
4. A ~8–10 s: `recNo` subió y hay toast → facial OK.
5. `recNo` igual y attach con heartbeat → **motor de cara/video colgado**. Cortar live, esperar 15 s, repetir. Si sigue: reiniciar el ASI.
6. Attach caído (`attachOk=false`) → CGI/red/401, no hace falta reiniciar el SoC primero.

## Qué carga el ASI (orden)

1. **RTSP extra 1** (AccesoCam). En el ASI-6214S comparte SoC con la cara. Arranca **apagado**. Si el attach se cae, el agent corta el hub RTSP.
2. **eventManager attach** AccessControl — necesario para toast/historial. Un hilo, heartbeat 5 s. **Esto es lo único en bucle.**
3. **RecordFinder** — solo si attach cayó (cada 1.6 s). Con attach sano: **apagado**.
4. **FileManager / SnapURL** — una copia por evento, en el agent (cola de 1). El dashboard sirve el JPEG local. Sin backfill de pases viejos.
5. **snapshot.cgi** — enroll / test de Dispositivos. Bloqueado si hay RTSP.
6. **openDoor / probe / inspect / personas** — puntuales. El padrón periódico no baja `AccessFace.list`.

No mezclar 1+5. El heartbeat del agent (`/agent/heartbeat`) **no** habla con el ASI.

CGI interactivo (RecordFinder, FileManager, probe) va serializado por host: no se pisan entre sí. El attach queda fuera de ese lock porque es un stream largo.

## Credenciales (maestro AccesoPro, réplica ASI)

AccesoPro es el padrón maestro. El ASI recibe una copia ejecutable (cara, PIN, tarjeta, QR replicado como fila `AccessControlCard`) y sigue abriendo sin red. El pass-through (`QRCode.TransmissionEnable`) es la **excepción**: el lector no valida y AccesoPro decide (revocación instantánea, permanencia, autorización en el momento).

| Método | Quién valida (regla) | CGI / RPC | Notas |
|--------|----------------------|-----------|--------|
| Cara | ASI local | `FaceInfoManager.cgi` | Hasta 2 caras. |
| Huella | ASI local | Solo `FingerEnable` + conteo `AccessFingerprint.startFind` | **No hay insert CGI.** Se enrola en el menú del lector. |
| PIN | ASI local | `Password=` en `recordUpdater AccessControlCard` | |
| Tarjeta | ASI local | `recordUpdater AccessControlCard` (`CardNo`) | Hex (0-9A-F, largo par, 4-32). Hasta 5 por persona. Este firmware no tiene `AccessCard.insert`. Extra: insert CGI mismo UserID; si UserID es único, fila satélite (`UserID` = `CardNo`). |
| QR | ASI local (réplica) o AccesoPro (pass-through) | Mismo `CardNo` hexadecimal + nodo `QRCode` (`TransmissionEnable`, `ValidTime`) | Distinto de tarjeta. Un nombre el lector lo marca "código QR inválido". Presentar a 3-5 cm. |
| QR | ASI local (réplica) o AccesoPro (pass-through) | Mismo `CardNo` hexadecimal + nodo `QRCode` (`TransmissionEnable`, `ValidTime`) | Distinto de tarjeta. Un nombre el lector lo marca "código QR inválido". Presentar a 3-5 cm. |

### Códigos de `Method` (AccessControlCardRec)

Fuente: manual de integración, salvo lo marcado como observado. El historial etiqueta desde el **código crudo** (`packages/catalog` `METHOD_CODE_ROWS`). Lo no medido se muestra como `Desconocido (código N)`.

| Código | Método | Fuente |
|--------|--------|--------|
| 0 | PIN / clave | manual |
| 1 | Tarjeta | manual |
| 2 | Tarjeta + clave | manual |
| 3 | Clave + tarjeta | manual |
| 4 | Apertura remota | observado (no reabrir relés) |
| 6 | Huella | manual |
| 15 | Rostro | manual |
| QR | *sin código documentado* | medir en Diagnóstico → eventos crudos; `ASI_QR_METHOD_CODE` queda `null` hasta entonces |

### UserType / CardType

Orden del manual: General=0, Blocklist=1, Guest=2, Patrol=3, VIP=4. **Confirmar con Diagnóstico → Volcar padrón crudo.** Los pases de visita se enrolan como `guest` (2), no como `1` (riesgo de lista negra). `Guest` es el tipo que el manual limita por vigencia o cantidad de usos (`UseTime`).

### Instrumento de medición

`/dashboard/diagnostico` → panel **Descubrimiento del lector ASI**: volcado de `QRCode`, `AccessControl` y nodos de pass-through; padrón crudo; eventos del attach sin mapear. No opera el equipo: solo lee.

### Medido vs pendiente (firmware `3.000.0000000.2.R`)

| Dato | Estado |
|------|--------|
| Códigos 0, 1, 2, 3, 6, 15 | Manual de integración. El historial ya etiqueta desde el código crudo. |
| Código 4 = apertura remota | Observado en AccesoPro (no reabrir relés). |
| Código de Method del QR | **Sin confirmar.** `ASI_QR_METHOD_CODE = null`. Medir pasando un QR con Diagnóstico abierto. |
| Campo del string del QR | **Sin confirmar.** El agent mira `QRCode` / `QrCode` / `QRCodeInfo` / `QRData` y, si no, `CardNo`. |
| UserType guest = 2 | Del orden del manual. **Confirmar** con un invitado creado en el menú del ASI. |
| `UseTime` + `ValidDateEnd` | Se escriben. Comprobar con un pase de un solo uso, pasarlo dos veces. |
| `ValidTime` del nodo QRCode | Se lee y se escribe; unidad (segundos) **sin confirmar** en este firmware. |
| `AccessControlCard.CardNo` | Hexadecimal (0-9A-F, largo par). Un texto como "Hugo" → Bad Request / "código QR inválido". |
| Segunda tarjeta/QR del mismo UserID | CGI insert extra (sin RPC). Este firmware responde `Method not found` a `AccessCard.insert`. Si UserID es único, réplica satélite `UserID=CardNo`. |
| Insert de huella por CGI | **No aparece.** Enrolar en el menú del lector. AccesoPro cuenta con `AccessFingerprint.startFind`. |

