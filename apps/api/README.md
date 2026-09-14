# @accesopro/api

API central en Hono. SQLite local (`data/accesopro.db`).

## Arranque

```powershell
npm run dev -w @accesopro/api
# o desde la raíz: npm run dev:api
```

## Rutas principales

| Prefijo | Sector |
|---------|--------|
| `/auth/*` | Login, sesión |
| `/api/tenants/*` | Barrios y módulos (plataforma) |
| `/api/actuators/*` | CRUD actuadores, open/close |
| `/api/alpr/live` | Lecturas de chapa (eventos AccesoPro) |
| `/api/plates` | Lista blanca/negra |
| `/api/debug` | Diagnóstico triggers y comandos |
| `/agent/*` | Site agent (token por sitio) |

## Archivos clave

- `actuatorExec.ts` — ejecutar relé (dahua / ip)
- `hardware.ts` — actuadores, cámaras, patentes, live ALPR
- `agent.ts` — heartbeat y eventos plate/dahua/qr

Variables: ver `.env.example` en la raíz del monorepo.
