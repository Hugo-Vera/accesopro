# AccesoPro Guardia (Android)

App de turno y, con el mismo paquete, portal del lote. Misma API que el dashboard.

1. Abrir esta carpeta en Android Studio.
2. Guardia: `guardia@lasacacias.local` / clave del barrio. URL LAN: `http://IP:8787`. URL pública: DNS del concentrador si hay 4G.
3. Titular o familiar: el email invitado. La app muestra avisos del lote (autorizar / denegar walk-in; QR preautorizado es informativo; excepción por documento vencido sí pide Autorizar/Denegar) y SOS. No bumpear `versionCode` ni subir Play hasta pedido.
4. Cámara: permiso declarado. ML Kit lee QR de visita y DNI (PDF417 / QR). La foto de ART, seguro o licencia se manda a `POST /api/visitors/document-scan` (recorte en el server). Pistola DNI USB HID: escribe en el campo DNI.

El QR de visita **no abre** el portón. Se puede leer en el ASI o en la app (ícono de la cola o «Escanear QR de visita» si está vacía): misma ficha, mismo `holdVisitQr`. Copy: «QR presentado · espera aprobación». El dashboard web pinta la misma tarjeta ámbar y, al aprobar, la misma fila se pone verde con la hora. Sin deviceId el relé usa el cableado del carril. No hay una segunda tarjeta «Apertura remota».

Al escanear un QR preautorizado, el lote (titular y familiares adultos con cuenta) recibe un aviso `visit_qr` por FCM o poll: llegó a portería; portería abre. Sin botones Autorizar/Denegar. El walk-in de 120 s sigue pidiendo autorización. Si el seguro o la licencia están vencidos, portería pide excepción (`expired_docs`, ~4 h) y ahí sí hay Autorizar/Denegar.

Ficha en la app (igual que la web): DNI obligatorio; vehículo = patente + seguro vigente + baúl (licencia opcional, no vencida); contratista = ART o seguro de vida con vencimiento. Guardar ficha antes de Aprobar. Cara del invitado: no se enrola.

Barra inferior (guardia): **Cola**, **Censo** y **SOS**. Titular/familiar: **Avisos** y **SOS**. Tema claro/oscuro alineado al dashboard (slate / sky / ámbar).

FCM nativo: tras el login la app llama `POST /api/push/register` si hay token en prefs (`fcmToken`). Cuando exista `google-services.json` del proyecto Firebase AccesoPro, guardar el token de FCM en esa clave. Mientras tanto el aviso llega por poll contra el DNS público.
