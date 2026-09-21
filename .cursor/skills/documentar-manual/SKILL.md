---
name: documentar-manual
description: >-
  Documenta pruebas AccesoPro en el archivo web imprimible
  (Sistema → Manual, /dashboard/manual). Usar cuando el usuario pida
  documentar un test, manual, capturas, imprimir, o agregar un paso
  al archivo web de documentación.
---

# Documentar en el manual web

Fuente de verdad del archivo vivo: **Sistema → Manual** (`/dashboard/manual`).

No armar un markdown suelto ni un PDF aparte. Ampliar ese archivo web.

## Qué tocar

| Pieza | Ruta |
|-------|------|
| Capítulos y texto | `apps/web/lib/manual.ts` (`MANUAL_CHAPTERS`) |
| Capturas | `apps/web/public/manual/<id-capitulo>/` |
| Vista / impresión | `apps/web/components/ManualView.tsx` |
| Ruta | `apps/web/app/dashboard/(admin)/manual/page.tsx` |

`docs/MANUAL_BARRIOS.md` solo apunta a la web. Detalle técnico de hub sigue en `docs/HUB_BARRIOS.md`.

## Cómo agregar un test

1. Capturar pantallas reales (claro, sin caras de personas si se puede).
2. Guardar PNG en `apps/web/public/manual/<id>/`. `src` del figure: `/manual/<id>/archivo.png`.
3. **Append** un capítulo en `MANUAL_CHAPTERS` (o una sección al capítulo que corresponda). No reescribir el archivo entero.
4. Cada capítulo: `id` (slug), `title`, `updated` (fecha de la prueba), `summary`, `sections` con bloques `p` / `ul` / `table` / `figure` / `note`.
5. En `figure.src` usar ruta tipo `/manual/<id>/archivo.png` (sin `/accesopro`: `publicAsset` lo resuelve).
5. El índice y el botón **Imprimir / PDF** salen solos.
6. Verificar en el browser: `/dashboard/manual` (login admin), ancla `#id`, impresión (chrome y menú se ocultan).

## Estilo

- Español rioplatense. Sin emojis. Sin placeholders en copy de UI.
- Tablas para campos y anti-errores. Figuras con `alt` y `caption`.
- No mezclar padrones ni IPs de otro predio en el capítulo equivocado.
