import os

# Forzar transporte TCP para todas las conexiones de VideoCapture (FFmpeg backend) en el proceso
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

import uvicorn

if __name__ == "__main__":
    uvicorn.run("acceso_seguro.main:app", host="0.0.0.0", port=5051, reload=False)
