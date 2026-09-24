# AccesoPro Guardia (Android)

App de turno y, con el mismo paquete, portal del lote. Misma API que el dashboard.

1. Abrir esta carpeta en Android Studio.
2. Guardia: `guardia@lasacacias.local` / clave del barrio. URL LAN: `http://IP:8787`. URL pública: DNS del concentrador si hay 4G.
3. Titular o familiar: el email invitado. La app muestra avisos del lote (autorizar / denegar walk-in; QR preautorizado es informativo) y SOS. No bumpear `versionCode` ni subir Play hasta pedido.
4. Cámara: permiso declarado. ML Kit lee QR de visita y DNI (PDF417 / QR). La foto de ART, seguro o licencia se manda a `POST /api/visitors/document-scan` (recorte en el server). Pistola DNI USB HID: escribe en el campo DNI.

El QR de visita **no abre** el portón. Se puede leer en el ASI o en la app (ícono de la cola o «Escanear QR de visita» si está vacía): misma ficha, mismo `holdVisitQr`. Copy: «QR presentado · espera aprobación». El dashboard web pinta la misma tarjeta ámbar y, al aprobar, la misma fila se pone verde con la hora. Sin deviceId el relé usa el cableado del carril. No hay una segunda tarjeta «Apertura remota».

Al escanear un QR preautorizado, el lote (titular y familiares adultos con cuenta) recibe un aviso `visit_qr` por FCM o poll: llegó a portería; portería abre. Sin botones Autorizar/Denegar. El walk-in de 120 s sigue pidiendo autorización. Un documento vencido no pasa (sin excepción del titular): si es el seguro o la licencia, la ficha ofrece **Pasar a peatonal**; si es la ART, solo Denegar.

Ficha en la app (igual que la web, regla en `FichaParts.kt` `docRequirements`): Identidad → **Tipo de ingreso** (tipo de visita + cómo llega) → Vehículo (patente, seguro con foto, licencia con vencimiento y foto, baúl con descripción y fotos) → ART (servicio: ART o seguro de vida; contratista: ART) → Resumen. Tarjetas «En archivo · Usar» reutilizan documentos ya cargados. Al leer un DNI sin pase, después del lote se elige el tipo de ingreso. Salida: solo baúl (galería del ingreso al lado de la revisión de salida), bienes y menores. Fotos a resolución completa (FileProvider). Cara del invitado: no se enrola.

Barra inferior (guardia): **Cola**, **Censo** y **SOS**. Titular/familiar: **Avisos** y **SOS**. Tema claro/oscuro alineado al dashboard (slate / sky / ámbar).

FCM nativo: tras el login la app llama `POST /api/push/register` si hay token en prefs (`fcmToken`). Cuando exista `google-services.json` del proyecto Firebase AccesoPro, guardar el token de FCM en esa clave. Mientras tanto el aviso llega por poll contra el DNS público.
