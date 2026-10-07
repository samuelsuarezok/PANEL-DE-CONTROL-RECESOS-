/**
 * Conexión WebSocket compartida por todas las vistas
 * - Reconexión rápida (máx. 3 s: en un evento en vivo no se puede esperar 30 s)
 * - Sincronización de reloj tipo NTP: ping/pong midiendo ida y vuelta,
 *   se usa la muestra con menor latencia (precisión de pocos ms en LAN)
 */

import type { AppState, ClientMessage, ClientRole, ControlAction, ServerMessage } from "../../types/index.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface ClockSample { offset: number; rtt: number }

export class Connection {
  state: AppState | null = null;
  status: ConnectionStatus = "connecting";

  private ws: WebSocket | null = null;
  private offset = 0;           // serverTime ≈ performance.now() + offset
  private hasPong = false;
  private samples: ClockSample[] = [];
  private attempts = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private burstTimers: ReturnType<typeof setTimeout>[] = [];
  private messageListeners = new Set<(msg: ServerMessage) => void>();
  private stateListeners = new Set<(state: AppState) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(private role: ClientRole) {
    this.connect();
    window.addEventListener("online", () => this.reconnectNow());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.status !== "connected") this.reconnectNow();
    });
  }

  /** Hora del servidor estimada (ms epoch) */
  serverNow(): number {
    return performance.now() + this.offset;
  }

  onMessage(listener: (msg: ServerMessage) => void): void { this.messageListeners.add(listener); }
  onState(listener: (state: AppState) => void): void { this.stateListeners.add(listener); }
  onStatus(listener: (status: ConnectionStatus) => void): void { this.statusListeners.add(listener); }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  control(action: ControlAction): boolean {
    return this.send({ type: "control", action });
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  private connect(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws = ws;
    this.setStatus("connecting");

    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus("connected");
      this.send({ type: "hello", role: this.role });
      this.samples = [];
      // Ráfaga inicial para sincronizar rápido, después cada 15 s
      for (let i = 0; i < 6; i++) this.burstTimers.push(setTimeout(() => this.ping(), i * 150));
      this.pingTimer = setInterval(() => this.ping(), 15000);
    };

    ws.onmessage = event => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // un socket viejo no debe tocar los timers del nuevo
      this.cleanupTimers();
      this.ws = null;
      this.setStatus("disconnected");
      const delay = Math.min(3000, 400 * 2 ** this.attempts) + Math.random() * 300;
      this.attempts++;
      setTimeout(() => { if (!this.ws) this.connect(); }, delay);
    };

    ws.onerror = () => { /* onclose se encarga de reconectar */ };
  }

  private reconnectNow(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.ws = null;
    this.connect();
  }

  private cleanupTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.burstTimers.forEach(clearTimeout);
    this.burstTimers = [];
  }

  private ping(): void {
    this.send({ type: "ping", t0: performance.now() });
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "pong": {
        const t1 = performance.now();
        const rtt = t1 - msg.t0;
        if (rtt < 0 || rtt > 10000) break;
        this.samples.push({ offset: msg.serverTime + rtt / 2 - t1, rtt });
        if (this.samples.length > 8) this.samples.shift();
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.offset;
        this.hasPong = true;
        break;
      }
      case "sync":
      case "state":
        // Estimación inicial hasta que llegue el primer pong
        if (!this.hasPong) this.offset = msg.serverTime - performance.now();
        this.state = msg.state;
        for (const l of this.stateListeners) l(msg.state);
        break;
    }
    for (const l of this.messageListeners) l(msg);
  }
}
