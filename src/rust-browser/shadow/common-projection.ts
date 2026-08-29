export type ShadowBoundaryKindV1 =
  | "BOOTSTRAP"
  | "COMMAND_CONTROL"
  | "TURN"
  | "REPLACEMENT"
  | "INTERACTION"
  | "PROGRESSION"
  | "WAVE"
  | "CAPTURE"
  | "SCENARIO"
  | "SAVE"
  | "PRESENTATION"
  | "TERMINAL";

export type ShadowSourceV1 = "TYPESCRIPT" | "RUST";
export type CanonicalShadowValueV1 =
  | null
  | boolean
  | number
  | string
  | CanonicalShadowValueV1[]
  | {
      [key: string]: CanonicalShadowValueV1;
    };

export interface CanonicalShadowProjectionV1 {
  schema_version: 1;
  source: ShadowSourceV1;
  sequence: number;
  boundary: ShadowBoundaryKindV1;
  operation_id: string;
  mechanical_state: CanonicalShadowValueV1 | null;
  rng_queries: CanonicalShadowValueV1[];
  control: CanonicalShadowValueV1 | null;
  presentation: CanonicalShadowValueV1[];
  save: CanonicalShadowValueV1 | null;
  platform: CanonicalShadowValueV1 | null;
}

const MAXIMUM_SHADOW_BYTES = 4_194_304;

export function canonicalShadowValue(value: unknown, seen = new Set<object>()): CanonicalShadowValueV1 {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error("shadow projection contains a noncanonical number");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(entry => canonicalShadowValue(entry, seen));
  }
  if (typeof value !== "object") {
    throw new Error("shadow projection contains a non-JSON value");
  }
  if (seen.has(value)) {
    throw new Error("shadow projection contains a cycle");
  }
  seen.add(value);
  const output: Record<string, CanonicalShadowValueV1> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) {
      output[key] = canonicalShadowValue(entry, seen);
    }
  }
  seen.delete(value);
  return output;
}

export function canonicalShadowJson(value: CanonicalShadowValueV1): string {
  return JSON.stringify(value);
}

function record(value: CanonicalShadowValueV1): Record<string, CanonicalShadowValueV1> {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value : {};
}

function first(object: Record<string, CanonicalShadowValueV1>, keys: string[]): CanonicalShadowValueV1 | null {
  for (const key of keys) {
    if (key in object) {
      return object[key];
    }
  }
  return null;
}

function array(value: CanonicalShadowValueV1 | null): CanonicalShadowValueV1[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

export function projectShadowBoundary(
  source: ShadowSourceV1,
  sequence: number,
  boundary: ShadowBoundaryKindV1,
  operationId: string,
  payload: unknown,
): CanonicalShadowProjectionV1 {
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || operationId.length === 0 || operationId.length > 512) {
    throw new Error("shadow projection identity is invalid");
  }
  const normalized = canonicalShadowValue(payload);
  const object = record(normalized);
  return {
    schema_version: 1,
    source,
    sequence,
    boundary,
    operation_id: operationId,
    mechanical_state: first(object, ["mechanical_state", "after_state", "game_state", "battle_state", "state"]),
    rng_queries: array(first(object, ["rng_queries", "rng_audit", "rng"])),
    control: first(object, ["control", "next_control", "ui_control"]),
    presentation: array(first(object, ["presentation", "presentation_events", "presentation_plan"])),
    save: first(object, ["save", "save_data", "canonical_save"]),
    platform: first(object, ["platform", "platform_effects"]),
  };
}

export function decodeRustShadowProjection(
  sequence: number,
  boundary: ShadowBoundaryKindV1,
  operationId: string,
  bytes: Uint8Array,
): CanonicalShadowProjectionV1 {
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SHADOW_BYTES) {
    throw new Error("Rust shadow observation is empty or oversized");
  }
  const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return projectShadowBoundary("RUST", sequence, boundary, operationId, payload);
}
