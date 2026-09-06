import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { expect, type Page, test } from "playwright/test";
import { assertCurrentReproCliBridge } from "./m9e-current-repro-bridge";

const fixtureRoot = process.env.M9E_V7_WEB_DIR;
if (fixtureRoot == null) {
  throw new Error("M9E_V7_WEB_DIR is required");
}
const fixture = resolve(fixtureRoot);
let server: Server;
let address: string;

test.setTimeout(300_000);

const html = `<!doctype html><html><body><div id="status">loading</div><script type="module">
const status = document.querySelector("#status");
try {
status.textContent = "importing-module";
// Dynamic import keeps Wasm bootstrap failures observable; static import errors occur before the harness can report them.
const { default: init, BrowserKernelHostV2 } = await import("/m9e-assets/er_web.js");
status.textContent = "initializing-wasm";
const encoder = new TextEncoder(); const decoder = new TextDecoder();
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const bytes = value => encoder.encode(JSON.stringify(canonical(value)));
await init("/m9e-assets/er_web_bg.wasm");
status.textContent = "loading-content";
const bundle = new Uint8Array(await (await fetch("/m9e-assets/game-content-bundle-v2.json")).arrayBuffer());
const solo = !new URLSearchParams(location.search).has("coop");
status.textContent = solo ? "preparing-content" : "ready";
const host = solo ? new BrowserKernelHostV2(bundle) : null; let sequence = 0; let requestId = 1;
const send = async request => {
  if (host == null) throw new Error("solo browser host is unavailable");
  const envelope = { request, request_id: requestId++, sequence: sequence++, version: 2 };
  const response = JSON.parse(decoder.decode(host.process(bytes(envelope))));
  if (response.response.kind === "EFFECTS") {
    for (const effect of response.response.batch.effects) {
      if (effect.kind === "PRESENTATION") await send({ kind: "PRESENTATION_SETTLED", event_id: effect.effect.event_id, outcome: { kind: "SETTLED" } });
    }
  }
  return response.response;
};
if (solo) status.textContent = "initializing-kernel";
if (solo) await send({ kind: "INITIALIZE", initialization: { kind: "NATURAL_START", context: {
  local_seat: 1, role: "AUTHORITY", protocol: null,
  scheduler: { disposed: false, next_timer_id: 0, pauses: [], timers: [] }
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
const control = snapshot => snapshot.lifecycle.kind === "BOOTSTRAP" ? snapshot.lifecycle.value.control : snapshot.lifecycle.kind === "ACTIVE" ? snapshot.lifecycle.value.active_run.control : snapshot.lifecycle.value.control;
const domPress = async code => {
  document.dispatchEvent(new KeyboardEvent("keydown", { code }));
  document.dispatchEvent(new KeyboardEvent("keyup", { code }));
  await pending;
};
const navigate = async option => {
  const first = await snapshot();
  const bound = (control(first).menu?.options.length ?? 0) + 1;
  for (let index = 0; index < bound; index++) {
    const current = await snapshot();
    if (control(current).menu?.selected_option_id === option) return;
    await domPress("ArrowDown");
  }
  throw new Error("browser option is unreachable: " + option);
};
const createClient = async (snapshot, seat, role) => {
  const clientHost = new BrowserKernelHostV2(bundle); let clientSequence = 0; let clientRequest = 1;
  const clientSend = async (request, settlePresentation = true) => {
    const envelope = { request, request_id: clientRequest++, sequence: clientSequence++, version: 2 };
    const response = JSON.parse(decoder.decode(clientHost.process(bytes(envelope)))).response;
    if (settlePresentation && response.kind === "EFFECTS") for (const effect of response.batch.effects) if (effect.kind === "PRESENTATION") await clientSend({ kind: "PRESENTATION_SETTLED", event_id: effect.effect.event_id, outcome: { kind: "SETTLED" } });
    return response;
  };
  await clientSend({ kind: "INITIALIZE", initialization: { kind: "SNAPSHOT", context: { local_seat: seat, role, protocol: null, scheduler: { disposed: false, next_timer_id: null, pauses: [], timers: [] } }, snapshot } });
  return { send: clientSend };
};
const rawPress = async client => {
  const down = await client.send({ kind: "RAW_INPUT", event: { kind: "KEY_DOWN", data: { code: { kind: "SPACE" }, printable: false, browser_repeat: false, focus: "GAME" } } });
  const up = await client.send({ kind: "RAW_INPUT", event: { kind: "KEY_UP", data: { code: { kind: "SPACE" } } } });
  return [down, up];
};
const networkBytes = responses => (Array.isArray(responses) ? responses : [responses]).flatMap(response => response.kind === "EFFECTS" ? response.batch.effects : []).find(effect => effect.kind === "SEND_NETWORK_FRAME")?.bytes;
const effectsOf = response => {
  if (response.kind !== "EFFECTS") throw new Error("expected browser effects: " + response.kind);
  return response.batch.effects;
};
const presentationsOf = response => effectsOf(response).filter(effect => effect.kind === "PRESENTATION").map(effect => effect.effect);
const sameSnapshot = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
// Two Wasm hosts in one Chromium page relay real canonical material bytes in-page.
// This harness does not provide Worker or WebRTC transport coverage.
const coop = async () => {
  const authoritySnapshot = await (await fetch("/m9e-assets/coop-authority-snapshot.json")).json();
  const replicaSnapshot = await (await fetch("/m9e-assets/coop-replica-snapshot.json")).json();
  const authority = await createClient(authoritySnapshot, 1, "AUTHORITY");
  const replica = await createClient(replicaSnapshot, 2, "REPLICA");
  const initialTurn = authoritySnapshot.lifecycle.value.active_run.battle.turn;
  await rawPress(authority); const retained = await rawPress(authority);
  const retainedBytes = networkBytes(retained); if (retainedBytes == null) throw new Error("retention material missing");
  await replica.send({ kind: "NETWORK_FRAME", generation: 1, bytes: retainedBytes });
  await rawPress(replica);
  const privateMove = (await replica.send({ kind: "SNAPSHOT" })).snapshot;
  const privateDuplicate = await replica.send({ kind: "NETWORK_FRAME", generation: 1, bytes: retainedBytes });
  const privateAfterDuplicate = (await replica.send({ kind: "SNAPSHOT" })).snapshot;
  const proposal = await rawPress(replica);
  const proposalBytes = networkBytes(proposal); if (proposalBytes == null) throw new Error("guest proposal missing");
  const resolved = await authority.send({ kind: "NETWORK_FRAME", generation: 1, bytes: proposalBytes });
  const materialBytes = networkBytes(resolved); if (materialBytes == null) throw new Error("turn material missing");
  const material = JSON.parse(decoder.decode(new Uint8Array(materialBytes)));
  const expectedPresentation = material.value.presentation;
  const delivered = await replica.send({ kind: "NETWORK_FRAME", generation: 1, bytes: materialBytes }, false);
  const pending = (await replica.send({ kind: "SNAPSHOT" })).snapshot;
  const duplicateBefore = await replica.send({ kind: "NETWORK_FRAME", generation: 1, bytes: materialBytes }, false);
  const afterDuplicateBefore = (await replica.send({ kind: "SNAPSHOT" })).snapshot;
  // Acknowledge only the actual replica-delivered IDs, through the public host boundary.
  for (const effect of presentationsOf(delivered)) {
    await replica.send({ kind: "PRESENTATION_SETTLED", event_id: effect.event_id, outcome: { kind: "SETTLED" } });
  }
  const settled = (await replica.send({ kind: "SNAPSHOT" })).snapshot;
  const duplicateAfter = await replica.send({ kind: "NETWORK_FRAME", generation: 1, bytes: materialBytes }, false);
  const authorityAfter = (await authority.send({ kind: "SNAPSHOT" })).snapshot;
  const replicaAfter = (await replica.send({ kind: "SNAPSHOT" })).snapshot;
  return {
    converged: sameSnapshot(authorityAfter.lifecycle, replicaAfter.lifecycle),
    turnAdvanced: authorityAfter.lifecycle.value.active_run.battle.turn > initialTurn,
    privateControlKind: control(privateMove).kind,
    privateDuplicateEffects: effectsOf(privateDuplicate),
    privateSnapshotUnchanged: sameSnapshot(privateMove, privateAfterDuplicate),
    expectedPresentation,
    authorityPresentation: presentationsOf(resolved),
    replicaPresentation: presentationsOf(delivered),
    replicaScenes: effectsOf(delivered).filter(effect => effect.kind === "PRESENTATION_SCENE_CHANGED").map(effect => effect.semantic),
    pendingPresentation: pending.pending_presentations,
    settledPresentation: settled.pending_presentations,
    duplicateBeforeEffects: effectsOf(duplicateBefore),
    duplicateAfterEffects: effectsOf(duplicateAfter),
    pendingSnapshotUnchanged: sameSnapshot(pending, afterDuplicateBefore),
    settledSnapshotUnchanged: sameSnapshot(settled, replicaAfter)
  };
};
globalThis.__m9eV7 = { idle: () => pending, snapshot, send, navigate, coop };
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
  batch?: { effects: { kind: string; capsule_bytes?: number[] }[] };
}

interface CoopResult {
  converged: boolean;
  turnAdvanced: boolean;
  privateControlKind: string;
  privateDuplicateEffects: unknown[];
  privateSnapshotUnchanged: boolean;
  expectedPresentation: PresentationWire[];
  authorityPresentation: PresentationWire[];
  replicaPresentation: PresentationWire[];
  replicaScenes: unknown[];
  pendingPresentation: PresentationWire[];
  settledPresentation: PresentationWire[];
  duplicateBeforeEffects: unknown[];
  duplicateAfterEffects: unknown[];
  pendingSnapshotUnchanged: boolean;
  settledSnapshotUnchanged: boolean;
}

interface PresentationWire {
  event_id: number;
  semantic: unknown;
  blocking: unknown;
  skip: unknown;
}

declare global {
  var __m9eV7: {
    idle: () => Promise<void>;
    snapshot: () => Promise<SnapshotWire>;
    send: (request: unknown) => Promise<ResponseWire>;
    navigate: (option: string) => Promise<void>;
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
    const assetPrefix = "/m9e-assets/";
    if (request.url?.startsWith(assetPrefix)) {
      serveAsset(request.url.slice(assetPrefix.length), response);
      return;
    }
    if (request.url === "/m9e-v7.html" || request.url?.startsWith("/m9e-v7.html?")) {
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

async function openFixture(page: Page, path: string) {
  let rejectPageError: (reason: unknown) => void = () => undefined;
  const pageError = new Promise<never>((_resolve, reject) => {
    rejectPageError = reject;
  });
  const onPageError = (error: Error) => rejectPageError(error);
  page.once("pageerror", onPageError);
  try {
    await page.goto(new URL(path, address).href);
    const status = page.locator("#status");
    await Promise.race([expect(status).toHaveText(/^(?:ready|error:)/u, { timeout: 240_000 }), pageError]);
    const text = await status.textContent();
    if (text !== "ready") {
      throw new Error(text ?? "browser fixture status missing");
    }
  } finally {
    page.off("pageerror", onPageError);
  }
}

// Real Chromium -> DOM keyboard -> canonical BrowserRequestV2 -> BrowserKernelHostV2 -> GameKernelV7.
test("natural V7 browser startup reaches the real battle command", async ({ page }) => {
  await openFixture(page, "m9e-v7.html");
  await press(page, "Space");
  await press(page, "Space");
  await press(page, "Space");
  await page.evaluate(() => globalThis.__m9eV7.navigate("bootstrap/starter/confirm"));
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
  await page.keyboard.down("ArrowDown");
  await page.evaluate(() => globalThis.__m9eV7.idle());
  expect(currentControl(await page.evaluate(() => globalThis.__m9eV7.snapshot())).menu?.selected_option_id).toBe("battle/command/party");
  await page.evaluate(() => globalThis.__m9eV7.send({ kind: "ADVANCE_TIME", milliseconds: 249 }));
  expect(currentControl(await page.evaluate(() => globalThis.__m9eV7.snapshot())).menu?.selected_option_id).toBe("battle/command/party");
  await page.evaluate(() => globalThis.__m9eV7.send({ kind: "ADVANCE_TIME", milliseconds: 1 }));
  expect(currentControl(await page.evaluate(() => globalThis.__m9eV7.snapshot())).menu?.selected_option_id).toBe("battle/command/fight");
  await page.keyboard.up("ArrowDown");
  await page.evaluate(() => globalThis.__m9eV7.idle());
  await page.evaluate(() => globalThis.__m9eV7.send({ kind: "ADVANCE_TIME", milliseconds: 500 }));
  const finalSnapshot = await page.evaluate(() => globalThis.__m9eV7.snapshot());
  expect(currentControl(finalSnapshot).menu?.selected_option_id).toBe("battle/command/fight");
  const capsuleBytes = await page.evaluate(async () => {
    const response = await globalThis.__m9eV7.send({ kind: "EXPORT_REPRO" });
    const effects = response.batch?.effects;
    if (response.kind !== "EFFECTS" || effects?.length !== 1
      || effects[0].kind !== "CURRENT_REPRO_READY" || effects[0].capsule_bytes == null) {
      throw new Error("actual Wasm host did not export one current capsule");
    }
    return effects[0].capsule_bytes;
  });
  const bridge = await assertCurrentReproCliBridge(capsuleBytes, finalSnapshot, resolve(fixture, "game-content-bundle-v2.json"));
  await test.info().attach("m9e-current-repro-cli-bridge", {
    contentType: "application/json", body: Buffer.from(JSON.stringify(bridge)),
  });
});

test("two V7 browser hosts wait for both humans and converge one turn", async ({ page }) => {
  await openFixture(page, "m9e-v7.html?coop");
  const result = await page.evaluate(() => globalThis.__m9eV7.coop());
  expect(result.turnAdvanced).toBe(true);
  expect(result.converged).toBe(true);
  expect(result.privateControlKind).toBe("BATTLE_MOVE");
  expect(result.privateDuplicateEffects).toEqual([]);
  expect(result.privateSnapshotUnchanged).toBe(true);
  expect(result.expectedPresentation.length).toBeGreaterThan(0);
  expect(new Set(result.expectedPresentation.map(effect => effect.event_id)).size).toBe(
    result.expectedPresentation.length,
  );
  expect(result.authorityPresentation).toEqual(result.expectedPresentation);
  expect(result.replicaPresentation).toEqual(result.expectedPresentation);
  expect(result.replicaScenes).toEqual(result.expectedPresentation.map(effect => effect.semantic));
  expect(result.pendingPresentation).toEqual(
    [...result.expectedPresentation].sort((left, right) => left.event_id - right.event_id),
  );
  expect(result.settledPresentation).toEqual([]);
  expect(result.duplicateBeforeEffects).toEqual([]);
  expect(result.duplicateAfterEffects).toEqual([]);
  expect(result.pendingSnapshotUnchanged).toBe(true);
  expect(result.settledSnapshotUnchanged).toBe(true);
});
