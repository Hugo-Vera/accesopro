# AccesoPro Site Agent

Proceso en la LAN del barrio: CGI Dahua (Digest), relé / openDoor, FastALPR sobre RTSP.

```powershell
cd C:\Users\Master\AccesoPro\apps\agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ACCESOPRO_API_URL="http://localhost:8787"
$env:SITE_AGENT_TOKEN="accesopro-demo-agent"
uvicorn app.main:app --reload --port 8790
```

Health: http://localhost:8790/health

RTSP típico Dahua:

`rtsp://admin:CLAVE@192.168.33.200:554/cam/realmonitor?channel=1&subtype=0`

El token demo coincide con el sitio “Acceso principal” de Las Acacias.
