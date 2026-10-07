/**
 * Utilidades de DOM para el frontend
 */

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** No pisar un campo mientras el usuario lo está editando */
export function setValueIfIdle(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (document.activeElement === input) return;
  if (input.value !== value) input.value = value;
}

/** Copiar al portapapeles (con alternativa para http:// en celulares, donde no hay Clipboard API) */
export async function copyText(text: string, input?: HTMLInputElement): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const el = input ?? Object.assign(document.createElement("textarea"), { value: text });
  if (!input) document.body.appendChild(el);
  el.select();
  el.setSelectionRange?.(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  if (!input) el.remove();
  return ok;
}

/** Aviso breve en pantalla (reemplaza a alert(), que bloquea en celulares) */
export function toast(message: string, kind: "info" | "ok" | "error" = "info", ms = 3500): void {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers: options.body !== undefined && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: options.body instanceof FormData ? options.body : options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data: { ok: boolean; data?: T; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new Error(`El servidor respondió ${res.status}`);
  }
  if (!data.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data.data as T;
}
