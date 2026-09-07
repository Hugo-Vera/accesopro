#!/usr/bin/env bash
# Habilita arranque automático de AccesoPro al encender Ubuntu.
# Uso:
#   sudo bash /opt/accesopro/scripts/enable-autostart.sh
#   # o:
#   curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/enable-autostart.sh | sudo bash

set -euo pipefail

INSTALL_DIR="${ACCESOPRO_DIR:-/opt/accesopro}"
SERVICE_SRC="${INSTALL_DIR}/deploy/accesopro.service"
SERVICE_DST="/etc/systemd/system/accesopro.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Correr como root: sudo bash $0"
  exit 1
fi

systemctl enable --now docker

if [[ ! -f "$SERVICE_SRC" ]]; then
  echo "No está $SERVICE_SRC — hacé git pull en $INSTALL_DIR primero"
  exit 1
fi

# Sustituir WorkingDirectory si ACCESOPRO_DIR no es /opt/accesopro
sed "s|/opt/accesopro|${INSTALL_DIR}|g" "$SERVICE_SRC" > "$SERVICE_DST"

systemctl daemon-reload
systemctl enable accesopro.service
systemctl start accesopro.service

echo ""
echo "OK — AccesoPro arranca con el sistema."
echo "  Estado:  systemctl status accesopro"
echo "  Logs:    journalctl -u accesopro -f"
echo "  Parar:   systemctl stop accesopro"
echo "  Desact.: systemctl disable accesopro"
systemctl --no-pager --full status accesopro.service || true
