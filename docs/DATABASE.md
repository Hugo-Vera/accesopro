# Base de datos AccesoPro

Dos bases en un predio típico: **AccesoPro** (producto) y **motor LAN** (AccesoSeguro / ALPR).

```
┌─────────────────────────────────────────────────────────────┐
│  AccesoPro API — SQLite (apps/api/data/accesopro.db)        │
│  Usuarios, módulos, actuadores, propiedades, visitas QR     │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP local (SITE_ENGINE_URL)
┌───────────────────────────▼─────────────────────────────────┐
│  Motor LAN — PostgreSQL (fastalpr) en apps/site             │
│  Patentes, personas, accesos, pre-autorizaciones, detecciones │
└─────────────────────────────────────────────────────────────┘
```

Variable: `DATABASE_URL=file:./data/accesopro.db` (relativo a `apps/api`).

## AccesoPro — tablas

### Plataforma y auth

| Tabla | Uso |
|-------|-----|
| `tenants` | Barrios (clientes) |
| `users` | Login: `platform_admin`, `tenant_admin`, `resident`, `guard` |
| `sessions` | Sesión cookie JWT |
| `plans` | Catálogo comercial (sync desde `PLAN_CATALOG`) |
| `tenant_subscriptions` | Plan asignado a cada barrio |
| `tenant_modules` | Módulos tildados por barrio (∩ plan) |
| `tenant_features` | Feature packs dentro de un módulo (ej. Dahua) |
| `user_grants` | Permisos granulares por usuario (capa C) |

### Sitio y hardware

| Tabla | Uso |
|-------|-----|
| `sites` | Predio LAN (token del agent Dahua) |
| `access_points` | Topología: entrada/salida/peatonal/servicio (sin mezclar módulos) |
| `access_point_actuators` | Cableado punto ↔ relé (`primary` / `aux`) |
| `access_point_devices` | Cableado punto ↔ Dahua (`validator` / `live` / `both`) |
| `access_point_cameras` | Cableado punto ↔ cámara (`alpr` / `evidence` / `live`) |
| `actuators` | Relés reutilizables (driver, pulso, triggers) |
| `dahua_devices` | Terminales faciales / IP (credenciales) |
| `cameras` | RTSP (referencia nube; vínculo ALPR legacy vía `actuator_id`) |
| `plates` | Lista blanca/negra en API (complementa motor) |
| `events` | Auditoría incremental: `dahua_access`, plate, qr_access, visit_scan. **No** se vuelca el historial completo del ASI. |
| `commands` | Cola agent + log engine.open |

**Regla modular:** cada entidad vive sola; el **cableado** une. Un facial peatonal no abre barreras vehiculares si no está cableado al mismo punto.

### Sync ASI ↔ AccesoPro (`dahua_access`)

El ASI es la fuente de accesos en vivo. La tabla `events` es la fuente del historial en el dashboard.

1. El agent lee `GET /agent/sync-state`: último `recNo` / `rawTime` por `deviceId` (últimas 80 filas, no el ASI entero).
2. Stream HTTP `eventManager.attach` es el camino principal (un hilo por lector).
3. RecordFinder (poll) solo corre si el stream está caído: pide 5–12 registros nuevos respecto del cursor. No reimporta el archivo del equipo.
4. `POST /agent/events` deduplica por `deviceId`+`recNo` (memoria + DB).
5. El dashboard hidrata `GET /api/events?limit=24`. La página Eventos usa `limit=80`.

Índice: `idx_events_site_type_created`.

```
site 1 ── N access_points
access_point 1 ── N actuators   (access_point_actuators)
access_point 1 ── N dahua_devices (access_point_devices)
access_point 1 ── N cameras     (access_point_cameras)
```

Sectores (`ACCESS_POINT_SECTORS` en catálogo): `vehicular` | `peatonal` | `servicio`.
Sentido: `in` | `out` | `both`.


### Propietarios y visitas (módulo `visitors`)

| Tabla | Uso |
|-------|-----|
| `properties` | Lote, label, **GPS** (`map_lat`, `map_lng`), dirección |
| `owner_profiles` | Vecino ↔ `users` ↔ `properties` (DNI, teléfonos) |
| `property_services` | Jardinero, empleada, horarios, días |
| `visit_authorizations` | Autorización temporal (empleada, proveedor) |
| `visit_passes` | QR de visita: token, vigencia, `scanned_in_at` / `scanned_out_at` |

**Roles `users.role`**

- `platform_admin` — super-admin módulos
- `tenant_admin` — admin del barrio
- `resident` — portal `/portal`
- `guard` — portería (ops + grants)

### Relaciones clave

```
tenant 1 ── N sites
tenant 1 ── N properties
property 1 ── N owner_profiles (típico 1 usuario resident)
property 1 ── N property_services
property 1 ── N visit_authorizations
property 1 ── N visit_passes
site 1 ── N access_points
site 1 ── N actuators
access_point ── actuators / dahua_devices / cameras (tablas de cableado)
```

## Motor LAN (`apps/site`) — PostgreSQL

| Tabla | Uso |
|-------|-----|
| `vehiculos` | Patentes, propietario texto, horarios |
| `personas` | DNI enrolados |
| `accesos` | Cada paso IN/OUT con foto y resultado |
| `estadias` | Permanencia (visitas / vehículos dentro) |
| `pre_autorizaciones` | Lista temporal por lote (sincronizada desde AccesoPro) |
| `detecciones` | ALPR con evidencia |
| `operadores` | Login motor (admin, vigilador, propietario legacy) |

AccesoPro **no duplica** todo el ALPR: lee detecciones vía HTTP y empuja autorizaciones al motor cuando el vecino las crea.

## QR de visita

1. Vecino genera pase → `visit_passes.token`
2. Payload QR: `ACCESOPRO:V1:{token}`
3. Lector COM/cámara → motor llama `POST /api/visit-passes/scan` en API local
4. API valida, marca IN/OUT, dispara actuador con trigger **QR**

## Demo (seed)

Barrio Las Acacias con plan **Acceso Pro**.

| Email | Rol | Lote |
|-------|-----|------|
| `vecino@lasacacias.local` | resident | 15 |
| `admin@lasacacias.local` | tenant_admin | — |
| `guardia@lasacacias.local` | guard | — |
| `admin@accesopro.local` | platform_admin | — |

Propiedad demo: `prop_las_acacias_15` con GPS de ejemplo.
