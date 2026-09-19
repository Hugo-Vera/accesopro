# AccesoPro Guardia (Android)

App de turno para aprobar entrada/salida de visitas. Misma API que el dashboard.

1. Abrir esta carpeta en Android Studio.
2. Login: `guardia@lasacacias.local` / clave del barrio.
3. URL LAN: `http://IP:8787` (timeout 2 s). URL pública opcional si la LAN no responde.
4. Pistola DNI USB HID: escribe en el campo DNI. Cámara: permiso declarado; la foto de bien no registrado se carga desde el dashboard.

El QR de visita **no abre** el portón: al apoyarlo en el ASI la app suena, vibra y abre la ficha. El dashboard web solo muestra la campana; no tiene que tapar el plano.

Botones **Censo** (vidas en predio) y **SOS**.
