#!/bin/sh
set -e
mkdir -p /certs
apk add --no-cache openssl >/dev/null 2>&1 || true

need_new=0
if [ ! -f /certs/cert.pem ] || [ ! -f /certs/key.pem ]; then
  need_new=1
elif [ "${ACCESOPRO_TLS_RENEW:-}" = "1" ]; then
  need_new=1
elif ! openssl x509 -in /certs/cert.pem -checkend 2592000 -noout 2>/dev/null; then
  # Vencido o vence en menos de 30 días
  need_new=1
fi

if [ "$need_new" = "1" ]; then
  IP="${ACCESOPRO_TLS_IP:-}"
  SAN="DNS:localhost,DNS:accesopro.local,IP:127.0.0.1"
  if [ -n "$IP" ]; then
    SAN="${SAN},IP:${IP}"
  fi
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout /certs/key.pem -out /certs/cert.pem \
    -subj "/CN=AccesoPro" \
    -addext "subjectAltName=${SAN}"
  echo "AccesoPro TLS: certificado nuevo (10 años). Aceptá de nuevo el aviso del navegador."
fi

exec nginx -g "daemon off;"
