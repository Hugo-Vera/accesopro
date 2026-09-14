# AccesoPro — arquitectura del monorepo

Plataforma modular de acceso y seguridad para barrios cerrados (Argentina).
Todo vive en **AccesoPro**: dashboard, API, agent Dahua y módulo ALPR nativo.

```
┌─────────────────────────────────────────────────────────────────┐
│  AccesoPro                                                      │
│  apps/web :3000  │  apps/api :8787  │  apps/agent :8790        │
│  SQLite · eventos faciales y de chapa · lista de patentes       │
└─────────────────────────────────────────────────────────────────┘
```

## Sectores del repo

| Sector | Ruta | Rol |
|--------|------|-----|
| **Catálogo** | `packages/catalog` | Módulos tildables (`core`, `actuators`, `alpr`, …) |
| **Dashboard** | `apps/web` | Next.js, UI en español rioplatense, solo muestra lo contratado |
| **API** | `apps/api` | Auth, tenants, hardware, cola del agent |
| **Agent Dahua** | `apps/agent` | CGI Digest, openDoor, eventos faciales → API; ALPR opcional (`AGENT_ALPR=1`) |
| **Reglas Cursor** | `.cursor/rules` | Convenciones del proyecto para el IDE |
| **Docs** | `docs/` | Arquitectura, estado de módulos, playbooks. Sitio físico RB4011 + NAT ASI (retome §0): `docs/SITE_RB4011.md`. CGI vs RTSP del ASI: `docs/ASI_CGI.md`. |

## `apps/web` — dashboard por sectores de UI

Rutas agrupadas con **route groups** de Next.js (los paréntesis no cambian la URL):

| Grupo | Ruta | Contenido |
|-------|------|-----------|
| `(operacion)` | `/dashboard` | KPIs, barreras, historial portería |
| `(operacion)` | `/dashboard/plano` | Plano OSM/Google del predio: lotes, casas y capas KML (core) |
| `(operacion)` | `/dashboard/diagnostico` | Triggers, cola de comandos, CGI |
| `(acceso)` | `/dashboard/alpr` | Lecturas de chapa y lista blanca/negra |
| `(acceso)` | `/dashboard/dahua` | Terminales faciales |
| `(acceso)` | `/dashboard/actuadores` | Relés con nombre y triggers |
| `(acceso)` | `/dashboard/puntos-acceso` | Cableado de puntos (lector / relé / cámara) |
| `(acceso)` | `/dashboard/visitas` | Check-in portería + pases QR |
| `(acceso)` | `/dashboard/alta-dni` | Enrolamiento DNI portería |
| `(seguridad)` | `/dashboard/panico` | Cola SOS |
| `(seguridad)` | `/dashboard/fuego` | Contacto panel (no certificado) |
| `(admin)` | `/dashboard/fichadas` | Asistencia Dahua |
| `(admin)` | `/dashboard/modulos` | Plan, módulos y packs AccesoPro |

Componentes principales: `HomeDashboard` (ops dinámico según packs), `ActuatorsPanel`, `ConfigPage`, `EquipmentPanel`, `DebugPanel`.

## `apps/api` — capas

| Archivo | Responsabilidad |
|---------|-----------------|
| `index.ts` | Auth, tenants, módulos, montaje de rutas |
| `auth.ts` | Sesiones JWT / cookies |
| `hardware.ts` | Actuadores, cámaras, patentes, live ALPR nativo, debug |
| `actuatorExec.ts` | Disparo de relés (Dahua / IP) |
| `engineBridge.ts` | Helpers de sentido IN/OUT |
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
- `alpr.py` — lectura RTSP opcional (`AGENT_ALPR=1`)

## Eje central: actuadores

Un **actuador** = relé con nombre libre. Drivers:

- `dahua` — openDoor por canal
- `ip` — HTTP GET a relé

Triggers: chapa (ALPR), cara Dahua, QR/DNI, botón manual.

Las reglas resuelven el **punto de acceso** por el dispositivo/cámara del evento y abren solo los actuadores cableados ahí.

## Variables de entorno

Ver `.env.example` en la raíz. RTSP de equipos se guarda en `dahua_devices` / `cameras` (no en un YAML externo).

## Comandos rápidos

```powershell
npm install
npm run local
# Con agent Dahua: npm run local:dahua
# Parar: npm run local:stop
```
