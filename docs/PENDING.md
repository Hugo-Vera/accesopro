# Pendientes AccesoPro

Lista viva de trabajo futuro. Si algo se completa, moverlo a `MODULES.md` / `AGENTS.md` y sacarlo de acá.

## Intercom (SIP)

- [x] UI softphone en dashboard portería (`AccesoPhone`: contactos, teclado, emergencias) — stub hasta FreePBX.
- [ ] **FreePBX / Asterisk en LAN del barrio** (no en la nube AccesoPro), mismo sitio que el agent.
- [ ] Extensión SIP del ASI + extensión de portería.
- [ ] Softphone embebido real (WebRTC ↔ SIP si hace falta gateway).
- [ ] Feature pack `dahua.intercom` + capability + UI llamar / contestar / colgar + abrir.
- [ ] Documentar puertos SIP/RTP y que el audio no salga a internet salvo VPN.

Notas: DMSS hoy hace la llamada por P2P/ecosistema Dahua. AccesoPro apuntaría a PBX propio en local.
Dashboard portería (`/dashboard`): layout consola 3 columnas (live + relés | menú/status | softphone).

## Personas y credenciales en el lector (`dahua.persons`)

- [x] MVP urgente: alta cara + QR (CardNo) + listar + borrar (`PersonsPanel`, agent CGI).
- [ ] Editar persona / vigencia / franjas.
- [ ] Huella y tarjeta física (además del QR).
- [ ] PIN / contraseña desde el panel.
- [ ] Mejorar listado si el firmware usa AccessUser.cgi en vez de AccessControlCard.

## QR: dos cosas distintas

| Tipo | Dónde | Para qué |
|------|--------|----------|
| **QR nativo ASI** | Pack `dahua.qr` + web del equipo | Lectura/configuración del código en el terminal |
| **QR visita AccesoPro** | Módulo `visitors` | Pase firmado con fechas; lo genera el vecino/admin |

- [ ] Pack `dahua.qr`: UI de ajustes del lector (no confundir con visitas).
- [ ] Módulo visitas: emitir / revocar QR de visita y que dispare actuador.

## Live / evidencia (seguimiento)

- [ ] Live RTSP estable (reintentos, un solo cliente compartido si hay varias pestañas).
- [ ] Evidencia: copiar foto del evento al almacenamiento del barrio + galería.
