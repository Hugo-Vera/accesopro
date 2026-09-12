# Smoke / E2E mínimo AccesoPro

Correr: `npm run test:smoke` (desde la raíz).

## Automatizado (`scripts/smoke-p0.mjs`)

- Parse de QR visita (`ACCESOPRO:V1:token` y CardNo crudo).
- Orden de apertura: `dahuaDeviceId` → pool del punto → fallback.
- Same-device: OUT une relés de IN.

## Manual portería (después de update Ubuntu)

1. F5 en `/dashboard`: **sin** toast fantasma.
2. Pasar la cara: toast + fila IN en menos de ~1 s.
3. F5 otra vez: el toast no vuelve; el historial sí.
4. **Puntos de acceso**: cablear ASI + relé; denegado abre **esa** puerta.
5. Lab 1 ASI: elegir el mismo lector en Salida; se ven relés de Ingreso.
6. QR visita del portal: CardNo = token; ingest marca `scannedInAt` / `scannedOutAt` sin re-pulsar el relé del ASI.

Live RTSP: si varias pestañas saturan el ASI, el agent comparte un hub MJPEG por equipo (`apps/agent/app/live.py`).
