import { expect, it, vi } from "vitest";
import { CurrentIndexedDbStorage, CurrentStorageError, type CurrentStorageBackend, type CurrentStoredValue,
  type CurrentWriteImage } from "../../../../src/rust-browser/adapters/current-storage-backend";
import { CurrentStorageRequestOwner, type CurrentStorageAcceptance, type CurrentTitleCancellationEvidence } from
  "../../../../src/rust-browser/adapters/current-storage-owner";

function fixture() {
  const records = new Map<string, CurrentStoredValue>();
  const writes: CurrentWriteImage[] = [];
  const backend: CurrentStorageBackend = {
    identity: { namespace: "logical-save", contentIdentity: "content-v2" },
    read: async slot => structuredClone(records.get(slot) ?? null),
    list: async () => [...records.keys()].sort(),
    write: async image => {
      if ((records.get(image.slot)?.generation ?? 0) !== image.generation - 1) {
        throw new CurrentStorageError("CONFLICT", "test CAS");
      }
      writes.push(structuredClone(image));
      records.set(image.slot, structuredClone(image));
    },
    reconcile: async image => {
      const current = records.get(image.slot);
      if (current?.generation === image.generation && current.operation === image.operation
        && current.bytes.length === image.bytes.length
        && current.bytes.every((byte, index) => byte === image.bytes[index])) return "COMMITTED";
      return (current?.generation ?? 0) === image.generation - 1 ? "RETRY" : "CONFLICT";
    },
    close: async () => undefined,
  };
  return { records, writes, backend };
}

const write = (request_id = 1) => ({ request_id, kind: "WRITE" as const,
  slot: "slot-a", generation: 1, bytes: [1, 2, 255] });

it("current storage owner freezes requests and separates durable callback acknowledgement", async () => {
  const { backend, writes } = fixture();
  let acceptance: CurrentStorageAcceptance = "REJECTED";
  const delivered: number[] = [];
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "session-a",
    deliver: async id => { delivered.push(id); return acceptance; } });
  const request = write();
  owner.enqueue(request);
  owner.enqueue(write());
  request.bytes[0] = 99;
  request.slot = "mutated";
  expect(() => owner.enqueue(request)).toThrow(/different image/u);
  const rejected = await owner.drain();
  expect(writes).toHaveLength(1);
  expect(writes[0].bytes).toEqual(Uint8Array.from([1, 2, 255]));
  expect(writes[0].slot).toBe("slot-a");
  expect(rejected[0]).toMatchObject({ phase: "CALLBACK_REJECTED", durable: true });
  acceptance = "ACCEPTED";
  owner.retry(1);
  expect((await owner.drain())[0].phase).toBe("ACKNOWLEDGED");
  expect(writes).toHaveLength(1);
  expect(delivered).toEqual([1, 1]);
  owner.enqueue(write());
  await owner.drain();
  expect(delivered).toEqual([1, 1]);
});

it("current storage owner bounds admission and rejects unsupported or malformed images before IO", async () => {
  const { backend, writes } = fixture();
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "session-a", deliver: async () => "ACCEPTED" });
  expect(() => owner.enqueue({ ...write(), kind: "DELETE" })).toThrow(/expected-frontier/u);
  expect(() => owner.enqueue({ ...write(), bytes: Array<number>(1) })).toThrow(/byte integers/u);
  expect(() => owner.enqueue({ ...write(), bytes: Array<number>(4_194_305) })).toThrow(/bounded WRITE/u);
  expect(() => owner.enqueue({ ...write(), request_id: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/request ID/u);
  expect(() => owner.enqueue({ ...write(), generation: 0 })).toThrow(/bounded WRITE/u);
  expect(() => owner.enqueue({ ...write(), slot: "\ud800" })).toThrow(/storage name/u);
  for (let id = 1; id <= 16; id += 1) {
    owner.enqueue({ request_id: id, kind: "LIST", slot: null, generation: null, bytes: [] });
  }
  expect(() => owner.enqueue({ request_id: 17, kind: "LIST", slot: null, generation: null, bytes: [] })).toThrow(/pending/u);
  expect(await owner.drain()).toHaveLength(16);
  expect(writes).toHaveLength(0);
  // Retired acknowledged IDs cannot later be reused with a changed request.
  for (let id = 17; id <= 50; id += 1) {
    owner.enqueue({ request_id: id, kind: "LIST", slot: null, generation: null, bytes: [] });
    await owner.drain();
  }
  expect(owner.progress().length).toBeLessThanOrEqual(32);
  expect(() => owner.enqueue(write())).toThrow(/older than retained/u);
  const bounded = new CurrentStorageRequestOwner({ backend: fixture().backend, sessionIdentity: "byte-bound",
    deliver: async () => "ACCEPTED" });
  const fullPayload = Array<number>(4_194_304).fill(1);
  bounded.enqueue({ ...write(), bytes: fullPayload });
  // Two maximum images plus their acknowledgement reservations exceed 8 MiB.
  expect(() => bounded.enqueue({ ...write(2), slot: "slot-b", bytes: fullPayload })).toThrow(/retained/u);
  expect((await bounded.drain())[0]).toMatchObject({ phase: "ACKNOWLEDGED", durable: true });
});

it("current storage owner drains nested enqueue without rerunning durable writes", async () => {
  const { backend, writes } = fixture();
  const delivered: number[] = [];
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "session-a", deliver: async id => {
    delivered.push(id);
    if (id === 1) owner.enqueue({ request_id: 2, kind: "READ", slot: "slot-a", generation: null, bytes: [] });
    return "ACCEPTED";
  } });
  owner.enqueue(write());
  const progress = await owner.drain();
  expect(delivered).toEqual([1, 2]);
  expect(progress.map(entry => entry.phase)).toEqual(["ACKNOWLEDGED", "ACKNOWLEDGED"]);
  expect(writes).toHaveLength(1);
});

it("current storage owner fences unknown callback acceptance and late disposed work", async () => {
  const { backend, writes } = fixture();
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "session-a",
    deliver: async () => { throw new Error("lost host response"); } });
  owner.enqueue(write());
  owner.enqueue({ request_id: 2, kind: "LIST", slot: null, generation: null, bytes: [] });
  const progress = await owner.drain();
  expect(progress.map(entry => entry.phase)).toEqual(["FENCED", "FENCED"]);
  expect(progress[0].durable).toBe(true);
  expect(() => owner.retry(1)).toThrow(/external session reconciliation/u);
  expect(() => owner.enqueue(write(3))).toThrow(/external session reconciliation/u);
  expect(writes).toHaveLength(1);
  let deliveries = 0;
  const closed = new CurrentStorageRequestOwner({ backend: fixture().backend, sessionIdentity: "session-b",
    deliver: async () => { deliveries += 1; return "ACCEPTED"; } });
  closed.enqueue(write());
  await closed.close();
  expect((await closed.drain())[0].phase).toBe("FENCED");
  expect(deliveries).toBe(0);
  vi.useFakeTimers();
  try {
    let entered: () => void = () => undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const hung = new CurrentStorageRequestOwner({ backend: fixture().backend, sessionIdentity: "hung-callback",
      deliver: () => { entered(); return new Promise<CurrentStorageAcceptance>(() => undefined); } });
    hung.enqueue(write());
    await started;
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await hung.drain())[0].phase).toBe("FENCED");
    expect(() => hung.retry(1)).toThrow(/external session reconciliation/u);
    const stalledRequest = {} as IDBOpenDBRequest;
    const stalled = new CurrentIndexedDbStorage({ databaseName: "mock-open-deadline", namespace: "save",
      contentIdentity: "content", indexedDB: { open: () => stalledRequest } as unknown as IDBFactory });
    const openOutcome = stalled.read("slot").catch(error => error as CurrentStorageError);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await openOutcome).toMatchObject({ code: "TIMEOUT", writeOutcome: "NOT_ATTEMPTED" });
    let lateClosed = 0;
    Object.defineProperty(stalledRequest, "result", { value: { close: () => { lateClosed += 1; } } });
    stalledRequest.onsuccess?.call(stalledRequest, new Event("success"));
    expect(lateClosed).toBe(1);
    await expect(stalled.close()).rejects.toMatchObject({ code: "TIMEOUT" });

    const transactionRequest = {} as IDBOpenDBRequest;
    let transactionEntered: () => void = () => undefined;
    const transactionStarted = new Promise<void>(resolve => { transactionEntered = resolve; });
    const abort = vi.fn();
    const transaction = { objectStore: () => ({ get: () => ({}) }), abort } as unknown as IDBTransaction;
    Object.defineProperty(transactionRequest, "result", { value: {
      transaction: () => { transactionEntered(); return transaction; }, close: () => undefined,
    } });
    const transactionBackend = new CurrentIndexedDbStorage({ databaseName: "mock-transaction-deadline",
      namespace: "save", contentIdentity: "content", indexedDB: { open: () => transactionRequest } as unknown as IDBFactory });
    const transactionOutcome = transactionBackend.read("slot").catch(error => error as CurrentStorageError);
    transactionRequest.onsuccess?.call(transactionRequest, new Event("success"));
    await transactionStarted;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await transactionOutcome).toMatchObject({ code: "TIMEOUT", writeOutcome: "UNKNOWN" });
    expect(abort).toHaveBeenCalledTimes(1);
    // No abort event was acknowledged at the deadline; invoking abort() was not proof.
    await transactionBackend.close();

    const blockedBackend = fixture().backend;
    blockedBackend.list = () => new Promise<string[]>(() => undefined);
    blockedBackend.close = () => new Promise<void>(() => undefined);
    const blocked = new CurrentStorageRequestOwner({ backend: blockedBackend, sessionIdentity: "blocked",
      deliver: async () => "ACCEPTED" });
    blocked.enqueue({ request_id: 1, kind: "LIST", slot: null, generation: null, bytes: [] });
    // Let real WebCrypto fingerprint completion enter the bounded mocked backend.
    let listEntered: () => void = () => undefined;
    const listStarted = new Promise<void>(resolve => { listEntered = resolve; });
    blockedBackend.list = () => { listEntered(); return new Promise<string[]>(() => undefined); };
    await listStarted;
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await blocked.drain())[0]).toMatchObject({ phase: "FENCED" });
    const closeOutcome = blocked.close().catch(error => error as CurrentStorageError);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await closeOutcome).toMatchObject({ code: "TIMEOUT" });
    const unknownWriteBackend = fixture().backend;
    let writeEntered: () => void = () => undefined;
    let finishWrite: () => void = () => undefined;
    const writeStarted = new Promise<void>(resolve => { writeEntered = resolve; });
    unknownWriteBackend.write = () => { writeEntered(); return new Promise(resolve => { finishWrite = resolve; }); };
    let unknownWriteCallbacks = 0;
    const unknownWrite = new CurrentStorageRequestOwner({ backend: unknownWriteBackend, sessionIdentity: "unknown-write",
      deliver: async () => { unknownWriteCallbacks += 1; return "ACCEPTED"; } });
    unknownWrite.enqueue(write());
    await writeStarted;
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await unknownWrite.drain())[0]).toMatchObject({ phase: "FENCED", writeOutcome: "UNKNOWN", durable: false });
    finishWrite();
    await unknownWrite.drain();
    expect(unknownWriteCallbacks).toBe(0);
  } finally { vi.useRealTimers(); }
  let lateEntered: () => void = () => undefined;
  let acceptLate: (value: CurrentStorageAcceptance) => void = () => undefined;
  const lateStarted = new Promise<void>(resolve => { lateEntered = resolve; });
  const late = new CurrentStorageRequestOwner({ backend: fixture().backend, sessionIdentity: "late-delivery",
    deliver: () => { lateEntered(); return new Promise(resolve => { acceptLate = resolve; }); } });
  late.enqueue(write());
  await lateStarted;
  await late.close();
  acceptLate("ACCEPTED");
  expect((await late.drain())[0]).toMatchObject({ phase: "FENCED", durable: true });
});

it("current storage owner reconciles exact uncertain images and rejects changed receipts", async () => {
  const { backend, writes, records } = fixture();
  const actualWrite = backend.write;
  backend.write = async image => { await actualWrite(image); throw new Error("completion lost"); };
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "session-a", deliver: async () => "ACCEPTED" });
  owner.enqueue(write());
  expect((await owner.drain())[0].phase).toBe("UNCERTAIN");
  owner.retry(1);
  expect((await owner.drain())[0]).toMatchObject({ phase: "ACKNOWLEDGED", durable: true });
  expect(writes).toHaveLength(1);
  const changed = new CurrentStorageRequestOwner({ backend, sessionIdentity: "session-b", deliver: async () => "ACCEPTED" });
  changed.enqueue(write());
  expect((await changed.drain())[0]).toMatchObject({ phase: "FAILED", durable: false });
  expect(records.get("slot-a")?.generation).toBe(1);
  expect(writes).toHaveLength(1);
  const abortedBackend = fixture().backend;
  abortedBackend.write = async () => { throw new CurrentStorageError("UNAVAILABLE", "acknowledged abort", "ABORTED"); };
  const aborted = new CurrentStorageRequestOwner({ backend: abortedBackend, sessionIdentity: "abort",
    deliver: async () => "ACCEPTED" });
  aborted.enqueue(write());
  expect((await aborted.drain())[0]).toMatchObject({ phase: "FAILED", writeOutcome: "ABORTED", durable: false });
  const readbackBackend = fixture().backend;
  const actualReconcile = readbackBackend.reconcile;
  let reconciles = 0;
  readbackBackend.reconcile = image => {
    reconciles += 1;
    if (reconciles === 2) throw new CurrentStorageError("CORRUPT", "postcommit readback unavailable");
    return actualReconcile(image);
  };
  const readback = new CurrentStorageRequestOwner({ backend: readbackBackend, sessionIdentity: "readback",
    deliver: async () => "ACCEPTED" });
  readback.enqueue(write());
  expect((await readback.drain())[0]).toMatchObject({ phase: "UNCERTAIN", writeOutcome: "UNKNOWN", durable: false });
});

// Owner-only state witnesses. These hand-authored correlated facts are not a
// substitute for the separate actual Worker pre/input/post proof witness.
function titleCancellation(requestId: number, kind: "LIST" | "READ" = "LIST", slot: string | null = null): CurrentTitleCancellationEvidence {
  return { requestId, kind, slot, preSequence: requestId * 3, cancelSequence: requestId * 3 + 1,
    postSequence: requestId * 3 + 2, waitingMenu: requestId * 2 + 10, waitingRevision: requestId * 2 + 20,
    postMenu: requestId * 2 + 11, postRevision: requestId * 2 + 21,
    nextPlatformRequestId: requestId + 1, beforeReplay: requestId * 4, postReplay: requestId * 4 + 1 };
}
function latch() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const listRequest = (request_id: number) => ({ request_id, kind: "LIST" as const, slot: null, generation: null, bytes: [] });

it("Title cancellation drains queued read-only ownership without IO and never reuses evicted IDs", async () => {
  const { backend } = fixture();
  let calls = 0;
  backend.list = async () => { calls++; return []; };
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "cancel-queued", allowTitleCancellation: true,
    deliver: async () => { throw new Error("cancelled queued request reached delivery"); } });
  for (let id = 1; id <= 40; id++) {
    owner.enqueue(listRequest(id));
    const proof = titleCancellation(id);
    owner.beginTitleReadOnlyRetirement(proof);
    expect(owner.progress().find(entry => entry.requestId === id)?.phase).toBe("CANCELLING");
    expect(owner.retirementStatus.pending).toBe(1);
    proof.cancelSequence = 0; // Caller mutation cannot change the owned proof.
    owner.beginTitleReadOnlyRetirement(titleCancellation(id));
    await owner.drain();
    expect(owner.progress().find(entry => entry.requestId === id)).toMatchObject({ phase: "CANCELLED", durable: false,
      cancellation: { cancelSequence: id * 3 + 1, terminal: "NOT_STARTED" } });
    expect(owner.retirementStatus).toMatchObject({ pending: 0, retainedBytes: 0, highestId: id, fenced: false });
    owner.enqueue(listRequest(id)); // Exact router replay is no IO, including after retirement.
    expect(() => owner.retry(id)).toThrow(/not retryable/u);
    expect(() => owner.beginTitleReadOnlyRetirement({ ...titleCancellation(id), preSequence: id * 3 + 3,
      cancelSequence: id * 3 + 4, postSequence: id * 3 + 5 })).toThrow(/evidence changed/u);
  }
  expect(calls).toBe(0);
  expect(owner.retirementStatus.retained).toBeLessThanOrEqual(32);
  expect(() => owner.enqueue(listRequest(1))).toThrow(/older than retained/u);
  const ordinary = new CurrentStorageRequestOwner({ backend: fixture().backend, sessionIdentity: "default-off", deliver: async () => "ACCEPTED" });
  ordinary.enqueue(listRequest(1));
  expect(() => ordinary.beginTitleReadOnlyRetirement(titleCancellation(1))).toThrow(/not enabled/u);
  expect((await ordinary.drain())[0].phase).toBe("ACKNOWLEDGED");
});

it("Title CANCELLING retains the sixteen-owner admission bound until running and queued work drains", async () => {
  const { backend } = fixture();
  const entered = latch(); const finish = latch();
  let operations = 0; let deliveries = 0;
  backend.list = async () => { operations++; entered.release(); await finish.promise; return []; };
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "cancel-capacity", allowTitleCancellation: true,
    deliver: async () => { deliveries++; return "ACCEPTED"; } });
  owner.enqueue(listRequest(1)); await entered.promise;
  for (let id = 2; id <= 16; id++) owner.enqueue(listRequest(id));
  for (let id = 1; id <= 16; id++) owner.beginTitleReadOnlyRetirement(titleCancellation(id));
  expect(owner.retirementStatus).toMatchObject({ pending: 16, cancelling: 16, cancelled: 0, highestId: 16 });
  expect(() => owner.enqueue(listRequest(17))).toThrow(/pending/u);
  finish.release(); await owner.drain();
  expect(owner.retirementStatus).toMatchObject({ pending: 0, cancelling: 0, cancelled: 16, retainedBytes: 0 });
  expect(operations).toBe(1); expect(deliveries).toBe(0);
  owner.enqueue(listRequest(17)); owner.beginTitleReadOnlyRetirement(titleCancellation(17)); await owner.drain();
  expect(owner.retirementStatus).toMatchObject({ highestId: 17, pending: 0, retainedBytes: 0 });
});

it("Title retirement suppresses a queued delivery guard and releases its retained result once", async () => {
  const { backend } = fixture();
  backend.read = async () => ({ generation: 1, operation: "a".repeat(64), bytes: Uint8Array.of(1, 2, 3) });
  const entered = latch(); const wire = latch();
  let published = 0;
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "cancel-wire", allowTitleCancellation: true,
    deliver: async (_id, _result, guard) => {
      entered.release(); await wire.promise;
      if (guard.cancelled()) return "SUPPRESSED_BY_CANCEL";
      published++; return "ACCEPTED";
    } });
  owner.enqueue({ request_id: 1, kind: "READ", slot: "slot-a", generation: null, bytes: [] });
  await entered.promise;
  const retained = owner.retirementStatus.retainedBytes;
  expect(retained).toBeGreaterThan(0);
  owner.beginTitleReadOnlyRetirement(titleCancellation(1, "READ", "slot-a"));
  expect(owner.retirementStatus).toMatchObject({ pending: 1, cancelling: 1, retainedBytes: retained });
  wire.release(); await owner.drain();
  expect(published).toBe(0);
  expect(owner.progress()[0]).toMatchObject({ phase: "CANCELLED", durable: false, writeOutcome: "NOT_ATTEMPTED",
    cancellation: { terminal: "COMPLETED" } });
  expect(owner.retirementStatus.retainedBytes).toBe(0);
  owner.beginTitleReadOnlyRetirement(titleCancellation(1, "READ", "slot-a"));
  expect(owner.retirementStatus.retainedBytes).toBe(0);
});

it("Title retirement admits real abort classification but never reclaims an unclassified backend rejection", async () => {
  for (const terminal of [true, false]) {
    const { backend } = fixture(); const entered = latch(); const finish = latch();
    backend.list = async () => {
      entered.release(); await finish.promise;
      throw new CurrentStorageError("UNAVAILABLE", terminal ? "actual transaction abort" : "blocked open", terminal ? "ABORTED" : "NOT_ATTEMPTED");
    };
    const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: `cancel-abort-${terminal}`, allowTitleCancellation: true,
      deliver: async () => { throw new Error("failed read-only operation delivered"); } });
    owner.enqueue(listRequest(1)); await entered.promise;
    owner.beginTitleReadOnlyRetirement(titleCancellation(1)); finish.release(); await owner.drain();
    expect(owner.progress()[0]).toMatchObject({ phase: terminal ? "CANCELLED" : "FENCED",
      cancellation: { terminal: terminal ? "ABORTED" : "PENDING" } });
    expect(owner.retirementStatus.pending).toBe(terminal ? 0 : 1);
    if (!terminal) expect(() => owner.retry(1)).toThrow(/external session reconciliation/u);
  }
});

it("Title cancellation rejects writes, unknown acceptance, invalid evidence and impossible accepted callback races", async () => {
  const { backend } = fixture();
  const written = new CurrentStorageRequestOwner({ backend, sessionIdentity: "write-excluded", allowTitleCancellation: true,
    deliver: async () => "REJECTED" });
  written.enqueue(write()); await written.drain();
  expect(() => written.beginTitleReadOnlyRetirement(titleCancellation(1))).toThrow(/read-only/u);
  expect(written.progress()[0]).toMatchObject({ phase: "CALLBACK_REJECTED", durable: true });
  const unknown = new CurrentStorageRequestOwner({ backend: fixture().backend, sessionIdentity: "unknown-excluded", allowTitleCancellation: true,
    deliver: async () => "UNKNOWN" });
  unknown.enqueue(listRequest(1)); await unknown.drain();
  expect(() => unknown.beginTitleReadOnlyRetirement(titleCancellation(1))).toThrow(/external session reconciliation/u);
  const queued = new CurrentStorageRequestOwner({ backend: fixture().backend, sessionIdentity: "bad-proof", allowTitleCancellation: true,
    deliver: async () => "ACCEPTED" });
  queued.enqueue(listRequest(1));
  for (const proof of [{ ...titleCancellation(1), postSequence: 99 }, { ...titleCancellation(1), nextPlatformRequestId: 1 },
    { ...titleCancellation(1), postReplay: 0 }, titleCancellation(1, "READ", "other-slot")]) {
    expect(() => queued.beginTitleReadOnlyRetirement(proof)).toThrow();
    expect(queued.retirementStatus.cancelling).toBe(0);
  }
  await queued.drain();
  expect(() => queued.beginTitleReadOnlyRetirement(titleCancellation(1))).toThrow(/cannot become cancelled/u);
  const entered = latch(); const finish = latch();
  const raced = new CurrentStorageRequestOwner({ backend: fixture().backend, sessionIdentity: "accepted-race", allowTitleCancellation: true,
    deliver: async () => { entered.release(); await finish.promise; return "ACCEPTED"; } });
  raced.enqueue(listRequest(1)); await entered.promise;
  raced.beginTitleReadOnlyRetirement(titleCancellation(1)); finish.release(); await raced.drain();
  expect(raced.progress()[0].phase).toBe("FENCED");
  expect(raced.retirementStatus.pending).toBe(1);
});

it("Title backend deadlines and disposal never convert uncertain work into cancellation", async () => {
  vi.useFakeTimers();
  try {
    const { backend } = fixture(); const entered = latch(); const finish = latch();
    backend.list = async () => { entered.release(); await finish.promise; return []; };
    const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "cancel-timeout", allowTitleCancellation: true,
      deliver: async () => { throw new Error("timed out work delivered"); } });
    owner.enqueue(listRequest(1)); await entered.promise;
    owner.beginTitleReadOnlyRetirement(titleCancellation(1));
    await vi.advanceTimersByTimeAsync(10_001); await owner.drain();
    expect(owner.progress()[0].phase).toBe("FENCED");
    expect(owner.retirementStatus.pending).toBe(1);
    finish.release(); await Promise.resolve(); await Promise.resolve();
    expect(owner.progress()[0].phase).toBe("FENCED");
    expect(owner.retirementStatus.pending).toBe(1);
    expect(() => owner.beginTitleReadOnlyRetirement(titleCancellation(1))).toThrow(/external session reconciliation/u);
  } finally { vi.useRealTimers(); }
  const { backend } = fixture(); const entered = latch(); const finish = latch();
  backend.list = async () => { entered.release(); await finish.promise; return []; };
  const owner = new CurrentStorageRequestOwner({ backend, sessionIdentity: "cancel-close", allowTitleCancellation: true,
    deliver: async () => { throw new Error("disposed work delivered"); } });
  owner.enqueue(listRequest(1)); await entered.promise;
  owner.beginTitleReadOnlyRetirement(titleCancellation(1)); await owner.close(); finish.release(); await owner.drain();
  expect(owner.progress()[0].phase).toBe("FENCED");
  expect(owner.retirementStatus.pending).toBe(1);
});
