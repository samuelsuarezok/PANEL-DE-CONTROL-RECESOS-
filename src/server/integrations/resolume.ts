/**
 * Integración Resolume Arena / Avenue
 * Escribe la cuenta regresiva en una fuente de texto nativa de Resolume
 * (Text Block o Text Animator), sin necesidad de OBS ni NDI.
 *
 * - REST (Arena/Avenue 7+, Preferencias → Webserver, puerto 8080):
 *   GET  /api/v1/composition/layers/{L}/clips/{C}  → busca el parámetro de texto
 *   PUT  /api/v1/parameter/by-id/{id}  {"value": "..."}
 * - OSC (Arena 6 y 7, Preferencias → OSC → Input, puerto 7000):
 *   /composition/layers/{L}/clips/{C}/video/source/blocktextgenerator/text/params/lines  (Text Block)
 *   /composition/layers/{L}/clips/{C}/video/source/textgenerator/text/params/lines       (Text Animator)
 */

import type { AppState, ResolumeConfig, TestResult } from "../../types/index.js";
import { getConfig } from "../data.js";
import { getState, type EngineEvent } from "../engine.js";
import { getDisplay } from "../../shared/time.js";
import { httpRequest, setStatus, createQueue, describeNetworkError, type HttpResult } from "./common.js";
import { sendOsc } from "./osc.js";

interface ResolumeParam { id?: number; valuetype?: string; value?: unknown }
interface ResolumeClip { name?: { value?: string }; video?: { sourceparams?: Record<string, ResolumeParam> | null } | null }
interface ResolumeProduct { name?: string; major?: number; minor?: number; micro?: number }

const enqueue = createQueue("resolume");
let paramCache: { key: string; id: number; name: string } | null = null;
let pendingText: string | null = null;
let pushing = false;
let lastSent: string | null = null;

const cfg = () => getConfig().resolume;
const restBase = (c: ResolumeConfig) => `http://${c.host}:${c.restPort}/api/v1`;
const where = (c: ResolumeConfig) => `capa ${c.layer} / clip ${c.clip}`;

function ok(message: string) {
  setStatus("resolume", { enabled: true, state: "ok", message });
}
function fail(message: string) {
  setStatus("resolume", { enabled: true, state: "error", message });
}

/** Texto a enviar según el formato configurado */
export function renderText(state: AppState, displayText: string, format = cfg().textFormat): string {
  return (format || "{tiempo}")
    .replace(/\\n/g, "\n")
    .replace(/\{tiempo\}/gi, displayText)
    .replace(/\{arriba\}/gi, state.textTop)
    .replace(/\{abajo\}/gi, state.textBottom);
}

export function oscTextAddress(c: ResolumeConfig): string {
  if (c.oscSource === "custom" && c.oscAddress) return c.oscAddress;
  const generator = c.oscSource === "textanimator" ? "textgenerator" : "blocktextgenerator";
  return `/composition/layers/${c.layer}/clips/${c.clip}/video/source/${generator}/text/params/lines`;
}

/** Busca el parámetro de texto dentro de las propiedades de la fuente del clip */
function findTextParam(params: Record<string, ResolumeParam> | null | undefined): { id: number; name: string } | null {
  if (!params || typeof params !== "object") return null;
  const candidates = Object.entries(params).filter(
    ([, p]) => p && typeof p === "object" && typeof p.id === "number" && (p.valuetype === "ParamText" || p.valuetype === "ParamString"),
  );
  const preferred =
    candidates.find(([k]) => /^(text|texto|lines)$/i.test(k)) ??
    candidates.find(([, p]) => p.valuetype === "ParamText") ??
    candidates[0];
  return preferred ? { id: preferred[1].id as number, name: preferred[0] } : null;
}

async function resolveTextParam(c: ResolumeConfig): Promise<{ id: number; name: string } | null> {
  const key = `${c.host}:${c.restPort}/${c.layer}/${c.clip}`;
  if (paramCache?.key === key) return paramCache;
  const res = await httpRequest<ResolumeClip>(`${restBase(c)}/composition/layers/${c.layer}/clips/${c.clip}`);
  if (!res.ok) {
    if (res.status === 404) fail(`No existe la ${where(c)} en la composición de Resolume`);
    else fail(`Resolume: ${res.error}`);
    return null;
  }
  const found = findTextParam(res.data?.video?.sourceparams);
  if (!found) {
    fail(`El clip de la ${where(c)} no tiene una fuente de texto: cargá un «Text Block» o «Text Animator»`);
    return null;
  }
  paramCache = { key, ...found };
  return paramCache;
}

async function restPut(c: ResolumeConfig, text: string): Promise<HttpResult> {
  const param = await resolveTextParam(c);
  if (!param) return { ok: false, status: 0, error: "sin parámetro" };
  let res = await httpRequest(`${restBase(c)}/parameter/by-id/${param.id}`, { method: "PUT", body: { value: text } });
  if (!res.ok && (res.status === 404 || res.status === 400)) {
    // El clip pudo cambiar: volver a buscar el parámetro una vez
    paramCache = null;
    const retry = await resolveTextParam(c);
    if (retry) res = await httpRequest(`${restBase(c)}/parameter/by-id/${retry.id}`, { method: "PUT", body: { value: text } });
  }
  return res;
}

async function pushText(text: string): Promise<void> {
  const c = cfg();
  if (!c.enabled) return;
  if (c.protocol === "rest") {
    const res = await restPut(c, text);
    if (res.ok) {
      lastSent = text;
      ok(`Conectado · texto en ${where(c)} (parámetro «${paramCache?.name ?? "Text"}»)`);
    } else if (res.error !== "sin parámetro") {
      fail(`No se pudo escribir el texto: ${res.error}`);
    }
  } else {
    try {
      await sendOsc(c.host, c.oscPort, oscTextAddress(c), [text]);
      lastSent = text;
      setStatus("resolume", {
        enabled: true,
        state: "unknown",
        message: `Enviando por OSC a ${c.host}:${c.oscPort} (OSC no confirma la recepción)`,
      });
    } catch (err) {
      fail(`OSC: ${describeNetworkError(err, `udp://${c.host}:${c.oscPort}`)}`);
    }
  }
}

/** Encola el texto; si llegan varios seguidos solo se envía el último */
function queueText(text: string, force = false): void {
  if (!force && text === lastSent) return;
  pendingText = text;
  if (pushing) return;
  pushing = true;
  enqueue(async () => {
    try {
      while (pendingText !== null) {
        const next = pendingText;
        pendingText = null;
        await pushText(next);
      }
    } finally {
      pushing = false;
    }
  });
}

async function connectClip(): Promise<void> {
  const c = cfg();
  if (c.protocol === "rest") {
    const res = await httpRequest(`${restBase(c)}/composition/layers/${c.layer}/clips/${c.clip}/connect`, { method: "POST" });
    if (!res.ok) fail(`No se pudo disparar el clip (${where(c)}): ${res.error}`);
  } else {
    await sendOsc(c.host, c.oscPort, `/composition/layers/${c.layer}/clips/${c.clip}/connect`, [1]);
  }
}

async function clearLayer(): Promise<void> {
  const c = cfg();
  if (c.protocol === "rest") {
    const res = await httpRequest(`${restBase(c)}/composition/layers/${c.layer}/clear`, { method: "POST" });
    if (!res.ok) fail(`No se pudo limpiar la capa ${c.layer}: ${res.error}`);
  } else {
    await sendOsc(c.host, c.oscPort, `/composition/layers/${c.layer}/clear`, [1]);
  }
}

function currentText(): string {
  const state = getState();
  return renderText(state, getDisplay(state, Date.now()).text);
}

export function handleEvent(event: EngineEvent): void {
  const c = cfg();
  if (!c.enabled) return;
  switch (event.type) {
    case "started":
      if (c.connectOnStart) enqueue(connectClip);
      queueText(renderText(event.state, event.text));
      break;
    case "reset":
      if (c.clearOnReset) enqueue(clearLayer);
      queueText(renderText(event.state, event.text));
      break;
    case "tick":
    case "state":
      queueText(renderText(event.state, event.text));
      break;
  }
}

export async function testConnection(): Promise<TestResult> {
  const c = cfg();
  paramCache = null;
  if (c.protocol === "osc") {
    try {
      await sendOsc(c.host, c.oscPort, oscTextAddress(c), [currentText()]);
      lastSent = null;
      return {
        ok: true,
        message: `Enviado por OSC a ${c.host}:${c.oscPort} → ${oscTextAddress(c)}. OSC no confirma: verificá que el texto cambió en Resolume (Preferencias → OSC → OSC Input activado).`,
      };
    } catch (err) {
      return { ok: false, message: `OSC: ${describeNetworkError(err, `udp://${c.host}:${c.oscPort}`)}` };
    }
  }

  const product = await httpRequest<ResolumeProduct>(`${restBase(c)}/product`);
  if (!product.ok) {
    const message = product.status === 404
      ? "El webserver respondió 404: se necesita Resolume Arena/Avenue 7 con Preferencias → Webserver activado"
      : `${product.error} · Activá Preferencias → Webserver en Resolume (puerto ${c.restPort})`;
    if (c.enabled) fail(message);
    return { ok: false, message };
  }
  const p = product.data;
  const version = [p?.major, p?.minor, p?.micro].filter(v => v !== undefined).join(".");
  const name = `Resolume ${p?.name ?? ""} ${version}`.replace(/\s+/g, " ").trim();
  const param = await resolveTextParam(c);
  if (!param) {
    return { ok: false, message: `Conectado a ${name}, pero ${missingTextSource(c)}` };
  }
  lastSent = null;
  if (c.enabled) queueText(currentText(), true);
  const message = `Conectado a ${name} · ${where(c)}: parámetro «${param.name}» listo`;
  if (c.enabled) ok(message);
  return { ok: true, message };
}

function missingTextSource(c: ResolumeConfig): string {
  return `no se encontró una fuente de texto en la ${where(c)} (cargá un «Text Block» o «Text Animator» en ese clip)`;
}

export async function healthCheck(): Promise<void> {
  const c = cfg();
  if (!c.enabled) {
    setStatus("resolume", { enabled: false, state: "off", message: "Deshabilitado" });
    return;
  }
  if (c.protocol === "osc") {
    // OSC no tiene respuesta: reenviar el texto mantiene Resolume al día
    queueText(currentText(), true);
    return;
  }
  const product = await httpRequest<ResolumeProduct>(`${restBase(c)}/product`, { timeoutMs: 2000 });
  if (!product.ok) {
    fail(product.status === 404 ? "Webserver respondió 404 (¿Resolume 7 con Webserver activado?)" : product.error ?? "Sin respuesta");
    return;
  }
  const param = await resolveTextParam(c);
  if (!param) return;
  if (lastSent === null) queueText(currentText(), true);
  else ok(`Conectado · texto en ${where(c)} (parámetro «${param.name}»)`);
}

export function onConfigChanged(): void {
  paramCache = null;
  lastSent = null;
  if (cfg().enabled) queueText(currentText(), true);
}
