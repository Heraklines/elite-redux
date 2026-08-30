import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudSaveAdapterV1 } from "../../../../src/rust-browser/adapters/cloud-save-adapter";
import { encodeCanonicalJsonV1 } from "../../../../src/rust-browser/host/message-sequencer";
import type { BrowserKernelGenerationIdentityV1 } from "../../../../src/rust-browser/hot-reload/contracts";
import type {
  RollbackDirectiveV1,
  RolloutPolicyV1,
  RolloutRingV1,
  SignedRollbackDirectiveV1,
  SignedRolloutPolicyV1,
} from "../../../../src/rust-browser/production/contracts";
import {
  aggregateFailureFingerprintsV1,
  aggregatePerformanceSummaryV1,
  buildReleaseHealthDecisionEvidenceV1,
  failureFingerprintV1,
  type ProductionHealthEventV1,
  validateProductionHealthEventV1,
} from "../../../../src/rust-browser/production/health-event";
import { sendProductionHealthEventV1 } from "../../../../src/rust-browser/production/health-reporter";
import {
  loadAuthenticatedPlatformContextV1,
  readProductionAccountAuthorizationV1,
} from "../../../../src/rust-browser/production/platform-context";
import { uploadAuthorizedProductionReproV1 } from "../../../../src/rust-browser/production/repro-reporting";
import {
  ProductionRolloutControllerV1,
  verifySignedRollbackDirectiveV1,
  verifySignedRolloutPolicyV1,
} from "../../../../src/rust-browser/production/rollout";
import { ProductionShadowSamplerV1 } from "../../../../src/rust-browser/production/shadow-sampling";
import type { TrustedBrowserReleaseKeyV1 } from "../../../../src/rust-browser/production/signature-verifier";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("M9 production health and rollout control", () => {
  it("accepts only bounded privacy-safe release-stamped health events", () => {
    const value = event();
    expect(validateProductionHealthEventV1(value)).toBe(value);
    expect(() => validateProductionHealthEventV1({ ...value, token: "secret" } as ProductionHealthEventV1)).toThrow(
      /privacy-unsafe/u,
    );
    expect(() =>
      validateProductionHealthEventV1({
        ...value,
        kernel_generation: { ...value.kernel_generation, release_id: "other-release" },
      }),
    ).toThrow(/privacy-unsafe/u);
    expect(() =>
      validateProductionHealthEventV1({
        ...value,
        hard_stop_rule: "SAVE_CORRUPTION",
        failure_fingerprint: null,
      }),
    ).toThrow(/privacy-unsafe/u);
  });

  it("normalizes fingerprints with release and generation and aggregates bounded metrics", async () => {
    const first = await failureFingerprintV1("release-2", 7, "SAVE", "READ_FAILURE", "CAS_CONFLICT");
    const again = await failureFingerprintV1("release-2", 7, "SAVE", "READ_FAILURE", "CAS_CONFLICT");
    const nextGeneration = await failureFingerprintV1("release-2", 8, "SAVE", "READ_FAILURE", "CAS_CONFLICT");
    expect(first).toBe(again);
    expect(nextGeneration).not.toBe(first);

    expect(
      aggregatePerformanceSummaryV1([
        { elapsed_micros: 100, memory_bytes: 10 },
        { elapsed_micros: 500, memory_bytes: 30 },
        { elapsed_micros: 300, memory_bytes: 20 },
        { elapsed_micros: 200, memory_bytes: 15 },
      ]),
    ).toEqual({
      samples: 4,
      median_micros: 200,
      p95_micros: 500,
      p99_micros: 500,
      maximum_micros: 500,
      memory_bytes: 30,
    });

    const one = event(first);
    const two = event(nextGeneration);
    expect(aggregateFailureFingerprintsV1([two, one, one])).toEqual([
      { fingerprint: [first, nextGeneration].sort()[0], count: first < nextGeneration ? 2 : 1 },
      { fingerprint: [first, nextGeneration].sort()[1], count: first < nextGeneration ? 1 : 2 },
    ]);
  });

  it("records reproducible decision identity and halts new assignments without moving active pins", async () => {
    const currentPolicy = policy();
    const controller = new ProductionRolloutControllerV1(currentPolicy, 2);
    const pinned = await controller.releaseForSession({
      stickyIdentity: "account-1",
      pinnedRelease: "release-pinned",
      internalEligible: false,
      previewEligible: false,
    });
    expect(pinned).toBe("release-pinned");

    const health = healthy();
    const decision = controller.evaluateCandidateHealth({ ...health, hard_stop: true });
    expect(decision.decision).toBe("HALT");
    expect(controller.candidateAssignmentsHalted).toBe(true);
    expect(
      await controller.releaseForSession({
        stickyIdentity: "account-1",
        pinnedRelease: null,
        internalEligible: false,
        previewEligible: false,
      }),
    ).toBe("release-1");
    expect(
      await controller.releaseForSession({
        stickyIdentity: "account-1",
        pinnedRelease: "release-2",
        internalEligible: false,
        previewEligible: false,
      }),
    ).toBe("release-2");

    const evidenceOne = await buildReleaseHealthDecisionEvidenceV1(health, currentPolicy.rings[3], [event()], {
      policy_hash: "a".repeat(64),
      release_manifest_hash: "b".repeat(64),
      window_start_ms: 1,
      window_end_ms: 2,
    });
    const evidenceTwo = await buildReleaseHealthDecisionEvidenceV1(health, currentPolicy.rings[3], [event()], {
      policy_hash: "a".repeat(64),
      release_manifest_hash: "b".repeat(64),
      window_start_ms: 1,
      window_end_ms: 2,
    });
    expect(evidenceOne).toEqual(evidenceTwo);
    expect(evidenceOne.input_event_aggregate_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("verifies signed policy and Rust-first rollback directives before applying them", async () => {
    const { pair, trusted } = await signingContext();
    const currentPolicy = policy();
    const signedPolicy: SignedRolloutPolicyV1 = {
      envelope_version: 1,
      key_id: "test-key",
      payload: currentPolicy,
      signature: await sign(pair, "er-m9:rollout-policy-v1", currentPolicy),
    };
    await expect(verifySignedRolloutPolicyV1(signedPolicy, trusted, 2)).resolves.toEqual(currentPolicy);

    const directive: RollbackDirectiveV1 = {
      schema_version: 1,
      directive_id: "rollback-1",
      affected_release: "release-2",
      target_release: "release-1",
      target_runtime: "RUST_PRODUCTION",
      scope: "NEW_SESSIONS",
      reason: "OPERATOR_DRILL",
      issued_at: 2,
      expires_at: Number.MAX_SAFE_INTEGER,
      policy_version: 2,
    };
    const signedDirective: SignedRollbackDirectiveV1 = {
      envelope_version: 1,
      key_id: "test-key",
      payload: directive,
      signature: await sign(pair, "er-m9:rollback-directive-v1", directive),
    };
    await expect(verifySignedRollbackDirectiveV1(signedDirective, trusted, 3)).resolves.toEqual(directive);
    const controller = new ProductionRolloutControllerV1(currentPolicy, 2);
    controller.applyRollback(await verifySignedRollbackDirectiveV1(signedDirective, trusted, 3));
    expect(controller.policy.stable_release).toBe("release-1");
    expect(controller.candidateAssignmentsHalted).toBe(true);

    signedDirective.signature[0] ^= 1;
    await expect(verifySignedRollbackDirectiveV1(signedDirective, trusted, 3)).rejects.toThrow(/signature/u);
  });

  it("keeps bounded shadow samples side-effect free and hard-stops divergence", async () => {
    const sampler = new ProductionShadowSamplerV1({
      schema_version: 1,
      percentage_basis_points: 10_000,
      eligible_rings: ["R3"],
      maximum_events: 2,
      maximum_cpu_overhead_percent: 25,
    });
    await expect(sampler.eligible("R3", "account-1")).resolves.toBe(true);
    sampler.compare({
      reference_digest: "a".repeat(64),
      canonical_rust_digest: "a".repeat(64),
      authoritative_elapsed_micros: 100,
      shadow_elapsed_micros: 120,
      side_effects: 0,
    });
    expect(() =>
      sampler.compare({
        reference_digest: "a".repeat(64),
        canonical_rust_digest: "a".repeat(64),
        authoritative_elapsed_micros: 100,
        shadow_elapsed_micros: 100,
        side_effects: 1,
      }),
    ).toThrow("SHADOW_SIDE_EFFECT");
    expect(() =>
      sampler.compare({
        reference_digest: "a".repeat(64),
        canonical_rust_digest: "b".repeat(64),
        authoritative_elapsed_micros: 100,
        shadow_elapsed_micros: 100,
        side_effects: 0,
      }),
    ).toThrow("MECHANICAL_DIVERGENCE");
  });

  it("uploads full repro capsules only through an explicit bounded authorization", async () => {
    const fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "x-er-repro-authorization": "EXPLICIT_USER_CONSENT",
        "x-er-repro-authorization-id": "consent-1",
      });
      expect((init?.headers as Record<string, string>)["x-er-repro-capsule-sha256"]).toMatch(/^[0-9a-f]{64}$/u);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetch);
    await uploadAuthorizedProductionReproV1({
      endpoint: new URL("https://telemetry.example/m9/repro"),
      allowedOrigin: "https://telemetry.example",
      releaseId: "release-2",
      generation: 7,
      failureFingerprint: "a".repeat(64),
      capsuleBytes: Uint8Array.of(1, 2, 3),
      authorization: { kind: "EXPLICIT_USER_CONSENT", consent_id: "consent-1" },
    });
    expect(fetch).toHaveBeenCalledOnce();
    await expect(
      uploadAuthorizedProductionReproV1({
        endpoint: new URL("https://telemetry.example/m9/repro?token=secret"),
        allowedOrigin: "https://telemetry.example",
        releaseId: "release-2",
        generation: 7,
        failureFingerprint: "a".repeat(64),
        capsuleBytes: Uint8Array.of(1),
        authorization: { kind: "EXPLICIT_USER_CONSENT", consent_id: "consent-1" },
      }),
    ).rejects.toThrow(/unauthorized/u);
  });

  it("reduces bounded telemetry aggregates to byte-identical health snapshots", () => {
    const directory = mkdtempSync(join(tmpdir(), "m9-health-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "input.json");
    const first = join(directory, "first.json");
    const second = join(directory, "second.json");
    const aggregate = {
      schema_version: 1,
      release_id: "release-2",
      observed_sessions: 1_000,
      observed_minutes: 720,
      worker_initialization_failure_basis_points: 0,
      unrecoverable_kernel_fault_basis_points: 0,
      deterministic_migration_failures: 0,
      cloud_save_regression_basis_points: 0,
      coop_relative_regression_percent: 0,
      coop_absolute_regression_basis_points: 0,
      input_latency_regression_percent: 0,
      crash_free_regression_basis_points: 0,
      hard_stop_fingerprints: [],
      input_event_aggregate_hash: "c".repeat(64),
      window_start_ms: 1,
      window_end_ms: 2,
    };
    writeFileSync(input, JSON.stringify(aggregate));
    const argumentsBeforeOutput = [resolve("scripts/m9-release-health.mjs"), "--input", input, "--output"];
    const argumentsAfterOutput = [
      "--release-id",
      "release-2",
      "--policy-hash",
      "a".repeat(64),
      "--manifest-hash",
      "b".repeat(64),
    ];
    execFileSync(process.execPath, [...argumentsBeforeOutput, first, ...argumentsAfterOutput]);
    execFileSync(process.execPath, [...argumentsBeforeOutput, second, ...argumentsAfterOutput]);
    expect(readFileSync(first)).toEqual(readFileSync(second));
    expect(JSON.parse(readFileSync(first, "utf8"))).toMatchObject({
      release_id: "release-2",
      policy_hash: "a".repeat(64),
      release_manifest_hash: "b".repeat(64),
      input_event_aggregate_hash: "c".repeat(64),
      hard_stop: false,
    });

    writeFileSync(input, JSON.stringify({ ...aggregate, token: "forbidden" }));
    const rejected = spawnSync(process.execPath, [...argumentsBeforeOutput, second, ...argumentsAfterOutput]);
    expect(rejected.status).not.toBe(0);
  });

  it("keeps account authorization in the browser fetch boundary and out of health payloads", async () => {
    const authorization = "a".repeat(32);
    expect(readProductionAccountAuthorizationV1(`other=1; pokerogue_sessionId=${authorization}`)).toBe(authorization);
    expect(() =>
      readProductionAccountAuthorizationV1(
        `pokerogue_sessionId=${authorization}; pokerogue_sessionId=${authorization}`,
      ),
    ).toThrow(/ambiguous/u);

    const fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${authorization}`);
      if (String(_input).includes("platform-context")) {
        return new Response(
          JSON.stringify({
            schema_version: 1,
            pseudonymous_account_id: "account-1",
            entitlements_digest: "a".repeat(64),
            server_api_versions: {
              schema_version: 1,
              save_api: 2,
              telemetry_api: 1,
              signaling_api: 33,
              showdown_api: 1,
              achievement_api: 1,
            },
            default_save_slot: "slot-0",
            telemetry_event_url: "https://telemetry.example/m9/health/event",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      expect(init?.body).not.toContain(authorization);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetch);
    const platform = await loadAuthenticatedPlatformContextV1(authorization);
    expect(platform.pseudonymous_account_id).toBe("account-1");
    await sendProductionHealthEventV1({
      endpoint: new URL(platform.telemetry_event_url),
      allowedOrigin: "https://telemetry.example",
      idempotencyKey: "bootstrap-1",
      event: event(),
      authorization,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends authenticated production cloud writes as PUT without cookie credentials", async () => {
    const authorization = "a".repeat(32);
    const fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      expect(init?.credentials).toBe("omit");
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${authorization}`);
      return new Response(null, {
        status: 204,
        headers: {
          etag: "revision-2",
          "x-er-release-id": "release-2",
          "x-er-save-slot": "slot-0",
          "x-er-save-schema": "1",
          "x-er-save-generation": "2",
        },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const cloud = new CloudSaveAdapterV1({
      endpoint: new URL("https://save.example/m9/save"),
      allowedOrigin: "https://save.example",
      releaseIdentity: "release-2",
      productionSaveSchema: 1,
      requireProductionIdentity: true,
      authorization,
    });
    await expect(cloud.compareAndSwap("slot-0", "revision-1", Uint8Array.of(1))).resolves.toBe("revision-2");
    cloud.dispose();
  });
});

function event(fingerprint: string | null = null): ProductionHealthEventV1 {
  return {
    schema_version: 1,
    release_id: "release-2",
    kernel_generation: generation(),
    browser_class: "CHROMIUM",
    platform_class: "DESKTOP",
    event: fingerprint == null ? "BOOTSTRAP_SUCCESS" : "KERNEL_FAULT",
    failure_fingerprint: fingerprint,
    performance: null,
    hard_stop_rule: null,
  };
}

function generation(): BrowserKernelGenerationIdentityV1 {
  return {
    schema_version: 1,
    session_id: "session-1",
    generation: 7,
    artifact_sha256: "1".repeat(64),
    wasm_sha256: "2".repeat(64),
    content_sha256: "3".repeat(64),
    source_git_sha: "4".repeat(40),
    worker_abi_version: 1,
    minimum_snapshot_schema: 6,
    maximum_snapshot_schema: 6,
    content_identity: "content-1",
    release_id: "release-2",
  };
}

function healthy() {
  return {
    observed_sessions: 1_000,
    observed_minutes: 1_000,
    worker_initialization_failure_basis_points: 0,
    unrecoverable_kernel_fault_basis_points: 0,
    deterministic_migration_failures: 0,
    cloud_save_regression_basis_points: 0,
    coop_relative_regression_percent: 0,
    coop_absolute_regression_basis_points: 0,
    input_latency_regression_percent: 0,
    crash_free_regression_basis_points: 0,
    hard_stop: false,
  };
}

function policy(): RolloutPolicyV1 {
  const percentages = [0, 0, 0, 100, 500, 2_500, 5_000, 10_000];
  return {
    schema_version: 1,
    policy_id: "policy-1",
    policy_version: 1,
    candidate_release: "release-2",
    stable_release: "release-1",
    legacy_release: null,
    active_ring: "R3",
    rings: percentages.map(
      (percentage, index): RolloutRingV1 => ({
        ring: `R${index}`,
        percentage_basis_points: percentage,
        eligibility:
          index === 0 ? "CI_LOCAL" : index === 1 ? "INTERNAL_ALLOWLIST" : index === 2 ? "PREVIEW_ALLOWLIST" : "PUBLIC",
        minimum_sessions: 0,
        minimum_duration_minutes: 0,
        required_health: {
          worker_initialization_failure_basis_points: 20,
          unrecoverable_kernel_fault_basis_points: 5,
          deterministic_migration_failures: 0,
          cloud_save_regression_basis_points: 10,
          coop_relative_regression_percent: 10,
          coop_absolute_regression_basis_points: 25,
          input_latency_regression_percent: 20,
          crash_free_regression_basis_points: 10,
        },
      }),
    ),
    hard_stop_rules: [
      "SAVE_CORRUPTION",
      "DETERMINISTIC_MIGRATION_FAILURE",
      "MECHANICAL_DIVERGENCE",
      "MIXED_ARTIFACT_EXECUTION",
      "ACCEPTED_PROTOCOL_MISMATCH",
      "CROSS_GENERATION_MATERIAL",
      "AUTHORITY_REPLICA_MISMATCH",
      "UNSIGNED_ASSIGNMENT",
      "RENDERER_CANONICAL_MUTATION",
    ],
    soft_stop_rules: [
      "WORKER_FAILURE_RATE",
      "KERNEL_FAULT_RATE",
      "CLOUD_SAVE_REGRESSION",
      "COOP_REGRESSION",
      "INPUT_LATENCY_REGRESSION",
      "CRASH_FREE_REGRESSION",
    ],
    issued_at: 1,
    expires_at: Number.MAX_SAFE_INTEGER,
  };
}

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

async function sign(pair: CryptoKeyPair, domain: string, payload: object): Promise<number[]> {
  const prefix = new TextEncoder().encode(`${domain}\0`);
  const encoded = encodeCanonicalJsonV1(payload);
  const bytes = new Uint8Array(prefix.byteLength + encoded.byteLength);
  bytes.set(prefix);
  bytes.set(encoded, prefix.byteLength);
  return Array.from(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, bytes)));
}
