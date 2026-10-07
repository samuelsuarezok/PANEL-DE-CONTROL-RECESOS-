#!/usr/bin/env bun
/**
 * Compila el frontend y lo embebe para el ejecutable de un solo archivo.
 * - app.ts (+ módulos) → app.js con Bun.build (los navegadores no ejecutan TypeScript)
 * - index.html y styles.css se copian tal cual
 * Genera src/frontend/embed.ts (no editar a mano).
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FRONTEND_DIR = join(import.meta.dir, "src/frontend");
const OUTPUT_FILE = join(FRONTEND_DIR, "embed.ts");

async function bundleApp(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(FRONTEND_DIR, "app.ts")],
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "none",
  });
  if (!result.success || result.outputs.length === 0) {
    for (const log of result.logs) console.error(log);
    throw new Error("No se pudo compilar el frontend");
  }
  return result.outputs[0]!.text();
}

async function main() {
  console.log("📦 Compilando frontend...");
  const appJs = await bundleApp();
  const css = readFileSync(join(FRONTEND_DIR, "styles.css"), "utf-8");
  const htmlTemplate = readFileSync(join(FRONTEND_DIR, "index.html"), "utf-8");

  const buildId = Bun.hash(appJs + css + htmlTemplate).toString(36).slice(0, 10);
  const html = htmlTemplate.replaceAll("__BUILD_ID__", buildId);

  const assets = {
    "index.html": { type: "text/html; charset=utf-8", body: html },
    "styles.css": { type: "text/css; charset=utf-8", body: css },
    "app.js": { type: "text/javascript; charset=utf-8", body: appJs },
  };

  const source = `/**
 * Frontend embebido para el ejecutable de un solo archivo
 * AUTO-GENERADO por build-embed.ts — NO EDITAR A MANO (se sobrescribe en cada build)
 */

export const BUILD_ID = ${JSON.stringify(buildId)};

export const assets: Record<string, { type: string; body: string }> = ${JSON.stringify(assets, null, 2)};
`;
  writeFileSync(OUTPUT_FILE, source, "utf-8");

  console.log(`✅ Frontend embebido (build ${buildId})`);
  for (const [name, asset] of Object.entries(assets)) {
    console.log(`   - ${name.padEnd(11)} ${(asset.body.length / 1024).toFixed(1)} KB`);
  }
}

main().catch(err => {
  console.error("💥 Falló el embebido del frontend:", err);
  process.exit(1);
});
