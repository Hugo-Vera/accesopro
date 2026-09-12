# Intercom SIP (FreePBX en LAN)

El softphone de AccesoPro **no** corre en la nube. El audio queda en la LAN del barrio (o VPN). Pack `dahua.intercom`.

## Qué hay hoy

- UI AccesoPhone en el home ops: stub «Próximamente» hasta que haya PBX.
- Feature pack `dahua.intercom` + capability `dahua.intercom` (apagado por defecto).

## Qué falta (orden)

1. Instalar **FreePBX / Asterisk en un host LAN** (NUC o VM), no en el Ubuntu AccesoPro de la nube.
2. Extensión SIP del ASI (VTO/ASI con firmware de intercom) + extensión de portería.
3. Si el dashboard necesita WebRTC: gateway SIP↔WSS en esa misma LAN (`wss://pbx-local/...`).
4. Documentar en el `.env` del barrio: `SIP_WSS_URL`, ramal portería. No publicar RTP a internet.

## Puertos típicos (LAN only)

- SIP: 5060 UDP/TCP
- RTP: rango del PBX (ej. 10000–20000 UDP)
- WSS: 8089 o el que configure FreePBX

Cerrar esos puertos en el NAT WAN. El NAT de prueba del ASI (`docs/SITE_RB4011.md`) **no** incluye SIP.

## Criterio de listo

Guardia ve AccesoPhone sin overlay; llamar / contestar / colgar; openDoor sigue el cableado del punto.
