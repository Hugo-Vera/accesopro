# Docker / server — AccesoPro (producción)

## Ubuntu: un solo comando

```bash
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/install-ubuntu.sh | bash
```

Instala Docker si hace falta, clona en `/opt/accesopro`, genera `.env` y levanta `web` + `api` + `agent` (profile `dahua`).

Variables: `ACCESOPRO_PROFILE=core|dahua|full`, `ACCESOPRO_DIR=...`, `ACCESOPRO_IP=...`.

### Actualizar (orden fijo tras cada cambio en GitHub)

Playbook completo (permisos `.git`, self-update, anti-errores): **[`docs/UPDATE_UBUNTU.md`](./UPDATE_UBUNTU.md)**.

1. Push a `master`.
2. En el dashboard: **Configuración → Módulos → Actualizar servidor** (preferido), o en consola:
   ```bash
   sudo chown -R "$USER:$USER" /opt/accesopro   # si git falla por permisos root
   curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
   ```
3. Recargar `http://IP:3000`. Conserva volúmenes (`api_data`).

Self-update: `ACCESOPRO_ALLOW_SELF_UPDATE=1`, montaje `/opt/accesopro` + `docker.sock`, y **`ACCESOPRO_OWNER=<usuario-linux>`** en `.env` (evita que el contenedor deje `.git` de root).

### Arranque automático al encender Ubuntu

```bash
sudo systemctl enable --now docker
cd /opt/accesopro && git pull
sudo bash scripts/enable-autostart.sh
```

Queda el servicio `accesopro` (systemd) que hace `docker compose up -d` al boot.

## Qué es “real” vs “simulado”

| Pieza | Simulado (lab) | Real (portería) |
|-------|----------------|-----------------|
| Dashboard + API | `npm run dev:*` | Docker o `start-server.ps1` (`NODE_ENV=production`) |
| Barreras ALPR | `type_in/out: simulated` en config | `ip` o `com` — ver `deploy/site.config.real.example.yaml` |
| Agent Dahua | apagado | profile `dahua` → CGI, openDoor, live, eventos |
| Softphone | overlay «Próximamente» | FreePBX pendiente (no simula 911) |

## Arranque recomendado (esta PC)

```powershell
cd C:\Users\Master\AccesoPro
copy .env.docker.example .env
# editá JWT_SECRET

# Core + Agent Dahua (lo típico AccesoPro)
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Profile dahua

# Solo dashboard + API
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Profile core

# + motor ALPR (Postgres + site :5051)
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Profile full
```

Parar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop-server.ps1
```

### Nativo (sin Docker, producción Node)

Útil si el agent necesita acceso USB/COM o RTSP más directo en Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Native -Profile dahua
```

## Requisitos

- **Docker Desktop** (Windows) o Engine (Ubuntu)
- 4 GB RAM: `core` / `dahua`
- 8 GB RAM: perfil `alpr` / `full` (ONNX)

## Servicios

| Servicio | Puerto | Perfil | Datos |
|----------|--------|--------|-------|
| `web` | 3000 | core | — |
| `api` | 8787 | core | volumen `api_data` |
| `agent` | 8790 | dahua | — |
| `postgres` | 5432 | alpr | `pgdata` |
| `site` | 5051 | alpr | `site_evidencia` + config |

Optimizaciones del compose:

- Postgres **solo** con perfil `alpr` (no ocupa RAM en core/dahua)
- Healthchecks API/web/agent; web espera API healthy
- Web same-origin (`NEXT_PUBLIC_API_URL` vacío + rewrites a `http://api:8787`)
- API conoce `SITE_AGENT_URL=http://agent:8790` (live / CGI)
- Límite CPU/RAM en `site` (ALPR)

## Barreras reales (ALPR)

1. Copiá `deploy/site.config.real.example.yaml` → `deploy/site.config.docker.yaml`
2. Completá IPs de relé + RTSP
3. `start-server.ps1 -Profile alpr` (o `full`)

En AccesoPro, mapeá esas barreras a **actuadores** `driver=engine` (IN/OUT).

## RTSP desde Docker

Usá IP LAN de la cámara (`192.168.x.x`). En Linux, si falla: `network_mode: host` en `site`.

Puerto COM / Arduino: preferí agent/site **nativo** (`-Native`) o pasá el dispositivo USB al contenedor.

## Actualizar

```powershell
git pull
powershell -File scripts\start-server.ps1 -Profile dahua
```

Datos persistentes: no se pierden con `up --build`. Wipe: `scripts\stop-server.ps1 -WipeVolumes`.

Ver también: [`DEPLOY_SITE.md`](DEPLOY_SITE.md).
