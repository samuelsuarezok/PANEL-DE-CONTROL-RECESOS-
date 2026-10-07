/**
 * Servidor WebSocket - Receso
 * Difunde el estado a todas las pantallas, responde pings para sincronizar relojes
 * y recibe acciones de control. Los clientes calculan el tiempo localmente,
 * así que solo se envía un mensaje cuando algo cambia (no 5 veces por segundo).
 */

import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { ClientMessage, ClientRole, Presence, ServerMessage } from "../types/index.js";
import { getState, dispatch, onEngineEvent } from "./engine.js";
import { onConfigChange } from "./data.js";
import { getIntegrationsStatus, onStatusChange } from "./integrations/common.js";

export interface WsData {
  role: ClientRole | null;
}

const clients = new Set<ServerWebSocket<WsData>>();
const ROLES: ClientRole[] = ["control", "projection", "output", "preview"];

function send(ws: ServerWebSocket<WsData>, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {}
}

function broadcast(message: ServerMessage, onlyRole?: ClientRole): void {
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (onlyRole && ws.data.role !== onlyRole) continue;
    try {
      ws.send(data);
    } catch {}
  }
}

export function getPresence(): Presence {
  const presence: Presence = { control: 0, projection: 0, output: 0 };
  for (const ws of clients) {
    const role = ws.data.role;
    if (role === "control" || role === "projection" || role === "output") presence[role]++;
  }
  return presence;
}

function broadcastPresence(): void {
  broadcast({ type: "presence", presence: getPresence() }, "control");
}

// Cambios de estado → todas las pantallas
onEngineEvent(event => {
  if (event.type === "state") broadcast({ type: "state", state: event.state, serverTime: event.now });
});
// Estado de integraciones y configuración → solo paneles de control
onStatusChange(integrations => broadcast({ type: "integrations", integrations }, "control"));
onConfigChange(config => broadcast({ type: "config", config }, "control"));

export const wsHandlers: WebSocketHandler<WsData> = {
  open(ws) {
    clients.add(ws);
    send(ws, {
      type: "sync",
      state: getState(),
      serverTime: Date.now(),
      presence: getPresence(),
      integrations: getIntegrationsStatus(),
    });
  },

  message(ws, raw) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    switch (msg?.type) {
      case "ping":
        send(ws, { type: "pong", t0: Number(msg.t0) || 0, serverTime: Date.now() });
        break;
      case "hello":
        if (ROLES.includes(msg.role)) {
          const isNew = ws.data.role === null;
          ws.data.role = msg.role;
          if (isNew && msg.role !== "preview") {
            console.log(`🔗 Conectado: ${roleLabel(msg.role)} (${clients.size} en total)`);
          }
          broadcastPresence();
        }
        break;
      case "control": {
        const result = dispatch(msg.action);
        if (!result.ok && result.error) send(ws, { type: "notice", level: "error", message: result.error });
        break;
      }
    }
  },

  close(ws) {
    clients.delete(ws);
    if (ws.data.role && ws.data.role !== "preview") {
      console.log(`🔌 Desconectado: ${roleLabel(ws.data.role)} (${clients.size} restantes)`);
    }
    broadcastPresence();
  },

  // Bun cierra conexiones inactivas: los clientes hacen ping cada 15 s
  idleTimeout: 120,
  sendPings: true,
};

function roleLabel(role: ClientRole): string {
  return role === "control" ? "panel de control" : role === "projection" ? "proyección" : role === "output" ? "salida NDI/OBS" : "vista previa";
}
