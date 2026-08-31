import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { expect, type Page, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

const fixtureRoot = process.env.M8_RUST_BROWSER_FIXTURE_DIR;
interface M9RealBrowserResult {
  completed_battles: number;
  control: string;
  final_state_digest: string;
  final_state: {
    active_run: {
      wave: number;
      battle: { battle_id: number; outcome: string };
      inventory: { entries: Array<{ item: number; registry_key: string; count: number }> };
    };
  };
}
if (fixtureRoot == null) {
  throw new Error("M8_RUST_BROWSER_FIXTURE_DIR is required");
}
const fixture = resolve(fixtureRoot);
let server: ViteDevServer;
const html = `<!doctype html><html><body><script type="module">
import init, { M9ProductionSliceSessionV1 } from "/m9-assets/er_web.js";
try {
  const wasm = new Uint8Array(await (await fetch("/m9-assets/er_web.wasm")).arrayBuffer());
  await init({ module_or_path: wasm });
  const content = await (await fetch("/m9-assets/m9-content-pack.json")).text();
  const starter = await (await fetch("/m9-assets/starter-oracle-v1.json")).text();
  const session = new M9ProductionSliceSessionV1(content, starter);
  document.addEventListener("keydown", event => {
    try {
      session.key_down(event.code, event.repeat);
    } catch (error) {
      globalThis.__m9RealError = String(error?.stack ?? error);
    }
  });
  document.addEventListener("keyup", event => {
    try {
      session.key_up(event.code);
    } catch (error) {
      globalThis.__m9RealError = String(error?.stack ?? error);
    }
  });
  globalThis.__m9RealSession = {
    control: () => session.control(),
    result: () => JSON.parse(session.result_json()),
  };
} catch (error) {
  globalThis.__m9RealError = String(error?.stack ?? error);
}
</script></body></html>`;

function serveFixture(request: IncomingMessage, response: ServerResponse, next: () => void): void {
  if (request.url === "/m9-real-solo.html") {
    response.setHeader("content-type", "text/html");
    response.end(html);
    return;
  }
  if (!request.url?.startsWith("/m9-assets/")) {
    next();
    return;
  }
  serveFixtureAsset(request.url.slice("/m9-assets/".length), response);
}

function serveFixtureAsset(name: string, response: ServerResponse): void {
  if (!/^[a-z0-9._-]+$/iu.test(name)) {
    response.statusCode = 400;
    response.end();
    return;
  }
  try {
    const bytes = readFileSync(resolve(fixture, name));
    response.setHeader("content-type", fixtureContentType(name));
    response.end(bytes);
  } catch {
    response.statusCode = 404;
    response.end();
  }
}

function fixtureContentType(name: string): string {
  if (name.endsWith(".wasm")) {
    return "application/wasm";
  }
  return name.endsWith(".js") ? "text/javascript" : "application/json";
}

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m9-real-solo",
        configureServer(devServer) {
          devServer.middlewares.use(serveFixture);
        },
      },
    ],
  });
  await server.listen();
});

test.afterAll(async () => server.close());

test("physical browser keys drive real Wasm gameplay to the next encounter", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish the M9 real gameplay fixture");
  }
  await page.goto(new URL("m9-real-solo.html", address).href);
  await page.waitForFunction(() => "__m9RealSession" in globalThis || "__m9RealError" in globalThis);
  await expectNoBrowserError(page);

  for (const key of ["Space", "Space", "Space", "ArrowDown", "Space", "Space", "Space", "Space"]) {
    await page.keyboard.press(key);
  }
  expect(await browserControl(page)).toBe("COMMAND_ROOT");

  for (let turn = 0; turn < 64; turn += 1) {
    await page.keyboard.press("Space");
    expect(await browserControl(page)).toBe("MOVE_SELECT");
    await page.keyboard.press("Space");
    const control = await browserControl(page);
    if (control === "REWARD") {
      break;
    }
    expect(control).toBe("COMMAND_ROOT");
  }
  expect(await browserControl(page)).toBe("REWARD");
  await page.keyboard.press("Space");
  await expectNoBrowserError(page);
  const result = await page.evaluate(() =>
    (
      globalThis as typeof globalThis & {
        __m9RealSession: { result(): M9RealBrowserResult };
      }
    ).__m9RealSession.result(),
  );
  expect(result).toMatchObject({
    completed_battles: 1,
    control: "COMMAND_ROOT",
    final_state: {
      active_run: {
        wave: 2,
        battle: { battle_id: 2, outcome: "ONGOING" },
        inventory: { entries: [{ item: 400, registry_key: "POKEBALL", count: 1 }] },
      },
    },
  });
  expect(result.final_state_digest).toMatch(/^blake3-v1:[0-9a-f]{64}$/u);
});

async function browserControl(page: Page): Promise<string> {
  return page.evaluate(() =>
    (
      globalThis as typeof globalThis & {
        __m9RealSession: { control(): string };
      }
    ).__m9RealSession.control(),
  );
}

async function expectNoBrowserError(page: Page): Promise<void> {
  const error = await page.evaluate(() => (globalThis as typeof globalThis & { __m9RealError?: string }).__m9RealError);
  expect(error).toBeUndefined();
}
