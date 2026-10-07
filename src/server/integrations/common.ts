/**
 * Utilidades comunes de integraciones - Receso
 * Estado de conexión, peticiones HTTP con timeout y colas por integración.
 */

import type { IntegrationName, IntegrationStatus, IntegrationsStatus } from "../../types/index.js";

// ===== ESTADO DE CONEXIÓN =====
const status: IntegrationsStatus = {
  propresenter: { enabled: false, state: "off", message: "Deshabilitado", at: 0 },
  resolume: { enabled: false, state: "off", message: "Deshabilitado", at: 0 },
  freeshow: { enabled: false, state: "off", message: "Deshabilitado", at: 0 },
};
const statusListeners = new Set<(status: IntegrationsStatus) => void>();

export function getIntegrationsStatus(): IntegrationsStatus {
  return status;
}

export function onStatusChange(listener: (status: IntegrationsStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function setStatus(name: IntegrationName, next: Omit<IntegrationStatus, "at">): void {
  const prev = status[name];
  if (prev.enabled === next.enabled && prev.state === next.state && prev.message === next.message) return;
  status[name] = { ...next, at: Date.now() };
  if (next.state === "error") console.warn(`[${label(name)}] ${next.message}`);
  for (const listener of statusListeners) {
    try { listener(status); } catch {}
  }
}

export function label(name: IntegrationName): string {
  return name === "propresenter" ? "ProPresenter" : name === "resolume" ? "Resolume" : "FreeShow";
}

// ===== HTTP =====
export interface HttpResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/** Traduce errores de red a mensajes claros para el operador */
export function describeNetworkError(err: unknown, url: string): string {
  const e = err as { name?: string; code?: string; message?: string };
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `Sin respuesta de ${host} (timeout)`;
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? err);
  if (/ConnectionRefused|ECONNREFUSED/i.test(code + msg)) return `Conexión rechazada en ${host}: ¿está abierto el programa y habilitada su API/red?`;
  if (/ENOTFOUND|EAI_AGAIN|resolve|DNS/i.test(code + msg)) return `No se encuentra el equipo "${host}"`;
  if (/EHOSTUNREACH|ENETUNREACH|unreachable/i.test(code + msg)) return `No hay ruta hacia ${host}: revisá la red`;
  if (/Unable to connect|ConnectionClosed|ECONNRESET/i.test(code + msg)) return `No se pudo conectar con ${host}`;
  return `Error de red con ${host}: ${msg}`;
}

export async function httpRequest<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<HttpResult<T>> {
  const { method = "GET", body, headers = {}, timeoutMs = 2500 } = options;
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const detail = typeof data === "string" ? data.slice(0, 160) : "";
      return { ok: false, status: res.status, data: data as T, error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch (err) {
    return { ok: false, status: 0, error: describeNetworkError(err, url) };
  }
}

// ===== COLA SERIE =====
/** Ejecuta tareas de a una por integración, para que no se pisen (ej. iniciar y pausar rápido) */
export function createQueue(name: IntegrationName) {
  let chain: Promise<unknown> = Promise.resolve();
  return function enqueue(task: () => Promise<unknown>): void {
    chain = chain.then(task).catch(err => {
      setStatus(name, { enabled: true, state: "error", message: err instanceof Error ? err.message : String(err) });
    });
  };
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)));
