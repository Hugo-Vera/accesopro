# AccesoSeguro — motor de LAN (ALPR + DNI + barreras)

Código traído de https://github.com/Hugo-Vera/Acceso_Seguro
Este proceso **no** es el dashboard AccesoPro. Corre en el predio (puerto 5051).

AccesoPro (Next en :3000) es el producto modular. Este sitio es FastALPR: detecciones, evidencias, QR DNI, relé.

## Arranque

PostgreSQL obligatorio (`fastalpr`).

```powershell
cd C:\Users\Master\AccesoPro\apps\site
copy config.example.yaml config.yaml
# completar USER:PASS de las cámaras solo en config.yaml (no git)
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python run.py
```

Panel: http://127.0.0.1:5051 — `admin` / `admin`

## Importante

`config.yaml` tiene RTSP. No subirlo a git. En el repo de GitHub original quedó una config con claves: **cambiar la clave de las cámaras** y sacar ese archivo del historial.
