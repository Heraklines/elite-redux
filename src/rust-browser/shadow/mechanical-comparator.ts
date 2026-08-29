import type { CanonicalShadowProjectionV1, CanonicalShadowValueV1 } from "./common-projection";

export interface ShadowDifferenceV1 {
  path: string;
  expected: CanonicalShadowValueV1 | "MISSING";
  actual: CanonicalShadowValueV1 | "MISSING";
}

type ShadowRecordV1 = Record<string, CanonicalShadowValueV1>;

function isShadowRecord(value: CanonicalShadowValueV1): value is ShadowRecordV1 {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function firstArrayDifference(
  expected: CanonicalShadowValueV1[],
  actual: CanonicalShadowValueV1[],
  path: string,
): ShadowDifferenceV1 | null {
  const maximum = Math.max(expected.length, actual.length);
  for (let index = 0; index < maximum; index += 1) {
    if (index >= expected.length) {
      return { path: `${path}[${index}]`, expected: "MISSING", actual: actual[index] };
    }
    if (index >= actual.length) {
      return { path: `${path}[${index}]`, expected: expected[index], actual: "MISSING" };
    }
    const difference = firstShadowDifference(expected[index], actual[index], `${path}[${index}]`);
    if (difference != null) {
      return difference;
    }
  }
  return null;
}

function firstRecordDifference(
  expected: ShadowRecordV1,
  actual: ShadowRecordV1,
  path: string,
): ShadowDifferenceV1 | null {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (!(key in expected)) {
      return { path: `${path}.${key}`, expected: "MISSING", actual: actual[key] };
    }
    if (!(key in actual)) {
      return { path: `${path}.${key}`, expected: expected[key], actual: "MISSING" };
    }
    const difference = firstShadowDifference(expected[key], actual[key], `${path}.${key}`);
    if (difference != null) {
      return difference;
    }
  }
  return null;
}

export function firstShadowDifference(
  expected: CanonicalShadowValueV1,
  actual: CanonicalShadowValueV1,
  path: string,
): ShadowDifferenceV1 | null {
  if (Object.is(expected, actual)) {
    return null;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return firstArrayDifference(expected, actual, path);
  }
  if (isShadowRecord(expected) && isShadowRecord(actual)) {
    return firstRecordDifference(expected, actual, path);
  }
  return { path, expected, actual };
}

export function compareMechanicalProjection(
  typescript: CanonicalShadowProjectionV1,
  rust: CanonicalShadowProjectionV1,
): ShadowDifferenceV1 | null {
  const mechanical = firstShadowDifference(typescript.mechanical_state, rust.mechanical_state, "$.mechanical_state");
  if (mechanical != null) {
    return mechanical;
  }
  return firstShadowDifference(typescript.rng_queries, rust.rng_queries, "$.rng_queries");
}
