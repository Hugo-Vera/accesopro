# AccesoPro — inventario + plan punta a punta

Fecha de revisión: 2026-09-12.  
Orden práctico portería (live/toast/cableado): **`docs/PLAN_PORTERIA.md`**.

---

## 1. Qué ya anda (baseline demo)

| Flujo | Estado |
|-------|--------|
| Auth multi-tenant + planes + grants | OK |
| Actuadores CRUD + open (engine / Dahua / IP) | OK |
| Agent Dahua: eventos + openDoor + personas MVP | OK |
| Home ops: dual live IN/OUT + historial + autorizaciones | OK (con gaps abajo) |
| Toast anti-F5 (watermark) | F5 / update no re-tosta; agent prime sin reenviar historial |
| Portal vecino: ficha, familia, servicios, QR generar/revocar | OK parcial |
| ALPR vía motor LAN `:5051` + proxy config | OK si motor arriba |
| Access points API + backfill legacy | OK backend |
| Feature packs: devices, events, open, persons, schedules, qr CGI, live | OK / parcial |

---

## 2. Lo que falta o está incoherente (ordenado por impacto)

### P0 — Bloquea operación diaria / demo 1 ASI

| # | Problema | Evidencia | Efecto |
|---|----------|-----------|--------|
| P0.1 | Un ASI no cubre IN y OUT | Ficha `sentido` Entrada/Salida; OUT vacío hasta el 2º ASI | Hecho (0.2.5) |
| P0.2 | `onOpenRelay` no prioriza `dahuaDeviceId` del actuador | Toast abre por pool de sentido, no por vínculo equipo↔relé | Hecho (0.2.10) |
| P0.3 | Sin UI admin de cableado | API `accessPoints.ts` existe; cero página web | Hecho (`/dashboard/puntos-acceso`) |
| P0.4 | QR visita: payload ≠ CardNo ASI | QR = `ACCESOPRO:V1:token`; enroll = `token` crudo | Hecho (CardNo = token) |
| P0.5 | Lectura QR en ASI no cierra el circuito AccesoPro | Agent solo emite `dahua_access`; no llama `scanVisitPass` | Hecho (`markVisitStayByCard`) |

### P1 — Portería usable en barrio real (2 ASI)

| # | Problema | Notas |
|---|----------|-------|
| P1.1 | Cablear 2 puntos `in`/`out` + 2 ASI + relés desde UI | Hecho (`/dashboard/puntos-acceso`) |
| P1.2 | Permanencia visitas (IN → OUT) | Reloj en home; propietarios sin control de tiempo |
| P1.3 | Persistencia opcional de `lanePick` | Hoy se pierde al F5 (aceptable si hay cableado) |
| P1.4 | Toast 24h + botón apertura también en aprobado | Hecho (0.2.10) |
| P1.5 | Live RTSP estable / un cliente compartido | Hub MJPEG por equipo en el agent |
| P1.6 | Docs desactualizados | Alineado en 0.2.10 |

### P2 — Producto comercial completo

| # | Módulo / pack | Estado |
|---|---------------|--------|
| P2.1 | Personas: editar vigencia, franjas, huella, PIN | Solo alta/listar/borrar |
| P2.2 | Evidencia Dahua (galería sync) | Página stub |
| P2.3 | Intercom FreePBX + softphone WebRTC | Softphone «Próximamente» |
| P2.4 | Visitas dashboard = misma lógica portal + check-in unificado | Parcial |
| P2.5 | Alta DNI portería | Stub |
| P2.6 | Pánico / SOS portal + plano | Stub dashboard; portal sin SOS |
| P2.7 | Fuego (contacto panel) | Stub (no certificado) |
| P2.8 | Fichadas / asistencia | Stub |
| P2.9 | Plano croquis usable (pines cableados) | Stub / limitado |
| P2.10 | Pack `dahua.qr` vs QR visita | No confundir; documentar + UX clara |

### P3 — Hardening / ops

| # | Ítem |
|---|------|
| P3.1 | Deploy barrio: agent + site + API (playbook `DEPLOY_SITE`) |
| P3.2 | Health unificado agent/engine en status bar |
| P3.3 | Tests E2E mínimos: toast F5, openDoor, visit scan |
| P3.4 | Migraciones seguras (nunca borrar DB) — ya política; vigilar |

---

## 3. Modelo coherente (referencia)

```
Evento (ASI / cámara / QR)
    → resuelve access_point (por device/camera cableado)
    → abre solo actuators de ese punto
    → historial / toast del carril de ese deviceId

Admin cablea una vez:
  access_points (sector + sentido)
  + access_point_devices / _actuators / _cameras

Sesión AccesoCam:
  override live+historial (no escribe DB)
  si same device IN=OUT (lab): compartir relés de IN en panel OUT
```

Detalle operativo: `docs/OPS_LANES.md`.

---

## 4. Plan punta a punta (fases)

### Fase A — Cerrar bugs ops (1–2 días)

Objetivo: demo 1 ASI sin mentiras.

1. **Same-device OUT**: si `outDeviceId === inDeviceId`, `outSlots` = unión OUT ∪ IN.  
2. **Resolver apertura**: `dahuaDeviceId` → pool IN (si match) → pool OUT → puerta manual.  
3. **Toast anti-F5**: watermark + sessionStorage; agent prime sin reenviar historial.  
4. **Toast UX**: hora 24h; apertura manual también en aprobado (opcional).  
5. Checklist manual en `OPS_LANES.md`.

**Done cuando:** mismo ASI en Salida muestra y abre «Puerta ingreso»; F5 limpio.

### Fase B — Cableado admin (2–4 días)

Objetivo: topología real sin heurística.

1. Página `/dashboard/puntos-acceso` (o bajo Config): lista + modal Nuevo/Editar.  
2. Modal wiring: dispositivos, actuadores, cámaras (roles). Escape + tema claro/oscuro.  
3. Seed demo: punto IN + OUT cableados (aunque sea 1 ASI en IN).  
4. Actualizar `AGENTS.md` / `MODULES.md`.

**Done cuando:** admin cablea sin tocar SQL; home respeta sentido.

### Fase C — Visitas E2E (3–5 días)

Objetivo: vecino genera QR → ASI lee → abre → portal marca ingreso/salida.

1. Unificar payload: lo que imprime el QR = lo que enrolla el ASI (o parse en agent).  
2. En agent/`agent.ts`: si CardNo matchea `visit_passes` → `markVisitStayByCard` con `lane_code` 1/2 (no re-pulsa QR).  
3. Abrir actuadores `triggerQr` del punto (no solo facial).  
4. Portal historial con `scannedInAt` / `scannedOutAt`.  
5. Permanencia UI (visita IN sin OUT → timer; permanente sin timer).

**Done cuando:** flujo vecino→guardia→salida completo en demo.

### Fase D — Live + evidencia (paralelo, 2–4 días)

1. Reintentos / single-flight stream MJPEG.  
2. Pack evidencia: copiar foto evento a storage barrio + galería.  

### Fase E — Personas / credenciales (continuo)

1. Editar persona + vigencia.  
2. Huella / tarjeta física / PIN.  
3. Listado compatible AccessUser.cgi.

### Fase F — Seguridad vecino + intercom (después)

1. Panic: portal SOS + cola portería + pin plano.  
2. FreePBX LAN + softphone real + pack intercom.  
3. Fire / fichadas / alta-DNI según contrato comercial.

### Fase G — Cierre docs + calidad

1. Alinear `MODULES.md`, `ARCHITECTURE.md`, `PENDING.md` con realidad.  
2. Smoke E2E documentado.  
3. Playbook deploy por barrio.

---

## 5. Orden de trabajo recomendado (siguiente sprint)

```
A1 same-device outSlots + resolveOpen
A2 verificar toast F5 + agent
B1 UI access points (MVP cablear device+actuator)
C1 unificar QR payload / CardNo
C2 ASI → scanVisitPass
C3 permanencia visitas (mínimo)
… resto según prioridad comercial
```

No mezclar Fase F (intercom) con A/B: distinto stack (SIP).

---

## 6. Criterio de «barrio listo para piloto»

- [x] 2 sentidos cableados en UI (o 1 ASI lab documentado).  
- [x] Facial abre solo relé del punto.  
- [x] Toast sin replay al refresh.  
- [x] QR visita abre y registra IN/OUT.  
- [x] Portal vecino usable.  
- [x] Guardia home usable sin Config.  
- [x] Agent + engine monitoreados en status.
