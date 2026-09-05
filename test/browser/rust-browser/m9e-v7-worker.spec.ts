import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { relative, resolve, sep } from "node:path";
import { expect, test } from "playwright/test";
import type { BrowserRequestV2 } from "../../../src/rust-browser/contracts/browser-contracts-v2";

// Same bounded allowance as the existing real V7 in-page witnesses.
test.setTimeout(300_000);
const root = process.env.M9E_V7_WEB_DIR;
if (root == null) throw new Error("M9E_V7_WEB_DIR is required");
const fixture = realpathSync(root);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
interface Asset { bytes: number; sha256: string; role?: "entry" | "worker" | "chunk" }
interface Manifest {
  schema_version: number;
  browser_worker_protocol_version: number;
  source_sha: string;
  entry: string;
  worker: string;
  assets: Record<string, Asset>;
  cohort: { glue_sha256: string; wasm_sha256: string; content_sha256: string };
}
function boundedFile(path: string, maximum: number): Buffer {
  if (!/^[a-zA-Z0-9_.\/-]+$/u.test(path) || path.split("/").some(part => part === ".." || part === "." || part === "")) {
    throw new Error("invalid Worker fixture path");
  }
  const absolute = resolve(fixture, path);
  const info = lstatSync(absolute);
  const actual = realpathSync(absolute);
  const contained = relative(fixture, actual);
  if (!info.isFile() || info.isSymbolicLink() || contained === ".." || contained.startsWith(`..${sep}`)
    || resolve(fixture, contained) !== actual || info.size < 1 || info.size > maximum) {
    throw new Error("Worker fixture file escapes its regular bounded asset root");
  }
  return readFileSync(actual);
}
const manifestBytes = boundedFile("m9e-v7-worker-assets.json", 32 * 1024);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
const cohort = JSON.parse(boundedFile("m9e-v7-web-assets.json", 32 * 1024).toString("utf8")) as {
  source_sha: string; assets: Record<string, Asset>;
};
if (manifest.schema_version !== 1 || manifest.browser_worker_protocol_version !== 2
  || !/^[0-9a-f]{40}$/u.test(manifest.source_sha) || manifest.source_sha !== cohort.source_sha
  || (process.env.GITHUB_SHA != null && manifest.source_sha !== process.env.GITHUB_SHA)
  || manifest.entry !== "current-worker-entry.js"
  || manifest.assets[manifest.entry]?.role !== "entry" || manifest.assets[manifest.worker]?.role !== "worker"
  || Object.keys(manifest.assets).length > 8
  || Object.values(manifest.assets).filter(asset => asset.role === "worker").length !== 1
  || Object.values(manifest.assets).filter(asset => asset.role === "entry").length !== 1) {
  throw new Error("Worker manifest identity or emitted roles are invalid");
}
const served = new Map<string, Buffer>();
let totalBundleBytes = 0;
for (const [path, asset] of Object.entries(manifest.assets)) {
  const bytes = boundedFile(path, 4 << 20);
  if (!path.endsWith(".js") || !["entry", "worker", "chunk"].includes(asset.role ?? "")
    || asset.bytes !== bytes.length || asset.sha256 !== sha(bytes)) throw new Error("Worker emitted asset mismatch");
  totalBundleBytes += bytes.length;
  served.set(`/m9e-assets/${path}`, bytes);
}
if (totalBundleBytes > 4 << 20) throw new Error("Worker bundle aggregate exceeds its bound");
for (const [path, expected] of [
  ["er_web.js", manifest.cohort.glue_sha256],
  ["er_web_bg.wasm", manifest.cohort.wasm_sha256],
  ["game-content-bundle-v2.json", manifest.cohort.content_sha256],
] as const) {
  const bytes = boundedFile(path, path.endsWith(".js") ? 4 << 20 : 32 << 20);
  if (expected !== sha(bytes) || cohort.assets[path]?.sha256 !== expected || cohort.assets[path]?.bytes !== bytes.length) {
    throw new Error("Worker Wasm cohort mismatch");
  }
  served.set(`/m9e-assets/${path}`, bytes);
}
let server: Server;
let address: string;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><html><body>Current V2 Worker fixture</body></html>");
      return;
    }
    const body = served.get(url.pathname);
    if (body == null) { response.writeHead(404); response.end(); return; }
    // A real verified Wasm fetch is observed before externally killing this
    // Worker. Never respond: the client's bounded deadline must settle its work.
    if (url.pathname.endsWith("/er_web_bg.wasm") && url.search === "?blocked=1") return;
    response.writeHead(200, { "content-type": url.pathname.endsWith(".wasm") ? "application/wasm"
      : url.pathname.endsWith(".js") ? "text/javascript" : "application/json", "cache-control": "no-store" });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = server.address();
  if (socket == null || typeof socket === "string") throw new Error("Worker fixture did not bind TCP");
  address = `http://127.0.0.1:${socket.port}`;
});
test.afterAll(async () => {
  if (server == null) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
});
const initialization: BrowserRequestV2 = { kind: "INITIALIZE", initialization: {
  kind: "NATURAL_START", context: { local_seat: 1, role: "AUTHORITY", protocol: null,
    scheduler: { disposed: false, next_timer_id: 0, pauses: [], timers: [] } },
  local_is_host: true, profile: { schema_version: 1, unlocks: [], achievements: [], challenges: [], flags: [],
    dex: { entries: [] }, statistics: { runs_started: 0, runs_won: 0, runs_lost: 0, battles_won: 0,
      pokemon_captured: 0, highest_wave: 1 } }, save_slots: ["browser-v7-slot"], seed: "browser-v7-corrective",
} };
function assets(blocked = false) {
  return { wasm_url: `${address}/m9e-assets/er_web_bg.wasm${blocked ? "?blocked=1" : ""}`,
    wasm_sha256: manifest.cohort.wasm_sha256, glue_url: `${address}/m9e-assets/er_web.js`,
    glue_sha256: manifest.cohort.glue_sha256, content_url: `${address}/m9e-assets/game-content-bundle-v2.json`,
    content_sha256: manifest.cohort.content_sha256 };
}
function binding(observed: string[]) {
  expect(observed.length).toBeGreaterThan(0);
  for (const url of observed) {
    expect(new URL(url).origin).toBe(address);
    expect(new URL(url).pathname).toBe(`/m9e-assets/${manifest.worker}`);
  }
  return { schema_version: 1, source_sha: manifest.source_sha, manifest_sha256: sha(manifestBytes),
    entry_sha256: manifest.assets[manifest.entry].sha256, worker_sha256: manifest.assets[manifest.worker].sha256,
    worker_path: manifest.worker, ...manifest.cohort, browser_worker_protocol_version: 2,
    observed_worker_count: observed.length };
}

test("current V7 Worker executes natural input and presentation settlement", async ({ page }, testInfo) => {
  const observed: string[] = [];
  page.on("worker", worker => { observed.push(worker.url()); });
  await page.goto(address);
  const evidence = await page.evaluate(async ({ entry, assets, initialization }) => {
    const module = await import(entry);
    const client = module.createCurrentDevelopmentWorkerV2({ assets });
    const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
      : value != null && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const text = (value: unknown) => JSON.stringify(canonical(value));
    const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(text(value))))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const snapshot = async () => {
      const result = await client.dispatch({ kind: "SNAPSHOT" });
      assert(result.response.kind === "SNAPSHOT", "snapshot response kind");
      return result.response.snapshot;
    };
    const control = (state: any) => state.lifecycle.kind === "ACTIVE"
      ? state.lifecycle.value.active_run.control : state.lifecycle.value.control;
    const deferred: any[] = [];
    const presentationIds: number[] = [];
    let settlements = 0;
    let uiChanges = 0;
    const unexpected = () => { throw new Error("unexpected external adapter in bounded solo Worker witness"); };
    const router = new module.BrowserEffectRouterV2({
      renderUi: () => { uiChanges++; },
      present: async (effect: any) => {
        const before = await snapshot();
        assert(before.pending_presentations.some((pending: any) => pending.event_id === effect.event_id),
          "real presentation must be pending before adapter settlement");
        presentationIds.push(effect.event_id);
        // Await the transport here, then route its effects after this outer batch.
        // Awaiting nested router.dispatch here would violate router ownership.
        deferred.push(await client.dispatch({ kind: "PRESENTATION_SETTLED", event_id: effect.event_id,
          outcome: { kind: "SETTLED" } }));
        const after = await snapshot();
        assert(!after.pending_presentations.some((pending: any) => pending.event_id === effect.event_id),
          "settled presentation must release exactly its actual pending ID");
        settlements++;
      },
      changePresentationScene: () => {}, sendNetworkFrame: unexpected, handleStorageRequest: unexpected,
      requestAsset: () => {}, playAudioCue: () => {}, showTerminal: unexpected, recordTelemetry: () => {},
      publishRepro: unexpected, publishCurrentRepro: unexpected, dispose: () => {},
    });
    const send = async (request: any) => {
      const response = await client.dispatch(request);
      if (response.response.kind === "EFFECTS") {
        await router.dispatch(response.response.batch);
        while (deferred.length > 0) {
          const settlement = deferred.shift();
          assert(settlement.response.kind === "EFFECTS", "presentation settlement response kind");
          await router.dispatch(settlement.response.batch);
        }
      }
      return response;
    };
    const raw = async (kind: "KEY_DOWN" | "KEY_UP", code: string) => send({ kind: "RAW_INPUT", event: {
      kind, data: kind === "KEY_DOWN" ? { code: { kind: code }, printable: false, browser_repeat: false, focus: "GAME" }
        : { code: { kind: code } },
    } });
    const press = async (code: string) => { await raw("KEY_DOWN", code); await raw("KEY_UP", code); };
    try {
      assert((await client.dispatch(initialization)).response.kind === "READY", "current Worker initialization");
      const title = await snapshot();
      assert(control(title).kind === "TITLE", "natural current Title checkpoint");
      await press("SPACE"); await press("SPACE"); await press("SPACE");
      const first = await snapshot();
      const bound = (control(first).menu?.options.length ?? 0) + 1;
      let confirmed = false;
      for (let index = 0; index < bound; index++) {
        if (control(await snapshot()).menu?.selected_option_id === "bootstrap/starter/confirm") { confirmed = true; break; }
        await press("ARROW_DOWN");
      }
      assert(confirmed, "natural starter confirmation must be reachable");
      await press("SPACE"); await press("SPACE"); await press("SPACE"); await press("SPACE");
      const active = await snapshot();
      assert(active.lifecycle.kind === "ACTIVE" && control(active).kind === "BATTLE_COMMAND", "natural BattleCommand");
      assert(presentationIds.length > 0 && settlements === presentationIds.length, "actual presentations must settle");
      assert(new Set(presentationIds).size === presentationIds.length, "presentation IDs must be routed once");
      const beforeRejected = await snapshot();
      const frontier = client.status.acceptedSequence;
      let rejectedCode = "";
      try { await client.dispatch({ kind: "PRESENTATION_SETTLED", event_id: Number.MAX_SAFE_INTEGER,
        outcome: { kind: "SETTLED" } }); }
      catch (error) {
        if (error instanceof module.CurrentWorkerRequestErrorV2) rejectedCode = error.diagnostic.code;
        else throw error;
      }
      assert(rejectedCode === "HOST_REJECTED" && client.status.acceptedSequence === frontier,
        "kernel rejection must preserve the trusted frontier");
      assert(text(await snapshot()) === text(beforeRejected), "kernel rejection must preserve the complete snapshot");
      await raw("KEY_DOWN", "ARROW_DOWN");
      const held = [control(await snapshot()).menu.selected_option_id];
      await send({ kind: "ADVANCE_TIME", milliseconds: 249 });
      held.push(control(await snapshot()).menu.selected_option_id);
      await send({ kind: "ADVANCE_TIME", milliseconds: 1 });
      held.push(control(await snapshot()).menu.selected_option_id);
      assert(text(held) === text(["battle/command/party", "battle/command/party", "battle/command/fight"]),
        "held navigation must execute the exact 249/1 ms consequence");
      await raw("KEY_UP", "ARROW_DOWN");
      const quiet = await send({ kind: "ADVANCE_TIME", milliseconds: 500 });
      assert(quiet.response.kind === "EFFECTS" && quiet.response.batch.effects.length === 0,
        "released held navigation must have no subsequent timer effects");
      const final = await snapshot();
      const released = control(final).menu.selected_option_id;
      assert(released === "battle/command/fight", "released cursor must remain Fight");
      const accepted = client.status.acceptedSequence;
      await client.dispose();
      assert(client.status.closed && client.status.pending === 0 && client.status.queuedBytes === 0,
        "Dispose must acknowledge and release the serial transport owner");
      return { initial_control: "TITLE", final_control: control(final).kind, presentation_count: presentationIds.length,
        settled_presentation_count: settlements, ui_change_count: uiChanges, held_cursor: held, released_cursor: released,
        final_snapshot_digest: await digest(final), accepted_sequence: accepted, disposed: true,
        rejected_event_code: rejectedCode, rejection_preserved_snapshot: true };
    } finally { try { await router.dispose(); } finally { client.terminate(); } }
  }, { entry: `${address}/m9e-assets/${manifest.entry}`, assets: assets(), initialization });
  expect(observed).toHaveLength(1);
  expect(evidence.ui_change_count).toBeGreaterThan(0);
  const bytes = Buffer.from(JSON.stringify({ ...binding(observed), ...evidence }));
  expect(bytes.length).toBeLessThanOrEqual(4096);
  await testInfo.attach("m9e-current-worker-positive", { body: bytes, contentType: "application/json" });
});

test("current V7 Worker rejects wrong ABI and settles pending work on termination", async ({ page }, testInfo) => {
  const observed: string[] = [];
  page.on("worker", worker => { observed.push(worker.url()); });
  await page.goto(address);
  const wrongAbi = await page.evaluate(async ({ entry, assets }) => {
    const module = await import(entry);
    const worker: Worker = module.createCurrentDevelopmentWorkerTransportV2();
    try {
      const response = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("actual Worker wrong-ABI response deadline")), 15_000);
        worker.addEventListener("message", event => { clearTimeout(timer); resolve(event.data); }, { once: true });
        worker.addEventListener("error", () => { clearTimeout(timer); reject(new Error("actual Worker startup failed")); }, { once: true });
      });
      worker.postMessage({ kind: "CONFIGURE_CURRENT_WORKER_V2", assets });
      const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, request_id: 1, sequence: 0,
        request: { kind: "INITIALIZE" } }));
      worker.postMessage(bytes.buffer, [bytes.buffer]);
      const result = await response;
      if (result.kind !== "CURRENT_WORKER_FAILURE_V2" || result.version !== 2 || result.code !== "INVALID_ABI"
        || result.acceptance !== "REJECTED" || result.request_id !== 1 || result.sequence !== 0 || result.accepted_sequence !== null) {
        throw new Error("actual Worker did not reject ABI1 before accepting a current request");
      }
      const invalidResponse = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("actual Worker invalid-ID response deadline")), 15_000);
        worker.addEventListener("message", event => { clearTimeout(timer); resolve(event.data); }, { once: true });
        worker.addEventListener("error", () => { clearTimeout(timer); reject(new Error("actual Worker failed during invalid-ID admission")); }, { once: true });
      });
      const invalidBytes = new TextEncoder().encode(JSON.stringify({ version: 2, request_id: -1, sequence: 0,
        request: { kind: "SNAPSHOT" } }));
      worker.postMessage(invalidBytes.buffer, [invalidBytes.buffer]);
      const invalid = await invalidResponse;
      if (invalid.kind !== "CURRENT_WORKER_FAILURE_V2" || invalid.code !== "WORKER_FAILURE"
        || invalid.acceptance !== "UNKNOWN" || invalid.request_id !== null || invalid.sequence !== null
        || invalid.accepted_sequence !== null) throw new Error("invalid correlation must fence without inventing an accepted frontier");
      return { wrong_abi: { code: result.code, acceptance: result.acceptance, request_id: result.request_id,
        sequence: result.sequence, accepted_sequence: result.accepted_sequence },
        invalid_request_id: { code: invalid.code, acceptance: invalid.acceptance, request_id: invalid.request_id,
          sequence: invalid.sequence, accepted_sequence: invalid.accepted_sequence } };
    } finally { worker.terminate(); }
  }, { entry: `${address}/m9e-assets/${manifest.entry}`, assets: assets() });
  const fetchStarted = page.waitForRequest(request => request.url() === assets(true).wasm_url, { timeout: 15_000 });
  const pendingBefore = await page.evaluate(async ({ entry, assets, initialization }) => {
    const module = await import(entry);
    const worker: Worker = module.createCurrentDevelopmentWorkerTransportV2();
    const client = new module.CurrentRustBrowserHostV2({ worker, assets, responseTimeoutMs: 10_000 });
    // Attach both rejection handlers immediately, before any external teardown.
    const settled = Promise.allSettled([client.dispatch(initialization), client.dispatch({ kind: "SNAPSHOT" })]);
    (globalThis as any).__currentPendingWorker = { worker, client, settled };
    return client.status.pending;
  }, { entry: `${address}/m9e-assets/${manifest.entry}`, assets: assets(true), initialization });
  await fetchStarted;
  const stopped = await page.evaluate(async () => {
    const owned = (globalThis as any).__currentPendingWorker;
    try {
      owned.worker.terminate(); // actual external termination emits no trustworthy acceptance response
      const results = await owned.settled;
      if (results.some((result: PromiseSettledResult<unknown>) => result.status !== "rejected"
        || !(result.reason instanceof Error) || !result.reason.message.includes("acceptance is unknown"))) {
        throw new Error("externally terminated Worker requests must reject with unknown acceptance");
      }
      let postRejected = false;
      try { await owned.client.dispatch({ kind: "SNAPSHOT" }); } catch { postRejected = true; }
      const status = owned.client.status;
      return { settled_after_termination: results.length, rejected_after_termination: results.filter(
        (result: PromiseSettledResult<unknown>) => result.status === "rejected").length,
        closed: status.closed, pending_after: status.pending, queued_bytes_after: status.queuedBytes,
        accepted_sequence: status.acceptedSequence, post_termination_rejected: postRejected };
    } finally { owned.client.terminate(); delete (globalThis as any).__currentPendingWorker; }
  });
  expect(pendingBefore).toBe(2);
  expect(stopped).toEqual({ settled_after_termination: 2, rejected_after_termination: 2, closed: true,
    pending_after: 0, queued_bytes_after: 0, accepted_sequence: null, post_termination_rejected: true });
  expect(observed).toHaveLength(2);
  const bytes = Buffer.from(JSON.stringify({ ...binding(observed), ...wrongAbi,
    pending_before_termination: pendingBefore, ...stopped }));
  expect(bytes.length).toBeLessThanOrEqual(4096);
  await testInfo.attach("m9e-current-worker-negative", { body: bytes, contentType: "application/json" });
});
