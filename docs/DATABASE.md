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

Variable API: `DATABASE_URL=file:./data/accesopro.db` (relativo a `apps/api`).

La API **hoy** usa SQLite (libsql + Drizzle). El esquema SQL para copiar a un server externo (Postgres / MySQL Laragon) está en [`docs/sql/`](sql/README.md). Fechas = epoch en milisegundos. Booleanos = `0` / `1`.

Fuente viva de columnas: `apps/api/src/db/schema.ts` + `migrate.ts`.

---

## AccesoPro — catálogo de tablas

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

**`users.role`:** `platform_admin` (super-admin módulos) · `tenant_admin` (admin del barrio) · `resident` (portal `/portal`) · `guard` (portería).

| Tabla | Columnas clave |
|-------|----------------|
| `tenants` | `id`, `name`, `slug` (único), `created_at` |
| `users` | `id`, `tenant_id` (null = plataforma), `email`, `password_hash`, `name`, `role` |
| `sessions` | `id`, `user_id`, `token`, `expires_at` |
| `plans` | `id`, `slug`, `name`, `summary`, `module_keys_json`, `capability_keys_json`, `limits_json`, `sort_order` |
| `tenant_subscriptions` | `tenant_id` PK, `plan_id`, `assigned_at`, `assigned_by_user_id` |
| `tenant_modules` | PK (`tenant_id`, `module_key`), `enabled` |
| `tenant_features` | PK (`tenant_id`, `feature_key`), `enabled` |
| `user_grants` | PK (`user_id`, `capability_key`), `granted_at`, `granted_by_user_id` |

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
| `departments` | Departamentos Dahua (periodos / personas) |
| `plates` | Lista blanca/negra en API (complementa motor) |
| `events` | Auditoría incremental: `dahua_access`, plate, qr_access, visit_scan, fichadas |
| `commands` | Cola agent + log engine.open |

**Regla modular:** cada entidad vive sola; el **cableado** une. Un facial peatonal no abre barreras vehiculares si no está cableado al mismo punto.

| Tabla | Columnas clave |
|-------|----------------|
| `sites` | `id`, `tenant_id`, `name`, `agent_token`, `last_seen_at`, `map_lat`/`map_lng`/`map_zoom` (vista del plano), `map_overlays` (capas KML) |
| `dahua_devices` | `host`, `port` (HTTP/CGI), `rtsp_port`, `pss_port` (SmartPSS 37777), `username`, `password`, `device_type` (`asi_facial` / `camera_ip` / …), `sentido` (`in`/`out`), `lane_sector` (`vehicular`/`peatonal`), `use_live`, `use_local_relay` |
| `actuators` | `name`, `kind`, `driver` (`dahua` / `http` / `engine`), `dahua_device_id`, `dahua_channel`, `pulse_ms`, `trigger_alpr`/`dahua`/`qr`/`manual` |
| `cameras` | `rtsp_url`, `actuator_id` (legacy), `enabled` |
| `access_points` | `sector` (`vehicular`\|`peatonal`\|`servicio`), `sentido` (`in`\|`out`\|`both`), `map_x`/`map_y` |
| `events` | `type`, `payload` (JSON texto), `sentido`, `lane_code` (**1** entrada, **2** salida), `access_point_id` |

Carril: se sella al ingest con el rol **actual** del equipo; no se reescribe si después se cambia la ficha. **No** se vuelca el historial completo del ASI.

Índices: `idx_events_site_type_created`, `idx_events_site_lane_created`.

```
site 1 ── N access_points
access_point 1 ── N actuators   (access_point_actuators)
access_point 1 ── N dahua_devices (access_point_devices)
access_point 1 ── N cameras     (access_point_cameras)
```

### Sync ASI ↔ AccesoPro (`dahua_access`)

El ASI es la fuente de accesos en vivo. La tabla `events` es la fuente del historial en el dashboard.

1. El agent lee `GET /agent/sync-state`: último `recNo` / `rawTime` por `deviceId` (últimas 80 filas, no el ASI entero).
2. Stream HTTP `eventManager.attach` es el camino principal (un hilo por lector).
3. RecordFinder (poll) solo corre si el stream está caído: pide 5–12 registros nuevos respecto del cursor.
4. `POST /agent/events` deduplica por `deviceId`+`recNo`.
5. El dashboard hidrata `GET /api/events?limit=24`. La página Eventos usa `limit=80`.

Visita: ingreso en carril 1 (`visit_passes.scanned_in_at`) y egreso en carril 2 (`scanned_out_at`). Permanencia = salida − ingreso. Propietarios y permanentes **no** llevan control de tiempo.

### Propietarios y visitas (módulo `visitors`)

| Tabla | Uso |
|-------|-----|
| `properties` | Lote, label, GPS casa (`map_lat`, `map_lng`), polígono GeoJSON (`lot_polygon`), dirección. Único `(site_id, lot_number)` |
| `owner_profiles` | Vecino ↔ `users` ↔ `properties` (DNI, teléfonos, foto, sync Dahua) |
| `property_family_members` | Grupo familiar del lote (foto / Dahua) |
| `property_services` | Jardinero, empleada, horarios, días |
| `visit_authorizations` | Autorización temporal (empleada, proveedor) |
| `visit_passes` | QR de visita: `token`, vigencia, `scanned_in_at` / `scanned_out_at` |
| `visitor_identities` | Persona filiatoria DNI (PDF417), lista negra |
| `vehicles` | Parque automotor por patente |
| `vehicle_insurances` | Póliza (Ley 24.449 / SSN) |
| `driver_licenses` | Licencia de conducir asociada a `visitor_identities` |
| `visit_records` | Visita transaccional: persona + lote + auto + seguro + licencia |

| Tabla | Columnas clave |
|-------|----------------|
| `properties` | `lot_number`, `label`, `address`, `map_lat`, `map_lng`, `lot_polygon` |
| `owner_profiles` | `user_id` único, `dni`, `photo_base64`, `dahua_user_id`, `dahua_synced` |
| `visit_passes` | `token` único, `valid_from`/`valid_until`, `status`, `dahua_card_no` |
| `visitor_identities` | `dni_number`, `tramite_number`, `last_name`, `first_name`, `raw_pdf417`, `blacklisted` |
| `visit_records` | `visit_type` (default `social`), `status` (default `in_site`), `pass_token`, IN/OUT |

### Relaciones clave

```
tenant 1 ── N sites
tenant 1 ── N properties
property 1 ── N owner_profiles (típico 1 usuario resident)
property 1 ── N property_family_members
property 1 ── N property_services
property 1 ── N visit_authorizations
property 1 ── N visit_passes
site 1 ── N access_points
site 1 ── N actuators
access_point ── actuators / dahua_devices / cameras (tablas de cableado)
visit_record ── visitor_identities + properties + vehicles? + insurances? + licenses?
```

---

## SQL para base externa

| Archivo | Uso |
|---------|-----|
| [`docs/sql/accesopro.sqlite.sql`](sql/accesopro.sqlite.sql) | Restore / referencia SQLite |
| [`docs/sql/accesopro.postgres.sql`](sql/accesopro.postgres.sql) | `psql -d accesopro -f …` |
| [`docs/sql/accesopro.mysql.sql`](sql/accesopro.mysql.sql) | MariaDB/MySQL de Laragon |
| [`docs/sql/README.md`](sql/README.md) | Cómo aplicarlos |

La API **no** lee todavía Postgres/MySQL: `client.ts` abre libsql. El SQL deja el esquema listo para cuando se cambie el driver o se migre a mano.

---

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

Barrio Las Acacias con plan **Acceso Pro**. Se crea solo si la SQLite está vacía (`seedIfEmpty`).

| Email | Rol | Lote |
|-------|-----|------|
| `vecino@lasacacias.local` | resident | 15 |
| `admin@lasacacias.local` | tenant_admin | — |
| `guardia@lasacacias.local` | guard | — |
| `admin@accesopro.local` | platform_admin | — |

Propiedad demo: `prop_las_acacias_15` con GPS de ejemplo.
