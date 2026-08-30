import type { CloudSaveValueV1 } from "../adapters/cloud-save-adapter";
import { encodeCanonicalJsonV1 } from "../host/message-sequencer";
import {
  type ProductionReleaseManifestV2,
  type ProductionSaveEnvelopeV2,
  RUST_PREVIEW_SAVE_NAMESPACE_V1,
} from "./contracts";
import { validateProductionSaveEnvelopeV2 } from "./save-envelope";
import type { ProductionCloudSaveV1, ProductionSaveLeaseCoordinatorV1 } from "./save-migration";

const SAVE_KEY = "game-save-v1";
const MAXIMUM_SAVE_BYTES = 268_435_456;
const MAXIMUM_RETAINED_REQUESTS = 2_048;

interface RustPreviewStorageWriteRequestV1 {
  request_id: number;
  operation: "WRITE";
  key: typeof SAVE_KEY;
  expected_revision: number | null;
  bytes: number[];
}

export interface DisposablePreviewCloudSaveV1 extends ProductionCloudSaveV1 {
  dispose(): void;
}

export interface DisposablePreviewSaveLeaseCoordinatorV1 extends ProductionSaveLeaseCoordinatorV1 {
  dispose(): void;
}

export interface RustPreviewSaveStorageOptionsV1 {
  cloud: DisposablePreviewCloudSaveV1;
  leases: DisposablePreviewSaveLeaseCoordinatorV1;
  release: ProductionReleaseManifestV2;
  accountId: string;
  slot: string;
  browserInstanceId: string;
  source: CloudSaveValueV1 | null;
}

interface RetainedStorageResultV1 {
  fingerprint: string;
  bytes: Uint8Array;
}

export class RustPreviewSaveStorageV1 {
  readonly #cloud: DisposablePreviewCloudSaveV1;
  readonly #leases: DisposablePreviewSaveLeaseCoordinatorV1;
  readonly #release: ProductionReleaseManifestV2;
  readonly #accountId: string;
  readonly #slot: string;
  readonly #browserInstanceId: string;
  readonly #retained = new Map<number, RetainedStorageResultV1>();
  #cloudRevision: string | null;
  #cloudGeneration: number;
  #kernelRevision: number | null = null;
  #disposed = false;

  constructor(options: RustPreviewSaveStorageOptionsV1) {
    if (
      !/^[a-zA-Z0-9._:-]{1,128}$/u.test(options.accountId)
      || !/^rust-slot-[0-4]$/u.test(options.slot)
      || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(options.browserInstanceId)
      || (options.source != null
        && (!Number.isSafeInteger(options.source.generation) || Number(options.source.generation) < 1))
    ) {
      throw new Error("Rust preview save storage identity is invalid");
    }
    this.#cloud = options.cloud;
    this.#leases = options.leases;
    this.#release = options.release;
    this.#accountId = options.accountId;
    this.#slot = options.slot;
    this.#browserInstanceId = options.browserInstanceId;
    this.#cloudRevision = options.source?.revision ?? null;
    this.#cloudGeneration = options.source?.generation ?? 0;
  }

  async handleRequest(bytes: Uint8Array): Promise<Uint8Array> {
    this.#assertOpen();
    if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SAVE_BYTES) {
      throw new Error("Rust preview storage request is empty or oversized");
    }
    const fingerprint = await sha256(bytes);
    const request = decodeWriteRequest(bytes);
    const retained = this.#retained.get(request.request_id);
    if (retained != null) {
      if (retained.fingerprint !== fingerprint) {
        throw new Error("Rust preview storage request identity was reused with different bytes");
      }
      return Uint8Array.from(retained.bytes);
    }
    if (this.#kernelRevision != null && request.expected_revision !== this.#kernelRevision) {
      throw new Error("Rust preview storage request has a stale kernel revision");
    }

    const payload = Uint8Array.from(request.bytes);
    const nextGeneration = this.#cloudGeneration + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      payload.fill(0);
      throw new Error("Rust preview save generation is exhausted");
    }
    const lease = await this.#leases.acquire(this.#slot, this.#browserInstanceId, this.#release.release_epoch);
    try {
      const payloadHash = await sha256(payload);
      const envelope: ProductionSaveEnvelopeV2 = {
        envelope_version: 2,
        save_namespace: RUST_PREVIEW_SAVE_NAMESPACE_V1,
        slot: this.#slot,
        pseudonymous_account_id: this.#accountId,
        cloud_generation: nextGeneration,
        origin_runtime: "RUST",
        release_id: this.#release.release_id,
        kernel_generation: this.#release.release_epoch,
        mechanical_identity: this.#release.mechanical_identity,
        authority_protocol: this.#release.authority_protocol,
        save_schema: this.#release.save_schema,
        content_hash: this.#release.mechanical_identity.content_hash,
        payload_hash: payloadHash,
        payload: Array.from(payload),
        migration: null,
        legacy_backup: null,
      };
      await validateProductionSaveEnvelopeV2(envelope, this.#release, this.#accountId, this.#slot);
      const encoded = encodeCanonicalJsonV1(envelope);
      try {
        const revision = await this.#cloud.compareAndSwap(this.#slot, this.#cloudRevision, encoded);
        this.#cloudRevision = revision;
        this.#cloudGeneration = nextGeneration;
        const readback = await this.#cloud.load(this.#slot);
        if (
          readback == null
          || readback.revision !== revision
          || readback.generation !== nextGeneration
          || !equalBytes(readback.bytes, encoded)
        ) {
          throw new Error("Rust preview save readback differs from committed bytes");
        }
      } finally {
        encoded.fill(0);
      }
      const result = encodeCanonicalJsonV1({ revision: nextGeneration });
      this.#kernelRevision = nextGeneration;
      this.#retained.set(request.request_id, { fingerprint, bytes: Uint8Array.from(result) });
      while (this.#retained.size > MAXIMUM_RETAINED_REQUESTS) {
        const first = this.#retained.keys().next().value;
        if (first == null) {
          break;
        }
        this.#retained.delete(first);
      }
      return result;
    } finally {
      payload.fill(0);
      await this.#leases.release(lease);
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const result of this.#retained.values()) {
      result.bytes.fill(0);
    }
    this.#retained.clear();
    this.#cloud.dispose();
    this.#leases.dispose();
  }

  #assertOpen(): void {
    if (this.#disposed) {
      throw new Error("Rust preview save storage is disposed");
    }
  }
}

function decodeWriteRequest(bytes: Uint8Array): RustPreviewStorageWriteRequestV1 {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    value == null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 5
    || !("request_id" in value)
    || !Number.isSafeInteger(value.request_id)
    || Number(value.request_id) < 1
    || !("operation" in value)
    || value.operation !== "WRITE"
    || !("key" in value)
    || value.key !== SAVE_KEY
    || !("expected_revision" in value)
    || (value.expected_revision !== null
      && (!Number.isSafeInteger(value.expected_revision) || Number(value.expected_revision) < 1))
    || !("bytes" in value)
    || !Array.isArray(value.bytes)
    || value.bytes.length === 0
    || value.bytes.length > MAXIMUM_SAVE_BYTES
    || value.bytes.some(byte => !Number.isSafeInteger(byte) || Number(byte) < 0 || Number(byte) > 255)
  ) {
    throw new Error("Rust preview storage request is invalid or attempts a non-write operation");
  }
  return value as RustPreviewStorageWriteRequestV1;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
