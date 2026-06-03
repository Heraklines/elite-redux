import type { StoryBible } from "#data/llm-director/beat-schema";
import { THEME_SEEDS, type ThemeSeed } from "#data/llm-director/theme-seeds";
import { DirectorClient } from "#system/llm-director/director-client";
import { DirectorQueue } from "#system/llm-director/director-queue";

/**
 * Process-wide accessor for the LLM Director runtime: the shared
 * `DirectorClient` (NanoGPT proxy) and the `DirectorQueue` (pre-generation
 * buffer).
 *
 * Reads `VITE_NANOGPT_API_KEY` and `VITE_NANOGPT_BASE_URL` from
 * `import.meta.env` exactly once on first access. Returns `null` if either is
 * missing — callers (the bible phase, the beat phase) treat that as a fatal
 * config error and fall back to Classic mode rather than firing the LLM
 * pipeline.
 *
 * The queue's `generate` callback is rewired by the bible phase once a story
 * bible exists; the runtime ships with a placeholder generator that throws so
 * a forgotten wiring step is loud rather than silent.
 */

export interface DirectorRuntime {
  client: DirectorClient;
  queue: DirectorQueue;
}

let cached: DirectorRuntime | null = null;
let cacheValid = false;

function readEnv(name: string): string {
  const value = import.meta.env?.[name];
  return typeof value === "string" ? value : "";
}

/**
 * Side-effect-free check for whether the LLM Director is configured (both env
 * vars present). Unlike {@link getDirectorRuntime} this never logs, caches, or
 * constructs anything — it is safe to call from UI hot paths (e.g. the title
 * menu) to decide whether to surface the Director / "Story Mode" entry.
 */
export function isDirectorConfigured(): boolean {
  return readEnv("VITE_NANOGPT_API_KEY") !== "" && readEnv("VITE_NANOGPT_BASE_URL") !== "";
}

export function getDirectorRuntime(): DirectorRuntime | null {
  if (cacheValid) {
    return cached;
  }
  const apiKey = readEnv("VITE_NANOGPT_API_KEY");
  const baseUrl = readEnv("VITE_NANOGPT_BASE_URL");
  if (!apiKey || !baseUrl) {
    // Intentionally do NOT include the key (or its absence) in the warning
    // body. The presence/absence of the key is itself sensitive — and any log
    // that names the env var is enough for the developer to act on.
    console.warn("[llm-director] Missing VITE_NANOGPT_API_KEY or VITE_NANOGPT_BASE_URL; Director mode is disabled.");
    cacheValid = true;
    cached = null;
    return null;
  }
  const client = new DirectorClient({ apiKey, baseUrl });
  const queue = new DirectorQueue({
    generate: () =>
      Promise.reject(
        new Error(
          "DirectorQueue.generate has not been wired yet — the bible phase must call setDirectorQueueGenerator before kickOff.",
        ),
      ),
  });
  cached = { client, queue };
  cacheValid = true;
  return cached;
}

/**
 * Test-only helper. Production code never resets the runtime — the queue
 * survives until process exit (or a `cancel()` call from the run-end flow).
 */
export function resetDirectorRuntimeForTests(): void {
  if (cached?.queue) {
    cached.queue.cancel();
  }
  cached = null;
  cacheValid = false;
  pendingBible = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending-bible cache
//
// When the player picks Director mode, we kick off bible generation in the
// background BEFORE starter selection so the LLM call runs in parallel with
// the player picking starters. The result lives in this module-level cache
// (process-wide; not save data — runs are transient).
//
// Lifecycle:
//   - StartPhase calls `ensurePendingBible()` which either returns the
//     existing pending entry or kicks off a new one with a randomly-picked
//     seed.
//   - BiblePhase calls `awaitPendingBible()` to consume the result; this
//     also calls `clearPendingBible()` so the next time the player picks
//     Director they roll a different seed (per user's request: cache stays
//     across mode-leave, but clears once the run actually starts).
//   - If the player picks Director, sees gen kick off, then backs out
//     without playing, the cache survives until the next mode pick — at
//     which point ensurePendingBible() returns the same pending entry, so
//     no LLM call is wasted.
// ─────────────────────────────────────────────────────────────────────────────

interface PendingBible {
  seed: ThemeSeed;
  promise: Promise<StoryBible>;
  /** Populated once the promise resolves. */
  resolved?: StoryBible;
  /** Populated if generation failed permanently. */
  error?: Error;
}

let pendingBible: PendingBible | null = null;

function pickRandomSeed(): ThemeSeed {
  const idx = Math.floor(Math.random() * THEME_SEEDS.length);
  return THEME_SEEDS[idx];
}

/**
 * Ensure a bible generation is in flight (or already done). Returns the
 * pending entry. Idempotent — safe to call from multiple places; the second
 * call returns the same entry.
 */
export function ensurePendingBible(generator: (seed: ThemeSeed) => Promise<StoryBible>): PendingBible {
  if (pendingBible) {
    return pendingBible;
  }
  const seed = pickRandomSeed();
  const entry: PendingBible = { seed, promise: undefined as unknown as Promise<StoryBible> };
  entry.promise = generator(seed)
    .then(bible => {
      entry.resolved = bible;
      return bible;
    })
    .catch(err => {
      entry.error = err instanceof Error ? err : new Error(String(err));
      throw entry.error;
    });
  pendingBible = entry;
  return entry;
}

export function getPendingBible(): PendingBible | null {
  return pendingBible;
}

/**
 * Clear the pending-bible cache. Called by BiblePhase once the bible has
 * been consumed (i.e., the run is actually starting). Subsequent Director
 * picks will roll a fresh seed.
 */
export function clearPendingBible(): void {
  pendingBible = null;
}
