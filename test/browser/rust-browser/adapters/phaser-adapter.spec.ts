import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;

const html = `<!doctype html><html><body><div id="game"></div><script type="module">
import Phaser from "/@id/phaser";
import { PhaserUiAdapterV1 } from "/src/rust-browser/render/phaser-ui-adapter.ts";
import { PhaserBattleAdapterV1 } from "/src/rust-browser/render/phaser-battle-adapter.ts";
import { PhaserSurfaceAdapterV1 } from "/src/rust-browser/render/phaser-surface-adapter.ts";
import { PresentationSettlementTraceV1 } from "/src/rust-browser/render/presentation-settlement.ts";
const encoder = new TextEncoder();
const uiValue = {
  control_id: "control/1", control_kind: "BATTLE_COMMAND", menu_instance_id: 1, actionable: true,
  title: "Command", options: [{ option_id: "fight", label: "Fight", disabled: false, hidden: false, selected: true, row: 0, column: 0 }],
  status_lines: ["HP 10/10"], terminal: null, fault: null,
};
const cueValue = { event_id: "cue/1", kind: "BATTLE_WON", blocking_policy: "BLOCKS_HUMAN_INPUT", text: "Victory", duration_ms: 180 };
const surfaceValue = { scene_id: "world/1", scene_kind: "WORLD", background_texture: null, actors: [], messages: ["Wave 1"] };
const frozen = JSON.stringify({ uiValue, cueValue, surfaceValue });
new Phaser.Game({
  type: Phaser.CANVAS, parent: "game", width: 640, height: 360, banner: false,
  scene: { create() {
    const ui = new PhaserUiAdapterV1(this);
    const battle = new PhaserBattleAdapterV1(this);
    const surface = new PhaserSurfaceAdapterV1(this);
    const trace = new PresentationSettlementTraceV1();
    ui.render(encoder.encode(JSON.stringify(uiValue)));
    surface.render(encoder.encode(JSON.stringify(surfaceValue)));
    trace.begin("cue/1", 1, "PHASER");
    battle.present(encoder.encode(JSON.stringify(cueValue))).then(outcome => {
      trace.settle("cue/1", 1, outcome);
      globalThis.__m8AdapterResult = {
        outcome,
        trace: trace.snapshot(),
        names: this.children.list.map(child => child.name).filter(Boolean),
        unchanged: frozen === JSON.stringify({ uiValue, cueValue, surfaceValue }),
      };
      globalThis.__m8AdapterDispose = () => { battle.dispose(); surface.dispose(); ui.dispose(); trace.dispose(); };
    });
  } }
});
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-phaser-adapter-fixture",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url !== "/m8-phaser-adapter.html") {
              next();
              return;
            }
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.end(html);
          });
        },
      },
    ],
  });
  await server.listen();
});

test.afterAll(async () => server.close());

test("Phaser renders Rust projections and settles without canonical mutation", async ({ page }, testInfo) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish the Phaser adapter fixture");
  }
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") {
      pageErrors.push(message.text());
    }
  });
  await page.goto(new URL("m8-phaser-adapter.html", address).href);
  try {
    await page.waitForFunction(() => "__m8AdapterResult" in globalThis, undefined, { timeout: 15_000 });
  } catch (error) {
    throw new Error(`Phaser adapter did not settle: ${String(error)}; page errors: ${pageErrors.join(" | ")}`);
  }
  const result = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __m8AdapterResult: { outcome: string; trace: unknown[]; names: string[]; unchanged: boolean };
        }
      ).__m8AdapterResult,
  );
  expect(result.outcome).toBe("SETTLED");
  expect(result.trace).toHaveLength(1);
  expect(result.names).toEqual(expect.arrayContaining(["rust-logical-ui-v1", "rust-surface-v1"]));
  expect(result.unchanged).toBe(true);
  await expect(page.locator("canvas")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phaser-rust-adapter.png") });
  await page.evaluate(() =>
    (
      globalThis as typeof globalThis & {
        __m8AdapterDispose(): void;
      }
    ).__m8AdapterDispose(),
  );
});
