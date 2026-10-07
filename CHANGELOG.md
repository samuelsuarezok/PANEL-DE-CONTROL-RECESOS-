# Cambios

## v1.1.0 — 2026-10-07

Primera versión publicada. Revisión completa de la app.

**Errores corregidos**
- La interfaz no funcionaba en ningún navegador: se enviaba TypeScript sin compilar. Ahora se compila a JavaScript.
- La vista de proyección mostraba el panel de control encima (también en la salida transparente para OBS).
- `/salida` mostraba la proyección en vez de la salida OBS/NDI.
- Cambiar duración, textos o modo desde el panel no tenía efecto; subir y eliminar archivos fallaba.
- Los botones ±min se desactivaban durante el receso; los anuncios no rotaban.
- La pausa seguía descontando tiempo en el servidor; la proyección no se actualizaba detenida o pausada.
- Con la configuración incluida, iniciar podía tirar abajo el servidor.
- En Mac, los datos se guardaban en la carpeta de usuario y no al lado del programa.
- El ejecutable para Mac Intel quedaba con la firma inválida.
- Compilar borraba las plantillas y logos de `dist/data`.

**Integraciones**
- Nueva: ProPresenter 7.9+ (API oficial). Timer sincronizado al segundo y mensaje opcional.
- Nueva: Resolume Arena/Avenue. Escribe la cuenta en un Text Block por REST (Arena 7) u OSC (Arena 6 y 7), sin OBS.
- FreeShow rehecho con la API REST real (puerto 5506).
- Instrucciones de OBS → Resolume corregidas (filtro NDI dedicado para la transparencia, Blend Mode «Alpha»).

**Mejoras**
- Panel de control rediseñado para el celular, con el tiempo en vivo, una barra fija y reinicio con doble toque.
- Pantalla de inicio, QR que abre el panel directamente y página `/conectar` legible por cualquier cámara.
- Reloj sincronizado entre pantallas. La cuenta sigue aunque se corte la red y se reconecta sola.
- Atajos de teclado, API para Companion/Stream Deck y ajustes ±min temporales.
