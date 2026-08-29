import type { ArtifactIdentityV1, ProductionReleaseManifestV2, SignedProductionManifestV1 } from "./contracts";
import { type TrustedBrowserReleaseKeyV1, verifyEd25519EnvelopeV1 } from "./signature-verifier";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/u;

export function validateProductionReleaseManifestV2(
  manifest: ProductionReleaseManifestV2,
  now = Date.now(),
): ProductionReleaseManifestV2 {
  if (
    manifest.schema_version !== 2
    || !IDENTIFIER.test(manifest.release_id)
    || !safePositive(manifest.release_epoch)
    || !safePositive(manifest.issued_at)
    || !safePositive(manifest.expires_at)
    || manifest.issued_at > now
    || now >= manifest.expires_at
    || manifest.issued_at >= manifest.expires_at
    || !GIT_SHA.test(manifest.integration_sha)
    || !GIT_SHA.test(manifest.rust_base_sha)
    || !GIT_SHA.test(manifest.browser_base_sha)
    || !GIT_SHA.test(manifest.oracle_sha)
    || !GIT_SHA.test(manifest.qualified_asset_sha)
    || manifest.browser_kernel_abi !== 1
    || manifest.worker_protocol !== 1
    || manifest.authority_protocol !== "er-coop-47"
    || manifest.save_schema < 1
    || manifest.build_identity.profile !== "release"
    || manifest.build_identity.debug_surfaces_absent !== true
    || manifest.qualification.candidate_sha !== manifest.integration_sha
    || manifest.qualification.conclusion !== "SUCCESS"
    || !SHA256.test(manifest.qualification.artifact_set_sha256)
  ) {
    throw new Error("production release manifest identity is invalid");
  }
  const artifacts = Object.values(manifest.artifacts);
  const urls = new Set<string>();
  for (const artifact of artifacts) {
    validateArtifact(artifact, manifest.release_id);
    if (urls.has(artifact.url)) {
      throw new Error("production release manifest contains duplicate artifact URLs");
    }
    urls.add(artifact.url);
  }
  return manifest;
}

export async function verifySignedProductionManifestV1(
  envelope: SignedProductionManifestV1,
  keys: readonly TrustedBrowserReleaseKeyV1[],
  now = Date.now(),
): Promise<ProductionReleaseManifestV2> {
  validateProductionReleaseManifestV2(envelope.payload, now);
  return verifyEd25519EnvelopeV1({
    envelopeVersion: envelope.envelope_version,
    keyId: envelope.key_id,
    payload: envelope.payload,
    signature: envelope.signature,
    domain: "er-m9:release-manifest-v1",
    channel: envelope.payload.channel,
    releaseEpoch: envelope.payload.release_epoch,
    trustedKeys: keys,
  });
}

function validateArtifact(artifact: ArtifactIdentityV1, releaseId: string): void {
  const url = new URL(artifact.url, globalThis.location?.origin ?? "https://invalid.local");
  if (
    !SHA256.test(artifact.sha256)
    || !safePositive(artifact.bytes)
    || artifact.media_type.length === 0
    || url.origin !== (globalThis.location?.origin ?? "https://invalid.local")
    || url.search.length > 0
    || url.hash.length > 0
    || !url.pathname.includes(`/${releaseId}/`)
    || !url.pathname.includes(artifact.sha256)
  ) {
    throw new Error("production artifact identity is invalid");
  }
}

function safePositive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
