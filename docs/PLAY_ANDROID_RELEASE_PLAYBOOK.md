# Play Android — AccesoPro Guardia

App: **AccesoPro Guardia** (`ar.accesopro.guard`) · código en `apps/android`.

**No generar AAB ni bumpear `versionCode` sin pedido explícito.**

## Principios

1. `versionCode` monótono (hoy **1 / 0.1.0** en `apps/android/app/build.gradle.kts`).
2. `compileSdk` / `targetSdk` 36.
3. Release: `minifyEnabled` + `shrinkResources` + conservar `mapping.txt`.
4. Edge-to-edge: `enableEdgeToEdge()`; no lockear orientación.

## Qué hace

Login staff (`access.visitors.manage`) contra la API AccesoPro (`Authorization: Bearer`).
Cola de aprobación de visitas (entrada/salida). Discado 911 / 107 / 100 y teléfono del lote.

## Build local

Abrir `apps/android` en Android Studio. Primera vez: sync Gradle.

Debug APK (cuando se pida):

```
cd apps/android
./gradlew :app:assembleDebug
```

## Play Console (cuando exista ficha)

- Subir prueba: **Prueba y lanza → Pruebas**.
- mapping: **Versiones y paquetes → paquete N → Descargas → Recursos**.
- Avisos UX: **Para tu próxima versión**.
