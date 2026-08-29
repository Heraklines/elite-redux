import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

const fixtureRoot = process.env.M8_RUST_BROWSER_FIXTURE_DIR;
if (fixtureRoot == null) {
  throw new Error("M8_RUST_BROWSER_FIXTURE_DIR is required");
}
const fixture = resolve(fixtureRoot);
const expectedDigest = readFileSync(resolve(fixture, "expected-terminal-digest.txt"), "utf8").trim();
let server: ViteDevServer;
const html = `<!doctype html><html><body><div id="game"></div><script type="module">
import Phaser from "/@id/phaser";
import { startRustPhaserRoute } from "/src/rust-browser/routes/rust-phaser-entry.ts";
const manifest = await (await fetch("/m8-assets/m8-web-assets.json")).json();
const identity = new Uint8Array(await (await fetch("/m8-assets/execution-identity.bin")).arrayBuffer());
const snapshot = new Uint8Array(await (await fetch("/m8-assets/session-start.json")).arrayBuffer());
new Phaser.Game({ type: Phaser.CANVAS, parent: "game", width: 640, height: 360, banner: false, scene: { create() {
  const worker = new URL("/src/rust-browser/worker/rust-kernel-worker.ts", location.href);
  worker.searchParams.set("wasm", "/m8-assets/er_web.wasm"); worker.searchParams.set("wasm_sha256", manifest.assets["er_web.wasm"].sha256);
  worker.searchParams.set("content", "/m8-assets/content-pack.json"); worker.searchParams.set("content_sha256", manifest.assets["content-pack.json"].sha256);
  startRustPhaserRoute({ workerUrl: worker, executionIdentityBytes: identity, sessionStartBytes: snapshot, scene: this }).then(session => {
    globalThis.__m8RustPhaser = { digest: () => session.mechanicalDigest(), trace: () => session.renderTrace(), names: () => this.children.list.map(child => child.name).filter(Boolean), dispose: () => session.dispose() };
  }).catch(error => { globalThis.__m8RustPhaserError = String(error?.stack ?? error); });
} } });
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-rust-phaser",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/m8-assets/")) {
              const name = request.url.slice(11);
              if (!/^[a-z0-9_.-]+$/u.test(name)) {
                response.statusCode = 400;
                response.end();
                return;
              }
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
            if (request.url === "/m8-rust-phaser.html") {
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
test.afterAll(async () => server.close());

test("Rust owns a complete raw-key Phaser solo run", async ({ page }, testInfo) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish Rust Phaser route");
  }
  await page.goto(new URL("m8-rust-phaser.html", address).href);
  await page.waitForFunction(() => "__m8RustPhaser" in globalThis || "__m8RustPhaserError" in globalThis, undefined, {
    timeout: 20_000,
  });
  const startupError = await page.evaluate(() => globalThis.__m8RustPhaserError);
  expect(startupError).toBeUndefined();
  await page.keyboard.press("Space");
  const digest = await page.evaluate(() => globalThis.__m8RustPhaser.digest());
  expect(digest).toBe(expectedDigest);
  const names = await page.evaluate(() => globalThis.__m8RustPhaser.names());
  expect(names).toContain("rust-logical-ui-v1");
  await page.screenshot({ path: testInfo.outputPath("rust-phaser-solo.png") });
  await page.evaluate(() => globalThis.__m8RustPhaser.dispose());
});
