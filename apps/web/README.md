# @accesopro/web

Dashboard Next.js 15. Solo muestra módulos contratados (`ModuleGate` + `Sidebar`).

## Arranque

```powershell
npm run dev -w @accesopro/web
```

`NEXT_PUBLIC_API_URL` → API (default `http://localhost:8787`).

## Estructura `app/dashboard/`

Route groups (no cambian la URL):

- `(operacion)` — dashboard, plano, diagnóstico
- `(acceso)` — ALPR, Dahua, actuadores, visitas, alta DNI
- `(seguridad)` — pánico, fuego
- `(admin)` — fichadas, configuración

Componentes en `components/`. Catálogo de módulos: `@accesopro/catalog`.
