# Alta de barrios (concentrador + garita)

Paso a paso probado en el dashboard. Dos instalaciones del **mismo** software: un Ubuntu concentrador y un Ubuntu por barrio.

Repo: `https://github.com/Hugo-Vera/accesopro`

## Qué es cada máquina

| | Concentrador | AccesoPro local (garita) |
|---|---|---|
| **Rol** | Directorio de predios. Lista en vivo lo que cada SQLite ya tiene. | El barrio: lotes, vecinos, ASI, portería. |
| **Login** | `admin@accesopro.local` | El admin que definiste en el alta (`marcelo@gmail.com`, etc.) |
| **Instalación** | `install-ubuntu.sh` | `install-ubuntu.sh` en **otro** Ubuntu |
| **`.env`** | **No** pongas `ACCESOPRO_HUB_TOKEN` | **Sí:** el token del modal Barrios |
| **URL** | `http://IP-concentrador:3000` o `https://IP:3443` | `http://IP-garita:3000` |

La base de un barrio **no** se crea en el concentrador. El concentrador solo guarda nombre, plan, URLs y token, y consulta `GET /api/hub/snapshot` en la garita.

El concentrador tiene que **alcanzar** la garita (LAN o URL pública). La garita no necesita hablar hacia el concentrador.

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

Botón **Nuevo barrio**. Completá **todos** los datos operativos:

| Campo | Qué poner | Ejemplo de la prueba |
|-------|-----------|----------------------|
| Nombre del barrio | Nombre comercial | Los Alamos |
| Plan contratado | Esencial / Acceso Pro / Seguridad total | Acceso Pro |
| Nombre del administrador | Quien va a administrar **ese** Ubuntu | Marcelo |
| Email | Login del admin del predio | marcelo@gmail.com |
| Clave inicial | Mínimo 8 caracteres. El vecino de plataforma no entra con esta clave. | (la que elijas) |
| URL LAN del Ubuntu de la garita | `http://IP:3000` de **esa** máquina, no del concentrador | `http://192.168.190.114:3000` |
| URL pública | Opcional. NAT / ZeroTier si la LAN no responde desde el concentrador. | vacío si hay LAN |

Sin URL LAN ni pública el alta no arranca: hace falta al menos una.

**Crear.**

## 3. Modal «Barrio registrado» (copiar ya)

El token **no vuelve a mostrarse**. Copiá:

- Admin (email)
- Clave
- `ACCESOPRO_HUB_TOKEN`

Si el Ubuntu de la garita todavía no responde, el recuadro ámbar es normal:

> Predio aún no alcanzó: fetch failed. En el Ubuntu: ACCESOPRO_HUB_TOKEN y después Verificar.

La fila queda **Pendiente** o **Sin enlace**. Eso no borra el alta: el directorio ya está.

En la prueba del 20/09/2026 el concentrador (`192.168.190.146`) registró Los Alamos apuntando a `http://192.168.190.114:3000`. El bootstrap falló con `fetch failed` porque esa IP no contestaba. **Si el predio es este mismo Ubuntu, la URL LAN es `http://192.168.190.146:3000`** (no 114). El API, desde Docker, consulta el servicio `web` de este compose.

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
```

Eso **evita** sembrar Las Acacias. En el concentrador **no** pongas esa variable.

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
