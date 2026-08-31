import { CloudSaveConflictV1, type CloudSaveValueV1 } from "../adapters/cloud-save-adapter";
import { encodeCanonicalJsonV1 } from "../host/message-sequencer";
import {
  type ProductionReleaseManifestV2,
  type ProductionSaveEnvelopeV2,
  RUST_PREVIEW_SAVE_NAMESPACE_V1,
} from "./contracts";
import {
  type OfflineSaveRequestIdentityV1,
  OfflineSaveStateMachineV1,
  type OfflineSaveStateSnapshotV1,
} from "./offline-save-state";
import type { PreviewRemoteLeaseCoordinatorV1, PreviewRemoteLeaseV1 } from "./preview-remote-lease";
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
  remoteLeases: PreviewRemoteLeaseCoordinatorV1;
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
  readonly #remoteLeases: PreviewRemoteLeaseCoordinatorV1;
  readonly #release: ProductionReleaseManifestV2;
  readonly #accountId: string;
  readonly #slot: string;
  readonly #browserInstanceId: string;
  readonly #retained = new Map<number, RetainedStorageResultV1>();
  #cloudRevision: string | null;
  #cloudGeneration: number;
  #kernelRevision: number | null = null;
  readonly #offlineState: OfflineSaveStateMachineV1;
  #disposed = false;

  constructor(options: RustPreviewSaveStorageOptionsV1) {
    if (
      !options.accountId.startsWith("rust-preview:")
      || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(options.accountId)
      || !/^rust-slot-[0-4]$/u.test(options.slot)
      || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(options.browserInstanceId)
      || (options.source != null
        && (!Number.isSafeInteger(options.source.generation) || Number(options.source.generation) < 1))
    ) {
      throw new Error("Rust preview save storage identity is invalid");
    }
    this.#cloud = options.cloud;
    this.#leases = options.leases;
    this.#remoteLeases = options.remoteLeases;
    this.#release = options.release;
    this.#accountId = options.accountId;
    this.#slot = options.slot;
    this.#browserInstanceId = options.browserInstanceId;
    this.#cloudRevision = options.source?.revision ?? null;
    this.#cloudGeneration = options.source?.generation ?? 0;
    this.#offlineState = new OfflineSaveStateMachineV1(this.#cloudRevision, this.#cloudGeneration);
  }

  async handleRequest(bytes: Uint8Array): Promise<Uint8Array> {
    this.#assertOpen();
    if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SAVE_BYTES) {
      throw new Error("Rust preview storage request is empty or oversized");
    }
    const fingerprint = await sha256(bytes);
    const request = decodeWriteRequest(bytes);
    const retained = this.#retainedResult(request.request_id, fingerprint);
    if (retained != null) {
      return retained;
    }
    this.#assertKernelRevision(request.expected_revision);

    const payload = Uint8Array.from(request.bytes);
    const nextGeneration = this.#cloudGeneration + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      payload.fill(0);
      throw new Error("Rust preview save generation is exhausted");
    }
    const lease = await this.#leases.acquire(this.#slot, this.#browserInstanceId, this.#release.release_epoch);
    let remoteLease: PreviewRemoteLeaseV1 | null = null;
    try {
      remoteLease = await this.#remoteLeases.acquire(this.#slot, this.#browserInstanceId);
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
      const requestIdentity: OfflineSaveRequestIdentityV1 = {
        request_id: request.request_id,
        request_fingerprint: fingerprint,
        payload_sha256: await sha256(encoded),
        expected_cloud_revision: this.#cloudRevision,
        expected_kernel_revision: request.expected_revision,
        next_cloud_generation: nextGeneration,
      };
      const alreadyCommitted = await this.#prepareOfflineRequest(requestIdentity, encoded);
      try {
        if (!alreadyCommitted) {
          await this.#commitPendingRequest(requestIdentity, encoded, remoteLease);
        }
      } catch (error) {
        this.#recordWriteFailure(requestIdentity, error);
        throw error;
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
      if (remoteLease != null) {
        await this.#remoteLeases.release(remoteLease).catch(() => undefined);
      }
      await this.#leases.release(lease);
    }
  }

  #retainedResult(requestId: number, fingerprint: string): Uint8Array | null {
    const retained = this.#retained.get(requestId);
    if (retained == null) {
      return null;
    }
    if (retained.fingerprint !== fingerprint) {
      throw new Error("Rust preview storage request identity was reused with different bytes");
    }
    return Uint8Array.from(retained.bytes);
  }

  #assertKernelRevision(expectedRevision: number | null): void {
    if (this.#kernelRevision != null && expectedRevision !== this.#kernelRevision) {
      throw new Error("Rust preview storage request has a stale kernel revision");
    }
  }

  async #prepareOfflineRequest(request: OfflineSaveRequestIdentityV1, encoded: Uint8Array): Promise<boolean> {
    const offline = this.#offlineState.snapshot();
    if (offline.phase !== "AMBIGUOUS") {
      this.#offlineState.begin(request);
      return false;
    }
    const observed = await this.#cloud.load(this.#slot);
    if (observed == null) {
      if (offline.cloud_revision == null && offline.cloud_generation === 0) {
        this.#offlineState.retry(request.request_id, request.request_fingerprint);
        return false;
      }
      this.#offlineState.markConflict(request.request_id, request.request_fingerprint);
      throw new CloudSaveConflictV1();
    }
    const reconciliation = this.#offlineState.reconcile(request.request_id, request.request_fingerprint, {
      revision: observed.revision,
      generation: Number(observed.generation),
      payload_sha256: await sha256(observed.bytes),
    });
    if (reconciliation === "ACKNOWLEDGED") {
      if (!equalBytes(observed.bytes, encoded)) {
        throw new Error("Rust preview reconciled save differs from the immutable request image");
      }
      this.#cloudRevision = observed.revision;
      this.#cloudGeneration = Number(observed.generation);
      return true;
    }
    if (reconciliation === "RETRY") {
      this.#offlineState.retry(request.request_id, request.request_fingerprint);
      return false;
    }
    throw new CloudSaveConflictV1();
  }

  async #commitPendingRequest(
    request: OfflineSaveRequestIdentityV1,
    encoded: Uint8Array,
    remoteLease: PreviewRemoteLeaseV1,
  ): Promise<void> {
    const revision = await this.#cloud.compareAndSwap(this.#slot, this.#cloudRevision, encoded, {
      token: remoteLease.lease_token,
      holder: remoteLease.holder,
    });
    const readback = await this.#cloud.load(this.#slot);
    if (
      readback == null
      || readback.revision !== revision
      || readback.generation !== request.next_cloud_generation
      || !equalBytes(readback.bytes, encoded)
    ) {
      throw new Error("Rust preview save readback differs from committed bytes");
    }
    this.#offlineState.acknowledge(
      request.request_id,
      request.request_fingerprint,
      revision,
      request.next_cloud_generation,
    );
    this.#cloudRevision = revision;
    this.#cloudGeneration = request.next_cloud_generation;
  }

  #recordWriteFailure(request: OfflineSaveRequestIdentityV1, error: unknown): void {
    if (this.#offlineState.snapshot().phase !== "PENDING") {
      return;
    }
    if (error instanceof CloudSaveConflictV1) {
      this.#offlineState.markConflict(request.request_id, request.request_fingerprint);
    } else {
      this.#offlineState.markAmbiguous(request.request_id, request.request_fingerprint);
    }
  }

  saveStateSnapshot(): OfflineSaveStateSnapshotV1 {
    return this.#offlineState.snapshot();
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
    this.#offlineState.close();
    this.#cloud.dispose();
    this.#leases.dispose();
    this.#remoteLeases.dispose();
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
