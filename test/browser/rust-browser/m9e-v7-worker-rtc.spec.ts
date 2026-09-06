import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { relative, resolve, sep } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "playwright/test";

test.setTimeout(300_000);
const directory = process.env.M9E_V7_WEB_DIR;
if (directory == null) throw new Error("M9E_V7_WEB_DIR is required");
const root = realpathSync(directory);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function readBounded(path: string, maximum: number): Buffer {
  if (!/^[a-zA-Z0-9_.-]+$/u.test(path) || path === "." || path === "..") throw new Error("RTC fixture path invalid");
  const absolute = resolve(root, path);
  const stat = lstatSync(absolute);
  const actual = realpathSync(absolute);
  const rel = relative(root, actual);
  if (!stat.isFile() || stat.isSymbolicLink() || rel === ".." || rel.startsWith(`..${sep}`)
    || stat.size < 1 || stat.size > maximum) throw new Error("RTC fixture must be a bounded regular contained file");
  return readFileSync(actual);
}
interface Asset { bytes: number; sha256: string; role?: "entry" | "worker" | "chunk" }
const manifestBytes = readBounded("m9e-v7-rtc-assets.json", 16 << 10);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { schema_version: number; source_sha: string;
  browser_worker_protocol_version: number; entry: string; worker: string; assets: Record<string, Asset>;
  cohort: { glue_sha256: string; wasm_sha256: string; content_sha256: string } };
const cohort = JSON.parse(readBounded("m9e-v7-web-assets.json", 16 << 10).toString("utf8")) as {
  source_sha: string; assets: Record<string, Asset> };
if (manifest.schema_version !== 1 || manifest.browser_worker_protocol_version !== 2
  || !/^[0-9a-f]{40}$/u.test(manifest.source_sha) || manifest.source_sha !== cohort.source_sha
  || (process.env.GITHUB_SHA != null && manifest.source_sha !== process.env.GITHUB_SHA)
  || manifest.entry !== "current-rtc-entry.js" || manifest.assets[manifest.entry]?.role !== "entry"
  || manifest.assets[manifest.worker]?.role !== "worker" || Object.keys(manifest.assets).length > 8
  || Object.values(manifest.assets).filter(asset => asset.role === "entry").length !== 1
  || Object.values(manifest.assets).filter(asset => asset.role === "worker").length !== 1) {
  throw new Error("RTC bundle manifest does not identify one current entry and actual Worker");
}
const served = new Map<string, Buffer>();
let bundleBytes = 0;
for (const [path, asset] of Object.entries(manifest.assets)) {
  const bytes = readBounded(path, 4 << 20);
  if (!path.endsWith(".js") || !["entry", "worker", "chunk"].includes(asset.role ?? "")
    || bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error("RTC bundle asset mismatch");
  bundleBytes += bytes.length;
  served.set(`/assets/${path}`, bytes);
}
if (bundleBytes > 4 << 20) throw new Error("RTC bundle aggregate exceeds4MiB");
for (const path of ["er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json",
  "coop-authority-snapshot.json", "coop-replica-snapshot.json"]) {
  const bytes = readBounded(path, path.endsWith(".js") ? 4 << 20 : 32 << 20);
  if (bytes.length !== cohort.assets[path]?.bytes || digest(bytes) !== cohort.assets[path]?.sha256) throw new Error("RTC natural fixture/cohort mismatch");
  served.set(`/assets/${path}`, bytes);
}
for (const [key, path] of [["glue_sha256", "er_web.js"], ["wasm_sha256", "er_web_bg.wasm"],
  ["content_sha256", "game-content-bundle-v2.json"]] as const) {
  if (manifest.cohort[key] !== cohort.assets[path].sha256) throw new Error("RTC cohort identity disagreement");
}
let server: Server;
let address: string;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end("<!doctype html><html><body>Current RTC checkpoint pair</body></html>"); return; }
    const body = served.get(path);
    if (body == null) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": path.endsWith(".js") ? "text/javascript"
      : path.endsWith(".wasm") ? "application/wasm" : "application/json", "cache-control": "no-store" });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const bound = server.address();
  if (bound == null || typeof bound === "string") throw new Error("RTC fixture did not bind TCP");
  address = `http://127.0.0.1:${bound.port}`;
});
test.afterAll(async () => {
  if (server == null) return;
  const closed = once(server, "close"); server.close(); server.closeAllConnections(); await closed;
});

interface Pair { contexts: BrowserContext[]; left: Page; right: Page; workers: string[] }
async function pair(browser: Browser, mismatch = false): Promise<Pair> {
  const contexts: BrowserContext[] = [];
  try {
    contexts.push(await browser.newContext(), await browser.newContext());
    const left = await contexts[0].newPage();
    const right = await contexts[1].newPage();
    const workers: string[] = [];
    for (const page of [left, right]) page.on("worker", worker => { workers.push(worker.url()); });
    await Promise.all([left.goto(address), right.goto(address)]);
    await Promise.all([left, right].map((page, index) => page.evaluate(async ({ entry, assets, path, source, workerHash, mismatch }) => {
      const module = await import(entry);
      const snapshot = await (await fetch(path)).json();
      const protocol = snapshot.protocol;
      const frame = protocol.frame_context.context;
      const seat = protocol.role === "AUTHORITY" ? frame.authoritySeatId : protocol.connections[0].peer_seat === frame.authoritySeatId
        ? frame.senderSeatId : null;
      if (seat == null) throw new Error("natural fixture local seat unavailable");
      const evidence = { frames: [] as { direction: string; generation: number; bytes: number[] }[],
        frameBytes: 0, presentations: [] as number[], stall: false, stalled: false, aborted: false };
      const options = { assets,
        checkpoint: snapshot, context: { local_seat: seat, role: protocol.role, protocol: null,
          scheduler: { disposed: false, next_timer_id: 0, timers: [], pauses: [] } },
        identity: { source_sha: mismatch ? (source === "0".repeat(40) ? "1".repeat(40) : "0".repeat(40)) : source,
          content_sha256: assets.content_sha256, worker_sha256: workerHash, session_id: frame.sessionId,
          run_id: frame.runId, authority_seat: frame.authoritySeatId, local_seat: seat,
          session_epoch: frame.sessionEpoch, seat_map_id: frame.seatMapId, membership_revision: frame.membershipRevision,
          peer_seat: protocol.connections[0].peer_seat, generation: 1 },
        present: async (effect: { event_id: number }, signal: AbortSignal) => {
          evidence.presentations.push(effect.event_id);
          // A renderer owns its copy, not the later kernel settlement identity.
          effect.event_id = Number.MAX_SAFE_INTEGER;
          if (evidence.stall) {
            evidence.stalled = true;
            await new Promise<void>((_resolve, reject) => {
              const abort = () => { evidence.aborted = true; reject(new Error("test presentation canceled")); };
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            });
          }
        },
        frame: (direction: string, generation: number, bytes: Uint8Array) => {
          if (evidence.frames.length >= 16 || bytes.length > (2 << 20) - evidence.frameBytes) {
            throw new Error(`RTC test actual frame evidence exceeds bounded window (${bytes.length} bytes)`);
          }
          evidence.frameBytes += bytes.length;
          evidence.frames.push({ direction, generation, bytes: Array.from(bytes) });
        },
      };
      const expectedCheckpoint = structuredClone(snapshot);
      for (const invalid of ["extra_peer", "sender", "generation", "staged_rebind"]) {
        const checkpoint = structuredClone(snapshot);
        if (invalid === "extra_peer") checkpoint.protocol.connections.push(structuredClone(checkpoint.protocol.connections[0]));
        if (invalid === "sender") checkpoint.protocol.frame_context.context.senderSeatId = 0;
        if (invalid === "generation") checkpoint.protocol.frame_context.context.connectionGeneration = 2;
        if (invalid === "staged_rebind") checkpoint.protocol.authority_rebind_pending = true;
        let rejected = false;
        try { new module.CurrentDevelopmentRtcPeerV1({ ...options, checkpoint }); }
        catch (error) { rejected = error instanceof Error && error.message.includes("binding does not match"); }
        if (!rejected) throw new Error(`unsupported RTC checkpoint binding was admitted: ${invalid}`);
      }
      const peer = new module.CurrentDevelopmentRtcPeerV1(options);
      // Constructor ownership must survive later caller mutation, before await.
      snapshot.schema_version = 0;
      options.context.local_seat = 0;
      options.identity.session_id = "mutated-caller-session";
      options.assets.content_sha256 = "0".repeat(64);
      await peer.initialize();
      const initial = await peer.dispatch({ kind: "SNAPSHOT" });
      if (JSON.stringify(initial.response.snapshot) !== JSON.stringify(expectedCheckpoint)) throw new Error("actual Worker did not restore its exact owned natural checkpoint");
      (globalThis as any).__rtcCurrent = { peer, evidence,
        snapshot: async () => (await peer.dispatch({ kind: "SNAPSHOT" })).response.snapshot,
        press: async () => {
          await peer.dispatch({ kind: "RAW_INPUT", event: { kind: "KEY_DOWN", data: { code: { kind: "SPACE" },
            printable: false, browser_repeat: false, focus: "GAME" } } });
          await peer.dispatch({ kind: "RAW_INPUT", event: { kind: "KEY_UP", data: { code: { kind: "SPACE" } } } });
        } };
    }, { entry: `${address}/assets/${manifest.entry}`, assets: { wasm_url: `${address}/assets/er_web_bg.wasm`,
      wasm_sha256: manifest.cohort.wasm_sha256, glue_url: `${address}/assets/er_web.js`,
      glue_sha256: manifest.cohort.glue_sha256, content_url: `${address}/assets/game-content-bundle-v2.json`,
      content_sha256: manifest.cohort.content_sha256 },
      path: `${address}/assets/${index === 0 ? "coop-authority-snapshot.json" : "coop-replica-snapshot.json"}`,
      source: manifest.source_sha, workerHash: manifest.assets[manifest.worker].sha256, mismatch: mismatch && index === 1 })));
    return { contexts, left, right, workers };
  } catch (error) { await Promise.allSettled(contexts.map(context => context.close())); throw error; }
}
async function closePair(value: Pair): Promise<void> {
  try { await Promise.allSettled([value.left, value.right].map(page => page.evaluate(async () => {
    await (globalThis as any).__rtcCurrent?.peer.dispose();
  }))); } finally { await Promise.allSettled(value.contexts.map(context => context.close())); }
}
async function negotiate(value: Pair, offer?: string): Promise<void> {
  const sdp = offer ?? await value.left.evaluate(() => (globalThis as any).__rtcCurrent.peer.offer());
  const answer = await value.right.evaluate(sdp => (globalThis as any).__rtcCurrent.peer.answer(sdp), sdp);
  await value.left.evaluate(sdp => (globalThis as any).__rtcCurrent.peer.accept(sdp), answer);
}
async function ready(value: Pair): Promise<void> {
  await negotiate(value);
  await Promise.all([value.left, value.right].map(page => page.evaluate(() => (globalThis as any).__rtcCurrent.peer.ready())));
}
const snapshot = (page: Page): Promise<any> => page.evaluate(() => (globalThis as any).__rtcCurrent.snapshot());
const status = (page: Page): Promise<any> => page.evaluate(() => (globalThis as any).__rtcCurrent.peer.status);
const press = (page: Page): Promise<void> => page.evaluate(() => (globalThis as any).__rtcCurrent.press());
async function received(page: Page, count: number): Promise<void> {
  await expect.poll(async () => (await status(page)).rtc?.kernelDeliveredFrames, { timeout: 30_000 }).toBe(count);
}
async function lastSent(page: Page): Promise<number[]> {
  return page.evaluate(() => (globalThis as any).__rtcCurrent.evidence.frames.findLast((frame: any) => frame.direction === "sent").bytes);
}
async function resend(page: Page, bytes: number[]): Promise<void> {
  await page.evaluate(async bytes => {
    const owned = Uint8Array.from(bytes);
    const current = (globalThis as any).__rtcCurrent;
    const sent = current.peer.sendFrame(1, owned);
    owned.fill(0);
    await sent;
    const observed = current.evidence.frames.findLast((frame: any) => frame.direction === "sent").bytes;
    if (JSON.stringify(observed) !== JSON.stringify(bytes)) throw new Error("RTC sent observer did not preserve admitted caller bytes");
  }, bytes);
}
function binding(workers: string[]) {
  for (const url of workers) { expect(new URL(url).origin).toBe(address); expect(new URL(url).pathname).toBe(`/assets/${manifest.worker}`); }
  return { source_sha: manifest.source_sha, manifest_sha256: digest(manifestBytes),
    worker_sha256: manifest.assets[manifest.worker].sha256, worker_path: manifest.worker,
    ...manifest.cohort, browser_worker_protocol: 2, generation: 1, observed_workers: workers.length,
    authority_fixture_sha256: cohort.assets["coop-authority-snapshot.json"].sha256,
    replica_fixture_sha256: cohort.assets["coop-replica-snapshot.json"].sha256 };
}

test("two current Workers exchange real RTC proposals and converge one natural checkpoint turn", async ({ browser }, testInfo) => {
  const peers = await pair(browser);
  try {
    const initialLeft = await snapshot(peers.left);
    const initialRight = await snapshot(peers.right);
    expect(initialLeft.lifecycle).toEqual(initialRight.lifecycle);
    expect(initialLeft.lifecycle.value.active_run.control.kind).toBe("BATTLE_COMMAND");
    const initialTurn = initialLeft.lifecycle.value.active_run.battle.turn;
    await ready(peers);
    expect((await status(peers.left)).peerConnectionState).toBe("connected");
    expect((await status(peers.right)).peerConnectionState).toBe("connected");
    await press(peers.left); await press(peers.left);
    await received(peers.right, 1);
    const waiting = await snapshot(peers.left);
    expect(waiting.lifecycle.value.active_run.battle.turn).toBe(initialTurn);
    const retained = await lastSent(peers.left);
    const pendingMaterial = JSON.parse(Buffer.from(retained).toString("utf8"));
    expect(pendingMaterial.value.schema_version).toBe(6);
    await press(peers.right);
    const privateBefore = await snapshot(peers.right);
    expect(privateBefore.lifecycle.value.active_run.control.kind).toBe("BATTLE_MOVE");
    const presentationBefore = (await status(peers.right)).settledPresentations;
    await resend(peers.left, retained); await received(peers.right, 2);
    expect(await snapshot(peers.right)).toEqual(privateBefore);
    expect((await status(peers.right)).lastNetworkEffects).toBe(0);
    expect((await status(peers.right)).settledPresentations).toBe(presentationBefore);
    await press(peers.right);
    await received(peers.left, 1); await received(peers.right, 3);
    const proposal = await lastSent(peers.right);
    const proposalWire = JSON.parse(Buffer.from(proposal).toString("utf8"));
    expect(proposalWire.schema_version).toBe(2);
    expect(proposalWire.sender_seat).toBe(2);
    expect(proposalWire.connection_generation).toBe(1);
    const material = await lastSent(peers.left);
    const materialWire = JSON.parse(Buffer.from(material).toString("utf8"));
    expect(materialWire.value.schema_version).toBe(6);
    expect(materialWire.value.authority_revision).toBe(pendingMaterial.value.authority_revision + 1);
    const leftFinal = await snapshot(peers.left); const rightFinal = await snapshot(peers.right);
    expect(leftFinal.lifecycle.value.active_run.battle.turn).toBe(initialTurn + 1);
    expect(rightFinal.lifecycle).toEqual(leftFinal.lifecycle);
    expect(leftFinal.pending_presentations).toEqual([]); expect(rightFinal.pending_presentations).toEqual([]);
    const deliveredIds = await peers.right.evaluate(() => (globalThis as any).__rtcCurrent.evidence.presentations);
    const expectedIds = materialWire.value.presentation.map((effect: any) => effect.event_id);
    expect(expectedIds.length).toBeGreaterThan(0);
    expect(deliveredIds.slice(-expectedIds.length)).toEqual(expectedIds);
    expect(new Set(deliveredIds).size).toBe(deliveredIds.length);
    const settled = (await status(peers.right)).settledPresentations;
    await resend(peers.right, proposal); await received(peers.left, 2);
    expect((await status(peers.left)).lastNetworkEffects).toBe(0);
    expect(await snapshot(peers.left)).toEqual(leftFinal);
    await resend(peers.left, material); await received(peers.right, 4);
    expect((await status(peers.right)).lastNetworkEffects).toBe(0);
    expect((await status(peers.right)).settledPresentations).toBe(settled);
    expect(await snapshot(peers.right)).toEqual(rightFinal);
    const liveLeft = await status(peers.left); const liveRight = await status(peers.right);
    // Closing is a real lifecycle event at generation1, never a reconnect claim.
    await peers.left.evaluate(() => (globalThis as any).__rtcCurrent.peer.closeTransport());
    await expect.poll(async () => (await status(peers.right)).disconnectedEvents, { timeout: 30_000 }).toBe(1);
    expect((await status(peers.left)).disconnectedEvents).toBe(1);
    const disconnected = await snapshot(peers.left);
    expect(disconnected.protocol.connections[0].state).toBe("DISCONNECTED");
    expect(disconnected.scheduler.pauses.some((pause: any) => pause.time_class === "connected"
      && pause.reasons.includes("transport-disconnected"))).toBe(true);
    await Promise.all([peers.left, peers.right].map(page => page.evaluate(() => (globalThis as any).__rtcCurrent.peer.dispose())));
    const endLeft = await status(peers.left); const endRight = await status(peers.right);
    for (const end of [endLeft, endRight]) {
      expect(end.disposeAcknowledged).toBe(true); expect(end.worker.closed).toBe(true);
      expect(end.pending).toBe(0); expect(end.queuedBytes).toBe(0);
      expect(end.rtc.sendPending + end.rtc.receivePending).toBe(0);
    }
    expect(peers.workers).toHaveLength(2);
    const evidence = { ...binding(peers.workers), initial_turn: initialTurn, final_turn: initialTurn + 1,
      proposal_sha256: digest(Uint8Array.from(proposal)), proposal_bytes: proposal.length,
      material_sha256: digest(Uint8Array.from(material)), material_bytes: material.length,
      proposal_operation_id: proposalWire.proposal.context.operation_id,
      material_revision: materialWire.value.authority_revision, material_after_digest: materialWire.value.after_digest,
      presentation_count: expectedIds.length, settled_presentation_count: expectedIds.length,
      duplicate_proposal_effects: 0, duplicate_material_effects: 0, private_duplicate_snapshot_equal: true,
      left_sent: liveLeft.rtc.sentFrames, right_sent: liveRight.rtc.sentFrames,
      left_kernel_delivered: liveLeft.rtc.kernelDeliveredFrames, right_kernel_delivered: liveRight.rtc.kernelDeliveredFrames,
      maximum_frame_bytes: Math.max(liveLeft.rtc.maximumObservedFrameBytes, liveRight.rtc.maximumObservedFrameBytes),
      negotiated_frame_bound: Math.min(liveLeft.rtc.maximumFrameBytes, liveRight.rtc.maximumFrameBytes),
      disconnected_events: [endLeft.disconnectedEvents, endRight.disconnectedEvents], disposed: [true, true] };
    const bytes = Buffer.from(JSON.stringify(evidence)); expect(bytes.length).toBeLessThanOrEqual(4096);
    await testInfo.attach("m9e-current-rtc-positive", { body: bytes, contentType: "application/json" });
  } finally { await closePair(peers); }
});

test("current RTC identity mismatch and stalled presentation teardown settle owned work", async ({ browser }, testInfo) => {
  const mismatched = await pair(browser, true);
  let mismatchEvidence: any;
  try {
    const before = await snapshot(mismatched.left);
    const beforeFrontier = (await status(mismatched.left)).worker.acceptedSequence;
    const offer = await mismatched.left.evaluate(async () => {
      const owned = (globalThis as any).__rtcCurrent;
      const offer = await owned.peer.offer();
      // These are queued transport bytes on an actual unnegotiated channel,
      // never a claim of current game material or kernel delivery.
      const oversized = owned.peer.sendFrame(1, new Uint8Array((1 << 20) + 1));
      const wrongGeneration = owned.peer.sendFrame(2, new Uint8Array([1]));
      const admission = [oversized, wrongGeneration];
      // Attach handlers before inspecting the synchronous admission counters.
      owned.invalidAdmissions = Promise.allSettled(admission);
      if (owned.peer.status.rtc.sendPending !== 0) throw new Error("invalid frame/generation entered the RTC queue");
      owned.queuedTransport = Promise.allSettled(Array.from({ length: 16 }, (_, index) =>
        owned.peer.sendFrame(1, new Uint8Array([index]))));
      const overflow = owned.peer.sendFrame(1, new Uint8Array([17]));
      owned.overflowAdmission = Promise.allSettled([overflow]);
      if (owned.peer.status.rtc.sendPending !== 16) throw new Error("RTC pending count guard did not reject the17th frame");
      return offer;
    });
    await negotiate(mismatched, offer);
    const readiness = await Promise.allSettled([mismatched.left, mismatched.right].map(page => page.evaluate(
      () => (globalThis as any).__rtcCurrent.peer.ready())));
    expect(readiness.every(result => result.status === "rejected")).toBe(true);
    const queued = await mismatched.left.evaluate(async () => {
      const owned = (globalThis as any).__rtcCurrent;
      const results = await owned.queuedTransport;
      const invalid = [...await owned.invalidAdmissions, ...await owned.overflowAdmission];
      if (invalid.some(result => result.status !== "rejected"
        || !result.reason.message.includes("cannot enter bounded generation1 queue"))) {
        throw new Error("RTC frame/generation/count rejection did not occur at local admission");
      }
      return results.map((result: PromiseSettledResult<void>) => result.status);
    });
    expect(queued).toEqual(Array(16).fill("rejected"));
    expect((await status(mismatched.left)).worker.acceptedSequence).toBe(beforeFrontier);
    expect(await snapshot(mismatched.left)).toEqual(before);
    const left = await status(mismatched.left); const right = await status(mismatched.right);
    for (const current of [left, right]) {
      expect(current.connectedEvents).toBe(0); expect(current.disconnectedEvents).toBe(0);
      expect(current.rtc.closed).toBe(true); expect(current.rtc.sentFrames).toBe(0);
      expect(current.rtc.kernelDeliveredFrames).toBe(0);
      expect(current.rtc.sendPending + current.rtc.receivePending).toBe(0);
    }
    mismatchEvidence = { workers: mismatched.workers.length, rejected_readiness: 2, rejected_queued_sends: 16, invalid_admissions: 3,
      connected_events: [left.connectedEvents, right.connectedEvents], kernel_delivered: [0, 0], snapshot_equal: true };
    binding(mismatched.workers);
  } finally { await closePair(mismatched); }
  const stalled = await pair(browser);
  try {
    await ready(stalled);
    await press(stalled.left); await press(stalled.left); await received(stalled.right, 1);
    await press(stalled.right);
    await stalled.left.evaluate(() => { (globalThis as any).__rtcCurrent.evidence.stall = true; });
    await press(stalled.right);
    await expect.poll(() => stalled.left.evaluate(() => (globalThis as any).__rtcCurrent.evidence.stalled), { timeout: 30_000 }).toBe(true);
    const stopped = await stalled.left.evaluate(async () => {
      const owned = (globalThis as any).__rtcCurrent;
      const queuedSnapshot = owned.peer.dispatch({ kind: "SNAPSHOT" });
      const results = await Promise.allSettled([queuedSnapshot, owned.peer.dispose()]);
      return { results: results.map(result => result.status), callback_aborted: owned.evidence.aborted,
        status: owned.peer.status };
    });
    expect(stopped.results).toEqual(["rejected", "rejected"]);
    expect(stopped.callback_aborted).toBe(true);
    expect(stopped.status.deliveryFailure.acceptance).toBe("ACCEPTED");
    expect(stopped.status.deliveryFailure.accepted_sequence).toBeGreaterThan(0);
    expect(stopped.status.pending).toBe(0); expect(stopped.status.queuedBytes).toBe(0);
    expect(stopped.status.worker.closed).toBe(true); expect(stopped.status.disposeAcknowledged).toBe(false);
    expect(stopped.status.rtc.sendPending + stopped.status.rtc.receivePending).toBe(0);
    expect(stalled.workers).toHaveLength(2);
    const bytes = Buffer.from(JSON.stringify({ ...binding(stalled.workers), mismatch: mismatchEvidence,
      stalled_callback_aborted: true, queued_snapshot_rejected: true, disposal_acknowledged: false,
      committed_delivery_failure_sequence: stopped.status.deliveryFailure.accepted_sequence,
      pending_after: 0, queued_bytes_after: 0, worker_closed: true }));
    expect(bytes.length).toBeLessThanOrEqual(4096);
    await testInfo.attach("m9e-current-rtc-negative", { body: bytes, contentType: "application/json" });
  } finally { await closePair(stalled); }
});
