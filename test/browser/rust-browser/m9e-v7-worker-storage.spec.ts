import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { relative, resolve, sep } from "node:path";
import { expect, test, type Page, type TestInfo } from "playwright/test";

// Same existing real V7 Worker allowance; controlled Save/Load, not natural Save.
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
const manifestBytes = bounded("m9e-v7-storage-assets.json", 16 * 1024);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const cohort = JSON.parse(bounded("m9e-v7-web-assets.json", 32 * 1024).toString("utf8"));
if (manifest.schema_version !== 2 || manifest.capability !== "CURRENT_WORKER_CONTROLLED_SAVE"
  || manifest.fixture_kind !== "CONTROLLED_SAVE_CHECKPOINT" || manifest.source_sha !== cohort.source_sha
  || !/^[0-9a-f]{40}$/u.test(manifest.source_sha)
  || (process.env.GITHUB_SHA != null && manifest.source_sha !== process.env.GITHUB_SHA)
  || manifest.entry !== "current-storage-entry.js" || manifest.assets[manifest.entry]?.role !== "entry"
  || manifest.assets[manifest.worker]?.role !== "worker") throw new Error("storage manifest identity differs");
const served = new Map<string, Buffer>();
const names = Object.keys(manifest.assets);
if (names.length < 2 || names.length > 8
  || names.filter(name => manifest.assets[name].role === "worker").length !== 1
  || names.filter(name => manifest.assets[name].role === "entry").length !== 1) throw new Error("storage roles differ");
let total = 0;
for (const name of names) {
  const bytes = bounded(name, 4 << 20);
  const item = manifest.assets[name];
  if (!/^current-storage-[a-zA-Z0-9_-]+\.js$/u.test(name) || !["entry", "worker", "chunk"].includes(item.role)
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
if (manifest.fixture.path !== "m9e-v7-storage-fixtures.json") throw new Error("storage fixture name differs");
const fixtureBytes = bounded(manifest.fixture.path, 32 << 20);
if (fixtureBytes.length !== manifest.fixture.bytes || sha(fixtureBytes) !== manifest.fixture.sha256) throw new Error("storage fixture bytes differ");
const fixtures = JSON.parse(fixtureBytes.toString("utf8"));
if (fixtures.capability !== manifest.capability || fixtures.fixture_kind !== manifest.fixture_kind
  || fixtures.schema_version !== 2) throw new Error("storage checkpoint kind differs");
let server: Server;
let address: string;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/") { response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><html><body>Controlled current save witness</body></html>"); return; }
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

async function witness(page: Page, info: TestInfo, lost: boolean): Promise<void> {
  const workers: string[] = [];
  page.on("worker", worker => { workers.push(worker.url()); });
  await page.goto(address);
  const evidence = await page.evaluate(async ({ entry, assets, fixture, lost }) => {
    const module = await import(entry) as typeof import("../../../src/rust-browser/routes/rust-current-storage-entry");
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
      : value != null && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const text = (value: unknown) => JSON.stringify(canonical(value));
    const check = (condition: unknown, why: string) => { if (!condition) throw new Error(why); };
    const hash = async (value: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)))
      .map(byte => byte.toString(16).padStart(2, "0")).join("");
    const snapshotHash = (value: unknown) => hash(new TextEncoder().encode(text(value)));
    const databaseName = `m9e-worker-save-${crypto.randomUUID()}`;
    const options = { databaseName, namespace: "m9e-controlled-save", contentIdentity: assets.content_sha256 };
    const owners: InstanceType<typeof module.CurrentStorageWorker>[] = [];
    const backends: InstanceType<typeof module.CurrentIndexedDbStorage>[] = [];
    const releases: Array<() => void> = [];
    let writes = 0;
    const materials: any[] = [];
    const create = (reference: any, drop: boolean, namespace = options.namespace, cancel = false) => {
      const real = new module.CurrentIndexedDbStorage({ ...options, namespace });
      backends.push(real);
      let releaseIO: () => void = () => {};
      let releasePresentation: () => void = () => {};
      let io = Promise.resolve();
      let shown = Promise.resolve();
      let expectedPresentation: any;
      let callbackFloor = 0;
      let presentationFloor = 0;
      const arm = (next: any) => {
        expectedPresentation = next.presentation;
        io = new Promise<void>(resolve => { releaseIO = resolve; });
        shown = new Promise<void>(resolve => { releasePresentation = resolve; });
        releases.push(releaseIO, releasePresentation);
      };
      arm(reference);
      let cancelled: Promise<{ acknowledged: boolean }> | null = null;
      let callsAfterCancel = 0;
      let calls = 0;
      const observe = () => { calls++; if (cancelled != null) callsAfterCancel++; };
      const cancelFromAdapter = () => { if (cancel && cancelled == null) cancelled = owner.dispose(); };
      const unexpected = () => { throw new Error("unexpected effect in controlled Save/Load witness"); };
      const owner = new module.CurrentStorageWorker({ assets, sessionIdentity: drop ? "same-pending-save-lost" : "same-pending-save",
        initialization: { kind: "SNAPSHOT", context: { local_seat: 1, role: "AUTHORITY", protocol: null,
          scheduler: { disposed: false, next_timer_id: 0, pauses: [], timers: [] } }, snapshot: reference.before },
        backend: { identity: real.identity, close: () => real.close(), list: () => real.list(),
          reconcile: image => real.reconcile(image), read: async slot => { await io; return real.read(slot); },
          write: async image => {
            await io;
            if (namespace === options.namespace) writes++;
            await real.write(image);
            if (await real.reconcile(image) !== "COMMITTED") throw new Error("actual IDB commit readback failed");
            if (drop) throw new Error("completion deliberately lost AFTER actual IDB commit and readback");
          } },
        adapters: { renderUi: () => { observe(); cancelFromAdapter(); }, changePresentationScene: () => { observe(); },
          sendNetworkFrame: (generation, bytes) => {
            observe();
            const material = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            check(generation === 1 && material.kind === "GAME_ACTION" && material.value?.schema_version === 6,
              "controlled Save/Load must emit actual current material");
            materials.push(material);
            cancelFromAdapter();
          }, requestAsset: () => { observe(); }, playAudioCue: () => { observe(); }, showTerminal: unexpected,
          recordTelemetry: () => { observe(); }, publishRepro: unexpected, publishCurrentRepro: unexpected },
        present: async (effect, signal) => {
          observe();
          check(text(effect) === text(expectedPresentation), "actual presentation differs from Rust cue oracle");
          // Mutating caller-owned copies must not change the captured settlement ID.
          effect.event_id = Number.MAX_SAFE_INTEGER;
          await shown;
          check(!signal.aborted, "presentation must actually complete before settlement");
        },
      });
      owners.push(owner);
      return { owner, real, releaseIO: () => releaseIO(), releasePresentation: () => releasePresentation(),
        arm: (next: any) => { callbackFloor = owner.status.callbacksAccepted;
          presentationFloor = owner.status.presentationsSettled; arm(next); },
        floors: () => ({ callbacks: callbackFloor, presentations: presentationFloor }),
        cancellation: () => ({ disposal: cancelled, calls, callsAfterCancel }) };
    };
    const snapshot = async (owner: InstanceType<typeof module.CurrentStorageWorker>) => {
      const response = await owner.dispatch({ kind: "SNAPSHOT" });
      if (response.response.kind !== "SNAPSHOT") throw new Error("snapshot kind differs");
      return response.response.snapshot;
    };
    const assertSnapshot = async (owner: InstanceType<typeof module.CurrentStorageWorker>, expected: any, why: string) => {
      const actual = await snapshot(owner); check(text(actual) === text(expected), why); return actual;
    };
    const activate = async (active: ReturnType<typeof create>, reference: any, initialize = true) => {
      if (initialize) await active.owner.initialize();
      await assertSnapshot(active.owner, reference.before, "controlled initial snapshot differs");
      await active.owner.dispatch({ kind: "RAW_INPUT", event: { kind: "KEY_DOWN", data: {
        code: { kind: "SPACE" }, printable: false, browser_repeat: false, focus: "GAME" } } });
      await active.owner.dispatch({ kind: "RAW_INPUT", event: { kind: "KEY_UP", data: { code: { kind: "SPACE" } } } });
      await assertSnapshot(active.owner, reference.pending, "actual raw action pending snapshot differs");
      check(active.owner.status.pendingPresentations === 1 && active.owner.status.callbacksAccepted === active.floors().callbacks,
        "independent pending presentation/storage owners missing");
      const material = materials.at(-1);
      const record = reference.pending.material_ledger.records.find((row: any) => row.authority_revision === material.value.authority_revision);
      check(record != null && record.after_digest === material.value.after_digest
        && text(record.operation_id) === text(material.value.operation_id), "material differs from real committed fixture ledger");
    };
    const reject = async (owner: InstanceType<typeof module.CurrentStorageWorker>, request: any, expected: any) => {
      let code = "";
      try { await owner.dispatch(request); }
      catch (error) { if (error instanceof module.CurrentWorkerRequestErrorV2) code = error.diagnostic.code; else throw error; }
      check(code === "HOST_REJECTED", "invalid callback was not a known kernel rejection");
      await assertSnapshot(owner, expected, "rejected callback changed complete snapshot");
    };
    const settle = async (active: ReturnType<typeof create>, reference: any) => {
      check(active.owner.status.pendingPresentations === 1 && active.owner.status.presentationsSettled === active.floors().presentations,
        "storage callback settled presentation early");
      active.releasePresentation();
      await active.owner.drainPresentations();
      await assertSnapshot(active.owner, reference.settled, "presentation settlement snapshot differs");
      await active.owner.dispatch({ kind: "ADVANCE_TIME", milliseconds: 1 });
      await assertSnapshot(active.owner, reference.continued, "loaded/saved continuation snapshot differs");
    };
    try {
      const write = create(fixture.write, lost);
      await activate(write, fixture.write);
      await reject(write.owner, { kind: "STORAGE_RESULT", request_id: fixture.write.request.request_id,
        result: { kind: "DELETED" } }, fixture.write.pending);
      await reject(write.owner, { kind: "STORAGE_RESULT", request_id: Number.MAX_SAFE_INTEGER,
        result: { kind: "WRITTEN" } }, fixture.write.pending);
      write.releaseIO();
      const first = (await write.owner.drainStorage())[0];
      if (lost) {
        check(first.phase === "UNCERTAIN" && !first.durable && write.owner.status.callbacksAccepted === 0,
          "real committed lost completion did not remain uncertain");
        await assertSnapshot(write.owner, fixture.write.pending, "uncertain write retired a core owner");
      } else { check(first.phase === "ACKNOWLEDGED" && first.durable, "actual write callback not accepted"); }
      const reopened = new module.CurrentIndexedDbStorage(options);
      backends.push(reopened);
      const durable = await reopened.read("controlled-slot");
      check(durable != null && durable.generation === 1 && durable.operation === first.operation
        && text(Array.from(durable.bytes)) === text(fixture.write.request.bytes), "independent reopened save bytes/receipt differ");
      const save = JSON.parse(new TextDecoder().decode(durable!.bytes));
      check(save.schema_version === 2 && save.generation === 1 && text(save.content_identity) === text(fixture.content_identity),
        "persisted data is not the actual generated current GameSaveV2");
      if (lost) {
        const retried = (await write.owner.retryStorage(fixture.write.request.request_id))[0];
        check(retried.phase === "ACKNOWLEDGED" && retried.durable, "exact uncertainty reconciliation did not acknowledge");
      }
      check(writes === 1 && write.owner.status.callbacksAccepted === 1, "save was rewritten or callback repeated");
      await assertSnapshot(write.owner, fixture.write.callback, "Written callback full snapshot differs");
      await reject(write.owner, { kind: "STORAGE_RESULT", request_id: fixture.write.request.request_id,
        result: { kind: "WRITTEN" } }, fixture.write.callback);
      await settle(write, fixture.write);
      const writerDispose = await write.owner.dispose();
      check(writerDispose.acknowledged && write.owner.status.transport.pending === 0
        && write.owner.status.pendingPresentations === 0, "writer teardown was not acknowledged and empty");
      let loadSnapshotDigest: string | null = null;
      let loadCallbackCount = 0;
      let rewriteEvidence: any = null;
      let pendingDisposeUnconfirmed = false;
      let cancellationEvidence: { accepted_sequence: number; calls_after_cancel: number; dispose_acknowledged: boolean } | null = null;
      if (!lost) {
        const load = create(fixture.load, false);
        await activate(load, fixture.load);
        await reject(load.owner, { kind: "STORAGE_RESULT", request_id: fixture.load.request.request_id,
          result: { kind: "READ", bytes: [0] } }, fixture.load.pending);
        load.releaseIO();
        const loaded = (await load.owner.drainStorage())[0];
        check(loaded.phase === "ACKNOWLEDGED" && load.owner.status.callbacksAccepted === 1, "actual READ callback failed");
        const loadedSnapshot = await assertSnapshot(load.owner, fixture.load.callback, "loaded full core oracle differs");
        const expectedState = structuredClone(save.state);
        const live = fixture.load.pending;
        const control = expectedState.active_run.control;
        const revision = Math.max(live.material_ledger.next_authority_revision, control.revision + 1,
          ...live.pending_presentations.map((item: any) => item.event_id + 1));
        const instance = Math.max(live.next_menu_instance_id, control.menu.instance_id + 1);
        expectedState.identities.next_platform_request_id = Math.max(expectedState.identities.next_platform_request_id,
          live.lifecycle.value.identities.next_platform_request_id);
        control.revision = revision; control.menu.instance_id = instance;
        control.action_context.authority_revision = revision; control.action_context.menu_instance = instance;
        check(text((loadedSnapshot.lifecycle as any).value) === text(expectedState),
          "actual READ changed saved gameplay beyond exact control/platform normalization");
        loadSnapshotDigest = await snapshotHash(loadedSnapshot);
        await settle(load, fixture.load);
        loadCallbackCount = load.owner.status.callbacksAccepted;
        check(text(fixture.rewrite.before) === text(fixture.load.continued), "post-load fixture lost exact live continuation");
        load.arm(fixture.rewrite);
        await activate(load, fixture.rewrite, false);
        await reject(load.owner, { kind: "STORAGE_RESULT", request_id: fixture.load.request.request_id,
          result: { kind: "READ", bytes: Array.from(durable!.bytes) } }, fixture.rewrite.pending);
        await reject(load.owner, { kind: "STORAGE_RESULT", request_id: fixture.rewrite.request.request_id,
          result: { kind: "DELETED" } }, fixture.rewrite.pending);
        load.releaseIO();
        const rewritten = (await load.owner.drainStorage()).find(item => item.requestId === fixture.rewrite.request.request_id);
        check(rewritten?.phase === "ACKNOWLEDGED" && rewritten.durable && load.owner.status.callbacksAccepted === 2,
          "real post-load Write callback did not acknowledge exactly once");
        await assertSnapshot(load.owner, fixture.rewrite.callback, "post-load Written callback changed full oracle");
        await reject(load.owner, { kind: "STORAGE_RESULT", request_id: fixture.rewrite.request.request_id,
          result: { kind: "WRITTEN" } }, fixture.rewrite.callback);
        const generationTwo = await reopened.read("controlled-slot");
        check(generationTwo != null && generationTwo.generation === 2 && generationTwo.operation === rewritten!.operation
          && text(Array.from(generationTwo.bytes)) === text(fixture.rewrite.request.bytes), "actual post-load bytes or receipt differ");
        check(fixture.rewrite.request.request_id > fixture.load.request.request_id
          && fixture.rewrite.presentation.event_id > fixture.load.presentation.event_id,
          "post-load request or presentation reused a pre-load owner");
        await settle(load, fixture.rewrite);
        rewriteEvidence = { request_id: fixture.rewrite.request.request_id, presentation_id: fixture.rewrite.presentation.event_id,
          generation: 2, receipt: generationTwo!.operation, payload_sha256: await hash(generationTwo!.bytes),
          payload_bytes: generationTwo!.bytes.length, callbacks: 1,
          pending_snapshot_sha256: await snapshotHash(fixture.rewrite.pending),
          callback_snapshot_sha256: await snapshotHash(fixture.rewrite.callback),
          continued_snapshot_sha256: await snapshotHash(fixture.rewrite.continued) };
        check((await load.owner.dispose()).acknowledged && load.owner.status.transport.pending === 0,
          "reader disposal was not acknowledged and empty");
      } else {
        // An independent actual Worker has an accepted Save and held external
        // owners. Disposal cannot claim these are durably/visually completed.
        const abandoned = create(fixture.write, false, "m9e-controlled-save-abandoned");
        await activate(abandoned, fixture.write);
        const disposal = abandoned.owner.dispose();
        abandoned.releaseIO();
        abandoned.releasePresentation();
        const result = await disposal;
        check(!result.acknowledged && abandoned.owner.status.callbacksAccepted === 0
          && abandoned.owner.status.presentationsSettled === 0 && abandoned.owner.status.transport.closed
          && abandoned.owner.storageProgress().every(entry => entry.phase === "FENCED"),
        "disposed pending owners falsely acknowledged late completion");
        const independent = new module.CurrentIndexedDbStorage({ ...options, namespace: "m9e-controlled-save-abandoned" });
        backends.push(independent);
        check(await independent.read("controlled-slot") === null, "late disposed backend started a write");
        pendingDisposeUnconfirmed = true;
        // The first actual network/UI effect cancels synchronously. It does not
        // await disposal from inside the adapter, which would create a cycle.
        const cancelled = create(fixture.write, false, "m9e-controlled-save-cancelled", true);
        await cancelled.owner.initialize();
        let acceptedSequence = -1;
        try {
          await cancelled.owner.dispatch({ kind: "RAW_INPUT", event: { kind: "KEY_DOWN", data: {
            code: { kind: "SPACE" }, printable: false, browser_repeat: false, focus: "GAME" } } });
        } catch (error) {
          if (error instanceof module.CurrentStorageDeliveryError && error.acceptance === "ACCEPTED") acceptedSequence = error.acceptedSequence;
          else throw error;
        }
        const cancellation = cancelled.cancellation();
        check(Number.isSafeInteger(acceptedSequence) && acceptedSequence >= 1 && cancellation.disposal != null
          && cancellation.calls >= 1, "accepted action did not reach synchronous adapter cancellation");
        cancelled.releaseIO(); cancelled.releasePresentation();
        const disposalResult = await cancellation.disposal!;
        check(!disposalResult.acknowledged && cancelled.cancellation().callsAfterCancel === 0
          && cancelled.owner.status.callbacksAccepted === 0 && cancelled.owner.status.presentationsSettled === 0,
        "cancelled accepted response invoked late adapters or falsely acknowledged owners");
        cancellationEvidence = { accepted_sequence: acceptedSequence, calls_after_cancel: 0, dispose_acknowledged: false };
      }
      const final = await reopened.read("controlled-slot");
      check(writes === (lost ? 1 : 2), "actual write count differs after continuation/reconciliation");
      check(final != null && final.generation === (lost ? 1 : 2)
        && final.operation === (lost ? durable!.operation : rewriteEvidence.receipt)
        && text(Array.from(final.bytes)) === text((lost ? fixture.write : fixture.rewrite).request.bytes),
        "final readback changed after callbacks");
      return { lost_completion: lost, writes, write_callbacks: 1, load_callbacks: loadCallbackCount,
        generation: 1, receipt: durable!.operation, payload_sha256: await hash(durable!.bytes), payload_bytes: durable!.bytes.length,
        namespace_sha256: await snapshotHash(options.namespace), pending_snapshot_sha256: await snapshotHash(fixture.write.pending),
        callback_snapshot_sha256: await snapshotHash(fixture.write.callback), load_snapshot_sha256: loadSnapshotDigest,
        request_id: fixture.write.request.request_id, presentation_id: fixture.write.presentation.event_id,
        presentation_preserved_until_completion: true, rejected_callbacks_preserved_snapshot: true,
        material_count: materials.length, disposed: true, pending_dispose_unconfirmed: pendingDisposeUnconfirmed,
        cancellation: cancellationEvidence, rewrite: rewriteEvidence,
        queue_empty: owners.every(owner => owner.status.pending === 0 && owner.status.queuedBytes === 0
          && owner.status.responseBytes === 0 && owner.status.pendingPresentations === 0 && owner.status.presentationBytes === 0) };
    } finally {
      for (const release of releases) release();
      await Promise.allSettled(owners.map(owner => owner.dispose()));
      await Promise.allSettled(backends.map(backend => backend.close()));
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        const timer = setTimeout(() => reject(new Error("owned database cleanup deadline")), 10_000);
        request.onsuccess = () => { clearTimeout(timer); resolve(); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); reject(new Error("owned database cleanup blocked")); };
      });
    }
  }, { entry: `${address}/assets/${manifest.entry}`, fixture: fixtures, lost,
    assets: { wasm_url: `${address}/assets/er_web_bg.wasm`, wasm_sha256: manifest.cohort.wasm_sha256,
      glue_url: `${address}/assets/er_web.js`, glue_sha256: manifest.cohort.glue_sha256,
      content_url: `${address}/assets/game-content-bundle-v2.json`, content_sha256: manifest.cohort.content_sha256 } });
  expect(workers).toHaveLength(lost ? 3 : 2);
  for (const worker of workers) expect(worker).toBe(`${address}/assets/${manifest.worker}`);
  expect(evidence.queue_empty).toBe(true);
  const attachment = Buffer.from(JSON.stringify({ schema_version: 2, capability: manifest.capability,
    fixture_kind: manifest.fixture_kind, source_sha: manifest.source_sha, manifest_sha256: sha(manifestBytes),
    fixture_sha256: manifest.fixture.sha256, worker_sha256: manifest.assets[manifest.worker].sha256,
    observed_worker_count: workers.length, cohort: manifest.cohort, evidence }));
  expect(attachment.length).toBeLessThanOrEqual(4096);
  await info.attach(lost ? "m9e-current-worker-storage-uncertain" : "m9e-current-worker-storage-save-load",
    { body: attachment, contentType: "application/json" });
}

test("current Worker stores and loads real GameSaveV2 bytes while presentation ownership remains independent", async ({ page }, info) => {
  await witness(page, info, false);
});
test("current Worker reconciles an actual committed save after lost completion without repeating the write", async ({ page }, info) => {
  await witness(page, info, true);
});
