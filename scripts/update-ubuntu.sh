#!/usr/bin/env bash
# Actualizar AccesoPro en Ubuntu (sin ALPR). Conserva volúmenes / DB.
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
#   # o local:
#   bash /opt/accesopro/scripts/update-ubuntu.sh

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

git fetch --depth 1 origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH" || git reset --hard "origin/$BRANCH"

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

echo ""
echo "Listo. Dashboard: http://${IP}:3000"
echo "Autostart: systemctl status accesopro"
compose --profile dahua ps
