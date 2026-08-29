import { type CanonicalShadowProjectionV1, canonicalShadowJson } from "./common-projection";
import { compareControlProjection } from "./control-comparator";
import { compareMechanicalProjection, firstShadowDifference, type ShadowDifferenceV1 } from "./mechanical-comparator";
import { comparePresentationProjection } from "./presentation-comparator";
import { compareSaveProjection } from "./save-comparator";

export type ShadowComparisonClassificationV1 =
  | "EQUAL"
  | "PRESENTATION_ONLY_DIFFERENCE"
  | "PLATFORM_ONLY_DIFFERENCE"
  | "MECHANICAL_DIVERGENCE"
  | "UNSUPPORTED_COMPARISON";

export interface ShadowComparisonV1 {
  schema_version: 1;
  sequence: number;
  boundary: CanonicalShadowProjectionV1["boundary"];
  operation_id: string;
  classification: ShadowComparisonClassificationV1;
  first_difference: ShadowDifferenceV1 | null;
}

export function compareShadowProjection(
  typescript: CanonicalShadowProjectionV1,
  rust: CanonicalShadowProjectionV1,
): ShadowComparisonV1 {
  const identityDifference =
    typescript.sequence !== rust.sequence
    || typescript.boundary !== rust.boundary
    || typescript.operation_id !== rust.operation_id;
  if (identityDifference) {
    return {
      schema_version: 1,
      sequence: Math.min(typescript.sequence, rust.sequence),
      boundary: typescript.boundary,
      operation_id: typescript.operation_id,
      classification: "MECHANICAL_DIVERGENCE",
      first_difference: {
        path: "$.identity",
        expected: `${typescript.sequence}:${typescript.boundary}:${typescript.operation_id}`,
        actual: `${rust.sequence}:${rust.boundary}:${rust.operation_id}`,
      },
    };
  }
  const mechanical = compareMechanicalProjection(typescript, rust);
  const control = compareControlProjection(typescript, rust);
  const save = compareSaveProjection(typescript, rust);
  const presentation = comparePresentationProjection(typescript, rust);
  const platform = firstShadowDifference(typescript.platform, rust.platform, "$.platform");
  let classification: ShadowComparisonClassificationV1 = "EQUAL";
  let difference: ShadowDifferenceV1 | null = null;
  if (mechanical != null || control != null || save != null) {
    classification = "MECHANICAL_DIVERGENCE";
    difference = mechanical ?? control ?? save;
  } else if (presentation != null) {
    classification = "PRESENTATION_ONLY_DIFFERENCE";
    difference = presentation;
  } else if (platform != null) {
    classification = "PLATFORM_ONLY_DIFFERENCE";
    difference = platform;
  } else if (
    typescript.mechanical_state == null
    && rust.mechanical_state == null
    && typescript.control == null
    && rust.control == null
    && typescript.save == null
    && rust.save == null
    && canonicalShadowJson(typescript.presentation) === "[]"
    && canonicalShadowJson(rust.presentation) === "[]"
  ) {
    classification = "UNSUPPORTED_COMPARISON";
  }
  return {
    schema_version: 1,
    sequence: typescript.sequence,
    boundary: typescript.boundary,
    operation_id: typescript.operation_id,
    classification,
    first_difference: difference,
  };
}
