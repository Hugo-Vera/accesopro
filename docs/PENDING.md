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
- [ ] Editar persona / vigencia / franjas.
- [ ] Huella y tarjeta física.
- [ ] PIN / contraseña desde el panel.
- [ ] Listado si firmware usa AccessUser.cgi.

## QR: dos cosas distintas

| Tipo | Dónde | Para qué |
|------|--------|----------|
| **QR nativo ASI** | Pack `dahua.qr` | Ajustes del terminal |
| **QR visita AccesoPro** | Módulo `visitors` | Pase firmado; portal genera |

- [x] Pack `dahua.qr`: UI ajustes CGI (parcial).
- [x] Portal: emitir / revocar QR visita.
- [x] Lectura ASI → AccesoPro (`markVisitStayByCard` + `scanVisitPass` con wiring).
- [x] Payload QR alineado con CardNo enrollado.

## Live / evidencia

- [x] Live RTSP: hub MJPEG compartido por equipo (varias pestañas).
- [x] Evidencia: galería desde historial (fotos del evento).

## Módulos comerciales

- [x] Alta DNI portería (parse QR/PDF417).
- [x] Pánico / SOS (dashboard + portal).
- [x] Fuego (contacto panel; no certificado).
- [x] Fichadas / asistencia (eventos + manual).
- [x] Plano croquis con pines cableados.
