/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Local-only dev-tools registry (tracked, but inert without local modules).
//
// The actual dev tools (test-scenario harness + console-log button) live under
// `src/dev-tools/local/`, which is GITIGNORED — never pushed to GitHub. This
// registry is the tiny tracked extension point that:
//
//   1. lazily loads those local modules IF they exist AND dev tools are enabled
//      (`import.meta.env.DEV` — i.e. `npm run start:dev` — or `VITE_DEV_TOOLS=1`);
//   2. lets a local module register main-menu items (consumed by TitlePhase);
//   3. lets a local module stage a "pending" party so a scenario can drop the
//      player straight into a battle, skipping starter-select (consumed by
//      SelectStarterPhase).
//
// On a clean checkout (no `src/dev-tools/local/` present) the glob matches
// nothing → every function here is a harmless no-op and no menu items appear.
// =============================================================================

import type { GameModes } from "#enums/game-modes";
import type { Starter } from "#types/save-data";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";

/** Context handed to dev-menu factories so they can launch runs. */
export interface DevMenuCtx {
  /**
   * Start a fresh run in the given game mode, mirroring the title-screen
   * "New Game" flow. A local module typically calls
   * {@linkcode setPendingDevStarters} first, then `startRunWithMode(CLASSIC)`
   * so SelectStarterPhase auto-submits the staged party.
   */
  startRunWithMode: (gameMode: GameModes) => void;
}

/** A factory that, given launch context, returns one or more menu items. */
export type DevMenuFactory = (ctx: DevMenuCtx) => OptionSelectItem | OptionSelectItem[];

const factories: DevMenuFactory[] = [];

/** Register a main-menu item factory (called by a local dev module on load). */
export function registerDevMenu(factory: DevMenuFactory): void {
  factories.push(factory);
}

/** Resolve all registered dev-menu items for the title screen. Empty if none. */
export function getDevMenuItems(ctx: DevMenuCtx): OptionSelectItem[] {
  return factories.flatMap(factory => {
    try {
      const result = factory(ctx);
      return Array.isArray(result) ? result : [result];
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
      console.warn("[dev-tools] menu factory threw:", err);
      return [];
    }
  });
}

// --- Pending-party handoff (scenario → SelectStarterPhase) -------------------

let pendingStarters: Starter[] | null = null;

/** Stage a party for the next run so starter-select is skipped. */
export function setPendingDevStarters(starters: Starter[]): void {
  pendingStarters = starters;
}

/** Take (and clear) any staged party. Returns null if none was staged. */
export function consumePendingDevStarters(): Starter[] | null {
  const s = pendingStarters;
  pendingStarters = null;
  return s;
}

// --- Lazy, env-gated loader --------------------------------------------------

// Lazy glob: returns importers WITHOUT running them. Empty object on a clean
// checkout (no local/ dir) — Vite resolves this at build time with no error.
const localModules = import.meta.glob("./local/**/index.ts");

let loadStarted = false;

/**
 * Load local dev modules if dev tools are enabled. Safe to call repeatedly.
 * Gated by env so the tools never activate in a production build even if the
 * (gitignored) files happen to be present in the working tree.
 */
export async function loadDevTools(): Promise<void> {
  if (loadStarted) {
    return;
  }
  loadStarted = true;

  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  const enabled = !!env?.DEV || env?.VITE_DEV_TOOLS === "1";
  if (!enabled) {
    return;
  }

  for (const load of Object.values(localModules)) {
    try {
      await load();
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
      console.warn("[dev-tools] failed to load a local module:", err);
    }
  }
}
