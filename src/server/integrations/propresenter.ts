/**
 * Integración ProPresenter 7 (API oficial, ProPresenter 7.9 o superior)
 * Docs: https://openapi.propresenter.com
 *
 * Mantiene un timer de ProPresenter sincronizado con la cuenta de Receso
 * (duración, inicio alineado al segundo, pausa, reinicio) y, opcionalmente,
 * muestra/oculta un mensaje de ProPresenter (que puede contener ese timer).
 */

import type { TestResult } from "../../types/index.js";
import { getConfig } from "../data.js";
import { getState, type EngineEvent } from "../engine.js";
import { getPhase, getRemainingMs } from "../../shared/time.js";
import { httpRequest, setStatus, createQueue, sleep, type HttpResult } from "./common.js";

interface PPId { uuid: string; name: string; index: number }
interface PPTimer { id: PPId; allows_overrun?: boolean }
interface PPMessage { id: PPId }
interface PPVersion { name?: string; platform?: string; host_description?: string; api_version?: string }

const enqueue = createQueue("propresenter");
let timerCache: { key: string; timer: PPTimer } | null = null;
let syncSeq = 0;

const cfg = () => getConfig().propresenter;
const baseUrl = () => `http://${cfg().host}:${cfg().port}`;
const enc = encodeURIComponent;

function ok(message: string) {
  setStatus("propresenter", { enabled: true, state: "ok", message });
}
function fail(message: string) {
  setStatus("propresenter", { enabled: true, state: "error", message });
}
function failFrom(res: HttpResult, what: string) {
  if (res.status === 404) fail(`${what}: ProPresenter respondió 404 (¿existe? ¿está activada la red en Preferencias → Red?)`);
  else fail(`${what}: ${res.error ?? "error desconocido"}`);
}

/** Busca el timer configurado (por nombre, UUID o índice) y guarda su id completo */
async function resolveTimer(): Promise<PPTimer | null> {
  const c = cfg();
  if (!c.timer) return null;
  const key = `${c.host}:${c.port}/${c.timer}`;
  if (timerCache?.key === key) return timerCache.timer;
  const res = await httpRequest<PPTimer>(`${baseUrl()}/v1/timer/${enc(c.timer)}`);
  if (!res.ok || !res.data || typeof res.data !== "object" || !res.data.id?.uuid) {
    if (res.status === 404) fail(`No existe el timer «${c.timer}» en ProPresenter`);
    else failFrom(res, "Timer");
    return null;
  }
  timerCache = { key, timer: res.data };
  return res.data;
}

async function timerOp(timer: PPTimer, op: "start" | "stop" | "reset"): Promise<boolean> {
  const res = await httpRequest(`${baseUrl()}/v1/timer/${enc(timer.id.uuid)}/${op}`);
  if (!res.ok) {
    if (res.status === 404) timerCache = null;
    failFrom(res, `Timer ${op}`);
  }
  return res.ok;
}

/** Configura el timer como cuenta regresiva de N segundos y lo deja reiniciado (detenido) */
async function setCountdown(timer: PPTimer, seconds: number): Promise<boolean> {
  const body = {
    id: timer.id,
    allows_overrun: timer.allows_overrun ?? false,
    countdown: { duration: Math.max(0, Math.round(seconds)) },
  };
  const res = await httpRequest(`${baseUrl()}/v1/timer/${enc(timer.id.uuid)}/reset`, { method: "PUT", body });
  if (!res.ok) {
    if (res.status === 404) timerCache = null;
    failFrom(res, "Configurar timer");
  }
  return res.ok;
}

/** Pone el timer en el tiempo restante actual y lo arranca justo en el borde del segundo */
async function syncRunning(seq: number, afterSet?: () => Promise<void>): Promise<void> {
  const timer = await resolveTimer();
  if (!timer || seq !== syncSeq) return;

  let remaining = getRemainingMs(getState(), Date.now());
  if (remaining === null) return;
  if (!(await timerOp(timer, "stop"))) return;
  if (remaining <= 0) {
    await setCountdown(timer, 0);
    return;
  }

  // Elegir el próximo segundo entero dejando margen para la petición
  let secs = Math.floor(remaining / 1000);
  if (remaining - secs * 1000 < 150) secs -= 1;
  secs = Math.max(0, secs);
  if (!(await setCountdown(timer, secs)) || seq !== syncSeq) return;
  if (afterSet) await afterSet();

  remaining = getRemainingMs(getState(), Date.now()) ?? 0;
  await sleep(remaining - secs * 1000);
  if (seq !== syncSeq || getPhase(getState()) !== "running") return;
  if (await timerOp(timer, "start")) ok(`Timer «${timer.id.name}» en curso`);
}

/** Deja el timer detenido mostrando el tiempo restante (pausa, reinicio o ajuste sin correr) */
async function syncIdle(seq: number): Promise<void> {
  const timer = await resolveTimer();
  if (!timer || seq !== syncSeq) return;
  const remaining = getRemainingMs(getState(), Date.now());
  if (remaining === null) return;
  if (!(await timerOp(timer, "stop"))) return;
  if (await setCountdown(timer, Math.ceil(Math.max(0, remaining) / 1000))) {
    ok(`Timer «${timer.id.name}» listo`);
  }
}

async function showMessage(): Promise<void> {
  const c = cfg();
  if (!c.message) return;
  const res = await httpRequest(`${baseUrl()}/v1/message/${enc(c.message)}/trigger`, { method: "POST" });
  if (res.ok) ok(`Mensaje «${c.message}» visible`);
  else if (res.status === 404) fail(`No existe el mensaje «${c.message}» en ProPresenter`);
  else failFrom(res, "Mostrar mensaje");
}

async function hideMessage(): Promise<void> {
  const c = cfg();
  if (!c.message) return;
  const res = await httpRequest(`${baseUrl()}/v1/message/${enc(c.message)}/clear`);
  if (!res.ok) failFrom(res, "Ocultar mensaje");
}

function queueSync(afterSet?: () => Promise<void>): void {
  const seq = ++syncSeq;
  const running = getPhase(getState()) === "running";
  enqueue(() => (running ? syncRunning(seq, afterSet) : syncIdle(seq)));
}

/** Reacciona a los eventos del motor */
export function handleEvent(event: EngineEvent): void {
  const c = cfg();
  if (!c.enabled) return;
  const hasTimer = c.timer !== "";

  switch (event.type) {
    case "started":
      // El mensaje se muestra apenas el timer tiene la duración nueva (sin esperar el segundo exacto)
      if (hasTimer) queueSync(c.message ? showMessage : undefined);
      else if (c.message) enqueue(showMessage);
      break;
    case "resumed":
    case "paused":
    case "adjusted":
      if (hasTimer) queueSync();
      break;
    case "reset":
      if (hasTimer) queueSync();
      if (c.message && c.clearMessageOnEnd) enqueue(hideMessage);
      break;
    case "ended":
      if (c.message && c.clearMessageOnEnd) enqueue(hideMessage);
      break;
  }
}

/** Prueba la conexión y lista timers y mensajes disponibles */
export async function testConnection(): Promise<TestResult> {
  const c = cfg();
  const version = await httpRequest<PPVersion>(`${baseUrl()}/version`);
  if (!version.ok) {
    const message = version.status === 404
      ? "ProPresenter respondió 404: activá «Habilitar red» en Preferencias → Red (ProPresenter 7.9 o superior)"
      : version.error ?? "Sin respuesta";
    if (c.enabled) fail(message);
    return { ok: false, message };
  }

  const [timers, messages] = await Promise.all([
    httpRequest<PPTimer[]>(`${baseUrl()}/v1/timers`),
    httpRequest<PPMessage[]>(`${baseUrl()}/v1/messages`),
  ]);
  const timerNames = Array.isArray(timers.data) ? timers.data.map(t => t.id?.name).filter((n): n is string => !!n) : [];
  const messageNames = Array.isArray(messages.data) ? messages.data.map(m => m.id?.name).filter((n): n is string => !!n) : [];

  const v = version.data;
  const who = v?.host_description || v?.name || "ProPresenter";
  let message = `Conectado a ${who}${v?.api_version ? ` (API ${v.api_version})` : ""}`;
  let success = true;

  timerCache = null;
  if (c.timer && !timerNames.includes(c.timer) && !(await resolveTimer())) {
    message += ` · ⚠️ no existe el timer «${c.timer}»`;
    success = false;
  }
  if (c.message && !messageNames.includes(c.message)) {
    message += ` · ⚠️ no se encontró el mensaje «${c.message}»`;
    success = false;
  }

  if (c.enabled) setStatus("propresenter", { enabled: true, state: success ? "ok" : "error", message });
  return { ok: success, message, timers: timerNames, messages: messageNames };
}

/** Chequeo periódico (cada 10 s) para mostrar el estado real en el panel */
export async function healthCheck(): Promise<void> {
  const c = cfg();
  if (!c.enabled) {
    setStatus("propresenter", { enabled: false, state: "off", message: "Deshabilitado" });
    return;
  }
  const version = await httpRequest<PPVersion>(`${baseUrl()}/version`, { timeoutMs: 2000 });
  if (!version.ok) {
    fail(version.status === 404 ? "Respondió 404: activá la red en Preferencias → Red" : version.error ?? "Sin respuesta");
    return;
  }
  if (c.timer) {
    const timer = await resolveTimer();
    if (!timer) return;
    ok(`Conectado · timer «${timer.id.name}»`);
  } else {
    ok("Conectado · elegí un timer para sincronizar");
  }
}

export function onConfigChanged(): void {
  timerCache = null;
}
