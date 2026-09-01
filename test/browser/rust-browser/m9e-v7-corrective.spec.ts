import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { expect, type Page, test } from "playwright/test";

const fixtureRoot = process.env.M9E_V7_WEB_DIR;
if (fixtureRoot == null) {
  throw new Error("M9E_V7_WEB_DIR is required");
}
const fixture = resolve(fixtureRoot);
let server: Server;
let address: string;

test.setTimeout(180_000);

const html = `<!doctype html><html><body><div id="status">loading</div><script type="module">
const status = document.querySelector("#status");
try {
// Dynamic import keeps Wasm bootstrap failures observable; static import errors occur before the harness can report them.
const { default: init, BrowserKernelHostV2 } = await import("/m9e-assets/er_web.js");
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
const createClient = async (snapshot, seat, role) => {
  const clientHost = new BrowserKernelHostV2(bundle); let clientSequence = 0; let clientRequest = 1;
  const clientSend = async request => {
    const envelope = { request, request_id: clientRequest++, sequence: clientSequence++, version: 2 };
    const response = JSON.parse(decoder.decode(clientHost.process(bytes(envelope)))).response;
    if (response.kind === "EFFECTS") for (const effect of response.batch.effects) if (effect.kind === "PRESENTATION") await clientSend({ kind: "PRESENTATION_SETTLED", event_id: effect.effect.event_id, outcome: { kind: "SETTLED" } });
    return response;
  };
  await clientSend({ kind: "INITIALIZE", initialization: { kind: "SNAPSHOT", context: { local_seat: seat, role, protocol: null, scheduler: { disposed: false, next_timer_id: null, pauses: [], timers: [] } }, snapshot } });
  return { send: clientSend };
};
const rawPress = async client => {
  await client.send({ kind: "RAW_INPUT", event: { kind: "KEY_DOWN", data: { code: { kind: "SPACE" }, printable: false, browser_repeat: false, focus: "GAME" } } });
  return client.send({ kind: "RAW_INPUT", event: { kind: "KEY_UP", data: { code: { kind: "SPACE" } } });
};
const networkBytes = response => response.batch.effects.find(effect => effect.kind === "SEND_NETWORK_FRAME")?.bytes;
const coop = async () => {
  const authoritySnapshot = await (await fetch("/m9e-assets/coop-authority-snapshot.json")).json();
  const replicaSnapshot = await (await fetch("/m9e-assets/coop-replica-snapshot.json")).json();
  const authority = await createClient(authoritySnapshot, 1, "AUTHORITY");
  const replica = await createClient(replicaSnapshot, 2, "REPLICA");
  const initialTurn = authoritySnapshot.lifecycle.value.active_run.battle.turn;
  await rawPress(authority); const retained = await rawPress(authority);
  const retainedBytes = networkBytes(retained); if (retainedBytes == null) throw new Error("retention material missing");
  await replica.send({ kind: "NETWORK_FRAME", generation: 1, bytes: retainedBytes });
  await rawPress(replica); const proposal = await rawPress(replica);
  const proposalBytes = networkBytes(proposal); if (proposalBytes == null) throw new Error("guest proposal missing");
  const resolved = await authority.send({ kind: "NETWORK_FRAME", generation: 1, bytes: proposalBytes });
  const materialBytes = networkBytes(resolved); if (materialBytes == null) throw new Error("turn material missing");
  await replica.send({ kind: "NETWORK_FRAME", generation: 1, bytes: materialBytes });
  const authorityAfter = (await authority.send({ kind: "SNAPSHOT" })).snapshot;
  const replicaAfter = (await replica.send({ kind: "SNAPSHOT" })).snapshot;
  return { converged: JSON.stringify(canonical(authorityAfter.lifecycle)) === JSON.stringify(canonical(replicaAfter.lifecycle)), turnAdvanced: authorityAfter.lifecycle.value.active_run.battle.turn > initialTurn };
};
globalThis.__m9eV7 = { idle: () => pending, snapshot, send, coop };
status.textContent = "ready";
} catch (error) {
  status.textContent = "error: " + (error instanceof Error ? error.stack : String(error));
}
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

interface CoopResult {
  converged: boolean;
  turnAdvanced: boolean;
}

declare global {
  var __m9eV7: {
    idle: () => Promise<void>;
    snapshot: () => Promise<SnapshotWire>;
    send: (request: unknown) => Promise<ResponseWire>;
    coop: () => Promise<CoopResult>;
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

function assetContentType(name: string) {
  if (name.endsWith(".js")) {
    return "text/javascript";
  }
  if (name.endsWith(".wasm")) {
    return "application/wasm";
  }
  return "application/json";
}

function serveAsset(name: string, response: ServerResponse) {
  if (!/^[a-z0-9_.-]+$/u.test(name)) {
    response.statusCode = 400;
    response.end();
    return;
  }
  response.setHeader("content-type", assetContentType(name));
  try {
    response.end(readFileSync(resolve(fixture, name)));
  } catch {
    response.statusCode = 404;
    response.end();
  }
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url?.startsWith("/m9e-assets/")) {
      serveAsset(request.url.slice(13), response);
      return;
    }
    if (request.url === "/m9e-v7.html") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(html);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const bound = server.address();
  if (bound == null || typeof bound === "string") {
    throw new Error("browser fixture server address missing");
  }
  address = `http://127.0.0.1:${bound.port}/`;
});
test.afterAll(
  async () =>
    new Promise<void>((resolveClose, rejectClose) => {
      server.close(error => (error == null ? resolveClose() : rejectClose(error)));
    }),
);

async function press(page: Page, key: string) {
  await page.keyboard.press(key);
  await page.evaluate(() => globalThis.__m9eV7.idle());
}

// Real Chromium -> DOM keyboard -> canonical BrowserRequestV2 -> BrowserKernelHostV2 -> GameKernelV7.
test("natural V7 browser startup reaches the real battle command", async ({ page }) => {
  await page.goto(new URL("m9e-v7.html", address).href);
  await expect(page.locator("#status")).toHaveText("ready", { timeout: 120_000 });
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

test("two V7 browser hosts wait for both humans and converge one turn", async ({ page }) => {
  await page.goto(new URL("m9e-v7.html", address).href);
  await expect(page.locator("#status")).toHaveText("ready", { timeout: 120_000 });
  const result = await page.evaluate(() => globalThis.__m9eV7.coop());
  expect(result.turnAdvanced).toBe(true);
  expect(result.converged).toBe(true);
});
