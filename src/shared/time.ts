/**
 * Cálculo de tiempo compartido - Receso
 * Lo usan el servidor (integraciones, API) y todas las vistas del navegador,
 * así todas las pantallas muestran exactamente lo mismo.
 */

import type { AppState, AlertThresholds } from "../types/index.js";

export type AlertLevel = "none" | "yellow" | "red";
export type RunPhase = "stopped" | "running" | "paused";

export interface Display {
  phase: RunPhase;
  remainingMs: number | null; // null = sin hora objetivo (modo "hasta hora")
  text: string;               // lo que se proyecta: "15:00", "1:05:00", mensaje final o "--:--"
  clock: string;              // siempre el reloj ("00:00" al llegar a cero)
  atZero: boolean;
  alert: AlertLevel;
  progress: number | null;    // 0..1 transcurrido (solo modo duración)
}

export function getPhase(state: AppState): RunPhase {
  if (state.startedAt === null) return "stopped";
  return state.pausedAt === null ? "running" : "paused";
}

export function isRunning(state: AppState): boolean {
  return getPhase(state) === "running";
}

/**
 * Milisegundos restantes.
 * - Duración detenida: muestra la duración completa.
 * - Pausado: el tiempo queda congelado en el instante de la pausa.
 * - Hasta hora: cuenta hacia la hora objetivo (en vivo salvo que esté pausado).
 */
export function getRemainingMs(state: AppState, now: number): number | null {
  const ref = state.pausedAt ?? now;
  const adjust = state.adjustMs || 0;
  if (state.mode === "until") {
    if (state.targetTime === null) return null;
    return state.targetTime + adjust - ref;
  }
  if (state.startedAt === null) return state.durationMs + adjust;
  return state.startedAt + state.pausedElapsedMs + state.durationMs + adjust - ref;
}

/** Formato de reloj redondeando hacia arriba: 14:59.2 → "15:00", llega a "00:00" justo en cero */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function getAlertLevel(remainingMs: number | null, thresholds: AlertThresholds): AlertLevel {
  if (remainingMs === null || remainingMs <= 0) return "none";
  // Comparar con el valor mostrado (redondeado) para que "05:00" ya salga en amarillo
  const shown = Math.ceil(remainingMs / 1000) * 1000;
  if (shown <= thresholds.red) return "red";
  if (shown <= thresholds.yellow) return "yellow";
  return "none";
}

export function getDisplay(state: AppState, now: number): Display {
  const phase = getPhase(state);
  const remainingMs = getRemainingMs(state, now);

  if (remainingMs === null) {
    return { phase, remainingMs, text: "--:--", clock: "--:--", atZero: false, alert: "none", progress: null };
  }

  const atZero = remainingMs <= 0;
  const clock = formatClock(remainingMs);
  const message = (state.messageAtZero || "").trim();
  const text = atZero ? (message || "00:00") : clock;
  const alert = atZero ? "none" : getAlertLevel(remainingMs, state.alertThresholds);

  let progress: number | null = null;
  const total = state.durationMs + (state.adjustMs || 0);
  if (state.mode === "duration" && total > 0) {
    progress = Math.min(1, Math.max(0, 1 - remainingMs / total));
  }

  return { phase, remainingMs, text, clock, atZero, alert, progress };
}

/**
 * Convierte "HH:MM" en epoch ms (hora local del equipo que la calcula).
 * Si esa hora ya pasó hace más de 12 h, se asume que es para mañana
 * (ej.: a las 23:00 se elige "08:00" → mañana a las 08:00).
 */
export function resolveUntilTarget(hhmm: string, now: number): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  const date = new Date(now);
  date.setHours(h, m, 0, 0);
  if (date.getTime() < now - 12 * 3600_000) date.setDate(date.getDate() + 1);
  return date.getTime();
}

/** "HH:MM" a partir de un epoch ms, en hora local */
export function formatHHMM(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
