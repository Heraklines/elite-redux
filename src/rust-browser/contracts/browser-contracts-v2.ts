import type { RawInputEventV1 } from "./browser-contracts";

export const BROWSER_WORKER_PROTOCOL_VERSION_V2 = 2 as const;
export const MAXIMUM_BROWSER_REQUEST_BYTES_V2 = 16 * 1024 * 1024;
export const MAXIMUM_BROWSER_RESPONSE_BYTES_V2 = 32 * 1024 * 1024;

// Rich kernel payloads retain their Rust-owned schema. The transport does not
// reinterpret them as historical V1 state or claim to validate their content.
export type CurrentJsonValue = null | boolean | number | string | CurrentJsonValue[] | {
  [key: string]: CurrentJsonValue;
};
export type CurrentJsonObject = { [key: string]: CurrentJsonValue };

export interface BrowserSessionContextV2 {
  local_seat: number;
  role: "AUTHORITY" | "REPLICA";
  scheduler: CurrentJsonObject;
  protocol: CurrentJsonObject | null;
}

export type BrowserSessionInitializationV2 =
  | { kind: "NATURAL_START"; context: BrowserSessionContextV2; profile: CurrentJsonObject;
      seed: string; save_slots: string[]; local_is_host: boolean; existing_saves?: boolean }
  | { kind: "EXISTING_SAVE"; context: BrowserSessionContextV2; save: CurrentJsonObject }
  | { kind: "SNAPSHOT"; context: BrowserSessionContextV2; snapshot: CurrentJsonObject }
  | { kind: "SCENARIO"; context: BrowserSessionContextV2; snapshot: CurrentJsonObject; scenario: number }
  // Explicit historical raw-only import, distinct from the current capsule.
  | { kind: "REPRO_CAPSULE"; context: BrowserSessionContextV2; snapshot: CurrentJsonObject; inputs: RawInputEventV1[] }
  | { kind: "CURRENT_REPRO_CAPSULE"; capsule_bytes: number[] };

export type BrowserPresentationOutcomeV2 =
  | { kind: "SETTLED" | "INTENTIONALLY_SKIPPED" }
  | { kind: "FAILED"; reason: string };

export type BrowserStorageResultV2 =
  | { kind: "READ"; bytes: number[] | null }
  | { kind: "WRITTEN" | "DELETED" }
  | { kind: "SLOTS"; slots: string[] }
  | { kind: "FAILED" | "UNCERTAIN"; reason: string }
  | { kind: "CONFLICT"; current_generation: number };

export type BrowserRequestV2 =
  | { kind: "INITIALIZE"; initialization: BrowserSessionInitializationV2 }
  | { kind: "RAW_INPUT"; event: RawInputEventV1 }
  | { kind: "ADVANCE_TIME"; milliseconds: number }
  | { kind: "PROPOSAL_FRAME" | "AUTHORITY_MATERIAL"; bytes: number[] }
  | { kind: "NETWORK_FRAME"; generation: number; bytes: number[] }
  | { kind: "TRANSPORT_CHANGED"; generation: number; connected: boolean }
  | { kind: "STORAGE_RESULT"; request_id: number; result: BrowserStorageResultV2 }
  | { kind: "PRESENTATION_SETTLED"; event_id: number; outcome: BrowserPresentationOutcomeV2 }
  | { kind: "LIFECYCLE"; event: "SUSPEND" | "RESUME" | "HIDDEN" | "VISIBLE" | "PAGE_HIDE" | "PAGE_SHOW" }
  | { kind: "SNAPSHOT" | "EXPORT_REPRO" | "DISPOSE" };

export interface BrowserRequestEnvelopeV2 {
  version: 2;
  request_id: number;
  sequence: number;
  request: BrowserRequestV2;
}

export type BrowserResponseV2 =
  | { kind: "READY" | "DISPOSED" }
  | { kind: "EFFECTS"; batch: BrowserEffectBatchV2 }
  | { kind: "SNAPSHOT"; snapshot: CurrentJsonObject }
  | { kind: "FAULT"; fault: { code: string; message: string } };

export interface BrowserResponseEnvelopeV2 {
  version: 2;
  request_id: number;
  accepted_sequence: number;
  response: BrowserResponseV2;
}

// Worker transport diagnostics are NOT BrowserKernelHostV2 FAULT responses.
// Unknown acceptance never invents an accepted sequence; the client must fence.
export type CurrentWorkerFailureV2 = {
  kind: "CURRENT_WORKER_FAILURE_V2";
  version: 2;
  request_id: number | null;
  sequence: number | null;
  code: string;
  message: string;
} & (
  | { acceptance: "REJECTED"; accepted_sequence: number | null }
  | { acceptance: "UNKNOWN"; accepted_sequence: null }
);

export type PresentationAssetIdentityV1 =
  | "INTERFACE_WINDOW"
  | "CURSOR"
  | "PARTY_ICON"
  | "ITEM_ICON"
  | "POKEMON_SPRITE"
  | "BATTLE_EFFECT"
  | "WORLD_BACKDROP"
  | "SCENARIO_SPRITE"
  | "TERMINAL_OVERLAY";

export type PresentationAudioCueV1 =
  | "CONFIRM"
  | "CANCEL"
  | "CURSOR"
  | "BATTLE"
  | "CAPTURE"
  | "REWARD"
  | "EVOLUTION"
  | "ERROR"
  | "TERMINAL";

export interface GameControlPlanV2Wire {
  schema_version: number;
  revision: number;
  kind: string;
  owner_seat: number | null;
  action_context: unknown | null;
  menu: unknown | null;
  actionable: boolean;
}

export interface GamePresentationEffectV2Wire {
  event_id: number;
  semantic: unknown;
  blocking: "NON_BLOCKING" | "BLOCKS_HUMAN_INPUT";
  skip: "FORBIDDEN" | "ALLOWED";
}

export interface BrowserStorageRequestV2Wire {
  request_id: number;
  kind: "READ" | "WRITE" | "DELETE" | "LIST";
  slot: string | null;
  generation: number | null;
  bytes: number[];
}

export type BrowserEffectV2 =
  | { kind: "UI_CHANGED"; control: GameControlPlanV2Wire }
  | { kind: "PRESENTATION"; effect: GamePresentationEffectV2Wire }
  | { kind: "PRESENTATION_SCENE_CHANGED"; semantic: unknown }
  | { kind: "SEND_NETWORK_FRAME"; generation: number; bytes: number[] }
  | { kind: "STORAGE_REQUEST"; request: BrowserStorageRequestV2Wire }
  | { kind: "ASSET_REQUEST"; asset: PresentationAssetIdentityV1 }
  | { kind: "AUDIO_CUE"; cue: PresentationAudioCueV1 }
  | { kind: "TERMINAL"; terminal: { terminal_id: string; reason: string } }
  | { kind: "TELEMETRY"; event: "RUN_STARTED" | "ACTION_APPLIED" | "SAVE_COMPLETED" | "TERMINAL_REACHED" }
  | { kind: "REPRO_READY"; snapshot: unknown; inputs: unknown[] }
  | { kind: "CURRENT_REPRO_READY"; capsule_bytes: number[] };

export interface BrowserEffectBatchV2 {
  external_sequence: number;
  effects: BrowserEffectV2[];
}

/** Validate transport correlation shapes; Rust remains the deep payload validator. */
export function decodeBrowserResponseEnvelopeV2(buffer: ArrayBuffer): BrowserResponseEnvelopeV2 {
  if (buffer.byteLength === 0 || buffer.byteLength > MAXIMUM_BROWSER_RESPONSE_BYTES_V2) {
    throw new Error("current Worker response is empty or oversized");
  }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer), (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new Error("current response payload numbers must be signed safe integers");
    }
    return value;
  }) as BrowserResponseEnvelopeV2;
  if (value == null || value.version !== 2 || !safeCurrentInteger(value.request_id)
    || !safeCurrentInteger(value.accepted_sequence) || value.response == null) {
    throw new Error("current Worker response ABI or correlation is invalid");
  }
  const response = value.response;
  switch (response.kind) {
    case "READY":
    case "DISPOSED":
      break;
    case "SNAPSHOT":
      if (response.snapshot == null || typeof response.snapshot !== "object"
        || Array.isArray(response.snapshot) || response.snapshot.schema_version !== 7) {
        throw new Error("current Worker snapshot is not V7");
      }
      break;
    case "FAULT":
      if (typeof response.fault?.code !== "string" || typeof response.fault.message !== "string") {
        throw new Error("current host fault payload is invalid");
      }
      break;
    case "EFFECTS":
      if (response.batch?.external_sequence !== value.accepted_sequence || !Array.isArray(response.batch.effects)
        || response.batch.effects.some(effect => effect == null || !CURRENT_EFFECT_KINDS_V2.has(effect.kind))) {
        throw new Error("current Worker effect batch correlation is invalid");
      }
      break;
    default:
      throw new Error("current Worker returned an unknown response kind");
  }
  return value;
}

export function safeCurrentInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const CURRENT_EFFECT_KINDS_V2 = new Set<string>([
  "UI_CHANGED", "PRESENTATION", "PRESENTATION_SCENE_CHANGED", "SEND_NETWORK_FRAME", "STORAGE_REQUEST",
  "ASSET_REQUEST", "AUDIO_CUE", "TERMINAL", "TELEMETRY", "REPRO_READY", "CURRENT_REPRO_READY",
]);
/** Current payloads include signed stat stages/faction values. IDs are checked
 * separately; unsafe integers, fractions and non-finite values are not lossless
 * JavaScript transport values and are rejected rather than silently rounded.
 */
export function encodeCanonicalJsonV2(value: unknown): Uint8Array {
  const canonical = (value: unknown): string => {
    if (value === null) return "null";
    if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new Error("current payload numbers must be signed safe integers");
      return String(value);
    }
    if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
    if (typeof value === "object") {
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
    }
    throw new Error("current payload is not canonical JSON");
  };
  return new TextEncoder().encode(canonical(value));
}

export function encodeBrowserRequestEnvelopeV2(envelope: BrowserRequestEnvelopeV2): Uint8Array {
  if (envelope.version !== 2 || !safeCurrentInteger(envelope.request_id) || !safeCurrentInteger(envelope.sequence)) {
    throw new Error("current request ABI or nonnegative correlation is invalid");
  }
  return encodeCanonicalJsonV2(envelope);
}
