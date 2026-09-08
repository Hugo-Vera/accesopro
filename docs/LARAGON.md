# AccesoPro + Laragon (sin Docker)

AccesoPro **no es PHP**: API (Node) + dashboard (Next) + agent (Python).
Si abrís `http://localhost:8084/accesopro` sin levantar Node, Nginx solo lista el código fuente.

```
Browser → Nginx :8084/accesopro → Next :3080 (basePath /accesopro) → API :8787
```

En esta PC el puerto **3000** suele ser **GenieACS**. AccesoPro web local usa **3080**.

## Arranque

1. En **Laragon**, dejá **Nginx** en verde (MySQL/Postgres no hacen falta para AccesoPro core).
2. En PowerShell:

```powershell
cd C:\laragon\www\accesopro
powershell -ExecutionPolicy Bypass -File scripts\start-laragon.ps1
```

3. Entrá a **http://localhost:8084/accesopro**

El script:

- Instala `deploy/laragon/accesopro.test.conf` (quita el `auto.` que listaba el repo)
- Instala el alias `/accesopro` → Next `:3080`
- Crea `.env` si falta
- Levanta API + Web (web en :3080, no pisa GenieACS)

Agent Dahua (opcional):

```powershell
powershell -File scripts\start-laragon.ps1 -Profile dahua
```

## Cuentas demo

| Usuario | Clave | Rol |
|---|---|---|
| `admin@accesopro.local` | `AccesoPro!2026` | Plataforma |
| `admin@lasacacias.local` | `AccesoPro!2026` | Admin barrio |
| `guardia@lasacacias.local` | `AccesoPro!2026` | Portería |

## Qué no usa AccesoPro de Laragon

| Laragon | ¿Lo usamos? |
|---------|-------------|
| Nginx | Sí (puerta :8084) |
| MySQL / MariaDB | No (API = SQLite) |
| PHP / phpMyAdmin | No |
