export const BROWSER_WORKER_PROTOCOL_VERSION_V2 = 2 as const;

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
  | { kind: "REPRO_READY"; snapshot: unknown };

export interface BrowserEffectBatchV2 {
  external_sequence: number;
  effects: BrowserEffectV2[];
}
