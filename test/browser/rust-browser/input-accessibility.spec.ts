import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
const html = `<!doctype html><html><body><main id="ui"></main><input aria-label="Chat"><script type="module">
import { DomReferenceView } from "/src/rust-browser/render/dom-reference-view.ts";
import { BrowserRawInputAdapter } from "/src/rust-browser/adapters/input-adapter.ts";
const root = document.querySelector("#ui"); const events = []; const view = new DomReferenceView(root); const input = new BrowserRawInputAdapter({ emit: event => events.push(event) }); input.start();
view.render(new TextEncoder().encode(JSON.stringify({ control_id: "control/1", control_kind: "BATTLE_COMMAND", menu_instance_id: 1, actionable: true, title: "Command", options: [{ option_id: "fight", label: "Fight", disabled: false, hidden: false, selected: true, row: 0, column: 0 }, { option_id: "switch", label: "Switch", disabled: true, hidden: false, selected: false, row: 0, column: 1 }], status_lines: ["Ready"], terminal: null, fault: null })));
globalThis.__accessibility = { events, dispose: () => { input.dispose(); view.dispose(); } };
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-accessibility",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url !== "/m8-accessibility.html") {
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

test("keyboard touch and text focus retain accessible physical semantics", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish accessibility fixture");
  }
  await page.goto(new URL("m8-accessibility.html", address).href);
  await expect(page.getByRole("menu", { name: "BATTLE_COMMAND" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Fight" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("menuitem", { name: "Switch" })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await page.getByLabel("Chat").focus();
  await page.keyboard.press("a");
  await page.getByRole("button", { name: "Action" }).dispatchEvent("pointerdown", { pointerId: 9 });
  await page.getByRole("button", { name: "Action" }).dispatchEvent("pointerup", { pointerId: 9 });
  const events = await page.evaluate(() => globalThis.__accessibility.events.map(event => event.value));
  expect(events).toEqual(
    expect.arrayContaining([
      { kind: "KEY_DOWN", data: expect.objectContaining({ code: { kind: "ARROW_RIGHT" }, focus: "GAME" }) },
      { kind: "KEY_DOWN", data: expect.objectContaining({ code: { kind: "KEY_A" }, focus: "TEXT_ENTRY" }) },
      { kind: "KEY_DOWN", data: expect.objectContaining({ code: { kind: "SPACE" }, focus: "GAME" }) },
    ]),
  );
  await page.evaluate(() => globalThis.__accessibility.dispose());
  await expect(page.locator("#ui")).toBeEmpty();
});
