/**
 * Tipos compartidos - Receso
 * Definiciones de estado, configuración, integraciones y mensajes WebSocket
 */

// ===== ESTADO PRINCIPAL =====
export type CountMode = "until" | "duration";

export interface BackgroundConfig {
  type: "color" | "gradient" | "image";
  value: string; // hex, gradient CSS, o ruta /uploads/xxx.jpg
}

export type BackgroundAnimation = "none" | "slow-zoom" | "subtle-shift";

export interface Announcement {
  text: string;
  duration: number; // segundos que se muestra
}

export interface AlertThresholds {
  yellow: number; // ms (ej. 300000 = 5 min)
  red: number;    // ms (ej. 60000 = 1 min)
}

/**
 * Estado de la cuenta. La fase se deriva de startedAt/pausedAt:
 * - detenido: startedAt === null
 * - en curso: startedAt !== null && pausedAt === null
 * - pausado:  startedAt !== null && pausedAt !== null
 */
export interface AppState {
  mode: CountMode;
  targetTime: number | null;      // epoch ms (mode=until)
  durationMs: number;             // ms (mode=duration)
  startedAt: number | null;       // cuándo se inició
  pausedAt: number | null;        // epoch ms si pausado
  pausedElapsedMs: number;        // tiempo total que estuvo pausado
  adjustMs: number;               // ±min sumados durante el receso (Reiniciar los descarta)
  textTop: string;
  textBottom: string;
  messageAtZero: string;          // vacío = mostrar 00:00
  logo: string | null;            // ruta relativa /uploads/logo.png
  background: BackgroundConfig;
  backgroundAnimation: BackgroundAnimation;
  announcements: Announcement[];
  announcementInterval: number;   // segundos entre rotación
  alertThresholds: AlertThresholds;
  activeTemplate: string | null;  // plantilla aplicada (para integraciones)
}

// ===== CONFIGURACIÓN PERSISTENTE =====
export interface Template {
  name: string;
  mode: CountMode;
  durationMs?: number;      // para mode=duration
  targetTime?: string;      // "HH:MM" para mode=until
  textTop: string;
  textBottom: string;
  // FreeShow (opcional, por plantilla)
  freeshowTimerName?: string;    // nombre del timer en FreeShow (name_start_timer)
  freeshowOverlayName?: string;  // nombre del overlay en FreeShow (name_select_overlay)
  freeshowClearOnEnd?: boolean;  // limpiar overlays al terminar (clear_overlays)
}

export interface FreeShowConfig {
  enabled: boolean;
  host: string;       // IP o hostname (ej. "localhost" o "192.168.1.50")
  port: number;       // puerto REST de la API (por defecto 5506)
  token: string;      // token de autenticación (si está configurado en FreeShow)
}

export interface ProPresenterConfig {
  enabled: boolean;
  host: string;            // IP de la PC con ProPresenter
  port: number;            // puerto de Preferencias → Red
  timer: string;           // timer a sincronizar (nombre, UUID o índice). Vacío = no usar
  message: string;         // mensaje a mostrar al iniciar (nombre, UUID o índice). Vacío = no usar
  clearMessageOnEnd: boolean; // ocultar el mensaje al llegar a cero / reiniciar
}

export type ResolumeOscSource = "textblock" | "textanimator" | "custom";

export interface ResolumeConfig {
  enabled: boolean;
  protocol: "rest" | "osc";   // REST (Arena/Avenue 7+) u OSC (Arena 6 y 7)
  host: string;
  restPort: number;           // Preferencias → Webserver (por defecto 8080)
  oscPort: number;            // Preferencias → OSC → Input port (por defecto 7000)
  layer: number;              // capa del clip con la fuente de texto (1 = abajo)
  clip: number;               // columna del clip
  textFormat: string;         // tokens: {tiempo} {arriba} {abajo}; "\n" = salto de línea
  oscSource: ResolumeOscSource;
  oscAddress: string;         // solo si oscSource = "custom"
  connectOnStart: boolean;    // disparar el clip al iniciar
  clearOnReset: boolean;      // limpiar la capa al reiniciar
}

export interface AppConfig {
  port: number;
  templates: Template[];
  alertThresholds: AlertThresholds;
  freeshow: FreeShowConfig;
  propresenter: ProPresenterConfig;
  resolume: ResolumeConfig;
}

// ===== INTEGRACIONES =====
export type IntegrationName = "propresenter" | "resolume" | "freeshow";

export interface IntegrationStatus {
  enabled: boolean;
  state: "off" | "ok" | "error" | "unknown";
  message: string;
  at: number; // epoch ms del último cambio
}

export type IntegrationsStatus = Record<IntegrationName, IntegrationStatus>;

export interface TestResult {
  ok: boolean;
  message: string;
  timers?: string[];
  messages?: string[];
}

// ===== WEBSOCKET =====
export type ClientRole = "control" | "projection" | "output" | "preview";

export interface Presence {
  control: number;
  projection: number;
  output: number;
}

export type ControlAction =
  | { action: "start" }
  | { action: "pause" }
  | { action: "toggle" }
  | { action: "reset" }
  | { action: "add_minutes"; value?: number }
  | { action: "subtract_minutes"; value?: number }
  | { action: "set_duration"; minutes: number }
  | { action: "set_until"; time: string }           // "HH:MM"
  | { action: "set_mode"; mode: CountMode }
  | { action: "apply_template"; templateName: string };

/** Servidor → cliente */
export type ServerMessage =
  | { type: "sync"; state: AppState; serverTime: number; presence: Presence; integrations: IntegrationsStatus }
  | { type: "state"; state: AppState; serverTime: number }
  | { type: "pong"; t0: number; serverTime: number }
  | { type: "presence"; presence: Presence }
  | { type: "integrations"; integrations: IntegrationsStatus }
  | { type: "config"; config: AppConfig }
  | { type: "notice"; level: "info" | "error"; message: string };

/** Cliente → servidor */
export type ClientMessage =
  | { type: "hello"; role: ClientRole }
  | { type: "ping"; t0: number }
  | { type: "control"; action: ControlAction };

// ===== API REST =====
export interface APIResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface UploadResponse {
  url: string; // /uploads/filename.ext
}

export interface ServerInfo {
  name: string;
  version: string;
  port: number;
  urls: string[];           // http://IP:PORT
  localIPs: string[];
}
