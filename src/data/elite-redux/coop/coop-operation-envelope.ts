/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op AUTHORITATIVE OPERATION ENVELOPE (Wave-2 authoritative run-state migration;
// see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §1).
//
// The envelope is the single authoritative CONTROL+DATA unit the host broadcasts on
// every commit. It is a strict SUPERSET of today's turnResolution / waveEndState
// payload: the existing `authoritativeState` (the DATA plane) becomes ONE field of it
// (§1.2), so an older client that only reads `authoritativeState` keeps working during
// migration. The NEW work is the four CONTROL fields (sessionEpoch, revision,
// logicalPhase, pendingOperation) - the mon serialization is untouched.
//
// This module is PURE TYPES + tiny pure helpers (id mint/parse + closed-union guards);
// it has zero engine/transport dependency so the lifecycle is unit-testable headlessly
// (exactly like coop-interaction.ts). The runtime that drives ops through the lifecycle
// lives in coop-operation-runtime.ts; the wire delivery + surface wiring is layered on
// top and is individually flag-gated (§5).
// =============================================================================

import type { CoopAuthoritativeBattleStateV1, CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";

/** A co-op player seat id (0..N-1). The host/authority is a specific id, conventionally 0. */
export type CoopPlayerId = number;

/** The monotonic session identity. Bumps ONLY on a hard control-plane reset (§1.4). */
export type CoopSessionEpoch = number;

/** Per-committed-operation monotonic revision within an epoch (§1.5). Never resets except on epoch bump. */
export type CoopRevision = number;

/**
 * Globally unique id for one operation, minted by the PROPOSER (host or guest) (§1.3, §1.8):
 * `${epoch}:${owner}:${kind}:${pinnedSeq}`. Unique WITHOUT a host round-trip, and it embeds its epoch so
 * the idempotency + late-rejection machinery (§1.6) is structural, not per-call-site.
 */
export type CoopOperationId = string;

/**
 * The logical run phase - the authoritative control-plane position. The host STATES this; the guest
 * ADOPTS it and never infers it from a one-bit outcome (§1.1). CLOSED union: an unknown value on the
 * guest FAILS CLOSED (§1.7), it does not fall back to running a local phase.
 */
export type CoopLogicalPhase =
  | "COMMAND" // awaiting battle commands (CommandPhase / TurnStartPhase)
  | "TURN_RESOLVE" // host resolving a turn; guest renders (CoopReplayTurnPhase)
  | "WAVE_VICTORY" // wave won/captured; VictoryPhase tail
  | "WAVE_FLEE" // fled; BattleEnd -> NewBattle tail
  | "GAME_OVER" // run lost; GameOverPhase
  | "REWARD_SELECT" // between-wave reward shop (UiMode.MODIFIER_SELECT)
  | "BIOME_SELECT" // ER map / crossroads route choice
  | "MYSTERY_ENCOUNTER" // ME option/battle handoff
  | "SHOP" // biome market / black market / exotic / bazaar
  | "INTERACTION" // any other runCoopInteraction-driven shared screen
  | "IDLE"; // no pending control transition

/** The lifecycle status of the ONE in-flight operation (§1.3). Terminal: applied/rejected/superseded. */
export type CoopOperationStatus = "proposed" | "committed" | "applied" | "rejected" | "superseded";

/**
 * WHAT an operation is - the migrated successor of today's relay `kind` (coop-seq-registry.ts).
 * ONE closed union; an unknown kind on the guest FAILS CLOSED (§1.7, §4.5). The full table is the
 * §2 inventory so every later surface reuses this union unchanged; Wave-2a only WIRES the two
 * biome-travel kinds (BIOME_PICK, CROSSROADS_PICK) - the rest are declared for the migration order.
 */
export type CoopOperationKind =
  // --- Wave-2a: biome travel (§2.1 #14/#15, BIOME_SELECT) ---
  | "BIOME_PICK" // World-Map / single-node biome travel (#15)
  | "CROSSROADS_PICK" // crossroads Stay/Leave route choice (#14)
  // --- Later waves (declared for the closed union; not wired in Wave-2a) ---
  | "REWARD" // reward shop pick/skip/reroll/etc (#1, REWARD_SELECT)
  | "SHOP_BUY" // biome/black-market/exotic/bazaar buy (#5, SHOP)
  | "FAINT_SWITCH" // faint replacement / voluntary switch (#2)
  | "REVIVAL" // revival blessing target (#3)
  | "ABILITY_PICK" // ability capsule pick (#4)
  | "BARGAIN" // Giratina bargain (#6)
  | "COLO_PICK" // colosseum board pick (#7)
  | "ME_PRESENT" // ME presentation handoff (#8)
  | "ME_PICK" // ME option select (#8)
  | "ME_SUB" // ME sub-prompt (#8)
  | "ME_BUTTON" // ME button press (#8)
  | "ME_TERMINAL" // ME terminal LEAVE/handoff (#10)
  | "QUIZ_ANSWER" // ER quiz answer (#9)
  | "LEARN_MOVE" // learn-move accept/decline (#11)
  | "LEARN_MOVE_BATCH" // batch level-up learn panel (#12)
  | "STORMGLASS" // one-time weather pick (#16)
  | "CATCH_FULL" // wild-catch full-party release (#17)
  // --- Wave-2f: the KEYSTONE post-battle wave-advance tail (§2.5 item 4, not a relay kind) ---
  | "WAVE_ADVANCE"; // the host-stated between-wave transition the guest constructs its tail FROM (the keystone)

/** A single unit of shared-run mutation moving through the lifecycle (§1.3). */
export interface CoopPendingOperation {
  /** Globally-unique id (proposer-minted). Idempotency key component (§1.6). */
  readonly id: CoopOperationId;
  /** WHAT this operation is - the migrated successor of the relay `kind`. Unknown kinds fail closed (§1.7). */
  readonly kind: CoopOperationKind;
  /** The player seat that DRIVES/PROPOSES it (0..N-1). Successor of the interaction-counter owner rule (§1.8). */
  readonly owner: CoopPlayerId;
  /** Current lifecycle state. */
  readonly status: CoopOperationStatus;
  /**
   * The typed INTENT (guest->host, invariant 2) or committed outcome (host->guest, invariant 4).
   * Serializable; the successor of the relay choice/outcome payload. Narrowed per-kind by the guards below.
   */
  readonly payload: unknown;
  /**
   * Why the op was rejected, present ONLY when status === "rejected" (§1.3). Lets the proposer surface a
   * safe default and the diagnostics log the cause. Absent on every non-rejected status.
   */
  readonly rejectReason?: string;
}

/** The single authoritative control+data unit the host broadcasts every commit (§1.1). */
export interface CoopAuthoritativeEnvelopeV1 {
  readonly version: 1;
  readonly sessionEpoch: CoopSessionEpoch;
  readonly revision: CoopRevision;
  readonly wave: number; // successor of CoopAuthoritativeBattleStateV1.wave
  readonly turn: number; // successor of CoopAuthoritativeBattleStateV1.turn
  readonly logicalPhase: CoopLogicalPhase;
  /** The one in-flight operation, or null when the control plane is quiescent. */
  readonly pendingOperation: CoopPendingOperation | null;
  /** The existing authoritative DATA plane, embedded UNCHANGED (§1.2). */
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
}

// -----------------------------------------------------------------------------
// Per-kind payload shapes (the discriminated map §1.1 references). Wave-2a defines the
// two biome-travel payloads; later surfaces add their own. All are plain-JSON serializable.
// -----------------------------------------------------------------------------

/** BIOME_PICK intent/outcome: the chosen biome + the route-node index the owner travelled to (#15/#865). */
export interface CoopBiomePickPayload {
  /** The biome the committed transition leaves. Guards a delayed pick from authorizing a later boundary. */
  readonly sourceBiomeId: number;
  /** The BiomeId the owner chose to travel to. */
  readonly biomeId: number;
  /**
   * The index into the routing pending-node set (getErPendingNodes) the owner picked, or -1 for the
   * natural single-node terminal (#865 - the World-Map auto-travel path with exactly one destination).
   */
  readonly nodeIndex: number;
  /** The first wave in the committed destination biome. */
  readonly nextWave: number;
}

/** CROSSROADS_PICK intent/outcome: the crossroads option index the owner chose (Stay/Leave, #14). */
export interface CoopCrossroadsPickPayload {
  /** The crossroads option index the owner selected (0 = Stay, 1 = Leave, per the phase's option order). */
  readonly optionIndex: number;
}

/**
 * REWARD intent/outcome (Wave-2d, #1, REWARD_SELECT): one relayed reward-screen ACTION. Unlike biome
 * travel (one pick per interaction), the reward shop relays a STREAM of actions on the same pinned
 * interaction until a terminal (skip/leave, or a non-continuation reward grab). Each action - a reward
 * pick, a shop buy, a reroll, a lock, a transfer, a Check-Team op - is ONE operation. A NESTED sub-pick
 * (party target slot / TM move slot / ability slot / fusion pair) is folded into THIS payload's `data`
 * (a "multi-step op payload", §8.2 Wave-2d) - it is NOT a separate sub-operation: the reward shop already
 * collapses the party-target menu into the single terminal relay this operation carries.
 */
export interface CoopRewardActionPayload {
  /** The wire `label` the legacy relay sent this action with (reward/shop/skip/reroll/check/transfer/lock). */
  readonly label: string;
  /** The picked option/cursor index, or a sentinel (COOP_INTERACTION_LEAVE = -1 / _REROLL = -2). */
  readonly choice: number;
  /** The relay `data` array (the act-code + any resolved sub-pick indices), verbatim; undefined when none. */
  readonly data: number[] | undefined;
  /** True iff this action LEAVES the interaction for good (skip / leave) - the late-after-leave watermark trigger. */
  readonly terminal: boolean;
}

/**
 * SHOP_BUY intent/outcome (Wave-2d, #5, SHOP): one relayed biome-market (BiomeShop / BlackMarket / Exotic /
 * ImportBazaar) action - a buy (slot into the streamed stock + resolved party target + post-buy money) or
 * the LEAVE terminal. Shares the reward shop's multi-action stream shape; the biome market pins on
 * coopBiomeStart (the same monotonic interaction counter the reward shop pins coopInteractionStart on).
 */
export interface CoopShopBuyPayload {
  /** The bought slot into the owner-streamed stock, or COOP_INTERACTION_LEAVE (-1) for the market terminal. */
  readonly slot: number;
  /** The relay `data` array ([targetPartySlot, moneyAfter] for a buy), verbatim; undefined when none. */
  readonly data: number[] | undefined;
  /** True iff this action LEAVES the market for good - the late-after-leave watermark trigger. */
  readonly terminal: boolean;
}

/** BARGAIN outcome: the host-stated full run-state blob applied by the watcher verbatim. */
export interface CoopBargainPayload {
  readonly outcome: CoopInteractionOutcome;
}

/** COLO_PICK stream: repeated host-stated boards and owner decisions within one pinned gauntlet. */
export type CoopColosseumPayload =
  | { readonly type: "board"; readonly round: number; readonly labels: string[] }
  | { readonly type: "decision"; readonly round: number; readonly index: number };

/** ABILITY_PICK outcome: literal operation code and resolved slots/ability id. */
export interface CoopAbilityPickPayload {
  readonly data: number[];
}

/** FAINT_SWITCH intent: exact owner-selected party slot plus legacy baton/species identity metadata. */
export interface CoopFaintSwitchPayload {
  readonly fieldIndex: number;
  readonly partySlot: number;
  readonly data: number[];
}

/** REVIVAL control stream: host prompt followed by the host-resolved owner decision. */
export type CoopRevivalPayload =
  | { readonly type: "prompt"; readonly fieldIndex: number }
  | {
      readonly type: "decision";
      readonly fieldIndex: number;
      readonly partySlot: number;
      readonly speciesId: number;
    };

/** Wild-catch full-party presentation followed by the host-resolved owner decision. */
export type CoopCatchFullPayload =
  | { readonly type: "prompt"; readonly pokemonName: string; readonly speciesId: number }
  | { readonly type: "decision"; readonly speciesId: number; readonly partySlot: number };

/** Host-resolved one-time Stormglass weather selection. */
export interface CoopStormglassPayload {
  readonly weatherIndex: number;
  readonly weather: number;
}

export type CoopLearnMovePayload =
  | { readonly type: "prompt"; readonly partySlot: number; readonly moveId: number; readonly maxMoveCount: number }
  | {
      readonly type: "decision";
      readonly partySlot: number;
      readonly moveId: number;
      readonly forgetSlot: number;
      readonly maxMoveCount: number;
    };

export type CoopLearnMoveBatchPayload =
  | {
      readonly type: "prompt";
      readonly partySlot: number;
      readonly learnableIds: number[];
      readonly ownerIsGuest: boolean;
    }
  | {
      readonly type: "decision";
      readonly partySlot: number;
      readonly assignments: [number, number][];
      readonly fallback: boolean;
    };

// -----------------------------------------------------------------------------
// Wave-2c: mystery-encounter payloads (§2.1 #8/#9/#10, MYSTERY_ENCOUNTER phase). The ME surface is
// owner-alternated with the choice-forwarding model (#693: the guest never runs the encounter
// engine); each ME decision the owner makes becomes one typed operation. The kinds (ME_PRESENT /
// ME_PICK / ME_SUB / ME_BUTTON / ME_TERMINAL / QUIZ_ANSWER) are already in the closed union above.
// -----------------------------------------------------------------------------

/**
 * The terminal RESOLUTION of a mystery encounter (#859/#860/#862). The host STATES this on the
 * committed ME_TERMINAL op so the WATCHER routes its terminal deterministically off the operation
 * (leave the encounter vs boot the spawned battle) instead of INFERRING "there is a battle turn"
 * from a leftover battle chain (the #859/#860 phantom-turn class this migration makes structurally
 * impossible - the committed op states the outcome/type BEFORE the watcher builds phases).
 */
export type CoopMeTerminalKind =
  | "leave" // the ME ended (non-battle): the watcher leaves the encounter + advances the alternation
  | "battle" // an option spawned a battle: the watcher finishes WITHOUT leaving (the battle runs host-authoritative)
  | "battle-settled"; // that battle's post-BattleEnd image is retained and its reward tail is executable

/** Durable control sentinel for the ME battle-settled terminal; never carried as a raw input choice. */
export const COOP_ME_BATTLE_SETTLED_CHOICE = -1001;

/** Exact host-authored continuation opened after the terminal state image has been adopted. */
export type CoopMeTerminalDestination =
  | {
      readonly kind: "battle";
      /** Host turn-space at the instant the spawned battle becomes executable. */
      readonly hostTurn: number;
      /** Exact {@linkcode MysteryEncounterMode}; the guest must never infer it from its reconstructed party. */
      readonly encounterMode: number;
      /** Constructor argument for the host's `MysteryEncounterBattlePhase`. */
      readonly disableSwitch: boolean;
    }
  | {
      readonly kind: "continue";
      /** Exact next wave expected after this encounter. Guards a late terminal from advancing a newer wave. */
      readonly nextWave: number;
      /** Whether `SelectBiomePhase` precedes `NewBattlePhase` at this boundary. */
      readonly selectBiome: boolean;
    }
  | {
      readonly kind: "reward";
      /** Exact battle turn whose post-BattleEnd image this transaction settles. */
      readonly hostTurn: number;
      /** Host-stated battle result; the renderer never infers it from its reconstructed field. */
      readonly result: "victory" | "failure";
      /** Exact executable continuation after the settled BattleEnd. */
      readonly continuation: "rewards" | "encounter" | "none";
      /** Whether the deterministic trainer-victory presentation precedes the reward phase. */
      readonly trainerVictory: boolean;
      /** Whether a reward-less healing shop is requested. Meaningful only for `rewards`. */
      readonly addHeal: boolean;
      /** Whether EggLapsePhase follows this encounter's reward phase. Meaningful only for `rewards`. */
      readonly eggLapse: boolean;
    };

/** ME_PICK intent/outcome: the top-level option index the ME owner selected (#8, guest->host forward). */
export interface CoopMePickPayload {
  /** The option index the owner chose in the ME selector. */
  readonly optionIndex: number;
}

/** ME_SUB intent/outcome: a sub-prompt pick (party target slot / secondary menu index / catch-full slot, #855). */
export interface CoopMeSubPayload {
  /** The captured sub-pick value (a party slot index, a secondary-menu index, or a catch-full replace slot). */
  readonly value: number;
}

/** ME_BUTTON intent/outcome: one meaningful owner button press relayed to the watcher (#633 pump). */
export interface CoopMeButtonPayload {
  /** The button code the owner pressed (a Button enum value). */
  readonly button: number;
}

/** ME_PRESENT intent/outcome: the host's presentation-handoff ack (#8, host-authoritative ME presence verdict, #862). */
export interface CoopMePresentPayload {
  /** Whether the host has an ME this wave (the #862 host-authoritative presence verdict; false = the guest self-rolled a phantom). */
  readonly present: boolean;
  /** Exact host-rendered presentation. Required when `present` is true so journal replay never re-derives from guest state. */
  readonly presentation?: Extract<CoopInteractionOutcome, { k: "mePresent" }>;
}

/**
 * ME_TERMINAL transaction: one retained host state image plus the exact executable destination (#10).
 * Both variants are complete. In particular a battle handoff may not delegate DATA to a separately timed
 * party/raw terminal carrier: the guest adopts `outcome` first, then opens `destination`, exactly once.
 */
export type CoopMeTerminalPayload =
  | {
      /** The option spawned a battle. */
      readonly terminal: "battle";
      /** Comprehensive post-effect state, including the generated/degraded battle party. */
      readonly outcome: Extract<CoopInteractionOutcome, { k: "meResync" }>;
      /** Exact battle boot, causally bound to the state image above. */
      readonly destination: Extract<CoopMeTerminalDestination, { kind: "battle" }>;
    }
  | {
      /** The spawned battle reached its exact post-BattleEnd reward boundary. */
      readonly terminal: "battle-settled";
      /** Comprehensive state after every automatic BattleEnd mutation. */
      readonly outcome: Extract<CoopInteractionOutcome, { k: "meResync" }>;
      /** Exact deterministic reward presentation opened from that state. */
      readonly destination: Extract<CoopMeTerminalDestination, { kind: "reward" }>;
    }
  | {
      /** The encounter reached its true final leave (directly or after a spawned battle). */
      readonly terminal: "leave";
      /** Comprehensive post-effect/final reward/material state. */
      readonly outcome: Extract<CoopInteractionOutcome, { k: "meResync" }>;
      /** Exact between-wave continuation, causally bound to the state image above. */
      readonly destination: Extract<CoopMeTerminalDestination, { kind: "continue" }>;
    };

/** QUIZ_ANSWER intent/outcome: one committed answer of an embedded ME quiz minigame (#9/#818). */
export interface CoopQuizAnswerPayload {
  /** The 0-based question index this answer is for (per-question, order-proof, #818). */
  readonly questionIndex: number;
  /** The committed answer choice index. */
  readonly choice: number;
}

// -----------------------------------------------------------------------------
// Wave-2f: the KEYSTONE wave-advance payload (§2.5 item 4, WAVE_ADVANCE). This is NOT a relay kind -
// it is the guest-constructed post-battle tail (coop-replay-phases.ts:1139-1212) migrated onto the
// operation model. The host STATES the complete between-wave transition; the guest ADOPTS the committed
// op and constructs the SAME phases (VictoryPhase / TrainerVictoryPhase / BattleEndPhase / NewBattlePhase
// / SelectBiomePhase / GameOverPhase) by ADOPTION instead of DERIVATION. Committing this makes
// logicalPhase host-authoritative for the between-wave transition - the keystone that lets §3's renderer
// allowlist stop DENYING the boundary tails and start OP-SANCTIONING them (§3 strict-tails). The DATA
// plane rides inside the retained P33 envelope as the settled post-BattleEnd state image. The raw
// waveResolved/waveEndState arms remain negotiated legacy/presentation carriers only.
// -----------------------------------------------------------------------------

/**
 * The victory KIND for a win/capture wave-advance (§2.5 item 4): a WILD battle vs a TRAINER battle. The
 * host STATES it (already host-authoritative per #867's battleType verdict); it drives whether the guest's
 * VictoryPhase tail cascades into TrainerVictoryPhase (the trainer-win tail, #633). Absent for flee/gameOver.
 */
export type CoopWaveVictoryKind = "wild" | "trainer";

/**
 * The MYSTERY-ENCOUNTER boundary this wave-advance crosses, if any (#847). "none" = an ordinary battle
 * wave; "battle-victory" = an ME-spawned battle the host won, whose victory tail the guest routes off the
 * ME channel (queueCoopMeBattleVictoryTail) rather than the standard wave tail. Stating it on the op means
 * the guest never INFERS "there is an ME battle turn" from a leftover chain (the #859/#860 phantom class).
 */
export type CoopWaveMeBoundary = "none" | "battle-victory";

/**
 * WAVE_ADVANCE intent/outcome (Wave-2f KEYSTONE, §2.5 item 4): the host-STATED complete post-battle
 * transition off which the guest constructs its wave-end tail (coop-replay-phases.ts:1139-1212), instead
 * of DERIVING it from a one-bit `waveResolved.outcome`. The host commits this at its own wave-end (where
 * waveResolved/waveEndState are already emitted); the guest adopts the committed op and selects the SAME
 * tail phases BY the op's stated transition. All fields are plain-JSON serializable.
 */
export interface CoopWaveAdvancePayload {
  /** The wave that RESOLVED (the operation pin + the double-advance guard key, successor of lastResolvedWave). */
  readonly wave: number;
  /** The battle OUTCOME the host resolved (the successor of CoopWaveOutcome: win/capture/flee/gameOver). */
  readonly outcome: "win" | "capture" | "flee" | "gameOver";
  /** The logical phase the run transitions INTO (host-stated; the guest ADOPTS, never infers - §1.1). */
  readonly nextLogicalPhase: CoopLogicalPhase;
  /** The wave index the run advances TO (wave + 1 for a normal advance; == wave on a game-over). */
  readonly nextWave: number;
  /** Whether the transition crosses a BIOME boundary (drives SelectBiomePhase / references the biome ops, #863/#864). */
  readonly biomeChange: boolean;
  /** Whether an EGG-LAPSE fires on this advance (the guest's EggLapsePhase boundary tail). */
  readonly eggLapse: boolean;
  /** The ME-boundary this advance crosses, if any (#847); an ME-spawned battle victory routes its own tail. */
  readonly meBoundary: CoopWaveMeBoundary;
  /** The victory kind for win/capture (wild vs trainer, drives TrainerVictoryPhase); absent for flee/gameOver. */
  readonly victoryKind?: CoopWaveVictoryKind;
  /**
   * Tick of the settled authoritativeState embedded in this exact retained envelope. Absent only on the
   * early raw waveResolved compatibility hint, which is deliberately insufficient to advance a P33 guest.
   * A journal receiver requires this value and exact equality with authoritativeState.tick before it may
   * stage DATA or make the stated continuation executable.
   */
  readonly settledStateTick?: number;
}

// -----------------------------------------------------------------------------
// Pure helpers: id mint/parse + closed-union guards. Zero engine dependency.
// -----------------------------------------------------------------------------

/**
 * Mint an operation id from its three components (§1.8): `${epoch}:${owner}:${pinnedSeq}`. `pinnedSeq`
 * is the interaction-counter value (or biome pin) the op was pinned at, so the id embeds BOTH its epoch
 * (cross-epoch rejection) AND the counter it advanced past (the peerAdvancedPastInteraction successor).
 */
export function makeCoopOperationId(
  epoch: CoopSessionEpoch,
  owner: CoopPlayerId,
  pinnedSeq: number,
  kind: CoopOperationKind,
): CoopOperationId {
  return `${epoch}:${owner}:${kind}:${pinnedSeq}`;
}

/** Parse an operation id back into its components, or null if it is not a well-formed id. */
export function parseCoopOperationId(
  id: CoopOperationId,
): { epoch: CoopSessionEpoch; owner: CoopPlayerId; kind: CoopOperationKind; pinnedSeq: number } | null {
  const parts = id.split(":");
  if (parts.length !== 4) {
    return null;
  }
  const epoch = Number(parts[0]);
  const owner = Number(parts[1]);
  const kind = parts[2];
  const pinnedSeq = Number(parts[3]);
  if (
    !Number.isInteger(epoch)
    || !Number.isInteger(owner)
    || !isKnownCoopOperationKind(kind)
    || !Number.isInteger(pinnedSeq)
  ) {
    return null;
  }
  return { epoch, owner, kind, pinnedSeq };
}

/** The closed set of logical phases the guest recognizes. A value outside it FAILS CLOSED (§1.7). */
const KNOWN_LOGICAL_PHASES: ReadonlySet<CoopLogicalPhase> = new Set<CoopLogicalPhase>([
  "COMMAND",
  "TURN_RESOLVE",
  "WAVE_VICTORY",
  "WAVE_FLEE",
  "GAME_OVER",
  "REWARD_SELECT",
  "BIOME_SELECT",
  "MYSTERY_ENCOUNTER",
  "SHOP",
  "INTERACTION",
  "IDLE",
]);

/** The closed set of operation kinds the guest recognizes. A value outside it FAILS CLOSED (§1.7). */
const KNOWN_OPERATION_KINDS: ReadonlySet<CoopOperationKind> = new Set<CoopOperationKind>([
  "BIOME_PICK",
  "CROSSROADS_PICK",
  "REWARD",
  "SHOP_BUY",
  "FAINT_SWITCH",
  "REVIVAL",
  "ABILITY_PICK",
  "BARGAIN",
  "COLO_PICK",
  "ME_PRESENT",
  "ME_PICK",
  "ME_SUB",
  "ME_BUTTON",
  "ME_TERMINAL",
  "QUIZ_ANSWER",
  "LEARN_MOVE",
  "LEARN_MOVE_BATCH",
  "STORMGLASS",
  "CATCH_FULL",
  "WAVE_ADVANCE",
]);

/** True iff `phase` is a logical phase the guest recognizes (else it must fail closed, §1.7). */
export function isKnownCoopLogicalPhase(phase: string): phase is CoopLogicalPhase {
  return KNOWN_LOGICAL_PHASES.has(phase as CoopLogicalPhase);
}

/** True iff `kind` is an operation kind the guest recognizes (else it must fail closed, §1.7). */
export function isKnownCoopOperationKind(kind: string): kind is CoopOperationKind {
  return KNOWN_OPERATION_KINDS.has(kind as CoopOperationKind);
}

/** True iff `status` is one of the three TERMINAL states (applied/rejected/superseded, §1.3). */
export function isTerminalCoopOperationStatus(status: CoopOperationStatus): boolean {
  return status === "applied" || status === "rejected" || status === "superseded";
}
