/** Archivo vivo del manual de prueba (web + impresión). Agregar capítulos acá. */

export type ManualBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "figure"; src: string; alt: string; caption?: string }
  | { type: "note"; text: string };

export type ManualSection = {
  id: string;
  title: string;
  blocks: ManualBlock[];
};

export type ManualChapter = {
  id: string;
  title: string;
  updated: string;
  summary: string;
  sections: ManualSection[];
};

export const MANUAL_CHAPTERS: ManualChapter[] = [
  {
    id: "alta-barrios",
    title: "Alta de un barrio (concentrador)",
    updated: "20/09/2026",
    summary:
      "Barrio nuevo en la misma IP (.146) en paralelo a Las Acacias. Capturas del Ubuntu de prueba.",
    sections: [
      {
        id: "que-se-logra",
        title: "Qué se logra",
        blocks: [
          {
            type: "p",
            text: "El dueño de plataforma (admin@accesopro.local) da de alta el barrio. En este Ubuntu queda un tenant nuevo (otro admin, otros lotes, otro plano). Las Acacias no se pisa.",
          },
          {
            type: "p",
            text: "Si el predio es otro Ubuntu, la URL LAN es la de esa máquina y el token va en su .env. Detalle técnico: docs/HUB_BARRIOS.md.",
          },
          {
            type: "table",
            headers: ["Barrio", "Cómo se abre"],
            rows: [
              ["Las Acacias", "admin@lasacacias.local (sigue igual)"],
              ["Los Alamos", "fila En línea; admin marcelo@gmail.com"],
              ["Los Ceibos", "admin carla@losceibos.local (se abrió de punta a punta)"],
            ],
          },
        ],
      },
      {
        id: "login-plataforma",
        title: "1. Login de plataforma",
        blocks: [
          {
            type: "p",
            text: "Salí de cualquier sesión de guardia o admin de barrio. Abrí http://IP:3000 (HTTPS :3443 solo para cámara DNI).",
          },
          {
            type: "figure",
            src: "/manual/barrios/01-login.png",
            alt: "Pantalla de ingreso AccesoPro",
            caption: "Login AccesoPro",
          },
          {
            type: "p",
            text: "Entrá con la cuenta de plataforma, no con la de Las Acacias.",
          },
          {
            type: "table",
            headers: ["Campo", "Valor de esta prueba"],
            rows: [
              ["Email", "admin@accesopro.local"],
              ["Contraseña", "la de plataforma (demo: AccesoPro!2026)"],
            ],
          },
          {
            type: "figure",
            src: "/manual/barrios/02-login-plataforma.png",
            alt: "Login con email de plataforma",
            caption: "Cuenta de plataforma",
          },
          {
            type: "p",
            text: "Ingresar. Menú Sistema → Barrios. Si dice «No tenés permiso para esta sección», esa sesión no es de plataforma.",
          },
        ],
      },
      {
        id: "directorio",
        title: "2. Directorio de barrios",
        blocks: [
          {
            type: "p",
            text: "La tabla consulta en vivo lo que cada predio tiene cargado. El combo Barrio del encabezado lista todos los tenants de este Ubuntu.",
          },
          {
            type: "figure",
            src: "/manual/barrios/03-barrios-directorio.png",
            alt: "Tabla Barrios con Los Alamos y Los Ceibos en línea",
            caption: "Sistema → Barrios. En Acciones: consultar, editar, borrar del directorio, Abrir predio.",
          },
          {
            type: "table",
            headers: ["Estado", "Significado"],
            rows: [
              ["En línea", "Snapshot leído (lotes, propietarios, familia, visitas, eventos)"],
              ["Pendiente", "Todavía no hubo bootstrap"],
              ["Sin enlace", "No llega a esa URL"],
            ],
          },
          {
            type: "note",
            text: "En la captura hay dos filas Los Ceibos: una En línea (la válida) y una Pendiente. La pendiente se saca con Borrar del directorio. No uses esa fila para operar.",
          },
        ],
      },
      {
        id: "nuevo",
        title: "3. Nuevo barrio",
        blocks: [
          {
            type: "p",
            text: "Botón Nuevo barrio. Completá todos los campos operativos. Hace falta al menos URL LAN o pública.",
          },
          {
            type: "figure",
            src: "/manual/barrios/04-nuevo-barrio-modal.png",
            alt: "Modal Nuevo barrio con URL de este Ubuntu",
            caption: "URL LAN = http://192.168.190.146:3000 si el predio es esta misma máquina.",
          },
          {
            type: "table",
            headers: ["Campo", "Qué poner en este Ubuntu (paralelo a Las Acacias)"],
            rows: [
              ["Nombre del barrio", "Nombre comercial (ej. Los Alamos)"],
              ["Plan contratado", "Esencial / Acceso Pro / Seguridad total"],
              ["Nombre del administrador", "Quien va a administrar ese predio"],
              ["Email", "Login del admin del predio (único en este Ubuntu)"],
              ["Clave inicial", "Mínimo 8 caracteres. Copiala: se muestra una sola vez"],
              ["URL LAN", "http://192.168.190.146:3000 si el predio es esta máquina"],
              ["URL pública", "Vacío si hay LAN"],
            ],
          },
          {
            type: "p",
            text: "Si el barrio vive en otro Ubuntu, la URL LAN es http://IP-de-esa-garita:3000. No uses :3443 (certificado autofirmado: el API suele fallar al consultar).",
          },
          {
            type: "p",
            text: "Crear. Sale Barrio registrado: copiá ya Admin, Clave y ACCESOPRO_HUB_TOKEN. Si el predio es este mismo Ubuntu, el bootstrap es local: la fila pasa a En línea con 0 lotes.",
          },
        ],
      },
      {
        id: "editar",
        title: "4. Editar (URL de esta IP)",
        blocks: [
          {
            type: "p",
            text: "Si el alta apuntó a una IP que no existe (ej. .114), Editar y poné la IP de esta máquina. Guardar vuelve a intentar el bootstrap. La SQLite del predio no se pisa.",
          },
          {
            type: "figure",
            src: "/manual/barrios/05-editar-barrio.png",
            alt: "Modal Editar barrio con URL .146",
            caption: "Editar Los Alamos. Clave nueva es opcional.",
          },
          {
            type: "note",
            text: "Clave nueva hoy actualiza el directorio. Si el admin del predio no entra, usá la clave del modal Barrio registrado o creá el barrio con un email nuevo.",
          },
        ],
      },
      {
        id: "abrir",
        title: "5. Abrir el predio nuevo",
        blocks: [
          {
            type: "ul",
            items: [
              "Como plataforma: combo Barrio → el tenant nuevo. El encabezado cambia (nombre, Dahua, conteos).",
              "Como admin del predio: Salir y entrar con el email del alta.",
            ],
          },
          {
            type: "p",
            text: "La primera vez el admin del predio cae en Activar cuenta (clave definitiva, repetida).",
          },
          {
            type: "figure",
            src: "/manual/barrios/08-login-admin-predio.png",
            alt: "Login del admin del predio Los Ceibos",
            caption: "Login carla@losceibos.local",
          },
          {
            type: "figure",
            src: "/manual/barrios/09-activar-cuenta.png",
            alt: "Pantalla Activar cuenta",
            caption: "Activar cuenta: clave nueva y repetir.",
          },
          {
            type: "p",
            text: "En la prueba se abrió Los Ceibos. Portería vacía: sin lectores, sin relés, Dahua off, 0 chapas. El usuario se llama Carla (no hay combo de barrio: no es plataforma).",
          },
          {
            type: "figure",
            src: "/manual/barrios/10-admin-predio-abierto.png",
            alt: "Portería vacía de Los Ceibos como Carla",
            caption: "COND. LOS CEIBOS. El mapa OSM de ciudad aparece porque todavía no hay vista de predio guardada.",
          },
        ],
      },
      {
        id: "las-acacias",
        title: "6. Comprobar que Las Acacias sigue",
        blocks: [
          {
            type: "p",
            text: "Como plataforma, combo Barrio Las Acacias. El plano y Dahua del predio viejo siguen. Login de Las Acacias (no se tocó): admin@lasacacias.local.",
          },
          {
            type: "figure",
            src: "/manual/barrios/07-plano-las-acacias.png",
            alt: "Plano de Las Acacias con lotes",
            caption: "Plano de Las Acacias intacto (Dahua ok).",
          },
          {
            type: "p",
            text: "En portería, el barrio nuevo se ve vacío (sin mezclar eventos de Las Acacias).",
          },
          {
            type: "figure",
            src: "/manual/barrios/06-porteria-barrio-nuevo.png",
            alt: "Portería vacía del tenant nuevo como plataforma",
            caption: "COND. LOS CEIBOS como plataforma: OFFLINE, sin lectores ni relés.",
          },
        ],
      },
      {
        id: "poblar",
        title: "7. Poblar el barrio nuevo",
        blocks: [
          {
            type: "p",
            text: "Con el admin del predio (no con plataforma):",
          },
          {
            type: "ul",
            items: [
              "Personas → Lotes: alta de parcela.",
              "Invitar propietario (WhatsApp obligatorio). Sale /activar?token=.",
              "El vecino define la clave y entra al portal /portal. El lote no se cambia.",
            ],
          },
          {
            type: "p",
            text: "A los ~10 s la tabla Barrios (plataforma) refleja los conteos de ese tenant.",
          },
        ],
      },
      {
        id: "anti-errores",
        title: "Anti-errores (esta prueba)",
        blocks: [
          {
            type: "table",
            headers: ["Qué pasó", "Qué hacer"],
            rows: [
              ["Crear sin URL", "Completá http://IP:3000"],
              ["URL .114 y fetch failed", "Si el predio es este Ubuntu, URL = http://192.168.190.146:3000"],
              ["Barrios «sin permiso»", "Salir; entrar admin@accesopro.local"],
              ["Fila Pendiente duplicada", "Borrar del directorio la pendiente; dejar la En línea"],
              [
                "Admin del predio «email o clave incorrectos»",
                "Usá el email y la clave del modal Barrio registrado",
              ],
              ["El combo no lista el barrio nuevo", "Recargá la página (el combo se arma al entrar)"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "propietario",
    title: "Propietario: invitación al lote",
    updated: "21/09/2026",
    summary:
      "El vecino no se da de alta en Sistema → Usuarios. Se invita sobre un lote existente, arma la clave en /activar y entra al portal con el lote bloqueado. Prueba en Las Acacias (local).",
    sections: [
      {
        id: "regla",
        title: "Qué se logra",
        blocks: [
          {
            type: "p",
            text: "Sistema → Usuarios es solo personal del predio (admin y guardia). El propietario vive en Personas → Lotes: se invita con email y WhatsApp, sin clave. El vecino define la clave en el enlace y opera /portal. El lote lo asigna el barrio; el titular no lo cambia.",
          },
          {
            type: "table",
            headers: ["Quién", "Dónde", "Qué"],
            rows: [
              ["Admin del barrio", "Personas → Lotes", "Alta de parcela (si no existe)"],
              ["Admin o guardia (access.owners.invite)", "Invitar propietario", "Email, nombre, DNI opcional, WhatsApp. Sin clave"],
              ["Propietario", "/activar?token=", "Clave definitiva (repetir)"],
              ["Propietario", "/portal", "Ficha, familia, servicios, QR. Lote de solo lectura"],
            ],
          },
          {
            type: "note",
            text: "El guardia no crea lotes. Invita a una parcela ya cargada. No uses el modal Nuevo Usuario con rol Propietario: ese camino ya no existe.",
          },
        ],
      },
      {
        id: "usuarios-staff",
        title: "1. Usuarios es staff, no vecinos",
        blocks: [
          {
            type: "p",
            text: "Como admin del barrio: Sistema → Usuarios. En Las Acacias hay dos cuentas de staff. Lucía (invitada al lote) no aparece acá.",
          },
          {
            type: "figure",
            src: "/manual/propietario/01-usuarios-staff.png",
            alt: "Lista de Usuarios con Admin barrio y Guardia",
            caption: "Personal de portería. El subtítulo manda a Personas → Lotes. Enlace Invitar propietario.",
          },
          {
            type: "p",
            text: "Nuevo Usuario: alta de guardia (nombre, email, clave y código de portería). No hay combo de rol Propietario / Residente.",
          },
          {
            type: "figure",
            src: "/manual/propietario/02-usuarios-nuevo-guardia.png",
            alt: "Modal Nuevo Usuario solo para guardia",
            caption: "Alta de guardia. El vecino se invita en Lotes.",
          },
        ],
      },
      {
        id: "invitar",
        title: "2. Invitar desde el lote",
        blocks: [
          {
            type: "p",
            text: "Personas → Lotes. En esta prueba: Lote 15 (María García, ya activa) y Lote 1 (Marcelo Gusman). Invitar propietario sobre el lote 1.",
          },
          {
            type: "figure",
            src: "/manual/propietario/03-lotes-padron.png",
            alt: "Padrón de lotes con invitación pendiente en el lote 1",
            caption: "Tras generar el link: Lucía Pérez queda pendiente de activar en el lote 1.",
          },
          {
            type: "figure",
            src: "/manual/propietario/04-invitar-modal.png",
            alt: "Modal Invitar propietario vacío",
            caption: "Lote + nombre o DNI + WhatsApp + email. El vecino arma su clave en el link.",
          },
          {
            type: "table",
            headers: ["Campo", "Valor de esta prueba"],
            rows: [
              ["Lote", "Lote 1 — Marcelo Gusman"],
              ["Nombre", "Lucía Pérez"],
              ["DNI", "30111222"],
              ["Email", "lucia.manual@lasacacias.local"],
              ["WhatsApp", "1155550199"],
            ],
          },
          {
            type: "figure",
            src: "/manual/propietario/05-invitar-completo.png",
            alt: "Modal Invitar propietario completo",
            caption: "Generar link. No se pide clave.",
          },
        ],
      },
      {
        id: "enlace",
        title: "3. Enlace /activar (sin clave temporal)",
        blocks: [
          {
            type: "p",
            text: "Sale el modal Enviar invitación. Copiar mensaje o WhatsApp. El texto apunta al enlace; no hay clave temporal.",
          },
          {
            type: "figure",
            src: "/manual/propietario/06-invitar-link.png",
            alt: "Modal con URL de activación y botones copiar y WhatsApp",
            caption: "El vecino arma la clave en este enlace. No hay clave temporal.",
          },
          {
            type: "note",
            text: "En Ubuntu el enlace es http://IP:3000/activar?token=… Si invitaste desde HTTPS :3443, el mensaje nuevo pasa a :3000 (la cámara DNI no hace falta para activar). En Laragon (esta PC) el origin queda en :3080 y hace falta /accesopro: http://localhost:3080/accesopro/activar?token=…",
          },
        ],
      },
      {
        id: "activar",
        title: "4. Activar cuenta",
        blocks: [
          {
            type: "p",
            text: "Salí de la sesión de admin. Abrí el enlace (con /accesopro en Laragon). La pantalla muestra lote y email. Definí la clave dos veces.",
          },
          {
            type: "figure",
            src: "/manual/propietario/07-activar.png",
            alt: "Pantalla Activar cuenta con lote 1 y email de Lucía",
            caption: "Lote 1 · lucia.manual@lasacacias.local. Guardar clave e ingresar.",
          },
        ],
      },
      {
        id: "portal",
        title: "5. Portal con lote bloqueado",
        blocks: [
          {
            type: "p",
            text: "Entra a /portal. Mi Ficha: nombre, DNI y teléfono se editan. Lote / Parcela está gris (solo lectura). El vecino no elige ni cambia el lote.",
          },
          {
            type: "figure",
            src: "/manual/propietario/08-portal-ficha.png",
            alt: "Portal del propietario con Lote / Parcela deshabilitado",
            caption: "Lote 1 (Marcelo Gusman) deshabilitado. PATCH /api/residents/me ignora lote / propertyId.",
          },
        ],
      },
      {
        id: "anti-errores",
        title: "Anti-errores (esta prueba)",
        blocks: [
          {
            type: "table",
            headers: ["Qué pasó", "Qué hacer"],
            rows: [
              ["Buscar Propietario en Nuevo Usuario", "Ese rol ya no está. Invitar en Personas → Lotes"],
              ["Guardia no ve Nueva Propiedad", "Es correcto: el guardia invita a un lote ya cargado"],
              ["El link :3080/activar da 404", "En Laragon agregá /accesopro delante de /activar"],
              ["El vecino quiere cambiar el lote", "No se puede. Lo define el predio en Lotes / plano"],
              ["POST /api/users con role resident", "400: se invita desde el lote, no desde Usuarios"],
              [
                "WhatsApp con email y clave temporal",
                "Texto viejo. Ignorá esa clave; usá solo /activar?token=. Después del update el mensaje es solo el enlace",
              ],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "replica-concentrador",
    title: "Replica y precarga en el concentrador",
    updated: "21/09/2026",
    summary:
      "Alta de barrio con tenant sombra, invitaciones por DNS público, restore de Ubuntu vacío y avisos FCM al lote.",
    sections: [
      {
        id: "precarga",
        title: "Precargar lotes sin garita",
        blocks: [
          {
            type: "p",
            text: "En Sistema → Barrios, Nuevo barrio. La URL de la garita es opcional. Al crear queda un barrio sombra en esta SQLite. El botón Lotes abre Personas → Lotes de ese barrio (mismo combo del header). Invitar propietario arma el enlace con WEB_ORIGIN (https del DNS), no con :3443.",
          },
          {
            type: "ul",
            items: [
              "Login plataforma admin@accesopro.local",
              "Alta barrio (plan Acceso Pro o Seguridad total)",
              "Lotes → invitar email + WhatsApp",
              "El vecino abre https://dns/activar?token= y define la clave",
              "Portal https://dns/portal (autorizar visitas, familia)",
            ],
          },
        ],
      },
      {
        id: "restore",
        title: "Ubuntu nuevo (restore)",
        blocks: [
          {
            type: "p",
            text: "En la garita: ACCESOPRO_HUB_TOKEN (el del modal) y ACCESOPRO_HUB_URL=https://dns. Al arrancar, si el padrón está vacío, baja el dump del tenant sombra (lotes, vecinos, cableado, historial dentro de la retención, fotos de evidencia). No copiar la DB a mano.",
          },
        ],
      },
      {
        id: "avisos",
        title: "Avisos al lote (120 s)",
        blocks: [
          {
            type: "p",
            text: "Portería (LAN) anuncia al lote. La garita publica el aviso al instante en el concentrador. FCM a todos los adultos del lote con cuenta; si no hay token, WhatsApp de respaldo (hook o wa.me). El primero que autoriza o deniega cierra el aviso; portería y la app muestran quién. El hub no abre la barrera: la garita toma la decisión en 1–2 s.",
          },
        ],
      },
      {
        id: "familia-app",
        title: "Familia con login y app",
        blocks: [
          {
            type: "p",
            text: "El titular invita un familiar adulto (email + WhatsApp, sin clave). Menor de 18: se empadrona sin cuenta ni cara en el ASI. La app Android (mismo paquete de guardia) pinta cola/censo si el rol es guardia, o avisos/SOS si es vecino. URL de API: el DNS público en 4G.",
          },
        ],
      },
    ],
  },
  {
    id: "autorizaciones-qr",
    title: "Autorizaciones QR del propietario",
    updated: "21/09/2026",
    summary:
      "El titular arma el QR en el portal WAN. El lector solo identifica. Portería completa la ficha y abre. Validez por defecto del barrio (24 h, configurable). El walk-in de 120 s es otro camino.",
    sections: [
      {
        id: "regla-qr",
        title: "Qué acredita el QR",
        blocks: [
          {
            type: "p",
            text: "El QR de visita no abre la barrera. En el ASI-6214S el lector pita (Error 96) y AccesoPro pone el pase en la cola de portería. Recién cuando el guardia aprueba (DNI, y baúl/seguro si hay auto) se dispara el relé. Cara de invitado: no se enrola.",
          },
          {
            type: "ul",
            items: [
              "Titular en /portal (DNS del concentrador): nombre obligatorio; DNI, categoría, patente y acompañantes opcionales",
              "Si no pone fechas ni horario: el pase vale el plazo del barrio (por defecto 24 h) desde que lo crea",
              "Si pone hasta el domingo o una franja: se respeta. La franja sin fechas usa el mismo plazo corrido y filtra la hora al escanear",
              "El QR viaja a la garita en 1–2 s (sync rápido mientras el pase está preautorizado o esperando entrada)",
            ],
          },
        ],
      },
      {
        id: "admin-plazo",
        title: "Plazo del barrio",
        blocks: [
          {
            type: "p",
            text: "Admin del predio → Configuración → Módulos → Validez de autorizaciones QR. Combo 4 / 8 / 12 / 24 / 48 / 72 horas. Eso no topea un fin de semana que el titular cargue a mano: solo aplica cuando no hay ventana.",
          },
          {
            type: "note",
            text: "Los 120 segundos del aviso walk-in (clic en el lote del plano) no son la validez del QR. El pase de walk-in también nace con el plazo del barrio; el aviso al titular vence a los 2 minutos.",
          },
        ],
      },
      {
        id: "prueba-qr",
        title: "Cómo se prueba",
        blocks: [
          {
            type: "table",
            headers: ["Paso", "Qué tiene que pasar"],
            rows: [
              ["Configuración en 24 h; QR en portal sin fechas", "validUntil ≈ ahora + 24 h"],
              ["Cambiar a 8 h; otro QR sin fechas", "8 h"],
              ["QR con hasta el domingo", "Se respeta esa fecha"],
              ["Escanear en el ASI", "Cola de portería; no abre. Completar DNI; Aprobar; relé"],
              ["Crear el QR en el concentrador (portal DNS)", "En menos de ~2 s el mismo token existe en la garita"],
              ["Walk-in desde el plano", "Aviso 120 s igual; el pase dura el plazo del barrio"],
            ],
          },
        ],
      },
    ],
  },
];
