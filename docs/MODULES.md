# Módulos — catálogo y estado de implementación

Fuente de verdad: `packages/catalog/src/index.ts`.

| Módulo | Clave | Depende de | UI dashboard | API / LAN | Notas |
|--------|-------|------------|--------------|-----------|-------|
| Núcleo | `core` | — | Plano (stub), auth, tenants | `index.ts`, `auth.ts` | Siempre on |
| Actuadores | `actuators` | — | `/dashboard/actuadores` | `hardware.ts`, `actuatorExec.ts` | CRUD + open/close |
| Acceso Dahua | `dahua_access` | actuators | `/dashboard/dahua` | `agent.ts`, `apps/agent` | Probe, openDoor, eventos |
| Chapas ALPR | `alpr` | actuators | `/dashboard`, `/dashboard/alpr` | `siteEngine.ts`, `engineBridge` | Motor :5051 |
| Visitas | `visitors` | actuators | `/dashboard/visitas` | — | Stub: QR firmado pendiente |
| Alta DNI | `dni_enroll` | visitors | `/dashboard/alta-dni` | — | Stub: enrolar en portería |
| Pánico | `panic` | — | `/dashboard/panico` | — | Stub: cola alarmas + plano |
| Fuego | `fire` | — | `/dashboard/fuego` | — | Stub: contacto panel, no certificado |
| Fichadas | `attendance` | dahua_access | `/dashboard/fichadas` | — | Stub: eventos Dahua → asistencia |

## Configuración del motor LAN

La pestaña **Configuración** (`/dashboard/modulos`) replica las tabs de AccesoSeguro (barreras, ALPR, evidencia, DNI, motor, almacenamiento, operadores) vía proxy `GET/POST /api/alpr/engine?p=...`.

No mezclar el HTML de AccesoSeguro con el dashboard AccesoPro.

## Demo Las Acacias

Módulos tildados: `actuators`, `dahua_access`, `alpr`.

Credenciales: `admin@lasacacias.local` / `AccesoPro!2026`.
