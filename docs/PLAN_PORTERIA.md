# Plan portería — orden a seguir

Fecha: 2026-09-07. Complementa `ROADMAP.md`, `OPS_LANES.md`, `PENDING.md`.
Objetivo: un guardia en `/dashboard` ve **toast + historial del carril + plano + autorizaciones**, sin dump del ASI ni toast fantasma al F5. AccesoCam (RTSP) queda en `/dashboard/dahua/live`, no en portería.

## Cadena en tiempo real (como tiene que ser)

```
Cara en el ASI
  → attach HTTP AccessControl (agent, un hilo por lector)
  → POST /agent/events (dedupe recNo, abre relés cableados)
  → SSE access_event → toast del mismo sentido + fila de historial del carril
```

Respaldo: si el attach se cae, RecordFinder pide 5–12 registros **nuevos** vs cursor de SQLite. El dashboard, si el SSE se cae, hace poll 1 s. **No** se vuelca el historial del lector al arrancar.

## Qué ya está (no rehacer)

| Ítem | Dónde |
|------|--------|
| Toast anti-F5 (watermark + sessionStorage) | `useOpsEvents` |
| Sync incremental ASI↔DB (`/agent/sync-state`) | `agent.ts` + `main.py` |
| Updater suelto + `compose build` con sitio arriba | `systemUpdate.ts`, `update-ubuntu.sh` |
| 1 ASI = Entrada; Salida espera el 2º ASI | ficha `sentido` + `HomeDashboard` |
| Portería sin AccesoCam | historial IN/OUT + plano centro + autorizaciones naranja |

## Orden de trabajo (práctica)

Hacer **una fase por vez**. No mezclar SIP, plano ni ALPR con el live de portería.

### 0 — Tiempo real (esta entrega)

Live fluido + toast al instante. Verificar en el barrio:

1. F5 en `/dashboard`: **sin** toast.
2. Pasar la cara: toast del mismo sentido + fila IN/OUT en **menos de ~1 s**.
3. F5 otra vez: el toast no vuelve; el historial sí.
4. Módulos: versión **0.2.10**.

Ubuntu: el botón de update **viejo** se suicida. Primera vez:

```bash
# Como hugo (no sudo su)
sudo chown -R hugo:hugo /opt/accesopro
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
```

### 1 — Cableado (barrio 2 ASI)

La ficha de Dispositivos (`sentido` Entrada|Salida, carril vehicular|peatonal, Live, Relé local) recablea `Ingreso vehicular` / `Salida vehicular` (o peatonal si se elige). Un ASI no es los dos sentidos.

1. UI admin de `access_points` (`/dashboard/puntos-acceso`).
2. Segundo ASI = ficha Salida.
3. Dropdown AccesoCam = override de sesión.

### 2 — Apertura coherente

Orden fijo al abrir desde toast / botón:

1. Actuador `driver=dahua` con `dahuaDeviceId` del lector del evento.
2. Relés cableados al punto de ese sentido.
3. Fallback puerta/portón manual.

**Done:** un denegado abre **esa** puerta, no otra.

### 3 — QR visita: identifica, el guardia abre

Visitas y proveedores **no** abren solos. El ASI manda Error 96; AccesoPro arma `guard_approvals`. El guardia aprueba en el dashboard o en la app Android y recién ahí hay `openDoor`. Propietarios / familia / servicios permanentes siguen el passthrough de siempre.

1. CardNo enrolado = token del QR.
2. Carril 1 → cola `awaiting_entry`; carril 2 → `awaiting_exit` (baúl si es vehículo).
3. Campana sobre el lote en el plano de portería al precargar el pase.

### 4 — Permanencia

Reloj de visita = evento IN (lane 1) → evento OUT (lane 2). Propietarios/permanentes **sin** control de tiempo.

### 5 — Después (no bloquea portería)

Personas (editar/huella/PIN), evidencia galería, intercom FreePBX, DNI, pánico, fuego, fichadas, plano.

## Ajustes de esta entrega (fase 0)

| Pieza | Cambio | Por qué |
|-------|--------|---------|
| Live | Route Next `/api/dahua/:id/live` sin buffer | El rewrite de Next atrasaba el MJPEG |
| Live | RTSP extra 1 via ffmpeg (~6 fps ASI); AccesoCam `contain` sin recorte | Chrome no abre `rtsp://`. Sin snapshot CGI |
| Toast | SSE `ping` + reconnect 1,2 s; poll 1 s si SSE cae | No esperar 8 s a un evento |
| Toast | Auto-cierre 12 s | La fila de historial es la actividad; el toast avisa |
| Agent | Cliente HTTP reutilizado; debounce 1,2 s | Menos latencia al POST |

Si el live se pone pesado: `AGENT_LIVE_FPS` (default 6 en el ASI). El proxy MJPEG aborta al cerrar AccesoCam para no dejar ffmpeg zombie.

CGI vs RTSP y prueba de lector trabado: **`docs/ASI_CGI.md`**. No usar `snapshot.cgi` como ping.

## Reglas que no romper

- Cara / QR permanente del propietario abre solo (el ASI o AccesoPro). Visita = QR identifica; no se enrola cara de invitado. El guardia aprueba en la cola (campana del plano y Pedir salida en Visitas abren la misma ficha).
- Módulos comerciales ≠ fila del punto de acceso.
- Relé con nombre libre; disparo solo por cableado.
- `fire` no es sistema contra incendio certificado.
- No `docker compose down -v`.
- UI rioplatense, modales + Escape, claro/oscuro.
