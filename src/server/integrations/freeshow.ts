/**
 * Integración FreeShow (API oficial: https://freeshow.app/api)
 * Usa la API REST: POST http://HOST:5506  body {"action": "...", ...datos}
 * (Configuración → Conexiones → API en FreeShow)
 *
 * Por plantilla: timer (name_start_timer / name_pause_timer / name_stop_timer)
 * y overlay (name_select_overlay / clear_overlays).
 */

import type { Template, TestResult } from "../../types/index.js";
import { getConfig } from "../data.js";
import { getActiveTemplate, type EngineEvent } from "../engine.js";
import { httpRequest, setStatus, createQueue, type HttpResult } from "./common.js";

const enqueue = createQueue("freeshow");
const cfg = () => getConfig().freeshow;

async function send(action: string, data: Record<string, unknown> = {}): Promise<HttpResult> {
  const c = cfg();
  const headers: Record<string, string> = c.token ? { Authorization: `Bearer ${c.token}` } : {};
  return httpRequest(`http://${c.host}:${c.port}`, { method: "POST", body: { action, ...data }, headers });
}

/** Ejecuta una acción y actualiza el estado visible en el panel */
async function run(action: string, data: Record<string, unknown>, what: string): Promise<void> {
  const res = await send(action, data);
  if (res.ok) {
    setStatus("freeshow", { enabled: true, state: "ok", message: `Conectado · ${what}` });
  } else {
    const hint = res.status === 401 || res.status === 403 ? " (revisá el token)" : "";
    setStatus("freeshow", { enabled: true, state: "error", message: `${what}: ${res.error}${hint}` });
  }
}

function onStart(template: Template, resumed: boolean): void {
  const timer = template.freeshowTimerName;
  const overlay = template.freeshowOverlayName;
  if (timer) enqueue(() => run("name_start_timer", { value: timer }, `timer «${timer}» iniciado`));
  if (overlay && !resumed) enqueue(() => run("name_select_overlay", { value: overlay }, `overlay «${overlay}» visible`));
}

export function handleEvent(event: EngineEvent): void {
  if (!cfg().enabled) return;
  // Al reiniciar se usa la plantilla que estaba corriendo (puede haber cambiado)
  const template = getActiveTemplate(event.type === "reset" ? event.prev : event.state);
  if (!template) return;

  switch (event.type) {
    case "started":
      onStart(template, false);
      break;
    case "resumed":
      onStart(template, true);
      break;
    case "paused":
      if (template.freeshowTimerName) {
        const timer = template.freeshowTimerName;
        enqueue(() => run("name_pause_timer", { value: timer }, `timer «${timer}» en pausa`));
      }
      break;
    case "reset":
      if (template.freeshowTimerName) {
        const timer = template.freeshowTimerName;
        enqueue(() => run("name_stop_timer", { value: timer }, `timer «${timer}» detenido`));
      }
      if (template.freeshowClearOnEnd) enqueue(() => run("clear_overlays", {}, "overlays limpiados"));
      break;
    case "ended":
      if (template.freeshowClearOnEnd) enqueue(() => run("clear_overlays", {}, "overlays limpiados"));
      break;
  }
}

/** Extrae nombres de timers de la respuesta de get_timers (lista u objeto por id) */
function timerNames(data: unknown): string[] {
  const items = Array.isArray(data) ? data : data && typeof data === "object" ? Object.values(data) : [];
  return items
    .map(t => (t && typeof t === "object" ? (t as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

export async function testConnection(): Promise<TestResult> {
  const c = cfg();
  const res = await send("get_timers");
  if (!res.ok) {
    const message = res.status === 401 || res.status === 403
      ? "FreeShow rechazó el acceso: revisá el token"
      : `${res.error} · Activá la API en FreeShow (Configuración → Conexiones) y usá el puerto REST (5506)`;
    if (c.enabled) setStatus("freeshow", { enabled: true, state: "error", message });
    return { ok: false, message };
  }
  const timers = timerNames(res.data);
  const message = `Conectado a FreeShow en ${c.host}:${c.port}${timers.length ? ` · ${timers.length} timer(s)` : ""}`;
  if (c.enabled) setStatus("freeshow", { enabled: true, state: "ok", message });
  return { ok: true, message, timers };
}

export async function healthCheck(): Promise<void> {
  const c = cfg();
  if (!c.enabled) {
    setStatus("freeshow", { enabled: false, state: "off", message: "Deshabilitado" });
    return;
  }
  const res = await send("get_timers");
  if (res.ok) setStatus("freeshow", { enabled: true, state: "ok", message: `Conectado a ${c.host}:${c.port}` });
  else setStatus("freeshow", { enabled: true, state: "error", message: res.error ?? "Sin respuesta" });
}
