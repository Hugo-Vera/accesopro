# AccesoPro — contexto del proyecto

Plataforma de **acceso y seguridad de personas** para barrios cerrados en Argentina.
Sin vínculo con Interplus ni con otros productos.

Si este archivo queda desactualizado, corregirlo en el mismo cambio.

## Qué es

Software modular: el cliente contrata módulos; el super-admin los tilda; el dashboard y el plano solo muestran lo contratado.

No es un sistema contra incendio certificado. El módulo `fire` supervisa un contacto del panel existente.

## Cuentas

- **Plataforma** (`admin@accesopro.local`): directorio de predios remotos (**Sistema → Barrios**), planes comerciales y catálogo de módulos. No es el padrón unificado de personas: cada Ubuntu tiene su SQLite.
- **Admin del barrio:** entra en la URL de **ese** predio (usuario/clave que le diste al dar de alta). Plano, actuadores, equipos, personas (dentro del plan contratado).
- **Guardia / portería:** plano + live + relés (plantilla `guard`); el admin puede quitar/agregar grants.
- **Vecino:** invite (email + WhatsApp) → `/activar` clave definitiva; portal `/portal` (ficha, familia, servicios, QR si el pack está on). El lote es de solo lectura: `PATCH /api/residents/me` ignora `lote` / `propertyId`. El titular invita familiares adultos (misma mecánica); el menor de 18 se empadrona sin cuenta ni cara en el ASI.
- **Guardia:** puede **invitar propietario** (`access.owners.invite`) sin crear lotes.
- **Visita:** solo su QR (identifica; no abre). Si el titular no arma ventana, el pase dura `tenant_settings.visit_auth_default_hours` (default 24 h; el admin lo cambia en Configuración). Walk-in desde el plano: aviso al lote 120 s, aparte del plazo del pase. **QR vencido al ingreso:** deny duro (toast rojo con fechas, historial, baja `v_…` del ASI); el guardia **no** puede aprobar. La **salida** de alguien que ya está adentro se aprueba igual con aviso «se pasó del horario» (`overstay`). **Sale y vuelve:** en la salida el guardia marca quién sale y si vuelve; al volver, el mismo QR/DNI abre un reingreso rápido (sin repedir documentos; vencido no pasa). Pantalla de salida única y de solo lectura: `docs/SISTEMA.md` §5.
- **Mi QR de acceso** (titular y familiar adulto con cuenta): en portal Ficha / app. Credencial `own_`/`fam_` en `person_credentials`; abre solo (backup de cara). El titular puede emitir QR temporal a familiar sin foto/cuenta.

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

El menú staff (sidebar y grilla de Inicio) sale de `NAV_CATALOG` en `packages/catalog`: Inicio, Predio, Portería, Personas, Instalación, Seguridad, Sistema. Alta DNI, evidencia y departamentos son pestañas, no ítems sueltos. El portal del vecino (`/portal`) no está en el menú operativo.

API: `GET/PATCH /api/tenants/:id/features`. UI: Configuración → Módulos (bloque «Funciones del equipo»).

## Arquitectura

- **Una SQLite por predio.** Cada Ubuntu/garita corre AccesoPro con `apps/api/data/accesopro.db` propio. El **concentrador** guarda el directorio `hub_sites` **y un tenant sombra** por barrio (precarga de lotes, invitaciones, portal WAN, replica). La garita **empuja** replica (`POST /api/hub/sync/push`) y **hace pull** de padrón y autorizaciones (1–2 s si hay avisos walk-in o pases QR `preauthorized`/`awaiting_entry` recientes; si no, ~60 s). Un Ubuntu vacío restaura con `ACCESOPRO_HUB_TOKEN` + `ACCESOPRO_HUB_URL`. Snapshot `GET /api/hub/snapshot` sigue para conteos. UI: `/dashboard/barrios`. Token: header `X-AccesoPro-Hub-Token`. Predio nuevo: `ACCESOPRO_HUB_TOKEN` o `ACCESOPRO_TENANT_NAME` en el `.env` para **no** sembrar Las Acacias. El concentrador **no** debe setear `ACCESOPRO_HUB_TOKEN`. Detalle: `docs/DATABASE.md`, `docs/HUB_BARRIOS.md`. Código: `apps/api/src/hub.ts`, `apps/api/src/hubSync.ts`.
- **AccesoPro:** dashboard Next (`apps/web`), API módulos (`apps/api`), Dahua CGI agent (`apps/agent`).
- Eventos faciales: sync incremental ASI → SQLite (`GET /agent/sync-state` + stream; sin dump del historial del lector al arrancar). La foto del pase la copia el agent una vez (FileManager) a `apps/api/data/evidence`; toast/historial leen `GET /api/events/:id/photo`. Live/toast: `docs/PLAN_PORTERIA.md`.
- Padrón maestro de credenciales (`person_credentials`): AccesoPro replica cara/PIN/tarjeta al ASI para que decida offline. El QR en el ASI-6214S **no** se compara contra `CardNo` (attach: `QRCode` + `ErrorCode` 96). Propietarios y familiares: AccesoPro valida **Mi QR de acceso** (`own_`/`fam_`) y manda `openDoor`. Visitas/proveedores: el QR solo identifica; **no se enrola la cara del invitado** en el ASI (si no, el relé local abre sin el guardia). Tampoco se enrola la cara de un **familiar menor de 18**. El guardia aprueba en dashboard o app Android y recién ahí hay `openDoor`. Validez del pase si el titular no define fechas: `visit_auth_default_hours` del barrio (4–72 h, default 24). El TTL 120 s es solo el aviso walk-in al lote. En modo local el `CardNo` de tarjeta es **hexadecimal** (0-9 A-F, largo par). Un texto como un nombre el lector lo marca código QR inválido. `QRCode.TransmissionEnable` es pass-through nativo Dahua (Back-end Comparison). Huella: se enrola en el lector. Códigos de método: `packages/catalog` `METHOD_CODE_ROWS`. Detalle: `docs/ASI_CGI.md`.
- ALPR: módulo `alpr` nativo (eventos `type=plate`, lista `plates`, cámaras en `access_point_cameras.role=alpr`). Agent opcional `AGENT_ALPR=1`.
- En este predio hay NAT WAN de prueba al ASI (HTTP/SDK/RTSP TCP): **`docs/SITE_RB4011.md`** (sección 0, a mano). CGI vs RTSP del ASI (no mezclar `snapshot.cgi` con live): **`docs/ASI_CGI.md`**.

## Catálogo de módulos

Definición viva en `packages/catalog`. Claves: `core` (siempre), `actuators`, `dahua_access`, `visitors`, `dni_enroll`, `alpr`, `panic`, `fire`, `attendance`.

Actuador = relé con **nombre libre** (Barrera entrada, Portón cochera, Puerta peatonal). Driver Dahua o IP. Pulso o hold.

**Puntos de acceso** (`access_points`): topología del predio (sector vehicular/peatonal/servicio + sentido in/out/both). No es un módulo comercial: solo agrupa cableados.

**Live portería:** tres columnas **Ingreso** | **plano del predio** | **Salida** (historial + actuadores cableados a ese sentido). El toast facial cae sobre el mismo carril (IN izquierda, OUT derecha). AccesoCam RTSP no va en esta pantalla: queda en `/dashboard/dahua/live`. Autorizaciones pendientes van en barra naranja abajo. Clic en un lote del plano: anunciar visita al titular (120 s); el titular autoriza en portal o por teléfono (código de guardia); el guardia abre. El QR preautorizado es otro camino: el titular lo crea en `/portal`; el lector (ASI, dashboard o app) solo identifica y abre la misma ficha; portería carga DNI/constancias y recién ahí hay `openDoor`. Menores en el vehículo: el guardia pulsa Menor y anota cantidad (+/−), sin nombre ni DNI; en la salida se contrasta con lo ingresado y, si no coincide, se avisa al lote de donde está saliendo. El contador de menores existe solo para Visita (`social`); Obra / Servicio y delivery no ingresan con menores. Invitado menor de 18 (por fecha de nacimiento del DNI): alerta con la edad y solo puede ingresar como Visita (API, web y app). Tipos de visita: Visita (`social`), Obra / Servicio (`service`; `contractor` legacy se lee como `service`) y Delivery. **Reglas de ingreso** (Sistema → `/dashboard/reglas-ingreso`, `core.config`): por barrio × tipo × modo (A pie / Vehículo) el admin tilda qué se pide (DNI, patente, seguro + foto, licencia + foto, baúl, ART + seguro de vida + constancia) y si al aprobar se abre la barrera. Catálogo y defaults en `packages/catalog` `entryRules.ts`; lo guardado en `tenant_entry_rules`; API `apps/api/src/entryRules.ts` y faltantes en `visitRequirements.ts`. Web (`apps/web/lib/visitDocs.ts`) y app (`FichaParts.kt`, `GET /api/visitors/entry-rules`) derivan `docRequirements` de la misma regla. Default: A pie = DNI (Obra / Servicio + ART o seguro de vida) y **registra sin abrir la barrera**; Vehículo = + patente, seguro, licencia con foto y baúl, y abre. Sin barrera, «Registrar ingreso/salida» guarda todo y deja tarjeta `noBarrier` en el historial; «Abrir igual» manda `open: true` al decide. Vencido no pasa (sin excepción del titular ni verbal); seguro o licencia vencidos → **Pasar a peatonal**. Baúl: `visit_trunk_checks` (descripción + hasta 6 fotos por sentido); en la salida se comparan ingreso y egreso. Detalle: `docs/SISTEMA.md` §5. Censo de evacuación: `/dashboard/censo` (pack `visitors.census`). Carril en eventos: `lane_code` **1** = entrada, **2** = salida (se sella al ingest). Cableado admin: `/dashboard/puntos-acceso`. El 2º ASI de salida habilita medir permanencia de visitas; propietarios/permanentes no llevan control de tiempo. Softphone SIP: pack `dahua.intercom` + `docs/INTERCOM.md` (FreePBX local).

**Cableado** (tablas de vínculo, reutilizables):
- `access_point_actuators` — qué relé abre ese punto
- `access_point_devices` — qué ASI valida / da live
- `access_point_cameras` — qué cámara ALPR / evidencia / live

Las reglas (cara, QR, ALPR, botón) resuelven el **punto** por el dispositivo que disparó el evento y abren solo los actuadores cableados ahí. No mezclar sectores ni módulos en una sola tabla.

Plano del predio = core (`/dashboard/plano`). Mapa OSM o Google (calles / satélite / híbrido; `NEXT_PUBLIC_MAP_PROVIDER=osm|google`). Los tiles Google salen del endpoint público `mt*.google.com` (sin API key ni facturación; no oficial, puede bloquearse); `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` ya no se usa. Híbrido = satélite + calles/nombres sin comercios. Giro con `leaflet-rotate` (`apps/web/lib/leafletLoader.ts`, Shift + rueda o barra) y zoom fraccionado (paso 0,25). El admin busca el barrio, dibuja lotes (polígono punto a punto o **Rectángulo** arrastrando, Shift = cuadrado, esquinas editables), importa KML/KMZ, gira el plano y guarda la vista (centro, zoom y giro). La API rechaza coordenadas fuera de rango (`apps/api/src/geo.ts`) y el mapa ignora las viejas inválidas. Se guarda en `properties` (`lot_polygon`, `map_lat`/`map_lng`) y la vista en `sites`. Pánico y fuego aparecen cuando el módulo está tildado.

## Stack

Monorepo: `apps/web` (Next.js), `apps/api` (Hono), `apps/agent` (Dahua CGI). AccesoPro usa SQLite.

Radiografía de accesos (ramas own/fam/svc/v_, hold de visita, portería): **`docs/SISTEMA.md`**. HTTPS + cámaras + menú: **`docs/PLAN_HTTPS_MENU.md`**. Mapa del monorepo: `docs/ARCHITECTURE.md`. Estado por módulo: `docs/MODULES.md`. Base de datos: `docs/DATABASE.md`. Alta concentrador + garita: **`docs/HUB_BARRIOS.md`**. Manual de prueba (web + imprimir): **Sistema → Manual** (`/dashboard/manual`). Pendientes: `docs/PENDING.md`. Inventario + plan punta a punta: `docs/ROADMAP.md`. Ops IN/OUT: `docs/OPS_LANES.md`. Sitio físico RB4011 + NAT ASI: `docs/SITE_RB4011.md`. CGI/RTSP ASI: `docs/ASI_CGI.md`. Intercom: `docs/INTERCOM.md`. Smoke: `docs/E2E_SMOKE.md`.

## Convenciones

- UI y copy en español rioplatense.
- Mercado Argentina (DNI PDF417/QR, patentes Mercosur).
- Comentarios solo para trampas.
- Prohibido el uso de emojis tanto en respuestas y explicaciones como en la interfaz de usuario y código fuente. Utilizar siempre iconografía vectorial profesional (SVG / Material icons / Lucide) con estética sobria y técnica.
- **Regla de Creación, Configuración y Edición (Modales)**: Toda alta, edición o configuración de entidades (equipos, personas, tarjetas, huellas, actuadores, usuarios, **lotes/propiedades**, etc.) DEBE realizarse mediante un modal emergente centrado y limpio, NUNCA mediante formularios incrustados o planos inline que deformen la pantalla o desalineen las tablas/listas. La pantalla principal debe mantener un botón superior prominente «Nuevo / Agregar» y una tabla o grilla con botón de **«Configurar / Editar» y «Borrar»** por fila (el admin del barrio edita y elimina lotes en Personas → Lotes). **Todo modal debe cerrarse con Escape** usando el hook `useEscapeKey` (`apps/web/hooks/useEscapeKey.ts`): `useEscapeKey(onClose, open)`.
- **Sin placeholders en inputs**: el `label` nombra el campo. No usar `placeholder="Ej. …"`. Búsqueda: `aria-label` si no hay etiqueta visible. Pistola DNI: `useHidWedge`, no un campo HID a la vista.
- **Soporte Dual de Tema (Claro / Oscuro)**: Todos los componentes, paneles, inputs (`.cfg-input`), tablas y modales deben ser 100% compatibles con modo claro y oscuro (`bg-white` / `dark:bg-slate-900`, `border-slate-200` / `dark:border-slate-700`, texto con alto contraste). NUNCA dejar inputs o bloques negros fijos en modo claro.
- **App Android en el mismo cambio**: si el cambio toca API de avisos, cola de portería, QR de visita, push/FCM o estados de visita, incluir `apps/android` (mismo paquete, sin bumpear `versionCode`). En cola: Escanear (FAB) o carga manual → DNI sin pase abre **Nueva visita** (una pantalla: identidad, antecedentes, lote, tipo, quién autoriza) → **Registrar y dejar pasar** si solo hace falta el DNI y no hay alertas, si no **Registrar y abrir ficha** o **Anunciar al lote** (120 s). La ficha de ingreso (app y web) es un solo scroll con barra fija «Falta: …» + Aprobar y abrir. Detalle: `docs/SISTEMA.md` §5 «Ingreso rápido».
- **Arquitectura de Agente Dahua Concurrente**: En `apps/agent`, la ejecución de comandos interactivos (`_commands_worker`) DEBE correr en un hilo independiente del poller de eventos (`_dahua_poller_worker`) y del heartbeat (`_heartbeat_worker`). Los equipos offline o con falla de autenticación (HTTP 401) deben entrar en enfriamiento (`backoff` de 40s) para no bloquear ni retrasar las pruebas de diagnóstico ni los comandos de apertura inmediata. Las aperturas (`open`, `dahua_open`) van por su propio hilo `_open_commands_worker` (`GET /agent/commands?lane=fast`); el resto por `lane=slow`. La API marca lo entregado `running` y, si el agent no toma una apertura a tiempo, la cancela (`waitOpenCommand`): nunca abrir tarde con la aprobación pendiente.


## Publicar al Ubuntu (orden fijo)

Cada cambio que deba verse en el servidor Docker Ubuntu:

1. Commit + **push a `master`** (`https://github.com/Hugo-Vera/accesopro`).
2. Actualizar el host: dashboard **Configuración → Módulos → Actualizar servidor**, o  
   ```bash
   sudo chown -R hugo:hugo /opt/accesopro   # como hugo, no tras sudo su; $USER en root es root
   curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
   ```
3. Verificar `http://IP:3000` y cámara DNI en `https://IP:3443` (no borrar volúmenes).

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
