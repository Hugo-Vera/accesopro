# Módulos — catálogo y estado de implementación

Fuente de verdad: `packages/catalog/src/index.ts` (`MODULE_CATALOG` + `PLAN_CATALOG`).

| Módulo | Clave | Depende de | UI dashboard | API / LAN | Notas |
|--------|-------|------------|--------------|-----------|-------|
| Núcleo | `core` | — | Plano (stub), auth, tenants | `index.ts`, `auth.ts` | Siempre on |
| Actuadores | `actuators` | — | `/dashboard/actuadores` | `hardware.ts`, `actuatorExec.ts` | CRUD + open/close |
| Acceso Dahua | `dahua_access` | actuators | `/dashboard/dahua/*` | `agent.ts`, `apps/agent` | Feature packs: equipos, eventos, abrir, personas, QR, periodos, evidencia, live |

## Feature packs Dahua

| Pack | Clave | Permiso | Default | UI |
|------|-------|---------|---------|-----|
| Equipos | `dahua.devices` | `access.dahua` | on | `/dashboard/dahua` |
| Eventos y foto | `dahua.events` | `dahua.events` | on | `/dashboard/dahua/eventos` |
| Abrir puerta | `dahua.open` | `dahua.open` | on | (botones openDoor) |
| Personas | `dahua.persons` | `dahua.persons` | on | `/dashboard/dahua/personas` | Alta cara+QR, listar, borrar |
| QR nativo | `dahua.qr` | `dahua.qr` | off | `/dashboard/dahua/qr` | Stub: ajustes ASI (≠ QR visita AccesoPro) |
| Periodos | `dahua.schedules` | `dahua.schedules` | off | `/dashboard/dahua/periodos` |
| Evidencia | `dahua.evidence` | `dahua.evidence` | off | `/dashboard/dahua/evidencia` |
| Live | `dahua.live` | `dahua.live` | off | `/dashboard/dahua/live` | RTSP stream extra → MJPEG |

Pendientes (intercom FreePBX local, admin de personas/credenciales, QR visitas): `docs/PENDING.md`.

API: `GET/PATCH /api/tenants/:id/features`. El admin tilda packs; el grant decide quién los ve.
| Chapas ALPR | `alpr` | actuators | `/dashboard`, `/dashboard/alpr` | `siteEngine.ts`, `engineBridge` | Motor :5051 |
| Visitas | `visitors` | actuators | `/dashboard/visitas` | — | Stub: QR firmado pendiente |
| Alta DNI | `dni_enroll` | visitors | `/dashboard/alta-dni` | — | Stub: enrolar en portería |
| Pánico | `panic` | — | `/dashboard/panico` | — | Stub: cola alarmas + plano |
| Fuego | `fire` | — | `/dashboard/fuego` | — | Stub: contacto panel, no certificado |
| Fichadas | `attendance` | dahua_access | `/dashboard/fichadas` | — | Stub: eventos Dahua → asistencia |

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
