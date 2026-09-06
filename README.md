# AccesoPro

Acceso y seguridad para barrios cerrados (Argentina). Módulos tildables: relés con nombre, facial Dahua, QR de visitas, ALPR, pánico y supervisión de fuego sobre el plano del predio.

Documentación: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/MODULES.md`](docs/MODULES.md)

## Instalación en 1 comando (Ubuntu + Docker)

Como N8N: un script clona, instala Docker si falta, crea `.env` y levanta producción.

```bash
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/install-ubuntu.sh | bash
```

Opciones:

```bash
# Solo API + web (sin agent Dahua)
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/install-ubuntu.sh | ACCESOPRO_PROFILE=core bash

# Forzar IP del dashboard
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/install-ubuntu.sh | ACCESOPRO_IP=192.168.1.50 bash
```

Queda en `/opt/accesopro`. Dashboard: `http://IP:3000`. Detalle: [`docs/DOCKER.md`](docs/DOCKER.md).

## Estructura del monorepo

```
AccesoPro/
├── apps/
│   ├── web/          # Dashboard Next.js (:3000)
│   ├── api/          # API Hono (:8787)
│   ├── agent/        # Site agent Dahua (:8790)
│   └── site/         # Motor LAN AccesoSeguro (:5051)
├── packages/
│   └── catalog/      # Catálogo de módulos
├── docs/               # Arquitectura y estado de módulos
├── .cursor/rules/      # Reglas del IDE
└── AGENTS.md           # Contexto para agentes
```

## Arranque local

### Con XAMPP (Apache, sin Docker)

```powershell
# Apache en verde en XAMPP Control Panel, después:
powershell -ExecutionPolicy Bypass -File scripts\start-xampp.ps1 -Profile dahua
```

Abrí **http://localhost:3080** — detalle en [`docs/XAMPP.md`](docs/XAMPP.md).

### Server real (recomendado — producción)

```powershell
cd C:\Users\Master\AccesoPro
copy .env.docker.example .env
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Profile dahua
```

- Dashboard: http://localhost:3000  
- API: http://localhost:8787/health  
- Agent Dahua: http://localhost:8790/health  
- Doc: [`docs/DOCKER.md`](docs/DOCKER.md)

Parar: `scripts\stop-server.ps1`

### Dev (hot reload)

Node 20+.

```powershell
cd C:\Users\Master\AccesoPro
npm install
npm run dev:api
npm run dev:web
```

| Usuario | Clave | Rol |
|---|---|---|
| `admin@accesopro.local` | `AccesoPro!2026` | Plataforma (tilda módulos) |
| `admin@lasacacias.local` | `AccesoPro!2026` | Admin del barrio demo |

Motor LAN y agent Dahua: ver `apps/site/README.md` y `apps/agent/README.md`.

Barreras ALPR reales (no `simulated`): `deploy/site.config.real.example.yaml`.

Copiá `.env.example` a `.env` para dev. Despliegue: [`docs/DEPLOY_SITE.md`](docs/DEPLOY_SITE.md) · [`docs/DOCKER.md`](docs/DOCKER.md).
## Sectores

| Sector | Dónde | Qué hace |
|--------|-------|----------|
| Nube | `web` + `api` | Auth, módulos, actuadores, proxy al motor |
| LAN Dahua | `agent` | CGI, openDoor, eventos faciales |
| LAN ALPR | `site` | FastALPR, DNI, barreras, evidencias |

**No mezclar** el HTML de AccesoSeguro con el dashboard AccesoPro. RTSP y claves solo en `apps/site/config.yaml` (ignorado por git).
