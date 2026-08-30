import { describe, expect, it } from "vitest";
import type {
  ProductionCoopCompatibilityV1,
  ProductionReleaseManifestV2,
  ProductionSaveEnvelopeV2,
  SaveLeaseV1,
} from "../../../../src/rust-browser/production/contracts";
import { choosePartyReleaseV1 } from "../../../../src/rust-browser/production/coop-release";
import {
  loadOrMigrateProductionSaveV1,
  type ProductionCloudSaveV1,
  type ProductionMigrationEvidenceStoreV1,
  type ProductionSaveLeaseCoordinatorV1,
  type RustProductionSaveMigrationBackendV1,
} from "../../../../src/rust-browser/production/save-migration";

class MemoryCloud implements ProductionCloudSaveV1 {
  revision = "1";
  bytes: Uint8Array;
  failWrite = false;

  constructor(bytes: Uint8Array) {
    this.bytes = Uint8Array.from(bytes);
  }

  async load() {
    return { revision: this.revision, generation: Number(this.revision), bytes: Uint8Array.from(this.bytes) };
  }

  async compareAndSwap(_slot: string, expectedRevision: string | null, bytes: Uint8Array): Promise<string> {
    if (this.failWrite || expectedRevision !== this.revision) {
      throw new Error("cloud CAS conflict");
    }
    this.revision = String(Number(this.revision) + 1);
    this.bytes = Uint8Array.from(bytes);
    return this.revision;
  }
}

class MemoryEvidence implements ProductionMigrationEvidenceStoreV1 {
  readonly values = new Map<string, Uint8Array>();
  async writeImmutable(key: string, bytes: Uint8Array): Promise<void> {
    const existing = this.values.get(key);
    if (existing != null && !equalBytes(existing, bytes)) {
      throw new Error("immutable evidence changed");
    }
    this.values.set(key, Uint8Array.from(bytes));
  }
}

class MemoryLease implements ProductionSaveLeaseCoordinatorV1 {
  released = false;
  async acquire(slot: string, holder: string, generation: number): Promise<SaveLeaseV1> {
    return { schema_version: 1, slot, holder, generation, expires_at: Date.now() + 1_000 };
  }
  async release(): Promise<void> {
    this.released = true;
  }
}

describe("M9 copy-on-write save and co-op release control", () => {
  it("preserves source, verifies readback, and records immutable migration evidence", async () => {
    const release = manifest();
    const source = Uint8Array.from([1, 2, 3]);
    const sourceBefore = Uint8Array.from(source);
    const cloud = new MemoryCloud(source);
    const evidence = new MemoryEvidence();
    const leases = new MemoryLease();
    const backend = await migrationBackend(release, source);
    const result = await loadOrMigrateProductionSaveV1({
      cloud,
      source: await cloud.load(),
      leases,
      backend,
      release,
      accountId: "account-1",
      slot: "slot-1",
      browserInstanceId: "browser-1",
      evidenceStore: evidence,
    });
    expect(result.migrated).toBe(true);
    expect(source).toEqual(sourceBefore);
    expect(cloud.revision).toBe("2");
    expect([...evidence.values.keys()].sort()).toEqual(
      [
        "backup:account-1:slot-1:" + (await sha256(source)),
        "candidate:account-1:slot-1:" + (await sha256(source)),
        "committed:account-1:slot-1",
      ].sort(),
    );
    expect(leases.released).toBe(true);
  });

  it("leaves legacy cloud bytes recoverable after a failed CAS", async () => {
    const release = manifest();
    const source = Uint8Array.from([4, 5, 6]);
    const cloud = new MemoryCloud(source);
    cloud.failWrite = true;
    const evidence = new MemoryEvidence();
    const leases = new MemoryLease();
    await expect(
      loadOrMigrateProductionSaveV1({
        cloud,
        source: await cloud.load(),
        leases,
        backend: await migrationBackend(release, source),
        release,
        accountId: "account-1",
        slot: "slot-1",
        browserInstanceId: "browser-1",
        evidenceStore: evidence,
      }),
    ).rejects.toThrow(/CAS/u);
    expect(cloud.bytes).toEqual(source);
    expect([...evidence.values.keys()].some(key => key.startsWith("backup:"))).toBe(true);
    expect(leases.released).toBe(true);
  });

  it("chooses one common Rust release and rejects incompatible peers", () => {
    const left = compatibility("release-2", ["release-1"]);
    const right = compatibility("release-1", ["release-2"]);
    expect(choosePartyReleaseV1(left, right)).toBe("release-1");
    right.content_hash = "different";
    expect(() => choosePartyReleaseV1(left, right)).toThrow(/incompatible/u);
    const mixedNamespace = {
      ...compatibility("release-1", ["release-2"]),
      save_namespace: "LEGACY_PRODUCTION_V1",
    } as unknown as ProductionCoopCompatibilityV1;
    expect(() => choosePartyReleaseV1(left, mixedNamespace)).toThrow(/incompatible/u);
  });
});

async function migrationBackend(
  release: ProductionReleaseManifestV2,
  source: Uint8Array,
): Promise<RustProductionSaveMigrationBackendV1> {
  const sourceHash = await sha256(source);
  const payload = Uint8Array.from([9, 8, 7]);
  const targetHash = await sha256(payload);
  return {
    async migrateLegacy(options) {
      const envelope: ProductionSaveEnvelopeV2 = {
        envelope_version: 2,
        save_namespace: "M9_RUST_PREVIEW_V1",
        slot: options.slot,
        pseudonymous_account_id: options.accountId,
        cloud_generation: options.cloudGeneration,
        origin_runtime: "RUST",
        release_id: release.release_id,
        kernel_generation: release.release_epoch,
        mechanical_identity: release.mechanical_identity,
        authority_protocol: "er-coop-47",
        save_schema: release.save_schema,
        content_hash: release.mechanical_identity.content_hash,
        payload_hash: targetHash,
        payload: Array.from(payload),
        migration: {
          schema_version: 1,
          source_runtime: "LEGACY_TYPE_SCRIPT",
          source_schema: 1,
          source_hash: sourceHash,
          target_runtime: "RUST",
          target_schema: release.save_schema,
          target_hash: targetHash,
          migrator_id: "legacy-v1",
          validation_digest: "a".repeat(64),
        },
        legacy_backup: options.legacyBackupReference,
      };
      return { envelope, sessionStartBytes: Uint8Array.from([7]) };
    },
    async restoreProductionSave() {
      return Uint8Array.from([7]);
    },
  };
}

function compatibility(releaseId: string, compatible: string[]): ProductionCoopCompatibilityV1 {
  return {
    schema_version: 1,
    save_namespace: "M9_RUST_PREVIEW_V1",
    release_id: releaseId,
    compatible_releases: compatible,
    authority_runtime: "RUST_PRODUCTION",
    authority_protocol: "er-coop-47",
    mechanical_identity: manifest().mechanical_identity,
    content_hash: "content",
    material_schemas: { turn: 1, replacement: 1, recovery: 1, presentation: 1 },
    browser_kernel_abi: 1,
    save_schema: 1,
    active_model_identity: "model",
  };
}

function manifest(): ProductionReleaseManifestV2 {
  const artifact = { url: "/x", sha256: "1".repeat(64), bytes: 1, media_type: "application/octet-stream" };
  return {
    schema_version: 2,
    release_id: "release-2",
    release_epoch: 2,
    channel: "STABLE",
    issued_at: 1,
    expires_at: Number.MAX_SAFE_INTEGER,
    integration_sha: "a".repeat(40),
    rust_base_sha: "b".repeat(40),
    browser_base_sha: "c".repeat(40),
    oracle_sha: "d".repeat(40),
    qualified_asset_sha: "e".repeat(40),
    mechanical_identity: {
      schema_version: 1,
      mechanics_sha256: "2".repeat(64),
      content_hash: "content",
      authority_protocol: "er-coop-47",
      active_model_identity: "model",
    },
    build_identity: {
      schema_version: 1,
      toolchain: "rust",
      target: "wasm",
      profile: "release",
      lockfile_sha256: "3".repeat(64),
      build_config_sha256: "4".repeat(64),
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
    previous_rust_release: "release-1",
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
      candidate_sha: "a".repeat(40),
      workflow_run_id: 1,
      workflow_name: "test",
      conclusion: "SUCCESS",
      artifact_set_sha256: "5".repeat(64),
    },
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
