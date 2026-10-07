/**
 * Punto de entrada del frontend - Receso
 * Decide qué vista mostrar según la URL:
 *   /                     → inicio (botones para elegir)
 *   /?view=control        → panel de control
 *   /?view=projection     → proyección
 *   /proyeccion           → proyección (admite ?transparente=1)
 *   /salida               → salida OBS/NDI (?ancho=&alto=&fondo=&estilo=)
 */

import { initStage } from "./stage.js";
import { initControl } from "./control.js";

const params = new URLSearchParams(location.search);
const path = location.pathname.replace(/\/+$/, "") || "/";
let view = params.get("view");
if (!view) {
  if (path === "/salida") view = "output";
  else if (path === "/proyeccion") view = "projection";
  else view = "home";
}

function show(id: string) {
  document.getElementById(id)!.hidden = false;
}

switch (view) {
  case "control":
    show("view-control");
    initControl();
    break;
  case "output":
    show("view-stage");
    initStage("output");
    break;
  case "projection":
    show("view-stage");
    initStage("projection");
    break;
  default:
    show("view-home");
}
