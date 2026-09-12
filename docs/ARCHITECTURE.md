# AccesoPro — arquitectura del monorepo

Plataforma modular de acceso y seguridad para barrios cerrados (Argentina).
**AccesoPro** (nube/dashboard) y **AccesoSeguro** (motor LAN) son productos distintos que se integran por HTTP.

```
┌─────────────────────────────────────────────────────────────────┐
│  NUBE / AccesoPro (contrato, usuarios, plano, actuadores)       │
│  apps/web :3000  │  apps/api :8787  │  apps/agent :8790        │
└────────────────────────────┬────────────────────────────────────┘
                             │ JWT + SITE_ENGINE_URL + agent token
┌────────────────────────────▼────────────────────────────────────┐
│  LAN / AccesoSeguro (RTSP, ALPR, DNI, relé, evidencias)         │
│  apps/site :5051 — config.yaml y evidencia/ NO van a git         │
└─────────────────────────────────────────────────────────────────┘
```

## Sectores del repo

| Sector | Ruta | Rol |
|--------|------|-----|
| **Catálogo** | `packages/catalog` | Módulos tildables (`core`, `actuators`, `alpr`, …) |
| **Dashboard** | `apps/web` | Next.js, UI en español rioplatense, solo muestra lo contratado |
| **API** | `apps/api` | Auth, tenants, hardware, puente al motor LAN, cola del agent |
| **Agent Dahua** | `apps/agent` | CGI Digest, openDoor, eventos faciales → API |
| **Motor LAN** | `apps/site` | FastALPR, QR/DNI, barreras IN/OUT (fork AccesoSeguro) |
| **Reglas Cursor** | `.cursor/rules` | Convenciones del proyecto para el IDE |
| **Docs** | `docs/` | Arquitectura, estado de módulos, playbooks. Sitio físico RB4011 + NAT ASI (retome §0): `docs/SITE_RB4011.md` |

## `apps/web` — dashboard por sectores de UI

Rutas agrupadas con **route groups** de Next.js (los paréntesis no cambian la URL):

| Grupo | Ruta | Contenido |
|-------|------|-----------|
| `(operacion)` | `/dashboard` | KPIs, barreras, detecciones en vivo |
| `(operacion)` | `/dashboard/plano` | Croquis con pines de `access_points` |
| `(operacion)` | `/dashboard/diagnostico` | Triggers, cola de comandos, CGI |
| `(acceso)` | `/dashboard/alpr` | Detecciones del motor LAN |
| `(acceso)` | `/dashboard/dahua` | Terminales faciales |
| `(acceso)` | `/dashboard/actuadores` | Relés con nombre y triggers |
| `(acceso)` | `/dashboard/puntos-acceso` | Cableado de puntos (lector / relé / cámara) |
| `(acceso)` | `/dashboard/visitas` | Check-in portería + pases QR |
| `(acceso)` | `/dashboard/alta-dni` | Enrolamiento DNI portería |
| `(seguridad)` | `/dashboard/panico` | Cola SOS |
| `(seguridad)` | `/dashboard/fuego` | Contacto panel (no certificado) |
| `(admin)` | `/dashboard/fichadas` | Asistencia Dahua |
| `(admin)` | `/dashboard/modulos` | Config AccesoSeguro + módulos AccesoPro |

Componentes principales: `HomeDashboard` (ops dinámico según packs), `ActuatorsPanel`, `ConfigPage`, `EquipmentPanel`, `DebugPanel`.

## `apps/api` — capas

| Archivo | Responsabilidad |
|---------|-----------------|
| `index.ts` | Auth, tenants, módulos, montaje de rutas |
| `auth.ts` | Sesiones JWT / cookies |
| `hardware.ts` | Actuadores, cámaras, patentes, proxy motor LAN, debug |
| `actuatorExec.ts` | Disparo de relés (engine / Dahua / IP) |
| `engineBridge.ts` | Poll eventos AccesoSeguro → triggers QR/chapa |
| `siteEngine.ts` | Cliente HTTP al motor :5051 |
| `agent.ts` | API del site agent (heartbeat, eventos plate/dahua/qr) |
| `accessPoints.ts` | Topología + wiring + resolución de relés |
| `alarms.ts` | SOS pánico y contacto fuego |
| `dniEnroll.ts` | Alta DNI portería |
| `scope.ts` | Multi-tenant, módulos habilitados |
| `seed.ts` | Demo Las Acacias |
| `db/` | SQLite + Drizzle |

## `apps/agent` — LAN Dahua

- `dahua.py` — getSystemInfo, openDoor, accessRecords
- `main.py` — cola de comandos, eventos → `POST /agent/events`
- `alpr.py` — lectura RTSP opcional (el ALPR principal vive en `apps/site`)

## `apps/site` — motor AccesoSeguro

- `acceso_seguro/` — FastAPI, ALPR, access control, relay
- `config.yaml` — local, ignorado por git
- `evidencia/` — fotos en disco, ignorado

## Eje central: actuadores

Un **actuador** = relé con nombre libre. Drivers:

- `engine` — barrera IN/OUT vía motor LAN
- `dahua` — openDoor por canal
- `ip` — HTTP GET a relé

Triggers: chapa (ALPR), cara Dahua, QR/DNI, botón manual.

El puente `engineBridge` lee `/api/events/recent` del motor y dispara actuadores según el checkbox tildado.

## Variables de entorno

Ver `.env.example` en la raíz. Claves RTSP y passwords de cámaras **solo** en `apps/site/config.yaml`.

## Comandos rápidos

```powershell
npm install
npm run dev:api
npm run dev:web
# Motor LAN: apps/site (ver apps/site/README.md)
# Agent Dahua: apps/agent (ver apps/agent/README.md)
```
