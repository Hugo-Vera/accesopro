FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/site/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/site/ ./
COPY deploy/site.config.docker.yaml ./config.yaml

ENV ACCESOPRO_API_URL=http://api:8787
ENV ACCESOPRO_BRIDGE_KEY=accesopro-bridge
ENV PYTHONUNBUFFERED=1

EXPOSE 5051
VOLUME ["/app/evidencia", "/app/config.yaml"]

CMD ["python", "run.py"]
