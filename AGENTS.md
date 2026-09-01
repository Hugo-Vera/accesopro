# AccesoPro — contexto del proyecto

Plataforma de **acceso y seguridad de personas** para barrios cerrados en Argentina.
Sin vínculo con Interplus ni con otros productos.

Si este archivo queda desactualizado, corregirlo en el mismo cambio.

## Qué es

Software modular: el cliente contrata módulos; el super-admin los tilda; el dashboard y el plano solo muestran lo contratado.

No es un sistema contra incendio certificado. El módulo `fire` supervisa un contacto del panel existente.

## Cuentas

- **Plataforma:** tenants y catálogo de módulos.
- **Admin del barrio:** plano, actuadores, equipos, personas.
- **Guardia / portería:** plano + cola de alarmas.
- **Vecino:** QR de visitas; SOS si `panic` está on.
- **Visita:** solo su QR.

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

Mapa detallado: `docs/ARCHITECTURE.md`. Estado por módulo: `docs/MODULES.md`.

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

Demo: `admin@accesopro.local` / `AccesoPro!2026` (plataforma) y `admin@lasacacias.local` / `AccesoPro!2026` (barrio).

El barrio demo tiene tildados `actuators`, `dahua_access` y `alpr`. ALPR de verdad vive en AccesoSeguro (`apps/site`, :5051). El dashboard lee detecciones vía `SITE_ENGINE_URL` (por defecto `http://192.168.33.13:5051`). Dahua facial va por `apps/agent`.
