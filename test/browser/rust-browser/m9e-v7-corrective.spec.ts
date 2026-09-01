import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

const fixtureRoot = process.env.M9E_V7_WEB_DIR;
if (fixtureRoot == null) {
  throw new Error("M9E_V7_WEB_DIR is required");
}
const fixture = resolve(fixtureRoot);
let server: ViteDevServer;

const html = `<!doctype html><html><body><div id="status">loading</div><script type="module">
import init, { BrowserKernelHostV2 } from "/m9e-assets/er_web.js";
const encoder = new TextEncoder(); const decoder = new TextDecoder();
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const bytes = value => encoder.encode(JSON.stringify(canonical(value)));
await init("/m9e-assets/er_web_bg.wasm");
const bundle = new Uint8Array(await (await fetch("/m9e-assets/game-content-bundle-v2.json")).arrayBuffer());
const host = new BrowserKernelHostV2(bundle); let sequence = 0; let requestId = 1;
const send = async request => {
  const envelope = { request, request_id: requestId++, sequence: sequence++, version: 2 };
  const response = JSON.parse(decoder.decode(host.process(bytes(envelope))));
  if (response.response.kind === "EFFECTS") {
    for (const effect of response.response.batch.effects) {
      if (effect.kind === "PRESENTATION") await send({ kind: "PRESENTATION_SETTLED", event_id: effect.effect.event_id, outcome: { kind: "SETTLED" } });
    }
  }
  return response.response;
};
await send({ kind: "INITIALIZE", initialization: { kind: "NATURAL_START", context: {
  local_seat: 1, role: "AUTHORITY", protocol: null,
  scheduler: { disposed: false, next_timer_id: null, pauses: [], timers: [] }
}, local_is_host: true, profile: {
  schema_version: 1, unlocks: [], achievements: [], challenges: [], flags: [], dex: { entries: [] },
  statistics: { runs_started: 0, runs_won: 0, runs_lost: 0, battles_won: 0, pokemon_captured: 0, highest_wave: 1 }
}, save_slots: ["browser-v7-slot"], seed: "browser-v7-corrective" } });
const key = code => ({ kind: code.startsWith("Arrow") ? code.replace("Arrow", "ARROW_").toUpperCase() : code.toUpperCase() });
let pending = Promise.resolve();
for (const kind of ["keydown", "keyup"]) document.addEventListener(kind, event => {
  if (!["Space","Enter","Escape","Backspace","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.code)) return;
  pending = pending.then(() => send(kind === "keydown" ? { kind: "RAW_INPUT", event: { kind: "KEY_DOWN", data: { code: key(event.code), printable: false, browser_repeat: event.repeat, focus: "GAME" } } } : { kind: "RAW_INPUT", event: { kind: "KEY_UP", data: { code: key(event.code) } } }));
});
const snapshot = async () => (await send({ kind: "SNAPSHOT" })).snapshot;
globalThis.__m9eV7 = { idle: () => pending, snapshot, send };
document.querySelector("#status").textContent = "ready";
</script></body></html>`;

interface ControlWire {
  kind: string;
  menu: { selected_option_id: string } | null;
}

type SnapshotWire = {
  lifecycle:
    | { kind: "BOOTSTRAP"; value: { control: ControlWire } }
    | { kind: "ACTIVE"; value: { active_run: { control: ControlWire; battle: unknown } } }
    | { kind: "TERMINAL"; value: { control: ControlWire } };
};

interface ResponseWire {
  kind: string;
}

declare global {
  var __m9eV7: {
    idle: () => Promise<void>;
    snapshot: () => Promise<SnapshotWire>;
    send: (request: unknown) => Promise<ResponseWire>;
  };
}

function currentControl(snapshot: SnapshotWire): ControlWire {
  const lifecycle = snapshot.lifecycle;
  if (lifecycle.kind === "BOOTSTRAP") {
    return lifecycle.value.control;
  }
  if (lifecycle.kind === "ACTIVE") {
    return lifecycle.value.active_run.control;
  }
  return lifecycle.value.control;
}

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m9e-v7-assets",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/m9e-assets/")) {
              const name = request.url.slice(13);
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
                    : "application/json",
              );
              try {
                response.end(readFileSync(resolve(fixture, name)));
              } catch {
                response.statusCode = 404;
                response.end();
              }
              return;
            }
            if (request.url === "/m9e-v7.html") {
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

async function press(page: Page, key: string) {
  await page.keyboard.press(key);
  await page.evaluate(() => globalThis.__m9eV7.idle());
}

// Real Chromium -> DOM keyboard -> canonical BrowserRequestV2 -> BrowserKernelHostV2 -> GameKernelV7.
test("natural V7 browser startup reaches the real battle command", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite URL missing");
  }
  await page.goto(new URL("m9e-v7.html", address).href);
  await expect(page.locator("#status")).toHaveText("ready", { timeout: 30_000 });
  await press(page, "Space");
  await press(page, "Space");
  await press(page, "Space");
  for (let index = 0; index < 800; index++) {
    const snapshot = await page.evaluate(() => globalThis.__m9eV7.snapshot());
    const menu = currentControl(snapshot).menu;
    if (menu?.selected_option_id === "bootstrap/starter/confirm") {
      break;
    }
    await press(page, "ArrowDown");
  }
  await press(page, "Space");
  await press(page, "Space");
  await press(page, "Space");
  await press(page, "Space");
  const snapshot = await page.evaluate(() => globalThis.__m9eV7.snapshot());
  const lifecycle = snapshot.lifecycle;
  expect(lifecycle.kind).toBe("ACTIVE");
  expect(currentControl(snapshot).kind).toBe("BATTLE_COMMAND");
  if (lifecycle.kind !== "ACTIVE") {
    throw new Error("active lifecycle missing");
  }
  expect(lifecycle.value.active_run.battle).not.toBeNull();
  const advanced = await page.evaluate(() => globalThis.__m9eV7.send({ kind: "ADVANCE_TIME", milliseconds: 16 }));
  expect(advanced.kind).toBe("EFFECTS");
});
