export const BROWSER_WORKER_PROTOCOL_VERSION_V1 = 1 as const;
export const MAXIMUM_BROWSER_REQUEST_BYTES_V1 = 1_048_576;
export const MAXIMUM_BROWSER_EFFECT_BYTES_V1 = 4_194_304;
export const MAXIMUM_BROWSER_BATCH_REQUESTS_V1 = 256;
export const MAXIMUM_BROWSER_PENDING_REQUESTS_V1 = 256;

export enum BrowserExecutionModeV1 {
  LEGACY_TYPESCRIPT = "LEGACY_TYPESCRIPT",
  TYPESCRIPT_WITH_RUST_SHADOW = "TYPESCRIPT_WITH_RUST_SHADOW",
  RUST_LOCAL_AUTHORITY = "RUST_LOCAL_AUTHORITY",
  RUST_STAGING_AUTHORITY = "RUST_STAGING_AUTHORITY",
  RUST_PRODUCTION_AUTHORITY = "RUST_PRODUCTION_AUTHORITY",
  RUST_CANARY_AUTHORITY = "RUST_CANARY_AUTHORITY",
  RUST_SHADOW_SAMPLE = "RUST_SHADOW_SAMPLE",
  LEGACY_TRANSITION = "LEGACY_TRANSITION",
}

export type BrowserLifecycleEventV1 =
  | { kind: "VISIBILITY_CHANGED"; value: "HIDDEN" | "VISIBLE" }
  | { kind: "PAGE_HIDDEN" }
  | { kind: "PAGE_SHOWN" }
  | { kind: "PAGE_FREEZE" }
  | { kind: "PAGE_RESUME" }
  | { kind: "BEFORE_UNLOAD" }
  | { kind: "NETWORK_ONLINE" }
  | { kind: "NETWORK_OFFLINE" };

export type PhysicalKeyV1 =
  | { kind: "ARROW_UP" | "ARROW_DOWN" | "ARROW_LEFT" | "ARROW_RIGHT" }
  | { kind: "ENTER" | "SPACE" | "ESCAPE" | "BACKSPACE" }
  | { kind: "KEY_A" | "KEY_B" | "KEY_C" | "KEY_D" | "KEY_E" | "KEY_F" }
  | { kind: "KEY_N" | "KEY_R" | "KEY_T" }
  | { kind: "UNKNOWN"; value: string };

export type RawInputEventV1 =
  | {
      kind: "KEY_DOWN";
      data: {
        code: PhysicalKeyV1;
        printable: boolean;
        browser_repeat: boolean;
        focus: "GAME" | "TEXT_ENTRY";
      };
    }
  | { kind: "KEY_UP"; data: { code: PhysicalKeyV1 } }
  | { kind: "GAMEPAD_DOWN"; data: { button: number } }
  | { kind: "GAMEPAD_UP"; data: { button: number } }
  | { kind: "FOCUS_CHANGED"; data: "GAME" | "TEXT_ENTRY" }
  | { kind: "WINDOW_BLURRED" }
  | { kind: "WINDOW_FOCUSED" };

export interface BrowserInitV1 {
  mode: BrowserExecutionModeV1;
  execution_identity_bytes: number[];
  session_start_bytes: number[];
  maximum_pending_requests: number;
  production_release_id?: string;
  production_generation?: number;
}

export type BrowserRequestV1 =
  | { kind: "INITIALIZE"; value: BrowserInitV1 }
  | { kind: "RAW_INPUT"; value: RawInputEventV1 }
  | { kind: "ADVANCE_TIME"; value: number }
  | { kind: "TIMER_WAKEUP"; value: { monotonic_micros: number } }
  | { kind: "NETWORK_FRAME"; value: { generation: number; bytes: number[] } }
  | { kind: "TRANSPORT_CHANGED"; value: { generation: number; connected: boolean } }
  | { kind: "STORAGE_RESULT"; value: { request_id: number; bytes: number[] } }
  | {
      kind: "PRESENTATION_SETTLED";
      value: { event_id: string; outcome: "SETTLED" | "INTENTIONALLY_SKIPPED" | "FAILED" };
    }
  | { kind: "LIFECYCLE"; value: BrowserLifecycleEventV1 }
  | { kind: "OBSERVE"; value: { profile: string } }
  | { kind: "SNAPSHOT" }
  | { kind: "EXPORT_REPRO" }
  | { kind: "DISPOSE" };

export interface BrowserRequestEnvelopeV1 {
  version: 1;
  request_id: number;
  sequence: number;
  request: BrowserRequestV1;
}

export type BrowserEffectV1 =
  | { kind: "UI_CHANGED"; value: number[] }
  | { kind: "PRESENTATION"; value: number[] }
  | { kind: "PRESENTATION_SCENE_CHANGED"; value: number[] }
  | { kind: "SEND_NETWORK_FRAME"; value: { generation: number; bytes: number[] } }
  | { kind: "STORAGE_REQUEST"; value: number[] }
  | { kind: "ASSET_REQUEST"; value: number[] }
  | { kind: "AUDIO_CUE"; value: number[] }
  | { kind: "TERMINAL"; value: number[] }
  | { kind: "TELEMETRY"; value: number[] }
  | { kind: "REPRO_READY"; value: number[] };

export interface BrowserEffectBatchV1 {
  external_sequence: number;
  effects: BrowserEffectV1[];
  observation_bytes: number[];
  next_wakeup_micros: number | null;
}

export interface BrowserKernelFaultV1 {
  code: string;
  message: string;
  normalized_panic: string | null;
  repro_reference: string | null;
}

export type BrowserResponseV1 =
  | { kind: "READY"; value: { identity_bytes: number[] } }
  | { kind: "EFFECTS"; value: BrowserEffectBatchV1 }
  | { kind: "OBSERVATION"; value: number[] }
  | { kind: "SNAPSHOT"; value: number[] }
  | { kind: "REPRO"; value: number[] }
  | { kind: "FAULT"; value: BrowserKernelFaultV1 }
  | { kind: "DISPOSED" };

export interface BrowserResponseEnvelopeV1 {
  version: 1;
  request_id: number;
  accepted_sequence: number;
  after_mechanical_digest: string;
  response: BrowserResponseV1;
}

export function isSafeBrowserInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
