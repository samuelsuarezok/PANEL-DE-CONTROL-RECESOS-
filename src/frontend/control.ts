/**
 * Panel de Control - Receso
 * Cuenta en vivo, plantillas, tiempo, textos, apariencia, anuncios, alertas,
 * integraciones (ProPresenter, Resolume, FreeShow), salidas y archivos.
 */

import type {
  AppConfig, AppState, IntegrationName, IntegrationsStatus, Presence, Template, TestResult,
} from "../types/index.js";
import { getDisplay, formatHHMM } from "../shared/time.js";
import { Connection, type ConnectionStatus } from "./lib/connection.js";
import { $, api, copyText, debounce, escapeHtml, setValueIfIdle, toast } from "./lib/dom.js";

const GRADIENT_PRESETS: Array<[string, string]> = [
  ["Noche", "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)"],
  ["Océano", "linear-gradient(135deg, #0b1d3a 0%, #0e4d64 100%)"],
  ["Atardecer", "linear-gradient(135deg, #2b0f3a 0%, #7a2e3a 60%, #c2603a 100%)"],
  ["Bosque", "linear-gradient(135deg, #0b1f17 0%, #14532d 100%)"],
  ["Carbón", "linear-gradient(180deg, #111114 0%, #26262e 100%)"],
  ["Aurora", "radial-gradient(circle at 30% 20%, #3b2a6b 0%, #0b0a1a 70%)"],
];

const INTEGRATIONS: IntegrationName[] = ["propresenter", "resolume", "freeshow"];

const minutesText = (ms: number) => String(Math.round((ms / 60000) * 100) / 100);

function storageGet(key: string): string | null {
  try { return localStorage.getItem(`receso.${key}`); } catch { return null; }
}
function storageSet(key: string, value: string): void {
  try { localStorage.setItem(`receso.${key}`, value); } catch {}
}

export function initControl(): void {
  const conn = new Connection("control");
  let state: AppState | null = null;
  let config: AppConfig | null = null;

  // ===== CONEXIÓN Y PRESENCIA =====
  const connectionPill = $("connection-pill");
  const presencePill = $("presence-pill");

  conn.onStatus((status: ConnectionStatus) => {
    connectionPill.dataset.state = status === "connected" ? "ok" : status === "connecting" ? "unknown" : "error";
    connectionPill.querySelector(".pill-label")!.textContent =
      status === "connected" ? "Conectado" : status === "connecting" ? "Conectando…" : "Sin conexión";
  });

  function applyPresence(p: Presence) {
    presencePill.textContent = `🖥️ ${p.projection} · 📺 ${p.output} · 📱 ${p.control}`;
    presencePill.title = `Proyección: ${p.projection} · Salida OBS/NDI: ${p.output} · Paneles de control: ${p.control}`;
    presencePill.dataset.state = p.projection + p.output > 0 ? "ok" : "unknown";
  }

  conn.onMessage(msg => {
    switch (msg.type) {
      case "sync":
        applyPresence(msg.presence);
        applyIntegrationStatus(msg.integrations);
        break;
      case "presence":
        applyPresence(msg.presence);
        break;
      case "integrations":
        applyIntegrationStatus(msg.integrations);
        break;
      case "config":
        applyConfig(msg.config);
        break;
      case "notice":
        toast(msg.message, msg.level === "error" ? "error" : "info");
        break;
    }
  });

  function control(action: Parameters<Connection["control"]>[0]) {
    if (!conn.control(action)) toast("Sin conexión con el servidor", "error");
  }

  // ===== EN VIVO =====
  const liveCard = $("live-card");
  const liveTime = $("live-time");
  const liveMeta = $("live-meta");
  const phaseBadge = $("phase-badge");
  const progressBar = $("live-progress-bar");
  const btnToggle = $<HTMLButtonElement>("btn-toggle");
  const btnReset = $<HTMLButtonElement>("btn-reset");
  const miniBar = $("mini-bar");
  const miniTime = $("mini-time");
  const miniPhase = $("mini-phase");
  const miniToggle = $<HTMLButtonElement>("mini-toggle");

  btnToggle.addEventListener("click", () => control({ action: "toggle" }));
  miniToggle.addEventListener("click", () => control({ action: "toggle" }));

  // Reiniciar en curso pide un segundo toque (evita accidentes en pleno receso)
  let resetArmed: ReturnType<typeof setTimeout> | null = null;
  btnReset.addEventListener("click", () => {
    const running = state && getDisplay(state, conn.serverNow()).phase === "running";
    if (running && !resetArmed) {
      btnReset.classList.add("armed");
      btnReset.textContent = "¿Reiniciar? Tocá de nuevo";
      resetArmed = setTimeout(disarmReset, 3000);
      return;
    }
    disarmReset();
    control({ action: "reset" });
  });
  function disarmReset() {
    if (resetArmed) clearTimeout(resetArmed);
    resetArmed = null;
    btnReset.classList.remove("armed");
    btnReset.textContent = "↺ Reiniciar";
  }

  document.querySelectorAll<HTMLButtonElement>("[data-adjust]").forEach(btn => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.adjust);
      control(value > 0 ? { action: "add_minutes", value } : { action: "subtract_minutes", value: -value });
    });
  });

  let lastLive = "";
  function renderLive() {
    if (!state) return;
    const d = getDisplay(state, conn.serverNow());
    const phaseLabel = d.phase === "running" ? (d.atZero ? "Terminado" : "En curso") : d.phase === "paused" ? "Pausado" : "Detenido";
    const phaseKey = d.phase === "running" && d.atZero ? "ended" : d.phase;
    const toggleLabel = d.phase === "running" ? "⏸ Pausar" : d.phase === "paused" ? "▶ Reanudar" : "▶ Iniciar";
    const key = [d.text, d.alert, d.atZero, phaseKey, Math.round((d.progress ?? -1) * 500)].join("|");
    if (key === lastLive) return;
    lastLive = key;

    liveTime.textContent = d.text;
    liveTime.dataset.alert = d.alert;
    liveTime.classList.toggle("at-zero", d.atZero);
    phaseBadge.textContent = phaseLabel;
    phaseBadge.dataset.phase = phaseKey;
    progressBar.parentElement!.hidden = d.progress === null;
    progressBar.style.width = `${(d.progress ?? 0) * 100}%`;
    progressBar.dataset.alert = d.alert;

    btnToggle.textContent = toggleLabel;
    btnToggle.classList.toggle("btn-warning", d.phase === "running");
    btnToggle.classList.toggle("btn-primary", d.phase !== "running");
    btnToggle.disabled = state.mode === "until" && state.targetTime === null;
    btnReset.disabled = d.phase === "stopped";
    if (d.phase !== "running") disarmReset();

    miniTime.textContent = d.text;
    miniTime.dataset.alert = d.alert;
    miniPhase.textContent = phaseLabel;
    miniToggle.textContent = toggleLabel;
    miniToggle.classList.toggle("btn-warning", d.phase === "running");
    miniToggle.classList.toggle("btn-primary", d.phase !== "running");
  }

  const loop = () => {
    renderLive();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setInterval(renderLive, 250);

  // Barra compacta cuando la tarjeta en vivo sale de pantalla
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      miniBar.hidden = !!entry?.isIntersecting;
    }).observe(liveCard);
  }

  // ===== TIEMPO =====
  const modeDuration = $<HTMLInputElement>("mode-duration");
  const modeUntil = $<HTMLInputElement>("mode-until");
  const durationInputs = $("duration-inputs");
  const untilInputs = $("until-inputs");
  const inputDuration = $<HTMLInputElement>("input-duration");
  const inputUntil = $<HTMLInputElement>("input-until");
  const durationChips = $("duration-chips");

  modeDuration.addEventListener("change", () => modeDuration.checked && control({ action: "set_mode", mode: "duration" }));
  modeUntil.addEventListener("change", () => modeUntil.checked && control({ action: "set_mode", mode: "until" }));
  inputDuration.addEventListener("change", () => {
    const minutes = Number(inputDuration.value);
    if (!Number.isFinite(minutes) || minutes < 0) return toast("Duración inválida", "error");
    control({ action: "set_duration", minutes });
  });
  inputDuration.addEventListener("keydown", e => { if (e.key === "Enter") inputDuration.blur(); });
  durationChips.addEventListener("click", e => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-minutes]");
    if (chip) control({ action: "set_duration", minutes: Number(chip.dataset.minutes) });
  });
  inputUntil.addEventListener("change", () => {
    if (inputUntil.value) control({ action: "set_until", time: inputUntil.value });
  });

  // ===== TEXTOS =====
  const inputTextTop = $<HTMLInputElement>("input-text-top");
  const inputTextBottom = $<HTMLInputElement>("input-text-bottom");
  const inputMessageZero = $<HTMLInputElement>("input-message-zero");

  function patchState(patch: Partial<AppState>) {
    return api("/api/state", { body: patch }).catch(err => toast(`No se pudo guardar: ${err.message}`, "error"));
  }

  const textFields: Array<[HTMLInputElement, "textTop" | "textBottom" | "messageAtZero"]> = [
    [inputTextTop, "textTop"],
    [inputTextBottom, "textBottom"],
    [inputMessageZero, "messageAtZero"],
  ];
  for (const [input, key] of textFields) {
    const send = () => {
      if (state && state[key] !== input.value) patchState({ [key]: input.value });
    };
    const later = debounce(send, 400);
    input.addEventListener("input", later);
    input.addEventListener("change", send);
  }

  // ===== APARIENCIA =====
  const bgColorRadio = $<HTMLInputElement>("bg-color");
  const bgGradientRadio = $<HTMLInputElement>("bg-gradient");
  const bgImageRadio = $<HTMLInputElement>("bg-image");
  const bgColorInputs = $("bg-color-inputs");
  const bgGradientInputs = $("bg-gradient-inputs");
  const bgImageInputs = $("bg-image-inputs");
  const inputBgColor = $<HTMLInputElement>("input-bg-color");
  const inputBgGradient = $<HTMLInputElement>("input-bg-gradient");
  const inputBgImage = $<HTMLInputElement>("input-bg-image");
  const bgImagePreview = $("bg-image-preview");
  const inputLogo = $<HTMLInputElement>("input-logo");
  const logoPreview = $("logo-preview");
  const inputBgAnimation = $<HTMLSelectElement>("input-bg-animation");
  const gradientPresets = $("gradient-presets");

  function showBgInputs(type: AppState["background"]["type"]) {
    bgColorInputs.hidden = type !== "color";
    bgGradientInputs.hidden = type !== "gradient";
    bgImageInputs.hidden = type !== "image";
  }

  bgColorRadio.addEventListener("change", () => {
    showBgInputs("color");
    patchState({ background: { type: "color", value: inputBgColor.value } });
  });
  bgGradientRadio.addEventListener("change", () => {
    showBgInputs("gradient");
    const value = inputBgGradient.value.trim() || GRADIENT_PRESETS[0]![1];
    inputBgGradient.value = value;
    patchState({ background: { type: "gradient", value } });
  });
  bgImageRadio.addEventListener("change", () => {
    showBgInputs("image");
    if (state?.background.type !== "image") toast("Subí una imagen o elegila en «Archivos subidos»");
  });

  inputBgColor.addEventListener("input", debounce(() => patchState({ background: { type: "color", value: inputBgColor.value } }), 150));
  const sendGradient = () => {
    const value = inputBgGradient.value.trim();
    if (value) patchState({ background: { type: "gradient", value } });
  };
  inputBgGradient.addEventListener("input", debounce(sendGradient, 500));
  inputBgGradient.addEventListener("change", sendGradient);

  gradientPresets.innerHTML = GRADIENT_PRESETS.map(
    ([name, css], i) => `<button type="button" class="swatch" data-preset="${i}" title="${escapeHtml(name)}" style="background:${escapeHtml(css)}"><span>${escapeHtml(name)}</span></button>`,
  ).join("");
  gradientPresets.addEventListener("click", e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-preset]");
    if (!btn) return;
    const css = GRADIENT_PRESETS[Number(btn.dataset.preset)]![1];
    inputBgGradient.value = css;
    patchState({ background: { type: "gradient", value: css } });
  });

  inputBgAnimation.addEventListener("change", () =>
    patchState({ backgroundAnimation: inputBgAnimation.value as AppState["backgroundAnimation"] }));

  async function upload(file: File): Promise<string | null> {
    const form = new FormData();
    form.append("file", file);
    try {
      const data = await api<{ url: string }>("/api/upload", { method: "POST", body: form });
      loadUploads();
      return data.url;
    } catch (err) {
      toast(`No se pudo subir: ${(err as Error).message}`, "error");
      return null;
    }
  }

  inputBgImage.addEventListener("change", async () => {
    const file = inputBgImage.files?.[0];
    if (!file) return;
    const url = await upload(file);
    inputBgImage.value = "";
    if (url) patchState({ background: { type: "image", value: url } });
  });
  inputLogo.addEventListener("change", async () => {
    const file = inputLogo.files?.[0];
    if (!file) return;
    const url = await upload(file);
    inputLogo.value = "";
    if (url) patchState({ logo: url });
  });

  function renderPreview(el: HTMLElement, url: string | null, onRemove: () => void) {
    if (!url) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    if (el.dataset.url === url && !el.hidden) return;
    el.dataset.url = url;
    el.innerHTML = `<img src="${escapeHtml(url)}" alt=""><button type="button" class="btn btn-secondary btn-sm">Quitar</button>`;
    el.querySelector("button")!.addEventListener("click", onRemove);
    el.hidden = false;
  }

  // ===== ANUNCIOS =====
  const announcementsList = $("announcements-list");
  const inputAnnouncement = $<HTMLInputElement>("input-announcement");
  const inputAnnouncementDuration = $<HTMLInputElement>("input-announcement-duration");
  const inputAnnouncementInterval = $<HTMLInputElement>("input-announcement-interval");

  function addAnnouncement() {
    const text = inputAnnouncement.value.trim();
    if (!text || !state) return;
    const duration = Number(inputAnnouncementDuration.value) || 10;
    patchState({ announcements: [...state.announcements, { text, duration }] });
    inputAnnouncement.value = "";
  }
  $("btn-add-announcement").addEventListener("click", addAnnouncement);
  inputAnnouncement.addEventListener("keydown", e => { if (e.key === "Enter") addAnnouncement(); });
  inputAnnouncementInterval.addEventListener("change", () => {
    const value = Number(inputAnnouncementInterval.value);
    if (value >= 3) patchState({ announcementInterval: value });
  });
  announcementsList.addEventListener("click", e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-delete-ann]");
    if (!btn || !state) return;
    const idx = Number(btn.dataset.deleteAnn);
    patchState({ announcements: state.announcements.filter((_, i) => i !== idx) });
  });

  let annSignature = "";
  function renderAnnouncements(list: AppState["announcements"]) {
    const sig = JSON.stringify(list);
    if (sig === annSignature) return;
    annSignature = sig;
    announcementsList.innerHTML = list.length
      ? list.map((a, i) => `
        <div class="list-item">
          <span class="list-text">${escapeHtml(a.text)}</span>
          <span class="list-meta">${a.duration}s</span>
          <button type="button" class="btn btn-ghost btn-sm" data-delete-ann="${i}" aria-label="Eliminar anuncio">✕</button>
        </div>`).join("")
      : `<p class="empty">Sin anuncios</p>`;
  }

  // ===== ALERTAS =====
  const inputAlertYellow = $<HTMLInputElement>("input-alert-yellow");
  const inputAlertRed = $<HTMLInputElement>("input-alert-red");
  const sendAlerts = () => {
    const yellow = Math.max(0, Number(inputAlertYellow.value) || 0) * 60000;
    const red = Math.max(0, Number(inputAlertRed.value) || 0) * 60000;
    if (red > yellow && yellow > 0) toast("El rojo es mayor que el amarillo: el amarillo no se va a ver", "info");
    api("/api/config", { body: { alertThresholds: { yellow, red } } }).catch(err => toast(err.message, "error"));
  };
  inputAlertYellow.addEventListener("change", sendAlerts);
  inputAlertRed.addEventListener("change", sendAlerts);

  // ===== PLANTILLAS =====
  const templatesList = $("templates-list");
  const templateModal = $<HTMLDialogElement>("template-modal");
  const templateForm = $<HTMLFormElement>("template-form");
  const templateName = $<HTMLInputElement>("template-name");

  function templateMeta(t: Template): string {
    const time = t.mode === "duration" ? `${minutesText(t.durationMs ?? 0)} min` : `Hasta ${t.targetTime}`;
    return [time, t.textTop].filter(Boolean).join(" · ");
  }

  let templatesSignature = "";
  function renderTemplates() {
    if (!config) return;
    const active = state?.activeTemplate ?? null;
    const sig = JSON.stringify([config.templates, active]);
    if (sig === templatesSignature) return;
    templatesSignature = sig;
    templatesList.innerHTML = config.templates.length
      ? config.templates.map((t, i) => `
        <div class="template${t.name === active ? " active" : ""}">
          <button type="button" class="template-apply" data-apply="${i}">
            <span class="template-name">${escapeHtml(t.name)}</span>
            <span class="template-meta">${escapeHtml(templateMeta(t))}</span>
          </button>
          <button type="button" class="btn btn-ghost btn-sm" data-delete-template="${i}" aria-label="Eliminar plantilla ${escapeHtml(t.name)}">🗑</button>
        </div>`).join("")
      : `<p class="empty">No hay plantillas guardadas</p>`;
  }

  templatesList.addEventListener("click", e => {
    if (!config) return;
    const target = e.target as HTMLElement;
    const apply = target.closest<HTMLButtonElement>("[data-apply]");
    if (apply) {
      const t = config.templates[Number(apply.dataset.apply)];
      if (t) {
        control({ action: "apply_template", templateName: t.name });
        toast(`Plantilla «${t.name}» aplicada`, "ok", 2000);
      }
      return;
    }
    const del = target.closest<HTMLButtonElement>("[data-delete-template]");
    if (del) {
      const t = config.templates[Number(del.dataset.deleteTemplate)];
      if (t && confirm(`¿Eliminar la plantilla «${t.name}»?`)) {
        api(`/api/templates/${encodeURIComponent(t.name)}`, { method: "DELETE" }).catch(err => toast(err.message, "error"));
      }
    }
  });

  $("btn-save-template").addEventListener("click", () => {
    templateName.value = state?.activeTemplate ?? "";
    templateModal.showModal();
    templateName.focus();
  });

  templateForm.addEventListener("submit", e => {
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === "cancel") return; // el diálogo se cierra solo
    e.preventDefault();
    const name = templateName.value.trim();
    if (!name || !state) return;
    const template: Template = {
      name,
      mode: state.mode,
      textTop: state.textTop,
      textBottom: state.textBottom,
      ...(state.mode === "duration"
        ? { durationMs: state.durationMs }
        : { targetTime: state.targetTime ? formatHHMM(state.targetTime) : "00:00" }),
    };
    api("/api/templates", { body: template })
      .then(() => {
        templateModal.close();
        toast(`Plantilla «${name}» guardada`, "ok");
      })
      .catch(err => toast(err.message, "error"));
  });

  // ===== INTEGRACIONES =====
  const intInputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-int][data-key]"));

  function readField(el: HTMLInputElement | HTMLSelectElement): unknown {
    if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
    if (el instanceof HTMLInputElement && el.type === "number") return Number(el.value);
    return el.value;
  }

  function saveIntegration(name: IntegrationName, patch: Record<string, unknown>) {
    api(`/api/integrations/${name}/config`, { body: patch }).catch(err => toast(err.message, "error"));
  }

  for (const el of intInputs) {
    const name = el.dataset.int as IntegrationName;
    const key = el.dataset.key!;
    const send = () => {
      if (el instanceof HTMLInputElement && el.type === "radio" && !el.checked) return;
      if (el instanceof HTMLInputElement && el.type === "number" && el.value === "") return;
      saveIntegration(name, { [key]: readField(el) });
      if (name === "resolume") updateResolumeFields();
    };
    if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "password")) {
      el.addEventListener("input", debounce(send, 700));
    }
    el.addEventListener("change", send);
  }

  function updateResolumeFields() {
    const protocol = document.querySelector<HTMLInputElement>('input[name="res-protocol"]:checked')?.value ?? "rest";
    document.querySelectorAll<HTMLElement>("[data-show-protocol]").forEach(el => {
      el.hidden = el.dataset.showProtocol !== protocol;
    });
    $("res-osc-custom").hidden = $<HTMLSelectElement>("res-osc-source").value !== "custom";
  }

  function applyIntegrationConfig(cfg: AppConfig) {
    for (const el of intInputs) {
      const section = cfg[el.dataset.int as IntegrationName] as unknown as Record<string, unknown>;
      const value = section?.[el.dataset.key!];
      if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = value === true;
      else if (el instanceof HTMLInputElement && el.type === "radio") el.checked = el.value === value;
      else setValueIfIdle(el, value === undefined || value === null ? "" : String(value));
    }
    updateResolumeFields();
  }

  function applyIntegrationStatus(status: IntegrationsStatus) {
    for (const name of INTEGRATIONS) {
      const s = status[name];
      const short = s.state === "off" ? "Deshabilitado" : s.state === "ok" ? "Conectado" : s.state === "error" ? "Error" : "Sin confirmar";
      document.querySelectorAll<HTMLElement>(`[data-status-for="${name}"]`).forEach(pill => {
        pill.dataset.state = s.state;
        pill.querySelector(".pill-label")!.textContent = short;
        pill.title = s.message;
      });
      document.querySelectorAll<HTMLElement>(`[data-status-line-for="${name}"]`).forEach(line => {
        line.textContent = s.enabled ? s.message : "";
        line.dataset.state = s.state;
        line.hidden = !s.enabled;
      });
    }
  }

  function fillDatalist(id: string, values: string[] | undefined) {
    if (!values) return;
    $(id).innerHTML = values.map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
  }

  document.querySelectorAll<HTMLButtonElement>("[data-test]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.test as IntegrationName;
      const resultEl = document.querySelector<HTMLElement>(`[data-result-for="${name}"]`)!;
      btn.disabled = true;
      resultEl.hidden = false;
      resultEl.dataset.state = "unknown";
      resultEl.textContent = "Probando…";
      try {
        const res = await fetch(`/api/integrations/${name}/test`, { method: "POST" });
        const body = (await res.json()) as { ok: boolean; data?: TestResult; error?: string };
        const result = body.data ?? { ok: false, message: body.error ?? "Error" };
        resultEl.dataset.state = result.ok ? "ok" : "error";
        resultEl.textContent = `${result.ok ? "✅" : "❌"} ${result.message}`;
        if (name === "propresenter") {
          fillDatalist("pp-timers", result.timers);
          fillDatalist("pp-messages", result.messages);
          if (result.timers?.length) resultEl.textContent += ` · Timers: ${result.timers.join(", ")}`;
        }
        if (name === "freeshow") fillDatalist("fs-timers", result.timers);
      } catch (err) {
        resultEl.dataset.state = "error";
        resultEl.textContent = `❌ ${(err as Error).message}`;
      } finally {
        btn.disabled = false;
      }
    });
  });

  // FreeShow: timer y overlay por plantilla
  const fsTemplate = $<HTMLSelectElement>("fs-template");
  const fsTimerName = $<HTMLInputElement>("fs-timer-name");
  const fsOverlayName = $<HTMLInputElement>("fs-overlay-name");
  const fsClearOnEnd = $<HTMLInputElement>("fs-clear-on-end");

  function renderFreeShowTemplates() {
    if (!config) return;
    const current = fsTemplate.value;
    fsTemplate.innerHTML = `<option value="">— Elegí una plantilla —</option>` +
      config.templates.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("");
    if (config.templates.some(t => t.name === current)) fsTemplate.value = current;
    loadFreeShowTemplate();
  }

  function loadFreeShowTemplate() {
    const t = config?.templates.find(x => x.name === fsTemplate.value);
    fsTimerName.value = t?.freeshowTimerName ?? "";
    fsOverlayName.value = t?.freeshowOverlayName ?? "";
    fsClearOnEnd.checked = t?.freeshowClearOnEnd ?? false;
    for (const el of [fsTimerName, fsOverlayName, fsClearOnEnd]) el.disabled = !t;
  }
  fsTemplate.addEventListener("change", loadFreeShowTemplate);

  $("btn-fs-save-template").addEventListener("click", () => {
    if (!config || !fsTemplate.value) return toast("Elegí una plantilla", "error");
    const templates = config.templates.map(t =>
      t.name === fsTemplate.value
        ? {
            ...t,
            freeshowTimerName: fsTimerName.value.trim() || undefined,
            freeshowOverlayName: fsOverlayName.value.trim() || undefined,
            freeshowClearOnEnd: fsClearOnEnd.checked,
          }
        : t,
    );
    api("/api/config", { body: { templates } })
      .then(() => toast("FreeShow guardado para la plantilla", "ok"))
      .catch(err => toast(err.message, "error"));
  });

  // ===== SALIDAS Y VISTA PREVIA =====
  const outputHost = $<HTMLSelectElement>("output-host");
  const outputWidth = $<HTMLInputElement>("output-width");
  const outputHeight = $<HTMLInputElement>("output-height");
  const outputStyle = $<HTMLSelectElement>("output-style");
  const urlProjection = $<HTMLInputElement>("url-projection");
  const urlOutput = $<HTMLInputElement>("url-output");
  const urlControl = $<HTMLInputElement>("url-control");
  const openProjection = $<HTMLAnchorElement>("open-projection");
  const openOutput = $<HTMLAnchorElement>("open-output");

  outputWidth.value = storageGet("output.width") ?? "1920";
  outputHeight.value = storageGet("output.height") ?? "1080";
  outputStyle.value = storageGet("output.style") ?? "outline";

  function updateOutputUrls() {
    const base = `${location.protocol}//${outputHost.value || location.host}`;
    const params = new URLSearchParams({ ancho: outputWidth.value || "1920", alto: outputHeight.value || "1080" });
    if (outputStyle.value === "flat") params.set("estilo", "plano");
    if (outputStyle.value === "background") params.set("fondo", "1");
    urlProjection.value = `${base}/?view=projection`;
    urlOutput.value = `${base}/salida?${params}`;
    urlControl.value = `${base}/?view=control`;
    openProjection.href = urlProjection.value;
    openOutput.href = outputStyle.value === "background" ? urlOutput.value : `${urlOutput.value}&vista=1`;
    storageSet("output.width", outputWidth.value);
    storageSet("output.height", outputHeight.value);
    storageSet("output.style", outputStyle.value);
    storageSet("output.host", outputHost.value);
  }
  for (const el of [outputHost, outputWidth, outputHeight, outputStyle]) {
    el.addEventListener("input", updateOutputUrls);
    el.addEventListener("change", updateOutputUrls);
  }

  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const input = $<HTMLInputElement>(btn.dataset.copy!);
      toast((await copyText(input.value, input)) ? "Copiado" : "No se pudo copiar: seleccioná el texto", "ok", 1500);
    });
  });

  function setHostOptions(urls: string[]) {
    const hosts = [location.host, ...urls.map(u => new URL(u).host)].filter((h, i, all) => all.indexOf(h) === i);
    const saved = storageGet("output.host");
    outputHost.innerHTML = hosts
      .map(h => `<option value="${escapeHtml(h)}">${escapeHtml(h)}${h === location.host ? " (este navegador)" : ""}</option>`)
      .join("");
    if (saved && hosts.includes(saved)) outputHost.value = saved;
    updateOutputUrls();
  }
  setHostOptions([]);
  api<{ urls: string[] }>("/api/info").then(info => setHostOptions(info.urls)).catch(() => {});

  $<HTMLIFrameElement>("preview-frame").src = "/?view=projection&preview=1";

  // ===== ARCHIVOS SUBIDOS =====
  const uploadsList = $("uploads-list");

  async function loadUploads() {
    try {
      renderUploads(await api<string[]>("/api/uploads"));
    } catch {}
  }

  function renderUploads(files: string[]) {
    uploadsList.innerHTML = files.length
      ? files.map(f => `
        <div class="list-item upload-item">
          <img class="upload-thumb" src="${escapeHtml(f)}" alt="" loading="lazy">
          <span class="list-text">${escapeHtml(f.replace("/uploads/", ""))}</span>
          <span class="upload-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-use-logo="${escapeHtml(f)}">Logo</button>
            <button type="button" class="btn btn-secondary btn-sm" data-use-bg="${escapeHtml(f)}">Fondo</button>
            <button type="button" class="btn btn-ghost btn-sm" data-delete-upload="${escapeHtml(f)}" aria-label="Eliminar">🗑</button>
          </span>
        </div>`).join("")
      : `<p class="empty">No hay archivos subidos</p>`;
  }

  uploadsList.addEventListener("click", e => {
    const target = e.target as HTMLElement;
    const logo = target.closest<HTMLElement>("[data-use-logo]")?.dataset.useLogo;
    const bg = target.closest<HTMLElement>("[data-use-bg]")?.dataset.useBg;
    const del = target.closest<HTMLElement>("[data-delete-upload]")?.dataset.deleteUpload;
    if (logo) patchState({ logo }).then(() => toast("Logo actualizado", "ok", 1500));
    if (bg) patchState({ background: { type: "image", value: bg } }).then(() => toast("Fondo actualizado", "ok", 1500));
    if (del && confirm(`¿Eliminar ${del.replace("/uploads/", "")}?`)) {
      api(`/api/uploads/${encodeURIComponent(del.replace("/uploads/", ""))}`, { method: "DELETE" })
        .then(loadUploads)
        .catch(err => toast(err.message, "error"));
    }
  });

  // ===== APLICAR ESTADO / CONFIG A LA INTERFAZ =====
  function applyState(s: AppState) {
    state = s;

    modeDuration.checked = s.mode === "duration";
    modeUntil.checked = s.mode === "until";
    durationInputs.hidden = s.mode !== "duration";
    untilInputs.hidden = s.mode !== "until";
    setValueIfIdle(inputDuration, minutesText(s.durationMs));
    if (s.targetTime !== null) setValueIfIdle(inputUntil, formatHHMM(s.targetTime));
    durationChips.querySelectorAll<HTMLElement>("[data-minutes]").forEach(chip => {
      chip.classList.toggle("active", s.mode === "duration" && Number(chip.dataset.minutes) * 60000 === s.durationMs);
    });

    const adjust = s.adjustMs ? ` (${s.adjustMs > 0 ? "+" : "−"}${minutesText(Math.abs(s.adjustMs))})` : "";
    const timeInfo = (s.mode === "duration"
      ? `Duración ${minutesText(s.durationMs)} min`
      : s.targetTime !== null ? `Hasta las ${formatHHMM(s.targetTime)}` : "Falta la hora") + adjust;
    liveMeta.textContent = s.activeTemplate ? `${timeInfo} · ${s.activeTemplate}` : timeInfo;

    setValueIfIdle(inputTextTop, s.textTop);
    setValueIfIdle(inputTextBottom, s.textBottom);
    setValueIfIdle(inputMessageZero, s.messageAtZero);

    bgColorRadio.checked = s.background.type === "color";
    bgGradientRadio.checked = s.background.type === "gradient";
    bgImageRadio.checked = s.background.type === "image";
    showBgInputs(s.background.type);
    if (s.background.type === "color") setValueIfIdle(inputBgColor, s.background.value);
    if (s.background.type === "gradient") setValueIfIdle(inputBgGradient, s.background.value);
    renderPreview(bgImagePreview, s.background.type === "image" ? s.background.value : null, () =>
      patchState({ background: { type: "color", value: inputBgColor.value || "#0a0a0f" } }));
    renderPreview(logoPreview, s.logo, () => patchState({ logo: null }));
    setValueIfIdle(inputBgAnimation, s.backgroundAnimation);

    renderAnnouncements(s.announcements);
    setValueIfIdle(inputAnnouncementInterval, String(s.announcementInterval));

    setValueIfIdle(inputAlertYellow, minutesText(s.alertThresholds.yellow));
    setValueIfIdle(inputAlertRed, minutesText(s.alertThresholds.red));

    renderTemplates();
    lastLive = "";
    renderLive();
  }

  function applyConfig(c: AppConfig) {
    config = c;
    renderTemplates();
    renderFreeShowTemplates();
    applyIntegrationConfig(c);
  }

  conn.onState(applyState);
  api<AppConfig>("/api/config").then(applyConfig).catch(err => toast(`No se pudo cargar la configuración: ${err.message}`, "error"));
  loadUploads();
}
