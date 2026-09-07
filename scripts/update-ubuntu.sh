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
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

INSTALL_DIR="${ACCESOPRO_DIR:-/opt/accesopro}"
BRANCH="${ACCESOPRO_BRANCH:-master}"
PROFILE="${ACCESOPRO_PROFILE:-dahua}"

need_root() {
  if [[ "$(id -u)" -eq 0 ]]; then "$@"
  else sudo "$@"
  fi
}

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
  # Si .git no es escribible por el usuario actual, o corrimos como root: devolver al dueño del host
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
# Misma carpeta vista desde el host (/opt/...) y desde el bind-mount del API (/host/...)
ensure_safe_git_dir "/opt/accesopro"
ensure_safe_git_dir "/host/accesopro"

# Preferir git como el dueño del repo (evita objetos root en .git/)
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


# WEB_ORIGIN con IP LAN si sigue en localhost
IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
IP="${ACCESOPRO_IP:-${IP:-127.0.0.1}}"
if [[ -f .env ]] && grep -q 'WEB_ORIGIN=http://localhost:3000' .env; then
  sed -i "s|WEB_ORIGIN=http://localhost:3000|WEB_ORIGIN=http://${IP}:3000|" .env
  echo "    WEB_ORIGIN → http://${IP}:3000"
fi

case "$PROFILE" in
  core) compose up -d --build ;;
  dahua) compose --profile dahua up -d --build ;;
  *) compose --profile dahua up -d --build ;;
esac

# Asegurar autostart (idempotente)
if [[ -f "$INSTALL_DIR/scripts/enable-autostart.sh" ]]; then
  need_root bash "$INSTALL_DIR/scripts/enable-autostart.sh" || true
fi

fix_repo_ownership

echo ""
echo "Listo. Dashboard: http://${IP}:3000"
echo "Autostart: systemctl status accesopro"
compose --profile dahua ps
