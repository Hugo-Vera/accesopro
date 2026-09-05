import sys
from app.main import _ensure_dahua_config, _config, _client

_ensure_dahua_config()
devs = [d for d in _config.get("dahua", []) if d.get("deviceType") != "camera_ip"]
if not devs:
    print("No dahua device found")
    sys.exit(0)

dev = devs[0]
client = _client(dev)
print(f"Testing stream_events on {dev.get('name')} ({dev.get('host')})...")
try:
    for event in client.stream_events():
        print("EVENT RECEIVED FROM DAHUA STREAM:", event)
        break
except Exception as e:
    print("Stream error:", e)
