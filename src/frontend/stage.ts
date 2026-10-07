/**
 * Vista escenario - Receso
 * Una sola vista para:
 *  - Proyección (/?view=projection): pantalla completa con fondo, logo y anuncios
 *  - Proyección transparente (/proyeccion?transparente=1): solo textos, colores puros
 *  - Salida OBS/NDI (/salida?ancho=1920&alto=1080): tamaño fijo, fondo transparente,
 *    texto con contorno (estilo=plano sin contorno, fondo=1 con fondo)
 * El tiempo se calcula localmente con el reloj sincronizado: aunque se corte la red,
 * la cuenta sigue exacta.
 */

import type { AppState, ControlAction } from "../types/index.js";
import { getDisplay } from "../shared/time.js";
import { Connection } from "./lib/connection.js";
import { $ } from "./lib/dom.js";

export type StageKind = "projection" | "output";

interface StageOptions {
  kind: StageKind;
  preview: boolean;       // miniatura dentro del panel de control
  transparent: boolean;   // sin fondo (para OBS/Resolume)
  outline: boolean;       // contorno negro en los textos
  flat: boolean;          // colores puros, sin sombras
  showBackground: boolean;
  showLogo: boolean;
  showAnnouncements: boolean;
  width?: number;         // tamaño fijo (salida)
  height?: number;
}

function readOptions(kind: StageKind): StageOptions {
  const params = new URLSearchParams(location.search);
  const preview = params.get("preview") === "1";
  if (kind === "projection") {
    const transparent = params.get("transparente") === "1" || params.get("transparent") === "1";
    return {
      kind, preview, transparent, outline: false, flat: transparent,
      showBackground: !transparent, showLogo: !transparent, showAnnouncements: !transparent,
    };
  }
  const withBackground = params.get("fondo") === "1";
  const flat = params.get("estilo") === "plano";
  const size = (name: string, fallback: number, min: number, max: number) =>
    Math.min(max, Math.max(min, parseInt(params.get(name) ?? "", 10) || fallback));
  return {
    kind, preview,
    transparent: !withBackground,
    outline: !withBackground && !flat,
    flat: flat && !withBackground,
    showBackground: withBackground,
    showLogo: true,
    showAnnouncements: false,
    width: size("ancho", 1920, 320, 7680),
    height: size("alto", 1080, 180, 4320),
  };
}

export function initStage(kind: StageKind): void {
  const opts = readOptions(kind);
  const view = $("view-stage");
  const frame = $("stage-frame");
  const bgEl = $("stage-bg");
  const topEl = $("stage-top");
  const timeEl = $("stage-time");
  const bottomEl = $("stage-bottom");
  const logoEl = $<HTMLImageElement>("stage-logo");
  const annEl = $("stage-announcement");

  const params = new URLSearchParams(location.search);
  view.classList.add(`is-${kind}`);
  view.classList.toggle("is-preview", opts.preview);
  view.classList.toggle("is-transparent", opts.transparent);
  view.classList.toggle("is-outline", opts.outline);
  view.classList.toggle("is-flat", opts.flat);
  // Cuadriculado para ver la transparencia al abrir la salida en un navegador común
  view.classList.toggle("show-checker", opts.transparent && params.get("vista") === "1");
  document.documentElement.classList.toggle("is-transparent", opts.transparent);

  // Tamaño fijo para la salida OBS: unidad de escala según el cuadro pedido
  if (opts.width && opts.height) {
    const { width, height } = opts;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.setProperty("--u", `${Math.min(width, (height * 16) / 9) / 100}px`);
    const fit = () => {
      const scale = Math.min(window.innerWidth / width, window.innerHeight / height, 1);
      frame.style.transform = scale < 1 ? `scale(${scale})` : "";
    };
    fit();
    window.addEventListener("resize", fit);
  }

  const conn = new Connection(opts.preview ? "preview" : kind);

  // ===== Estado estático (textos, fondo, logo, anuncios) =====
  let logoSrc = "";
  let bgSignature = "";

  function setText(el: HTMLElement, text: string) {
    if (el.textContent !== text) el.textContent = text;
    el.hidden = text.trim() === "";
  }

  function applyState(state: AppState) {
    setText(topEl, state.textTop);
    setText(bottomEl, state.textBottom);

    const logo = opts.showLogo && state.logo ? state.logo : "";
    if (logo !== logoSrc) {
      logoSrc = logo;
      if (logo) logoEl.src = logo;
      else logoEl.removeAttribute("src");
    }
    logoEl.hidden = !logo;

    if (opts.showBackground) {
      const sig = `${state.background.type}|${state.background.value}|${state.backgroundAnimation}`;
      if (sig !== bgSignature) {
        bgSignature = sig;
        bgEl.dataset.animation = state.backgroundAnimation;
        bgEl.style.background = "";
        const v = state.background.value;
        bgEl.style.background = state.background.type === "image" ? `center / cover no-repeat url("${v}")` : v;
      }
    }
    bgEl.hidden = !opts.showBackground;

    updateAnnouncements(state);
    render();
  }

  // ===== Anuncios rotativos =====
  let annSignature = "";
  let annTimer: ReturnType<typeof setTimeout> | undefined;

  function showAnnouncement(text: string | null) {
    if (text === null) {
      annEl.classList.remove("visible");
      return;
    }
    annEl.textContent = text;
    annEl.hidden = false;
    annEl.classList.remove("visible");
    void annEl.offsetWidth; // reiniciar la animación de entrada
    annEl.classList.add("visible");
  }

  function updateAnnouncements(state: AppState) {
    const active = opts.showAnnouncements && state.startedAt !== null && state.announcements.length > 0;
    const sig = active ? JSON.stringify([state.announcements, state.announcementInterval]) : "";
    if (sig === annSignature) return;
    annSignature = sig;
    view.classList.toggle("has-announcements", active);
    clearTimeout(annTimer);
    showAnnouncement(null);
    if (!active) return;

    const list = state.announcements;
    const interval = Math.max(3, state.announcementInterval) * 1000;
    let index = 0;
    const step = () => {
      const item = list[index % list.length]!;
      index++;
      showAnnouncement(item.text);
      const visible = Math.min(item.duration * 1000, interval);
      if (list.length === 1 && visible >= interval) return; // uno solo: queda fijo
      annTimer = setTimeout(() => {
        if (visible < interval) {
          showAnnouncement(null);
          annTimer = setTimeout(step, interval - visible);
        } else {
          step();
        }
      }, visible);
    };
    step();
  }

  // ===== Tiempo (se calcula cada cuadro, el DOM solo cambia cuando cambia el texto) =====
  let lastText = "";
  let lastAlert = "";
  let lastZero = false;

  function render() {
    const state = conn.state;
    if (!state) return;
    const d = getDisplay(state, conn.serverNow());
    if (d.text !== lastText) {
      lastText = d.text;
      timeEl.textContent = d.text;
      timeEl.classList.toggle("is-long", !d.atZero && d.text.length > 5);
    }
    if (d.alert !== lastAlert) {
      lastAlert = d.alert;
      timeEl.dataset.alert = d.alert;
    }
    if (d.atZero !== lastZero) {
      lastZero = d.atZero;
      timeEl.classList.toggle("at-zero", d.atZero);
    }
  }

  const loop = () => {
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // Respaldo por si el navegador frena requestAnimationFrame (pestañas en segundo plano)
  setInterval(render, 250);

  conn.onState(applyState);

  if (opts.preview) return;

  // ===== Cursor oculto =====
  if (kind === "output") {
    view.classList.add("no-cursor");
  } else {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const showCursor = () => {
      view.classList.remove("no-cursor");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => view.classList.add("no-cursor"), 3000);
    };
    for (const ev of ["mousemove", "mousedown", "touchstart"]) document.addEventListener(ev, showCursor, { passive: true });
    showCursor();
  }

  // ===== Pantalla siempre encendida (Wake Lock; requiere https o localhost) =====
  let wakeLock: { release: () => Promise<void> } | null = null;
  const requestWakeLock = async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (nav.wakeLock && !wakeLock && !document.hidden) {
        wakeLock = await nav.wakeLock.request("screen");
        (wakeLock as unknown as EventTarget).addEventListener?.("release", () => { wakeLock = null; });
      }
    } catch {}
  };
  requestWakeLock();
  document.addEventListener("visibilitychange", requestWakeLock);
  document.addEventListener("click", requestWakeLock);

  // ===== Pantalla completa =====
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  if (kind === "projection") view.addEventListener("dblclick", toggleFullscreen);

  // ===== Atajos de teclado =====
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let action: ControlAction | null = null;
    switch (e.key) {
      case " ":
      case "k":
      case "K":
        action = { action: "toggle" };
        break;
      case "r":
      case "R":
        action = { action: "reset" };
        break;
      case "ArrowUp":
        action = { action: "add_minutes", value: 5 };
        break;
      case "ArrowDown":
        action = { action: "subtract_minutes", value: 5 };
        break;
      case "ArrowRight":
        action = { action: "add_minutes", value: 1 };
        break;
      case "ArrowLeft":
        action = { action: "subtract_minutes", value: 1 };
        break;
      case "f":
      case "F":
        if (kind === "projection") toggleFullscreen();
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    conn.control(action);
  });
}
