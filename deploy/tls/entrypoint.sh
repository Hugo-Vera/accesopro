#!/bin/sh
set -e
mkdir -p /certs
if [ ! -f /certs/cert.pem ] || [ ! -f /certs/key.pem ]; then
  apk add --no-cache openssl >/dev/null
  IP="${ACCESOPRO_TLS_IP:-}"
  SAN="DNS:localhost,DNS:accesopro.local,IP:127.0.0.1"
  if [ -n "$IP" ]; then
    SAN="${SAN},IP:${IP}"
  fi
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout /certs/key.pem -out /certs/cert.pem \
    -subj "/CN=AccesoPro" \
    -addext "subjectAltName=${SAN}"
fi
exec nginx -g "daemon off;"
