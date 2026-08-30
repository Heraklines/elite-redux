import type {
  ReleaseChannelV1,
  RollbackDirectiveV1,
  RolloutPolicyV1,
  SignedRollbackDirectiveV1,
  SignedRolloutPolicyV1,
} from "./contracts";
import { evaluateReleaseHealthV1, type ReleaseHealthDecisionV1 } from "./health-event";
import { type TrustedBrowserReleaseKeyV1, verifyEd25519EnvelopeV1 } from "./signature-verifier";

const RINGS = ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"] as const;
const PERCENTAGES = [0, 0, 0, 100, 500, 2_500, 5_000, 10_000] as const;
const HARD_STOPS: Readonly<Record<string, true>> = {
  SAVE_CORRUPTION: true,
  DETERMINISTIC_MIGRATION_FAILURE: true,
  MECHANICAL_DIVERGENCE: true,
  MIXED_ARTIFACT_EXECUTION: true,
  ACCEPTED_PROTOCOL_MISMATCH: true,
  CROSS_GENERATION_MATERIAL: true,
  AUTHORITY_REPLICA_MISMATCH: true,
  UNSIGNED_ASSIGNMENT: true,
  RENDERER_CANONICAL_MUTATION: true,
};

export async function verifySignedRolloutPolicyV1(
  envelope: SignedRolloutPolicyV1,
  keys: readonly TrustedBrowserReleaseKeyV1[],
  now = Date.now(),
): Promise<RolloutPolicyV1> {
  validatePolicy(envelope.payload, now);
  return verifyEd25519EnvelopeV1({
    envelopeVersion: envelope.envelope_version,
    keyId: envelope.key_id,
    payload: envelope.payload,
    signature: envelope.signature,
    domain: "er-m9:rollout-policy-v1",
    channel: "STABLE",
    trustedKeys: keys,
  });
}

export async function verifySignedRollbackDirectiveV1(
  envelope: SignedRollbackDirectiveV1,
  keys: readonly TrustedBrowserReleaseKeyV1[],
  now = Date.now(),
): Promise<RollbackDirectiveV1> {
  const directive = envelope.payload;
  if (
    directive.schema_version !== 1
    || directive.affected_release === directive.target_release
    || directive.policy_version < 1
    || directive.issued_at > now
    || now >= directive.expires_at
  ) {
    throw new Error("production rollback directive is invalid");
  }
  return verifyEd25519EnvelopeV1({
    envelopeVersion: envelope.envelope_version,
    keyId: envelope.key_id,
    payload: directive,
    signature: envelope.signature,
    domain: "er-m9:rollback-directive-v1",
    channel: "ROLLBACK",
    trustedKeys: keys,
  });
}

export async function productionCohortBucketV1(policyId: string, stickyIdentity: string): Promise<number> {
  if (policyId.length === 0 || stickyIdentity.length === 0) {
    throw new Error("production cohort identity is empty");
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${policyId}:${stickyIdentity}`)),
  );
  return ((digest[0] << 8) | digest[1]) % 10_000;
}

export async function releaseForStickyScopeV1(
  policy: RolloutPolicyV1,
  stickyIdentity: string,
  internalEligible: boolean,
  previewEligible: boolean,
): Promise<string> {
  validatePolicy(policy, Date.now());
  const index = RINGS.indexOf(policy.active_ring as (typeof RINGS)[number]);
  if (index < 0) {
    throw new Error("active rollout ring is invalid");
  }
  const eligible =
    policy.active_ring === "R1"
      ? internalEligible
      : policy.active_ring === "R2"
        ? previewEligible
        : policy.active_ring === "R0"
          ? false
          : (await productionCohortBucketV1(policy.policy_id, stickyIdentity)) < PERCENTAGES[index];
  return eligible ? policy.candidate_release : policy.stable_release;
}

export function hardStopFromEventsV1(eventKinds: readonly string[]): string | null {
  return [...eventKinds].sort().find(kind => HARD_STOPS[kind] === true) ?? null;
}

export function applyRollbackToNewSessionsV1(policy: RolloutPolicyV1, directive: RollbackDirectiveV1): RolloutPolicyV1 {
  if (
    directive.affected_release !== policy.candidate_release
    || !["NEW_SESSIONS", "UNSTARTED_ASSIGNED_SESSIONS"].includes(directive.scope)
    || directive.target_runtime === "LEGACY_TRANSITION"
  ) {
    throw new Error("rollback directive is not a Rust-first new-session rollback");
  }
  return {
    ...policy,
    policy_version: directive.policy_version,
    candidate_release: directive.target_release,
    stable_release: directive.target_release,
    issued_at: directive.issued_at,
    expires_at: directive.expires_at,
  };
}

export class ProductionRolloutControllerV1 {
  #policy: RolloutPolicyV1;
  #candidateAssignmentsHalted = false;

  constructor(policy: RolloutPolicyV1, now = Date.now()) {
    validatePolicy(policy, now);
    this.#policy = structuredClone(policy);
  }

  get candidateAssignmentsHalted(): boolean {
    return this.#candidateAssignmentsHalted;
  }

  get policy(): RolloutPolicyV1 {
    return structuredClone(this.#policy);
  }

  async releaseForSession(options: {
    stickyIdentity: string;
    pinnedRelease: string | null;
    internalEligible: boolean;
    previewEligible: boolean;
  }): Promise<string> {
    if (options.pinnedRelease != null) {
      return options.pinnedRelease;
    }
    if (this.#candidateAssignmentsHalted) {
      return this.#policy.stable_release;
    }
    return releaseForStickyScopeV1(
      this.#policy,
      options.stickyIdentity,
      options.internalEligible,
      options.previewEligible,
    );
  }

  evaluateCandidateHealth(health: Parameters<typeof evaluateReleaseHealthV1>[0]): ReleaseHealthDecisionV1 {
    const ring = this.#policy.rings.find(value => value.ring === this.#policy.active_ring);
    if (ring == null) {
      throw new Error("active rollout ring is unavailable");
    }
    const decision = evaluateReleaseHealthV1(health, ring);
    if (decision.decision === "HALT") {
      this.#candidateAssignmentsHalted = true;
    }
    return decision;
  }

  applyRollback(directive: RollbackDirectiveV1): void {
    this.#policy = applyRollbackToNewSessionsV1(this.#policy, directive);
    this.#candidateAssignmentsHalted = true;
  }
}

function validatePolicy(policy: RolloutPolicyV1, now: number): void {
  if (
    policy.schema_version !== 1
    || policy.policy_version < 1
    || policy.rings.length !== 8
    || policy.hard_stop_rules.length !== 9
    || policy.issued_at > now
    || now >= policy.expires_at
    || RINGS.some(
      (ring, index) =>
        policy.rings[index]?.ring !== ring || policy.rings[index]?.percentage_basis_points !== PERCENTAGES[index],
    )
    || !RINGS.includes(policy.active_ring as (typeof RINGS)[number])
  ) {
    throw new Error("production rollout policy is invalid");
  }
}

export function channelForAuthorityV1(authority: string): ReleaseChannelV1 {
  if (authority === "RUST_PRODUCTION") {
    return "STABLE";
  }
  if (authority === "RUST_CANARY" || authority === "RUST_SHADOW_SAMPLE") {
    return "CANARY";
  }
  if (authority === "LEGACY_TRANSITION") {
    return "LEGACY_TRANSITION";
  }
  throw new Error("production authority runtime is invalid");
}
