/**
 * Entry point - Receso
 * Arranca el servidor HTTP + WebSocket (puerto 3004 por defecto) y las integraciones.
 */

import { startServer } from "./server/http.js";
import { getConfig } from "./server/data.js";
import { startEngine, stopEngine } from "./server/engine.js";
import { initIntegrations, stopIntegrations } from "./server/integrations/index.js";
import { VERSION } from "./version.js";

let shuttingDown = false;

function setupSignals(stop: () => void) {
  const handleSignal = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n🛑 Apagando servidor...");
    stopIntegrations();
    stopEngine();
    stop();
    console.log("✅ Servidor detenido");
    process.exit(0);
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  if (process.platform !== "win32") process.on("SIGHUP", handleSignal);
}

// Un error inesperado no debe tirar abajo la cuenta regresiva en pleno evento
process.on("unhandledRejection", err => console.error("⚠️  Error no manejado:", err));
process.on("uncaughtException", err => console.error("⚠️  Excepción no capturada:", err));

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log(`║  Receso v${VERSION.padEnd(28)}║`);
  console.log("║  Cuenta regresiva para conferencias  ║");
  console.log("╚══════════════════════════════════════╝");

  try {
    const { stop } = await startServer(getConfig().port || 3004);
    startEngine();
    initIntegrations();
    setupSignals(stop);
  } catch (err) {
    console.error("❌ Error iniciando servidor:", err);
    // En Windows la consola se cierra sola: dar tiempo a leer el error
    await new Promise(resolve => setTimeout(resolve, 15000));
    process.exit(1);
  }
}

main();
