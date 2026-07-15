/// <reference types="vite/client" />

// biome-ignore lint/style/useNamingConvention: HTTP and URL are fullcaps acronyms
type HTTP_URL = `http${"" | "s"}://${string}`;

// Declaration merging for vite's `import.meta.env`.

interface ImportMetaEnv {
  // TODO: There doesn't appear to be a way to override Vite's definition of MODE;
  // it still shows up as "string"...
  readonly MODE: "development" | "beta" | "production" | "test" | "app" | "standalone";
  readonly VITE_PORT?: `${number}`;
  readonly VITE_BYPASS_LOGIN?: "0" | "1";
  readonly VITE_BYPASS_TUTORIAL?: "0" | "1";
  readonly VITE_API_BASE_URL?: HTTP_URL;
  readonly VITE_SERVER_URL?: HTTP_URL;
  readonly VITE_DISCORD_CLIENT_ID?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_I18N_DEBUG?: "0" | "1";
  // LLM Director — read by `getDirectorRuntime()` at first access. Tests
  // mutate these to simulate missing/present configuration, so they are
  // intentionally not declared `readonly`.
  VITE_NANOGPT_API_KEY?: string;
  VITE_NANOGPT_BASE_URL?: string;
  // Elite Redux — in-game bug reporter (#220). When `VITE_BUGREPORT_ENDPOINT`
  // is set, reports are POSTed there (e.g. a Web3Forms submit URL, which lands
  // in the maintainer's inbox); `VITE_BUGREPORT_KEY` is sent as `access_key`.
  // Unset = local-only (clipboard + file download) fallback.
  readonly VITE_BUGREPORT_ENDPOINT?: HTTP_URL;
  readonly VITE_BUGREPORT_KEY?: string;
  // Elite Redux — cross-player ghost-team API (#217). When set, winning teams
  // are uploaded here and endgame ghost trainers are fetched from here. Unset =
  // local fallback (the player's own past runs).
  readonly VITE_GHOST_ENDPOINT?: HTTP_URL;
}

// tell vite to disallow missing env vars
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

// Elite Redux — per-build id stamped into the bundle by `build-id-plugin`
// (auto-reload on new version). Compared against `/version.json` at runtime.
declare const __BUILD_ID__: string;
/** Exact non-secret source/workflow/deployment identity emitted beside `__BUILD_ID__`. */
declare const __BUILD_IDENTITY__: unknown;
