# Base de datos AccesoPro

**Una SQLite por Ubuntu.** Cada garita tiene `apps/api/data/accesopro.db`. El concentrador tiene **la suya**: directorio `hub_sites` **más un tenant sombra por barrio** (`replica_tenant_id`) para precargar lotes, invitaciones, portal WAN y replica (padrón, historial dentro de la retención, fotos de evidencia, topología).

```
┌─────────────────────────────────────────────────────────────┐
│  Concentrador (admin@accesopro.local)                       │
│  hub_sites + tenants sombra (lotes, vecinos, replica)       │
│  DNS público / HTTPS :443 → portal, activar, FCM            │
└──────────────────────────┬──────────────────────────────────┘
                           │ garita EMPUJA replica (NAT-friendly)
           ┌───────────────┴───────────────┐
           ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│ Ubuntu predio A     │         │ Ubuntu predio B     │
│ accesopro.db (A)    │         │ accesopro.db (B)    │
│ pull avisos 1–2 s   │         │ restore si está vacía│
└─────────────────────┘         └─────────────────────┘
```

Alta de barrio = fila en `hub_sites` + **bootstrap local del tenant sombra** (aunque no haya URL de garita). Si hay URL, también intenta `POST /api/hub/bootstrap` remoto. Ubuntu vacío con `ACCESOPRO_HUB_TOKEN` + `ACCESOPRO_HUB_URL` restaura el dump (`GET /api/hub/sync/restore`). Contrato: `apps/api/src/hubSync.ts`. Paso a paso: [`docs/HUB_BARRIOS.md`](HUB_BARRIOS.md).

Variable API: `DATABASE_URL=file:./data/accesopro.db` (relativo a `apps/api`). Predio nuevo: `ACCESOPRO_HUB_TOKEN` o `ACCESOPRO_TENANT_NAME` para saltear el seed demo. El concentrador **no** debe setear `ACCESOPRO_HUB_TOKEN` (si no, no se crea `admin@accesopro.local`).

La API **hoy** usa SQLite (libsql + Drizzle). El esquema SQL para copiar a un server externo (Postgres / MySQL Laragon) está en [`docs/sql/`](sql/README.md). Fechas = epoch en milisegundos. Booleanos = `0` / `1`.

Fuente viva de columnas: `apps/api/src/db/schema.ts` + `migrate.ts`.

Replica: `POST /api/hub/sync/push`, `GET /api/hub/sync/pull?since=`, `GET /api/hub/sync/restore`, `POST /api/hub/sync/notice` (walk-in inmediato), fotos `GET/POST /api/hub/sync/photo`. Auth: `X-AccesoPro-Hub-Token`. Conflicto: gana el `updated_at` / `decided_at` / `created_at` más nuevo.

---

## AccesoPro — catálogo de tablas

### Plataforma y auth

| Tabla | Uso |
|-------|-----|
| `hub_sites` | **Concentrador:** directorio de predios (URL LAN/pública opcional, plan, token, snapshot, `replica_tenant_id`, último sync). |
| `tenants` | Barrio **de esta SQLite** (un predio = un tenant típico). El concentrador no lista barrios por esta tabla. |
| `users` | Login: `platform_admin`, `tenant_admin`, `resident`, `guard`. `guard_code`: PIN 4–8 dígitos (autorización por llamada en portería). |
| `sessions` | Sesión cookie JWT |
| `plans` | Catálogo comercial (sync desde `PLAN_CATALOG`) |
| `tenant_subscriptions` | Plan asignado a cada barrio |
| `tenant_modules` | Módulos tildados por barrio (∩ plan) |
| `tenant_features` | Feature packs dentro de un módulo (ej. Dahua) |
| `user_grants` | Permisos granulares por usuario (capa C) |

**`users.role`:** `platform_admin` (super-admin módulos) · `tenant_admin` (admin del barrio) · `resident` (portal `/portal`) · `guard` (portería).

| Tabla | Columnas clave |
|-------|----------------|
| `hub_sites` | `name`, `slug`, `plan_id`, `base_url`, `cloud_url`, `hub_token`, `admin_email`, `status` (`pending`/`online`/`offline`), `last_seen_at`, `last_snapshot_json` |
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
| `sites` | Predio LAN (`agent_token` Dahua, `hub_token` del concentrador) |
| `access_points` | Topología: entrada/salida/peatonal/servicio (sin mezclar módulos) |
| `access_point_actuators` | Cableado punto ↔ relé (`primary` / `aux`) |
| `access_point_devices` | Cableado punto ↔ Dahua (`validator` / `live` / `both`) |
| `access_point_cameras` | Cableado punto ↔ cámara (`alpr` / `evidence` / `live`) |
| `actuators` | Relés reutilizables (driver, pulso, triggers) |
| `dahua_devices` | Terminales faciales / IP (credenciales) |
| `cameras` | RTSP (referencia; vínculo ALPR vía `access_point_cameras` o `actuator_id`) |
| `departments` | Departamentos Dahua (periodos / personas) |
| `plates` | Lista blanca/negra de patentes |
| `events` | Auditoría incremental: `dahua_access`, plate, qr_access, visit_scan, fichadas |
| `commands` | Cola del agent Dahua |

**Regla modular:** cada entidad vive sola; el **cableado** une. Un facial peatonal no abre barreras vehiculares si no está cableado al mismo punto.

| Tabla | Columnas clave |
|-------|----------------|
| `sites` | `id`, `tenant_id`, `name`, `agent_token`, `hub_token` (snapshot/bootstrap del concentrador), `last_seen_at`, `map_lat`/`map_lng`/`map_zoom`/`map_bearing` (vista del plano), `map_view_saved` (1 si el admin guardó la cámara), `map_overlays` (capas KML) |
| `dahua_devices` | `host`, `port` (HTTP/CGI), `rtsp_port`, `pss_port` (SmartPSS 37777), `username`, `password`, `device_type` (`asi_facial` / `camera_ip` / …), `sentido` (`in`/`out`), `lane_sector` (`vehicular`/`peatonal`), `use_live`, `use_local_relay` |
| `actuators` | `name`, `kind`, `driver` (`dahua` / `ip`), `dahua_device_id`, `dahua_channel`, `pulse_ms`, `trigger_alpr`/`dahua`/`qr`/`manual` |
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
2. Stream HTTP `eventManager.cgi?action=attach&codes=[AccessControl]&heartbeat=5` (PDF Access Control). Detalle: `docs/ASI_CGI.md`.
3. RecordFinder (poll) solo corre si el stream está caído: pide 5–12 registros nuevos respecto del cursor.
4. `POST /agent/events` deduplica por `deviceId`+`recNo`.
5. El dashboard hidrata `GET /api/events?limit=24`. La página Eventos usa `limit=80`.

Visita: ingreso en carril 1 (`visit_passes.scanned_in_at`) y egreso en carril 2 (`scanned_out_at`). Permanencia = salida − ingreso. Propietarios y permanentes **no** llevan control de tiempo.

### Propietarios y visitas (módulo `visitors`)

| Tabla | Uso |
|-------|-----|
| `properties` | Lote, label, GPS casa (`map_lat`, `map_lng`), polígono GeoJSON (`lot_polygon`), dirección. Único `(site_id, lot_number)` |
| `owner_profiles` | Vecino ↔ `users` ↔ `properties` (DNI, WhatsApp, foto, sync Dahua). El lote queda fijo en `property_id`; `PATCH /api/residents/me` ignora `lote` / `lotNumber` / `propertyId`. |
| `property_family_members` | Grupo familiar del lote (foto / Dahua / vigencia). `user_id` si el titular lo invitó a la app. |
| `owner_notices` | Avisos al lote (walk-in 120 s, bien, traslado). `decided_by_user_id` = quién autorizó. |
| `tenant_settings` | Retención comercial (días) y `visit_auth_default_hours` (validez QR si el titular no arma ventana; default 24) |
| `push_devices` | Tokens FCM (web / Android) por usuario |
| `property_services` | Jardinero, empleada, horarios, fechas, foto |
| `dahua_period_slots` | Huella de horario → índice `AccessTimeSchedule` por ASI |
| `credential_device_sync` | Enroll OK/error por lector (ingreso/salida) |
| `visit_authorizations` | Autorización temporal (empleada, proveedor) |
| `visit_passes` | QR de visita: vigencia, modalidad (`peatonal`/`vehiculo`; `plataforma` legacy = peatonal), estado de aprobación |
| `visit_companions` | Acompañantes (nombre, DNI, menor, situación) |
| `guard_approvals` | Cola del guardia: entrada/salida, baúl, bien no registrado, walk-in |
| `visitor_identities` | Persona filiatoria DNI (PDF417), lista negra |
| `vehicles` | Parque automotor por patente |
| `person_insurances` | Seguro de vida / ART de la persona + constancia en disco |
| `driver_licenses` | Licencia de conducir asociada a `visitor_identities` |
| `visit_records` | Visita transaccional: persona + lote + auto + seguro + licencia |

| Tabla | Columnas clave |
|-------|----------------|
| `properties` | `lot_number`, `label`, `address`, `map_lat`, `map_lng`, `lot_polygon` |
| `owner_profiles` | `user_id` único, `dni`, `photo_base64`, `dahua_user_id`, `dahua_synced` |
| `visit_passes` | `token`, `arrival_mode`, `status` (preauthorized/awaiting_entry/in_site/awaiting_exit/completed), `dahua_card_no` |
| `visitor_identities` | `dni_number`, `tramite_number`, `last_name`, `first_name`, `raw_pdf417`, `blacklisted` |
| `visit_records` | `visit_type` (default `social`), `status` (sigue al pase: `awaiting_entry`…), `pass_token`, IN/OUT |

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

## QR de visita (control estricto)

1. Vecino (o portería walk-up) genera pase → `visit_passes.token`
2. Payload QR: token crudo (legacy `ACCESOPRO:V1:{token}`)
3. El lector identifica (Error 96) y **no abre**. AccesoPro crea `guard_approvals`.
4. El guardia aprueba o deniega en dashboard o app Android → recién ahí `openDoor`.
5. Propietarios / familia / servicios permanentes siguen abriendo solos.

`GET /api/hub/snapshot` (token de hub) cuenta **esta** SQLite: lotes, propietarios pendientes (`must_change_password`) vs activos, familiares activos, visitas `in_site`, cola de guardia, eventos de hoy.

## Demo (seed)

Barrio Las Acacias con plan **Acceso Pro**. Se crea solo si la SQLite está vacía (`seedIfEmpty`) **y** no hay `ACCESOPRO_HUB_TOKEN` ni `ACCESOPRO_TENANT_NAME` (predio nuevo espera el bootstrap del concentrador).

| Email | Rol | Lote |
|-------|-----|------|
| `vecino@lasacacias.local` | resident | 15 |
| `admin@lasacacias.local` | tenant_admin | — |
| `guardia@lasacacias.local` | guard | — |
| `admin@accesopro.local` | platform_admin | — |

Propiedad demo: `prop_las_acacias_15` con GPS de ejemplo.
