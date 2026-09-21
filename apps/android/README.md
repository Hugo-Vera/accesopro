# AccesoPro Guardia (Android)

App de turno y, con el mismo paquete, portal del lote. Misma API que el dashboard.

1. Abrir esta carpeta en Android Studio.
2. Guardia: `guardia@lasacacias.local` / clave del barrio. URL LAN: `http://IP:8787`. URL pública: DNS del concentrador si hay 4G.
3. Titular o familiar: el email invitado. La app muestra avisos del lote (autorizar / denegar) y SOS. No bumpear `versionCode` ni subir Play hasta pedido.
4. Pistola DNI USB HID: escribe en el campo DNI. Cámara: permiso declarado; la foto de bien no registrado se carga desde el dashboard.

El QR de visita **no abre** el portón: al apoyarlo en el ASI la app suena, vibra y abre la ficha. El dashboard web solo muestra la campana; no tiene que tapar el plano.

Barra inferior (guardia): **Cola**, **Censo** y **SOS**. Titular/familiar: **Avisos** y **SOS**. Tema claro/oscuro alineado al dashboard (slate / sky / ámbar).

FCM nativo: registrar el token con `POST /api/push/register` cuando haya `google-services.json` del proyecto Firebase AccesoPro. Mientras tanto el aviso llega por poll contra el DNS público.
