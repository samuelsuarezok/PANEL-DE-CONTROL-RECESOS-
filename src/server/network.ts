/**
 * Utilidades de red - Receso
 * Detección de IPs locales y mensaje de bienvenida en consola
 */

import { networkInterfaces } from "os";
import type { ServerInfo } from "../types/index.js";

/** Obtiene todas las IPs IPv4 locales no internas, las más probables primero */
export function getLocalIPv4s(): string[] {
  const ips: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // Node/Bun pueden informar family como "IPv4" o 4
      const isV4 = addr.family === "IPv4" || (addr.family as unknown) === 4;
      if (isV4 && !addr.internal && !ips.includes(addr.address)) ips.push(addr.address);
    }
  }

  const score = (ip: string) => {
    if (ip.startsWith("192.168.")) return 0;
    if (ip.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    if (ip.startsWith("169.254.")) return 4; // auto-asignada (sin DHCP)
    return 3;
  };
  return ips.sort((a, b) => score(a) - score(b));
}

/** Genera URLs base para las IPs dadas */
export function generateURLs(ips: string[], port: number): string[] {
  return ips.map(ip => `http://${ip}:${port}`);
}

const BOX_WIDTH = 58;
const row = (text: string) => `║ ${text.padEnd(BOX_WIDTH - 2)} ║`;

export function formatServerInfo(info: ServerInfo): string {
  const lines = [
    "",
    `╔${"═".repeat(BOX_WIDTH)}╗`,
    row(`${info.name} v${info.version}`),
    `╠${"═".repeat(BOX_WIDTH)}╣`,
    row(`Puerto: ${info.port}`),
    row("URLs de acceso:"),
  ];

  for (const url of info.urls) lines.push(row(`  → ${url}`));
  if (info.urls.length === 0) lines.push(row("  → (sin red) http://localhost:" + info.port));
  lines.push(row(""));
  lines.push(row(`Control:     /?view=control`));
  lines.push(row(`Proyección:  /?view=projection`));
  lines.push(row(`Salida OBS:  /salida`));
  lines.push(`╚${"═".repeat(BOX_WIDTH)}╝`);
  lines.push("");
  lines.push("📱 Abrí la URL en el celular/tablet y tocá «Panel de Control»");
  lines.push("🖥️  En la PC del proyector: abrí la URL y poné pantalla completa (F11 o tecla F)");
  lines.push("");

  if (info.localIPs.length === 0) {
    lines.push("⚠️  No se detectaron IPs de red. ¿Está conectado el WiFi o el cable?");
  }

  return lines.join("\n");
}
