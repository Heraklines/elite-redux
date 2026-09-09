import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { relative, resolve, sep } from "node:path";
import { expect, test } from "playwright/test";

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
const transportManifestBytes = boundedFile("m9e-v7-rtc-assets.json", 32 << 10);
const transportManifest = JSON.parse(transportManifestBytes.toString("utf8")) as Manifest;
if (transportManifest.source_sha !== manifest.source_sha || transportManifest.schema_version !== 1
  || transportManifest.assets[transportManifest.worker]?.sha256 !== manifest.assets[manifest.worker].sha256) {
  throw new Error("RTC transport must bind the same actual Worker source");
}
for (const [path, metadata] of Object.entries(transportManifest.assets)) {
  const bytes = boundedFile(path, 4 << 20);
  if (bytes.length !== metadata.bytes || sha(bytes) !== metadata.sha256) throw new Error("RTC emitted asset differs");
  const existing = served.get(`/m9e-assets/${path}`);
  if (existing != null && sha(existing) !== sha(bytes)) throw new Error("RTC asset collision");
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
    expect([`/m9e-assets/${manifest.worker}`, `/m9e-assets/${transportManifest.worker}`]).toContain(new URL(url).pathname);
  }
  return { schema_version: 1, source_sha: manifest.source_sha, manifest_sha256: sha(manifestBytes),
    entry_sha256: manifest.assets[manifest.entry].sha256, worker_sha256: manifest.assets[manifest.worker].sha256,
    worker_path: manifest.worker, ...manifest.cohort, browser_worker_protocol_version: 2,
    observed_worker_count: observed.length };
}

const setupBytes = boundedFile("m9e-v7-coop-startup-assets.json", 16 << 10);
const setup = JSON.parse(setupBytes.toString("utf8"));
if (setup.source_sha !== manifest.source_sha || setup.schema_version !== 1
  || Object.keys(setup.assets).sort().join(",") !== "coop-guest-initialization.json,coop-host-initialization.json") {
  throw new Error("natural rebind initialization source or inventory mismatch");
}
for (const [path, asset] of Object.entries(setup.assets) as [string, Asset][]) {
  const bytes = boundedFile(path, 64 << 10);
  if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256) throw new Error("natural rebind initialization differs");
  served.set(`/m9e-assets/${path}`, bytes);
}

test("current V7 RTC owner automatically rebinds and continues natural gameplay across fresh connections", async ({ page }, testInfo) => {
  const observed: string[] = [];
  page.on("worker", worker => observed.push(worker.url()));
  await page.goto(address);
  const evidence = await page.evaluate(async ({ entry, workerEntry, source, workerHash, assets, initializations }) => {
    const module = await import(entry);
    const workers = await import(workerEntry);
    const owners: any[] = [];
    const replayers: any[] = [];
    const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
      : value != null && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const text = (value: unknown) => JSON.stringify(canonical(value));
    const equal = (a: unknown, b: unknown, message: string) => assert(text(a) === text(b), message);
    const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))))
      .map(byte => byte.toString(16).padStart(2, "0")).join("");
    const snapshot = async (peer: any) => {
      const result = await peer.dispatch({ kind: "SNAPSHOT" });
      assert(result.response.kind === "SNAPSHOT", "actual owner snapshot required");
      return result.response.snapshot;
    };
    const wait = async (condition: () => Promise<boolean>, label: string) => {
      const until = Date.now() + 20_000;
      while (Date.now() < until) {
        if (await condition()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`bounded actual RTC owner wait: ${label}`);
    };
    const inputs = await Promise.all(initializations.map(async path => (await fetch(path)).json()));
    const make = async (index: number, checkpoint?: any) => {
      const init = inputs[index];
      assert(init.kind === "NATURAL_COOP", "actual natural initialization required");
      const protocol = checkpoint?.protocol ?? init.context.protocol;
      const frame = protocol.frame_context.context;
      const context = checkpoint == null ? init.context : { ...init.context, protocol, scheduler: checkpoint.scheduler };
      const record = { frames: [] as { direction: string; generation: number; bytes: number[] }[], bytes: 0, presentations: 0, raw: 0 };
      const peer = new module.CurrentDevelopmentRtcPeerV2({ assets, context,
        ...(checkpoint == null ? { natural_start: { profile: init.profile, seed: init.seed,
          save_slots: init.save_slots, local_is_host: init.local_is_host } } : { checkpoint }),
        identity: { source_sha: source, worker_sha256: workerHash, content_sha256: assets.content_sha256,
          session_id: frame.sessionId, run_id: frame.runId, authority_seat: frame.authoritySeatId,
          session_epoch: frame.sessionEpoch, seat_map_id: frame.seatMapId, membership_revision: frame.membershipRevision,
          local_seat: context.local_seat, peer_seat: protocol.connections[0].peer_seat, generation: frame.connectionGeneration },
        present: async () => { record.presentations++; },
        frame: (direction: string, generation: number, bytes: Uint8Array) => {
          assert(record.frames.length < 64 && bytes.length <= (4 << 20) - record.bytes, "bounded actual owner frame evidence");
          record.bytes += bytes.length; record.frames.push({ direction, generation, bytes: Array.from(bytes) });
        },
      });
      owners.push(peer);
      await peer.initialize();
      const state = await snapshot(peer);
      if (checkpoint == null) assert(state.lifecycle.kind === "BOOTSTRAP" && state.lifecycle.value.stage === "TITLE", "actual Title owner required");
      else equal(state, checkpoint, "fresh RTC owner changed reached checkpoint");
      return { peer, record };
    };
    const connect = async (pair: any[]) => {
      const offer = await pair[0].peer.offer();
      const answer = await pair[1].peer.answer(offer);
      await pair[0].peer.accept(answer);
      await Promise.all(pair.map(item => item.peer.ready()));
      for (const item of pair) assert(item.peer.status.rtc.connected && item.peer.status.peerConnectionState === "connected",
        "actual owned RTC pair must connect");
    };
    const press = async (item: any, kind = "SPACE") => {
      await item.peer.dispatch({ kind: "RAW_INPUT", event: { kind: "KEY_DOWN",
        data: { code: { kind }, printable: false, browser_repeat: false, focus: "GAME" } } });
      await item.peer.dispatch({ kind: "RAW_INPUT", event: { kind: "KEY_UP", data: { code: { kind } } } });
      item.record.raw += 2;
    };
    const choose = async (item: any, target: string) => {
      const first = (await snapshot(item.peer)).lifecycle.value.control.menu;
      for (let pass = 0; pass <= first.options.length; pass++) {
        const menu = (await snapshot(item.peer)).lifecycle.value.control.menu;
        if (menu.selected_option_id === target) { await press(item); return; }
        const current = menu.options.findIndex((option: any) => option.option_id === menu.selected_option_id);
        const wanted = menu.options.findIndex((option: any) => option.option_id === target);
        assert(current >= 0 && wanted >= 0, "actual menu target required");
        await press(item, wanted < current ? "ARROW_UP" : "ARROW_DOWN");
      }
      throw new Error("bounded natural menu failed");
    };
    const starters = async (item: any, host: boolean) => {
      const initial = (await snapshot(item.peer)).lifecycle.value;
      const mode = initial.catalog.modes.find((value: any) => value.cooperative && value.supported);
      assert(mode != null, "actual supported cooperative mode required");
      await press(item); await choose(item, `bootstrap/mode/${mode.mode}`);
      if (host && mode.challenge_selection) await choose(item, "bootstrap/challenge/done");
      const state = (await snapshot(item.peer)).lifecycle.value;
      assert(state.stage === "STARTER_SELECT", "actual starter selection required");
      const starter = state.catalog.starters.find((value: any) => value.cost <= state.catalog.maximum_starter_cost);
      assert(starter != null, "actual affordable starter required");
      await choose(item, `bootstrap/starter/${starter.pokemon_id}`);
      await choose(item, "bootstrap/starter/confirm"); await press(item);
      if (host) for (let pass = 0; pass < 4; pass++) {
        const state = (await snapshot(item.peer)).lifecycle;
        if (state.kind === "ACTIVE" || state.value.stage === "COMPLETE") break;
        await press(item);
      }
    };
    const sent = (item: any) => item.record.frames.filter((frame: any) => frame.direction === "sent");
    const decoded = (frame: any) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(frame.bytes)));
    const receipts = (item: any, direction: string) => item.record.frames.filter((frame: any) => {
      if (frame.direction !== direction || frame.generation !== 2) return false;
      const value = decoded(frame); return value.schema_version === 2 && value.authority_context != null && value.proposal_hex != null;
    });
    try {
      const startup = [await make(0), await make(1)];
      await connect(startup);
      const before = await snapshot(startup[0].peer);
      let liveRejected = false;
      try { await startup[0].peer.beginRebind(); } catch { liveRejected = true; }
      assert(liveRejected, "live physical generation must reject BEGIN before kernel mutation");
      equal(await snapshot(startup[0].peer), before, "rejected live rebind changed snapshot");
      await starters(startup[0], true); await starters(startup[1], false);
      await wait(async () => (await Promise.all(startup.map(item => snapshot(item.peer)))).every(state => state.lifecycle.kind === "ACTIVE"), "natural active battle");
      await Promise.all(startup.map(item => item.peer.closeTransport()));
      const handoff = await Promise.all(startup.map(item => snapshot(item.peer)));
      for (const item of startup) { await item.peer.dispose(); assert(item.peer.status.disposeAcknowledged, "startup owner disposal acknowledged"); }
      const pair = [await make(0, handoff[0]), await make(1, handoff[1])];
      for (const item of pair) {
        const result = await item.peer.beginRebind();
        assert(result.response.kind === "REBIND" && result.response.output.generation === 2
          && result.response.output.frames.length === 0 && item.peer.status.generation === 2, "actual kernel BEGIN must own next generation");
      }
      await connect(pair);
      await pair[0].peer.retryRebind();
      await wait(async () => (await Promise.all(pair.map(item => snapshot(item.peer))))
        .every(state => state.current_coop_setup.rebind.phase === "OPEN"), "automatic eight-control handshake");
      const controlCounts = pair.map(item => sent(item).filter((frame: any) => decoded(frame).kind === "CURRENT_COOP_REBIND").length);
      equal(controlCounts, [4, 4], "owner must automatically send all eight kernel controls exactly once");
      for (const item of pair) assert((await snapshot(item.peer)).current_coop_setup.rebind.transcript.length === 8, "complete actual owner transcript");
      const nextFrame = async (item: any) => {
        const count = sent(item).length;
        for (let pass = 0; pass < 8; pass++) {
          await press(item);
          const frames = sent(item);
          if (frames.length > count) return frames[count];
        }
        throw new Error("actual generation two gameplay input emitted no frame");
      };
      await nextFrame(pair[0]);
      await wait(async () => pair[1].record.frames.some(frame => frame.direction === "received" && frame.generation === 2
        && decoded(frame).kind !== "CURRENT_COOP_REBIND"), "replica received actual gameplay material");
      const proposal = await nextFrame(pair[1]);
      await wait(async () => receipts(pair[0], "sent").length === 1 && receipts(pair[1], "received").length === 1
        && pair.every(item => item.peer.status.pending === 0), "automatic generation two receipt");
      const receipt = receipts(pair[0], "sent")[0];
      const receiptValue = decoded(receipt);
      assert(receiptValue.authority_context.connectionGeneration === 2, "actual generation two receipt context");
      equal(receiptValue.proposal_hex, proposal.bytes.map((byte: number) => byte.toString(16).padStart(2, "0")).join(""), "receipt binds actual automatically routed proposal");
      const hostAfter = await snapshot(pair[0].peer);
      await pair[1].peer.sendFrame(2, Uint8Array.from(proposal.bytes));
      await wait(async () => receipts(pair[0], "sent").length === 2 && receipts(pair[1], "received").length === 2
        && pair.every(item => item.peer.status.pending === 0), "automatic duplicate receipt delivery");
      equal(receipts(pair[0], "sent")[1].bytes, receipt.bytes, "duplicate must retransmit exact retained receipt");
      equal(await snapshot(pair[0].peer), hostAfter, "duplicate proposal changed authority state");
      await Promise.all(pair.map(item => item.peer.closeTransport()));
      const final = await Promise.all(pair.map(item => snapshot(item.peer)));
      equal(final[0].lifecycle, final[1].lifecycle, "actual settled cooperative gameplay diverged");
      const replayHashes: string[] = [];
      for (let index = 0; index < 2; index++) {
        const bytes = await pair[index].peer.exportRepro();
        const capsule = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        const missing = structuredClone(capsule);
        const removed = missing.attempts.findIndex((attempt: any) => attempt.event.kind === "COOP_REBIND"
          && attempt.event.control.kind === "RECEIVE" && attempt.outcome.kind === "REBIND_APPLIED");
        assert(removed >= 0, "actual automatic receive must be captured");
        missing.attempts.splice(removed, 1);
        missing.attempts.forEach((attempt: any, offset: number) => { attempt.position = missing.base_position + offset + 1; });
        missing.final_position = missing.base_position + missing.attempts.length;
        const replay = workers.createCurrentDevelopmentWorkerV2({ assets }); replayers.push(replay);
        let rejected = false;
        try { await replay.dispatch({ kind: "INITIALIZE", initialization: { kind: "CURRENT_REPRO_CAPSULE",
          capsule_bytes: Array.from(new TextEncoder().encode(text(missing))) } }); }
        catch (error: any) { rejected = error?.diagnostic?.acceptance === "REJECTED" && error.diagnostic.code === "HOST_REJECTED"; }
        assert(rejected && replay.status.acceptedSequence === null, "deleted automatic control must reject before initialization");
        await replay.dispatch({ kind: "INITIALIZE", initialization: { kind: "CURRENT_REPRO_CAPSULE", capsule_bytes: Array.from(bytes) } });
        equal(await snapshot(replay), final[index], "full automatic owner capsule replay differs");
        replayHashes.push(await hash(bytes)); await replay.dispose();
      }
      const statuses = pair.map(item => item.peer.status);
      for (const item of pair) { await item.peer.dispose(); assert(item.peer.status.disposeAcknowledged, "rebound owner disposal acknowledged"); }
      return { actual_workers: owners.length + replayers.length, disposed_workers: 6, generation: 2,
        automatic_rebind_controls: controlCounts, successful_signaling_pairs: 2,
        raw_inputs: [...startup, ...pair].map(item => item.record.raw),
        presentations: [...startup, ...pair].map(item => item.record.presentations),
        connected_callbacks: statuses.map(status => status.connectedEvents), disconnected_callbacks: statuses.map(status => status.disconnectedEvents),
        live_begin_rejected: liveRejected, checkpoint_handoff_exact: true, full_replay: true, deleted_control_rejected: true,
        duplicate_receipt_exact: true, duplicate_receipt_delivered: true, final_lifecycle_equal: true,
        proposal_sha256: await hash(Uint8Array.from(proposal.bytes)), receipt_sha256: await hash(Uint8Array.from(receipt.bytes)),
        capsule_sha256: replayHashes };
    } finally {
      for (const owner of owners) await owner.dispose().catch(() => {});
      for (const replay of replayers) if (!replay.status.closed) replay.terminate("owner witness teardown");
    }
  }, { entry: `${address}/m9e-assets/${transportManifest.entry}`, workerEntry: `${address}/m9e-assets/${manifest.entry}`,
    source: manifest.source_sha, workerHash: manifest.assets[manifest.worker].sha256, assets: assets(),
    initializations: ["coop-host-initialization.json", "coop-guest-initialization.json"].map(path => `${address}/m9e-assets/${path}`) });
  expect(observed).toHaveLength(6);
  expect(observed.filter(url => new URL(url).pathname === `/m9e-assets/${transportManifest.worker}`)).toHaveLength(4);
  expect(evidence.actual_workers).toBe(6); expect(evidence.disposed_workers).toBe(6);
  expect(evidence.automatic_rebind_controls).toEqual([4, 4]);
  expect(evidence.connected_callbacks).toEqual([1, 1]); expect(evidence.disconnected_callbacks).toEqual([1, 1]);
  for (const count of evidence.raw_inputs) expect(count).toBeGreaterThan(0);
  const report = Buffer.from(JSON.stringify({ ...binding(observed), setup_manifest_sha256: sha(setupBytes),
    rtc_manifest_sha256: sha(transportManifestBytes), owner_worker_path: transportManifest.worker, ...evidence }));
  expect(report.length).toBeLessThanOrEqual(16 << 10);
  await testInfo.attach("m9e-current-rtc-owner-rebind", { body: report, contentType: "application/json" });
});
