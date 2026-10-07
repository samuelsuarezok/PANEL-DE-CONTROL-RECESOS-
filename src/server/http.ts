/**
 * Servidor HTTP - Receso
 * Archivos del frontend (embebidos en el ejecutable), API REST, página /conectar y uploads.
 */

import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import type { APIResponse, AppState, ServerInfo, UploadResponse } from "../types/index.js";
import {
  initDataDir, getConfig, updateConfig, saveTemplate, deleteTemplate,
  saveUpload, listUploads, deleteUpload, resolveUploadPath, getDataDir, MAX_UPLOAD_BYTES,
} from "./data.js";
import { getLocalIPv4s, generateURLs, formatServerInfo } from "./network.js";
import { generateQRASCII, generateQRCodeSVG } from "./qr.js";
import { wsHandlers, getPresence, type WsData } from "./ws.js";
import { getState, dispatch, patchState } from "./engine.js";
import { getIntegrationsStatus } from "./integrations/common.js";
import { testIntegration, isIntegrationName } from "./integrations/index.js";
import { getDisplay } from "../shared/time.js";
import { assets, BUILD_ID } from "../frontend/embed.js";
import { VERSION } from "../version.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

const json = (data: APIResponse, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

/** Sirve un archivo embebido con ETag (revalida siempre: nunca quedan versiones viejas en caché) */
function serveAsset(name: string, req: Request): Response | null {
  const asset = assets[name];
  if (!asset) return null;
  const etag = `"${BUILD_ID}"`;
  const headers = { "Content-Type": asset.type, "Cache-Control": "no-cache", ETag: etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(asset.body, { headers });
}

function serverInfo(port: number): ServerInfo {
  const ips = getLocalIPv4s();
  return { name: "Receso", version: VERSION, port, urls: generateURLs(ips, port), localIPs: ips };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Página /conectar: QR grande y todas las URLs */
async function generateConnectPage(port: number): Promise<string> {
  const info = serverInfo(port);
  const base = info.urls[0] ?? `http://localhost:${port}`;
  const controlUrl = `${base}/?view=control`;
  const qrSVG = await generateQRCodeSVG(controlUrl);
  const links = [
    ["🎛️ Panel de control", `${base}/?view=control`],
    ["🖥️ Proyección (pantalla completa)", `${base}/?view=projection`],
    ["🎬 Proyección transparente (OBS)", `${base}/proyeccion?transparente=1`],
    ["📺 Salida NDI / OBS (1920×1080)", `${base}/salida?ancho=1920&alto=1080`],
  ];
  const ipsHtml = info.urls.length
    ? info.urls.map(u => `<li><code>${escapeHtml(u)}</code></li>`).join("")
    : `<li><em>No se detectaron IPs de red: conectá el WiFi o el cable</em></li>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>Conectar - Receso</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0a0a0f; color: #e8e8e8; min-height: 100vh; display: flex; justify-content: center; padding: 2rem 1rem; }
    .card { background: #14141a; border: 1px solid #2a2a3a; border-radius: 16px; padding: 2rem; max-width: 520px; width: 100%; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    h1 { font-size: 1.6rem; margin-bottom: 0.4rem; color: #fff; }
    .subtitle { color: #9a9aa8; margin-bottom: 1.5rem; }
    .qr { margin: 0 auto 1rem; width: 240px; height: 240px; background: #fff; border-radius: 12px; padding: 10px; }
    .qr svg { width: 100%; height: 100%; display: block; }
    .url { background: #1e1e2a; border: 1px solid #333; border-radius: 8px; padding: 0.8rem; margin: 1rem 0; word-break: break-all; font-family: ui-monospace, Menlo, Consolas, monospace; color: #4ade80; }
    .ips { text-align: left; margin: 1.25rem 0; padding: 1rem; background: #1e1e2a; border-radius: 8px; }
    .ips h3 { font-size: 0.85rem; color: #9a9aa8; margin-bottom: 0.5rem; font-weight: 600; }
    .ips ul { list-style: none; }
    .ips li { padding: 0.2rem 0; font-size: 0.9rem; }
    .links { display: grid; gap: 0.6rem; margin-top: 1.25rem; }
    .btn { display: block; background: #2563eb; color: #fff; border-radius: 10px; padding: 0.85rem 1rem; text-decoration: none; font-weight: 600; }
    .btn.secondary { background: #262633; border: 1px solid #333; }
    .note { background: #22190f; border: 1px solid #5a4422; border-radius: 8px; padding: 0.9rem; margin-top: 1.25rem; text-align: left; font-size: 0.85rem; color: #f5d6a0; line-height: 1.5; }
    .footer { margin-top: 1.5rem; font-size: 0.75rem; color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📱 Conectar dispositivos</h1>
    <p class="subtitle">Escaneá el QR con el celular para abrir el panel de control</p>
    <div class="qr">${qrSVG}</div>
    <div class="url">${escapeHtml(controlUrl)}</div>
    <div class="links">
      ${links.map(([label, href], i) => `<a href="${escapeHtml(href!)}" class="btn${i ? " secondary" : ""}" target="_blank" rel="noopener">${label}</a>`).join("\n      ")}
    </div>
    <div class="ips">
      <h3>Todas las direcciones de esta PC:</h3>
      <ul>${ipsHtml}</ul>
    </div>
    <div class="note">
      <strong>¿No conecta desde el celular?</strong> Tienen que estar en la misma red WiFi.
      En Windows, si aparece el aviso del Firewall, marcá <strong>Redes privadas</strong> y permití el acceso.
      Algunas redes de hoteles/venues aíslan los dispositivos: usá un router propio o el hotspot del celular.
    </div>
    <p class="footer">Receso v${VERSION} · datos en ${escapeHtml(getDataDir())}</p>
  </div>
</body>
</html>`;
}

/** Maneja endpoints de API REST */
async function handleAPI(req: Request, pathname: string, port: number): Promise<Response> {
  const method = req.method;
  const readJson = async (): Promise<unknown> => {
    try {
      return await req.json();
    } catch {
      throw new BadRequest("El cuerpo de la petición no es JSON válido");
    }
  };

  try {
    // ===== ESTADO =====
    if (pathname === "/api/state" && method === "GET") {
      const state = getState();
      const now = Date.now();
      const display = getDisplay(state, now);
      return json({
        ok: true,
        data: {
          ...state,
          running: display.phase === "running",
          display,
          serverTime: now,
          timeRemaining: { totalMs: display.remainingMs, formatted: display.clock, alertLevel: display.alert, isNegative: display.atZero },
        },
      });
    }

    // Versión compacta para Companion / Stream Deck / scripts
    if (pathname === "/api/display" && method === "GET") {
      const d = getDisplay(getState(), Date.now());
      return json({ ok: true, data: { text: d.text, clock: d.clock, phase: d.phase, alert: d.alert, atZero: d.atZero, remainingMs: d.remainingMs } });
    }

    if (pathname === "/api/state" && method === "POST") {
      return json({ ok: true, data: patchState(await readJson()) });
    }

    if (pathname === "/api/control" && method === "POST") {
      const result = dispatch(await readJson());
      return json({ ok: result.ok, error: result.error, data: getState() }, result.ok ? 200 : 400);
    }

    // ===== CONFIGURACIÓN =====
    if (pathname === "/api/config" && method === "GET") {
      return json({ ok: true, data: getConfig() });
    }

    if (pathname === "/api/config" && method === "POST") {
      const body = await readJson();
      const config = updateConfig(body);
      if (body && typeof body === "object" && "alertThresholds" in body) {
        patchState({ alertThresholds: config.alertThresholds });
      }
      return json({ ok: true, data: config });
    }

    if (pathname === "/api/info" && method === "GET") {
      return json({ ok: true, data: { ...serverInfo(port), presence: getPresence(), dataDir: getDataDir() } });
    }

    // ===== PLANTILLAS =====
    if (pathname === "/api/templates" && method === "POST") {
      return json({ ok: true, data: saveTemplate(await readJson()).templates });
    }

    if (pathname.startsWith("/api/templates/") && method === "DELETE") {
      const name = decodeURIComponent(pathname.slice("/api/templates/".length));
      return json({ ok: true, data: deleteTemplate(name).templates });
    }

    // ===== ARCHIVOS =====
    if (pathname === "/api/upload" && method === "POST") {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) return json({ ok: false, error: "Archivo requerido" }, 400);
      if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, error: "El archivo supera 25 MB" }, 413);
      const url = saveUpload(file.name, new Uint8Array(await file.arrayBuffer()));
      return json({ ok: true, data: { url } satisfies UploadResponse });
    }

    if (pathname === "/api/uploads" && method === "GET") {
      return json({ ok: true, data: listUploads() });
    }

    if (pathname.startsWith("/api/uploads/") && method === "DELETE") {
      const name = pathname.slice("/api/uploads/".length);
      const filePath = resolveUploadPath(name);
      if (!filePath) return json({ ok: false, error: "Nombre de archivo inválido" }, 400);
      const deleted = deleteUpload(name);
      // Si era el logo o el fondo en uso, dejar de usarlo
      const url = `/uploads/${filePath.split(/[\\/]/).pop()}`;
      const state = getState();
      const patch: Partial<AppState> = {};
      if (state.logo === url) patch.logo = null;
      if (state.background.type === "image" && state.background.value === url) {
        patch.background = { type: "color", value: "#0a0a0f" };
      }
      if (Object.keys(patch).length) patchState(patch);
      return json({ ok: deleted, data: { deleted }, error: deleted ? undefined : "No se encontró el archivo" }, deleted ? 200 : 404);
    }

    // ===== INTEGRACIONES =====
    if (pathname === "/api/integrations" && method === "GET") {
      const c = getConfig();
      return json({ ok: true, data: { status: getIntegrationsStatus(), propresenter: c.propresenter, resolume: c.resolume, freeshow: c.freeshow } });
    }

    const integrationMatch = /^\/api\/integrations\/([a-z]+)\/(config|test)$/.exec(pathname);
    if (integrationMatch && method === "POST") {
      const [, name, op] = integrationMatch;
      if (!name || !isIntegrationName(name)) return json({ ok: false, error: "Integración desconocida" }, 404);
      if (op === "config") {
        const config = updateConfig({ [name]: await readJson() });
        return json({ ok: true, data: config[name] });
      }
      const result = await testIntegration(name);
      return json({ ok: result.ok, data: result, error: result.ok ? undefined : result.message });
    }

    return json({ ok: false, error: "Endpoint no encontrado" }, 404);
  } catch (err) {
    if (err instanceof BadRequest) return json({ ok: false, error: err.message }, 400);
    if (err instanceof Error && /Formato no permitido|supera|Plantilla inválida/.test(err.message)) {
      return json({ ok: false, error: err.message }, 400);
    }
    console.error("Error API:", err);
    return json({ ok: false, error: "Error interno del servidor" }, 500);
  }
}

class BadRequest extends Error {}

/** Crea el handler principal de Bun.serve */
function createFetchHandler(port: number) {
  return async (req: Request, server: Bun.Server<WsData>): Promise<Response | undefined> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // ===== WebSocket =====
    if (pathname === "/ws") {
      if (server.upgrade(req, { data: { role: null } })) return undefined;
      return new Response("Se esperaba una conexión WebSocket", { status: 400 });
    }

    // ===== API REST =====
    if (pathname.startsWith("/api/")) return handleAPI(req, pathname, port);

    // ===== Página /conectar =====
    if (pathname === "/conectar") {
      return new Response(await generateConnectPage(port), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // ===== Archivos subidos =====
    if (pathname.startsWith("/uploads/")) {
      const filePath = resolveUploadPath(pathname.slice("/uploads/".length));
      if (filePath && existsSync(filePath)) {
        return new Response(readFileSync(filePath), {
          headers: {
            "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            // Un SVG abierto directamente no puede ejecutar scripts
            "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
          },
        });
      }
      return new Response("No encontrado", { status: 404 });
    }

    // ===== Archivos del frontend =====
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    const asset = serveAsset(pathname.slice(1), req);
    if (asset) return asset;

    // ===== Vistas (/, /proyeccion, /salida, /?view=...) =====
    if (!extname(pathname)) {
      const page = serveAsset("index.html", req);
      if (page) return page;
    }

    return new Response("No encontrado", { status: 404 });
  };
}

/** Inicia el servidor HTTP + WS probando puertos libres desde el configurado */
export async function startServer(startPort = 3004): Promise<{ port: number; stop: () => void }> {
  initDataDir();

  let server: Bun.Server<WsData> | null = null;
  let port = startPort;
  for (; port < startPort + 20; port++) {
    try {
      server = Bun.serve<WsData>({
        port,
        hostname: "0.0.0.0",
        fetch: createFetchHandler(port),
        websocket: wsHandlers,
        maxRequestBodySize: MAX_UPLOAD_BYTES + 1024 * 1024,
        error(err) {
          console.error("Error HTTP:", err);
          return new Response("Error interno", { status: 500 });
        },
      });
      break;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "EADDRINUSE" && !/in use|EADDRINUSE/i.test(String(err))) throw err;
      console.log(`⚠️  Puerto ${port} ocupado, probando ${port + 1}...`);
    }
  }
  if (!server) throw new Error(`No se encontró un puerto libre entre ${startPort} y ${startPort + 19}`);

  const info = serverInfo(port);
  console.log(formatServerInfo(info));
  const qrTarget = `${info.urls[0] ?? `http://localhost:${port}`}/?view=control`;
  console.log(await generateQRASCII(qrTarget));
  console.log(`📷 El QR abre el panel de control: ${qrTarget}`);
  console.log(`💡 Abrí http://localhost:${port}/conectar para ver el QR grande y todas las URLs`);
  console.log(`💾 Datos en: ${getDataDir()}\n`);

  const running = server;
  return { port, stop: () => running.stop(true) };
}
