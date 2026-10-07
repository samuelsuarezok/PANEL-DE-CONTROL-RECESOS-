/**
 * Orquestador de integraciones - Receso
 * Reenvía los eventos del motor a ProPresenter, Resolume y FreeShow,
 * y revisa su conexión cada 10 s para mostrar el estado real en el panel.
 */

import type { AppConfig, IntegrationName, TestResult } from "../../types/index.js";
import { onEngineEvent } from "../engine.js";
import { getConfig, onConfigChange } from "../data.js";
import * as propresenter from "./propresenter.js";
import * as resolume from "./resolume.js";
import * as freeshow from "./freeshow.js";

interface IntegrationModule {
  handleEvent: (event: Parameters<Parameters<typeof onEngineEvent>[0]>[0]) => void;
  testConnection: () => Promise<TestResult>;
  healthCheck: () => Promise<void>;
  onConfigChanged?: () => void;
}

const modules: Record<IntegrationName, IntegrationModule> = { propresenter, resolume, freeshow };
const names = Object.keys(modules) as IntegrationName[];
let healthTimer: ReturnType<typeof setInterval> | null = null;

export const isIntegrationName = (name: string): name is IntegrationName => name in modules;

function snapshot(config: AppConfig): Record<IntegrationName, string> {
  return {
    propresenter: JSON.stringify(config.propresenter),
    resolume: JSON.stringify(config.resolume),
    freeshow: JSON.stringify(config.freeshow),
  };
}

function runHealthChecks(): void {
  for (const name of names) {
    modules[name].healthCheck().catch(err => console.error(`[${name}] Error en chequeo:`, err));
  }
}

export function initIntegrations(): void {
  onEngineEvent(event => {
    for (const name of names) {
      try {
        modules[name].handleEvent(event);
      } catch (err) {
        console.error(`[${name}] Error manejando "${event.type}":`, err);
      }
    }
  });

  // Cuando cambia la configuración de una integración: limpiar cachés y revisar al instante
  let last = snapshot(getConfig());
  onConfigChange(config => {
    const next = snapshot(config);
    for (const name of names) {
      if (next[name] !== last[name]) {
        modules[name].onConfigChanged?.();
        modules[name].healthCheck().catch(() => {});
      }
    }
    last = next;
  });

  runHealthChecks();
  healthTimer = setInterval(runHealthChecks, 10_000);
}

export function stopIntegrations(): void {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
}

export function testIntegration(name: IntegrationName): Promise<TestResult> {
  return modules[name].testConnection();
}
