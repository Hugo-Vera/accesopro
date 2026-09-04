# Despliegue en el predio (FTP / copia manual)

Un barrio = **una máquina** (o un servidor en la LAN) con todo lo necesario. No depende de otra PC del barrio.

## Qué corre en el equipo

| Proceso | Puerto | Obligatorio | Notas |
|---------|--------|-------------|--------|
| API AccesoPro | 8787 | Sí | SQLite local `apps/api/data/accesopro.db` |
| Dashboard web | 3000 | Sí | Next.js |
| Motor ALPR (`apps/site`) | 5051 | Si módulo `alpr` | Postgres + modelos ONNX |
| Agent Dahua (`apps/agent`) | 8790 | Si módulo `dahua_access` | Solo si hay terminales Dahua en LAN |

---

## Windows vs Ubuntu — qué elegir

| | **Windows 10/11** | **Ubuntu Server 22/24** |
|---|-------------------|-------------------------|
| Uso típico | PC de prueba en escritorio, ya conocés el stack | Servidor fijo en rack / NUC en portería |
| Pros | Mismo entorno que desarrollo, COM/Arduino fácil, NSSM servicios | Estable, menos RAM, scripts systemd |
| Cons | Updates, antivirus, más RAM | Curva si no usás Linux |
| **Recomendado para tu máquina de prueba** | **Sí**, si es la PC en desuso con Windows | Mejor cuando la dejas 24/7 en el barrio |

Ambos funcionan. Para **probar en casa ahora**: Windows está bien. Para **dejar en el barrio**: Ubuntu o Windows con servicios.

---

## Preparación del equipo (checklist)

### Común (Windows y Ubuntu)

1. **Node.js 20+** — API y web  
   - Windows: https://nodejs.org  
   - Ubuntu: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -bash && sudo apt install -y nodejs`

2. **Python 3.11 o 3.12** — motor ALPR y agent Dahua  
   - Ubuntu: `sudo apt install python3 python3-venv python3-pip`

3. **Git** (opcional si subís por FTP sin git en destino)

4. **Red**  
   - IP fija en la LAN (ej. `192.168.1.50`)  
   - Firewall: abrir **3000** (dashboard), **8787** (API) solo a la LAN; **5051** solo LAN  
   - RTSP cámaras y Dahua: misma subred, sin salir a internet

5. **Archivos que NUNCA van por FTP/git**  
   - `apps/site/config.yaml` (RTSP y claves)  
   - `.env` con claves reales  
   - `apps/site/evidencia/`  
   - `apps/api/data/accesopro.db` de producción (sí la DB vacía o seed en destino)

### Solo si activás módulo ALPR

6. **PostgreSQL 14+**  
   - Crear DB: `fastalpr` (usuario/pass como en `config.yaml`)  
   - Windows: instalador PostgreSQL o Docker  
   - Ubuntu: `sudo apt install postgresql`  
   - O con Docker en la raíz del repo: `docker compose up -d postgres` (ajustar `config.yaml` user/pass `accesopro`)

7. **Espacio disco**  
   - ~2 GB modelos ALPR (FastALPR/ONNX) tras `pip install`  
   - Evidencias: según retención (GB+)

8. **RAM mínima práctica**  
   - Sin ALPR: 4 GB  
   - Con ALPR + 2 cámaras: **8 GB** recomendado, 16 GB cómodo

### Opcional Dahua

9. Python venv en `apps/agent`, variable `SITE_AGENT_TOKEN` igual que en la API/seed del sitio.

---

## Flujo FTP (actualización sin git en el predio)

FTP sube **archivos**, no instala Node ni Python. En el equipo destino ya tiene que estar el runtime.

### En tu PC de desarrollo (antes de subir)

```powershell
cd C:\Users\Master\AccesoPro
npm install
npm run build -w @accesopro/web
```

Generá un paquete **sin basura**:

**Incluir:** `apps/`, `packages/`, `package.json`, `package-lock.json`, `scripts/`, `docs/`, `.env.example`, `AGENTS.md`

**Excluir:** `node_modules/`, `.next/`, `apps/api/data/`, `apps/site/.venv/`, `apps/site/evidencia/`, `apps/agent/.venv/`, `.git/`, `.env`, `apps/site/config.yaml`

### Subir por FTP

- Cliente: FileZilla, WinSCP, o FTP del hosting  
- Destino ejemplo Windows: `C:\AccesoPro\`  
- Destino ejemplo Linux: `/opt/accesopro/`

### En la máquina de prueba (primera vez)

**Windows (PowerShell admin):**

```powershell
cd C:\AccesoPro
copy .env.example .env
# Editar .env: JWT_SECRET, SITE_ENGINE_URL=http://127.0.0.1:5051

npm install
npm run build -w @accesopro/web

# API (producción)
npm run start -w @accesopro/api
# Web producción
npm run start -w @accesopro/web
```

Para ALPR:

```powershell
cd apps\site
copy config.example.yaml config.yaml
# Editar: db postgres, barreras simulated o IP, RTSP si hay cámaras
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ACCESOPRO_API_URL="http://127.0.0.1:8787"
$env:ACCESOPRO_BRIDGE_KEY="accesopro-bridge"
python run.py
```

**Ubuntu (resumen):**

```bash
cd /opt/accesopro
cp .env.example .env
npm install && npm run build -w @accesopro/web

cd apps/site
cp config.example.yaml config.yaml
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ACCESOPRO_API_URL=http://127.0.0.1:8787
export ACCESOPRO_BRIDGE_KEY=accesopro-bridge
python run.py &
cd /opt/accesopro && npm run start -w @accesopro/api &
npm run start -w @accesopro/web &
```

### Actualizaciones por FTP (solo código)

1. Subir archivos cambiados (o zip completo sin `node_modules`)  
2. En destino: `npm install` si cambió `package-lock.json`  
3. `npm run build -w @accesopro/web` si cambió el frontend  
4. Reiniciar API y web (y motor si tocó `apps/site`)  
5. **No** reemplazar `config.yaml`, `.env`, ni `apps/api/data/accesopro.db`

---

## Arranque rápido dev (tu máquina de prueba)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-accesopro.ps1
```

Luego, si querés ALPR: `cd apps\site` → `python run.py`.

Demo: `admin@lasacacias.local` / `AccesoPro!2026` — vecino: `vecino@lasacacias.local` / mismo pass → `/portal`.

---

## Alternativa: Docker

Si la máquina tiene Docker Desktop o Docker Engine, es más simple que FTP:

```powershell
copy .env.docker.example .env
docker compose up -d --build
# Con ALPR: docker compose --profile alpr up -d --build
```

Detalle: [`DOCKER.md`](DOCKER.md).

## Alternativa mejor que FTP puro

Si la máquina de prueba tiene internet:

```bash
git clone https://github.com/Hugo-Vera/accesopro.git
cd accesopro && npm install
```

Actualizar: `git pull` + `npm install` + `npm run build -w @accesopro/web`.  
FTP queda para barrios **sin git** o con hosting solo FTP.

---

## Servicios 24/7 (cuando dejes la máquina fija)

| OS | API + Web | Motor ALPR |
|----|-----------|------------|
| Windows | NSSM o `pm2` | `install_service.ps1` en `apps/site` |
| Ubuntu | systemd units | systemd + postgres |

(Pendiente: scripts `systemd` y NSSM en el repo.)
