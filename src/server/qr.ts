/**
 * Generación de QR - Receso
 * Usa 'qrcode' para ASCII (terminal) y SVG (página /conectar)
 */

import QRCode from "qrcode";

/** Genera QR ASCII para terminal */
export async function generateQRASCII(text: string): Promise<string> {
  try {
    return await QRCode.toString(text, { type: "terminal", small: true });
  } catch (err) {
    console.error("Error generando QR ASCII:", err);
    return "[QR no disponible]";
  }
}

/**
 * Genera QR SVG para embeber en HTML.
 * Módulos negros sobre blanco: los QR invertidos (blanco sobre negro) no los leen todas las cámaras.
 */
export async function generateQRCodeSVG(text: string): Promise<string> {
  try {
    return await QRCode.toString(text, {
      type: "svg",
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch (err) {
    console.error("Error generando QR SVG:", err);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" text-anchor="middle" fill="#666">QR error</text></svg>`;
  }
}
