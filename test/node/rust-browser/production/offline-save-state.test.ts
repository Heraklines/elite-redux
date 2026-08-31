import { describe, expect, it } from "vitest";
import {
  type OfflineSaveRequestIdentityV1,
  OfflineSaveStateMachineV1,
} from "../../../../src/rust-browser/production/offline-save-state";

const request: OfflineSaveRequestIdentityV1 = {
  request_id: 7,
  request_fingerprint: "a".repeat(64),
  payload_sha256: "b".repeat(64),
  expected_cloud_revision: '"revision-3"',
  expected_kernel_revision: 3,
  next_cloud_generation: 4,
};

describe("offline save state machine", () => {
  it("preserves immutable request identity through ambiguous retry and acknowledgement", () => {
    const machine = new OfflineSaveStateMachineV1('"revision-3"', 3);
    machine.begin(request);
    machine.markAmbiguous(7, request.request_fingerprint);
    const snapshot = machine.snapshot();

    const restored = OfflineSaveStateMachineV1.restore(snapshot);
    expect(restored.retry(7, request.request_fingerprint)).toEqual(request);
    restored.acknowledge(7, request.request_fingerprint, '"revision-4"', 4);
    expect(restored.snapshot()).toEqual({
      schema_version: 1,
      phase: "CLEAN",
      cloud_revision: '"revision-4"',
      cloud_generation: 4,
      request: null,
      closed_from: null,
    });
  });

  it("reconciles a committed response loss without replaying the mutation", () => {
    const machine = new OfflineSaveStateMachineV1('"revision-3"', 3);
    machine.begin(request);
    machine.markAmbiguous(7, request.request_fingerprint);
    expect(
      machine.reconcile(7, request.request_fingerprint, {
        revision: '"revision-4"',
        generation: 4,
        payload_sha256: request.payload_sha256,
      }),
    ).toBe("ACKNOWLEDGED");
    expect(machine.snapshot().phase).toBe("CLEAN");
  });

  it("fails closed on identity reuse, stale frontiers, conflicts, and closed state", () => {
    const machine = new OfflineSaveStateMachineV1('"revision-3"', 3);
    machine.begin(request);
    expect(() => machine.markAmbiguous(8, request.request_fingerprint)).toThrow("identity changed");
    machine.markAmbiguous(7, request.request_fingerprint);
    expect(
      machine.reconcile(7, request.request_fingerprint, {
        revision: '"revision-other"',
        generation: 4,
        payload_sha256: "c".repeat(64),
      }),
    ).toBe("CONFLICT");
    machine.close();
    expect(machine.snapshot()).toMatchObject({ phase: "CLOSED", closed_from: "CONFLICT" });
    expect(() => machine.retry(7, request.request_fingerprint)).toThrow("closed");
    machine.reopen();
    expect(machine.snapshot().phase).toBe("CONFLICT");
  });
});
