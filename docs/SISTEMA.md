# AccesoPro — radiografía del sistema

Versión descrita: **v0.2.33**. Qué hace el código hoy (no el marketing). Actualizar este archivo cuando cambie la regla de acceso.

Fuentes: `AGENTS.md`, `apps/api/src/agent.ts`, `apps/api/src/visitHold.ts`, `apps/api/src/accessPoints.ts`, `apps/web/components/HomeDashboard.tsx`.

Mapa del monorepo: `docs/ARCHITECTURE.md`. Pendientes vivos: `docs/PENDING.md`. Portería: `docs/PLAN_PORTERIA.md` y `docs/OPS_LANES.md`.

---

## 1. Arquitectura (quién habla con quién)

```
ASI (lector) ←CGI/RTSP→ agent :8790 ←POST /agent/events→ API :8787 SQLite
                                      ←cola openDoor←
web :3000 ──REST + SSE── API
app Android ──poll REST (+ FCM si hay Firebase)── API pública del concentrador (titular/familiar) o LAN (guardia)
portal /portal ──pases QR / cara / familia / avisos FCM── API del concentrador (WAN)
```

Tres procesos:

- **Web** Next: dashboard, portal, portería.
- **API** Hono + SQLite: verdad de negocio, hold de visitas, actuadores.
- **Agent** Python: único que habla CGI/RTSP con el ASI (LAN). Poller de eventos y worker de comandos van en **hilos distintos**.

Regla comercial: `plan ∩ módulo ∩ feature pack ∩ grant del usuario`. Catálogo: `packages/catalog`.

---

## 2. Identidades (ramas de persona)

No hay un “turno” ni un lock global. Cada evento del lector es **una persona**. AccesoPro mira el ID y elige rama.

| Prefijo ASI | Quién | Enrolamiento | En el lector | AccesoPro |
|-------------|-------|--------------|--------------|-----------|
| `own_…` | Propietario | Portal: cara y/o **Mi QR de acceso** (`person_credentials` QR) | Cara: el ASI abre offline | Auxiliares cableados; QR Error 96 → `openDoor` si hay credencial vigente |
| `fam_…` | Familia del lote | Portal familia + foto y/o QR (permanente o temporal) | Igual que dueño | Abre solo; sin cola ni permanencia. Sin foto: el titular puede emitir QR temporal |
| `svc_…` | Servicio permanente (jardinero) | Portal servicios + horarios | Igual que dueño | Abre solo; **no** es visita |
| `v_…` | Visita / proveedor / walk-up | QR token HMAC; **sin cara** | QR → Error 96; el relé local **no** pulsa | Hold → cola guardia → recién ahí `openDoor`. **Vencido = deny** (sin aprobar) + baja ASI + historial |

El token QR de visita **no es** el userId `v_…`. El ASI guarda el token como CardNo; AccesoPro busca `visit_passes.token` o `person_credentials`.

**Mi QR de acceso** (titular / familiar adulto con cuenta): vive en portal Ficha y en la app (card Mi QR). Abre solo; no es el QR de visitas. Portería puede escanearlo y dispara actuadores sin cola.

`visitKind` (social / servicio / obra / delivery) es etiqueta: **no cambia** hold vs auto. Un jardinero en `property_services` (`svc_`) abre solo; el mismo rubro en un **pase de visita** espera al guardia.

---

## 3. Cómo debe ser un acceso (regla de producto)

```
Evento ASI → ¿quién es?
  own / fam / svc (cara o QR permanente) → abre solo
  visit_passes o user v_                 → no abre → cola guardia
    aprobó (+ baúl si auto) → openDoor solo relés del punto
    denegó                  → sigue cerrado
```

**Dueño y visita al mismo tiempo:** dos eventos, dos decisiones. El vecino con cara no espera aunque haya una visita en cola.

**Visita estricta:** QR identifica; el último botón es el guardia (entrada y salida). No enrolar cara de invitado: si no, el ASI abre en local y el hold no sirve.

**Permanencia:** solo visitas (IN carril 1 → OUT carril 2). Propietarios/permanentes no llevan reloj.

---

## 4. Árbol de decisión en runtime

Hub: `POST /agent/events` en `apps/api/src/agent.ts`.

1. Dedup por `recNo` / clave de acceso.
2. Resolver **punto y carril** (`resolveDeviceLane`) → `sentido`, `lane_code` 1|2, `accessPointId`.
3. Extraer card / QR / ErrorCode. Error **96** = pass-through nativo Dahua (el lector no compara el QR contra CardNo).
4. Lookup: credencial + `findVisitPassByCard`.
5. `isVisitQr` = hay pase **o** `dahuaUserId` empieza con `v_`:
   - **Sí** → `holdVisitQr()`; `failed=true`; **ningún** relé.
   - **No** y Error 96 + credencial activa → validar vigencia/usos → disparar relés cableados (`passthroughGranted`).
   - **No** y Status=1 (cara/tarjeta OK) → disparar actuadores **auxiliares** del punto; se saltea el relé Dahua del mismo equipo (el ASI ya abrió).
6. Persistencia + SSE `access_event` / `visit_hold`.

ALPR (`type=plate`) es **otra rama**: lista blanca/negra en AccesoPro; no entra al hold de visitas.

---

## 5. Máquina de estados de la visita

Tabla `visit_passes` + cola `guard_approvals` (`apps/api/src/visitHold.ts`).

```
preauthorized (portal o walk-up)
  → QR IN → awaiting_entry → (aprueba) in_site | (deniega) denied
  → vecino revoca → revoked
in_site
  → QR OUT → awaiting_exit → (aprueba + baúl si auto) completed | (deniega) denied
```

Aprobar en app o web dispara `openDoor` **antes** de cerrar el ticket. Si el agent no pulsa, la solicitud sigue pendiente y se ve el error.

Walk-up portería (`VisitorCheckinModal.tsx`): mismo `visit_passes` + hold de entrada. El wizard **no** abre barrera ni enrola cara. `visit_records.status` sigue al pase (`awaiting_entry` hasta que el guardia aprueba).

Walk-in desde el plano: **Anunciar visita** → aviso al portal del lote (120 s). El titular autoriza en el portal o **por teléfono**; el guardia confirma con su **código de guardia** (Usuarios) y recién ahí abre. El pase de walk-in usa el mismo `visit_auth_default_hours` del barrio (default 24 h); los 120 s son solo el TTL del aviso.

QR preautorizado (portal WAN): el titular crea un `visit_passes` (nombre obligatorio; DNI y ventana opcionales). Sin fechas ni horario → `validFrom = now`, `validUntil = now + visit_auth_default_hours` (4|8|12|24|48|72, lo cambia el admin en Configuración). El QR **identifica**; portería completa faltantes (DNI, seguro/baúl si hay auto, acompañantes) y aprueba. La garita hace pull en 1–2 s mientras el pase está `preauthorized` / `awaiting_entry` reciente.

Egreso: baúl si hay vehículo. Bien no registrado: foto + aviso al lote; la barrera no abre hasta que el titular autoriza. Menor de más: hay que pedir traslado al lote de procedencia.

### Documentos por tipo de visita (regla única)

Fuente: `docRequirements(visitKind, arrivalMode)` en `apps/api/src/visitHold.ts`. Espejo en `apps/web/lib/visitDocs.ts` y `apps/android/.../FichaParts.kt`. No duplicar la regla en otro lado.

| Tipo | A pie / plataforma | Vehículo |
|---|---|---|
| Social / delivery | DNI | + patente + seguro con foto de la tarjeta + licencia (vence + foto) + baúl |
| Servicio / técnico | DNI + ART o seguro de vida (vence + constancia) | lo anterior + ART |
| Contratista | DNI + ART (vence + constancia) | lo anterior + ART |

- El guardia elige **tipo** y **cómo llega** en la ficha (paso «Tipo de ingreso») o al leer el DNI en la app. Cambiar a un medio sin vehículo borra patente, seguro, licencia y la revisión del baúl de ingreso.
- **Vencido no pasa**, sin excepción del titular ni autorización verbal. Seguro o licencia vencidos: **Pasar a peatonal** (`POST /api/visitors/approvals/:id/pedestrian`) y se sigue como ingreso caminando. ART vencida: solo denegar. `POST …/expired-exception` responde 410.
- La autorización verbal cubre la espera del titular, no los documentos.
- **En archivo**: si la persona (por DNI) o la patente ya tienen ART, licencia o seguro cargados, la ficha los ofrece con «Usar» (`reuseId`). No se duplican filas con los mismos datos.
- En la salida no se vuelven a pedir documentos: solo baúl, bienes y menores.
- Faltantes que devuelve la API: `dni`, `patente`, `seguro_vehiculo`, `seguro_foto`, `licencia`, `licencia_foto`, `art`, `art_constancia`, `baul` y los vencidos `seguro_vehiculo_vencido`, `licencia_vencida`, `art_vencido`. Web y app los traducen a texto y saltan al paso.

### Revisión del baúl

Tabla `visit_trunk_checks` (una fila por pase y sentido `in` / `out`): descripción + hasta 6 fotos (`data/evidence/<site>/trunk-<id>.jpg`).

- Ingreso con vehículo: el paso Vehículo pide descripción o al menos una foto (faltante `baul`).
- Salida: la ficha muestra **Baúl al ingreso** (texto + galería) al lado de **Baúl a la salida** para comparar. Guardar la revisión de salida marca `trunk_checked`.
- API: `POST /api/visitors/approvals/:id/trunk` (`description`, `addPhotosBase64[]`, `removePhotoIds[]`), `GET /api/visitors/trunk/:checkId/photos/:photoId`. La ficha trae `trunkIn` / `trunkOut` con `photoUrls`.

Censo (`/dashboard/censo`, pack `visitors.census`): visitas `in_site` / `awaiting_exit` + acompañantes, teléfonos del titular. No cuenta dueños con cara (no hay reloj de permanencia).

`GET /api/visit-passes/verify` y `POST /api/visit-passes/scan` requieren sesión de guardia (`access.visitors.manage`). El ASI sigue por `holdVisitQr` interno.

---

## 6. Hardware: entidades vs cableado (no mezclar)

Orden fijo (`apps/api/src/db/schema.ts`, `apps/api/src/accessPoints.ts`):

1. Entidades sueltas: `actuators`, `dahua_devices`, `cameras`.
2. Topología: `access_points` (sector vehicular|peatonal|servicio + sentido in|out|both).
3. Cableado: `access_point_actuators` / `_devices` / `_cameras`.
4. Disparo: evento → punto del dispositivo → **solo** relés de esa fila.

El módulo comercial (ALPR, visitas, Dahua) **no** va en la fila del punto. Admin: `/dashboard/puntos-acceso`.

Portería (`HomeDashboard.tsx`): **Ingreso | plano | Salida**. AccesoCam RTSP no vive ahí (`/dashboard/dahua/live`). Toast facial al mismo carril. Campana del mapa abre la ficha de aprobación (`ap:open-visit-approval`). Clic en un lote = anunciar visita walk-in.

---

## 7. Superficies por rol

| Rol | Dónde | Qué puede |
|-----|--------|-----------|
| Plataforma | `/dashboard` + Módulos | Tenants, plan, self-update Ubuntu |
| Admin barrio | Predio, instalación, usuarios | Cableado, personas, grants |
| Guardia | Home ops + app `apps/android` | Live IN/OUT, relés, cola aprobar/denegar, walk-up, 911/107/100 |
| Vecino | `/portal` | Cara propia, familia, servicios, autorizar visita QR |
| Visita | Nada (solo el QR) | Identificarse; no abre |

App Android: poll 1 s a la misma API; ticket nuevo suena y abre la ficha. Dual-host: LAN 2 s y después URL pública. **No hay FCM.** Censo y SOS en la app. El dashboard web no abre el modal al leer el QR: solo la campana.

---

## 8. Cómo debería verse un acceso “bien”

**Vecino**

- Cara en el ASI de su carril: barrera sin portería.
- QR permanente: Error 96 → AccesoPro abre (hace falta credencial en padrón).
- Puede pasar **mientras** hay visitas en cola.

**Visita precargada**

1. Portal: QR + aviso “no entra hasta que portería apruebe”.
2. Campana en el lote.
3. Acerca QR → cola; no abre.
4. Guardia completa faltantes / baúl → abre.
5. Salida: otra vez QR → cola OUT.

**Walk-up**

- Wizard DNI → lote → modalidad → QR; la cola aprueba, no el botón del wizard.

**Hardware**

- Un ASI de entrada y otro de salida en producción; un solo ASI solo para lab (OUT hereda relés de IN).

---

## 9. Mejoras después (prioridad)

### Seguridad / consistencia del flujo

- QR permanente del vecino: enrolarlo siempre en `person_credentials` para que Error 96 abra sin alta manual.
- Distinguir en UI `svc_*` permanente vs visita con `visitKind=service`.

### Ops del guardia

- Push real al celular (hoy poll 3 s + dual-host; no hay FCM).
- Unir en historial la fila Error 96 + la apertura remota post-approve.
- Foto de evidencia de visita **sin** enrolar en ASI (`VisitFaceCapture.tsx` existe y no está cableado).

### Producto

- SMTP / mail del QR al invitado (`docs/PENDING.md`).
- UI portal para `visit_authorizations` recurrentes (empleada sin QR); el caso vivo es `property_services`.
- Intercom SIP real (FreePBX LAN); el softphone del home es stub.
- Medir código `Method` del QR (`ASI_QR_METHOD_CODE` sigue null).
- FCM nativo en el APK: el token se registra en `push_devices` cuando hay `google-services.json` (no bumpear Play hasta pedido). Hoy el titular/familiar en 4G usa el portal HTTPS + poll en la app.

### Sitio / infra

- Disco del Ubuntu: `/var` (Docker) se llenó y rompió `git fetch`. Prune de imágenes/builder, no `compose down -v`.
- SSH `:22` cerrado hacia la PC de trabajo; update por consola o botón Módulos.

---

## 10. Qué no es este sistema

- No es incendio certificado (`fire` = contacto del panel existente).
- No hay vínculo con Interplus.
- ALPR, pánico y fuego **no** pasan por el hold de visitas.
