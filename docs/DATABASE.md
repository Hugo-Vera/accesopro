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
| `actuators` | Relés con nombre, driver, triggers IN/OUT |
| `dahua_devices` | Terminales faciales |
| `cameras` | RTSP → actuador (referencia nube) |
| `plates` | Lista blanca/negra en API (complementa motor) |
| `events` | Auditoría: plate, qr_access, visit_scan, … |
| `commands` | Cola agent + log engine.open |

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
site 1 ── N actuators
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
