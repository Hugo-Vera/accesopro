# Sitio LAN — RB4011 + ASI (snapshot para retomar)

Fecha: **2026-09-10 (noche)**. Equipo: **MikroTik RB4011iGS+**, RouterOS **7.21.1**.  
WebFig LAN: `http://192.168.190.254/webfig/` (también mgmt ZeroTier `192.168.191.87`).  
PC de trabajo: `192.168.190.99`. Gateway: `192.168.190.254`.  
**No es el Ubuntu AccesoPro.** No mezclar con `docs/UPDATE_UBUNTU.md`. No borrar volúmenes Docker.

Safe Mode en WebFig quedó **off** (los cambios persisten). Preferir Terminal de WebFig antes que clics sueltos.

Pendientes de este predio: sección 4 y `docs/PENDING.md` (bloque Sitio RB4011).

---

## 0. Retomar — a mano

Leer esta sección primero. Claves del ASI **no van a git**. Usuario web del lector: `admin`.

### Abrir

| Qué | Dónde |
|---|---|
| WebFig | `http://192.168.190.254/webfig/` |
| Terminal | `http://192.168.190.254/webfig/#Terminal` |
| NAT | `http://192.168.190.254/webfig/#IP:Firewall.NAT` |
| Filter | `http://192.168.190.254/webfig/#IP:Firewall` |
| Graphs | `http://192.168.190.254/graphs/` (solo LAN) |
| ASI LAN | `http://192.168.190.31/` (HTTP 80; no cambiar puertos) |

### Publicado AccesoPro (ether1 Cotelcam, cualquier IP)

Una NAT por servicio. **Sin `src-address`.** Duplicado `1554` → `554` **borrado**. IDs NAT al cierre: 11–14.

| Público | Destino LAN | Comentario NAT | Uso |
|---|---|---|---|
| `200.59.9.117:18080` | `192.168.190.31:80` | `AccesoPro prueba ASI HTTP` | web / CGI |
| `200.59.9.117:18443` | `192.168.190.31:443` | `AccesoPro prueba ASI HTTPS` | HTTPS (apagado en el ASI) |
| `200.59.9.117:27777` | `192.168.190.31:37777` | `AccesoPro prueba ASI SDK` | SDK / SmartPSS / DMSS |
| `200.59.9.117:18554` | `192.168.190.31:554` | `AccesoPro prueba ASI RTSP` | RTSP TCP |

Filter (una sola): `forward accept` TCP `dst-address=192.168.190.31` comment `AccesoPro prueba ASI` — **sin origen**.

Starlink ether2/ether3 = CGNAT: no publicar nada por ahí.

### ASI — dejar los puertos de fábrica

`DHI-ASI6214S-PW` hostname `BSC` LAN `192.168.190.31` (eth2, DHCP, GW `.254`).

| En el lector | Estado | |
|---|---|---|
| HTTP 80 | OPEN | CGI / agent |
| HTTPS 443 | closed | `Https.Enable=false` |
| RTSP 554 | OPEN | `RTSP.Enable=true` |
| SDK 37777 | OPEN | |
| UDP 37778 | closed | |

Si en la web del ASI se pone HTTP=18080 o RTSP=18554, se rompe LAN **y** este NAT (`to-ports` apunta a 80/554/37777).

### Probar (LAN y WAN)

```text
# LAN desde la PC .99
http://192.168.190.31/
rtsp://admin:CLAVE@192.168.190.31:554/cam/realmonitor?channel=1&subtype=1

# WAN (cualquier IP, TCP)
http://200.59.9.117:18080
rtsp://admin:CLAVE@200.59.9.117:18554/cam/realmonitor?channel=1&subtype=1
```

Subtype: **1** extra (DESCRIBE 200 OK). El live del agent prueba **2** (vertical facial) y cae a **1**. Transporte: **TCP** (`rtsp_transport;tcp`). No se publicó RTP UDP 20000-40000.

CGI LAN (Digest): `RTSP.Enable=true` `RTSP.Port=554`. DESCRIBE al 554 LAN = 200. OpenCV en `.99` puede timeout; no significa que el puerto esté cerrado.

### Verificar que no haya duplicados

```text
/ip firewall nat export where comment~"AccesoPro"
/ip firewall nat print where comment~"AccesoPro"
/ip firewall filter print where comment~"AccesoPro"
```

Tiene que haber **4** NAT (18080, 18443, 27777, **solo** 18554) y **1** filter. Si reaparece `dst-port=1554` hacia 554, borrar esa fila (comentario SDK mal puesto). En Terminal de WebFig, `find` largo a veces no entra: borrar desde la tabla NAT.

Export de referencia (cierre 2026-09-10):

```text
/ip firewall nat
add action=dst-nat chain=dstnat comment="AccesoPro prueba ASI HTTP" dst-port=18080 \
    in-interface=ether1 protocol=tcp to-addresses=192.168.190.31 to-ports=80
add action=dst-nat chain=dstnat comment="AccesoPro prueba ASI HTTPS" dst-port=18443 \
    in-interface=ether1 protocol=tcp to-addresses=192.168.190.31 to-ports=443
add action=dst-nat chain=dstnat comment="AccesoPro prueba ASI SDK" dst-port=27777 \
    in-interface=ether1 protocol=tcp to-addresses=192.168.190.31 to-ports=37777
add action=dst-nat chain=dstnat comment="AccesoPro prueba ASI RTSP" dst-port=18554 \
    in-interface=ether1 protocol=tcp to-addresses=192.168.190.31 to-ports=554
```

### AccesoPro en el agent

Host LAN: `192.168.190.31` puerto **80**. Live: el agent tira de RTSP 554 (LAN) o, si corre fuera, de `200.59.9.117:18554`. No guardar la clave en el repo.

---

## 1. Qué quedó hecho

### ASI publicado (prueba AccesoPro)

Detalle y tabla: **sección 0**. Resumen: ether1, sin filtro de origen, una NAT por servicio, RTSP solo `18554` → `554`.

### NAT que ya existía (no tocar salvo pedido)

- Masquerade ether1 Cotelcam, ether2 Starlink1, ether3 Starlink2.
- Hacia Starlink sale **un solo CPE** (IP CGNAT en ether2/ether3). VLANs/PPPoE `10.0.x` no se publican; el TTL extra de un hop de router es normal y **no** es lo que define “reventa”. El ToS de Starlink (Residential vs Priority / no resale) es comercial, no se arregla con mangle.
- **TTL (no aplicado acá; no aporta):** posible uso de *algunos* sitios, si algún día se quiere homogeneizar el hop de salida (traceroute queda mentiroso; no toca probes):

```text
/ip firewall mangle add chain=postrouting action=change-ttl new-ttl=set:64 \
  out-interface=ether2 comment="TTL Starlink1 (opcional; no probes)"
/ip firewall mangle add chain=postrouting action=change-ttl new-ttl=set:64 \
  out-interface=ether3 comment="TTL Starlink2 (opcional; no probes)"
```

  Alternativa: `new-ttl=increment` (p.ej. `:1`). **No** aplicar a destinos de netwatch/check-gateway (`8.8.4.4`, `8.8.8.8`, `1.0.0.1`, `9.9.9.9`, etc.). En este predio se dejó el TTL de fábrica.
- Rapela `192.168.33.72`: `17443` y `3443` → `:443`.
- Rapela-VPN TCP 500 **disabled** (IKE va por UDP).
- Sistema web `192.168.190.121`: `8080` / `5678` + hairpin `192.168.0.0/16`.

### Policy routing (mangle, `passthrough=no`, `dst-address-list=!Redes_Locales`)

| Mark | Quién | Tabla |
|---|---|---|
| `for_cotelcam` | por ahora solo **`192.168.33.72` Rapela** | `To_Cot` |
| `Deptos_PPPoE` | `10.0.1.0/24` `10.0.2.0/24` `10.0.3.0/24` | `To_Sta` (Starlink1) |
| `for_starlink1` | `192.168.32.0/24` `192.168.42.0/24` | `To_Sta` |
| `for_starlink2` | hosts viejos + **`192.168.33.0/24`** + **`10.0.0.0/24` PB** | `To_Sta2` |

El resto (`.190` ASI/portería, `.45` barrera, `.80` teléfonos) usa **main** = Cotelcam.

### Failover recíproco (dual probe + blackhole `/32`)

Probes (no filtrar ICMP a estos destinos):

| WAN | Probes | Gateway |
|---|---|---|
| Cotelcam | `208.67.220.220` + `1.1.1.1` | `200.59.9.118` |
| Starlink1 | `8.8.4.4` + `8.8.8.8` | `100.64.0.1%ether2` |
| Starlink2 | `1.0.0.1` + `9.9.9.9` | `100.64.0.1%ether3` |

Defaults `check-gateway=ping` `target-scope=11`:

- **main / To_Cot**: Cotelcam d=1 → SL1 d=2 → SL2 d=3
- **To_Sta**: SL1 d=1 → Cotelcam d=2 → SL2 d=3
- **To_Sta2**: SL2 d=1 → Cotelcam d=2 → SL1 d=3

Timers globales (2026-09-10, ROS 7.21): `/routing settings`  
`check-gateway-ping-interval=2s` `timeout=1s` `count=2` (~4 s para pasar a Cotelcam; antes ~20 s y los Archer rediscaban PPPoE).  
PPPoE `keepalive-timeout=30` en service1–4 (el Telegram de depto sigue siendo `on-down` del perfil → `webhook-mikrotik.php`).

Se sacó el gateway roto `192.168.190.254` de `To_Cot` (sigue una ruta `Is` inactiva #18). Logging: `/system logging add topics=route prefix=failover`.

### PPPoE / VLAN

Servidores PPPoE en ifaces VLAN: P1=10, P2=20, P3=30, PB=50. Perfiles 5M/20M, MSS, webhook `.121`.  
`service_test` en `bridge_local` **disabled**. `service1` (y service2 one-session): MTU 1492, chap/mschap, one-session-per-host.  
Drop forward bypass: `10.0.x` sourced en iface VLAN (no `pppoe-xxx`).  
`vlan-filtering=yes` en `bridge_local`: VLAN 10/20/30/50 **tagged** `bridge_local,ether6,ether7,ether10` (SW03/SW04/SW_LAN); VLAN 1 untagged ether4–10. Tras el cambio, las 10 sesiones PPPoE volvieron.

### Netwatch / webhooks (anti falso positivo)

Down de un ISP **solo si fallan los dos probes**. 5 pings, 80% pérdida, intervalo 20 s (INET 30 s).

| id panel | Netwatch | Significado |
|---|---|---|
| 1 | NW-SL1-A/B (`8.8.4.4` / `8.8.8.8`) | Starlink1 |
| 2 | NW-SL2-A/B (`1.0.0.1` / `9.9.9.9`) | Starlink2 |
| 3 | NW-Cot-A/B (`208.67.220.220` / `1.1.1.1`, src `200.59.9.117`) | **Cotelcam** (antes lo llamaban “internet general”) |
| 4 | NW-INET `208.67.222.222` **sin pin a WAN** | Hay internet por **algún** WAN |

Webhook GET (el PHP no acepta POST form):

```
http://192.168.190.121:8080/api/wan-status-ajax.php?id=<N>&estado=up|down
```

`id=4` hoy responde `{"success":false,"message":"Enlace no encontrado"}`. El MikroTik ya avisa; falta la fila en Control Mantenimiento. Prompt para esa IA: ver sección 5.

---

## 2. ASI — puertos (leído 2026-09-10; NAT noche)

Equipo: **DHI-ASI6214S-PW**, hostname `BSC`, LAN `192.168.190.31` en **eth2** (DHCP, GW `192.168.190.254`).  
CGI: `Web.Port=80` (enable true). `Https.Enable=false` (`Https.Port=443` de fábrica). `DVRIP.TCPPort=37777` (enable true). UDP 37778 cerrado.

TCP en LAN:

| Puerto | Estado | Notas |
|---|---|---|
| 80 | OPEN | Dejar así. AccesoPro agent y web usan este. |
| 443 | closed | HTTPS apagado. El dst-nat `:18443` no tiene a quién entregar. |
| 554 | OPEN | RTSP.Enable=true. Dejar 554. |
| 37777 | OPEN | Dejar así. SDK. |
| 18080 / 18443 / 27777 / 18554 | closed **en el ASI** | Solo existen en el MikroTik (WAN). |

**No cambiar los puertos de escucha del ASI.** Si se pone HTTP=18080, RTSP=18554 o SDK=27777 en el lector, se rompe LAN y el dst-nat.

Desde afuera (cualquier IP, ether1):

- Web/CGI: `http://200.59.9.117:18080`
- SDK: `200.59.9.117:27777`
- RTSP: `rtsp://200.59.9.117:18554/cam/realmonitor?channel=1&subtype=1` (TCP)
- HTTPS público: no usar hasta habilitar `Https.Enable=true` en el ASI (sigue en **443 interno**; el NAT ya apunta ahí).

---

## 3. Direccionamiento / WANs

| Interfaz | Nombre | IP |
|---|---|---|
| ether1 | Wan-Cotelcam | `200.59.9.117/30`, GW `200.59.9.118` |
| ether2 | Starlink1 | CGNAT `100.69.246.32/10`, GW `100.64.0.1%ether2` |
| ether3 | Starlink2 | CGNAT `100.73.12.217/10`, GW `100.64.0.1%ether3` |

Host remoto de prueba AccesoPro: **`200.26.179.94`**.  
Caja Rapela (dst-nat IP pública): **`192.168.33.72`**.  
Sistema mantenimiento PHP: **`192.168.190.121:8080`** (`/pages/movil/index.php`, monitor WAN `/pages/monitor-wan.php`).

VLAN: 10 Primer piso, 20 Segundo, 30 Tercer, 50 Planta baja. Untagged `.190` / `.32` / `.33` / `.45` / `.80` siguen en el mismo L2 (PVID 1).

---

## 4. Pendiente (siguiente sesión)

Cierre 2026-09-10 noche: NAT ASI HTTP/HTTPS/SDK/RTSP **sin origen**, duplicado `1554` borrado, policy routing, failover 2s, VLAN/PPPoE, netwatch, NTP/backup/graphing, TTL **no** cambiado. Cheatsheet: §0.

1. **PHP Control Mantenimiento:** enlace **id=4** ya se veía en Monitor WAN; debounce PPPoE `webhook-mikrotik.php` down de menos de 60–120 s (opcional). Prompt histórico en §5.
2. **Probar ASI público** (NAT ya está): HTTP `:18080`, SDK `:27777`, RTSP `:18554`. El lector sigue en 80/37777/554.
3. Opcional: encender HTTPS en ASI (443) si se quiere usar `:18443` público. No cambiar el número de puerto.
4. Cerrar mgmt: `www :80` y **WinBox `:8295`** (no 8291) solo LAN/ZeroTier. WAN input drop (dejar IPsec/ICMP). **No habilitar fasttrack** (rompe mark-routing).
5. Más hosts en `for_cotelcam` además de Rapela `.72`.
6. **NTP / backup / graphing** (hecho 2026-09-10 02:08):
   - NTP: `ar.pool.ntp.org` + `0/1/2.ar.pool.ntp.org`, sync OK (stratum 3). Sacamos `time.windows.com`. TZ Buenos Aires.
   - Script `DailyBackup` + scheduler **04:15** diario. Sobrescribe `auto-daily.backup` (binario, restore) y `auto-daily.rsc` (export; sin `show-sensitive`). No copia a `.121` (no hay upload). Files viejos manuales se dejaron.
   - Graphing: ether1/2/3 + resource, `store-on-disk=yes`, solo `192.168.0.0/16`. Ver `http://192.168.190.254/graphs/` desde LAN.
7. `ACCESOPRO_OWNER` / update Ubuntu: otro hilo (`docs/UPDATE_UBUNTU.md`).

---

## 5. Prompt listo — IA del sistema de mantenimiento

Pegar en el repo/chat de Control Mantenimiento (`.121`), no en AccesoPro:

```
Contexto
========
Hay un MikroTik RB4011 (192.168.190.254, RouterOS 7.21.1) que ya manda webhooks de estado WAN al sistema PHP “Control Mantenimiento” en 192.168.190.121:8080.

NO cambies el contrato del webhook. El router ya está en producción con esta URL (GET, query string):

  http://192.168.190.121:8080/api/wan-status-ajax.php?id=<N>&estado=up
  http://192.168.190.121:8080/api/wan-status-ajax.php?id=<N>&estado=down

Pruebas reales desde LAN:
- GET id=4&estado=up  → {"success":false,"message":"Enlace no encontrado"}
- POST application/x-www-form-urlencoded id=1&estado=up → {"success":false,"message":"Parámetros inválidos"}
O sea: el endpoint espera GET + query, y en la DB/UI hoy solo existen enlaces 1, 2 y 3.

Qué hace el MikroTik (no lo toques desde este repo)
===================================================
Tres WAN:
- id=1 Starlink1 (ether2, CGNAT)
- id=2 Starlink2 (ether3, CGNAT)
- id=3 Cotelcam (ether1, IP pública 200.59.9.117)
- id=4 Internet (cualquier WAN) — NUEVO, el PHP todavía no lo tiene

Cada WAN 1/2/3 tiene DOS probes ICMP. El router solo manda estado=down si FALLAN LOS DOS. Si uno vuelve, manda estado=up. Por eso:
- un mismo enlace puede recibir DOS “up” seguidos (probe A y probe B). Tiene que ser idempotente: no abrir un incidente nuevo ni duplicar notificaciones.
- un solo probe caído NO manda down. No pidas “dos downs” del mismo id para marcar caída: el down ya viene filtrado.

id=4 (NW-INET) pinguea 208.67.222.222 SIN pin a un WAN. Up = hay salida a internet por Cotelcam o Starlink1 o Starlink2. Down = no hay ningún camino al mundo. NO es “cayó Cotelcam”. Antes el panel usaba id=3 como “internet general” y daba falsos positivos (Cotelcam down + Starlink up = “no hay internet”).

Tarea
=====
1) Alta del enlace id=4 en la misma tabla/modelo que 1/2/3.
   Nombre sugerido: “Internet (cualquier WAN)”
   Descripción: “Hay salida a internet por al menos un enlace. No es un ISP puntual.”
   Mostrarlo en el dashboard junto a los otros, claramente distinto (agregado, no un 4º ISP).

2) Relabel si hace falta:
   - 1 = Starlink 1
   - 2 = Starlink 2
   - 3 = Cotelcam   (si hoy dice “internet general” o similar, corregirlo)
   - 4 = Internet (cualquier WAN)

3) wan-status-ajax.php:
   - Seguir aceptando GET ?id=&estado=up|down (minúsculas).
   - id=4 debe actualizar estado y devolver success true, mismo JSON que 1/2/3.
   - Si el enlace no existe: seguir con “Enlace no encontrado”.
   - Idempotencia: si ya está up y llega up, 200 success sin ticket/alerta extra. Igual down→down.
   - No exigir sesión/cookie: el MikroTik llama sin login desde 192.168.190.254. Si hay allowlist, incluir esa IP (y 192.168.190.0/24 si ya está).
   - No romper el contrato: no exigir POST, token, ni campos extra. Si más adelante querés token, que sea opcional y el GET actual siga andando.

4) Alertas / tickets:
   - Caída de 1, 2 o 3 = ese ISP específico (el failover cubre; no es “edificio sin internet”).
   - Caída de 4 = sí es “edificio sin internet”. Esa es la alerta grave.
   - Si 3 down y 4 up: Cotelcam caído, internet por Starlink. No disparar “sin internet”.
   - No spam: debounce de notificaciones (mismo id, mismo estado) de al menos 60–120 s.

5) UI
   - Cuatro tarjetas/filas, no hardcodear “solo 3”.
   - Copy en español rioplatense, sin emojis.

Criterio de listo
=================
curl -s "http://127.0.0.1:8080/api/wan-status-ajax.php?id=4&estado=up"
debe devolver success true (no “Enlace no encontrado”).
Repetir el mismo GET no duplica incidentes.
El panel muestra las 4 tarjetas con los nombres de arriba.
```

---

## 6. Anti-errores

- No `docker compose down -v`.
- No `fasttrack` con mark-routing.
- No mezclar ALPR (`profile alpr`) en este hilo.
- No cambiar puertos del ASI para “igualar” 18080/27777/18554.
- No volver a crear NAT `1554` → `554` (duplicado de `18554`).
- No reponer `src-address=200.26.179.94` en estas NAT: el pedido fue origen **cualquiera**.
- No publicar RTP UDP 20000-40000; el live usa RTSP TCP.
- No filtrar ICMP a los probes de netwatch/rutas.
- No `change-ttl` en ether2/ether3 salvo pedido: acá no aporta; si se usa, no sobre probes (ver NAT / TTL).
- Update Ubuntu = otro playbook.
