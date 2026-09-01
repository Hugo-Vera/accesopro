# AccesoPro

Acceso y seguridad para barrios cerrados (Argentina). Módulos tildables: relés con nombre, facial Dahua, QR de visitas, ALPR, pánico y supervisión de fuego sobre el plano del predio.

Documentación: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/MODULES.md`](docs/MODULES.md)

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

Node 20+.

```powershell
cd C:\Users\Master\AccesoPro
npm install
npm run dev:api
npm run dev:web
```

- API: http://localhost:8787/health
- Dashboard: http://localhost:3000

| Usuario | Clave | Rol |
|---|---|---|
| `admin@accesopro.local` | `AccesoPro!2026` | Plataforma (tilda módulos) |
| `admin@lasacacias.local` | `AccesoPro!2026` | Admin del barrio demo |

Motor LAN y agent Dahua: ver `apps/site/README.md` y `apps/agent/README.md`.

Postgres y Redis (opcionales, no hace falta para el demo):

```powershell
docker compose up -d
```

Copiá `.env.example` a `.env` y ajustá `SITE_ENGINE_URL` si el motor no está en `192.168.33.13:5051`.

## Sectores

| Sector | Dónde | Qué hace |
|--------|-------|----------|
| Nube | `web` + `api` | Auth, módulos, actuadores, proxy al motor |
| LAN Dahua | `agent` | CGI, openDoor, eventos faciales |
| LAN ALPR | `site` | FastALPR, DNI, barreras, evidencias |

**No mezclar** el HTML de AccesoSeguro con el dashboard AccesoPro. RTSP y claves solo en `apps/site/config.yaml` (ignorado por git).
