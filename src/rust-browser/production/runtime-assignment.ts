import type {
  ReleaseChannelV1,
  RuntimeAssignmentScopeV1,
  RuntimeAssignmentV1,
  SignedRuntimeAssignmentV1,
} from "./contracts";
import { type TrustedBrowserReleaseKeyV1, verifyEd25519EnvelopeV1 } from "./signature-verifier";

const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/u;

export function validateRuntimeAssignmentV1(assignment: RuntimeAssignmentV1, now = Date.now()): RuntimeAssignmentV1 {
  if (
    assignment.schema_version !== 1
    || !IDENTIFIER.test(assignment.assignment_id)
    || !IDENTIFIER.test(assignment.release_id)
    || !IDENTIFIER.test(assignment.cohort)
    || !safePositive(assignment.issued_at)
    || !safePositive(assignment.expires_at)
    || assignment.issued_at > now
    || now >= assignment.expires_at
    || assignment.issued_at >= assignment.expires_at
    || !safePositive(assignment.policy_version)
  ) {
    throw new Error("production runtime assignment is invalid");
  }
  validateScope(assignment.sticky_scope);
  return assignment;
}

export async function verifySignedRuntimeAssignmentV1(
  envelope: SignedRuntimeAssignmentV1,
  keys: readonly TrustedBrowserReleaseKeyV1[],
  channel: ReleaseChannelV1,
  now = Date.now(),
): Promise<RuntimeAssignmentV1> {
  validateRuntimeAssignmentV1(envelope.payload, now);
  return verifyEd25519EnvelopeV1({
    envelopeVersion: envelope.envelope_version,
    keyId: envelope.key_id,
    payload: envelope.payload,
    signature: envelope.signature,
    domain: "er-m9:runtime-assignment-v1",
    channel,
    trustedKeys: keys,
  });
}

function validateScope(scope: RuntimeAssignmentScopeV1): void {
  const value =
    scope.kind === "BROWSER_SESSION"
      ? scope.value.session_id
      : scope.kind === "GAME_RUN"
        ? scope.value.run_id
        : scope.kind === "ACCOUNT"
          ? scope.value.pseudonymous_account_id
          : scope.value.party_id;
  if (!IDENTIFIER.test(value)) {
    throw new Error("production assignment sticky scope is invalid");
  }
}

function safePositive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
