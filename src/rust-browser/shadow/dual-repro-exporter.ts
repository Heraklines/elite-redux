import { type CanonicalShadowProjectionV1, canonicalShadowJson, canonicalShadowValue } from "./common-projection";
import type { RustShadowObservationV1 } from "./rust-shadow-host";

export interface DualRuntimeReproCapsuleV1 {
  schema_version: 1;
  browser_source_sha: string;
  rust_source_sha: string;
  first_divergence: RustShadowObservationV1;
  typescript_trace: CanonicalShadowProjectionV1[];
  typescript_repro_bytes: number[];
  rust_repro_bytes: number[];
}

const MAXIMUM_REPRO_BYTES = 8_388_608;

export function exportDualRuntimeReproCapsule(
  browserSourceSha: string,
  rustSourceSha: string,
  divergence: RustShadowObservationV1,
  typescriptTrace: readonly CanonicalShadowProjectionV1[],
  typescriptRepro: Uint8Array,
  rustRepro: Uint8Array,
): Uint8Array {
  if (
    !/^[0-9a-f]{40}$/u.test(browserSourceSha)
    || !/^[0-9a-f]{40}$/u.test(rustSourceSha)
    || typescriptRepro.byteLength > MAXIMUM_REPRO_BYTES
    || rustRepro.byteLength > MAXIMUM_REPRO_BYTES
  ) {
    throw new Error("dual-runtime repro identity or byte bounds are invalid");
  }
  const capsule: DualRuntimeReproCapsuleV1 = {
    schema_version: 1,
    browser_source_sha: browserSourceSha,
    rust_source_sha: rustSourceSha,
    first_divergence: divergence,
    typescript_trace: [...typescriptTrace],
    typescript_repro_bytes: Array.from(typescriptRepro),
    rust_repro_bytes: Array.from(rustRepro),
  };
  const canonical = canonicalShadowValue(capsule);
  const bytes = new TextEncoder().encode(canonicalShadowJson(canonical));
  if (bytes.byteLength > MAXIMUM_REPRO_BYTES) {
    throw new Error("dual-runtime repro capsule is oversized");
  }
  return bytes;
}
