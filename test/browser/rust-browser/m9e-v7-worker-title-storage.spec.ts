import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { relative, resolve, sep } from "node:path";
import { expect, test } from "playwright/test";

// Same existing real V7 allowance; natural Title reader and explicitly controlled Save producer.
test.setTimeout(300_000);
const root = process.env.M9E_V7_WEB_DIR;
if (root == null) throw new Error("M9E_V7_WEB_DIR is required");
const fixtureRoot = realpathSync(root);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function bounded(path: string, maximum: number): Buffer {
  if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/u.test(path)) throw new Error("invalid storage fixture filename");
  const absolute = resolve(fixtureRoot, path);
  const actual = realpathSync(absolute);
  const info = lstatSync(absolute);
  const contained = relative(fixtureRoot, actual);
  if (!info.isFile() || info.isSymbolicLink() || contained === ".." || contained.startsWith(`..${sep}`)
    || resolve(fixtureRoot, contained) !== actual || info.size < 1 || info.size > maximum) {
    throw new Error("storage fixture is not a bounded regular owned file");
  }
  return readFileSync(actual);
}
const manifestBytes = bounded("m9e-v7-title-storage-assets.json", 16 * 1024);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const cohort = JSON.parse(bounded("m9e-v7-web-assets.json", 32 * 1024).toString("utf8"));
if (manifest.schema_version !== 1 || manifest.capability !== "CURRENT_WORKER_TITLE_STORAGE_RETIREMENT"
  || manifest.fixture_kind !== "NATURAL_TITLE_CONTROLLED_SAVE_PRODUCER" || manifest.source_sha !== cohort.source_sha
  || !/^[0-9a-f]{40}$/u.test(manifest.source_sha)
  || (process.env.GITHUB_SHA != null && manifest.source_sha !== process.env.GITHUB_SHA)
  || manifest.entry !== "current-title-storage-entry.js" || manifest.assets[manifest.entry]?.role !== "entry"
  || manifest.assets[manifest.worker]?.role !== "worker") throw new Error("storage manifest identity differs");
const sourcePaths = [
  "src/rust-browser/contracts/browser-contracts-v2.ts", "src/rust-browser/routes/browser-effects-v2.ts",
  "src/rust-browser/worker/rust-wasm-loader.ts", "src/rust-browser/worker/current-rust-kernel-worker.ts",
  "src/rust-browser/host/current-rust-browser-host.ts", "src/rust-browser/routes/rust-current-worker-entry.ts",
  "src/rust-browser/adapters/current-storage-backend.ts", "src/rust-browser/adapters/current-storage-owner.ts",
  "src/rust-browser/routes/rust-current-storage-entry.ts", "test/browser/rust-browser/m9e-v7-worker-title-storage.spec.ts",
  "rust/crates/er-web/examples/m9e_v7_title_storage_fixtures.rs", "scripts/build-kernel-m9e-title-storage-web.mjs",
  "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-kernel/src/snapshot_v7.rs",
  "rust/crates/er-game/src/current_bootstrap_storage.rs", "rust/crates/er-game/src/m72_bootstrap.rs",
  "rust/crates/er-types/src/m72_bootstrap.rs", "rust/crates/er-web/src/contracts_v2.rs",
  "rust/crates/er-web/src/host_v2.rs", "rust/crates/er-env/src/current.rs",
  "test/node/rust-browser/engineering/current-storage-owner.test.ts",
];
if (JSON.stringify(Object.keys(manifest.source_hashes).sort()) !== JSON.stringify([...sourcePaths].sort())
  || Object.values(manifest.source_hashes).some(value => typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
  || !/^[0-9a-f]{64}$/u.test(manifest.pnpm_lock_sha256) || typeof manifest.vite_version !== "string"
  || !/^1\.[0-9]+\.[0-9]+$/u.test(manifest.rustup_toolchain)
  || manifest.rustup_toolchain !== process.env.RUSTUP_TOOLCHAIN) throw new Error("Title source/cohort identity inventory differs");
const served = new Map<string, Buffer>();
const names = Object.keys(manifest.assets);
if (names.length < 2 || names.length > 8
  || names.filter(name => manifest.assets[name].role === "worker").length !== 1
  || names.filter(name => manifest.assets[name].role === "entry").length !== 1) throw new Error("storage roles differ");
let total = 0;
for (const name of names) {
  const bytes = bounded(name, 4 << 20);
  const item = manifest.assets[name];
  if (!/^current-title-storage-[a-zA-Z0-9_-]+\.js$/u.test(name) || !["entry", "worker", "chunk"].includes(item.role)
    || bytes.length !== item.bytes || sha(bytes) !== item.sha256) throw new Error("storage bundle bytes differ");
  total += bytes.length;
  served.set(`/assets/${name}`, bytes);
}
if (total > 4 << 20) throw new Error("storage bundle aggregate exceeds bound");
for (const [name, expected] of [["er_web.js", manifest.cohort.glue_sha256],
  ["er_web_bg.wasm", manifest.cohort.wasm_sha256], ["game-content-bundle-v2.json", manifest.cohort.content_sha256]]) {
  const bytes = bounded(name, name.endsWith(".js") ? 4 << 20 : 32 << 20);
  if (sha(bytes) !== expected || cohort.assets[name]?.sha256 !== expected || cohort.assets[name]?.bytes !== bytes.length) {
    throw new Error("storage Worker cohort differs");
  }
  served.set(`/assets/${name}`, bytes);
}
if (manifest.fixture.path !== "m9e-v7-title-storage-fixtures.json") throw new Error("storage fixture name differs");
const fixtureBytes = bounded(manifest.fixture.path, 32 << 20);
if (fixtureBytes.length !== manifest.fixture.bytes || sha(fixtureBytes) !== manifest.fixture.sha256) throw new Error("storage fixture bytes differ");
const fixtures = JSON.parse(fixtureBytes.toString("utf8"));
if (fixtures.capability !== manifest.capability || fixtures.fixture_kind !== manifest.fixture_kind
  || fixtures.schema_version !== 1) throw new Error("storage checkpoint kind differs");
let server: Server;
let address: string;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/") { response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><html><body>Natural Title retirement witness</body></html>"); return; }
    const body = served.get(pathname);
    if (body == null) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "cache-control": "no-store", "content-type": pathname.endsWith(".wasm") ? "application/wasm"
      : pathname.endsWith(".js") ? "text/javascript" : "application/json" });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = server.address();
  if (socket == null || typeof socket === "string") throw new Error("storage server has no TCP address");
  address = `http://127.0.0.1:${socket.port}`;
});
test.afterAll(async () => {
  if (server == null) return;
  const closed = once(server, "close");
  server.close(); server.closeAllConnections(); await closed;
});

test("natural Title retires more than sixteen actual LIST/READ owners before loading and raw generation-two Write", async ({ page }, info) => {
  const workers: string[] = [];
  page.on("worker", worker => { workers.push(worker.url()); });
  await page.goto(address);
  const evidence = await page.evaluate(async ({ entry, assets, fixture }) => {
    const module = await import(entry) as typeof import("../../../src/rust-browser/routes/rust-current-storage-entry");
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
      : value != null && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const text = (value: unknown) => JSON.stringify(canonical(value));
    const check = (condition: unknown, why: string) => { if (!condition) throw new Error(why); };
    const hash = async (value: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)))
      .map(byte => byte.toString(16).padStart(2, "0")).join("");
    const digest = (value: unknown) => hash(new TextEncoder().encode(text(value)));
    const waitFor = async (predicate: () => boolean, why: string) => {
      const until = performance.now() + 2_000;
      for (let attempts = 0; attempts < 2_000 && performance.now() < until; attempts++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      throw new Error(why);
    };
    const deferred = () => {
      let release: () => void = () => {};
      const promise = new Promise<void>(resolve => { release = resolve; });
      return { promise, release };
    };
    const databaseName = `m9e-title-retirement-${crypto.randomUUID()}`;
    const options = { databaseName, namespace: "m9e-title-retirement", contentIdentity: assets.content_sha256 };
    const owners: InstanceType<typeof module.CurrentStorageWorker>[] = [];
    const backends: InstanceType<typeof module.CurrentIndexedDbStorage>[] = [];
    const releases: Array<() => void> = [];
    // Test-only observation of REAL readonly IDB transactions. Production backend
    // source stays byte-identical. Every keepalive get belongs to the real native
    // transaction; no synthetic completion/abort result is returned to the owner.
    type Hold = { started: boolean; cancelled: boolean; released: boolean; terminal: string | null;
      gets: number; start: number; end: number; failure: string | null; transaction: IDBTransaction | null;
      timer: ReturnType<typeof setTimeout> | null };
    let armed: Hold | null = null;
    const holds: Hold[] = [];
    const nativeTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase["transaction"]>) {
      const transaction = nativeTransaction.apply(this, args);
      const hold = armed;
      if (this.name !== databaseName || transaction.mode !== "readonly" || hold == null) return transaction;
      armed = null; hold.started = true; hold.start = performance.now(); hold.transaction = transaction;
      const fail = (reason: string) => { hold.failure ??= reason; hold.released = true;
        try { transaction.abort(); } catch { /* Failure remains fatal even if already inactive. */ } };
      hold.timer = setTimeout(() => fail("real readonly keepalive exceeded 8-second deadline"), 8_000);
      const terminal = (kind: string) => {
        hold.terminal = kind; hold.end = performance.now();
        if (hold.timer != null) clearTimeout(hold.timer);
        if (!hold.cancelled) hold.failure ??= "readonly transaction terminated BEFORE accepted correlated Cancel";
        if (kind !== "COMPLETED") hold.failure ??= "keepalive transaction aborted unexpectedly";
      };
      transaction.addEventListener("complete", () => terminal("COMPLETED"), { once: true });
      transaction.addEventListener("abort", () => terminal("ABORTED"), { once: true });
      const pump = () => {
        if (hold.released) return;
        if (hold.gets >= 20_000 || performance.now() - hold.start >= 8_000) {
          fail("real readonly keepalive exceeded explicit request/time bounds"); return;
        }
        hold.gets++;
        const request = transaction.objectStore("current-values-v1").get("test-only-absent-keepalive-key");
        request.addEventListener("success", pump, { once: true });
        request.addEventListener("error", () => fail("real keepalive get failed"), { once: true });
      };
      pump();
      return transaction;
    };
    const armTransaction = () => {
      check(armed == null, "overlapping native transaction holds");
      const hold: Hold = { started: false, cancelled: false, released: false, terminal: null,
        gets: 0, start: 0, end: 0, failure: null, transaction: null, timer: null };
      armed = hold; holds.push(hold); return hold;
    };
    const snapshot = async (owner: InstanceType<typeof module.CurrentStorageWorker>) => {
      const response = await owner.dispatch({ kind: "SNAPSHOT" });
      if (response.response.kind !== "SNAPSHOT") throw new Error("snapshot response differs");
      return response.response.snapshot;
    };
    const equal = async (owner: InstanceType<typeof module.CurrentStorageWorker>, expected: any, why: string) => {
      const actual = await snapshot(owner); check(text(actual) === text(expected), why); return actual;
    };
    const raw = (kind: "KEY_DOWN" | "KEY_UP", code: string): any => ({ kind: "RAW_INPUT", event: kind === "KEY_DOWN"
      ? { kind, data: { code: { kind: code }, printable: false, browser_repeat: false, focus: "GAME" } }
      : { kind, data: { code: { kind: code } } } });
    const press = async (owner: InstanceType<typeof module.CurrentStorageWorker>, code: string) => {
      await owner.dispatch(raw("KEY_DOWN", code)); await owner.dispatch(raw("KEY_UP", code));
    };
    const pendingIdentity = (pending: any) => {
      const value = pending.lifecycle.value.current_storage.pending;
      return { requestId: value.request_id, kind: value.kind.kind as "READ" | "LIST",
        slot: value.kind.kind === "READ" ? value.kind.value.slot : null,
        waitingMenu: value.waiting_menu, waitingRevision: value.waiting_revision };
    };
    const rejectCallback = async (owner: InstanceType<typeof module.CurrentStorageWorker>, requestId: number,
      result: any, expected: any) => {
      let rejected = false;
      try { await owner.dispatch({ kind: "STORAGE_RESULT", request_id: requestId, result }); }
      catch (error) { if (error instanceof module.CurrentWorkerRequestErrorV2 && error.diagnostic.code === "HOST_REJECTED") rejected = true;
        else throw error; }
      check(rejected, "late callback was not a known current kernel rejection");
      await equal(owner, expected, "rejected callback changed full Rust oracle");
    };
    let writes = 0;
    let listCalls = 0;
    let readCalls = 0;
    let callbackReadyGate: ReturnType<typeof deferred> | null = null;
    let callbackReadyCompleted = false;
    let callbackQueuedDuringCancel = false;
    let onCancelRender: (() => Promise<void>) | null = null;
    const materialRows: any[] = [];
    let expectedPresentation: any = fixture.write.presentation;
    let shown = deferred(); releases.push(shown.release);
    const io = deferred(); releases.push(io.release);
    const real = new module.CurrentIndexedDbStorage(options); backends.push(real);
    const context = { local_seat: 1, role: "AUTHORITY" as const, protocol: null,
      scheduler: { disposed: false, next_timer_id: 0, pauses: [], timers: [] } };
    const application = {
      renderUi: async () => { const task = onCancelRender; onCancelRender = null; if (task != null) await task(); },
      changePresentationScene: () => {}, requestAsset: () => {}, playAudioCue: () => {}, recordTelemetry: () => {},
      sendNetworkFrame: (generation: number, bytes: Uint8Array) => {
        const material = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        check(generation === 1 && material.kind === "GAME_ACTION" && material.value?.schema_version === 6,
          "only current solo authority material is expected"); materialRows.push(material);
      },
      showTerminal: () => { throw new Error("unexpected terminal"); },
      publishRepro: () => { throw new Error("unexpected repro"); },
      publishCurrentRepro: () => { throw new Error("unexpected current repro"); },
    };
    const checkMaterial = (reference: any) => {
      const material = materialRows.at(-1);
      const ledger = reference.pending.material_ledger.records.find((row: any) => row.authority_revision === material?.value.authority_revision);
      check(ledger != null && ledger.after_digest === material.value.after_digest
        && text(ledger.operation_id) === text(material.value.operation_id), "actual material differs from full Rust ledger");
    };
    const present = async (effect: any, signal: AbortSignal) => {
      check(text(effect) === text(expectedPresentation), "presentation differs from actual Rust cue reference");
      await shown.promise; check(!signal.aborted, "presentation completion was cancelled");
    };
    const writer = new module.CurrentStorageWorker({ assets, sessionIdentity: "title-controlled-producer",
      initialization: { kind: "SNAPSHOT", context, snapshot: fixture.write.before },
      backend: { identity: real.identity, close: () => real.close(), list: () => real.list(), read: slot => real.read(slot),
        reconcile: image => real.reconcile(image), write: async image => { await io.promise; writes++; await real.write(image); } },
      adapters: application, present }); owners.push(writer);
    let reader: InstanceType<typeof module.CurrentStorageWorker>;
    const completed: any[] = [];
    try {
      await writer.initialize(); await equal(writer, fixture.write.before, "producer controlled boundary differs");
      await press(writer, "SPACE"); await equal(writer, fixture.write.pending, "producer pending save differs");
      checkMaterial(fixture.write);
      io.release(); await writer.drainStorage();
      await equal(writer, fixture.write.callback, "real producer Written callback differs");
      check(writer.status.callbacksAccepted === 1 && writer.status.pendingPresentations === 1,
        "producer callback settled independent presentation");
      shown.release(); await writer.drainPresentations(); await equal(writer, fixture.write.settled, "producer cue settlement differs");
      await writer.dispatch({ kind: "ADVANCE_TIME", milliseconds: 1 });
      await equal(writer, fixture.write.continued, "producer continuation differs");
      const reopened = new module.CurrentIndexedDbStorage(options); backends.push(reopened);
      const saved = await reopened.read("controlled-slot");
      const writeProgress = writer.storageProgress().find(row => row.requestId === fixture.write.request.request_id);
      check(saved != null && saved.generation === 1 && saved.operation === writeProgress?.operation
        && writeProgress?.phase === "ACKNOWLEDGED" && writeProgress.durable
        && text(Array.from(saved.bytes)) === text(fixture.write.request.bytes), "actual producer bytes/receipt differ");
      check((await writer.dispose()).acknowledged, "producer disposal lacks acknowledgement");
      const readBackend = new module.CurrentIndexedDbStorage(options); backends.push(readBackend);
      const completionGate = { current: null as ReturnType<typeof deferred> | null };
      reader = new module.CurrentStorageWorker({ assets, sessionIdentity: "natural-title-reader",
        initialization: { kind: "NATURAL_START", context, profile: fixture.initial.lifecycle.value.profile,
          seed: "m9e-title-storage-retirement", save_slots: ["new-run-destination"], local_is_host: true, existing_saves: true },
        backend: { identity: readBackend.identity, close: () => readBackend.close(), reconcile: image => readBackend.reconcile(image),
          list: async () => { listCalls++; const result = await readBackend.list();
            const gate = completionGate.current; if (gate != null) await gate.promise; return result; },
          read: async slot => { readCalls++; const result = await readBackend.read(slot);
            const gate = callbackReadyGate ?? completionGate.current;
            if (callbackReadyGate != null) callbackReadyCompleted = true;
            if (gate != null) await gate.promise; return result; },
          write: async image => { const gate = completionGate.current; if (gate != null) await gate.promise;
            writes++; await readBackend.write(image); } }, adapters: application, present }); owners.push(reader);
      await reader.initialize(); await equal(reader, fixture.initial, "actual natural opt-in Title differs");
      const beginList = async (reference: any) => {
        await equal(reader, reference.before, "Title before LIST differs");
        await press(reader, "ARROW_DOWN"); await equal(reader, reference.selected, "raw Title existing-save selection differs");
        await press(reader, "SPACE"); await equal(reader, reference.pending, "actual LIST pending owner differs");
      };
      const cancel = async (pending: any, after: any, hold: Hold | null, retainedFloor: number) => {
        const identity = pendingIdentity(pending);
        const callbacks = reader.status.callbacksAccepted;
        const accepted = await reader.dispatchTitleInput(raw("KEY_DOWN", "ESCAPE"), identity);
        if (hold != null) {
          check(hold.started && hold.terminal == null && hold.failure == null && hold.gets > 0,
            "active-transaction case silently became callback-only cancellation");
          hold.cancelled = true;
          const draining = reader.storageRetirementStatus();
          check(draining.pending === 1 && draining.cancelling === 1,
            "Cancel reclaimed admission before native readonly transaction drained");
          hold.released = true;
        }
        await reader.dispatch(raw("KEY_UP", "ESCAPE"));
        await equal(reader, after, "known accepted Cancel full Rust snapshot differs");
        const retired = (await reader.drainStorage()).find(row => row.requestId === identity.requestId);
        check(retired?.phase === "CANCELLED" && retired.cancellation?.terminal === "COMPLETED"
          && retired.cancellation.cancelSequence === accepted.accepted_sequence
          && retired.cancellation.postSequence === accepted.accepted_sequence + 1,
          "retirement lacks correlated Worker acceptance and real backend terminal evidence");
        const state = reader.storageRetirementStatus();
        check(state.pending === 0 && state.cancelling === 0 && state.retainedBytes === retainedFloor
          && state.highestId === identity.requestId && !state.fenced && reader.status.callbacksAccepted === callbacks,
          "cancelled owner leaked capacity, reused IDs, or delivered a late callback");
        if (hold != null) check(hold.terminal === "COMPLETED" && hold.failure == null && hold.gets <= 20_000
          && hold.end - hold.start < 8_000, "native readonly drain did not meet exact bounded witness");
        await rejectCallback(reader, identity.requestId, identity.kind === "LIST" ? { kind: "SLOTS", slots: ["controlled-slot"] }
          : { kind: "READ", bytes: Array.from(saved!.bytes) }, after);
        let stale = false;
        try { await reader.dispatchTitleInput(raw("KEY_DOWN", "ESCAPE"), identity); }
        catch (error) { if (error instanceof module.CurrentTitleInputStaleError && error.acceptance === "NOT_SENT") stale = true;
          else throw error; }
        check(stale, "pre-cancel rendered identity was allowed to post another input");
        await equal(reader, after, "stale rendered Cancel changed actual full state");
        completed.push({ request: identity.requestId, kind: identity.kind, sequence: accepted.accepted_sequence,
          post: retired!.cancellation!.postSequence, snapshot: await digest(after) });
      };
      check(fixture.cycles.length === 21 && fixture.read_cancels.length === 2
        && fixture.cycles[1].mode === "QUEUED_NOT_STARTED"
        && fixture.cycles.filter((row: any) => row.mode === "ACTIVE_TRANSACTION").length === 20,
      "bounded Rust cycle inventory differs");
      // The second real Title request queues behind work whose core Cancel is
      // already accepted but whose real IDB transaction is deliberately active.
      // Both owners retain capacity until that transaction actually completes.
      const first = fixture.cycles[0];
      const queued = fixture.cycles[1];
      const firstHold = armTransaction();
      await beginList(first);
      await waitFor(() => firstHold.started, "first real LIST transaction never started");
      const firstCancel = await reader.dispatchTitleInput(raw("KEY_DOWN", "ESCAPE"), pendingIdentity(first.pending));
      check(firstHold.terminal == null && firstHold.failure == null && firstHold.gets > 0,
        "first queued-pair transaction ended before accepted Cancel");
      firstHold.cancelled = true;
      await reader.dispatch(raw("KEY_UP", "ESCAPE"));
      await equal(reader, first.cancelled, "first held Cancel full snapshot differs");
      check(reader.storageRetirementStatus().pending === 1 && reader.storageRetirementStatus().cancelling === 1,
        "first cancelled owner reclaimed admission while real transaction active");
      const backendStarts = listCalls;
      await beginList(queued);
      check(listCalls === backendStarts && reader.storageProgress().find(row => row.requestId === queued.request_id)?.phase === "QUEUED",
        "second real LIST bypassed the actual running backend owner");
      const queuedCancel = await reader.dispatchTitleInput(raw("KEY_DOWN", "ESCAPE"), pendingIdentity(queued.pending));
      await reader.dispatch(raw("KEY_UP", "ESCAPE"));
      await equal(reader, queued.cancelled, "queued Cancel full snapshot differs");
      const pairDraining = reader.storageRetirementStatus();
      check(pairDraining.pending === 2 && pairDraining.cancelling === 2 && pairDraining.highestId === queued.request_id
        && pairDraining.retainedBytes === 0 && listCalls === backendStarts && firstHold.terminal == null,
        "queued cancellation released admission early or started a second backend transaction");
      firstHold.released = true;
      const pair = await reader.drainStorage();
      check(firstHold.terminal === "COMPLETED" && firstHold.failure == null && firstHold.gets <= 20_000
        && firstHold.end - firstHold.start < 8_000, "first actual transaction did not drain within its bounds");
      for (const [reference, accepted, terminal] of [[first, firstCancel, "COMPLETED"],
        [queued, queuedCancel, "NOT_STARTED"]] as const) {
        const row = pair.find(item => item.requestId === reference.request_id);
        check(row?.phase === "CANCELLED" && row.cancellation?.terminal === terminal
          && row.cancellation.cancelSequence === accepted.accepted_sequence
          && row.cancellation.postSequence === accepted.accepted_sequence + 1,
          "queued pair lacks exact independent terminal and correlated acceptance evidence");
        await rejectCallback(reader, reference.request_id, { kind: "SLOTS", slots: ["controlled-slot"] }, queued.cancelled);
        let stale = false;
        try { await reader.dispatchTitleInput(raw("KEY_DOWN", "ESCAPE"), pendingIdentity(reference.pending)); }
        catch (error) { if (error instanceof module.CurrentTitleInputStaleError && error.acceptance === "NOT_SENT") stale = true;
          else throw error; }
        check(stale, "retired queued-pair rendered Cancel was submitted");
        await equal(reader, queued.cancelled, "queued-pair stale callback/input changed full state");
        completed.push({ request: reference.request_id, kind: "LIST", sequence: accepted.accepted_sequence,
          post: row!.cancellation!.postSequence, snapshot: await digest(reference.cancelled) });
      }
      const pairDone = reader.storageRetirementStatus();
      check(pairDone.pending === 0 && pairDone.cancelling === 0 && pairDone.retainedBytes === 0
        && pairDone.highestId === queued.request_id && !pairDone.fenced && reader.status.callbacksAccepted === 0
        && listCalls === backendStarts, "queued pair did not release exactly once without I/O or callback");
      for (const reference of fixture.cycles.slice(2)) {
        const retainedFloor = reader.storageRetirementStatus().retainedBytes;
        const hold = armTransaction();
        await beginList(reference);
        await waitFor(() => hold.started, "actual LIST transaction never started");
        await cancel(reference.pending, reference.cancelled, hold, retainedFloor);
      }
      const completeList = async (reference: any, selected: any) => {
        const gate = deferred(); releases.push(gate.release); completionGate.current = gate;
        await beginList(reference); gate.release(); await reader.drainStorage(); completionGate.current = null;
        await equal(reader, selected, "actual inventory callback differs");
        check(text((selected.lifecycle as any).value.current_storage.slots) === text(["controlled-slot"]),
          "inventory includes a synthetic new-run destination");
      };
      for (const reference of fixture.read_cancels) {
        await completeList(reference.listing, reference.selected);
        const retainedFloor = reader.storageRetirementStatus().retainedBytes;
        const hold = reference.mode === "ACTIVE_TRANSACTION" ? armTransaction() : null;
        if (hold == null) { callbackReadyGate = deferred(); releases.push(callbackReadyGate.release); callbackReadyCompleted = false; }
        await press(reader, "SPACE"); await equal(reader, reference.pending, "actual READ owner differs");
        if (hold != null) await waitFor(() => hold.started, "actual READ transaction never started");
        else {
          await waitFor(() => callbackReadyCompleted, "READ never completed its actual IDB transaction");
          onCancelRender = async () => {
            // Cancel already owns the single pre/input/post rail. Release an
            // actual completed READ and prove its callback queued behind this
            // rail before the post snapshot can authorize suppression.
            callbackReadyGate!.release();
            await waitFor(() => reader.status.pending === 2,
              "completed READ callback did not queue behind the actual Cancel rail");
            check(reader.storageRetirementStatus().retainedBytes > retainedFloor,
              "callback-ready READ did not retain its actual result before cancellation");
            callbackQueuedDuringCancel = true;
          };
        }
        await cancel(reference.pending, reference.cancelled, hold, retainedFloor);
        callbackReadyGate = null;
      }
      check(callbackQueuedDuringCancel, "final wire callback guard was not exercised");
      await completeList(fixture.load.listing, fixture.load.selected);
      const loadGate = deferred(); releases.push(loadGate.release); completionGate.current = loadGate;
      await press(reader, "SPACE"); await equal(reader, fixture.load.pending, "final actual Title READ pending differs");
      loadGate.release(); await reader.drainStorage(); completionGate.current = null;
      const loaded = await equal(reader, fixture.load.loaded, "natural Title loaded full Rust oracle differs");
      const storedSave = JSON.parse(new TextDecoder().decode(saved!.bytes));
      const expected = structuredClone(storedSave.state);
      const live = fixture.load.pending;
      const control = expected.active_run.control;
      const revision = Math.max(live.lifecycle.value.control.revision, control.revision) + 1;
      const menu = Math.max(live.next_menu_instance_id, control.menu.instance_id + 1);
      expected.identities.next_platform_request_id = Math.max(expected.identities.next_platform_request_id,
        live.lifecycle.value.current_storage.next_platform_request_id);
      control.revision = revision; control.menu.instance_id = menu;
      control.action_context.authority_revision = revision; control.action_context.menu_instance = menu;
      check(text((loaded.lifecycle as any).value) === text(expected),
        "Title READ changed saved gameplay beyond exact control and allocator normalization");
      await rejectCallback(reader, fixture.load.request_id, { kind: "READ", bytes: Array.from(saved!.bytes) }, fixture.load.loaded);
      const rewriteGate = deferred(); releases.push(rewriteGate.release); completionGate.current = rewriteGate;
      expectedPresentation = fixture.rewrite.presentation; shown = deferred(); releases.push(shown.release);
      await equal(reader, fixture.rewrite.before, "post-load raw Write has a different starting core");
      await press(reader, "SPACE"); await equal(reader, fixture.rewrite.pending, "post-load raw Write pending differs");
      checkMaterial(fixture.rewrite);
      rewriteGate.release(); await reader.drainStorage(); completionGate.current = null;
      await equal(reader, fixture.rewrite.callback, "generation-two callback differs");
      check(reader.status.pendingPresentations === 1 && reader.status.presentationsSettled === 0,
        "storage callback falsely settled loaded Save presentation");
      const rewritten = await reopened.read("controlled-slot");
      const progress = reader.storageProgress().find(row => row.requestId === fixture.rewrite.request.request_id);
      check(rewritten != null && rewritten.generation === 2 && rewritten.operation === progress?.operation
        && progress?.phase === "ACKNOWLEDGED" && progress.durable
        && text(Array.from(rewritten.bytes)) === text(fixture.rewrite.request.bytes), "generation-two actual bytes/receipt differ");
      check(fixture.rewrite.request.request_id > fixture.load.request_id && writes === 2 && listCalls === 23 && readCalls === 3
        && reader.status.callbacksAccepted === 5 && materialRows.length === 2, "exact real owner/action/callback inventory differs");
      shown.release(); await reader.drainPresentations(); await equal(reader, fixture.rewrite.settled, "post-load cue settlement differs");
      await reader.dispatch({ kind: "ADVANCE_TIME", milliseconds: 1 });
      await equal(reader, fixture.rewrite.continued, "post-load rewrite continuation differs");
      await rejectCallback(reader, fixture.rewrite.request.request_id, { kind: "WRITTEN" }, fixture.rewrite.continued);
      check((await reader.dispose()).acknowledged, "drained reader failed graceful disposal");
      check(holds.length === 21 && completed.length === 23 && holds.every(hold => hold.started && hold.cancelled
        && hold.terminal === "COMPLETED" && hold.failure == null), "bounded native terminal proof inventory differs");
      return { cancelled: completed.length, list_cancels: 21, read_cancels: 2, queued_not_started_cancels: 1, list_emissions: 24, native_transaction_cancels: holds.length,
        native_gets: holds.reduce((sum, hold) => sum + hold.gets, 0), native_get_limit_per_transaction: 20_000,
        native_deadline_ms: 8_000, all_native_completions_after_cancel: true, callback_queued_before_retirement: true,
        correlated_sequences: completed.map(row => [row.request, row.sequence, row.post]),
        cancelled_snapshot_digest: await digest(completed.map(({ request, kind, snapshot: snapshotDigest }) =>
          ({ request, kind, snapshot: snapshotDigest }))), queued_not_started_request_id: queued.request_id,
        highest_retired_id: completed.at(-1).request,
        lists: listCalls, reads: readCalls, writes, reader_callbacks: reader.status.callbacksAccepted,
        producer_receipt: saved!.operation, producer_payload_sha256: await hash(saved!.bytes),
        load_snapshot_sha256: await digest(loaded), rewrite_request_id: fixture.rewrite.request.request_id,
        rewrite_generation: rewritten!.generation, rewrite_payload_bytes: rewritten!.bytes.length,
        rewrite_receipt: rewritten!.operation, rewrite_payload_sha256: await hash(rewritten!.bytes),
        rewrite_callback_sha256: await digest(fixture.rewrite.callback), rewrite_continued_sha256: await digest(fixture.rewrite.continued),
        presentation_id: fixture.rewrite.presentation.event_id, presentation_settlements: reader.status.presentationsSettled,
        stale_callbacks_conserve_snapshot: true, stale_rendered_cancel_not_sent: true,
        disposed: true, queue_empty: owners.every(owner => owner.status.pending === 0 && owner.status.queuedBytes === 0
          && owner.status.responseBytes === 0 && owner.status.presentationBytes === 0 && owner.status.pendingPresentations === 0) };
    } finally {
      armed = null;
      for (const hold of holds) { hold.released = true; if (hold.timer != null) clearTimeout(hold.timer);
        if (hold.terminal == null && hold.transaction != null) { try { hold.transaction.abort(); } catch {} } }
      IDBDatabase.prototype.transaction = nativeTransaction;
      for (const release of releases) release();
      await Promise.allSettled(owners.map(owner => owner.dispose()));
      await Promise.allSettled(backends.map(backend => backend.close()));
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        const timer = setTimeout(() => reject(new Error("Title database cleanup deadline")), 10_000);
        request.onsuccess = () => { clearTimeout(timer); resolve(); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); reject(new Error("Title database cleanup blocked")); };
      });
    }
  }, { entry: `${address}/assets/${manifest.entry}`, fixture: fixtures,
    assets: { wasm_url: `${address}/assets/er_web_bg.wasm`, wasm_sha256: manifest.cohort.wasm_sha256,
      glue_url: `${address}/assets/er_web.js`, glue_sha256: manifest.cohort.glue_sha256,
      content_url: `${address}/assets/game-content-bundle-v2.json`, content_sha256: manifest.cohort.content_sha256 } });
  expect(workers).toHaveLength(2);
  for (const worker of workers) expect(worker).toBe(`${address}/assets/${manifest.worker}`);
  expect(evidence.queue_empty).toBe(true);
  const attachment = Buffer.from(JSON.stringify({ schema_version: 1, capability: manifest.capability,
    fixture_kind: manifest.fixture_kind, source_sha: manifest.source_sha, manifest_sha256: sha(manifestBytes),
    fixture_sha256: manifest.fixture.sha256, worker_sha256: manifest.assets[manifest.worker].sha256,
    observed_worker_count: workers.length, cohort: manifest.cohort, evidence }));
  expect(attachment.length).toBeLessThanOrEqual(4096);
  await info.attach("m9e-current-worker-title-storage-retirement", { body: attachment, contentType: "application/json" });
});
