# Apps — sectores del monorepo

| App | Puerto | Sector | Descripción |
|-----|--------|--------|-------------|
| `web` | 3000 | Nube | Dashboard Next.js modular |
| `api` | 8787 | Nube | API Hono, auth, actuadores, puente LAN |
| `agent` | 8790 | LAN | Site agent: Dahua CGI + cola de comandos |
| `site` | 5051 | LAN | AccesoSeguro: ALPR, DNI, barreras, evidencias |

## Flujo de datos

1. **Chapa autorizada** — AccesoSeguro valida → relé IN/OUT; `engineBridge` dispara actuadores AccesoPro con trigger Chapa/QR.
2. **Cara Dahua** — `apps/agent` poll eventos → `POST /agent/events` → actuadores con trigger Cara.
3. **Abrir manual** — Dashboard → `POST /api/actuators/:id/open`.
4. **Config cámaras/relé** — Dashboard Configuración → proxy a motor `:5051`.

Ver `docs/ARCHITECTURE.md` para el mapa completo.
