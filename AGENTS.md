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
- **Vecino:** QR de visitas; portal `/portal` (autorizaciones, servicios, historial); SOS si `panic` está on.
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
Ej. `dahua_access` se parte en: equipos, eventos, abrir, personas, QR, periodos, evidencia, live.
Cada pack tiene dashboard + capability. Regla completa:

`plan ∩ módulo ∩ feature pack ∩ grant del usuario`

API: `GET/PATCH /api/tenants/:id/features`. UI: Configuración → Módulos (bloque «Funciones del equipo»).

## Arquitectura híbrida

- **Nube / AccesoPro:** dashboard Next (`apps/web`), API módulos (`apps/api`), Dahua CGI agent (`apps/agent`).
- **LAN / AccesoSeguro:** `apps/site` — FastALPR, evidencias, QR DNI, barreras. Corre en :5051. No mezclar ese HTML con el dashboard AccesoPro.
- RTSP y claves de equipos no salen de la LAN ni van a git (`apps/site/config.yaml` está ignorado).

## Catálogo de módulos

Definición viva en `packages/catalog`. Claves: `core` (siempre), `actuators`, `dahua_access`, `visitors`, `dni_enroll`, `alpr`, `panic`, `fire`, `attendance`.

Actuador = relé con **nombre libre** (Barrera entrada, Portón cochera, Puerta peatonal). Driver Dahua, IP o motor LAN (`engine`). Pulso o hold. Las reglas (cara, QR, chapa, botón) disparan un actuador, no “la puerta 1”. Las barreras IN/OUT de AccesoSeguro se mapean a dos actuadores AccesoPro.

Plano del predio = core. Pines arrastrables. Pánico y fuego aparecen cuando el módulo está tildado.

## Stack

Monorepo: `apps/web` (Next.js), `apps/api` (Hono), `apps/agent` (Dahua CGI), `apps/site` (AccesoSeguro / FastALPR). Postgres lo usa el sitio ALPR.

Mapa detallado: `docs/ARCHITECTURE.md`. Estado por módulo: `docs/MODULES.md`. Base de datos: `docs/DATABASE.md`. Pendientes: `docs/PENDING.md` (intercom FreePBX local, personas/credenciales, QR).

## Convenciones

- UI y copy en español rioplatense.
- Mercado Argentina (DNI PDF417/QR, patentes Mercosur).
- Comentarios solo para trampas.

## Comandos

```powershell
npm install
npm run dev:api
npm run dev:web
cd apps\agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ACCESOPRO_API_URL="http://localhost:8787"
$env:SITE_AGENT_TOKEN="accesopro-demo-agent"
uvicorn app.main:app --port 8790
```

Demo: `admin@accesopro.local` / `AccesoPro!2026` (plataforma), `admin@lasacacias.local` / `AccesoPro!2026` (barrio), `guardia@lasacacias.local` / `AccesoPro!2026` (portería), `vecino@lasacacias.local` / `AccesoPro!2026` (propietario demo, portal).

El barrio demo tiene plan **Acceso Pro** (`actuators`, `dahua_access`, `alpr`, `visitors`). ALPR vive en AccesoSeguro (`apps/site`, :5051). El dashboard lee el motor vía `SITE_ENGINE_URL` (por defecto `http://127.0.0.1:5051` en la misma máquina). Dahua facial va por `apps/agent`.
