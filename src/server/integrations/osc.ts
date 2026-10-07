/**
 * Emisor OSC mínimo por UDP (sin dependencias)
 * Codifica mensajes OSC 1.0 con argumentos string, int, float y booleanos.
 */

import { createSocket, type Socket } from "dgram";

export type OscArg = string | number | boolean;

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = createSocket("udp4");
    socket.on("error", err => console.error("[OSC] Error de socket:", err.message));
    socket.unref();
  }
  return socket;
}

/** String OSC: UTF-8 terminado en \0 y alineado a 4 bytes */
function oscString(value: string): Buffer {
  const raw = Buffer.from(`${value}\0`, "utf8");
  const pad = (4 - (raw.length % 4)) % 4;
  return pad ? Buffer.concat([raw, Buffer.alloc(pad)]) : raw;
}

export function encodeOscMessage(address: string, args: OscArg[] = []): Buffer {
  let tags = ",";
  const payload: Buffer[] = [];
  for (const arg of args) {
    if (typeof arg === "string") {
      tags += "s";
      payload.push(oscString(arg));
    } else if (typeof arg === "boolean") {
      tags += arg ? "T" : "F";
    } else if (Number.isInteger(arg)) {
      tags += "i";
      const b = Buffer.alloc(4);
      b.writeInt32BE(arg);
      payload.push(b);
    } else {
      tags += "f";
      const b = Buffer.alloc(4);
      b.writeFloatBE(arg);
      payload.push(b);
    }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...payload]);
}

export function sendOsc(host: string, port: number, address: string, args: OscArg[] = []): Promise<void> {
  const message = encodeOscMessage(address, args);
  return new Promise((resolve, reject) => {
    getSocket().send(message, port, host, err => (err ? reject(err) : resolve()));
  });
}
