/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PLAYER TELEMETRY SCHEMA v1 (#player-telemetry). PURE TYPES + version constant, zero runtime.
//
// The telemetry pipeline captures every player DECISION as a semantic event stream, in ALL modes
// (solo / co-op / showdown), for one purpose: TRAINING A COMBAT AI on how real players play. So the
// schema is built as (STATE, ACTION) pairs from day one: a `TelemetryBattleDecision` carries BOTH the
// full both-sides field STATE and the ACTION the player took, so each battle decision is reconstructable
// as a supervised training example WITHOUT joining any external data.
//
// The full design + ML framing lives in `docs/plans/player-telemetry-schema-v1.md`.
//
// Design bars mirrored from the replay recorder (`replay-trace.ts` / `replay-recorder.ts`): pure types,
// small shallow objects, numbers/ids (not display strings) wherever a stable id exists, additive
// versioning (bump {@link TELEMETRY_SCHEMA_VERSION} on an incompatible shape change).
// =============================================================================

/** Bump on an incompatible wire-shape change. Stamped into every session envelope + the R2 object metadata. */
export const TELEMETRY_SCHEMA_VERSION = 1;

/** Which broad game mode a session was played in (partitions the dataset for training). */
export type TelemetryMode = "solo" | "coop" | "showdown";

/** In co-op, whether a captured surface / decision belongs to THIS client or the OBSERVED partner. */
export type TelemetryActor = "self" | "partner";

/**
 * One move on a mon, featurized for ML. Ids are numeric (stable across builds); the trainer maps a move
 * id to its attribute vector offline. `type`/`power` are included so an attribute-based featurization
 * (represent a move by its properties, not its id) is possible directly from the capture.
 */
export interface TelemetryMoveState {
  /** {@link MoveId} value. */
  move: number;
  /** {@link PokemonType} value of the move. */
  type: number;
  /** Base power (0 for status). */
  power: number;
  /** PP already spent. */
  ppUsed: number;
  /** Max PP (incl. PP Ups). */
  maxPp: number;
}

/**
 * One field mon's ML STATE snapshot: everything the model needs to reason about it, self-contained. Ids
 * are numeric; the ER FOUR-ability model is captured as the active {@link ability} plus the {@link innates}
 * set (up to 3 innate/passive slots), so ER-custom content is fully represented.
 */
export interface TelemetryMonState {
  /** {@link SpeciesId} value. */
  species: number;
  /** Form index (mega / regional / ER-custom form). */
  form: number;
  level: number;
  /** Current HP (absolute). */
  hp: number;
  /** Max HP (so the trainer can derive hp%). */
  maxHp: number;
  /** {@link StatusEffect} value, or null when healthy. */
  status: number | null;
  /** The 7 stat stages (atk/def/spatk/spdef/spd/acc/eva), each -6..+6. */
  statStages: number[];
  /** Active {@link AbilityId}. */
  ability: number;
  /** ER innate/passive ability set ({@link AbilityId} per slot; null = empty slot). */
  innates: (number | null)[];
  /** Held-item type ids on this mon ({@link ModifierType} id strings). */
  heldItems: string[];
  /** The mon's moveset, featurized. */
  moves: TelemetryMoveState[];
  /** True when this mon is the active battler on its slot. */
  active: boolean;
  /** True when fainted (hp 0). */
  fainted: boolean;
  /** In co-op, which player owns this (player-side) mon; omitted outside co-op / for enemy mons. */
  actor?: TelemetryActor;
}

/**
 * The full both-sides field STATE at a decision/outcome point - the "state" half of a (state, action)
 * training pair. Captures the whole observable position so a decision needs no external join.
 */
export interface TelemetryBattleState {
  wave: number;
  /** {@link BiomeId} value. */
  biome: number;
  turn: number;
  /** {@link WeatherType} value, or null. */
  weather: number | null;
  /** {@link TerrainType} value, or null. */
  terrain: number | null;
  /** The active player-side field mons. */
  player: TelemetryMonState[];
  /** The active enemy-side field mons. */
  enemy: TelemetryMonState[];
}

/** The ACTION half of a (state, action) pair: the decision the player committed for one field slot. */
export type TelemetryBattleAction =
  | { kind: "move"; moveIndex: number; moveId: number; target?: number }
  | { kind: "switch"; partyIndex: number }
  | { kind: "ball"; ballIndex: number }
  | { kind: "run" };

/** Base fields on every event (the temporal + spatial anchor for the ML pipeline). */
interface TelemetryEventBase {
  /** Epoch ms at capture. */
  t: number;
  /** Wave the event occurred on. */
  wave: number;
}

/**
 * A BATTLE DECISION: the (state, action) training pair. `state` is the whole field at decision time;
 * `action` is what the player did for `slotFieldIndex`. Self-contained + supervised-learning-ready.
 */
export interface TelemetryBattleDecisionEvent extends TelemetryEventBase {
  kind: "battle_decision";
  /** self = this client's own command; partner = the observed co-op partner's command. */
  actor: TelemetryActor;
  /** The player field slot this decision is for (0 = lead / host lead, 1 = 2nd slot / guest lead). */
  slotFieldIndex: number;
  state: TelemetryBattleState;
  action: TelemetryBattleAction;
}

/** A per-turn OUTCOME snapshot (the resolved field after a turn), so state transitions are learnable. */
export interface TelemetryTurnOutcomeEvent extends TelemetryEventBase {
  kind: "turn_outcome";
  turn: number;
  state: TelemetryBattleState;
  /** Field slots that fainted this turn (`p{index}` for player, `e{index}` for enemy). */
  faints: string[];
}

/** An interactive SURFACE opened (a menu / option list): its id + the option labels offered. */
export interface TelemetrySurfaceOpenEvent extends TelemetryEventBase {
  kind: "surface_open";
  /** {@link UiMode} numeric value. */
  uiMode: number;
  /** {@link UiMode} name (e.g. "MODIFIER_SELECT"). */
  uiModeName: string;
  /** The option labels offered (when the surface is an option list; empty for bespoke surfaces). */
  options: string[];
  actor: TelemetryActor;
}

/** An option CHOSEN on a surface: which option index/label was committed. */
export interface TelemetrySurfaceChoiceEvent extends TelemetryEventBase {
  kind: "surface_choice";
  uiMode: number;
  uiModeName: string;
  chosenIndex: number;
  chosenLabel: string;
  actor: TelemetryActor;
}

/** A raw INPUT event as a compact code (cheap; the low-level signal). */
export interface TelemetryInputEvent extends TelemetryEventBase {
  kind: "input";
  /** Compact button/key code ({@link Button} value). */
  code: number;
  /** The {@link UiMode} the input was delivered to (context). */
  uiMode: number;
}

/** One captured telemetry event (the ordered stream). */
export type TelemetryEvent =
  | TelemetryBattleDecisionEvent
  | TelemetryTurnOutcomeEvent
  | TelemetrySurfaceOpenEvent
  | TelemetrySurfaceChoiceEvent
  | TelemetryInputEvent;

/**
 * The per-session ENVELOPE, captured once at session start. Carries the PSEUDONYMOUS player id (a hash of
 * the account id + a server salt - NEVER the raw username/email), the build id, the mode, the run seed, and
 * the schema version, so a stored batch is self-describing for the ML pipeline.
 */
export interface TelemetrySessionEnvelope {
  schemaVersion: number;
  /** Random per-session id (also the R2 key's `{sessionId}` segment). */
  sessionId: string;
  /** Pseudonymous, stable-per-account player id: hash(accountId + serverSalt). No raw username. */
  playerIdHash: string;
  /** Client build (package.json version). */
  build: string;
  /** ER mod version (player-facing). */
  erVersion: string;
  mode: TelemetryMode;
  /** {@link GameModes} value. */
  gameModeId: number;
  /** Run RNG seed. */
  seed: string;
  /** ER difficulty ("youngster" | "ace" | "elite" | "hell" | "mystery"). */
  difficulty: string;
  /** Epoch ms at session start. */
  startedAt: number;
  /** Optional user-agent (coarse client info; no PII). */
  ua?: string;
}

/** One uploaded batch: the session envelope + a run of ordered events. Serialized, compressed, POSTed. */
export interface TelemetryBatch {
  envelope: TelemetrySessionEnvelope;
  /** Monotonic per-session batch sequence (the R2 key's `{seq}` segment). */
  seq: number;
  events: TelemetryEvent[];
}
