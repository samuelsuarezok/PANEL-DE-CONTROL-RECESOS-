/**
 * Motor de la cuenta regresiva - Receso
 * Dueño único del estado: acciones de control, persistencia, tick y eventos
 * para las integraciones (ProPresenter, Resolume, FreeShow).
 */

import type { AppState, ControlAction, Template } from "../types/index.js";
import { loadState, saveState, getConfig, sanitizeStatePatch } from "./data.js";
import { getDisplay, getPhase, getRemainingMs, resolveUntilTarget } from "../shared/time.js";

export type EngineEventType =
  | "state"     // cualquier cambio de estado (para WebSocket)
  | "started"   // arrancó desde detenido
  | "resumed"   // siguió después de una pausa
  | "paused"
  | "reset"     // volvió a detenido (reiniciar, cambio de modo o plantilla)
  | "adjusted"  // cambió el tiempo (±min, duración, hora objetivo)
  | "ended"     // llegó a cero estando en curso
  | "tick";     // cambió el texto visible (cada segundo)

export interface EngineEvent {
  type: EngineEventType;
  state: AppState;
  prev: AppState;
  now: number;
  text: string; // texto visible actual (tiempo o mensaje final)
}

type Listener = (event: EngineEvent) => void;

const listeners = new Set<Listener>();
let state: AppState = loadState();
let lastText = "";
let endedFired = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;

// Si quedó "en curso" de una sesión anterior y terminó hace más de 1 h, volver a detenido
(() => {
  const remaining = getRemainingMs(state, Date.now());
  if (getPhase(state) !== "stopped" && remaining !== null && remaining < -3600_000) {
    state = { ...state, startedAt: null, pausedAt: null, pausedElapsedMs: 0, adjustMs: 0 };
    saveState(state);
  }
  endedFired = remaining !== null && remaining <= 0;
})();

export function onEngineEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(type: EngineEventType, prev: AppState, now: number): void {
  const event: EngineEvent = { type, state, prev, now, text: getDisplay(state, now).text };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error(`Error procesando evento "${type}":`, err);
    }
  }
}

export function getState(): AppState {
  return state;
}

export function getActiveTemplate(s: AppState = state): Template | null {
  if (!s.activeTemplate) return null;
  return getConfig().templates.find(t => t.name === s.activeTemplate) ?? null;
}

/** Aplica un cambio, persiste y notifica */
function commit(next: AppState, events: EngineEventType[], now: number): AppState {
  const prev = state;
  state = next;
  saveState(state);

  // Rearmar el evento "ended" si el tiempo vuelve a ser positivo
  const remaining = getRemainingMs(state, now);
  if (remaining === null || remaining > 0 || getPhase(state) === "stopped") endedFired = false;
  lastText = getDisplay(state, now).text;

  emit("state", prev, now);
  for (const type of events) emit(type, prev, now);
  return state;
}

/** Actualización parcial desde la API (textos, fondo, anuncios...). Valida los campos. */
export function patchState(patch: unknown): AppState {
  const clean = sanitizeStatePatch(patch, state);
  // Los campos de tiempo solo se cambian con acciones de control
  delete clean.startedAt;
  delete clean.pausedAt;
  delete clean.pausedElapsedMs;
  delete clean.adjustMs;
  delete clean.mode;
  delete clean.durationMs;
  delete clean.targetTime;
  if (Object.keys(clean).length === 0) return state;
  return commit({ ...state, ...clean }, [], Date.now());
}

/** Ejecuta una acción de control (panel, teclado, API REST) */
export function dispatch(input: unknown): { ok: boolean; error?: string } {
  const action = input as ControlAction | null;
  if (!action || typeof action !== "object" || typeof action.action !== "string") {
    return { ok: false, error: "Acción inválida" };
  }

  const now = Date.now();
  const phase = getPhase(state);
  const s: AppState = { ...state };

  switch (action.action) {
    case "toggle":
      return dispatch({ action: phase === "running" ? "pause" : "start" });

    case "start": {
      if (phase === "running") return { ok: true };
      if (s.mode === "until" && s.targetTime === null) return { ok: false, error: "Falta la hora objetivo" };
      if (phase === "stopped") {
        s.startedAt = now;
        s.pausedAt = null;
        s.pausedElapsedMs = 0;
        s.adjustMs = 0;
        commit(s, ["started"], now);
      } else {
        // Reanudar: en modo duración se descuenta el tiempo pausado
        if (s.mode === "duration" && s.pausedAt !== null) s.pausedElapsedMs += now - s.pausedAt;
        s.pausedAt = null;
        commit(s, ["resumed"], now);
      }
      return { ok: true };
    }

    case "pause": {
      if (phase !== "running") return { ok: true };
      s.pausedAt = now;
      commit(s, ["paused"], now);
      return { ok: true };
    }

    case "reset": {
      s.startedAt = null;
      s.pausedAt = null;
      s.pausedElapsedMs = 0;
      s.adjustMs = 0;
      commit(s, ["reset"], now);
      return { ok: true };
    }

    case "add_minutes":
    case "subtract_minutes": {
      const mins = Number(action.value ?? 5);
      if (!Number.isFinite(mins) || mins <= 0 || mins > 600) return { ok: false, error: "Minutos inválidos" };
      const delta = (action.action === "add_minutes" ? 1 : -1) * mins * 60000;
      if (s.mode === "until" && s.targetTime === null) return { ok: false, error: "Falta la hora objetivo" };
      if (phase === "stopped") {
        // Detenido: se cambia lo configurado
        if (s.mode === "duration") s.durationMs = Math.min(24 * 3600_000, Math.max(0, s.durationMs + delta));
        else s.targetTime = Math.max(now, s.targetTime! + delta);
      } else {
        // Durante el receso: ajuste temporal (Reiniciar vuelve a lo configurado).
        // Si ya llegó a cero, "+5" da 5 minutos desde ahora.
        const before = getRemainingMs(s, now) ?? 0;
        const after = Math.max(0, Math.max(0, before) + delta);
        s.adjustMs += after - before;
      }
      commit(s, ["adjusted"], now);
      return { ok: true };
    }

    case "set_duration": {
      const mins = Number(action.minutes);
      if (!Number.isFinite(mins) || mins < 0 || mins > 1440) return { ok: false, error: "Duración inválida" };
      s.mode = "duration";
      s.durationMs = Math.round(mins * 60000);
      s.targetTime = null;
      s.adjustMs = 0;
      if (state.mode !== "duration") {
        s.startedAt = null;
        s.pausedAt = null;
        s.pausedElapsedMs = 0;
        commit(s, ["reset"], now);
      } else {
        commit(s, ["adjusted"], now);
      }
      return { ok: true };
    }

    case "set_until": {
      const target = resolveUntilTarget(String(action.time ?? ""), now);
      if (target === null) return { ok: false, error: "Hora inválida (usá HH:MM)" };
      const modeChanged = s.mode !== "until";
      s.mode = "until";
      s.targetTime = target;
      s.adjustMs = 0;
      if (modeChanged) {
        s.startedAt = null;
        s.pausedAt = null;
        s.pausedElapsedMs = 0;
        commit(s, ["reset"], now);
      } else {
        commit(s, ["adjusted"], now);
      }
      return { ok: true };
    }

    case "set_mode": {
      if (action.mode !== "duration" && action.mode !== "until") return { ok: false, error: "Modo inválido" };
      if (action.mode === s.mode) return { ok: true };
      s.mode = action.mode;
      s.activeTemplate = null; // ya no corresponde a la plantilla aplicada
      s.startedAt = null;
      s.pausedAt = null;
      s.pausedElapsedMs = 0;
      s.adjustMs = 0;
      if (s.mode === "until" && s.targetTime === null) {
        s.targetTime = resolveUntilTarget("19:00", now);
      }
      commit(s, ["reset"], now);
      return { ok: true };
    }

    case "apply_template": {
      const template = getConfig().templates.find(t => t.name === action.templateName);
      if (!template) return { ok: false, error: "Plantilla no encontrada" };
      s.mode = template.mode;
      s.textTop = template.textTop;
      s.textBottom = template.textBottom;
      s.activeTemplate = template.name;
      if (template.mode === "duration") {
        s.durationMs = template.durationMs ?? 900000;
        s.targetTime = null;
      } else {
        s.targetTime = resolveUntilTarget(template.targetTime ?? "00:00", now);
      }
      s.startedAt = null;
      s.pausedAt = null;
      s.pausedElapsedMs = 0;
      s.adjustMs = 0;
      // Si estaba corriendo, avisar a las integraciones que se detuvo
      commit(s, phase === "stopped" ? [] : ["reset"], now);
      return { ok: true };
    }

    default:
      return { ok: false, error: `Acción desconocida: ${(action as { action: string }).action}` };
  }
}

/** Tick del servidor: detecta cambio de segundo (para Resolume) y llegada a cero */
function tick(): void {
  const now = Date.now();
  const display = getDisplay(state, now);
  if (display.text !== lastText) {
    lastText = display.text;
    emit("tick", state, now);
  }
  if (display.phase === "running" && display.atZero && !endedFired) {
    endedFired = true;
    emit("ended", state, now);
  }
}

export function startEngine(): void {
  if (tickTimer) return;
  lastText = getDisplay(state, Date.now()).text;
  tickTimer = setInterval(tick, 100);
}

export function stopEngine(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
