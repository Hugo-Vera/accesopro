#!/usr/bin/env bash
# Actualizar AccesoPro en Ubuntu (sin ALPR). Conserva volúmenes / DB.
#
# Orden correcto y anti-errores (.git root, dubious ownership):
#   docs/UPDATE_UBUNTU.md
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
#   # o local:
#   bash /opt/accesopro/scripts/update-ubuntu.sh
#
# Tip: en .env poné ACCESOPRO_OWNER=<usuario-linux> para no dejar .git de root.
#
# El compile (`compose build`) deja el dashboard en línea. El corte de :3000
# es solo el `up -d` final (API healthy + web, ~30–90 s).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

INSTALL_DIR="${ACCESOPRO_DIR:-/opt/accesopro}"
BRANCH="${ACCESOPRO_BRANCH:-master}"
PROFILE="${ACCESOPRO_PROFILE:-dahua}"
DATA_DIR="$INSTALL_DIR/apps/api/data"
STATUS_FILE="$DATA_DIR/update.status"
LOG_FILE="$DATA_DIR/update.log"

need_root() {
  if [[ "$(id -u)" -eq 0 ]]; then "$@"
  else sudo "$@"
  fi
}

mkdir -p "$DATA_DIR"
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1
echo running > "$STATUS_FILE"
on_err() {
  echo error > "$STATUS_FILE" || true
}
trap on_err ERR

# Dueño del árbol en el host (self-update del API corre como root y rompe .git).
repo_owner() {
  if [[ -n "${ACCESOPRO_OWNER:-}" ]]; then
    echo "$ACCESOPRO_OWNER"
    return
  fi
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    echo "$SUDO_USER"
    return
  fi
  if [[ -d "$INSTALL_DIR" ]]; then
    stat -c '%U' "$INSTALL_DIR" 2>/dev/null || true
  fi
}

fix_repo_ownership() {
  local owner
  owner="$(repo_owner)"
  [[ -n "$owner" && "$owner" != "root" ]] || return 0
  if [[ "$(id -u)" -eq 0 ]] || [[ ! -w "$INSTALL_DIR/.git/objects" ]]; then
    echo "    Reparando permisos git → $owner:$owner"
    need_root chown -R "$owner:$owner" "$INSTALL_DIR"
  fi
}

compose() {
  local files=(-f docker-compose.yml)
  if [[ -f deploy/docker-compose.linux.yml ]]; then
    files+=(-f deploy/docker-compose.linux.yml)
  fi
  if docker info >/dev/null 2>&1; then
    docker compose "${files[@]}" "$@"
  else
    need_root docker compose "${files[@]}" "$@"
  fi
}

profile_args=()
if [[ "$PROFILE" != "core" ]]; then
  profile_args=(--profile dahua)
fi

echo "==> Actualizando AccesoPro en $INSTALL_DIR"
cd "$INSTALL_DIR"
fix_repo_ownership

# Git 2.35+ rechaza el repo si el dueño del dir (host) != uid del proceso (p.ej. root en el contenedor API).
ensure_safe_git_dir() {
  local dir="$1"
  if git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "$dir"; then
    return 0
  fi
  git config --global --add safe.directory "$dir" 2>/dev/null || true
}
ensure_safe_git_dir "$INSTALL_DIR"
ensure_safe_git_dir "/opt/accesopro"
ensure_safe_git_dir "/host/accesopro"

OWNER="$(repo_owner)"
run_git() {
  if [[ "$(id -u)" -eq 0 && -n "$OWNER" && "$OWNER" != "root" ]] && command -v runuser >/dev/null 2>&1; then
    runuser -u "$OWNER" -- git -C "$INSTALL_DIR" "$@"
  elif [[ "$(id -u)" -eq 0 && -n "$OWNER" && "$OWNER" != "root" ]]; then
    su -s /bin/bash "$OWNER" -c 'git -C "$1" "${@:2}"' -- "$INSTALL_DIR" "$@"
  else
    git "$@"
  fi
}

run_git fetch --depth 1 origin "$BRANCH"
run_git checkout "$BRANCH"
run_git pull --ff-only origin "$BRANCH" || run_git reset --hard "origin/$BRANCH"
fix_repo_ownership

IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
IP="${ACCESOPRO_IP:-${IP:-127.0.0.1}}"
if [[ -f .env ]] && grep -q 'WEB_ORIGIN=http://localhost:3000' .env; then
  sed -i "s|WEB_ORIGIN=http://localhost:3000|WEB_ORIGIN=http://${IP}:3000|" .env
  echo "    WEB_ORIGIN → http://${IP}:3000"
fi

echo "==> Compilando imágenes (el dashboard :3000 sigue en línea)"
compose "${profile_args[@]}" build --parallel

echo "==> Recreando contenedores (corte breve de :3000 hasta que el API esté healthy)"
compose "${profile_args[@]}" up -d --no-build --remove-orphans

if [[ "${ACCESOPRO_SKIP_AUTOSTART:-}" != "1" && -f "$INSTALL_DIR/scripts/enable-autostart.sh" ]]; then
  need_root bash "$INSTALL_DIR/scripts/enable-autostart.sh" || true
fi

fix_repo_ownership
echo ok > "$STATUS_FILE"

echo ""
echo "Listo. Dashboard: http://${IP}:3000"
echo "Autostart: systemctl status accesopro"
compose "${profile_args[@]}" ps
