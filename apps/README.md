# Apps — sectores del monorepo

| App | Puerto | Sector | Descripción |
|-----|--------|--------|-------------|
| `web` | 3000 | Dashboard | Next.js modular |
| `api` | 8787 | API | Hono, auth, actuadores, eventos, ALPR nativo |
| `agent` | 8790 | LAN | Site agent: Dahua CGI + cola de comandos |

## Flujo de datos

1. **Chapa autorizada** — evento `plate` en AccesoPro → lista `plates` → actuadores con trigger Chapa.
2. **Cara Dahua** — `apps/agent` poll eventos → `POST /agent/events` → actuadores con trigger Cara.
3. **Abrir manual** — Dashboard → `POST /api/actuators/:id/open`.

Ver `docs/ARCHITECTURE.md` para el mapa completo.
