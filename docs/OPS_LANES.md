# Lógica operativa IN / OUT (portería)

Modelo mental del home `/dashboard`. Si algo falla (toast, historial, relés), contrastar acá.

## Piezas

| Pieza | Rol |
|-------|-----|
| AccesoCam IN/OUT | Live MJPEG del ASI elegido |
| Historial IN/OUT | Eventos `dahua_access` filtrados por `deviceId` del carril |
| Relés IN/OUT | Actuadores cableados al punto de ese sentido |
| Toast | Solo eventos **nuevos** posteriores al hydrate de la página |
| Autorizaciones | Pases/auths de todos los propietarios (pendientes / cerradas) |

## Asignación de lector por carril

1. **Cableado** `access_points.sentido` + `access_point_devices` (prioridad).
2. Si no hay cableado: heurística por nombre (`entrada` / `salida`).
3. **Override de sesión**: el `<select>` de AccesoCam fija el lector activo (live + historial) hasta F5.
4. IN sin cableado: fallback al primer equipo liveable.
5. OUT sin elección: vacío (STANDBY) hasta elegir equipo.

**Prueba con 1 ASI:** se puede elegir el mismo `deviceId` en IN y OUT. Entonces:
- ambos historiales ven la misma actividad de ese equipo;
- los relés de **ingreso** se comparten en el panel de salida (misma puerta física);
- el toast «Apertura manual» abre el actuador Dahua ligado a ese equipo (o el de ingreso).

**Producción:** 2 ASI → cablear cada uno a un punto `in` / `out`. El dropdown queda de respaldo.

## Toast (anti-F5)

Al hidratar `/api/events` se guarda `bootMaxCreatedAt` = máximo `createdAt` del listado (reloj del server). También se persiste el último id en `sessionStorage`.

Solo se emite toast si:
- el id no se vio en esta sesión, **y**
- `createdAt > bootMaxCreatedAt`, **y**
- no es el mismo id/timestamp ya marcado en `sessionStorage`.

Si la primera carga falla, el poll siguiente hidrata **sin** toast. El agent arranca con el cursor de la DB (`recNo` por equipo): no vuelca el historial del ASI; solo sube el hueco si el stream estuvo caído.

Así un F5 **no** re-tosta el último acceso.

## Apertura manual (toast / relé)

Orden de resolución del actuador para un `deviceId`:

1. Actuador `driver=dahua` con `dahuaDeviceId === deviceId`.
2. Actuadores del carril IN si ese device es el lector de ingreso (o compartido).
3. Actuadores del carril OUT si aplica.
4. Cualquier relé tipo puerta/portón manual del sitio.

## Qué no hace el dropdown

No escribe en DB ni cambia `access_points`. Es override de sesión. Persistencia = cableado en admin.

## Checklist si «no anda»

1. Agent reiniciado (payload con `deviceId` AccesoPro después del raw Dahua).
2. F5: no debe salir toast; fichar de nuevo sí.
3. Historial IN: debe listar con el mismo equipo que muestra AccesoCam IN.
4. Mismo ASI en OUT: deben aparecer relés de ingreso en el bloque Salida.
5. Toast denegado/aprobado: botón apertura dispara el relé de esa puerta.
