/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RELAY SUB-PROTOCOL REGISTRY (#840). The single source of truth for every
// `interactionChoice` / `interactionOutcome` seq BAND and every `kind` string
// that rides the CoopInteractionRelay.
//
// WHY THIS EXISTS (structural-gaps audit H4): the relay routes purely by numeric
// `seq`; the `kind` string is advisory (never compared by an awaiter). The bands
// were scattered, unregistered conventions (14 constants across ~10 files, the ME
// pump base re-declared in 4), so a NEW band could silently overlap an existing
// one and a NEW kind could ship with no awaiter - both are wire-desync generators
// that no build step caught. This module makes the bands a TOTAL, typed table so:
//   1. every band's numeric range is declared and the collision test
//      (test/tests/elite-redux/coop/coop-seq-registry.test.ts) proves the whole
//      set is pairwise disjoint at realistic magnitudes, and
//   2. every relay `kind` is enumerated and the kind-registry test proves every
//      sent kind is registered and rides a consumed band (the #820 wiring test,
//      one layer down).
//
// This module imports NOTHING (a leaf), so the existing call sites re-export their
// base constant FROM here (pure re-export, zero behavior change - the value now
// lives in exactly one place).
//
// THE #840 FIX ENCODED HERE: `COOP_LEARN_MOVE_SEQ` was `9_000_001`, which sits
// INSIDE the `COOP_ME_TERM_SEQ_BASE (9_000_000) + interactionCounter` band (it is
// reached at counter == 1). It was "safe" only by lifecycle separation (a level-up
// move-learn and an in-progress ME terminal never overlap in time) - a numeric
// near-collision the audit flagged. It is relocated to a free base (9_500_000,
// above every other band) so the disjointness is now STRUCTURAL, not temporal.
// Same-build convention: the send + await both read this one const, so moving the
// value moves both sites atomically (no protocol bump).
// =============================================================================

// ---------------------------------------------------------------------------
// Canonical base constants (single source of truth). Existing modules re-export
// these under their historical names so no call site changes behavior.
// ---------------------------------------------------------------------------

/** The raw interaction-counter reward channel (reward shop: reward/shop/skip/reroll/check/transfer/lock). */
export const COOP_REWARD_SEQ_BASE = 0;
/** Guest-owned faint-replacement picks: `BASE + fieldIndex` (#786). */
export const COOP_FAINT_SWITCH_SEQ_BASE = 90_000;
/** Revival owner-pick: `BASE + fieldIndex` (#809). */
export const COOP_REVIVAL_SEQ_BASE = 95_000;
/** Ability-picker owner/watcher relay: `BASE + interactionCounter`. */
export const COOP_ABILITY_SEQ_BASE = 6_000_000;
/** Biome market buy/leave relay: `BASE + pinnedStart` (ME interaction counter) (#673). */
export const COOP_BIOME_SHOP_SEQ_BASE = 7_000_000;
/** Giratina's Bargain outcome: `BASE + coopBargainStart` (#795). */
export const COOP_BARGAIN_SEQ_BASE = 7_500_000;
/** Colosseum board/pick relay: `BASE + pinnedCounter` (ME interaction counter) (#439). */
export const COOP_COLOSSEUM_SEQ_BASE = 7_600_000;
/** Mystery-encounter present/pick pump: `BASE + interactionCounter`. */
export const COOP_ME_PUMP_SEQ_BASE = 8_000_000;
/** Mystery-encounter quiz answers: `BASE + (counter % 2048) * 16 + (index % 16)` (bounded). */
export const COOP_ME_QUIZ_SEQ_BASE = 8_500_000;

/**
 * Address one question inside the currently pinned Mystery quiz. Keeping this
 * derivation beside the registered band lets both the UI relay and the
 * Authority V2 identity validator use the exact same collision-bounded address.
 */
export function coopQuizAnswerSeq(counter: number, index: number): number {
  return COOP_ME_QUIZ_SEQ_BASE + (counter % 2048) * 16 + (index % 16);
}
/** Mystery-encounter terminal (LEAVE / battle-handoff): `BASE + interactionCounter`. */
export const COOP_ME_TERM_SEQ_BASE = 9_000_000;
/**
 * Host->guest per-slot move-learn forward: `BASE + partySlot` (#633 BUG3+5). Disjoint from the
 * ME terminal (9M) and pump (8M) channels so a buffered forward never FIFO-collides.
 */
export const COOP_LEARN_MOVE_FWD_SEQ_BASE = 9_100_000;
/**
 * Host<->partner per-slot BATCH move-learn channel: `BASE + partySlot` (#848). Carries the host's
 * `learnMoveBatchForward` present (outcome) AND the owner's `learnMoveBatch` terminal (choice) for the
 * shared level-up Move Learn panel. Disjoint from the per-move forward (9_100_000) and dex-sync (9_200_000)
 * channels so a buffered batch present/terminal never FIFO-collides.
 */
export const COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE = 9_150_000;
/**
 * The every-5-waves CROSSROADS Stay/Leave owner-alternated pick: `BASE + pinnedStart` (interaction
 * counter) (#848 co-op biome choice). The interaction OWNER drives the real crossroads screen and the
 * WATCHER mirrors it; the owner relays the Stay(0)/Leave(1) choice. Disjoint band above every other.
 */
export const COOP_CROSSROADS_SEQ_BASE = 9_600_000;
/**
 * The ER World-Map biome PICK owner-alternated relay: `BASE + pinnedStart` (interaction counter) (#848
 * co-op biome choice). The OWNER drives the real ER_MAP route picker + cursor-mirror; the WATCHER opens a
 * mirrored read-only copy and adopts the owner's relayed biome. Chains off the crossroads (a Leave shares
 * the crossroads' pinned counter so the whole decision is ONE interaction / one terminal advance), or
 * pins its own counter at a natural biome-end multi-node transition. Disjoint band above the crossroads.
 */
export const COOP_BIOME_PICK_SEQ_BASE = 9_700_000;
/**
 * The one-time ER Stormglass weather PICK owner-driven relay: a FIXED singleton seq (#130 co-op wiring).
 * The Stormglass relic prompts ONCE per run (getStormglassWeather() persists after the first pick), and
 * that pick is a run-affecting weather choice hashed into the battle checksum - so an unmirrored per-client
 * prompt diverges the shared run. The HOST drives the real picker and relays the chosen weather INDEX; the
 * GUEST never opens the picker, adopts the relayed index, and heals via the checkpoint on timeout. Because
 * the prompt is one-time it needs no interaction-counter offset - a fixed singleton above every other band.
 */
export const COOP_STORMGLASS_SEQ = 9_800_000;
/**
 * Host-authoritative deterministic biome transitions: `BASE + sourceWave`. These are BIOME_PICK
 * operations for paths with no human route choice (single route, travel target, random/final biome).
 * The disjoint band prevents a later picker at the same interaction counter from re-acking an older
 * deterministic transition.
 */
export const COOP_BIOME_TRANSITION_SEQ_BASE = 9_800_001;
/**
 * The wild-catch FULL-PARTY keep/release owner-driven relay: a FIXED singleton seq (#856). On a successful
 * WILD catch with a full party the keep/release (box/release) picker belongs to the CATCHER (the ball
 * thrower), not the sole-engine host. For a GUEST-thrown catch the HOST streams a `catchFullPrompt`, the
 * GUEST opens the real replace-or-skip picker + relays the chosen party slot, and the host applies the
 * authoritative release+add. Only one live-battle catch resolves at a time, so it needs no interaction-
 * counter offset - a fixed singleton above every other band (a HOST-thrown catch drives the picker locally
 * and never touches this band). The recipient-drives twin of the #855 ME catch-full sub-prompt.
 */
export const COOP_CATCH_FULL_SEQ = 9_900_000;
/** Host->guest dex/starter sync broadcasts: a fixed disjoint seq (#794). */
export const COOP_DEX_SYNC_SEQ = 9_200_000;
/** Rejoin full-resync request: `BASE + (Date.now() % 100_000)`. */
export const COOP_REJOIN_SYNC_SEQ_BASE = 9_300_000;
/**
 * The lockstep move-replace ("which move to forget") relay: a FIXED singleton seq.
 * #840: RELOCATED from 9_000_001 (which was inside the 9M ME-terminal band) to a free base
 * above every other band, so its disjointness is structural, not merely temporal.
 */
export const COOP_LEARN_MOVE_SEQ = 9_500_000;

// ---------------------------------------------------------------------------
// The typed band table (used by the collision test).
// ---------------------------------------------------------------------------

/**
 * The highest interaction-counter / ME-counter value treated as REACHABLE in a real run. Real
 * runs see at most a few hundred interactions; this ceiling is generous headroom. It is
 * deliberately below the faint-switch band (90_000): every interaction-counter-keyed band, incl.
 * the raw-counter reward channel (base 0), must stay under 90_000 so it can never reach the
 * faint/revival bands. The collision test enforces exactly this.
 */
export const COOP_MAX_REACHABLE_COUNTER = 89_999;

/** The `Date.now() % 100_000` offset ceiling for the rejoin-resync band. */
const REJOIN_OFFSET_MAX = 99_999;

/** The bounded quiz offset ceiling: `(2047) * 16 + 15`. */
const QUIZ_OFFSET_MAX = 2047 * 16 + 15; // 32_767

export interface CoopSeqBand {
  /** Stable key for the band. */
  readonly key: string;
  /** Base seq value (the exported constant). */
  readonly base: number;
  /**
   * The largest offset the band's formula can produce at REALISTIC magnitudes. The band therefore
   * occupies the closed range `[base, base + maxOffset]`.
   */
  readonly maxOffset: number;
  /** Human description of the offset formula. */
  readonly offset: string;
  /** The module that derives / owns this band. */
  readonly owner: string;
}

/**
 * Every seq band, in ascending base order. The collision test asserts these are pairwise disjoint.
 * NOTE: `COOP_BIOME_STOCK_REROLL` (777) is NOT here - it is a reroll-namespace tag on the reward
 * channel, not a seq base.
 */
export const COOP_SEQ_BANDS: readonly CoopSeqBand[] = [
  {
    key: "reward",
    base: COOP_REWARD_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ interactionCounter",
    owner: "select-modifier-phase.ts",
  },
  {
    key: "faintSwitch",
    base: COOP_FAINT_SWITCH_SEQ_BASE,
    maxOffset: 3,
    offset: "+ fieldIndex (0..3)",
    owner: "coop-interaction-relay.ts",
  },
  {
    key: "revival",
    base: COOP_REVIVAL_SEQ_BASE,
    maxOffset: 3,
    offset: "+ fieldIndex (0..3)",
    owner: "coop-interaction-relay.ts",
  },
  {
    key: "abilityPicker",
    base: COOP_ABILITY_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ interactionCounter",
    owner: "coop-ability-picker-relay.ts",
  },
  {
    key: "biomeShop",
    base: COOP_BIOME_SHOP_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ pinnedStart (ME interaction counter)",
    owner: "coop-interaction-relay.ts",
  },
  {
    key: "bargain",
    base: COOP_BARGAIN_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ coopBargainStart (interaction counter)",
    owner: "coop-interaction-relay.ts",
  },
  {
    key: "colosseum",
    base: COOP_COLOSSEUM_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ pinnedCounter (ME interaction counter)",
    owner: "coop-colosseum.ts",
  },
  {
    key: "mePump",
    base: COOP_ME_PUMP_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ interactionCounter",
    owner: "coop-me-pump.ts / mystery-encounter-phases.ts",
  },
  {
    key: "meQuiz",
    base: COOP_ME_QUIZ_SEQ_BASE,
    maxOffset: QUIZ_OFFSET_MAX,
    offset: "+ (counter % 2048) * 16 + (index % 16)",
    owner: "coop-quiz-mirror.ts",
  },
  {
    key: "meTerm",
    base: COOP_ME_TERM_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ interactionCounter",
    owner: "coop-me-pump.ts",
  },
  {
    key: "learnMoveFwd",
    base: COOP_LEARN_MOVE_FWD_SEQ_BASE,
    maxOffset: 5,
    offset: "+ partySlot (0..5)",
    owner: "learn-move-phase.ts",
  },
  {
    key: "learnMoveBatchFwd",
    base: COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE,
    maxOffset: 5,
    offset: "+ partySlot (0..5)",
    owner: "learn-move-batch-phase.ts",
  },
  {
    key: "dexSync",
    base: COOP_DEX_SYNC_SEQ,
    maxOffset: 0,
    offset: "fixed singleton",
    owner: "coop-interaction-relay.ts",
  },
  {
    key: "rejoinSync",
    base: COOP_REJOIN_SYNC_SEQ_BASE,
    maxOffset: REJOIN_OFFSET_MAX,
    offset: "+ (Date.now() % 100_000)",
    owner: "coop-runtime.ts",
  },
  {
    key: "learnMove",
    base: COOP_LEARN_MOVE_SEQ,
    maxOffset: 0,
    offset: "fixed singleton (#840: relocated from 9_000_001)",
    owner: "learn-move-phase.ts",
  },
  {
    key: "crossroads",
    base: COOP_CROSSROADS_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ pinnedStart (interaction counter)",
    owner: "er-crossroads-phase.ts",
  },
  {
    key: "biomePick",
    base: COOP_BIOME_PICK_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER,
    offset: "+ pinnedStart (interaction counter)",
    owner: "select-biome-phase.ts",
  },
  {
    key: "stormglass",
    base: COOP_STORMGLASS_SEQ,
    maxOffset: 0,
    offset: "fixed singleton (one-time weather pick)",
    owner: "er-stormglass-picker-phase.ts",
  },
  {
    key: "biomeTransition",
    base: COOP_BIOME_TRANSITION_SEQ_BASE,
    maxOffset: COOP_MAX_REACHABLE_COUNTER - 1,
    offset: "+ sourceWave",
    owner: "select-biome-phase.ts",
  },
  {
    key: "catchFull",
    base: COOP_CATCH_FULL_SEQ,
    maxOffset: 0,
    offset: "fixed singleton (one live catch resolves at a time)",
    owner: "attempt-capture-phase.ts / coop-guest-catch-full-phase.ts",
  },
];

/** The inclusive numeric range `[lo, hi]` a band occupies at realistic magnitudes. */
export function coopSeqBandRange(band: CoopSeqBand): { lo: number; hi: number } {
  return { lo: band.base, hi: band.base + band.maxOffset };
}

// ---------------------------------------------------------------------------
// The relay KIND registry. Every `kind` string sent via sendInteractionChoice /
// sendInteractionOutcome, mapped to its transport + the band it rides.
// ---------------------------------------------------------------------------

/** Which relay method carries a kind. */
export type CoopRelayTransport = "choice" | "outcome";

export interface CoopRelayKind {
  /** The wire `kind` string. */
  readonly kind: string;
  /** Whether it rides sendInteractionChoice or sendInteractionOutcome. */
  readonly transport: CoopRelayTransport;
  /** The seq band it rides (a `key` in COOP_SEQ_BANDS). */
  readonly band: string;
  /** The module that sends it. */
  readonly sender: string;
}

/**
 * Every relay `kind`. The kind-registry test asserts this is exactly the set of kinds actually
 * sent in src, and that each rides a band that has a consumer.
 */
export const COOP_RELAY_KINDS: readonly CoopRelayKind[] = [
  // Reward-shop channel (raw interaction counter). All ride sendInteractionChoice.
  { kind: "reward", transport: "choice", band: "reward", sender: "select-modifier-phase.ts" },
  { kind: "shop", transport: "choice", band: "reward", sender: "select-modifier-phase.ts" },
  { kind: "skip", transport: "choice", band: "reward", sender: "select-modifier-phase.ts" },
  { kind: "reroll", transport: "choice", band: "reward", sender: "select-modifier-phase.ts" },
  { kind: "check", transport: "choice", band: "reward", sender: "select-modifier-phase.ts" },
  { kind: "transfer", transport: "choice", band: "reward", sender: "select-modifier-phase.ts" },
  { kind: "lock", transport: "choice", band: "reward", sender: "select-modifier-phase.ts" },
  // Switch / revival.
  {
    kind: "switch",
    transport: "choice",
    band: "faintSwitch",
    sender: "switch-phase.ts / coop-guest-faint-switch-phase.ts / coop-replay-phases.ts",
  },
  { kind: "revival", transport: "choice", band: "revival", sender: "coop-guest-revival-phase.ts" },
  // Ability picker.
  { kind: "abilityPicker", transport: "choice", band: "abilityPicker", sender: "er-(greater-)ability-*-phase.ts" },
  // Biome market.
  { kind: "biomeShop", transport: "choice", band: "biomeShop", sender: "biome-shop-phase.ts" },
  // Bargain.
  { kind: "bargain", transport: "outcome", band: "bargain", sender: "the-bargain-phase.ts" },
  // Colosseum.
  { kind: "coloBoard", transport: "outcome", band: "colosseum", sender: "coop-colosseum.ts" },
  { kind: "coloPick", transport: "choice", band: "colosseum", sender: "coop-colosseum.ts" },
  // Mystery encounter (present/pick/sub/terminal/resync all ride the ME pump/term bands).
  {
    kind: "mePresent",
    transport: "outcome",
    band: "mePump",
    sender: "encounter-phase-utils.ts / mystery-encounter-phases.ts / coop-quiz-mirror.ts",
  },
  { kind: "meResync", transport: "outcome", band: "mePump", sender: "mystery-encounter-phases.ts" },
  { kind: "me", transport: "choice", band: "mePump", sender: "coop-replay-me-phase.ts" },
  { kind: "meSub", transport: "choice", band: "mePump", sender: "coop-replay-me-phase.ts" },
  { kind: "meBtn", transport: "choice", band: "mePump", sender: "coop-me-pump.ts / mystery-encounter-phases.ts" },
  // Quiz.
  { kind: "quizAns", transport: "choice", band: "meQuiz", sender: "coop-quiz-mirror.ts" },
  // Learn move.
  {
    kind: "learnMove",
    transport: "choice",
    band: "learnMove",
    sender: "learn-move-phase.ts / coop-replay-learn-move-phase.ts",
  },
  { kind: "learnMoveForward", transport: "outcome", band: "learnMoveFwd", sender: "learn-move-phase.ts" },
  // Batch level-up move-learn (the shared co-op panel: present + owner-relayed terminal).
  {
    kind: "learnMoveBatchForward",
    transport: "outcome",
    band: "learnMoveBatchFwd",
    sender: "learn-move-batch-phase.ts",
  },
  {
    kind: "learnMoveBatch",
    transport: "choice",
    band: "learnMoveBatchFwd",
    sender: "learn-move-batch-phase.ts / coop-replay-learn-move-batch.ts",
  },
  // Dex sync.
  { kind: "dexSync", transport: "outcome", band: "dexSync", sender: "coop-runtime.ts" },
  // Co-op biome choice (#848): the every-5-waves crossroads + the ER World-Map biome pick.
  { kind: "crossroads", transport: "choice", band: "crossroads", sender: "er-crossroads-phase.ts" },
  { kind: "biomePick", transport: "choice", band: "biomePick", sender: "select-biome-phase.ts" },
  // ER Stormglass one-time weather pick (#130 co-op wiring): host drives, relays the chosen weather index.
  { kind: "stormglass", transport: "choice", band: "stormglass", sender: "er-stormglass-picker-phase.ts" },
  // Wild-catch FULL-party keep/release owner pick (#856): the GUEST catcher drives the picker + relays the slot.
  { kind: "catchFull", transport: "choice", band: "catchFull", sender: "coop-guest-catch-full-phase.ts" },
];

// ---------------------------------------------------------------------------
// #861 KIND-VALIDATION expected-kind sets. Every `awaitInteractionChoice` call site declares the
// EXACT set of relay `kind`s it legitimately consumes; the relay re-buffers (never resolves on) any
// buffered/incoming choice whose kind is outside that set. This closes the P0 where a STALE, minutes-
// old buffered choice at a REUSED seq (interaction counters reset per session/epoch) satisfied a new
// epoch's await instead of the genuine pick. The sets are the SINGLE SOURCE for each site and are
// asserted (each kind is a registered `transport:"choice"` kind) by the kind-registry test.
//
// CONSERVATIVE by construction: a site that legitimately alternates across several kinds (the reward
// shop, the ME pump/terminal) lists ALL of them, so a legitimate pick is NEVER re-buffered - only a
// cross-family stale/forged kind is rejected.
// ---------------------------------------------------------------------------

/** The reward shop watch loop (select-modifier-phase.ts): the whole raw-counter reward channel. */
export const COOP_REWARD_CHOICE_KINDS = ["reward", "shop", "skip", "reroll", "check", "transfer", "lock"] as const;
/** The mystery-encounter pump/terminal awaits (present-pick / sub-pick / terminal LEAVE button). */
export const COOP_ME_CHOICE_KINDS = ["me", "meSub", "meBtn"] as const;
/** Top-level Mystery selector only. */
export const COOP_ME_PICK_CHOICE_KINDS = ["me"] as const;
/** Mystery party/secondary/catch-full sub-pickers only. */
export const COOP_ME_SUB_CHOICE_KINDS = ["meSub"] as const;
/** Mystery terminal/battle-handoff carrier only. */
export const COOP_ME_TERMINAL_CHOICE_KINDS = ["meBtn"] as const;
/** Faint / voluntary switch replacement picks (switch-phase.ts). */
export const COOP_SWITCH_CHOICE_KINDS = ["switch"] as const;
/** Revival Blessing owner pick (revival-blessing-phase.ts). */
export const COOP_REVIVAL_CHOICE_KINDS = ["revival"] as const;
/** Ability-picker relay (er-(greater-)ability-*-phase.ts). */
export const COOP_ABILITY_CHOICE_KINDS = ["abilityPicker"] as const;
/** Biome market buy/leave (biome-shop-phase.ts). */
export const COOP_BIOME_SHOP_CHOICE_KINDS = ["biomeShop"] as const;
/** ER World-Map biome pick (select-biome-phase.ts). */
export const COOP_BIOME_PICK_CHOICE_KINDS = ["biomePick"] as const;
/** Every-5-waves crossroads Stay/Leave (er-crossroads-phase.ts). */
export const COOP_CROSSROADS_CHOICE_KINDS = ["crossroads"] as const;
/** One-time Stormglass weather pick (er-stormglass-picker-phase.ts). */
export const COOP_STORMGLASS_CHOICE_KINDS = ["stormglass"] as const;
/** Wild-catch full-party keep/release owner pick (attempt-capture-phase.ts / coop-guest-catch-full-phase.ts). */
export const COOP_CATCH_FULL_CHOICE_KINDS = ["catchFull"] as const;
/** Lockstep + per-slot-forward "which move to forget" pick (learn-move-phase.ts). */
export const COOP_LEARN_MOVE_CHOICE_KINDS = ["learnMove"] as const;
/** Shared batch level-up Move Learn panel terminal (learn-move-batch-phase.ts). */
export const COOP_LEARN_MOVE_BATCH_CHOICE_KINDS = ["learnMoveBatch"] as const;
/** ME quiz answer relay (coop-quiz-mirror.ts). */
export const COOP_QUIZ_CHOICE_KINDS = ["quizAns"] as const;
/** Colosseum board Continue/Cash-out decision (coop-colosseum.ts). */
export const COOP_COLO_CHOICE_KINDS = ["coloPick"] as const;

/** Every registered `transport:"choice"` kind (used by the kind-validation registry test). */
export function coopRegisteredChoiceKinds(): string[] {
  return COOP_RELAY_KINDS.filter(k => k.transport === "choice").map(k => k.kind);
}
