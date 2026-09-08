# Actualizar AccesoPro en Ubuntu (orden correcto)

Playbook para operadores e instaladores. Evita romper `.git` y deja el stack al día tras cada push a `master`.

Repo: `https://github.com/Hugo-Vera/accesopro` · carpeta típica: `/opt/accesopro`

## Orden correcto (siempre)

1. **En la PC de desarrollo:** commit + **push a `master`**.
2. **En el Ubuntu:** actualizar el código y rebuild (vía A o B abajo).
3. **Probar** `http://IP:3000` (dashboard), `:8787/health` (API), `:8790/health` (agent Dahua).

El Ubuntu **no** se actualiza solo con el push: hace falta el paso 2.

## Vía A — Botón del dashboard (preferida)

1. Login admin / plataforma.
2. **Configuración → Módulos** → bloque **Servidor AccesoPro**.
3. **Verificar** → **Actualizar servidor**.
4. El compile (Next.js) tarda **varios minutos** y el dashboard **sigue**. Al recambiar contenedores, `:3000` se cae **30–90 s** (`ERR_CONNECTION_REFUSED`). Esperá y recargá.

**Si el botón todavía es el viejo** (se cae :3000 al toque y no termina): usá **vía B** una vez. Ese `curl` baja el script nuevo; después el botón ya no se suicida con el contenedor API.

Requisitos en `/opt/accesopro/.env`:

```bash
ACCESOPRO_ALLOW_SELF_UPDATE=1
ACCESOPRO_HOST_DIR=/opt/accesopro
ACCESOPRO_OWNER=hugo          # usuario Linux dueño del clone (cambiar al tuyo)
```

El API monta el host en `/host/accesopro` y usa `docker.sock` (ver `docker-compose.yml`).

## Vía B — Consola en el Ubuntu (cuando el botón falla o es la 1ª vez)

**Preferí bajar el script desde GitHub** (así no dependés de un `scripts/update-ubuntu.sh` viejo en disco):

```bash
# Como hugo (NO hagas sudo su: \$USER pasa a ser root y rompe .git)
sudo chown -R hugo:hugo /opt/accesopro
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
```

Equivalente si el repo ya está sano y al día con el script:

```bash
cd /opt/accesopro
git fetch origin master
git reset --hard origin/master
sudo bash scripts/update-ubuntu.sh
```

El script: `git reset --hard origin/master` → `compose build` (sitio en línea, reintenta npm) → `up -d --no-build` → autostart systemd. **No** borra volúmenes (`api_data`).

## Anti-errores (lo que ya nos pasó)

| Error | Causa | Arreglo |
|-------|--------|---------|
| `insufficient permission for adding an object to repository database .git/objects` | Self-update / `sudo` escribió `.git` como **root**; `hugo` no puede hacer `git pull` | `sudo chown -R hugo:hugo /opt/accesopro` y repetir update |
| `detected dubious ownership in repository at '/host/accesopro'` | Git en el contenedor (root) vs dueño del host | El updater marca `safe.directory`; o `git config --global --add safe.directory /host/accesopro` **dentro** del contenedor API |
| Botón «Ya hay una actualización en curso» y no arranca | El API dejó el estado `running` en memoria aunque el updater ya no existe | En 0.2.6 se limpia solo. En 0.2.5: `curl … update-ubuntu.sh` una vez, o recrear el contenedor API |
| `ERR_CONNECTION_REFUSED` en `:3000` a mitad de update | Recambio de contenedores al final (`up -d`) | Esperar 1 min y recargar. El compile largo ya no tumba el sitio |
| `Not possible to fast-forward` / ramas divergidas | `git fetch --depth 1` + `pull --ff-only` en clone de deploy | El script ahora hace `git reset --hard origin/master` |
| `npm ci` / `ECONNRESET` a registry.npmjs.org | Red inestable durante el build | Reintenta 3 veces el build; Dockerfile reintenta `npm ci` |
| `sudo su` + `chown $USER` deja `.git` de root | En root, `$USER` es root | Correr el curl como **hugo**; `ACCESOPRO_OWNER=hugo` en `.env` |

## Variables importantes

| Variable | Rol |
|----------|-----|
| `ACCESOPRO_DIR` / clone en `/opt/accesopro` | Raíz del repo en el host |
| `ACCESOPRO_OWNER` | Usuario Linux dueño del clone (evita `.git` root) |
| `ACCESOPRO_ALLOW_SELF_UPDATE=1` | Habilita el botón del dashboard |
| `ACCESOPRO_HOST_DIR` | En el host: `/opt/accesopro`; en el contenedor API: `/host/accesopro` |
| `ACCESOPRO_BRANCH` | Default `master` |

## Qué no hacer

- No `docker compose down -v` (borra la DB) salvo pedido explícito.
- No mezclar profile `alpr` si no hace falta.
- No editar a mano en el Ubuntu y olvidar push a GitHub (el próximo update pisa el cambio).
- No correr `git` como root en `/opt/accesopro` sin `chown` después.

## Piezas del mecanismo

| Pieza | Ruta |
|-------|------|
| Instalador | `scripts/install-ubuntu.sh` |
| Updater | `scripts/update-ubuntu.sh` |
| Agent LAN Linux | `deploy/docker-compose.linux.yml` |
| API self-update | `apps/api/src/systemUpdate.ts` |
| UI botón | `apps/web/components/ServerUpdatePanel.tsx` |
| Autostart | `scripts/enable-autostart.sh`, `deploy/accesopro.service` |
| Regla Cursor | `.cursor/rules/deploy-update.mdc` |

## Checklist post-update

- [ ] `http://IP:3000` carga
- [ ] `curl -s http://IP:8787/health` → ok
- [ ] `curl -s http://IP:8790/health` → agent + dahua
- [ ] Live / historial / toast facial (si aplica)
- [ ] `ls -ld /opt/accesopro/.git` → dueño = usuario del host (no root)
