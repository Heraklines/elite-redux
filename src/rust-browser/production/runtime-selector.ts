import type {
  ProductionReleaseManifestV2,
  RuntimeAssignmentScopeV1,
  RuntimeAssignmentV1,
  SessionRuntimePinV1,
  SignedProductionManifestV1,
  SignedRuntimeAssignmentV1,
} from "./contracts";
import { verifySignedProductionManifestV1 } from "./release-manifest";
import { verifySignedRuntimeAssignmentV1 } from "./runtime-assignment";
import { validateSessionRuntimePinV1 } from "./session-pin";
import type { TrustedBrowserReleaseKeyV1 } from "./signature-verifier";

export interface ProductionRuntimeSelectionDependenciesV1 {
  sessionId: string;
  now: number;
  trustedKeys: readonly TrustedBrowserReleaseKeyV1[];
  expectedAssignmentScopes: readonly RuntimeAssignmentScopeV1[];
  loadPin(sessionId: string): Promise<SessionRuntimePinV1 | null>;
  loadRelease(releaseId: string): Promise<SignedProductionManifestV1>;
  requestAssignment(): Promise<SignedRuntimeAssignmentV1>;
}

export interface VerifiedProductionRuntimeSelectionV1 {
  release: ProductionReleaseManifestV2;
  assignment: RuntimeAssignmentV1 | null;
  existingPin: SessionRuntimePinV1 | null;
}

export async function selectProductionRuntimeV1(
  dependencies: ProductionRuntimeSelectionDependenciesV1,
): Promise<VerifiedProductionRuntimeSelectionV1> {
  const existing = await dependencies.loadPin(dependencies.sessionId);
  if (existing != null) {
    validateSessionRuntimePinV1(existing);
    if (existing.session_id !== dependencies.sessionId) {
      throw new Error("production session pin belongs to another browser session");
    }
    const signedRelease = await dependencies.loadRelease(existing.release_id);
    const release = await verifySignedProductionManifestV1(signedRelease, dependencies.trustedKeys, dependencies.now);
    assertPinRelease(existing, release);
    return { release, assignment: null, existingPin: existing };
  }

  const signedAssignment = await dependencies.requestAssignment();
  const signedRelease = await dependencies.loadRelease(signedAssignment.payload.release_id);
  const release = await verifySignedProductionManifestV1(signedRelease, dependencies.trustedKeys, dependencies.now);
  const assignment = await verifySignedRuntimeAssignmentV1(
    signedAssignment,
    dependencies.trustedKeys,
    release.channel,
    dependencies.expectedAssignmentScopes,
    dependencies.now,
  );
  if (assignment.release_id !== release.release_id) {
    throw new Error("signed assignment and release identity differ");
  }
  assertAuthorityChannel(assignment, release);
  return { release, assignment, existingPin: null };
}

function assertPinRelease(pin: SessionRuntimePinV1, release: ProductionReleaseManifestV2): void {
  if (
    pin.release_id !== release.release_id
    || pin.mechanical_identity.mechanics_sha256 !== release.mechanical_identity.mechanics_sha256
    || pin.mechanical_identity.content_hash !== release.mechanical_identity.content_hash
    || pin.kernel_generation.release_id !== release.release_id
  ) {
    throw new Error("production session pin is incompatible with its signed release");
  }
}

function assertAuthorityChannel(assignment: RuntimeAssignmentV1, release: ProductionReleaseManifestV2): void {
  const allowed =
    assignment.authority === "RUST_PRODUCTION"
      ? release.channel === "STABLE" || release.channel === "ROLLBACK"
      : assignment.authority === "RUST_CANARY"
        ? release.channel === "CANARY" || release.channel === "INTERNAL"
        : assignment.authority === "RUST_SHADOW_SAMPLE"
          ? release.channel === "CANARY" || release.channel === "INTERNAL" || release.channel === "PREVIEW"
          : release.channel === "LEGACY_TRANSITION";
  if (!allowed) {
    throw new Error("production runtime authority is invalid for the signed release channel");
  }
}
