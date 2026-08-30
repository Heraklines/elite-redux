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
  expectedScopes: readonly RuntimeAssignmentScopeV1[],
  now = Date.now(),
): Promise<RuntimeAssignmentV1> {
  if (expectedScopes.length === 0 || expectedScopes.length > 4) {
    throw new Error("production assignment has no bounded expected sticky scope");
  }
  expectedScopes.forEach(validateScope);
  validateRuntimeAssignmentV1(envelope.payload, now);
  const verified = await verifyEd25519EnvelopeV1({
    envelopeVersion: envelope.envelope_version,
    keyId: envelope.key_id,
    payload: envelope.payload,
    signature: envelope.signature,
    domain: "er-m9:runtime-assignment-v1",
    channel,
    trustedKeys: keys,
  });
  if (!expectedScopes.some(scope => sameScope(scope, verified.sticky_scope))) {
    throw new Error("signed production assignment belongs to another sticky scope");
  }
  return verified;
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

function sameScope(expected: RuntimeAssignmentScopeV1, actual: RuntimeAssignmentScopeV1): boolean {
  if (expected.kind !== actual.kind) {
    return false;
  }
  const expectedValue =
    expected.kind === "BROWSER_SESSION"
      ? expected.value.session_id
      : expected.kind === "GAME_RUN"
        ? expected.value.run_id
        : expected.kind === "ACCOUNT"
          ? expected.value.pseudonymous_account_id
          : expected.value.party_id;
  const actualValue =
    actual.kind === "BROWSER_SESSION"
      ? actual.value.session_id
      : actual.kind === "GAME_RUN"
        ? actual.value.run_id
        : actual.kind === "ACCOUNT"
          ? actual.value.pseudonymous_account_id
          : actual.value.party_id;
  return expectedValue === actualValue;
}

function safePositive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
