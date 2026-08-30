import type { CloudSaveValueV1 } from "../adapters/cloud-save-adapter";
import type { ProductionReleaseManifestV2, ProductionSaveEnvelopeV2, SaveLeaseV1 } from "./contracts";
import { decodeProductionSaveEnvelopeV2, validateProductionSaveEnvelopeV2 } from "./save-envelope";

const DATABASE = "er-m9-save-migration-v1";
const STORE = "records";
const MAXIMUM_SAVE_BYTES = 268_435_456;

export interface RustProductionSaveMigrationBackendV1 {
  migrateLegacy(options: {
    sourceBytes: Uint8Array;
    release: ProductionReleaseManifestV2;
    accountId: string;
    slot: string;
    cloudGeneration: number;
    legacyBackupReference: string;
  }): Promise<{ envelope: ProductionSaveEnvelopeV2; sessionStartBytes: Uint8Array }>;
  restoreProductionSave(options: {
    envelope: ProductionSaveEnvelopeV2;
    release: ProductionReleaseManifestV2;
  }): Promise<Uint8Array>;
}

export interface ProductionCloudSaveV1 {
  load(slot: string): Promise<CloudSaveValueV1 | null>;
  compareAndSwap(slot: string, expectedRevision: string | null, bytes: Uint8Array): Promise<string>;
}
export interface ProductionSaveLeaseCoordinatorV1 {
  acquire(slot: string, holder: string, generation: number): Promise<SaveLeaseV1>;
  release(lease: SaveLeaseV1): Promise<void>;
}

export interface ProductionMigrationEvidenceStoreV1 {
  writeImmutable(key: string, bytes: Uint8Array): Promise<void>;
}

export class IndexedDbMigrationEvidenceStoreV1 implements ProductionMigrationEvidenceStoreV1 {
  readonly #database: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    this.#database = openMigrationDatabase(factory);
  }

  async writeImmutable(key: string, bytes: Uint8Array): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const existing = await request<ArrayBuffer | undefined>(store.get(key));
    if (existing != null && !equalBytes(new Uint8Array(existing), bytes)) {
      transaction.abort();
      throw new Error("immutable save migration evidence changed");
    }
    if (existing == null) {
      store.add(Uint8Array.from(bytes).buffer, key);
    }
    await complete(transaction);
  }
}

export interface ProductionSaveMigrationOptionsV1 {
  cloud: ProductionCloudSaveV1;
  source: CloudSaveValueV1;
  leases: ProductionSaveLeaseCoordinatorV1;
  backend: RustProductionSaveMigrationBackendV1;
  release: ProductionReleaseManifestV2;
  accountId: string;
  slot: string;
  browserInstanceId: string;
  evidenceStore?: ProductionMigrationEvidenceStoreV1;
}

export async function loadOrMigrateProductionSaveV1(
  options: ProductionSaveMigrationOptionsV1,
): Promise<{ envelope: ProductionSaveEnvelopeV2; sessionStartBytes: Uint8Array; migrated: boolean }> {
  const lease = await options.leases.acquire(options.slot, options.browserInstanceId, options.release.release_epoch);
  const evidence = options.evidenceStore ?? new IndexedDbMigrationEvidenceStoreV1();
  try {
    const cloud = options.source;
    if (cloud.bytes.byteLength > MAXIMUM_SAVE_BYTES) {
      throw new Error("production save source is oversized");
    }
    const existing = tryDecodeProductionEnvelope(cloud.bytes);
    if (existing != null) {
      await validateProductionSaveEnvelopeV2(existing, options.release, options.accountId, options.slot);
      const sessionStartBytes = await options.backend.restoreProductionSave({
        envelope: existing,
        release: options.release,
      });
      return { envelope: existing, sessionStartBytes, migrated: false };
    }

    const source = Uint8Array.from(cloud.bytes);
    const sourceHash = await sha256(source);
    const backupReference = `legacy-${sourceHash}`;
    await evidence.writeImmutable(`backup:${options.accountId}:${options.slot}:${sourceHash}`, source);
    const migrated = await options.backend.migrateLegacy({
      sourceBytes: Uint8Array.from(source),
      release: options.release,
      accountId: options.accountId,
      slot: options.slot,
      cloudGeneration: cloud.generation ?? numericRevision(cloud.revision),
      legacyBackupReference: backupReference,
    });
    await validateProductionSaveEnvelopeV2(migrated.envelope, options.release, options.accountId, options.slot);
    if (
      migrated.envelope.migration?.source_hash !== sourceHash
      || migrated.envelope.legacy_backup !== backupReference
    ) {
      throw new Error("Rust save migration receipt does not bind the immutable source");
    }
    const encoded = new TextEncoder().encode(JSON.stringify(migrated.envelope));
    await evidence.writeImmutable(`candidate:${options.accountId}:${options.slot}:${sourceHash}`, encoded);
    const nextRevision = await options.cloud.compareAndSwap(options.slot, cloud.revision, encoded);
    const readback = await options.cloud.load(options.slot);
    if (readback == null || readback.revision !== nextRevision || !equalBytes(readback.bytes, encoded)) {
      throw new Error("migrated production save readback differs from CAS result");
    }
    await evidence.writeImmutable(`committed:${options.accountId}:${options.slot}`, encoded);
    source.fill(0);
    encoded.fill(0);
    return {
      envelope: migrated.envelope,
      sessionStartBytes: migrated.sessionStartBytes,
      migrated: true,
    };
  } finally {
    await options.leases.release(lease);
  }
}

function tryDecodeProductionEnvelope(bytes: Uint8Array): ProductionSaveEnvelopeV2 | null {
  try {
    const value = decodeProductionSaveEnvelopeV2(bytes);
    return value.envelope_version === 2 ? value : null;
  } catch {
    return null;
  }
}

function openMigrationDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const opening = factory.open(DATABASE, 1);
  opening.onupgradeneeded = () => {
    if (!opening.result.objectStoreNames.contains(STORE)) {
      opening.result.createObjectStore(STORE);
    }
  };
  opening.onsuccess = () => resolve(opening.result);
  opening.onerror = () => reject(opening.error ?? new Error("save migration database failed"));
  return promise;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error ?? new Error("save migration request failed"));
  return promise;
}

function complete(transaction: IDBTransaction): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error("save migration transaction aborted"));
  transaction.onerror = () => reject(transaction.error ?? new Error("save migration transaction failed"));
  return promise;
}

function numericRevision(revision: string): number {
  const numeric = Number(revision.replaceAll('"', ""));
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error("cloud save revision is not a safe generation");
  }
  return numeric;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
