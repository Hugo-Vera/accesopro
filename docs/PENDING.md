# Pendientes AccesoPro

Lista viva. Inventario: **`docs/ROADMAP.md`**. Portería (orden a seguir): **`docs/PLAN_PORTERIA.md`**.  
Ops IN/OUT: **`docs/OPS_LANES.md`**. Sitio LAN (MikroTik + ASI publicado): **`docs/SITE_RB4011.md`**.

## Sitio RB4011 (retomar)

Snapshot 2026-09-10. No mezclar con update Ubuntu.

- [x] Failover más rápido: `check-gateway` 2s/1s/count=2; PPPoE keepalive 30s (Telegram depto era rediscado del Archer).
- [x] TTL Starlink: no aplicado. Receta opcional (`change-ttl` set:64 / increment en ether2/3, no probes) en `docs/SITE_RB4011.md`.
- [x] NTP `ar.pool.ntp.org`, backup+export 04:15 (`auto-daily.*`), graphing ether1/2/3 + CPU (LAN 192.168.0.0/16).
- [x] NAT ASI AccesoPro: HTTP 18080, HTTPS 18443, SDK 27777, RTSP **18554** → 554. Sin filtro de origen. Duplicado 1554 borrado. Hoja de retome: `docs/SITE_RB4011.md` §0.
- [ ] Re-probar: apagar SL1+SL2 ~15 s; `Internet (cualquier WAN)` online; **no** oleada PPPoE en Redes.
- [ ] PHP `.121`: debounce de `webhook-mikrotik.php` status=down < 60–120 s (opcional).
- [ ] Probar ASI público `:18080` / `:27777` / `:18554` (el lector sigue en 80/37777/554).
- [ ] HTTPS ASI apagado: dst-nat `:18443` no entrega hasta `Https.Enable=true` (puerto interno 443).
- [ ] Cerrar WebFig/WinBox (`:8295`) a WAN; no fasttrack.

## Sprint inmediato (P0)

- [x] Same ASI en Salida: compartir relés de Ingreso (`HomeDashboard` outSlots).
- [x] Apertura toast: resolver por `dahuaDeviceId` → pool IN/OUT.
- [x] Toast anti-F5: watermark `createdAt` + `sessionStorage`; agent prime sin reenviar historial.
- [x] UI admin cableado `access_points` (`/dashboard/puntos-acceso`).
- [x] QR visita: CardNo del ASI marca `scanned_in_at` / `scanned_out_at` por carril 1/2 (sin reabrir relés QR).
- [x] Enroll portal con `deviceId` en todos los ASI del sitio.

## Intercom (SIP)

- [x] UI softphone stub (`AccesoPhone`) — fuera del home ops hasta FreePBX.
- [ ] **FreePBX / Asterisk en LAN del barrio** (no en la nube AccesoPro).
- [ ] Extensión SIP del ASI + extensión de portería.
- [ ] Softphone embebido real (WebRTC ↔ SIP si hace falta gateway).
- [ ] Feature pack `dahua.intercom` + capability + UI llamar / contestar / colgar + abrir.
- [ ] Documentar puertos SIP/RTP y que el audio no salga a internet salvo VPN.

## Dual live IN/OUT (permanencia visitas)

- [x] Dos AccesoCam en home: entrada + salida.
- [x] Asignación por cableado / heurística / override AccesoCam.
- [x] Actuadores e historial separados por sentido (producción).
- [x] Same-device lab: Salida hereda relés de Ingreso (doc vs código).
- [x] UI admin para cablear lector ↔ punto / sentido.
- [x] Reloj de permanencia: visita = evento IN → OUT; propietarios sin control de tiempo.

## Personas y credenciales (`dahua.persons`)

- [x] MVP: alta cara + QR (CardNo) + listar + borrar.
- [ ] Editar persona / vigencia / franjas (parcial: vigencia y UseTime ya viajan al ASI).
- [ ] Huella: enrolar por CGI (no existe en este firmware; se registra en el menú del ASI).
- [x] Tarjeta física: padrón maestro + réplica `AccessControlCard` (alta/baja, listen).
- [x] PIN / contraseña desde el panel (credencial `pin` del padrón maestro, replica `Password=` al ASI).
- [ ] Listado si firmware usa AccessUser.cgi.

## QR: dos cosas distintas

| Tipo | Dónde | Para qué |
|------|--------|----------|
| **QR nativo ASI** | Pack `dahua.qr` | Réplica local o pass-through (`TransmissionEnable`) |
| **QR visita AccesoPro** | Módulo `visitors` | Pase con vigencia y usos; se replica como invitado (`UserType` guest) |

- [x] Pack `dahua.qr`: UI con los dos modos (valida el lector / valida AccesoPro).
- [x] Portal: emitir / revocar QR visita (imagen local, sin `qrserver.com`).
- [x] Lectura ASI → AccesoPro (`markVisitStayByCard` + pass-through si el lector rechaza).
- [x] QR y tarjeta separados en el padrón maestro (`person_credentials`).
- [ ] Código de `Method` del QR: medir en Diagnóstico (eventos crudos) y cargar `ASI_QR_METHOD_CODE`.

## Live / evidencia

- [x] Live RTSP: hub MJPEG compartido por equipo (varias pestañas).
- [x] Evidencia: galería desde historial (fotos del evento).

## Módulos comerciales

- [x] Alta DNI portería (parse QR/PDF417).
- [x] Pánico / SOS (dashboard + portal).
- [x] Fuego (contacto panel; no certificado).
- [x] Fichadas / asistencia (eventos + manual).
- [x] Plano croquis con pines cableados.

## Alta manual de visita + email (referencia DSS, no copiar UI)

Pantallas de **visita designada** de DSS (Detalle / Autenticación / Autorización). En AccesoPro el alta vive en `/dashboard/visitas` (modal, Escape). El QR del pase es AccesoPro (`openDoor` si el ASI da error 96), no el QR firmado de DSS.

Hoy hay: DNI, lote, peatonal/vehículo, seguro, licencia, notas, QR. Falta email SMTP y varios campos de cita.

### Campos útiles (alta manual)

| Bloque | Campo | DSS | AccesoPro hoy | Notas AR |
|--------|--------|-----|----------------|----------|
| Anfitrión | Nombre / lote | Host + depto | Lote obligatorio | El propietario sale del lote, no un texto suelto |
| Anfitrión | Email del vecino | Email host | Invite propietario (WhatsApp) | Para copia del pase |
| Visitante | Nombre | Sí | DNI + nombre | |
| Visitante | Empresa | Empresa visitante | No | Opcional (proveedor / jardinero) |
| Visitante | Tipo y nro ID | Tarjeta ID | DNI | En AR: DNI; pasaporte si es extranjero |
| Visitante | Teléfono | Sí | `visitor_identities.phone` | |
| Visitante | Email | Sí | No | Destino del pase |
| Visita | Patente | Placa | Vehículo | |
| Visita | Motivo | Motivo | `visitType` grosero | Texto libre + tipo (social / servicio / delivery) |
| Visita | Llegada / salida cita | Datetime | `fechaDesde`/`fechaHasta` en autorizaciones; check-in es “ahora” | Cita previa ≠ ingreso en portería |
| Visita | Notas | Sí | `notes` | |
| Credencial | Cara | Opcional | Enrol ASI | No obligatorio para QR |
| Credencial | Pase QR | Generar / bajar / mail / borrar | Generar QR local | Mismos botones en el modal del pase |
| Autorización | Puertas | Árbol sitio → equipo → Door1 | `access_points` cableados | No tildar ASI a mano; el lote/sentido resuelve el punto |
| Autorización | IN/OUT | Entrada y salida | Carriles 1/2 | Permanencia solo visitas |

No copiar “Intercom. de vídeo” al alta de visita (pack `dahua.intercom` aparte).

## Historial de eventos (referencia DSS)

Grilla tipo DSS: una fila por pase, clic = foto a la derecha.

| Columna DSS | AccesoPro | Notas |
|-------------|-----------|--------|
| Tipo / Evento | Pase válido (rostro/QR/tarjeta), Extraño (rostro), QR rechazado, Apertura remota | No decir “Rostro no identificado” si fue un QR |
| Hora | `createdAt` | es-AR |
| Zona / punto | Equipo + sector del `access_point` | No hardcodear “Puerta Principal” |
| Tipo de punto | Puerta / vehicular | `laneSector` |
| Persona | `CardName` / visita | Resolver por credencial si el attach no trae nombre |
| ID | UserID o hex del QR | |
| Entró / salió | Ingreso / Salida | `laneCode` 1/2 |
| Operación | Ver foto | Modal Escape |
| Miniatura | JPEG local del evento | No pegar FileManager desde el browser |

Agrupar (pendiente): el QR error 96 + `openDoor` (método 4) es **un** pase, no dos filas.

- [x] Columnas evento / hora / punto / sentido / persona / ID en `/dashboard/dahua/eventos`.
- [ ] Unir QR 96 + apertura remota en una sola fila.
- [ ] Panel lateral de foto al seleccionar fila (además del modal).

### Pase (PDF / adjunto del mail)

Una hoja clara, QR grande generado en AccesoPro (no `qrserver.com`):

- Título: Pase de visitante
- QR (hex AccesoPro, 3–5 cm de la lente)
- Leyenda: válido solo en el periodo; si venció, pedir uno nuevo
- Nombre
- Teléfono
- Patente (vacío si es peatonal)
- DNI / nro. de documento
- Nota (saludo o motivo corto)
- Vigencia: `desde – hasta` (fecha y hora)

El mail lleva esa imagen embebida (CID) más el mismo texto en plano. Descargar PNG/PDF desde el modal del pase.

### Configuración de email (barrio)

SMTP por tenant (no global de plataforma): host, puerto, TLS, usuario, clave, remitente (`Visitas Las Acacias <visitas@…>`). Probar envío desde **Configuración**.

Dos plantillas, modo ejemplo editable (asunto + HTML + texto):

1. **Pase de visita** — al email del visitante; copia opcional al propietario.
2. **Invite propietario** — hoy es WhatsApp + `/activar`; el mail es el mismo token.

Variables: `{{barrio}}` `{{lote}}` `{{anfitrion}}` `{{visitante}}` `{{dni}}` `{{patente}}` `{{motivo}}` `{{desde}}` `{{hasta}}` `{{qrUrl}}` (cid de la imagen, no un servicio de internet) `{{activarUrl}}`.

Ejemplo visita (asunto): `Pase de acceso — {{barrio}} lote {{lote}}`.

Ejemplo cuerpo: nombre, ventana de validez, “presentar el QR a 3–5 cm de la lente”, no reenviar si venció, generar otro desde el portal.

### Pendiente de código

- [ ] Campos: email visitante, empresa, motivo, ventana de cita (si no es check-in ya).
- [ ] SMTP + plantillas visita / propietario en Configuración (modal).
- [ ] Botón «Enviar pase» en el QR de visita (y reenviar).
- [ ] Historial de envíos (a quién, cuándo, error SMTP) sin loguear el HTML completo.
