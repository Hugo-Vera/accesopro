# AccesoPro + XAMPP (sin Docker)

AccesoPro **no es PHP**: API (Node) + dashboard (Next) + agent (Python).
XAMPP aporta **Apache** como puerta de entrada en el puerto **3080**.

```
Browser → Apache :3080 → Next :3000 → (rewrites) API :8787 → Agent :8790
```

## Arranque

1. Abrí **XAMPP Control Panel** y dale **Start** a Apache (MySQL no hace falta para AccesoPro core).
2. En PowerShell:

```powershell
cd C:\Users\Master\AccesoPro
powershell -ExecutionPolicy Bypass -File scripts\start-xampp.ps1 -Profile dahua
```

3. Entrá a: **http://localhost:3080**

El script:

- Copia `deploy/xampp/accesopro.conf` → `C:\xampp\apache\conf\extra\`
- Habilita `mod_proxy_http` si estaba comentado
- Agrega el `Include` en `httpd.conf` (con backup `.accesopro.bak`)
- Levanta API + Web (+ Agent Dahua)

Producción nativa (más lento el primer build):

```powershell
powershell -File scripts\start-xampp.ps1 -Profile dahua -Prod
```

XAMPP en otra unidad:

```powershell
powershell -File scripts\start-xampp.ps1 -XamppRoot "D:\xampp"
```

## Después de la 1ª vez

Si Apache ya corría, **Stop + Start** en el Control Panel para cargar el vhost :3080.

## Qué no usa AccesoPro de XAMPP

| XAMPP | ¿Lo usamos? |
|-------|-------------|
| Apache | Sí (proxy :3080) |
| MySQL | No (API = SQLite; ALPR = Postgres cuando toque) |
| PHP / phpMyAdmin | No |

## Pasar a Docker más adelante

```powershell
powershell -File scripts\stop-server.ps1   # si había algo Docker
# cerrá las ventanas de api/web/agent
powershell -File scripts\start-server.ps1 -Profile dahua
```

Ver también: [`DOCKER.md`](DOCKER.md).
