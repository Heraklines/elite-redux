import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
const html = `<!doctype html><html><body><div id="controls"><button data-rust-physical-key="ArrowUp">Up</button><button data-rust-physical-key="Space">Action</button></div><script type="module">
import { MobileInputAdapterV1 } from "/src/rust-browser/adapters/mobile-input-adapter.ts";
const events = []; const root = document.querySelector("#controls"); const adapter = new MobileInputAdapterV1({ root, emit: event => events.push(event) }); adapter.start(); globalThis.__mobile = { events, orientation: () => root.dataset.rustOrientation, dispose: () => adapter.dispose() };
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-mobile",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url !== "/m8-mobile.html") {
              next();
              return;
            }
            response.setHeader("content-type", "text/html");
            response.end(html);
          });
        },
      },
    ],
  });
  await server.listen();
});
test.afterAll(async () => server.close());
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("low-end mobile touch emits physical input and tears down", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish mobile fixture");
  }
  await page.goto(new URL("m8-mobile.html", address).href);
  const action = page.locator("text=Action");
  await action.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true });
  await action.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true });
  const result = await page.evaluate(() => ({
    events: globalThis.__mobile.events.map(event => event.value.kind),
    orientation: globalThis.__mobile.orientation(),
  }));
  expect(result.events).toEqual(["KEY_DOWN", "KEY_UP"]);
  expect(result.orientation).toBe("portrait");
  await page.evaluate(() => globalThis.__mobile.dispose());
});
