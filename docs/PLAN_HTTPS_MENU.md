# Plan LAN: HTTPS, cámaras y menú

Revisión 2026-09-19. El dashboard en `http://IP:3000` **no puede** abrir webcam (Chrome/Firefox exigen contexto seguro). Portería y PCs de guardia: **`https://IP:3443`**.

## Qué anda hoy

| Área | Ruta | Estado |
|------|------|--------|
| Login / sesión | `/` | OK |
| Inicio portería (IN / plano / OUT) | `/dashboard` | OK |
| Plano | `/dashboard/plano` | OK |
| Puntos de acceso | `/dashboard/puntos-acceso` | OK (admin) |
| Visitas (alta + hold) | `/dashboard/visitas` | OK; DNI cámara solo en HTTPS |
| Eventos / fotos | `/dashboard/dahua/eventos` | OK si pack on |
| Vehículos ALPR | `/dashboard/alpr` | OK si módulo on |
| Fichadas | `/dashboard/fichadas` | OK si módulo on |
| Lotes | `/dashboard/propiedades` | OK |
| Padrón / sectores | `/dashboard/dahua/personas` | Lista y sync OK |
| Equipos / actuadores | `/dashboard/dahua` · `/actuadores` | OK |
| Live lector | `/dashboard/dahua/live` | OK (RTSP del ASI, no webcam PC) |
| QR del lector (CGI) | `/dashboard/dahua/qr` | OK pack |
| Periodos | `/dashboard/dahua/periodos` | OK pack |
| Pánico / fuego | `/dashboard/panico` · `/fuego` | OK si módulo |
| Usuarios / módulos | `/dashboard/usuarios` · `/modulos` | OK admin |
| Portal vecino | `/portal` | OK; sin webcam DNI |
| Lector USB HID DNI | cualquier PC | OK (no pide HTTPS) |
| Emitir QR de persona | modal en padrón | Formulario OK (no usa cámara) |

## Qué no anda o está a medias

| Pieza | Qué pasa | Fix |
|-------|----------|-----|
| Webcam en **Editar persona** | No había `<video>`; se pedía la cámara antes de montar el recuadro. USB extra no se podía elegir (`facingMode: user` exacto). | Hook `useWebcam`: preview + combo de cámaras + `facingMode` ideal. |
| Webcam DNI / ART / cara visita | Bloqueada en HTTP de LAN | Entrar por `:3443` |
| 2ª webcam USB | El SO la ve; AccesoPro no listaba dispositivos | Combo «Cámara» tras el permiso |
| Huella | Solo en el menú del ASI | Documentado; no CGI en este firmware |
| Intercom SIP | Stub | FreePBX pendiente |
| QR visita vs QR ASI | Dos sistemas (pase AccesoPro vs CardNo hex) | No mezclar; ver `docs/ASI_CGI.md` |

## Orden de trabajo

1. **P0 — Cámara de la PC (esta tanda)**  
   HTTPS `:3443` + preview webcam en alta/edición + selector de dispositivo. Probar: DNI visita, cara visita, foto facial padrón, constancia ART.

2. **P0 — Recorrido HTTPS de cada submenú**  
   Guardia y admin en `https://IP:3443`. Anotar permiso de cámara, certificado aceptado, SSE de eventos, live RTSP.

3. **P1 — Alinear copy**  
   «Capturar fotograma» / «Webcam Portería» → «Cámara de esta PC». QR emitir: dejar claro que no es escáner.

4. **P1 — Diagnóstico de cámaras**  
   En Diagnóstico: listar `enumerateDevices` y si `isSecureContext`.

5. **P2 — Intercom / huella / 2º ASI salida**  
   Siguen en `docs/PENDING.md`.

## Cómo probar (guardia u otra PC)

1. `https://IP:3443` (aceptar certificado una vez). Si Chrome dice que expiró: actualizar el Ubuntu; `web-tls` regenera el cert (10 años) y hay que aceptar el aviso de nuevo.
2. Permitir cámara cuando el browser lo pida.
3. Padrón → editar persona → Facial → Webcam → si hay dos, elegir en el combo → Capturar.
4. Inicio → Registrar visita → escanear DNI con cámara.
5. Lector USB sigue valiendo en HTTP o HTTPS.
