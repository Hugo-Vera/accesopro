# Alta de barrios (concentrador + garita)

**Manual de prueba (web + imprimir):** dashboard **Sistema → Manual** (`/dashboard/manual`). Capturas: `apps/web/public/manual/`.

Paso a paso técnico. Dos instalaciones del **mismo** software: un Ubuntu concentrador y un Ubuntu por barrio.

Repo: `https://github.com/Hugo-Vera/accesopro`

## Qué es cada máquina

| | Concentrador | AccesoPro local (garita) |
|---|---|---|
| **Rol** | Directorio + tenant sombra (precarga, portal WAN, replica). | El barrio: portería LAN, ASI, copia del padrón. |
| **Login** | `admin@accesopro.local` | El admin que definiste en el alta (`marcelo@gmail.com`, etc.) |
| **Instalación** | `install-ubuntu.sh` | `install-ubuntu.sh` en **otro** Ubuntu |
| **`.env`** | **No** pongas `ACCESOPRO_HUB_TOKEN`. Sí: `WEB_ORIGIN=https://dns` | **Sí:** `ACCESOPRO_HUB_TOKEN` + `ACCESOPRO_HUB_URL=https://dns` |
| **URL** | `https://dns` (443) o `http://IP-concentrador:3000` | `http://IP-garita:3000` (LAN). El titular **no** usa esta IP. |

La precarga de lotes y dueños vive en el **tenant sombra** del concentrador. La garita, cuando está viva, empuja replica y baja avisos/autorizaciones. Si la máquina se pierde, un Ubuntu nuevo con el mismo token **restaura** padrón, topología, historial (retención) y fotos.

El vecino (4G) entra a `https://dns/portal` y `/activar?token=`. Chrome pide el token FCM solo en HTTPS real (`:3443` de cámara DNI no sirve para push).

## DNS y TLS (concentrador)

1. Registro A del DNS a la IP pública del concentrador.
2. Puerto **443** con certificado de verdad (Let's Encrypt). `:3443` sigue para cámara DNI en LAN.
3. En `.env` del concentrador: `WEB_ORIGIN=https://ese-dns` (y CORS). Router: 443 → concentrador.
4. La garita solo necesita **salida HTTPS** a ese DNS (NAT-friendly: el hub no entra a la LAN de la garita).
5. Firebase (proyecto AccesoPro, aparte): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` en el host (no commitear). Web: `NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_VAPID_KEY`. WhatsApp de respaldo: opcional `WHATSAPP_NOTIFY_URL`.

## 0. Actualizar código en cada Ubuntu

Tras un push a `master`:

1. Entrá al dashboard de **esa** máquina.
2. **Configuración → Módulos** → **Verificar** → **Actualizar servidor**.

O en consola, como `hugo` (no `sudo su`):

```bash
sudo chown -R hugo:hugo /opt/accesopro
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash
```

Hace falta en **las dos**: el concentrador (pantalla Barrios) y la garita (snapshot / bootstrap).

## 1. Concentrador — login de plataforma

1. Abrí el dashboard del concentrador: `http://IP:3000` (HTTPS `:3443` para cámara DNI).
2. Salí si estabas como guardia o admin de barrio.
3. Entrá con `admin@accesopro.local` / la clave de plataforma (demo: `AccesoPro!2026`).
4. Menú **Sistema → Barrios**.

Si ves «No tenés permiso para esta sección», esa sesión no es de plataforma.

## 2. Nuevo barrio (modal)

Botón **Nuevo barrio**. Completá nombre, plan y admin. La **URL de la garita es opcional**: sin URL igual se crea el barrio sombra para precargar lotes e invitar dueños.

| Campo | Qué poner | Ejemplo de la prueba |
|-------|-----------|----------------------|
| Nombre del barrio | Nombre comercial | Los Alamos |
| Plan contratado | Esencial / Acceso Pro / Seguridad total | Acceso Pro |
| Nombre del administrador | Quien va a administrar **ese** Ubuntu | Marcelo |
| Email | Login del admin del predio | marcelo@gmail.com |
| Clave inicial | Mínimo 8 caracteres. El vecino de plataforma no entra con esta clave. | (la que elijas) |
| URL LAN del Ubuntu de la garita | Opcional. `http://IP:3000` de **esa** máquina cuando exista | `http://192.168.190.114:3000` |
| URL pública | Opcional. NAT / ZeroTier | vacío |

**Crear.** En la fila: **Lotes** abre Personas → Lotes del tenant sombra. **Replica** muestra la última subida / restore.

## 3. Modal «Barrio registrado» (copiar ya)

El token **no vuelve a mostrarse**. Copiá:

- Admin (email)
- Clave
- `ACCESOPRO_HUB_TOKEN`

Si el Ubuntu de la garita todavía no responde, el recuadro ámbar es normal:

> Predio aún no alcanzó: fetch failed. En el Ubuntu: ACCESOPRO_HUB_TOKEN y después Verificar.

La fila queda **Pendiente** o **Sin enlace**. Eso no borra el alta: el directorio ya está.

En la prueba del 20/09/2026 el concentrador (`192.168.190.146`) registró Los Alamos apuntando a `http://192.168.190.114:3000`. El bootstrap falló con `fetch failed` porque esa IP no contestaba.

**Si el predio es este mismo Ubuntu**, URL LAN = `http://192.168.190.146:3000` (no 114). Eso crea un tenant **nuevo** al lado de Las Acacias (otro admin, otros lotes). El combo de barrio del dashboard lista los dos; los padrones no se mezclan.

## Certificado HTTPS vencido (`:3443`)

El dashboard HTTPS usa un cert propio en el volumen Docker `web_tls_certs`. Si el navegador dice que la fecha expiró:

1. Actualizá el servidor (el entrypoint de `web-tls` regenera el cert si está vencido o vence en menos de 30 días).
2. Aceptá de nuevo el aviso del navegador (es un certificado nuevo).

A mano, en el Ubuntu:

```bash
cd /opt/accesopro
docker compose up -d --force-recreate web-tls
```

## 4. Garita — instalar AccesoPro y pegar el token

En el Ubuntu **nuevo** del barrio (primera vez):

```bash
curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/install-ubuntu.sh | bash
```

Antes del primer arranque, o en `/opt/accesopro/.env` **de la garita**:

```bash
ACCESOPRO_HUB_TOKEN=el-token-del-modal
ACCESOPRO_HUB_URL=https://dns-del-concentrador
```

Eso **evita** sembrar Las Acacias y, si el tenant sombra ya tiene replica, **restaura** padrón y topología. En el concentrador **no** pongas `ACCESOPRO_HUB_TOKEN`.

Reiniciá el stack de la garita (botón Actualizar servidor, o `docker compose up -d` en `/opt/accesopro`).

Si la garita **ya** tenía AccesoPro y datos (no está vacía), el bootstrap no pisa la SQLite: solo engancha el token. Igual hace falta el mismo `ACCESOPRO_HUB_TOKEN` en su `.env` y un restart.

## 5. Volver al concentrador — Verificar

En **Sistema → Barrios**, icono de consultar / **Verificar** en esa fila.

| Estado | Significado |
|--------|-------------|
| En línea | El concentrador leyó el snapshot (lotes, propietarios, familia, visitas, eventos). |
| Sin enlace | No llega a esa URL. Se muestra el último snapshot (hora) si hubo uno. |
| Pendiente | Nunca pudo bootstrap. Revisá IP, `:3000` vs `:8787`, firewall, `.env` del predio. |

**Abrir predio** abre la URL de la garita. El trabajo diario (plano, invitaciones, portería) es **allá**.

Login en la garita: el email y la clave del paso 2 (ej. `marcelo@gmail.com`). No uses `admin@accesopro.local` para operar el barrio.

## 6. Poblar el barrio (en la garita, no en el concentrador)

Con el admin del predio:

1. **Personas → Lotes**: alta de parcela.
2. Invitar propietario (WhatsApp obligatorio). Sale el enlace `/activar?token=`.
3. El vecino arma la clave en `/activar`.
4. Portal `/portal`: ficha, familia, pases. El **lote no se cambia** (campo bloqueado; la API ignora `lote` / `propertyId`).

El concentrador no invita vecinos. A los ~10 s la tabla Barrios refleja los conteos de **esa** SQLite.

## Anti-errores

| Qué pasó | Causa | Qué hacer |
|----------|--------|-----------|
| Crear sin URL | Falta LAN o pública | Completá `http://IP-garita:3000` |
| `fetch failed` / Sin enlace | El contenedor del concentrador no llega a esa IP | Ping/curl desde el Ubuntu concentrador; probá `:3000` o `:8787`; URL pública/NAT |
| HTTPS `:3443` como URL LAN | Certificado autofirmado: `fetch` del API suele fallar | Usá `http://IP:3000` en el campo URL |
| `fetch failed` a `.114` | Esa máquina no existe o está apagada | Si el predio es este Ubuntu, URL = `http://ESTA-IP:3000` (ej. `.146`) |
| Barrios dice «sin permiso» | Login de guardia o admin de barrio | Salir; entrar `admin@accesopro.local` |
| La garita nació con Las Acacias | No había `ACCESOPRO_HUB_TOKEN` al primer arranque | En predio **nuevo** seteala **antes** de levantar la API |
| Concentrador sin `admin@accesopro.local` | Le pusieron `ACCESOPRO_HUB_TOKEN` al concentrador | Sacala del `.env` del concentrador |
| Abrir predio va al concentrador | URL LAN = IP de esta misma máquina | La URL tiene que ser la de **otro** Ubuntu |

## Variables

| Variable | Dónde | Efecto |
|----------|--------|--------|
| `ACCESOPRO_HUB_TOKEN` | Solo `.env` de la **garita** | Saltea seed demo; autentica snapshot/bootstrap |
| `ACCESOPRO_TENANT_NAME` | Garita, alternativa | También saltea Las Acacias |
| `SITE_AGENT_TOKEN` | Garita | Agent Dahua (distinto del token de hub) |

Detalle de tablas: `docs/DATABASE.md`. Código: `apps/api/src/hub.ts`.
