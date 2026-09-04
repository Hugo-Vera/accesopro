# Docker — AccesoPro en una máquina

## Requisitos

- **Docker Desktop** (Windows) o **Docker Engine** (Ubuntu)
- 8 GB RAM si usás perfil `alpr` (modelos ONNX)
- 4 GB RAM solo dashboard + API

## Arranque rápido

```powershell
cd C:\Users\Master\AccesoPro
copy .env.docker.example .env
docker compose up -d --build
```

- Dashboard: http://localhost:3000  
- API: http://localhost:8787/health  
- Demo: `admin@lasacacias.local` / `AccesoPro!2026`

### Con motor ALPR (Postgres + FastALPR)

```powershell
docker compose --profile alpr up -d --build
```

- Motor: http://localhost:5051 (`admin` / `admin`)
- Editar RTSP y barreras en `deploy/site.config.docker.yaml` antes de levantar

### Con agent Dahua

```powershell
docker compose --profile dahua up -d --build
```

### Todo

```powershell
docker compose --profile alpr --profile dahua up -d --build
```

## Servicios

| Servicio | Puerto | Perfil | Datos persistentes |
|----------|--------|--------|-------------------|
| `web` | 3000 | core | — |
| `api` | 8787 | core | volumen `api_data` (SQLite) |
| `postgres` | 5432 | alpr | volumen `pgdata` |
| `site` | 5051 | alpr | `site_evidencia` + `config.yaml` |
| `agent` | 8790 | dahua | — |

## RTSP y cámaras desde Docker

Los contenedores ven la LAN del host. En `deploy/site.config.docker.yaml` usá:

- RTSP con IP de cámara en la LAN (ej. `rtsp://user:pass@192.168.1.64:554/...`)
- En Linux, si falla RTSP, probá `network_mode: host` en el servicio `site` (solo Linux).

Puerto COM / Arduino: en Docker es incómodo; en producción suele correr el motor **sin** Docker o con dispositivo USB pasado al contenedor.

## Actualizar

```powershell
git pull
docker compose --profile alpr build
docker compose --profile alpr up -d
```

No se pierden datos: SQLite en `api_data`, Postgres en `pgdata`, fotos en `site_evidencia`.

## Parar

```powershell
docker compose --profile alpr --profile dahua down
```

Para borrar datos: `docker compose down -v` (¡borra bases!).

Ver también: [`DEPLOY_SITE.md`](DEPLOY_SITE.md) (FTP / instalación sin Docker).
