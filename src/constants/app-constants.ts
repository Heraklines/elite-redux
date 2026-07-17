/**
 * `true` if running in "development" mode which happens when:
 * - The build mode is "development" (`pnpm build:dev` which runs `vite build --mode development`) or
 * - The Vite server is started via `pnpm start:dev` (which runs `vite --mode development`)
 */
export const isDev = import.meta.env.MODE === "development";

/**
 * `true` if running in "beta" mode which happens when:
 * - The build mode is "beta" (`pnpm build:beta` which runs `vite build --mode beta`) or
 * - The Vite server is started via `pnpm start:beta` (which runs `vite --mode beta`)
 */
export const isBeta = import.meta.env.MODE === "beta";

/** `true` if running via "app" mode (`pnpm build:app` which runs `vite build --mode app`) */
export const isApp = import.meta.env.MODE === "app";

/** `true` if running automated tests via Vitest. */
export const IS_TEST = import.meta.env.MODE === "test";

const configuredBypassLogin = import.meta.env.VITE_BYPASS_LOGIN === "1";

/**
 * Whether persistence uses the local-only development codec instead of the authenticated cloud path.
 * This is mutable only through the explicit test seam below; an ESM namespace spy does not reliably
 * update already-imported live bindings in every Vitest/Vite execution mode.
 */
export let bypassLogin = configuredBypassLogin;

/** Exercise both persistence modes without rebuilding the complete browser bundle. */
export function setBypassLoginForTesting(value: boolean | null): void {
  bypassLogin = value ?? configuredBypassLogin;
}

/**
 * Elite Redux mod version, shown on the title screen instead of the upstream
 * PokeRogue `package.json` version. Bump this with each player-facing patch
 * (keep it in sync with the matching `docs/patch-notes/<version>.md`).
 */
export const ER_VERSION = "0.0.5.6";
