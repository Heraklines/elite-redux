import { describe, expect, it } from "vitest";
import type { CloudSaveValueV1 } from "../../../../src/rust-browser/adapters/cloud-save-adapter";
import { encodeCanonicalJsonV1 } from "../../../../src/rust-browser/host/message-sequencer";
import type { ProductionReleaseManifestV2, SaveLeaseV1 } from "../../../../src/rust-browser/production/contracts";
import {
  type DisposablePreviewCloudSaveV1,
  type DisposablePreviewSaveLeaseCoordinatorV1,
  RustPreviewSaveStorageV1,
} from "../../../../src/rust-browser/production/preview-save-storage";

class PreviewCloud implements DisposablePreviewCloudSaveV1 {
  value: CloudSaveValueV1 | null = null;
  writes = 0;
  disposed = false;

  async load(): Promise<CloudSaveValueV1 | null> {
    return this.value == null
      ? null
      : { revision: this.value.revision, generation: this.value.generation, bytes: Uint8Array.from(this.value.bytes) };
  }

  async compareAndSwap(_slot: string, expectedRevision: string | null, bytes: Uint8Array): Promise<string> {
    if (expectedRevision !== this.value?.revision && !(expectedRevision == null && this.value == null)) {
      throw new Error("test cloud CAS conflict");
    }
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as { cloud_generation: number };
    const revision = `"revision-${envelope.cloud_generation}"`;
    this.value = {
      revision,
      generation: envelope.cloud_generation,
      bytes: Uint8Array.from(bytes),
    };
    this.writes += 1;
    return revision;
  }

  dispose(): void {
    this.disposed = true;
  }
}

class PreviewLeases implements DisposablePreviewSaveLeaseCoordinatorV1 {
  acquired = 0;
  released = 0;
  disposed = false;

  async acquire(slot: string, holder: string, generation: number): Promise<SaveLeaseV1> {
    this.acquired += 1;
    return { schema_version: 1, slot, holder, generation, expires_at: Date.now() + 10_000 };
  }

  async release(): Promise<void> {
    this.released += 1;
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe("Rust preview production storage", () => {
  it("writes only Rust preview envelopes, readbacks, leases, and deduplicates request identities", async () => {
    const cloud = new PreviewCloud();
    const leases = new PreviewLeases();
    const storage = createStorage(cloud, leases, null);

    const first = await storage.handleRequest(writeRequest(7, null, Uint8Array.of(1, 2, 3)));
    expect(JSON.parse(new TextDecoder().decode(first))).toEqual({ revision: 1 });
    expect(cloud.writes).toBe(1);
    expect(leases.acquired).toBe(1);
    expect(leases.released).toBe(1);
    const committed = JSON.parse(new TextDecoder().decode(cloud.value?.bytes)) as Record<string, unknown>;
    expect(committed).toMatchObject({
      save_namespace: "M9_RUST_PREVIEW_V1",
      slot: "rust-slot-0",
      origin_runtime: "RUST",
      cloud_generation: 1,
      release_id: "release-1",
      kernel_generation: 11,
      migration: null,
      legacy_backup: null,
    });

    const duplicate = await storage.handleRequest(writeRequest(7, null, Uint8Array.of(1, 2, 3)));
    expect(duplicate).toEqual(first);
    expect(cloud.writes).toBe(1);
    expect(leases.acquired).toBe(1);

    await storage.handleRequest(writeRequest(8, 1, Uint8Array.of(4, 5)));
    expect(cloud.writes).toBe(2);
    expect(cloud.value?.generation).toBe(2);
    expect(leases.acquired).toBe(2);
    expect(leases.released).toBe(2);

    storage.dispose();
    expect(cloud.disposed).toBe(true);
    expect(leases.disposed).toBe(true);
  });

  it("rejects delete/read operations and preserves a conflicting cloud frontier", async () => {
    const cloud = new PreviewCloud();
    const leases = new PreviewLeases();
    const storage = createStorage(cloud, leases, null);
    const invalid = encodeCanonicalJsonV1({
      request_id: 1,
      operation: "DELETE",
      key: "game-save-v1",
      expected_revision: null,
      bytes: [1],
    });
    await expect(storage.handleRequest(invalid)).rejects.toThrow("non-write operation");
    expect(cloud.writes).toBe(0);

    cloud.value = { revision: '"other-tab"', generation: 1, bytes: Uint8Array.of(9) };
    await expect(storage.handleRequest(writeRequest(2, null, Uint8Array.of(2)))).rejects.toThrow("CAS conflict");
    expect(cloud.writes).toBe(0);
    expect(cloud.value.bytes).toEqual(Uint8Array.of(9));
    expect(leases.released).toBe(1);
    storage.dispose();
  });
});

function createStorage(
  cloud: PreviewCloud,
  leases: PreviewLeases,
  source: CloudSaveValueV1 | null,
): RustPreviewSaveStorageV1 {
  return new RustPreviewSaveStorageV1({
    cloud,
    leases,
    release: release(),
    accountId: "account-preview",
    slot: "rust-slot-0",
    browserInstanceId: "instance-preview",
    source,
  });
}

function writeRequest(requestId: number, expectedRevision: number | null, bytes: Uint8Array): Uint8Array {
  return encodeCanonicalJsonV1({
    request_id: requestId,
    operation: "WRITE",
    key: "game-save-v1",
    expected_revision: expectedRevision,
    bytes: Array.from(bytes),
  });
}

function release(): ProductionReleaseManifestV2 {
  const artifact = {
    url: "https://release.example/artifact",
    sha256: "b".repeat(64),
    bytes: 1,
    media_type: "application/octet-stream",
  };
  return {
    schema_version: 2,
    release_id: "release-1",
    release_epoch: 11,
    channel: "INTERNAL",
    issued_at: 1,
    expires_at: 2,
    integration_sha: "c".repeat(40),
    rust_base_sha: "d".repeat(40),
    browser_base_sha: "e".repeat(40),
    oracle_sha: "f".repeat(40),
    qualified_asset_sha: "0".repeat(40),
    mechanical_identity: {
      schema_version: 1,
      mechanics_sha256: "a".repeat(64),
      content_hash: "content-1",
      authority_protocol: "er-coop-47",
      active_model_identity: "model-1",
    },
    build_identity: {
      schema_version: 1,
      toolchain: "test",
      target: "wasm32-unknown-unknown",
      profile: "release",
      lockfile_sha256: "1".repeat(64),
      build_config_sha256: "2".repeat(64),
      debug_surfaces_absent: true,
    },
    browser_kernel_abi: 1,
    worker_protocol: 1,
    authority_protocol: "er-coop-47",
    material_schemas: { turn: 1, replacement: 1, recovery: 1, presentation: 1 },
    save_schema: 1,
    artifacts: {
      bootstrap_js: artifact,
      browser_js: artifact,
      worker_js: artifact,
      wasm_glue_js: artifact,
      wasm: artifact,
      content: artifact,
      asset_manifest: artifact,
      service_worker: artifact,
      session_template: artifact,
    },
    previous_rust_release: null,
    legacy_transition_release: null,
    platform_api_versions: {
      schema_version: 1,
      save_api: 2,
      telemetry_api: 1,
      signaling_api: 33,
      showdown_api: 1,
      achievement_api: 1,
    },
    qualification: {
      candidate_sha: "3".repeat(40),
      workflow_run_id: 1,
      workflow_name: "test",
      conclusion: "SUCCESS",
      artifact_set_sha256: "4".repeat(64),
    },
  };
}
