# Pendientes AccesoPro

Lista viva. Inventario completo + plan por fases: **`docs/ROADMAP.md`**.  
Ops IN/OUT: **`docs/OPS_LANES.md`**. Si algo se completa, actualizar `MODULES.md` / `AGENTS.md` y tachar acá.

## Sprint inmediato (P0)

- [ ] Same ASI en Salida: compartir relés de Ingreso (`HomeDashboard` outSlots).
- [ ] Apertura toast: resolver por `dahuaDeviceId` → pool IN/OUT.
- [ ] Validar toast anti-F5 en runtime (código watermark en `useOpsEvents`).
- [ ] UI admin cableado `access_points` (API ya existe).
- [ ] QR visita: unificar payload vs CardNo ASI + enganchar `scanVisitPass` desde eventos.

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
- [ ] Same-device lab: Salida hereda relés de Ingreso (doc vs código).
- [ ] UI admin para cablear lector ↔ punto / sentido.
- [ ] Reloj de permanencia: visita = evento IN → OUT; propietarios sin control de tiempo.

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
- [ ] Lectura ASI → AccesoPro (`scanVisitPass` + actuador `triggerQr`).
- [ ] Payload QR alineado con CardNo enrollado.

## Live / evidencia

- [ ] Live RTSP estable (reintentos, cliente compartido).
- [ ] Evidencia: sync foto + galería (hoy stub).

## Módulos stub (comercial)

- [ ] Alta DNI portería.
- [ ] Pánico / SOS (dashboard + portal).
- [ ] Fuego (contacto panel; no certificado).
- [ ] Fichadas / asistencia.
- [ ] Plano croquis con pines cableados.
