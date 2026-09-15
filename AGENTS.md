# AccesoPro — contexto del proyecto

Plataforma de **acceso y seguridad de personas** para barrios cerrados en Argentina.
Sin vínculo con Interplus ni con otros productos.

Si este archivo queda desactualizado, corregirlo en el mismo cambio.

## Qué es

Software modular: el cliente contrata módulos; el super-admin los tilda; el dashboard y el plano solo muestran lo contratado.

No es un sistema contra incendio certificado. El módulo `fire` supervisa un contacto del panel existente.

## Cuentas

- **Plataforma:** tenants, planes comerciales y catálogo de módulos.
- **Admin del barrio:** plano, actuadores, equipos, personas (dentro del plan contratado).
- **Guardia / portería:** plano + live + relés (plantilla `guard`); el admin puede quitar/agregar grants.
- **Vecino:** invite (email + WhatsApp) → `/activar` clave definitiva; portal `/portal` (ficha, familia, servicios, QR si el pack está on).
- **Guardia:** puede **invitar propietario** (`access.owners.invite`) sin crear lotes.
- **Visita:** solo su QR.

## Planes (Fase 1)

Catálogo en `packages/catalog` (`PLAN_CATALOG`): **Esencial**, **Acceso Pro**, **Seguridad total**.
El dueño de plataforma asigna el plan al barrio (`PUT /api/tenants/:id/subscription`).
Los módulos habilitables = intersección plan ∩ toggles. Sin plan no se pueden tildar módulos.

## Permisos granulares (Fase 2)

Catálogo `CAPABILITY_CATALOG` + tabla `user_grants`.
Regla: plan del barrio ∩ plantilla/rol ∩ grants del usuario.
Plantilla guardia: ops + ALPR + eventos/abrir Dahua (sin `core.config` ni `tenant.grants`).
API: `GET/POST /api/users`, `PUT /api/users/:id/grants`. UI: `/dashboard/usuarios`.
Demo guardia: `guardia@lasacacias.local` / `AccesoPro!2026`.

## Feature packs (funciones dentro de un módulo)

Además del módulo contratado, el admin tilda **funciones** (`FEATURE_PACK_CATALOG` → `tenant_features`).
Ej. `dahua_access` se parte en: equipos, eventos, abrir, personas, **facial**, huella, tarjeta, PIN, QR (off por defecto), periodos, evidencia, live, intercom, puerta, alarma.
Cada pack tiene dashboard + capability. Regla completa:

`plan ∩ módulo ∩ feature pack ∩ grant del usuario`

API: `GET/PATCH /api/tenants/:id/features`. UI: Configuración → Módulos (bloque «Funciones del equipo»).

## Arquitectura

- **AccesoPro:** dashboard Next (`apps/web`), API módulos (`apps/api`), Dahua CGI agent (`apps/agent`).
- Eventos faciales: sync incremental ASI → SQLite (`GET /agent/sync-state` + stream; sin dump del historial del lector al arrancar). La foto del pase la copia el agent una vez (FileManager) a `apps/api/data/evidence`; toast/historial leen `GET /api/events/:id/photo`. Live/toast: `docs/PLAN_PORTERIA.md`.
- Padrón maestro de credenciales (`person_credentials`): AccesoPro replica cara/PIN/tarjeta al ASI para que decida offline. El QR en el ASI-6214S **no** se compara contra `CardNo` (attach: `QRCode` + `ErrorCode` 96); AccesoPro valida el string y manda `openDoor`. En modo local el `CardNo` de tarjeta es **hexadecimal** (0-9 A-F, largo par). Un texto como un nombre el lector lo marca código QR inválido. `QRCode.TransmissionEnable` es pass-through nativo Dahua (Back-end Comparison). Huella: se enrola en el lector. Códigos de método: `packages/catalog` `METHOD_CODE_ROWS`. Detalle: `docs/ASI_CGI.md`.
- ALPR: módulo `alpr` nativo (eventos `type=plate`, lista `plates`, cámaras en `access_point_cameras.role=alpr`). Agent opcional `AGENT_ALPR=1`.
- En este predio hay NAT WAN de prueba al ASI (HTTP/SDK/RTSP TCP): **`docs/SITE_RB4011.md`** (sección 0, a mano). CGI vs RTSP del ASI (no mezclar `snapshot.cgi` con live): **`docs/ASI_CGI.md`**.

## Catálogo de módulos

Definición viva en `packages/catalog`. Claves: `core` (siempre), `actuators`, `dahua_access`, `visitors`, `dni_enroll`, `alpr`, `panic`, `fire`, `attendance`.

Actuador = relé con **nombre libre** (Barrera entrada, Portón cochera, Puerta peatonal). Driver Dahua o IP. Pulso o hold.

**Puntos de acceso** (`access_points`): topología del predio (sector vehicular/peatonal/servicio + sentido in/out/both). No es un módulo comercial: solo agrupa cableados.

**Live portería:** tres columnas **Ingreso** | **plano del predio** | **Salida** (historial + actuadores cableados a ese sentido). El toast facial cae sobre el mismo carril (IN izquierda, OUT derecha). AccesoCam RTSP no va en esta pantalla: queda en `/dashboard/dahua/live`. Autorizaciones pendientes van en barra naranja abajo. Carril en eventos: `lane_code` **1** = entrada, **2** = salida (se sella al ingest). Cableado admin: `/dashboard/puntos-acceso`. El 2º ASI de salida habilita medir permanencia de visitas; propietarios/permanentes no llevan control de tiempo. Softphone SIP: pack `dahua.intercom` + `docs/INTERCOM.md` (FreePBX local).

**Cableado** (tablas de vínculo, reutilizables):
- `access_point_actuators` — qué relé abre ese punto
- `access_point_devices` — qué ASI valida / da live
- `access_point_cameras` — qué cámara ALPR / evidencia / live

Las reglas (cara, QR, ALPR, botón) resuelven el **punto** por el dispositivo que disparó el evento y abren solo los actuadores cableados ahí. No mezclar sectores ni módulos en una sola tabla.

Plano del predio = core (`/dashboard/plano`). Mapa OSM o Google (calles / satélite / híbrido; `NEXT_PUBLIC_MAP_PROVIDER=osm|google`, opcional `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`). El admin busca el barrio, dibuja lotes, importa KML/KMZ, gira el plano y guarda la vista (centro, zoom y giro). Se guarda en `properties` (`lot_polygon`, `map_lat`/`map_lng`) y la vista en `sites`. Pánico y fuego aparecen cuando el módulo está tildado.

## Stack

Monorepo: `apps/web` (Next.js), `apps/api` (Hono), `apps/agent` (Dahua CGI). AccesoPro usa SQLite.

Mapa detallado: `docs/ARCHITECTURE.md`. Estado por módulo: `docs/MODULES.md`. Base de datos: `docs/DATABASE.md`. Pendientes: `docs/PENDING.md`. Inventario + plan punta a punta: `docs/ROADMAP.md`. Ops IN/OUT: `docs/OPS_LANES.md`. Sitio físico RB4011 + NAT ASI: `docs/SITE_RB4011.md`. CGI/RTSP ASI: `docs/ASI_CGI.md`. Intercom: `docs/INTERCOM.md`. Smoke: `docs/E2E_SMOKE.md`.

## Convenciones

- UI y copy en español rioplatense.
- Mercado Argentina (DNI PDF417/QR, patentes Mercosur).
- Comentarios solo para trampas.
- Prohibido el uso de emojis tanto en respuestas y explicaciones como en la interfaz de usuario y código fuente. Utilizar siempre iconografía vectorial profesional (SVG / Material icons / Lucide) con estética sobria y técnica.
- **Regla de Creación, Configuración y Edición (Modales)**: Toda alta, edición o configuración de entidades (equipos, personas, tarjetas, huellas, actuadores, usuarios, propiedades, etc.) DEBE realizarse mediante un modal emergente centrado y limpio, NUNCA mediante formularios incrustados o planos inline que deformen la pantalla o desalineen las tablas/listas. La pantalla principal debe mantener un botón superior prominente «Nuevo / Agregar» y una tabla o grilla con botón de «Configurar / Editar» por fila. **Todo modal debe cerrarse con Escape** usando el hook `useEscapeKey` (`apps/web/hooks/useEscapeKey.ts`): `useEscapeKey(onClose, open)`.
- **Soporte Dual de Tema (Claro / Oscuro)**: Todos los componentes, paneles, inputs (`.cfg-input`), tablas y modales deben ser 100% compatibles con modo claro y oscuro (`bg-white` / `dark:bg-slate-900`, `border-slate-200` / `dark:border-slate-700`, texto con alto contraste). NUNCA dejar inputs o bloques negros fijos en modo claro.
- **Arquitectura de Agente Dahua Concurrente**: En `apps/agent`, la ejecución de comandos interactivos (`_commands_worker`) DEBE correr en un hilo independiente del poller de eventos (`_dahua_poller_worker`) y del heartbeat (`_heartbeat_worker`). Los equipos offline o con falla de autenticación (HTTP 401) deben entrar en enfriamiento (`backoff` de 40s) para no bloquear ni retrasar las pruebas de diagnóstico ni los comandos de apertura inmediata.


## Publicar al Ubuntu (orden fijo)

Cada cambio que deba verse en el servidor Docker Ubuntu:

1. Commit + **push a `master`** (`https://github.com/Hugo-Vera/accesopro`).
2. Actualizar el host: dashboard **Configuración → Módulos → Actualizar servidor**, o  
   ```bash
   sudo chown -R hugo:hugo /opt/accesopro   # como hugo, no tras sudo su; $USER en root es root
   curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
   ```
3. Verificar `http://IP:3000` (no borrar volúmenes).

Detalle: `docs/UPDATE_UBUNTU.md` · `.cursor/rules/deploy-update.mdc` · `docs/DOCKER.md`.

## Comandos

```powershell
npm install
npm run local
# Agent Dahua en la misma consola:
npm run local:dahua
# Parar:
npm run local:stop
```

En PCs con Laragon el dashboard queda en `http://localhost:3080/accesopro` (el :3000 suele ser GenieACS) y, si Nginx esta verde, `http://localhost:8084/accesopro`.

Para levantar solo un proceso: `npm run dev:api` / `npm run dev:web`. Agent a mano:

```powershell
cd apps\agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ACCESOPRO_API_URL="http://localhost:8787"
$env:SITE_AGENT_TOKEN="accesopro-demo-agent"
uvicorn app.main:app --port 8790
```

Demo: `admin@accesopro.local` / `AccesoPro!2026` (plataforma), `admin@lasacacias.local` / `AccesoPro!2026` (barrio), `guardia@lasacacias.local` / `AccesoPro!2026` (portería), `vecino@lasacacias.local` / `AccesoPro!2026` (propietario demo, portal).

El barrio demo tiene plan **Acceso Pro** (`actuators`, `dahua_access`, `alpr`, `visitors`). ALPR vive en AccesoPro (eventos de chapa + lista de patentes). Dahua facial va por `apps/agent`.
