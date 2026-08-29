import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
const asset = Uint8Array.from([4, 3, 2, 1]);
const digest = createHash("sha256").update(asset).digest("hex");
const html = `<!doctype html><html><body><script type="module">
import { installAtomicReleaseCache, loadAtomicReleaseCache } from "/src/rust-browser/adapters/release-cache.ts";
const manifest = { schema_version: 1, release_id: "release-1", browser_sha: "b2ed1a6eb050a18d5f335ec826e01b7b425ce311", rust_sha: "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273", assets: [{ url: new URL("/cache-asset.bin", location.href).href, sha256: "${digest}" }] };
await installAtomicReleaseCache(caches, manifest);
globalThis.__cache = { load: id => loadAtomicReleaseCache(caches, id).then(value => value.manifest.release_id), mixed: () => loadAtomicReleaseCache(caches, "release-2").then(() => false, () => true) };
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-cache",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url === "/m8-cache.html") {
              response.setHeader("content-type", "text/html");
              response.end(html);
              return;
            }
            if (request.url === "/cache-asset.bin") {
              response.end(asset);
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

test("atomic cache works offline and rejects mixed release identities", async ({ page, context }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish cache fixture");
  }
  await page.goto(new URL("m8-cache.html", address).href);
  await page.waitForFunction(() => "__cache" in globalThis);
  expect(await page.evaluate(() => globalThis.__cache.mixed())).toBe(true);
  await context.setOffline(true);
  expect(await page.evaluate(() => globalThis.__cache.load("release-1"))).toBe("release-1");
});
