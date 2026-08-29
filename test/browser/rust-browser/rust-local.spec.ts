import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

const fixtureRoot = process.env.M8_RUST_BROWSER_FIXTURE_DIR;
if (fixtureRoot == null) {
  throw new Error("M8_RUST_BROWSER_FIXTURE_DIR is required for the Rust-local browser journey");
}
const fixture = resolve(fixtureRoot);
const manifest = JSON.parse(readFileSync(resolve(fixture, "m8-web-assets.json"), "utf8")) as {
  assets: Record<string, { sha256: string }>;
};
const expectedDigest = readFileSync(resolve(fixture, "expected-terminal-digest.txt"), "utf8").trim();
let server: ViteDevServer;

const html = `<!doctype html>
<html><body><main id="ui"></main><section id="presentation"></section>
<script type="module">
import { startRustLocalRoute } from "/src/rust-browser/routes/rust-local-entry.ts";
const manifest = await (await fetch("/m8-assets/m8-web-assets.json")).json();
const identity = new Uint8Array(await (await fetch("/m8-assets/execution-identity.bin")).arrayBuffer());
let snapshot = new Uint8Array(await (await fetch("/m8-assets/session-start.json")).arrayBuffer());
let session;
async function start() {
  const worker = new URL("/src/rust-browser/worker/rust-kernel-worker.ts", location.href);
  worker.searchParams.set("wasm", "/m8-assets/er_web.wasm");
  worker.searchParams.set("wasm_sha256", manifest.assets["er_web.wasm"].sha256);
  worker.searchParams.set("content", "/m8-assets/content-pack.json");
  worker.searchParams.set("content_sha256", manifest.assets["content-pack.json"].sha256);
  session = await startRustLocalRoute({
    workerUrl: worker,
    executionIdentityBytes: identity,
    sessionStartBytes: snapshot,
    uiRoot: document.querySelector("#ui"),
    presentationRoot: document.querySelector("#presentation"),
    storageDatabaseName: "m8-rust-local-playwright",
    executionIdentity: new TextDecoder().decode(identity),
    contentIdentity: manifest.assets["content-pack.json"].sha256,
  });
}
await start();
globalThis.__m8Harness = {
  async reload() { snapshot = await session.snapshot(); await session.dispose(); await start(); },
  async repro() { return Array.from(await session.exportRepro()); },
  async digest() { return session.mechanicalDigest(); },
  async dispose() { await session.dispose(); },
};
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-rust-local-fixture",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/m8-assets/")) {
              const name = request.url.slice("/m8-assets/".length);
              if (!/^[a-z0-9_.-]+$/u.test(name)) {
                response.statusCode = 400;
                response.end();
                return;
              }
              try {
                const contentType = name.endsWith(".js")
                  ? "text/javascript; charset=utf-8"
                  : name.endsWith(".wasm")
                    ? "application/wasm"
                    : name.endsWith(".json")
                      ? "application/json; charset=utf-8"
                      : "application/octet-stream";
                response.setHeader("content-type", contentType);
                response.end(readFileSync(resolve(fixture, name)));
              } catch {
                response.statusCode = 404;
                response.end();
              }
              return;
            }
            if (request.url === "/rust-local-test.html") {
              response.statusCode = 200;
              response.setHeader("content-type", "text/html; charset=utf-8");
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

test.afterAll(async () => {
  await server.close();
});

test("natural raw-key Rust-local run restores and tears down", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish a Rust-local address");
  }
  await page.goto(new URL("rust-local-test.html", address).href);
  await expect(page.locator("[data-rust-kernel-view='reference-v1']")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator("[role='alert'][data-kind='terminal']")).toBeVisible({ timeout: 15_000 });
  const actualDigest = await page.evaluate(() =>
    (globalThis as typeof globalThis & { __m8Harness: { digest(): Promise<string> } }).__m8Harness.digest(),
  );
  expect(actualDigest).toBe(expectedDigest);
  const before = await page.locator("#ui").getAttribute("data-rust-kernel-view");
  await page.evaluate(() =>
    (globalThis as typeof globalThis & { __m8Harness: { reload(): Promise<void> } }).__m8Harness.reload(),
  );
  await expect(page.locator("#ui")).toHaveAttribute("data-rust-kernel-view", before ?? "reference-v1");
  const reproLength = await page.evaluate(() =>
    (globalThis as typeof globalThis & { __m8Harness: { repro(): Promise<number[]> } }).__m8Harness
      .repro()
      .then(value => value.length),
  );
  expect(reproLength).toBeGreaterThan(0);
  await page.evaluate(() =>
    (globalThis as typeof globalThis & { __m8Harness: { dispose(): Promise<void> } }).__m8Harness.dispose(),
  );
  await expect(page.locator("#ui")).toBeEmpty();
  expect(manifest.assets["er_web.wasm"].sha256).toMatch(/^[0-9a-f]{64}$/u);
});
