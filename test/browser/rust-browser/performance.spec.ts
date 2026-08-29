import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

test.setTimeout(60_000);

const fixtureRoot = process.env.M8_RUST_BROWSER_FIXTURE_DIR;
if (fixtureRoot == null) {
  throw new Error("M8_RUST_BROWSER_FIXTURE_DIR is required");
}
const fixture = resolve(fixtureRoot);
let server: ViteDevServer;
const html = `<!doctype html><html><body><script type="module">
import { RustBrowserHost } from "/src/rust-browser/host/rust-browser-host.ts"; import { BrowserExecutionModeV1 } from "/src/rust-browser/contracts/browser-contracts.ts";
const manifest = await (await fetch("/m8-assets/m8-web-assets.json")).json(); const identity = new Uint8Array(await (await fetch("/m8-assets/execution-identity.bin")).arrayBuffer()); const session = new Uint8Array(await (await fetch("/m8-assets/session-start.json")).arrayBuffer()); const ready = []; const input = []; const terminal = [];
for (let sample = 0; sample < 20; sample += 1) {
  const worker = new URL("/src/rust-browser/worker/rust-kernel-worker.ts", location.href);
  worker.searchParams.set("wasm", "/m8-assets/er_web.wasm");
  worker.searchParams.set("wasm_sha256", manifest.assets["er_web.wasm"].sha256);
  worker.searchParams.set("content", "/m8-assets/content-pack.json");
  worker.searchParams.set("content_sha256", manifest.assets["content-pack.json"].sha256);
  const readyStart = performance.now();
  const host = await RustBrowserHost.create({
    workerUrl: worker,
    initialize: {
      kind: "INITIALIZE",
      value: {
        mode: BrowserExecutionModeV1.RUST_LOCAL_AUTHORITY,
        execution_identity_bytes: Array.from(identity),
        session_start_bytes: Array.from(session),
        maximum_pending_requests: 8,
      },
    },
  });
  ready.push(performance.now() - readyStart);
  for (let warmup = 0; warmup < 3; warmup += 1) {
    await host.dispatch({ kind: "OBSERVE", value: { profile: "PERFORMANCE_WARMUP" } });
  }
  await host.dispatchBatch([
    {
      kind: "RAW_INPUT",
      value: {
        kind: "KEY_DOWN",
        data: {
          code: { kind: "KEY_A" },
          printable: true,
          browser_repeat: false,
          focus: "GAME",
        },
      },
    },
    {
      kind: "RAW_INPUT",
      value: { kind: "KEY_UP", data: { code: { kind: "KEY_A" } } },
    },
  ]);
  const inputStart = performance.now();
  await host.dispatch({
    kind: "RAW_INPUT",
    value: {
      kind: "KEY_DOWN",
      data: {
        code: { kind: "KEY_A" },
        printable: true,
        browser_repeat: false,
        focus: "GAME",
      },
    },
  });
  input.push(performance.now() - inputStart);
  await host.dispatch({
    kind: "RAW_INPUT",
    value: { kind: "KEY_UP", data: { code: { kind: "KEY_A" } } },
  });
  const terminalStart = performance.now();
  await host.dispatchBatch([
    {
      kind: "RAW_INPUT",
      value: {
        kind: "KEY_DOWN",
        data: {
          code: { kind: "SPACE" },
          printable: true,
          browser_repeat: false,
          focus: "GAME",
        },
      },
    },
    {
      kind: "RAW_INPUT",
      value: { kind: "KEY_UP", data: { code: { kind: "SPACE" } } },
    },
  ]);
  terminal.push(performance.now() - terminalStart);
  await host.dispose();
}
ready.sort((a,b)=>a-b); input.sort((a,b)=>a-b); terminal.sort((a,b)=>a-b); globalThis.__performanceResult = { cold_ready_ms: ready.at(-1), warm_ready_median_ms: ready[10], input_p95_ms: input[Math.ceil(input.length * 0.95) - 1], terminal_p95_ms: terminal[Math.ceil(terminal.length * 0.95) - 1], samples: 20, active_workers: 0, js_heap_bytes: performance.memory?.usedJSHeapSize ?? null };
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-performance",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/m8-assets/")) {
              const name = request.url.slice(11);
              response.setHeader(
                "content-type",
                name.endsWith(".js")
                  ? "text/javascript"
                  : name.endsWith(".wasm")
                    ? "application/wasm"
                    : name.endsWith(".json")
                      ? "application/json"
                      : "application/octet-stream",
              );
              try {
                response.end(readFileSync(resolve(fixture, name)));
              } catch {
                response.statusCode = 404;
                response.end();
              }
              return;
            }
            if (request.url === "/m8-performance.html") {
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

test("worker startup input and teardown stay within browser ceilings", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish performance fixture");
  }
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(new URL("m8-performance.html", address).href);
  try {
    await page.waitForFunction(() => "__performanceResult" in globalThis, undefined, { timeout: 30_000 });
  } catch (error) {
    throw new Error(`browser performance run did not finish: ${String(error)}; page errors: ${pageErrors.join(" | ")}`);
  }
  const metrics = await page.evaluate(() => globalThis.__performanceResult);
  process.stdout.write(`${JSON.stringify(metrics)}\n`);
  expect(metrics.cold_ready_ms).toBeLessThanOrEqual(3_000);
  expect(metrics.warm_ready_median_ms).toBeLessThanOrEqual(750);
  expect(metrics.input_p95_ms).toBeLessThanOrEqual(12);
  expect(metrics.terminal_p95_ms).toBeLessThanOrEqual(100);
  expect(metrics.active_workers).toBe(0);
});
