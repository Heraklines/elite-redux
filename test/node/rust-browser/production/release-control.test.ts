import { describe, expect, it } from "vitest";
import { encodeCanonicalJsonV1 } from "../../../../src/rust-browser/host/message-sequencer";
import type {
  ProductionReleaseManifestV2,
  RuntimeAssignmentV1,
  SessionRuntimePinV1,
  SignedProductionManifestV1,
  SignedRuntimeAssignmentV1,
} from "../../../../src/rust-browser/production/contracts";
import { BrowserProductionGenerationRegistryV1 } from "../../../../src/rust-browser/production/generation-registry";
import { verifySignedProductionManifestV1 } from "../../../../src/rust-browser/production/release-manifest";
import { selectProductionRuntimeV1 } from "../../../../src/rust-browser/production/runtime-selector";
import { validateSessionRuntimePinV1 } from "../../../../src/rust-browser/production/session-pin";
import type { TrustedBrowserReleaseKeyV1 } from "../../../../src/rust-browser/production/signature-verifier";

async function signingContext() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const trusted: TrustedBrowserReleaseKeyV1[] = [
    {
      key_id: "test-key",
      public_key: Array.from(publicKey),
      channels: ["STABLE", "ROLLBACK"],
      minimum_release_epoch: 1,
      revoked: false,
    },
  ];
  return { pair, trusted };
}

async function signEnvelope<T extends object>(pair: CryptoKeyPair, domain: string, payload: T): Promise<number[]> {
  const prefix = new TextEncoder().encode(`${domain}\0`);
  const encoded = encodeCanonicalJsonV1(payload);
  const bytes = new Uint8Array(prefix.byteLength + encoded.byteLength);
  bytes.set(prefix);
  bytes.set(encoded, prefix.byteLength);
  return Array.from(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, bytes)));
}

function manifest(id = "release-2", epoch = 2): ProductionReleaseManifestV2 {
  const digest = "1".repeat(64);
  const artifact = (name: string) => ({
    url: `/__m9_releases/${id}/${digest}/${name}`,
    sha256: digest,
    bytes: 1,
    media_type: "application/octet-stream",
  });
  return {
    schema_version: 2,
    release_id: id,
    release_epoch: epoch,
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
      target: "wasm32-unknown-unknown",
      profile: "release",
      lockfile_sha256: "3".repeat(64),
      build_config_sha256: "4".repeat(64),
      debug_surfaces_absent: true,
    },
    browser_kernel_abi: 1,
    worker_protocol: 1,
    authority_protocol: "er-coop-47",
    material_schemas: { turn: 1, replacement: 1, recovery: 1, presentation: 1 },
    save_schema: 2,
    artifacts: {
      bootstrap_js: artifact("bootstrap.js"),
      browser_js: artifact("browser.js"),
      worker_js: artifact("worker.js"),
      wasm_glue_js: artifact("glue.js"),
      wasm: artifact("kernel.wasm"),
      content: artifact("content.json"),
      asset_manifest: artifact("assets.json"),
      service_worker: artifact("service-worker.js"),
      session_template: artifact("session-start.json"),
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

function assignment(releaseId = "release-2"): RuntimeAssignmentV1 {
  return {
    schema_version: 1,
    assignment_id: "assignment-1",
    release_id: releaseId,
    authority: "RUST_PRODUCTION",
    cohort: "R7",
    sticky_scope: { kind: "BROWSER_SESSION", value: { session_id: "session-1" } },
    issued_at: 1,
    expires_at: Number.MAX_SAFE_INTEGER,
    policy_version: 7,
  };
}

function pin(release = manifest()): SessionRuntimePinV1 {
  return {
    schema_version: 1,
    session_id: "session-1",
    run_id: "run-1",
    release_id: release.release_id,
    kernel_generation: {
      schema_version: 1,
      session_id: "session-1",
      generation: release.release_epoch,
      artifact_sha256: release.qualification.artifact_set_sha256,
      wasm_sha256: release.artifacts.wasm.sha256,
      content_sha256: release.artifacts.content.sha256,
      source_git_sha: release.integration_sha,
      worker_abi_version: 1,
      minimum_snapshot_schema: 6,
      maximum_snapshot_schema: 6,
      content_identity: release.mechanical_identity.content_hash,
      release_id: release.release_id,
    },
    mechanical_identity: release.mechanical_identity,
    authority: "RUST_PRODUCTION",
    created_sequence: 0,
    latest_sequence: 3,
  };
}

describe("M9 signed release control", () => {
  it("requires release and assignment signatures and ignores public override surfaces", async () => {
    const { pair, trusted } = await signingContext();
    const release = manifest();
    const signedRelease: SignedProductionManifestV1 = {
      envelope_version: 1,
      key_id: "test-key",
      payload: release,
      signature: await signEnvelope(pair, "er-m9:release-manifest-v1", release),
    };
    const runtimeAssignment = assignment();
    const signedAssignment: SignedRuntimeAssignmentV1 = {
      envelope_version: 1,
      key_id: "test-key",
      payload: runtimeAssignment,
      signature: await signEnvelope(pair, "er-m9:runtime-assignment-v1", runtimeAssignment),
    };
    const selected = await selectProductionRuntimeV1({
      sessionId: "session-1",
      now: 2,
      trustedKeys: trusted,
      expectedAssignmentScopes: [{ kind: "BROWSER_SESSION", value: { session_id: "session-1" } }],
      loadPin: async () => null,
      loadRelease: async () => signedRelease,
      requestAssignment: async () => signedAssignment,
    });
    expect(selected.assignment?.authority).toBe("RUST_PRODUCTION");
    const otherScope = {
      ...runtimeAssignment,
      sticky_scope: { kind: "BROWSER_SESSION", value: { session_id: "session-other" } } as const,
    };
    const signedOtherScope: SignedRuntimeAssignmentV1 = {
      envelope_version: 1,
      key_id: "test-key",
      payload: otherScope,
      signature: await signEnvelope(pair, "er-m9:runtime-assignment-v1", otherScope),
    };
    await expect(
      selectProductionRuntimeV1({
        sessionId: "session-1",
        now: 2,
        trustedKeys: trusted,
        expectedAssignmentScopes: [{ kind: "BROWSER_SESSION", value: { session_id: "session-1" } }],
        loadPin: async () => null,
        loadRelease: async () => signedRelease,
        requestAssignment: async () => signedOtherScope,
      }),
    ).rejects.toThrow(/another sticky scope/u);
    const tampered = structuredClone(signedRelease);
    tampered.payload.release_id = "release-attacker";
    await expect(verifySignedProductionManifestV1(tampered, trusted, 2)).rejects.toThrow(/invalid|signature/u);
  });

  it("restores an existing immutable pin before newer rollout assignment", async () => {
    const { pair, trusted } = await signingContext();
    const previous = manifest("release-1", 1);
    previous.channel = "ROLLBACK";
    previous.previous_rust_release = null;
    const signedPrevious: SignedProductionManifestV1 = {
      envelope_version: 1,
      key_id: "test-key",
      payload: previous,
      signature: await signEnvelope(pair, "er-m9:release-manifest-v1", previous),
    };
    const existingPin = pin(previous);
    validateSessionRuntimePinV1(existingPin);
    const selected = await selectProductionRuntimeV1({
      sessionId: "session-1",
      now: 2,
      trustedKeys: trusted,
      expectedAssignmentScopes: [{ kind: "BROWSER_SESSION", value: { session_id: "session-1" } }],
      loadPin: async () => existingPin,
      loadRelease: async () => signedPrevious,
      requestAssignment: async () => {
        throw new Error("new assignment must not be requested for a pinned run");
      },
    });
    expect(selected.release.release_id).toBe("release-1");
    expect(selected.assignment).toBeNull();
  });

  it("keeps stable and previous Rust generations concurrently", () => {
    const healthy = {
      schema_version: 1 as const,
      observed_sessions: 100,
      observed_minutes: 100,
      worker_initialization_failure_basis_points: 0,
      unrecoverable_kernel_fault_basis_points: 0,
      deterministic_migration_failures: 0,
      cloud_save_regression_basis_points: 0,
      coop_relative_regression_percent: 0,
      coop_absolute_regression_basis_points: 0,
      input_latency_regression_percent: 0,
      crash_free_regression_basis_points: 0,
      hard_stop: false,
      hard_stop_fingerprint: null,
    };
    const previous = manifest("release-1", 1);
    previous.channel = "ROLLBACK";
    const registry = new BrowserProductionGenerationRegistryV1({
      schema_version: 1,
      releases: [
        { release: previous, status: "ROLLBACK", assigned_new_sessions: 1, active_sessions: 1, health: healthy },
        { release: manifest(), status: "STABLE", assigned_new_sessions: 0, active_sessions: 0, health: healthy },
      ],
    });
    registry.assignNewSession("release-2");
    expect(registry.snapshot().releases.map(entry => [entry.release.release_id, entry.active_sessions])).toEqual([
      ["release-1", 1],
      ["release-2", 1],
    ]);
  });
});
