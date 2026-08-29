import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
const html = `<!doctype html><html><body><output id="status">running</output><script type="module">
import { BrowserSnapshotMigrationRegistryV1 } from "/src/rust-browser/hot-reload/migration-registry.ts";
import { TransactionalBrowserReloadV1 } from "/src/rust-browser/hot-reload/transactional-reload.ts";
const disposed = [];
const identity = generation => ({
  schema_version: 1, session_id: "browser-soak", generation,
  artifact_sha256: generation.toString(16).padStart(64, "0"),
  wasm_sha256: (generation + 5000).toString(16).padStart(64, "0"),
  content_sha256: "c".repeat(64), source_git_sha: generation.toString(16).padStart(40, "0"),
  worker_abi_version: 1, minimum_snapshot_schema: 6, maximum_snapshot_schema: 6,
  content_identity: "content-soak", release_id: "release-" + generation,
});
const manifest = generation => ({
  schema_version: 1, identity: identity(generation), worker_url: "/worker.js",
  wasm_url: "/kernel.wasm", content_url: "/content.json",
});
class Generation {
  constructor(generation) { this.identity = identity(generation); this.state = 7; this.sequence = 0; }
  async dispatch(request) {
    this.sequence += 1;
    if (request.kind === "ADVANCE_TIME") this.state += request.value;
    return [{ version: 1, request_id: this.sequence, accepted_sequence: this.sequence,
      after_mechanical_digest: "state:" + this.state,
      response: { kind: "EFFECTS", value: { external_sequence: this.sequence, effects: [], observation_bytes: [this.state], next_wakeup_micros: null } } }];
  }
  async snapshot() { return new TextEncoder().encode(JSON.stringify({ schema_version: 6, state: this.state, menu: "MOVE_SELECT", held_key: true, presentation_fenced: true })); }
  async restore(bytes) { this.state = JSON.parse(new TextDecoder().decode(bytes)).state; }
  async dispose() { disposed.push(this.identity.generation); }
}
const supervisor = new TransactionalBrowserReloadV1(new Generation(1));
const registry = new BrowserSnapshotMigrationRegistryV1();
const plan = { schema_version: 1, policy: "EXACT_PRESERVATION", allowed_response_kinds: [], acceptance_events: 0 };
const latencies = [];
for (let generation = 2; generation <= 1001; generation += 1) {
  const started = performance.now();
  await supervisor.reload(manifest(generation), plan, registry, async (candidateManifest, snapshot) => {
    const value = new Generation(candidateManifest.identity.generation);
    await value.restore(snapshot);
    return value;
  });
  latencies.push(performance.now() - started);
}
const snapshot = JSON.parse(new TextDecoder().decode(await supervisor.snapshot()));
await supervisor.dispose();
latencies.sort((a, b) => a - b);
globalThis.__m81Result = {
  generation: supervisor.identity.generation,
  snapshot,
  disposed: disposed.length,
  p95_ms: latencies[Math.floor(latencies.length * 0.95)],
  navigation_count: performance.getEntriesByType("navigation").length,
};
document.querySelector("#status").textContent = "done";
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m81-reload-page",
        configureServer(value) {
          value.middlewares.use((request, response, next) => {
            if (request.url === "/m81-reload.html") {
              response.statusCode = 200;
              response.setHeader("content-type", "text/html");
              response.end(html);
              return;
            }
            next();
          });
        },
      },
    ],
  });
  await server.listen();
});

test.afterAll(async () => server.close());

test("one thousand browser generation swaps preserve state without page reload", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish M8.1 reload fixture");
  }
  await page.goto(new URL("m81-reload.html", address).href);
  await expect(page.locator("#status")).toHaveText("done", { timeout: 30_000 });
  const result = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __m81Result: {
            generation: number;
            snapshot: Record<string, unknown>;
            disposed: number;
            p95_ms: number;
            navigation_count: number;
          };
        }
      ).__m81Result,
  );
  expect(result.generation).toBe(1001);
  expect(result.snapshot).toMatchObject({ state: 7, menu: "MOVE_SELECT", held_key: true, presentation_fenced: true });
  expect(result.disposed).toBe(1001);
  expect(result.navigation_count).toBe(1);
  expect(result.p95_ms).toBeLessThan(250);
});
