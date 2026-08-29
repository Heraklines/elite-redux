import type { CanonicalShadowProjectionV1 } from "./common-projection";
import { firstShadowDifference, type ShadowDifferenceV1 } from "./mechanical-comparator";

export function comparePresentationProjection(
  typescript: CanonicalShadowProjectionV1,
  rust: CanonicalShadowProjectionV1,
): ShadowDifferenceV1 | null {
  return firstShadowDifference(typescript.presentation, rust.presentation, "$.presentation");
}
