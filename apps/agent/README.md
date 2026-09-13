# AccesoPro Site Agent

Proceso en la LAN del barrio: CGI Dahua (Digest) para eventos/abrir/personas, RTSP extra 1 para live. No mezclar `snapshot.cgi` con RTSP en un ASI.

Tabla comando ↔ manual: `docs/ASI_CGI.md`.

```powershell
cd C:\Users\Master\AccesoPro\apps\agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ACCESOPRO_API_URL="http://localhost:8787"
$env:SITE_AGENT_TOKEN="accesopro-demo-agent"
uvicorn app.main:app --reload --port 8790
```

Health: http://localhost:8790/health (`readers` = attach, RecNo, clientes RTSP).

RTSP del ASI (PDF Access Control, extra 1):

`rtsp://admin:CLAVE@192.168.190.31:554/cam/realmonitor?channel=1&subtype=1`

`subtype=0` es el principal: no usarlo para AccesoCam.

El token demo coincide con el sitio “Acceso principal” de Las Acacias.
