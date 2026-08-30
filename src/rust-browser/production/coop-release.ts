import type { BrowserKernelCompatibilityV1 } from "../adapters/signaling-adapter";
import type { ProductionCoopCompatibilityV1, ProductionReleaseManifestV2, SessionRuntimePinV1 } from "./contracts";

export interface PinnedCoopReleaseV1 {
  schema_version: 1;
  party_id: string;
  release_id: string;
  kernel_generation: number;
  session_epoch: number;
  membership_revision: number;
  connection_generation: number;
  protocol_frontier: number;
}

export function productionCoopCompatibilityV1(
  release: ProductionReleaseManifestV2,
  compatibleReleases: readonly string[],
): ProductionCoopCompatibilityV1 {
  return {
    schema_version: 1,
    release_id: release.release_id,
    compatible_releases: [...new Set(compatibleReleases)].sort(),
    authority_runtime:
      release.channel === "CANARY" || release.channel === "INTERNAL" ? "RUST_CANARY" : "RUST_PRODUCTION",
    authority_protocol: "er-coop-47",
    mechanical_identity: release.mechanical_identity,
    content_hash: release.mechanical_identity.content_hash,
    material_schemas: release.material_schemas,
    browser_kernel_abi: 1,
    save_schema: release.save_schema,
    active_model_identity: release.mechanical_identity.active_model_identity,
  };
}

export function browserKernelCompatibilityV1(
  compatibility: ProductionCoopCompatibilityV1,
): BrowserKernelCompatibilityV1 {
  return {
    browser_worker_protocol: 1,
    frame_envelope_version: 1,
    authority_protocol: compatibility.authority_protocol,
    release_id: compatibility.release_id,
    compatible_releases: compatibility.compatible_releases,
    mechanical_identity: compatibility.mechanical_identity.mechanics_sha256,
    content_hash: compatibility.content_hash,
    material_schema: compatibility.material_schemas.turn,
    save_schema: compatibility.save_schema,
    browser_kernel_abi: compatibility.browser_kernel_abi,
    active_model_identity: compatibility.active_model_identity,
    authority_runtime: "RUST",
  };
}

export function choosePartyReleaseV1(
  left: ProductionCoopCompatibilityV1,
  right: ProductionCoopCompatibilityV1,
): string {
  if (
    left.authority_runtime !== right.authority_runtime
    || left.authority_protocol !== right.authority_protocol
    || left.mechanical_identity.mechanics_sha256 !== right.mechanical_identity.mechanics_sha256
    || left.content_hash !== right.content_hash
    || JSON.stringify(left.material_schemas) !== JSON.stringify(right.material_schemas)
    || left.browser_kernel_abi !== right.browser_kernel_abi
    || left.save_schema !== right.save_schema
    || left.active_model_identity !== right.active_model_identity
  ) {
    throw new Error("co-op party has incompatible Rust authority identities");
  }
  if (left.release_id === right.release_id) {
    return left.release_id;
  }
  if (left.compatible_releases.includes(right.release_id) && right.compatible_releases.includes(left.release_id)) {
    return [left.release_id, right.release_id].sort()[0];
  }
  const common = left.compatible_releases.filter(release => right.compatible_releases.includes(release)).sort()[0];
  if (common == null) {
    throw new Error("co-op party has no common signed release");
  }
  return common;
}

export function assertPinnedCoopReconnectV1(
  coop: PinnedCoopReleaseV1,
  session: SessionRuntimePinV1,
  nextConnectionGeneration: number,
): void {
  if (
    coop.schema_version !== 1
    || coop.release_id !== session.release_id
    || coop.kernel_generation !== session.kernel_generation.generation
    || !Number.isSafeInteger(nextConnectionGeneration)
    || nextConnectionGeneration <= coop.connection_generation
    || coop.protocol_frontier < 0
  ) {
    throw new Error("co-op reconnect does not preserve the pinned production release frontier");
  }
}
