# Módulos — catálogo y estado de implementación

Fuente de verdad: `packages/catalog/src/index.ts` (`MODULE_CATALOG` + `PLAN_CATALOG`).

| Módulo | Clave | Depende de | UI dashboard | API / LAN | Notas |
|--------|-------|------------|--------------|-----------|-------|
| Núcleo | `core` | — | Plano (pines), auth, tenants | `index.ts`, `auth.ts` | Siempre on |
| Actuadores | `actuators` | — | `/dashboard/actuadores`, `/dashboard/puntos-acceso` | `hardware.ts`, `actuatorExec.ts`, `accessPoints.ts` | CRUD + cableado |
| Acceso Dahua | `dahua_access` | actuators | `/dashboard/dahua/*` | `agent.ts`, `apps/agent` | Packs: equipos, eventos, abrir, personas, QR, periodos, evidencia, live, intercom |
| Chapas ALPR | `alpr` | actuators | `/dashboard`, `/dashboard/alpr` | `siteEngine.ts`, `engineBridge` | Motor :5051 |
| Visitas | `visitors` | actuators | `/dashboard/visitas`, `/portal` | `visitors.ts`, `visitPass.ts`, `residents.ts` | QR portal + check-in portería |
| Alta DNI | `dni_enroll` | visitors | `/dashboard/alta-dni` | `dniEnroll.ts` | PDF417/QR DNI en portería |
| Pánico | `panic` | — | `/dashboard/panico`, SOS portal | `alarms.ts` | Cola SOS |
| Fuego | `fire` | — | `/dashboard/fuego` | `alarms.ts` | Contacto panel, no certificado |
| Fichadas | `attendance` | dahua_access | `/dashboard/fichadas` | `attendance.ts` | Eventos Dahua + fichada manual |

## Feature packs Dahua

| Pack | Clave | Permiso | Default | UI |
|------|-------|---------|---------|-----|
| Equipos | `dahua.devices` | `access.dahua` | on | `/dashboard/dahua` |
| Eventos y foto | `dahua.events` | `dahua.events` | on | `/dashboard/dahua/eventos` |
| Abrir puerta | `dahua.open` | `dahua.open` | on | (botones openDoor) |
| Personas | `dahua.persons` | `dahua.persons` | on | `/dashboard/dahua/personas` |
| QR nativo | `dahua.qr` | `dahua.qr` | off | `/dashboard/dahua/qr` (≠ QR visita AccesoPro) |
| Periodos | `dahua.schedules` | `dahua.schedules` | off | `/dashboard/dahua/periodos` |
| Evidencia | `dahua.evidence` | `dahua.evidence` | off | `/dashboard/dahua/evidencia` |
| Live | `dahua.live` | `dahua.live` | off | `/dashboard/dahua/live` |
| Intercom | `dahua.intercom` | `dahua.intercom` | off | AccesoPhone; `docs/INTERCOM.md` |

Pendientes (PBX físico, huella/PIN avanzada): `docs/PENDING.md`.

API: `GET/PATCH /api/tenants/:id/features`. El admin tilda packs; el grant decide quién los ve.

## Planes comerciales (Fase 1)

| Plan | Slug | Módulos |
|------|------|---------|
| Esencial | `esencial` | actuators |
| Acceso Pro | `acceso-pro` | actuators, dahua_access, alpr, visitors |
| Seguridad total | `seguridad-total` | todos |

API: `GET /api/plans`, `GET/PUT /api/tenants/:id/subscription`.
Asignar un plan sincroniza `tenant_modules` (enciende los del plan, apaga el resto).
Tildar un módulo fuera del plan → 400. Sin plan no se pueden tildar módulos.

## Permisos (Fase 2)

Capas: plan ∩ módulo ∩ `user_grants`.
Plantilla guardia en `ROLE_TEMPLATES.guard`. UI: `/dashboard/usuarios`.
Demo: `guardia@lasacacias.local` / `AccesoPro!2026`.

## Configuración del motor LAN

La pestaña **Configuración** (`/dashboard/modulos`) replica las tabs de AccesoSeguro (barreras, ALPR, evidencia, DNI, motor, almacenamiento, operadores) vía proxy `GET/POST /api/alpr/engine?p=...`.

No mezclar el HTML de AccesoSeguro con el dashboard AccesoPro.

## Demo Las Acacias

Plan: **Acceso Pro**. Módulos: `actuators`, `dahua_access`, `alpr`, `visitors`.

Credenciales: `admin@lasacacias.local` / `AccesoPro!2026`.
