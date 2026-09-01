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
| `/api/alpr/*` | Detecciones, ops, proxy motor LAN |
| `/api/debug` | Diagnóstico triggers y comandos |
| `/agent/*` | Site agent (token por sitio) |

## Archivos clave

- `actuatorExec.ts` — ejecutar relé (engine / dahua / ip)
- `engineBridge.ts` — eventos QR/chapa desde AccesoSeguro
- `siteEngine.ts` — cliente HTTP `:5051`

Variables: ver `.env.example` en la raíz del monorepo.
