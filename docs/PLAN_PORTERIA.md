# Plan portería — orden a seguir

Fecha: 2026-09-07. Complementa `ROADMAP.md`, `OPS_LANES.md`, `PENDING.md`.
Objetivo: un guardia en `/dashboard` ve **live + toast + historial** en el momento del pase, sin dump del ASI ni toast fantasma al F5.

## Cadena en tiempo real (como tiene que ser)

```
Cara en el ASI
  → attach HTTP AccessControl (agent, un hilo por lector)
  → POST /agent/events (dedupe recNo, abre relés cableados)
  → SSE access_event → toast + fila de historial del carril
  → AccesoCam IN: MJPEG substream (proxy Next sin buffer)
```

Respaldo: si el attach se cae, RecordFinder pide 5–12 registros **nuevos** vs cursor de SQLite. El dashboard, si el SSE se cae, hace poll 1 s. **No** se vuelca el historial del lector al arrancar.

## Qué ya está (no rehacer)

| Ítem | Dónde |
|------|--------|
| Toast anti-F5 (watermark + sessionStorage) | `useOpsEvents` |
| Sync incremental ASI↔DB (`/agent/sync-state`) | `agent.ts` + `main.py` |
| Updater suelto + `compose build` con sitio arriba | `systemUpdate.ts`, `update-ubuntu.sh` |
| 1 ASI = Entrada; Salida espera el 2º ASI | ficha `sentido` + `HomeDashboard` |
| Live OUT apagado si no hay lector de salida | `streamEnabled={Boolean(outDeviceId)}` |

## Orden de trabajo (práctica)

Hacer **una fase por vez**. No mezclar SIP, plano ni ALPR con el live de portería.

### 0 — Tiempo real (esta entrega)

Live fluido + toast al instante. Verificar en el barrio:

1. F5 en `/dashboard`: **sin** toast.
2. Pasar la cara: toast + fila IN en **menos de ~1 s**; live no se congela.
3. F5 otra vez: el toast no vuelve; el historial sí.
4. Módulos: versión **0.2.5**.

Ubuntu: el botón de update **viejo** se suicida. Primera vez:

```bash
# Como hugo (no sudo su)
sudo chown -R hugo:hugo /opt/accesopro
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
```

### 1 — Cableado (barrio 2 ASI)

La ficha de Dispositivos (`sentido` Entrada|Salida, carril vehicular|peatonal, Live, Relé local) recablea `Ingreso vehicular` / `Salida vehicular` (o peatonal si se elige). Un ASI no es los dos sentidos.

1. UI admin de `access_points` (modal Nuevo/Editar, Escape, tema) para cableados extra.
2. Segundo ASI = ficha Salida.
3. Dropdown AccesoCam = override de sesión.

### 2 — Apertura coherente

Orden fijo al abrir desde toast / botón:

1. Actuador `driver=dahua` con `dahuaDeviceId` del lector del evento.
2. Relés cableados al punto de ese sentido.
3. Fallback puerta/portón manual.

**Done:** un denegado abre **esa** puerta, no otra.

### 3 — QR visita cierra el circuito

Hoy el ASI valida CardNo y AccesoPro no se entera del pase.

1. Unificar payload QR con CardNo enrolado.
2. Evento `dahua_access` método QR → `scanVisitPass` + `triggerQr`.
3. Portal: `scannedInAt` / `scannedOutAt`.

**Done:** visita con QR aparece en historial IN y en el portal.

### 4 — Permanencia (hace falta fase 1)

Reloj de visita = evento IN → evento OUT. Propietarios/permanentes **sin** control de tiempo.

### 5 — Después (no bloquea portería)

Personas (editar/huella/PIN), evidencia galería, intercom FreePBX, DNI, pánico, fuego, fichadas, plano.

## Ajustes de esta entrega (fase 0)

| Pieza | Cambio | Por qué |
|-------|--------|---------|
| Live | Route Next `/api/dahua/:id/live` sin buffer | El rewrite de Next atrasaba el MJPEG |
| Live | ~8 fps, JPEG 52; retry 1,4 s | Más fluido sin saturar el ASI |
| Toast | SSE `ping` + reconnect 1,2 s; poll 1 s si SSE cae | No esperar 8 s a un evento |
| Toast | Auto-cierre 12 s | La fila de historial es la actividad; el toast avisa |
| Agent | Cliente HTTP reutilizado; debounce 1,2 s | Menos latencia al POST |

Si el live se pone pesado en un NUC chico: `AGENT_LIVE_FPS=5` en `.env` del host.

## Reglas que no romper

- Módulos comerciales ≠ fila del punto de acceso.
- Relé con nombre libre; disparo solo por cableado.
- `fire` no es sistema contra incendio certificado.
- No `docker compose down -v`.
- UI rioplatense, modales + Escape, claro/oscuro.
