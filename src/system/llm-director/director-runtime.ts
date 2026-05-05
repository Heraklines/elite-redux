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
}
