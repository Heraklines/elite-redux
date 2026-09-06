import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type TestInfo } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

// Real IndexedDB adapter witness only. No Worker/kernel or LIST gameplay claim.
// The existing Playwright timeout remains unchanged; no per-test increase.
const root = resolve(import.meta.dirname, "../../..");
const paths = [
  "src/rust-browser/adapters/current-storage-backend.ts",
  "src/rust-browser/adapters/current-storage-owner.ts",
  "test/node/rust-browser/engineering/current-storage-owner.test.ts",
  "test/browser/rust-browser/m9e-current-storage.spec.ts",
];
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceHashes = Object.fromEntries(paths.map(path => [path,
  createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")]));
let server: ViteDevServer;
let origin: string;
const modules = { backendModule: "/src/rust-browser/adapters/current-storage-backend.ts",
  ownerModule: "/src/rust-browser/adapters/current-storage-owner.ts" };

test.beforeAll(async () => {
  server = await createServer({ configFile: false, root, publicDir: false,
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "current-storage-isolated-witness", configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url === "/current-storage-witness") {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end("<!doctype html><html><body>Current storage adapter witness</body></html>");
        } else { next(); }
      });
    } }],
  });
  await server.listen();
  const address = server.resolvedUrls?.local[0];
  if (address == null) throw new Error("storage witness has no local server address");
  origin = address;
});
test.afterAll(async () => { await server?.close(); });

async function attach(info: TestInfo, name: string, evidence: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify({ schema_version: 1, capability: "INDEXEDDB_ADAPTER_ONLY",
    source_sha: sourceSha, source_hashes: sourceHashes, evidence }));
  if (bytes.length > 4096) throw new Error("storage witness evidence exceeds 4096 bytes");
  await info.attach(name, { body: bytes, contentType: "application/json" });
}

test("current IndexedDB reconciles a committed write after dropped completion without rewriting", async ({ page }, info) => {
  await page.goto(new URL("current-storage-witness", origin).href);
  const evidence = await page.evaluate(async ({ backendModule, ownerModule }) => {
    const { CurrentIndexedDbStorage } = await import(backendModule) as typeof import("../../../src/rust-browser/adapters/current-storage-backend");
    const { CurrentStorageRequestOwner } = await import(ownerModule) as typeof import("../../../src/rust-browser/adapters/current-storage-owner");
    const databaseName = `m9e-current-storage-positive-${crypto.randomUUID()}`;
    const options = { databaseName, namespace: "logical-save", contentIdentity: "fixture-v2" };
    const real = new CurrentIndexedDbStorage(options);
    let reopened: InstanceType<typeof CurrentIndexedDbStorage> | undefined;
    let writes = 0;
    const callbacks: number[] = [];
    const owner = new CurrentStorageRequestOwner({ sessionIdentity: "stable-session", backend: {
      identity: real.identity, read: slot => real.read(slot), list: () => real.list(),
      reconcile: image => real.reconcile(image), close: () => real.close(),
      write: async image => {
        writes += 1;
        await real.write(image); // Real transaction.oncomplete, then exact durable readback.
        if (await real.reconcile(image) !== "COMMITTED") throw new Error("real commit readback failed");
        throw new Error("deliberately dropped completion AFTER real commit");
      },
    }, deliver: async id => { callbacks.push(id); return "ACCEPTED"; } });
    try {
      const request = { request_id: 1, kind: "WRITE" as const, slot: "slot-a", generation: 1, bytes: [0, 1, 255] };
      owner.enqueue(request);
      request.bytes[0] = 99;
      const uncertain = (await owner.drain())[0];
      const durableBeforeRetry = await real.read("slot-a");
      if (uncertain.phase !== "UNCERTAIN" || uncertain.durable || callbacks.length !== 0
        || durableBeforeRetry?.generation !== 1 || durableBeforeRetry.bytes[0] !== 0) {
        throw new Error("commit/lost-completion boundary was not actually exercised");
      }
      owner.retry(1);
      const acknowledged = (await owner.drain())[0];
      if (acknowledged.phase !== "ACKNOWLEDGED" || !acknowledged.durable || writes !== 1
        || callbacks.length !== 1 || callbacks[0] !== 1) throw new Error("reconciliation repeated or lost the original request");
      owner.enqueue({ ...request, bytes: [0, 1, 255] });
      await owner.drain();
      if (writes !== 1 || callbacks.length !== 1) throw new Error("router duplicate repeated work");
      await owner.close();
      reopened = new CurrentIndexedDbStorage(options);
      const loaded = await reopened.read("slot-a");
      if (loaded == null || uncertain.operation == null || loaded.operation !== uncertain.operation || loaded.generation !== 1
        || JSON.stringify(Array.from(loaded.bytes)) !== "[0,1,255]") throw new Error("reopened bytes/receipt differ");
      // Supplementary Unicode slots expose JS UTF-16 versus Rust UTF-8 ordering.
      await reopened.write({ slot: "\ue000", generation: 1, operation: "a".repeat(64), bytes: Uint8Array.of(4) });
      await reopened.write({ slot: "\u{10000}", generation: 1, operation: "b".repeat(64), bytes: Uint8Array.of(5) });
      const slots = await reopened.list();
      if (JSON.stringify(slots) !== JSON.stringify(["slot-a", "\ue000", "\u{10000}"])) throw new Error("actual slot order differs from UTF-8 contract");
      const payloadDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", loaded.bytes)),
        byte => byte.toString(16).padStart(2, "0")).join("");
      return { transaction_committed: true, completion_deliberately_dropped: true,
        original_request: 1, operation: uncertain.operation, before_phase: uncertain.phase,
        after_phase: acknowledged.phase, actual_generation: loaded.generation, payload_sha256: payloadDigest,
        writes, callbacks: callbacks.length, reopened_exact_bytes: true, slots_utf8_ordered: true };
    } finally {
      await owner.close();
      await reopened?.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("owned test database cleanup blocked"));
      });
    }
  }, modules);
  expect(evidence).toMatchObject({ writes: 1, callbacks: 1, before_phase: "UNCERTAIN", after_phase: "ACKNOWLEDGED", actual_generation: 1 });
  await attach(info, "m9e-current-storage-reconciled", evidence);
});

test("current IndexedDB preserves a competing writer when uncertain reconciliation conflicts", async ({ page }, info) => {
  await page.goto(new URL("current-storage-witness", origin).href);
  const evidence = await page.evaluate(async ({ backendModule, ownerModule }) => {
    const { CurrentIndexedDbStorage } = await import(backendModule) as typeof import("../../../src/rust-browser/adapters/current-storage-backend");
    const { CurrentStorageRequestOwner } = await import(ownerModule) as typeof import("../../../src/rust-browser/adapters/current-storage-owner");
    const databaseName = `m9e-current-storage-conflict-${crypto.randomUUID()}`;
    const options = { databaseName, namespace: "logical-save", contentIdentity: "fixture-v2" };
    const real = new CurrentIndexedDbStorage(options);
    const competitor = new CurrentIndexedDbStorage(options);
    let writes = 0;
    let callbacks = 0;
    const owner = new CurrentStorageRequestOwner({ sessionIdentity: "stable-session", backend: {
      identity: real.identity, read: slot => real.read(slot), list: () => real.list(),
      reconcile: image => real.reconcile(image), close: () => real.close(),
      write: async image => { writes += 1; await real.write(image); throw new Error("lost committed completion"); },
    }, deliver: async () => { callbacks += 1; return "ACCEPTED"; } });
    try {
      owner.enqueue({ request_id: 1, kind: "WRITE", slot: "slot-a", generation: 1, bytes: [1, 2] });
      if ((await owner.drain())[0].phase !== "UNCERTAIN") throw new Error("original completion not lost");
      await competitor.write({ slot: "slot-a", generation: 2, operation: "c".repeat(64), bytes: Uint8Array.of(9, 8) });
      const before = await competitor.read("slot-a");
      owner.retry(1);
      const failed = (await owner.drain())[0];
      const after = await competitor.read("slot-a");
      if (failed.phase !== "FAILED" || !failed.error?.startsWith("CONFLICT:")
        || writes !== 1 || callbacks !== 0 || before == null || after == null || before.generation !== 2 || after.generation !== 2
        || after.operation !== before.operation || JSON.stringify(Array.from(after.bytes)) !== "[9,8]") {
        throw new Error("competing real transaction was overwritten or misacknowledged");
      }
      return { original_phase: "UNCERTAIN", conflict_phase: failed.phase, conflict_code: "CONFLICT",
        competing_generation: after.generation, competing_receipt: after.operation,
        competing_exact_bytes_preserved: true, original_writes: writes, callbacks };
    } finally {
      await owner.close(); await competitor.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("owned test database cleanup blocked"));
      });
    }
  }, modules);
  expect(evidence).toMatchObject({ competing_generation: 2, original_writes: 1, callbacks: 0, conflict_code: "CONFLICT" });
  await attach(info, "m9e-current-storage-conflict", evidence);
});

test("current IndexedDB settles a real aborted transaction and enforces namespace and slot bounds", async ({ page }, info) => {
  await page.goto(new URL("current-storage-witness", origin).href);
  const evidence = await page.evaluate(async ({ backendModule, ownerModule }) => {
    const { CurrentIndexedDbStorage } = await import(backendModule) as typeof import("../../../src/rust-browser/adapters/current-storage-backend");
    const { CurrentStorageRequestOwner } = await import(ownerModule) as typeof import("../../../src/rust-browser/adapters/current-storage-owner");
    const databaseName = `m9e-current-storage-abort-${crypto.randomUUID()}`;
    const options = { databaseName, namespace: "logical-save", contentIdentity: "fixture-v2" };
    const real = new CurrentIndexedDbStorage(options);
    const other = new CurrentIndexedDbStorage({ ...options, namespace: "other-logical-save" });
    const originalPut = IDBObjectStore.prototype.put;
    let abortObserved = false;
    const owner = new CurrentStorageRequestOwner({ backend: real, sessionIdentity: "abort-session", deliver: async () => "ACCEPTED" });
    try {
      // Fault seam invokes the actual IDB transaction.abort(), not a fake DB result.
      IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> {
        const request = key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
        this.transaction.abort();
        return request;
      };
      try {
        owner.enqueue({ request_id: 1, kind: "WRITE", slot: "slot-0", generation: 1, bytes: [1] });
        const failed = (await owner.drain())[0];
        abortObserved = failed.phase === "FAILED" && failed.writeOutcome === "ABORTED" && !failed.durable;
      }
      finally { IDBObjectStore.prototype.put = originalPut; }
      if (!abortObserved || await real.read("slot-0") !== null) throw new Error("actual aborted transaction leaked a record");
      owner.retry(1);
      if ((await owner.drain())[0].phase !== "ACKNOWLEDGED") throw new Error("aborted original request did not safely retry");
      for (let index = 1; index < 64; index += 1) {
        await real.write({ slot: `slot-${index}`, generation: 1, operation: "a".repeat(64), bytes: Uint8Array.of(index) });
      }
      let limited = false;
      try { await real.write({ slot: "slot-overflow", generation: 1, operation: "b".repeat(64), bytes: Uint8Array.of(0) }); }
      catch (error) { limited = error instanceof Error && "code" in error && error.code === "LIMIT"; }
      if (!limited || (await real.list()).length !== 64 || await real.read("slot-overflow") !== null) {
        throw new Error("slot bound failed or partially committed");
      }
      await real.write({ slot: "slot-0", generation: 2, operation: "b".repeat(64), bytes: Uint8Array.of(7) });
      await other.write({ slot: "slot-0", generation: 1, operation: "c".repeat(64), bytes: Uint8Array.of(8) });
      if ((await real.read("slot-0"))?.bytes[0] !== 7 || (await other.read("slot-0"))?.bytes[0] !== 8
        || (await other.list()).length !== 1) throw new Error("stable logical namespaces collided");
      return { actual_abort_settled: true, owner_abort_phase: "FAILED", owner_write_outcome: "ABORTED",
        aborted_record_absent: true, original_request_retry_accepted: true, slots: 64,
        overflow_rejected_without_record: true, existing_slot_replacement_allowed: true,
        namespace_isolation: true };
    } finally {
      IDBObjectStore.prototype.put = originalPut;
      await owner.close(); await other.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("owned test database cleanup blocked"));
      });
    }
  }, modules);
  expect(evidence).toMatchObject({ actual_abort_settled: true, slots: 64, namespace_isolation: true });
  await attach(info, "m9e-current-storage-abort-bound", evidence);
});
