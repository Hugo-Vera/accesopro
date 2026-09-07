#!/usr/bin/env bash
# AccesoPro — instalador Ubuntu (estilo N8N: un solo comando)
#
# Uso (desde cualquier Ubuntu con internet):
#   curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/install-ubuntu.sh | bash
#
# Variables opcionales:
#   ACCESOPRO_DIR=/opt/accesopro
#   ACCESOPRO_PROFILE=dahua|core|full   (default: dahua)
#   ACCESOPRO_IP=192.168.x.x            (si no, detecta)
#   ACCESOPRO_BRANCH=master

set -euo pipefail

# Debe ir exportado: no se puede pasar "VAR=x cmd" a need_root_for (rompe como root).
export DEBIAN_FRONTEND=noninteractive

REPO_URL="${ACCESOPRO_REPO:-https://github.com/Hugo-Vera/accesopro.git}"
BRANCH="${ACCESOPRO_BRANCH:-master}"
INSTALL_DIR="${ACCESOPRO_DIR:-/opt/accesopro}"
PROFILE="${ACCESOPRO_PROFILE:-dahua}"
RAW_INSTALL="https://raw.githubusercontent.com/Hugo-Vera/accesopro/${BRANCH}/scripts/install-ubuntu.sh"

RED='\033[0;31m'
GRN='\033[0;32m'
CYN='\033[0;36m'
YLW='\033[1;33m'
NC='\033[0m'

step() { echo -e "\n${CYN}==>${NC} $*"; }
ok()   { echo -e "  ${GRN}OK${NC} $*"; }
warn() { echo -e "  ${YLW}!${NC} $*"; }
die()  { echo -e "${RED}ERROR:${NC} $*" >&2; exit 1; }

need_root_for() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

detect_ip() {
  if [[ -n "${ACCESOPRO_IP:-}" ]]; then
    echo "$ACCESOPRO_IP"
    return
  fi
  # Preferí IP LAN (no docker, no loopback)
  local ip
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  echo "${ip:-127.0.0.1}"
}

ensure_packages() {
  step "Paquetes base (git, curl, ca-certificates)"
  need_root_for apt-get update -qq
  need_root_for apt-get install -y -qq ca-certificates curl git >/dev/null
  ok "apt listo"
}

ensure_docker() {
  step "Docker Engine + Compose"
  if command -v docker >/dev/null 2>&1; then
    ok "Docker ya instalado: $(docker --version 2>/dev/null | head -1)"
  else
    need_root_for apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
    need_root_for systemctl enable --now docker
    ok "Docker instalado"
  fi

  # Compose plugin o binario
  if docker compose version >/dev/null 2>&1; then
    ok "docker compose OK"
  elif command -v docker-compose >/dev/null 2>&1; then
    warn "Usando docker-compose legacy"
  else
    need_root_for apt-get install -y -qq docker-compose-v2 >/dev/null || true
    docker compose version >/dev/null 2>&1 || die "No se pudo instalar docker compose"
  fi

  # Grupo docker para el usuario real (no root)
  local real_user="${SUDO_USER:-$USER}"
  if [[ "$real_user" != "root" ]] && id "$real_user" >/dev/null 2>&1; then
    if ! id -nG "$real_user" | tr ' ' '\n' | grep -qx docker; then
      step "Agregando $real_user al grupo docker"
      need_root_for usermod -aG docker "$real_user"
      warn "Para sesiones nuevas ya no hace falta sudo. Esta instalación usa sudo docker."
    fi
  fi
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    need_root_for docker "$@"
  fi
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker compose "$@"
  elif docker compose version >/dev/null 2>&1; then
    need_root_for docker compose "$@"
  else
    need_root_for docker-compose "$@"
  fi
}

clone_or_update() {
  step "Código en $INSTALL_DIR"
  need_root_for mkdir -p "$INSTALL_DIR"
  local real_user="${SUDO_USER:-$USER}"
  if [[ "$real_user" != "root" ]]; then
    need_root_for chown -R "$real_user:$real_user" "$INSTALL_DIR"
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || \
      git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
    ok "Repo actualizado ($BRANCH)"
  else
    if [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]]; then
      die "$INSTALL_DIR no está vacío y no es un repo git. Vaciá o elegí otro ACCESOPRO_DIR."
    fi
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    ok "Clonado $REPO_URL"
  fi
}

write_env() {
  step "Archivo .env"
  local ip secret token bridge
  ip="$(detect_ip)"
  cd "$INSTALL_DIR"

  if [[ -f .env ]]; then
    ok ".env ya existe — no se pisa"
    # Actualizar WEB_ORIGIN si sigue en localhost
    if grep -q 'WEB_ORIGIN=http://localhost:3000' .env 2>/dev/null; then
      sed -i "s|WEB_ORIGIN=http://localhost:3000|WEB_ORIGIN=http://${ip}:3000|" .env
      ok "WEB_ORIGIN → http://${ip}:3000"
    fi
    return
  fi

  secret="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | xxd -p | tr -d '\n' | head -c 48)"
  token="accesopro-demo-agent"
  bridge="accesopro-bridge"

  cat > .env << EOF
JWT_SECRET=${secret}
WEB_ORIGIN=http://${ip}:3000

NEXT_PUBLIC_API_URL=

SITE_ENGINE_URL=http://site:5051
SITE_ENGINE_USER=admin
SITE_ENGINE_PASSWORD=admin
ACCESOPRO_BRIDGE_KEY=${bridge}
ENGINE_BRIDGE_POLL_MS=5000

SITE_AGENT_URL=http://agent:8790
SITE_AGENT_TOKEN=${token}

ACCESOPRO_ALLOW_SELF_UPDATE=1
ACCESOPRO_HOST_DIR=${INSTALL_DIR}
ACCESOPRO_REPO=Hugo-Vera/accesopro
ACCESOPRO_BRANCH=master
EOF
  ok "Creado .env (WEB_ORIGIN=http://${ip}:3000)"
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && need_root_for ufw status 2>/dev/null | grep -qi active; then
    step "Firewall UFW: puerto 3000"
    need_root_for ufw allow 3000/tcp >/dev/null || true
    ok "ufw allow 3000/tcp"
  fi
}

compose_up() {
  step "Build + up (profile=${PROFILE})"
  cd "$INSTALL_DIR"

  case "$PROFILE" in
    core)
      compose_cmd up -d --build
      ;;
    dahua)
      if [[ -f deploy/docker-compose.linux.yml ]]; then
        if docker info >/dev/null 2>&1; then
          docker compose -f docker-compose.yml -f deploy/docker-compose.linux.yml --profile dahua up -d --build
        else
          need_root_for docker compose -f docker-compose.yml -f deploy/docker-compose.linux.yml --profile dahua up -d --build
        fi
      else
        compose_cmd --profile dahua up -d --build
      fi
      ;;
    full|alpr)
      if [[ ! -f deploy/site.config.docker.yaml ]]; then
        if [[ -f deploy/site.config.real.example.yaml ]]; then
          cp deploy/site.config.real.example.yaml deploy/site.config.docker.yaml
          warn "Creado deploy/site.config.docker.yaml desde example — editá RTSP/relés"
        fi
      fi
      compose_cmd --profile dahua --profile alpr up -d --build
      ;;
    *)
      die "ACCESOPRO_PROFILE inválido: $PROFILE (core|dahua|full)"
      ;;
  esac
  ok "Contenedores levantados"
}

enable_autostart() {
  step "Arranque automático (systemd)"
  need_root_for systemctl enable --now docker || true
  if [[ -f "$INSTALL_DIR/scripts/enable-autostart.sh" ]]; then
    need_root_for bash "$INSTALL_DIR/scripts/enable-autostart.sh" || warn "No se pudo habilitar systemd (podés correrlo después)"
  else
    warn "Falta enable-autostart.sh"
  fi
}

print_done() {
  local ip
  ip="$(detect_ip)"
  echo ""
  echo -e "${GRN}========================================${NC}"
  echo -e "${GRN}  AccesoPro instalado${NC}"
  echo -e "${GRN}========================================${NC}"
  echo ""
  echo "  Dashboard:  http://${ip}:3000"
  echo "  API:        http://${ip}:8787/health"
  echo "  Agent:      http://${ip}:8790/health"
  echo ""
  echo "  Demo:"
  echo "    admin@lasacacias.local / AccesoPro!2026"
  echo "    guardia@lasacacias.local / AccesoPro!2026"
  echo ""
  echo "  Carpeta:    $INSTALL_DIR"
  echo "  Logs:       cd $INSTALL_DIR && sudo docker compose --profile dahua logs -f"
  echo "  Parar:      cd $INSTALL_DIR && sudo docker compose --profile dahua down"
  echo ""
  echo "  Si 'docker' pide permiso: cerrá sesión y volvé a entrar"
  echo "  (ya estás en el grupo docker)."
  echo ""
}

main() {
  echo -e "${CYN}AccesoPro installer${NC}  profile=${PROFILE}  dir=${INSTALL_DIR}"
  [[ "$(uname -s)" == "Linux" ]] || die "Este script es para Ubuntu/Linux"
  ensure_packages
  ensure_docker
  clone_or_update
  write_env
  open_firewall
  compose_up
  enable_autostart
  print_done
}

main "$@"
