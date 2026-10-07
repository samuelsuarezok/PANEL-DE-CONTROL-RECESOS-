#!/usr/bin/env bun
/**
 * Build cross-platform de Receso
 * Genera ejecutables para Windows x64, macOS arm64 y macOS x64 en dist/
 * Conserva dist/data (plantillas, logos y configuración ya cargados).
 */

import { $ } from "bun";
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { DEFAULT_CONFIG, DEFAULT_STATE } from "./src/server/data.js";

const ROOT = import.meta.dir;
const DIST = join(ROOT, "dist");
const DATA_TEMPLATE = join(ROOT, "data-template");

const TARGETS = [
  { name: "windows-x64", target: "bun-windows-x64", outfile: "receso.exe" },
  { name: "macos-arm64", target: "bun-darwin-arm64", outfile: "receso-mac-arm64" },
  { name: "macos-x64", target: "bun-darwin-x64", outfile: "receso-mac-x64" },
] as const;

function writeDataTemplate(dir: string, overwrite: boolean) {
  mkdirSync(join(dir, "uploads"), { recursive: true });
  const files: Array<[string, unknown]> = [["state.json", DEFAULT_STATE], ["config.json", DEFAULT_CONFIG]];
  for (const [name, data] of files) {
    const path = join(dir, name);
    if (overwrite || !existsSync(path)) writeFileSync(path, JSON.stringify(data, null, 2));
  }
}

async function main() {
  console.log("🔨 Iniciando build de Receso...\n");

  // 1. Compilar y embeber el frontend
  await $`bun run ${join(ROOT, "build-embed.ts")}`;
  console.log();

  // 2. Preparar dist/ sin borrar los datos del usuario
  mkdirSync(DIST, { recursive: true });
  for (const { outfile } of TARGETS) rmSync(join(DIST, outfile), { force: true });

  // 3. Plantilla de datos (siempre al día con los valores por defecto del código)
  writeDataTemplate(DATA_TEMPLATE, true);
  writeDataTemplate(join(DIST, "data"), false);

  // 4. Compilar ejecutables en paralelo
  await Promise.all(
    TARGETS.map(async ({ name, target, outfile }) => {
      console.log(`📦 Compilando ${name}...`);
      await $`bun build --compile --target=${target} ${join(ROOT, "src/index.ts")} --outfile ${join(DIST, outfile)}`.quiet();
      console.log(`✅ ${name} → dist/${outfile}`);
    }),
  );

  // 5. Firmar (ad-hoc) los ejecutables de Mac. Al compilar para Intel desde otra arquitectura,
  //    Bun deja la firma original de su runtime, que queda inválida: macOS lo trataría como "dañado".
  const macOutputs = TARGETS.filter(t => t.target.startsWith("bun-darwin")).map(t => join(DIST, t.outfile));
  if (process.platform === "darwin") {
    for (const file of macOutputs) {
      await $`codesign --remove-signature ${file}`.quiet().nothrow();
      await $`codesign --force --sign - ${file}`.quiet();
      await $`codesign --verify ${file}`.quiet();
    }
    console.log("\n🔏 Ejecutables de Mac firmados (ad-hoc) y verificados");
  } else {
    console.warn("\n⚠️  Compilado fuera de macOS: los ejecutables de Mac quedan sin firma válida.");
    console.warn("   Firmalos en una Mac con: codesign --force --sign - dist/receso-mac-*");
  }

  console.log("\n📊 Tamaños:");
  for (const { outfile } of TARGETS) {
    const path = join(DIST, outfile);
    if (existsSync(path)) console.log(`   ${outfile}: ${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`);
  }

  console.log("\n✨ Build completado. Ejecutables en dist/");
  console.log("   Copiá la carpeta 'dist' completa a un pendrive para uso portable.");
}

main().catch(err => {
  console.error("💥 Build falló:", err);
  process.exit(1);
});
