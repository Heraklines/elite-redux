import type { BattleScene } from "#app/battle-scene";

export let globalScene: BattleScene;

export function initGlobalScene(scene: BattleScene): void {
  globalScene = scene;
  // Expose to window for in-browser debugging (DevTools / Puppeteer).
  // Dev-only; stripped from production builds via the import.meta.env.DEV guard.
  if (import.meta.env.DEV) {
    (globalThis as { globalScene?: BattleScene }).globalScene = scene;
  }
}
