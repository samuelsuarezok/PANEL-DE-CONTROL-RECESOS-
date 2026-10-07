/**
 * Persistencia de datos - Receso
 * Escritura atómica (temp + rename) en la carpeta data/ al lado del ejecutable.
 * Valida todo lo que se lee de disco o llega por la API, completando con valores por defecto.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from "fs";
import { join, dirname, basename, extname, resolve } from "path";
import type {
  AppState, AppConfig, Template, AlertThresholds, Announcement, BackgroundConfig,
  FreeShowConfig, ProPresenterConfig, ResolumeConfig, CountMode,
} from "../types/index.js";

// ===== RUTAS =====
// En el ejecutable compilado los datos van al lado del binario (no del cwd: en macOS,
// al hacer doble clic el cwd es la carpeta de usuario). En desarrollo, en la raíz del proyecto.
const IS_COMPILED =
  import.meta.path.includes("$bunfs") ||
  import.meta.path.includes("~BUN") ||
  !/^bun(-debug)?(\.exe)?$/i.test(basename(process.execPath));

const DATA_DIR = process.env.RECESO_DATA_DIR
  ? resolve(process.env.RECESO_DATA_DIR)
  : join(IS_COMPILED ? dirname(process.execPath) : process.cwd(), "data");
const UPLOADS_DIR = join(DATA_DIR, "uploads");
const STATE_FILE = join(DATA_DIR, "state.json");
const CONFIG_FILE = join(DATA_DIR, "config.json");

// ===== VALORES POR DEFECTO =====
export const DEFAULT_STATE: AppState = {
  mode: "duration",
  targetTime: null,
  durationMs: 900000,
  startedAt: null,
  pausedAt: null,
  pausedElapsedMs: 0,
  adjustMs: 0,
  textTop: "Volvemos en",
  textBottom: "Próxima sesión",
  messageAtZero: "Estamos por comenzar",
  logo: null,
  background: { type: "color", value: "#0a0a0f" },
  backgroundAnimation: "none",
  announcements: [],
  announcementInterval: 15,
  alertThresholds: { yellow: 300000, red: 60000 },
  activeTemplate: null,
};

export const DEFAULT_CONFIG: AppConfig = {
  port: 3004,
  templates: [
    { name: "Almuerzo 60 min", mode: "duration", durationMs: 3600000, textTop: "Almuerzo", textBottom: "Volvemos a las 14:00" },
    { name: "Café 20 min", mode: "duration", durationMs: 1200000, textTop: "Receso", textBottom: "Café en el foyer" },
    { name: "Culto 19:00", mode: "until", targetTime: "19:00", textTop: "Próximo culto", textBottom: "Santuario principal" },
  ],
  alertThresholds: { yellow: 300000, red: 60000 },
  freeshow: { enabled: false, host: "localhost", port: 5506, token: "" },
  propresenter: { enabled: false, host: "localhost", port: 50001, timer: "", message: "", clearMessageOnEnd: true },
  resolume: {
    enabled: false,
    protocol: "rest",
    host: "localhost",
    restPort: 8080,
    oscPort: 7000,
    layer: 1,
    clip: 1,
    textFormat: "{tiempo}",
    oscSource: "textblock",
    oscAddress: "",
    connectOnStart: false,
    clearOnReset: false,
  },
};

// ===== VALIDACIÓN =====
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string, max = 300): string =>
  typeof v === "string" ? v.slice(0, max) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const int = (v: unknown, fallback: number, min: number, max: number): number =>
  Math.round(num(v, fallback, min, max));
const epochOrNull = (v: unknown, fallback: number | null): number | null =>
  v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : fallback;
const isUploadPath = (v: unknown): v is string =>
  typeof v === "string" && /^\/uploads\/[A-Za-z0-9._-]+$/.test(v);
const mode = (v: unknown, fallback: CountMode): CountMode =>
  v === "duration" || v === "until" ? v : fallback;

const MAX_DURATION_MS = 24 * 3600_000;

function normalizeThresholds(v: unknown, fallback: AlertThresholds): AlertThresholds {
  if (!isObj(v)) return { ...fallback };
  return {
    yellow: num(v.yellow, fallback.yellow, 0, MAX_DURATION_MS),
    red: num(v.red, fallback.red, 0, MAX_DURATION_MS),
  };
}

function normalizeBackground(v: unknown, fallback: BackgroundConfig): BackgroundConfig {
  if (!isObj(v)) return { ...fallback };
  const type = v.type === "color" || v.type === "gradient" || v.type === "image" ? v.type : fallback.type;
  const value = str(v.value, fallback.value, 2000);
  if (type === "color" && !/^#[0-9a-f]{3,8}$/i.test(value)) return { ...fallback };
  if (type === "image" && !isUploadPath(value)) return { ...fallback };
  return { type, value };
}

function normalizeAnnouncements(v: unknown, fallback: Announcement[]): Announcement[] {
  if (!Array.isArray(v)) return fallback.map(a => ({ ...a }));
  return v
    .filter(isObj)
    .map(a => ({ text: str(a.text, "", 300).trim(), duration: num(a.duration, 10, 1, 3600) }))
    .filter(a => a.text.length > 0)
    .slice(0, 50);
}

/** Valida un parche parcial de estado (solo copia campos conocidos y válidos) */
export function sanitizeStatePatch(patch: unknown, base: AppState = DEFAULT_STATE): Partial<AppState> {
  if (!isObj(patch)) return {};
  const out: Partial<AppState> = {};
  if ("mode" in patch) out.mode = mode(patch.mode, base.mode);
  if ("targetTime" in patch) out.targetTime = epochOrNull(patch.targetTime, base.targetTime);
  if ("durationMs" in patch) out.durationMs = num(patch.durationMs, base.durationMs, 0, MAX_DURATION_MS);
  if ("startedAt" in patch) out.startedAt = epochOrNull(patch.startedAt, base.startedAt);
  if ("pausedAt" in patch) out.pausedAt = epochOrNull(patch.pausedAt, base.pausedAt);
  if ("pausedElapsedMs" in patch) out.pausedElapsedMs = num(patch.pausedElapsedMs, base.pausedElapsedMs, 0);
  if ("adjustMs" in patch) out.adjustMs = num(patch.adjustMs, base.adjustMs, -MAX_DURATION_MS, MAX_DURATION_MS);
  if ("textTop" in patch) out.textTop = str(patch.textTop, base.textTop, 200);
  if ("textBottom" in patch) out.textBottom = str(patch.textBottom, base.textBottom, 300);
  if ("messageAtZero" in patch) out.messageAtZero = str(patch.messageAtZero, base.messageAtZero, 200);
  if ("logo" in patch) out.logo = patch.logo === null ? null : isUploadPath(patch.logo) ? patch.logo : base.logo;
  if ("background" in patch) out.background = normalizeBackground(patch.background, base.background);
  if ("backgroundAnimation" in patch) {
    const a = patch.backgroundAnimation;
    out.backgroundAnimation = a === "none" || a === "slow-zoom" || a === "subtle-shift" ? a : base.backgroundAnimation;
  }
  if ("announcements" in patch) out.announcements = normalizeAnnouncements(patch.announcements, base.announcements);
  if ("announcementInterval" in patch) out.announcementInterval = num(patch.announcementInterval, base.announcementInterval, 3, 3600);
  if ("alertThresholds" in patch) out.alertThresholds = normalizeThresholds(patch.alertThresholds, base.alertThresholds);
  if ("activeTemplate" in patch) {
    out.activeTemplate = patch.activeTemplate === null ? null : str(patch.activeTemplate, base.activeTemplate ?? "", 60) || null;
  }
  return out;
}

export function normalizeState(raw: unknown): AppState {
  return { ...DEFAULT_STATE, ...sanitizeStatePatch(raw, DEFAULT_STATE) };
}

export function normalizeTemplate(v: unknown): Template | null {
  if (!isObj(v)) return null;
  const name = str(v.name, "", 60).trim();
  if (!name) return null;
  const t: Template = {
    name,
    mode: mode(v.mode, "duration"),
    textTop: str(v.textTop, "", 200),
    textBottom: str(v.textBottom, "", 300),
  };
  if (t.mode === "duration") t.durationMs = num(v.durationMs, 900000, 0, MAX_DURATION_MS);
  else t.targetTime = typeof v.targetTime === "string" && /^\d{1,2}:\d{2}$/.test(v.targetTime) ? v.targetTime : "00:00";
  const timer = str(v.freeshowTimerName, "", 100).trim();
  const overlay = str(v.freeshowOverlayName, "", 100).trim();
  if (timer) t.freeshowTimerName = timer;
  if (overlay) t.freeshowOverlayName = overlay;
  if (v.freeshowClearOnEnd === true) t.freeshowClearOnEnd = true;
  return t;
}

function normalizeFreeShow(v: unknown, fb: FreeShowConfig): FreeShowConfig {
  if (!isObj(v)) return { ...fb };
  return {
    enabled: bool(v.enabled, fb.enabled),
    host: str(v.host, fb.host, 200).trim() || fb.host,
    port: int(v.port, fb.port, 1, 65535),
    token: str(v.token, fb.token, 300),
  };
}

function normalizeProPresenter(v: unknown, fb: ProPresenterConfig): ProPresenterConfig {
  if (!isObj(v)) return { ...fb };
  return {
    enabled: bool(v.enabled, fb.enabled),
    host: str(v.host, fb.host, 200).trim() || fb.host,
    port: int(v.port, fb.port, 1, 65535),
    timer: str(v.timer, fb.timer, 200).trim(),
    message: str(v.message, fb.message, 200).trim(),
    clearMessageOnEnd: bool(v.clearMessageOnEnd, fb.clearMessageOnEnd),
  };
}

function normalizeResolume(v: unknown, fb: ResolumeConfig): ResolumeConfig {
  if (!isObj(v)) return { ...fb };
  const oscSource = v.oscSource === "textblock" || v.oscSource === "textanimator" || v.oscSource === "custom" ? v.oscSource : fb.oscSource;
  return {
    enabled: bool(v.enabled, fb.enabled),
    protocol: v.protocol === "rest" || v.protocol === "osc" ? v.protocol : fb.protocol,
    host: str(v.host, fb.host, 200).trim() || fb.host,
    restPort: int(v.restPort, fb.restPort, 1, 65535),
    oscPort: int(v.oscPort, fb.oscPort, 1, 65535),
    layer: int(v.layer, fb.layer, 1, 999),
    clip: int(v.clip, fb.clip, 1, 999),
    textFormat: str(v.textFormat, fb.textFormat, 300) || "{tiempo}",
    oscSource,
    oscAddress: str(v.oscAddress, fb.oscAddress, 300).trim(),
    connectOnStart: bool(v.connectOnStart, fb.connectOnStart),
    clearOnReset: bool(v.clearOnReset, fb.clearOnReset),
  };
}

/** Valida un parche parcial de configuración */
export function sanitizeConfigPatch(patch: unknown, base: AppConfig = DEFAULT_CONFIG): Partial<AppConfig> {
  if (!isObj(patch)) return {};
  const out: Partial<AppConfig> = {};
  if ("port" in patch) out.port = int(patch.port, base.port, 1, 65535);
  if ("templates" in patch && Array.isArray(patch.templates)) {
    const seen = new Set<string>();
    out.templates = patch.templates
      .map(normalizeTemplate)
      .filter((t): t is Template => t !== null && !seen.has(t.name) && Boolean(seen.add(t.name)))
      .slice(0, 100);
  }
  if ("alertThresholds" in patch) out.alertThresholds = normalizeThresholds(patch.alertThresholds, base.alertThresholds);
  if ("freeshow" in patch) out.freeshow = normalizeFreeShow({ ...base.freeshow, ...(isObj(patch.freeshow) ? patch.freeshow : {}) }, base.freeshow);
  if ("propresenter" in patch) out.propresenter = normalizeProPresenter({ ...base.propresenter, ...(isObj(patch.propresenter) ? patch.propresenter : {}) }, base.propresenter);
  if ("resolume" in patch) out.resolume = normalizeResolume({ ...base.resolume, ...(isObj(patch.resolume) ? patch.resolume : {}) }, base.resolume);
  return out;
}

export function normalizeConfig(raw: unknown): AppConfig {
  const defaults = structuredClone(DEFAULT_CONFIG);
  // Migración: versiones anteriores usaban 5505 (puerto WebSocket de FreeShow);
  // la API REST de FreeShow escucha en 5506.
  if (isObj(raw) && isObj(raw.freeshow) && raw.freeshow.port === 5505) {
    raw = { ...raw, freeshow: { ...raw.freeshow, port: 5506 } };
  }
  return { ...defaults, ...sanitizeConfigPatch(raw, defaults) };
}

// ===== ARCHIVOS =====
/** Escritura atómica: escribe a .tmp y luego renombra */
function writeAtomic(filePath: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const tmpPath = `${filePath}.tmp`;
  try {
    writeFileSync(tmpPath, json, "utf-8");
    renameSync(tmpPath, filePath);
  } catch {
    // En Windows el antivirus puede bloquear el rename un instante: escribir directo
    try {
      writeFileSync(filePath, json, "utf-8");
    } catch (err) {
      console.error(`⚠️  No se pudo guardar ${basename(filePath)}:`, err);
    }
    try { unlinkSync(tmpPath); } catch {}
  }
}

/** Lectura segura: si el archivo está dañado se respalda y se usan valores por defecto */
function readJSON(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    const backup = `${filePath}.danado-${Date.now()}`;
    console.error(`⚠️  ${basename(filePath)} está dañado, se respalda en ${basename(backup)} y se usan valores por defecto`);
    try { renameSync(filePath, backup); } catch {}
    return undefined;
  }
}

/** Inicializa carpetas y archivos si no existen */
export function initDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!existsSync(STATE_FILE)) writeAtomic(STATE_FILE, DEFAULT_STATE);
  if (!existsSync(CONFIG_FILE)) writeAtomic(CONFIG_FILE, DEFAULT_CONFIG);
}

// ===== STATE =====
export function loadState(): AppState {
  return normalizeState(readJSON(STATE_FILE));
}

export function saveState(state: AppState): void {
  writeAtomic(STATE_FILE, state);
}

// ===== CONFIG (en memoria + disco) =====
let configCache: AppConfig | null = null;
const configListeners = new Set<(config: AppConfig) => void>();

export function getConfig(): AppConfig {
  if (!configCache) configCache = normalizeConfig(readJSON(CONFIG_FILE));
  return configCache;
}

/** Aplica un parche validado, guarda y notifica */
export function updateConfig(patch: unknown): AppConfig {
  const current = getConfig();
  const clean = sanitizeConfigPatch(patch, current);
  configCache = { ...current, ...clean };
  writeAtomic(CONFIG_FILE, configCache);
  for (const listener of configListeners) {
    try { listener(configCache); } catch (err) { console.error("Error en listener de config:", err); }
  }
  return configCache;
}

export function onConfigChange(listener: (config: AppConfig) => void): () => void {
  configListeners.add(listener);
  return () => configListeners.delete(listener);
}

// ===== PLANTILLAS =====
export function saveTemplate(raw: unknown): AppConfig {
  const template = normalizeTemplate(raw);
  if (!template) throw new Error("Plantilla inválida");
  const templates = [...getConfig().templates];
  const idx = templates.findIndex(t => t.name === template.name);
  if (idx >= 0) {
    // Conservar la configuración FreeShow si la plantilla se sobrescribe
    const prev = templates[idx]!;
    templates[idx] = {
      ...template,
      freeshowTimerName: template.freeshowTimerName ?? prev.freeshowTimerName,
      freeshowOverlayName: template.freeshowOverlayName ?? prev.freeshowOverlayName,
      freeshowClearOnEnd: template.freeshowClearOnEnd ?? prev.freeshowClearOnEnd,
    };
  } else {
    templates.push(template);
  }
  return updateConfig({ templates });
}

export function deleteTemplate(name: string): AppConfig {
  return updateConfig({ templates: getConfig().templates.filter(t => t.name !== name) });
}

// ===== UPLOADS =====
const UPLOAD_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Guarda archivo subido y devuelve ruta relativa /uploads/xxx.ext */
export function saveUpload(fileName: string, data: Uint8Array): string {
  const ext = extname(fileName).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error("Formato no permitido. Usá PNG, JPG, GIF, WEBP, AVIF o SVG.");
  }
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new Error("El archivo supera 25 MB.");
  const base = basename(fileName, extname(fileName)).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "archivo";
  const finalName = `${base}_${Date.now()}${ext}`;
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
  writeFileSync(join(UPLOADS_DIR, finalName), data);
  return `/uploads/${finalName}`;
}

/** Ruta absoluta segura dentro de uploads/ (o null si el nombre no es válido) */
export function resolveUploadPath(name: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(name); } catch { return null; }
  const clean = basename(decoded.replace(/^\/?uploads\//, ""));
  if (!clean || clean.startsWith(".") || !/^[A-Za-z0-9._-]+$/.test(clean)) return null;
  return join(UPLOADS_DIR, clean);
}

export function listUploads(): string[] {
  if (!existsSync(UPLOADS_DIR)) return [];
  return readdirSync(UPLOADS_DIR)
    .filter(f => !f.startsWith(".") && UPLOAD_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort()
    .map(f => `/uploads/${f}`);
}

export function deleteUpload(name: string): boolean {
  const filePath = resolveUploadPath(name);
  if (!filePath || !existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ===== UTILIDADES =====
export function getDataDir(): string { return DATA_DIR; }
export function getUploadsDir(): string { return UPLOADS_DIR; }
export function isCompiledBinary(): boolean { return IS_COMPILED; }
