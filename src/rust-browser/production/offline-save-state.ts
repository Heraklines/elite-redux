export type OfflineSavePhaseV1 = "CLEAN" | "PENDING" | "AMBIGUOUS" | "CONFLICT" | "CLOSED";

export interface OfflineSaveRequestIdentityV1 {
  request_id: number;
  request_fingerprint: string;
  payload_sha256: string;
  expected_cloud_revision: string | null;
  expected_kernel_revision: number | null;
  next_cloud_generation: number;
}

export interface OfflineSaveStateSnapshotV1 {
  schema_version: 1;
  phase: OfflineSavePhaseV1;
  cloud_revision: string | null;
  cloud_generation: number;
  request: OfflineSaveRequestIdentityV1 | null;
  closed_from: Exclude<OfflineSavePhaseV1, "CLOSED"> | null;
}

const SHA256 = /^[0-9a-f]{64}$/u;

export class OfflineSaveStateMachineV1 {
  #state: OfflineSaveStateSnapshotV1;

  constructor(cloudRevision: string | null, cloudGeneration: number) {
    if (!validRevision(cloudRevision) || !safeGeneration(cloudGeneration)) {
      throw new Error("offline save frontier is invalid");
    }
    this.#state = {
      schema_version: 1,
      phase: "CLEAN",
      cloud_revision: cloudRevision,
      cloud_generation: cloudGeneration,
      request: null,
      closed_from: null,
    };
  }

  static restore(snapshot: OfflineSaveStateSnapshotV1): OfflineSaveStateMachineV1 {
    validateSnapshot(snapshot);
    const machine = new OfflineSaveStateMachineV1(snapshot.cloud_revision, snapshot.cloud_generation);
    machine.#state = structuredClone(snapshot);
    return machine;
  }

  snapshot(): OfflineSaveStateSnapshotV1 {
    return structuredClone(this.#state);
  }

  begin(request: OfflineSaveRequestIdentityV1): void {
    this.#assertOpen();
    validateRequest(request);
    if (this.#state.phase !== "CLEAN" || this.#state.request != null) {
      throw new Error("offline save request cannot begin from the current phase");
    }
    if (
      request.expected_cloud_revision !== this.#state.cloud_revision
      || request.next_cloud_generation !== this.#state.cloud_generation + 1
    ) {
      throw new Error("offline save request does not extend the current cloud frontier");
    }
    this.#state.phase = "PENDING";
    this.#state.request = structuredClone(request);
  }

  retry(requestId: number, requestFingerprint: string): OfflineSaveRequestIdentityV1 {
    this.#assertOpen();
    const request = this.#matchingRequest(requestId, requestFingerprint);
    if (this.#state.phase !== "AMBIGUOUS") {
      throw new Error("only an ambiguous save request can be retried");
    }
    this.#state.phase = "PENDING";
    return structuredClone(request);
  }

  markAmbiguous(requestId: number, requestFingerprint: string): void {
    this.#assertOpen();
    this.#matchingRequest(requestId, requestFingerprint);
    if (this.#state.phase !== "PENDING") {
      throw new Error("offline save outcome cannot become ambiguous from the current phase");
    }
    this.#state.phase = "AMBIGUOUS";
  }

  markConflict(requestId: number, requestFingerprint: string): void {
    this.#assertOpen();
    this.#matchingRequest(requestId, requestFingerprint);
    if (this.#state.phase !== "PENDING" && this.#state.phase !== "AMBIGUOUS") {
      throw new Error("offline save conflict cannot be recorded from the current phase");
    }
    this.#state.phase = "CONFLICT";
  }

  acknowledge(requestId: number, requestFingerprint: string, revision: string, generation: number): void {
    this.#assertOpen();
    const request = this.#matchingRequest(requestId, requestFingerprint);
    if (
      (this.#state.phase !== "PENDING" && this.#state.phase !== "AMBIGUOUS")
      || !validRevision(revision)
      || revision == null
      || generation !== request.next_cloud_generation
    ) {
      throw new Error("offline save acknowledgement is invalid");
    }
    this.#state = {
      schema_version: 1,
      phase: "CLEAN",
      cloud_revision: revision,
      cloud_generation: generation,
      request: null,
      closed_from: null,
    };
  }

  reconcile(
    requestId: number,
    requestFingerprint: string,
    observed: { revision: string; generation: number; payload_sha256: string },
  ): "ACKNOWLEDGED" | "RETRY" | "CONFLICT" {
    this.#assertOpen();
    const request = this.#matchingRequest(requestId, requestFingerprint);
    if (this.#state.phase !== "AMBIGUOUS") {
      throw new Error("only an ambiguous save request can be reconciled");
    }
    if (
      observed.generation === request.next_cloud_generation
      && observed.payload_sha256 === request.payload_sha256
      && validRevision(observed.revision)
    ) {
      this.acknowledge(requestId, requestFingerprint, observed.revision, observed.generation);
      return "ACKNOWLEDGED";
    }
    if (observed.generation === this.#state.cloud_generation && observed.revision === this.#state.cloud_revision) {
      return "RETRY";
    }
    this.#state.phase = "CONFLICT";
    return "CONFLICT";
  }

  close(): void {
    if (this.#state.phase === "CLOSED") {
      return;
    }
    this.#state.closed_from = this.#state.phase;
    this.#state.phase = "CLOSED";
  }

  reopen(): void {
    if (this.#state.phase !== "CLOSED" || this.#state.closed_from == null) {
      throw new Error("offline save state is not restorable from close");
    }
    this.#state.phase = this.#state.closed_from;
    this.#state.closed_from = null;
  }

  #matchingRequest(requestId: number, requestFingerprint: string): OfflineSaveRequestIdentityV1 {
    const request = this.#state.request;
    if (request == null || request.request_id !== requestId || request.request_fingerprint !== requestFingerprint) {
      throw new Error("offline save request identity changed across retry");
    }
    return request;
  }

  #assertOpen(): void {
    if (this.#state.phase === "CLOSED") {
      throw new Error("offline save state is closed");
    }
  }
}

function validateSnapshot(snapshot: OfflineSaveStateSnapshotV1): void {
  if (
    snapshot.schema_version !== 1
    || !validRevision(snapshot.cloud_revision)
    || !safeGeneration(snapshot.cloud_generation)
    || !["CLEAN", "PENDING", "AMBIGUOUS", "CONFLICT", "CLOSED"].includes(snapshot.phase)
  ) {
    throw new Error("offline save snapshot is invalid");
  }
  if (snapshot.request != null) {
    validateRequest(snapshot.request);
  }
  if (
    (snapshot.phase === "CLEAN" && snapshot.request != null)
    || (["PENDING", "AMBIGUOUS", "CONFLICT"].includes(snapshot.phase) && snapshot.request == null)
    || (snapshot.phase === "CLOSED") !== (snapshot.closed_from != null)
  ) {
    throw new Error("offline save snapshot phase is inconsistent");
  }
}

function validateRequest(request: OfflineSaveRequestIdentityV1): void {
  if (
    !Number.isSafeInteger(request.request_id)
    || request.request_id < 1
    || !SHA256.test(request.request_fingerprint)
    || !SHA256.test(request.payload_sha256)
    || !validRevision(request.expected_cloud_revision)
    || (request.expected_kernel_revision != null
      && (!Number.isSafeInteger(request.expected_kernel_revision) || request.expected_kernel_revision < 1))
    || !safeGeneration(request.next_cloud_generation)
    || request.next_cloud_generation < 1
  ) {
    throw new Error("offline save request identity is invalid");
  }
}

function validRevision(value: string | null): boolean {
  return value == null || (value.length >= 3 && value.length <= 256);
}

function safeGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
