/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op networking transport abstraction (#633, co-op mode).
//
// The game talks to a `CoopTransport`; the concrete implementation is swappable:
//   - `LoopbackTransport` (in-process) NOW - powers unit tests and a local
//     "hotseat" path, and lets all the co-op GAME logic be built + verified
//     headlessly before any real networking exists.
//   - a WebRTC DataChannel transport LATER (phase P6), dropped in behind the
//     same interface.
//
// IMPORTANT (the whole point of the design): every gameplay message flows through
// this transport peer-to-peer. Cloudflare is ONLY ever used for matchmaking /
// signaling to ESTABLISH a transport - never to carry gameplay - so a running
// co-op session costs effectively nothing on CF.
// =============================================================================

// TYPE-ONLY import (erased at runtime): the data-fingerprint diagnostic message carries a
// plain-JSON `ErDataFingerprint` (#633 diagnostics), so the transport stays the lowest layer.
import type { ErDataFingerprint } from "#data/elite-redux/coop/coop-data-fingerprint";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopFrozenAckQuorumV1, CoopMembershipSnapshotV1 } from "#data/elite-redux/coop/coop-membership";
// TYPE-ONLY (erased at runtime, so this stays the lowest layer): the authoritative control-plane
// envelope (Wave-2 run-state migration, §1.1). The envelope module in turn imports only the
// CoopAuthoritativeBattleStateV1 TYPE from here, so the cycle is fully type-level (no runtime cycle).
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopWaveAdvancePayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import type {
  CoopAccountIdentityV1,
  CoopAuthorityRole,
  CoopFrameContextV1,
  CoopSeatId,
  CoopSessionBindingV1,
  CoopTransportRole,
} from "#data/elite-redux/coop/coop-session-binding";
import type { ErRouteNode } from "#data/elite-redux/er-biome-routing";
import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";
import type { ErMapSaveData } from "#data/elite-redux/er-map-nodes";
import type { ErRelicBattleStateData } from "#data/elite-redux/er-relic-battle-state";
// TYPE-ONLY import (fully erased at runtime by `import type`, so this file stays the
// zero-runtime-import lowest layer): the ghost-pool message carries plain-JSON
// `GhostTeamSnapshot`s, which already live in er-ghost-teams (#633 ghost-pool sync).
import type { ErShinyLabSavedLook } from "#data/elite-redux/er-shiny-lab-effects";

/** Which side of a co-op session a client is. Auto-assigned at pairing time (the
 *  player never chooses); the run is host-authoritative, so `host` is the engine
 *  source of truth and `guest` is the thin client. */
export type CoopRole = "host" | "guest";

/**
 * #807 C: co-op PROTOCOL version (standard version negotiation). Bump when the wire protocol
 * changes shape. Carried in the hello; a mismatch means one player runs a stale cached bundle -
 * the top source of unreproducible ghost bugs - and both get told to hard-refresh.
 */
// er-coop-15: resume decisions are transaction-keyed/durable, launch snapshots are re-answerable, and hello
// carries the host-minted operation epoch. Older builds can lose/alias a boundary or accept prior-run ops.
// er-coop-16: shared boundary tails fail closed unless WAVE_ADVANCE or ME_TERMINAL sanctions them.
// er-coop-17: shared reward/market option payloads are cached and explicitly re-requestable; watchers
// never continue against a local roll when the authoritative stream is lost.
// er-coop-18: cross-branch rendezvous mismatches use an epoch-scoped, revisioned host phase route + guest
// ACK. Older peers would ignore these frames and park, so mixed builds must refuse pairing explicitly.
// er-coop-19: mystery-battle enemy parties are retained and re-requestable by interaction key; a guest
// refuses local enemy derivation when the authoritative carrier is lost or malformed.
// er-coop-20: interaction-counter barriers request an idempotent counter replay and never timeout open.
// er-coop-21: wave-party carriers include the complete encounter descriptor so a late/replayed carrier
// atomically replaces locally-derived battle type, format, mystery type, levels, and trainer presentation.
// er-coop-22: full state-sync snapshots atomically bind the session epoch, host checksum, and every
// control high-water mark; receivers advance control only after safe-boundary checksum convergence.
// er-coop-23: hot rejoin preserves active waits and reissues command/barrier control state; terminal
// disconnect ends shared play instead of taking an uncommitted local fallback/AI/solo branch.
// er-coop-30: authoritative field seats carry actual Phaser presentation membership and the guest settles
// those seats through a pure no-RNG materializer. An older renderer would ignore the visibility boundary
// and can reveal pre-intro/fainted seats, so cached mixed builds must refuse pairing instead of degrading.
// er-coop-31: cold-resume offers bind immutable SHA-256 snapshot bytes, participant seat ownership,
// wave, and control revision; apply/start-new outcomes and host->guest checkpoint persistence use
// bounded acknowledged transactions.
// The same bump makes every deterministic biome destination an exact durable BIOME_PICK permit; a
// WAVE_ADVANCE can enter SelectBiome but can no longer broadly authorize Switch/NewBiome by phase name.
// er-coop-32: every persisted checkpoint is bound to a stable runId plus a host-monotonic checkpoint
// revision; large logical frames use backpressured restartable chunk delivery and resume crosses a
// symmetric final release barrier.
// The parallel protocol-31 authority line additionally requires checkpoint + fullField + state + a
// non-sentinel checksum; replacement frames are retained and re-requestable before control reopens.
// The parallel protocol-32 authority line addresses battle events and commits by epoch/wave/turn and
// retains complete turn/replacement commits through material apply, renderer projection, and exact public
// continuation evidence. Fatal capture failures use an acknowledged terminal handshake instead of leaving
// either peer in a local fallback.
// er-coop-33 is the first compatibility stamp containing BOTH histories. A cached protocol-32 peer is
// therefore rejected even when it implemented one of the two incompatible protocol-32 branches.
export const COOP_PROTOCOL_VERSION = "er-coop-33";

/**
 * Protocol-33 authority evidence is deliberately progressive.  Mechanical convergence is not proof that
 * a renderer has projected the state, and projection is not proof that the next public control surface is
 * actually usable.  Every turn/replacement ACK carries exactly one mandatory stage; peers reject skips,
 * regressions, and conflicting duplicates instead of silently treating an early ACK as commit release.
 */
export type CoopAuthorityAckStage = "materialApplied" | "presentationReady" | "continuationReady";

/** Public shared-run surfaces that can prove an authoritative operation reached a usable continuation. */
export type CoopOperationContinuationSurface = "command" | "sharedInput" | "terminal";

/**
 * Which co-op netcode the run uses (#633, selectable A/B). Two complete
 * implementations live side by side:
 *  - `"lockstep"` (DEFAULT): both clients run the FULL battle engine on the host's
 *    seed; only human CHOICES are relayed and the guest APPLIES the host's relayed
 *    move, so the visible move stays synced. This is the safe live default.
 *  - `"authoritative"`: the guest is a PURE RENDERER - it computes nothing and just
 *    renders the host's streamed turn + checksum/resync (the TRACK-2 path).
 * The HOST decides which one and the guest adopts it from the `runConfig`.
 */
export type CoopNetcodeMode = "lockstep" | "authoritative";

/**
 * Showdown 1v1 PvP (C1): the SESSION KIND layered on the same co-op transport/session
 * machinery. `"coop"` is the classic shared-run co-op (the merged party, the alternating
 * interactions - the default when absent, so an older peer that never sends it is treated
 * as co-op). `"versus"` is a 1v1 showdown match: the two teams do NOT merge (each player's
 * own picks are their party; the opponent's team arrives via the showdown manifest and
 * becomes the ENEMY side). The HOST decides it at session start and the guest adopts it
 * from the `runConfig` (threaded exactly like {@linkcode CoopNetcodeMode}).
 */
export type CoopSessionKind = "coop" | "versus";

/** Connection lifecycle of a transport. */
export type CoopConnectionState = "connecting" | "connected" | "disconnected" | "closed";

/** The control boundary whose failure forced every member out of shared gameplay. */
export type CoopSharedTerminalBoundary =
  | "authority"
  | "recovery"
  | "protocol"
  | "persistence"
  | "surface"
  | "disconnect";

/** Stable machine-readable causes; the bounded human detail is diagnostic only. */
export type CoopSharedTerminalReasonCode =
  | "capture-failed"
  | "apply-failed"
  | "recovery-exhausted"
  | "peer-lost"
  | "binding-mismatch"
  | "persistence-failed"
  | "continuation-failed"
  | "invalid-authority";

/**
 * Immutable P33 shared-terminal transaction. The surrounding frame context is refreshed on retransmit
 * after hot rejoin, while this addressed statement and its frozen ACK quorum remain byte-stable.
 */
export interface CoopSharedTerminalCommitV1 {
  version: 1;
  terminalId: string;
  terminalRevision: number;
  originSeatId: number;
  epoch: number;
  wave: number;
  turn: number;
  boundaryRevision: number;
  boundary: CoopSharedTerminalBoundary;
  reasonCode: CoopSharedTerminalReasonCode;
  reason: string;
  quorum: CoopFrozenAckQuorumV1;
}

export type CoopLaunchSnapshotAbortReason =
  | "no-safe-slot"
  | "slot-raced"
  | "first-save-cas-failed"
  | "guest-persistence-failed";

/** Immutable discriminator for one exact cold-resume snapshot. */
export interface CoopResumeCommitment {
  version: 1;
  digest: string;
  gameMode: number;
  wave: number;
  revision: number;
  /** Stable host-minted identity separating multiple runs owned by the same account pair. */
  runId: string;
  /** Host-monotonic persistence order, independent of wave and operation-journal revisions. */
  checkpointRevision: number;
  timestamp: number;
  participants: [string, string];
  seats: { host: string; guest: string };
}

export type CoopResumeBlockedReason = "unsafe-role-reversal" | "legacy-unmappable" | "replica-unavailable";

export type CoopResumeCheckpointNackReason =
  | "runtime-invalid"
  | "invalid-checkpoint"
  | "no-safe-slot"
  | "slot-conflict"
  | "storage-failed"
  | "cloud-failed"
  | "cloud-conflict";

/** Lifecycle signals exchanged out of band of normal gameplay. */
export type CoopLifecycleEvent = "ready" | "pause" | "resume" | "partner-left";

/**
 * A battle command serialized for the wire. Mirrors the args the engine's
 * `CommandPhase.handleCommand(command, cursor, useMode?, move?)` needs. Filled in
 * fully in phase P2; kept minimal here so the protocol shape exists.
 */
export interface SerializedCommand {
  /** `Command` enum value (FIGHT / BALL / POKEMON / RUN). */
  command: number;
  /** Menu cursor (move slot, ball type, or party slot depending on `command`). */
  cursor: number;
  /** For FIGHT: the chosen move id. */
  moveId?: number;
  /** For FIGHT: resolved target battler indices. */
  targets?: number[];
  /** Stable target identities; host maps these to its own battler indices before commit. */
  targetRefs?: CoopBattleTargetRef[];
  /** `MoveUseMode` enum value. */
  useMode?: number;
  /** For POKEMON (switch): whether it is a Baton switch (passes stat changes) (#633). */
  baton?: boolean;
  /** For FIGHT: whether the mon Terastallizes this turn (Command.TERA) (#633 Fix #4a). */
  tera?: boolean;
}

export interface CoopBattleTargetRef {
  side: "player" | "enemy";
  pokemonId: number;
}

/** One exact host-legal move choice, including every legal resolved target set. */
export interface CoopBattleMoveOffer {
  slot: number;
  moveId: number;
  targetSets: number[][];
  /** Stable identities aligned one-for-one with `targetSets`. */
  targetRefSets: CoopBattleTargetRef[][];
  canTera: boolean;
}

/** Complete host-authored legal action set for one player field slot and turn. */
export interface CoopBattleCommandOffer {
  moves: CoopBattleMoveOffer[];
  switches: { slot: number; canNormal: boolean; canBaton: boolean }[];
  ballTypes: number[];
  ballTargets: number[];
  ballTargetRefs: CoopBattleTargetRef[];
  canRun: boolean;
}

/**
 * A player's FULL starter pick serialized for the wire (#633, LIVE-A/B). The
 * partner's starters cross the transport in full so BOTH clients can rebuild the
 * EXACT same merged launch party (byte-identical species / form / IVs / nature /
 * ability / moves) - a prerequisite for the two engines staying in lockstep over a
 * shared seed. Mirrors the engine `Starter` struct (all fields are plain JSON, so
 * it serializes cleanly over the real WebRTC transport). Distinct from the minimal
 * {@linkcode CoopRosterEntry} (which keeps just speciesId+cost for the budget
 * logic); this is the optional full blob carried alongside it.
 */
export interface CoopSerializedStarter {
  speciesId: number;
  shiny: boolean;
  variant: number;
  formIndex: number;
  female?: boolean | undefined;
  abilityIndex: number;
  passive: boolean;
  nature: number;
  moveset?: number[] | undefined;
  pokerus: boolean;
  nickname?: string | undefined;
  teraType?: number | undefined;
  ivs: number[];
  /** ER Black Shinies (#349): start this mon as a t4 black shiny. */
  erBlackShiny?: boolean | undefined;
  /**
   * Co-op (#633 Fix #3): the picking player's per-account innate-unlock snapshot for this
   * mon - one `passiveAttr` bitmask per ER innate slot (0,1,2). Carried so the partner's
   * client gates this shared mon's active innates by the OWNER's candy unlocks, not its own.
   */
  coopPassiveAttr?: number[] | undefined;
  /** Co-op (#633 Fix #3): the picking player's canonical luck for this mon (owner-authoritative). */
  coopLuck?: number | undefined;
  /**
   * Co-op (#785): the OWNER'S equipped Shiny Lab look for this mon (the encoded SavedLook that
   * rides `customPokemonData.erShinyLab`). Presets live in the owner's LOCAL save, so without
   * carrying them the partner's client rendered default shinies. Type-only import (erased).
   */
  erShinyLab?: ErShinyLabSavedLook | undefined;
  /** Co-op (#785): the equipped preset NAME (the "Glittering Rayquaza" prefix), when a look is carried. */
  erShinyLabName?: string | undefined;
}

/**
 * Showdown 1v1 PvP (A4): a player's stake offer serialized for the wire. Mirrors
 * `showdown/showdown-stakes.ts` `StakeOffer` STRUCTURALLY (the transport stays the
 * lowest layer and never imports showdown/, so the shape is re-declared here rather
 * than imported; `variant` widens to `number` since the wire carries plain JSON).
 */
export interface ShowdownStakeOfferWire {
  speciesId: number;
  shiny: boolean;
  variant: number;
  erBlackShiny: boolean;
  cost: number;
}

/**
 * Showdown 1v1 PvP (A4): one team member serialized for the wire. Mirrors
 * `showdown/showdown-team.ts` `ShowdownMonManifest` STRUCTURALLY (same one-way
 * dependency rule as {@linkcode ShowdownStakeOfferWire} - declared here, not imported).
 */
export interface ShowdownMonManifestWire {
  speciesId: number;
  formIndex: number;
  level: number;
  shiny: boolean;
  variant: number;
  abilityIndex: number;
  /**
   * Showdown fairness (2026-07-10): the FREE nature. OPTIONAL and OMITTED-when-absent, mirroring the
   * domain field and the `erShinyLab` transport discipline — the wire shape both clients hash must be
   * byte-identical, so an absent nature is NEVER carried as `undefined`.
   */
  nature?: number | undefined;
  ivs: number[];
  moveset: number[];
  item: string;
  rootSpeciesId: number;
  /** Task B6: picked as a Black Shiny (barred from being fielded). Mirror of the domain field. */
  erBlackShiny: boolean;
  /** Task B6: the LINE's BASE `speciesStarterCosts` value. Mirror of the domain field. */
  baseCost: number;
  /**
   * Task C7: the owner's per-mon Shiny Lab look (the encoded `ErShinyLabSavedLook` tuple), when
   * the mon is shiny AND a custom look is equipped; absent otherwise. Structurally a `number[]`
   * so the transport imports no shiny-lab type; the opponent's client re-normalizes it (byte-clamped)
   * before applying, so a hostile peer can't smuggle an out-of-range look. Mirrors the ghost
   * snapshot's `GhostMember.erShinyLab`.
   */
  erShinyLab?: number[] | undefined;
}

/**
 * Showdown 1v1 PvP (C7): the opponent's authored GHOST-TRAINER presentation, serialized for the
 * team exchange. Mirrors `er-ghost-profile.ts` `GhostTrainerProfile` STRUCTURALLY (the transport
 * never imports the ghost module - same one-way rule as {@linkcode ShowdownMonManifestWire}). Every
 * field is optional; the RECEIVING client ALWAYS re-runs `sanitizeGhostProfile` before applying, so
 * a hostile peer cannot bypass the length caps / control-char stripping / enum clamps.
 */
export interface ShowdownProfileWire {
  trainerType?: number | undefined;
  female?: boolean | undefined;
  displayName?: string | undefined;
  title?: string | undefined;
  dialogue?:
    | {
        intro?: string | undefined;
        defeatPlayer?: string | undefined;
        defeated?: string | undefined;
        afterWin?: string | undefined;
      }
    | undefined;
  tintColor?: number | undefined;
  aura?: string | undefined;
  showAuraInBattle?: boolean | undefined;
  approach?: string | undefined;
  fxSpeed?: number | undefined;
  fxIntensity?: number | undefined;
  music?: string | undefined;
}

// =============================================================================
// Host-authoritative battle STREAMING shapes (#633, LIVE-D). The host is the only
// resolution engine; the guest renders these. All plain JSON so they serialize over
// the real WebRTC transport, and structural (no engine-type import) so the transport
// stays the lowest layer. `bi` = battler index (0 host lead, 1 guest lead, 2/3 enemies).
// =============================================================================

/**
 * An opaque, JSON-safe serialized Pokemon: the host's `PokemonData` blob, which the
 * guest reconstructs verbatim (same species/form/level/ability/IVs/moves/hp). Typed
 * structurally so the transport layer imports no engine type; the host/guest code
 * (which may import `PokemonData`) does the (de)serialization.
 */
export type CoopSerializedPokemon = Record<string, unknown>;

/** One enemy mon the guest adopts verbatim instead of regenerating (no RNG on the guest). */
export interface CoopSerializedEnemy {
  /** Field slot this enemy occupies (2 or 3). */
  fieldIndex: number;
  /** The host's serialized enemy Pokemon. */
  data: CoopSerializedPokemon;
}

/** Plain-JSON trainer identity/presentation carried by a wave's authoritative encounter descriptor. */
export interface CoopSerializedTrainer {
  trainerType: number;
  variant: number;
  partyTemplateIndex: number;
  nameKey?: string | undefined;
  partnerNameKey?: string | undefined;
  name?: string | undefined;
  partnerName?: string | undefined;
  nameWithTitle?: string | undefined;
  renderNames?:
    | {
        none: string;
        noneWithTitle: string;
        trainer: string;
        trainerWithTitle: string;
        partner: string;
        partnerWithTitle: string;
      }
    | undefined;
  encounterMessages?: string[] | undefined;
  victoryMessages?: string[] | undefined;
  defeatMessages?: string[] | undefined;
  erGhostApproach?: string | undefined;
  erGhostAura?: string | undefined;
  erGhostFxSpeed?: number | undefined;
  erGhostFxIntensity?: number | undefined;
}

/**
 * Complete host-authored encounter identity paired atomically with `enemyPartySync`.
 * The guest applies this before reconstructing enemies or rendering the encounter, so a carrier that
 * arrives after `newBattle()` repairs every locally-derived branch rather than only replacing species.
 */
export interface CoopEncounterAuthority {
  battleType: number;
  /** `COOP_WAVE_NO_ME` for a non-ME wave, otherwise the exact host encounter type. */
  mysteryEncounterType: number;
  /** Registry id from `BattleFormat.id` (`single`, `double`, `triple`, ...). */
  formatId: string;
  enemyLevels: number[];
  trainer?: CoopSerializedTrainer | undefined;
}

/**
 * One rolled reward-screen option the OWNER streams to the WATCHER (#633 Fix #2). Party
 * LUCK changes the NUMBER of seeded upgrade draws when rolling the pool, so the two
 * clients' independently-rolled pools could differ - and that shifts the whole shared
 * RNG stream after the first shop. The owner therefore rolls ONCE and streams the
 * resolved option list; the watcher rebuilds these exact options instead of re-rolling
 * (so it consumes no luck-dependent RNG). All plain JSON for the wire.
 *  - `id`         the ModifierType registry key (e.g. "RARE_CANDY"); rebuild via `modifierTypes[id]()`
 *  - `tier`       the resolved ModifierTier
 *  - `upgradeCount` luck-driven tier upgrades applied (for the option's upgrade animation)
 *  - `cost`       the option's price (shop) / 0 (free reward)
 *  - `pregenArgs` a generator type's pregen args (TM move id, form item, etc.), when applicable
 */
export interface CoopSerializedRewardOption {
  id: string;
  tier: number;
  upgradeCount: number;
  cost: number;
  pregenArgs?: number[] | undefined;
}

/**
 * One arena tag carried in the per-turn checkpoint (#633 GAP 1). Hazards / screens / tailwind
 * (Stealth Rock, Spikes, Reflect, Light Screen, Tailwind, ...) are set by host MoveEffectPhases
 * the guest never runs, so without carrying them the guest never gains them and the checksum -
 * which hashes `(tagType, side)` - resync-loops every turn. The guest reconciles its arena to
 * this set by `(tagType, side)`. `turnCount` / `layers` are FORCE-SET (never hashed) so a screen
 * the host refreshed or a multi-layer Spikes stack renders correctly without re-introducing the
 * intentionally-excluded turn-counter desyncs.
 */
export interface CoopSerializedArenaTag {
  /** `ArenaTagType` string key. */
  tagType: string;
  /** `ArenaTagSide` enum value (0 BOTH, 1 PLAYER, 2 ENEMY). */
  side: number;
  /** Turns the host's tag has left (force-set on the guest; NEVER hashed - excluded by design). */
  turnCount: number;
  /** Entry-hazard layer count (Spikes / Toxic Spikes); 1 for non-stacking tags. Force-set only. */
  layers: number;
}

/** The mutable per-turn battle state of ONE field mon (the guest already has the mon object). */
export interface CoopSerializedMonState {
  /** Battler index of this field mon. */
  bi: number;
  /**
   * STABLE party-slot identity of this field mon (#633, enemy-switch mirror). The host's
   * `getEnemyParty().indexOf(mon)` (player side: `getPlayerParty().indexOf(mon)`). NOT `mon.id`
   * (per-client random + remapped). NOTE: for an ON-FIELD mon this always equals its field slot
   * (`bi - ENEMY`), so it can NOT by itself detect a switch (an on-field mon's array index reverts
   * to the field slot after the host's swap) - {@linkcode speciesId} drives the actual detection.
   * Carried for diagnostics / future per-slot identity use.
   */
  partyIndex: number;
  /**
   * The mon's `species.speciesId` (#633, enemy-switch mirror). The robust identity the guest uses
   * to DETECT a host enemy switch: the streamed `bi` is only a field POSITION, so a host switch
   * (swaps `party[fieldIndex]` <-> a bench slot) keeps the same `bi` but brings in a DIFFERENT
   * species. When the species at an enemy field slot differs from the guest's current mon there, a
   * switch happened; the guest then summons the matching adopted party member (same encounter
   * order on both clients). Carried for enemy slots (drives the reconcile); harmless for players.
   */
  speciesId: number;
  hp: number;
  maxHp: number;
  /**
   * Move PP usage per moveset slot (#798): `{ id: MoveId, ppUsed }` in slot order. The pure-renderer
   * guest never decrements PP, and the checksum hashes `[moveId, ppUsed]` - without this every turn
   * with a move use forced a FULL resync (a constant false alarm that blinded the desync detector).
   * Optional/additive: an older host omits it and the guest leaves PP alone (resync still heals).
   */
  moves?: { id: number; ppUsed: number }[];
  /** #809: tera state so mega/tera converge via the checkpoint instead of a forced resync. */
  isTerastallized?: boolean;
  teraType?: number;
  /** #804: host-authoritative owner tag for player-side mons (heals cross-client tag drift). */
  coopOwner?: "host" | "guest";
  /** `StatusEffect` enum value (0 = none). */
  status: number;
  /** The 7 stat stages (ATK..ACC/EVA), absolute values. */
  statStages: number[];
  fainted: boolean;
  /** Present only when the mon's form changed this turn. */
  formIndex?: number | undefined;
  /** Present only when the mon's active ability changed this turn (`AbilityId`). */
  abilityId?: number | undefined;
  /**
   * ER bleed / frost / fear BattlerTags on this mon (#633 Fix #4h). These are BattlerTags,
   * NOT StatusEffects, so the `status` field above can't carry them - once anything desyncs
   * they could never be repaired. Each entry is `{ type, turns }` (the BattlerTagType key +
   * turns remaining). Absent / empty => none of the three ER tags are present.
   */
  erTags?: { type: string; turns: number }[] | undefined;
}

/** Authoritative post-turn snapshot: enough to set the guest's field state exactly. */
export interface CoopBattleCheckpoint {
  /** #807 monotonic state tick (Source-style snapshot sequencing); absent on legacy senders. */
  tick?: number;
  /** Every occupied field mon's mutable state. */
  field: CoopSerializedMonState[];
  /** `WeatherType` enum value (0 = none) + turns remaining. */
  weather: number;
  weatherTurnsLeft: number;
  /** `TerrainType` enum value (0 = none) + turns remaining. */
  terrain: number;
  terrainTurnsLeft: number;
  /**
   * Arena tags the host has (#633 GAP 1): hazards / screens / tailwind the guest's
   * MoveEffectPhases never set. The guest reconciles its arena to this set by `(tagType, side)`.
   * Optional + additive: an older payload omits it and the guest leaves its arena tags alone.
   */
  arenaTags?: CoopSerializedArenaTag[];
  /**
   * The host's authoritative MONEY at this checkpoint (#633/#698 money transient). The pure-renderer
   * guest never runs the host-only money mutations (a reward-shop BUY between waves, in-battle Pay Day /
   * money-scatter pickup), so its money lags the host until the next full resync heals it - the visible
   * "host=824 guest=1000" transient. Carrying it in EVERY per-turn checkpoint makes the guest MIRROR the
   * host's money continuously (the first turn of the wave after a shop spend snaps it), so the transient
   * never shows. Force-SET on the authoritative guest only (never hashed - the checksum + full resync
   * already cover money). Optional + additive: an OLDER host omits it and the guest leaves money alone.
   */
  money?: number;
}

// =============================================================================
// Host-authoritative FULL battle snapshot (#633, TRACK-2). The heavy `stateSync`
// payload the host sends when the guest detects a checksum MISMATCH: every field
// detail the per-turn checkpoint can't carry (active ability, form, per-move PP,
// battler tags) PLUS arena tags, the player party order, money, and modifier stacks.
// The guest adopts it field-by-field (NEVER a full session reload mid-battle - that
// tears down the live field), so a divergence is healed wholesale and the next turn's
// checksum re-converges. All plain JSON so it compresses + crosses the real transport.
// =============================================================================

/**
 * TRANSFORM / Imposter copied identity (#836/#837). When a mon Transforms (move) or Imposter-copies, the
 * copied identity lives in `summonData` (speciesForm / moveset / types / ability / gender / stats) while
 * `species` stays the ORIGINAL - so it is invisible to the `speciesId` + `formIndex` fields and never
 * converges on the pure-renderer guest (live #836: a host Ditto's damage synced but it never visibly
 * transformed on the watcher's screen; PostSummonTransformAbAttr also draws RNG, so a guest-side pick
 * would be unhealable without this). Carried so the guest re-applies exactly what the host wrote.
 */
export interface CoopMonTransform {
  /** Copied species id (`summonData.speciesForm.speciesId`). */
  speciesId: number;
  /** Copied form index (`summonData.speciesForm.formIndex`). */
  formIndex: number;
  /** Copied moveset as `[moveId, ppUsed]` (the transform gives each move min(pp,5)). */
  moves: [number, number][];
  /** Copied types (`PokemonType` enum ids). */
  types: number[];
  /** Copied active ability id (`AbilityId`); 0 when unreadable. */
  ability: number;
  /** Copied gender (`Gender` enum); -1 when unset. */
  gender: number;
  /** Copied battle stats (`summonData.stats`, indexed by `Stat`: HP,ATK,DEF,SPATK,SPDEF,SPD). */
  stats: number[];
}

/** One field mon's FULL authoritative state for a resync (superset of the checkpoint). */
export interface CoopFullMonSnapshot {
  /** Battler index (0 host lead, 1 guest lead, 2/3 enemies). */
  bi: number;
  /** STABLE party-slot identity (#633, enemy-switch mirror); see {@linkcode CoopSerializedMonState.partyIndex}. */
  partyIndex: number;
  /** `species.speciesId` (#633, enemy-switch mirror); the robust switch-detection identity. */
  speciesId: number;
  hp: number;
  maxHp: number;
  /** `StatusEffect` enum value (0 = none). */
  status: number;
  /** The 7 stat stages (ATK..ACC/EVA). */
  statStages: number[];
  fainted: boolean;
  /** Active ability id (`AbilityId`); 0 when unknown. */
  abilityId: number;
  /** Current form index. */
  formIndex: number;
  /** Whether this mon is Terastallized (#633 GAP 7); forced on the guest in the snapshot apply. */
  isTerastallized?: boolean;
  /** Tera type (`PokemonType` enum) (#633 GAP 7); forced alongside `isTerastallized`. */
  teraType?: number;
  /**
   * Authoritative level (#633, B): drives the guest's stat recompute so maxHp converges at the ROOT
   * (the host owns leveling; the guest is a pure renderer that adopts it), not just masked by the
   * maxHp setStat force. Optional + additive (older host payloads omit it; guest guards `!== undefined`).
   */
  level?: number;
  /** Authoritative exp (#633, B); forced TOGETHER with `level` so `levelExp` (a derived getter) stays consistent. */
  exp?: number;
  /** Boss segment COUNT (#633, A/BLOCKING-2); re-asserted on resync so boss bars heal mid-battle. */
  bossSegments?: number;
  /** Boss segment INDEX (#633, A/BLOCKING-2); re-asserted on resync so the shield dividers heal mid-battle. */
  bossSegmentIndex?: number;
  /** Each move slot as `[moveId, ppUsed]`, in moveset slot order. */
  moves: [number, number][];
  /** Battler-tag TYPE ids present on the mon (identity only). */
  tags: number[];
  /**
   * This mon's held-item modifiers as plain ModifierData blobs (#633 RISKY #1/#2/#3). Carried in the
   * resync ONLY (never the per-turn checkpoint - too heavy; the checksum's compact held-item digest
   * detects drift and this heals it). ON-FIELD mons only (the snapshot.field set). Reconstructed +
   * remapped to the guest's live mon id via the applyCoopEnemyHeldItems reconstruct path. Optional +
   * additive: an older host omits it and the guest leaves the mon's items alone.
   */
  heldItems?: Record<string, unknown>[] | undefined;
  /**
   * TRANSFORM / Imposter copied identity (#836/#837): the summonData a host Transform wrote, so the
   * guest's sprite/species/moveset/types/ability/stats converge. `null` = the host mon is NOT
   * transformed (the guest CLEARS any stale transform). Optional + additive: an older host omits it and
   * the guest leaves its transform state alone; applied gated authoritative (per-turn field snapshot + resync).
   */
  transform?: CoopMonTransform | null | undefined;
}

/** The full authoritative battle state the host sends to heal a desync. */
export interface CoopFullBattleSnapshot {
  /** #807 monotonic state tick (Source-style snapshot sequencing); absent on legacy senders. */
  tick?: number;
  /** Session epoch this atomic DATA+CONTROL snapshot belongs to. */
  sessionEpoch?: number | undefined;
  /** Host checksum captured with this snapshot; control marks advance only after it matches post-apply. */
  checksum?: string | undefined;
  /** Revisioned authority membership atomically bound to this DATA snapshot. */
  membership?: CoopMembershipSnapshotV1 | undefined;
  /** Active control surface captured with the snapshot for rejoin validation and causal diagnostics. */
  activeControl?: CoopActiveControlSnapshotV1 | undefined;
  /** Operation revisions whose effects this authoritative snapshot already subsumes (§4.4). */
  journalHighWater?: Record<string, number> | undefined;
  /** Hash binding the DATA checksum to session/membership/control/high-water as one envelope. */
  controlDigest?: string | undefined;
  /** Every occupied field mon's full state, by battler index. */
  field: CoopFullMonSnapshot[];
  /** `WeatherType` enum value (0 = none) + turns remaining. */
  weather: number;
  weatherTurnsLeft: number;
  /** `TerrainType` enum value (0 = none) + turns remaining. */
  terrain: number;
  terrainTurnsLeft: number;
  /**
   * Arena tags the host has (#633 GAP 1): each `{ tagType, side, turnCount, layers }` so the
   * resync path reconciles the guest's arena identically to the per-turn checkpoint (hazards /
   * screens / tailwind). `turnCount` / `layers` are force-set, never hashed.
   */
  arenaTags: CoopSerializedArenaTag[];
  /** Player party `speciesId`s in slot order. */
  party: number[];
  money: number;
  /** Persistent modifiers as `[typeId, stackCount]`. */
  modifiers: [string, number][];
  /**
   * Full player-wide PERSISTENT modifier blobs (#698 / #633): the host's NON-held-item
   * `PersistentModifier`s serialized as `ModifierData` (typeId / className / args / stackCount /
   * typePregenArgs), so the guest can RECONSTRUCT a player-wide modifier it is missing (a temp
   * stat booster's stat, an EXP charm, ...) - which the `[typeId, stackCount]` `modifiers` list above
   * cannot do (it can fix a stack / remove an extra, but not re-create one that needs args). Held
   * items are EXCLUDED here (they stay per-mon in `field[].heldItems`); form-change items are excluded
   * too. Reconciled (add missing / remove extra / fix stacks) by the gated guest heal. Optional +
   * additive: an OLDER host omits it and the guest falls back to the `[typeId, stackCount]`
   * stack-only reconcile (no regression).
   */
  playerModifiers?: Record<string, unknown>[] | undefined;
  /**
   * Ball inventory `[ballType, count]` (#633 RISKY #4). The host decrements it host-only in
   * AttemptCapturePhase, which the pure-renderer guest never runs, so the guest's inventory drifts up.
   * Carried in the resync so it heals. Optional + additive (older host omits it).
   */
  pokeballCounts?: [number, number][] | undefined;
  /**
   * Full per-mon `PokemonData` JSON for the WHOLE player party (#633 B4): heals BENCH-mon
   * level / exp / form / friendship / moveset (+ a host off-field evolution's species) the
   * on-field-only `field` + speciesId-only `party` cannot carry - the live REVIVE-in-shop
   * desync (host shows a bench mon fainted, guest shows it alive). The guest reconciles by
   * species + coopOwner via the capture-handshake machinery ({@linkcode applyCoopCaptureParty}).
   * Optional + additive: an older host omits it and the guest leaves its bench alone.
   */
  benchParty?: string[] | undefined;
  /** Active `BiomeId` (B7); the guest heals a biome split via `newArena(biomeId)` on resync. */
  biomeId?: number;
  /** Run seed (B8); the guest re-pins `setSeed(seed)` on ANY resync (not just at an ME terminal). */
  seed?: string;
  /** Derived wave seed (B8); re-sown alongside `seed` so the guest's RNG cursor matches the host. */
  waveSeed?: string;
  /**
   * ER MODULE-LET SUBSTRATES (#837): the run-state substrates the session save serializes but that no
   * per-turn/resync heal carried, so the {@linkcode CoopChecksumState.saveDataDigest} could now DETECT a
   * drift the resync could not HEAL. Carried here (reusing the substrates' OWN save-data serializers) so
   * the gated guest heal restores them through their own restore functions. All optional + additive: an
   * older host omits them and the guest leaves that substrate alone.
   */
  /** #348 per-mon faint-free money-streak counters `[pokemonId, waves]` (audit Part 1 #1). */
  erMoneyStreaks?: [number, number][] | undefined;
  /** #504 the wave the player armed biome overstay, or null if never (audit Part 1 #2). */
  biomeOverstayAnchor?: number | null | undefined;
  /** ER per-battle relic counters (Cursed Idol / Pharaoh's Ankh), wave-scoped (audit Part 1 #3). */
  erRelicBattleState?: ErRelicBattleStateData | undefined;
  /**
   * #486 biome-structure EXTENT (rolled biome length + start wave). Rides the saveDataDigest via
   * erMapState's biome-structure trio (`normalizeCoopErMapState`), but - unlike `biomeOverstayAnchor` -
   * NO per-turn/resync heal carried it, so a divergence loop-DETECTED with no heal path (audit #841 item
   * 5). Carried here + healed through `restoreErBiomeStructure`. Optional + additive: an older host omits
   * it and the guest leaves its biome-structure alone.
   */
  erBiomeStructure?: { biomeLength: number | null; biomeStartWave: number } | undefined;
  /**
   * #865 ER WORLD-MAP STATE (revealed nodes / travel target / Treasure-Map fragments / journey history).
   * The saveDataDigest now hashes the revealed-node set + travel target + fragments
   * (`normalizeCoopErMapState`), so a host-vs-guest map drift is DETECTED - but no per-turn/resync heal
   * carried the map state, so a divergence loop-detected with no heal path (audit #841 item 1). Carried
   * here (the substrate's OWN save serializer, `getErMapSaveData`) + healed through `restoreErMapState` so
   * the guest ADOPTS the host's map state. Optional + additive: an older host omits it and the guest leaves
   * its map state alone.
   */
  erMapState?: ErMapSaveData | undefined;
  /**
   * #865 the ROUTING pending-node set (`er-biome-routing`). This is the ACTUAL input the biome-travel
   * decision reads (`getErPendingNodes`), rolled at biome ENTRY (SwitchBiomePhase) and NOT part of the
   * persisted `erMapState`. Carried + adopted (`setErPendingNodes`) alongside `erMapState` so the guest's
   * SelectBiomePhase sees the SAME onward set as the host's - which makes the NATURAL single-node
   * biome-travel terminal (revealed.length===1, non-chained, relays no biomePick) coherent BY
   * CONSTRUCTION. Optional + additive.
   */
  erPendingNodes?: ErRouteNode[] | undefined;
  /**
   * #838 UNIFY: the id-based authoritative full-state. When present the guest adopts THIS via the same
   * apply the live turns use (mutate-in-place by `Pokemon.id`, reconstruct/remove by id, adopt host party
   * order, instance-keyed modifiers) instead of the legacy species-order + benchParty reconcile the rest
   * of this payload feeds. A strict superset of the legacy party/field/modifier fields above (which stay
   * for an older host / a field-less capture). Optional + additive.
   */
  authoritativeState?: CoopAuthoritativeBattleStateV1 | undefined;
}

export interface CoopActiveControlSnapshotV1 {
  version: 1;
  phaseName: string;
  interactionCounter: number;
  /**
   * Durable Mystery-event control surface. A hot-rejoin snapshot carries the exact last host screen and
   * terminal state so the guest can rebind its retained CoopReplayMePhase instead of locally inferring an
   * exit from a cancelled/expired 8M or 9M wait. Optional for backward-compatible snapshot decoding.
   */
  activeMysteryEncounter?: CoopActiveMysteryEncounterSnapshotV1 | undefined;
  awaitedInteractions: { seq: number; expectedKinds: string[] }[];
  barriers: { localArrived: string[]; partnerArrived: string[]; awaiting: string[] };
  pendingCommands: {
    fieldIndex: number;
    turn: number;
    moveSlots: number[];
    offer?: CoopBattleCommandOffer | undefined;
    owner?: CoopRole;
    /** Immutable entity boundary. Required whenever a P33 snapshot carries an active command surface. */
    address?: { epoch: number; wave: number; pokemonId: number } | undefined;
  }[];
}

/** Exact host-owned control statement for the current (or most recently resolved) Mystery encounter. */
export interface CoopActiveMysteryEncounterSnapshotV1 {
  version: 1;
  interactionCounter: number;
  /** Monotonic revision within this pinned interaction counter. */
  revision: number;
  /** Monotonic selector/sub-screen round (repeated Delve/Safari rounds never reuse one). */
  round: number;
  /** Next guest-owner top-level/repeated pick ordinal accepted by the host. */
  nextPickStep?: number | undefined;
  /** Next guest-owner party/secondary/catch-full ordinal accepted by the host. */
  nextSubPickStep?: number | undefined;
  /** Exact Colosseum between-round control, when this Mystery is the multi-battle gauntlet. */
  colosseum?:
    | {
        /** Board round the guest loop must await or resume next. */
        expectedRound: number;
        /** Currently published board; omitted after its CONTINUE transition boots successfully. */
        boardRound?: number | undefined;
        /** Exact committed choice for boardRound, if the owner already decided. */
        decision?: { round: number; index: number; operationId: string } | undefined;
      }
    | undefined;
  /** `pending` means the exact terminal is not committed yet; the guest must remain in the event. */
  terminal: "pending" | "leave" | "battle";
  /** Exact committed ME_TERMINAL operation. Required for a non-pending terminal. */
  terminalOperationId?: string | undefined;
  /** ME_TERMINAL step (battle=0, post-battle leave=1; normal leave=0). */
  terminalStep?: number | undefined;
  /** Exact choice delivered by the journal materializer for this terminal. */
  terminalChoice?: number | undefined;
  /** Host turn carried by a battle-handoff terminal, when one has been committed. */
  hostTurn?: number | undefined;
  /** Wave-scoped battle handoff state, used to distinguish a selector from the spawned ME battle. */
  handoffWave?: number | undefined;
  /** Host phase at atomic capture; prevents an old selector from reopening after its choice was consumed. */
  hostPhaseName?: string | undefined;
  /** Last host-rendered event screen/sub-screen. Plain JSON; safe to replay after a channel replacement. */
  presentation?: Extract<CoopInteractionOutcome, { k: "mePresent" }> | undefined;
}

/**
 * Seating-only field entry for the normal authoritative turn payload. The live
 * per-mon state rides through `PokemonData.summonData`; do not add lossy tag or
 * stat overlays here.
 */
export interface CoopAuthoritativeFieldSeat {
  side: "player" | "enemy";
  /** Battler index at this battle-format slot. */
  bi: number;
  /** Index in the owning party array. */
  partyIndex: number;
  /** Host-stable Pokemon identity copied through PokemonData. */
  pokemonId: number;
  /**
   * Whether this logical active-slot Pokemon is actually presented in the host's Phaser field container at
   * this boundary. `field` deliberately includes just-fainted and pre-intro slot occupants for data
   * convergence; presentation must not infer visibility from that logical list.
   */
  presented: boolean;
  owner?: CoopRole;
  /** Enemy boss active segment index, if not covered by PokemonData. */
  bossSegmentIndex?: number;
}

/** Normal-turn host-authoritative battle/run state, versioned for additive rollout. */
export interface CoopAuthoritativeBattleStateV1 {
  version: 1;
  tick: number;
  wave: number;
  turn: number;
  /** Host battle geometry; changes during the classic finale's single -> double transition. */
  double?: boolean;
  /** Plain JSON `PokemonData[]`, authoritative order. */
  playerParty: Record<string, unknown>[];
  /** Plain JSON `PokemonData[]`, authoritative order. */
  enemyParty: Record<string, unknown>[];
  /** Seating only; mon state is in the matching PokemonData entry. */
  field: CoopAuthoritativeFieldSeat[];
  weather: number;
  weatherTurnsLeft: number;
  terrain: number;
  terrainTurnsLeft: number;
  arenaTags: CoopSerializedArenaTag[];
  money: number;
  score?: number;
  pokeballCounts: [number, number][];
  /** Full PersistentModifier blobs, including held items. */
  playerModifiers: Record<string, unknown>[];
  /** Full enemy PersistentModifier blobs, including held items. */
  enemyModifiers: Record<string, unknown>[];
  biomeId?: number;
  seed?: string;
  waveSeed?: string;
  erMoneyStreaks?: [number, number][] | undefined;
  biomeOverstayAnchor?: number | null | undefined;
  erRelicBattleState?: ErRelicBattleStateData | undefined;
  /** #486 biome-structure EXTENT (rolled length + start wave); healed via restoreErBiomeStructure (audit #841 item 5). */
  erBiomeStructure?: { biomeLength: number | null; biomeStartWave: number } | undefined;
  /**
   * #865 ER world-map state (revealed nodes / travel target / fragments / journey) carried per-turn so the
   * guest ADOPTS the host's map state (via restoreErMapState) BEFORE it hashes its saveDataDigest -
   * adopt-then-hash convergence, so the widened erMapState digest never trips a per-turn assertion. Optional
   * + additive.
   */
  erMapState?: ErMapSaveData | undefined;
  /**
   * #865 the routing pending-node set (getErPendingNodes) - the biome-travel decision's actual input,
   * adopted per-turn (setErPendingNodes) so the guest's natural single-node terminal is coherent by
   * construction. Optional + additive.
   */
  erPendingNodes?: ErRouteNode[] | undefined;
}

/**
 * One ordered visible thing that happened during a turn. The MVP renders only
 * `message` (narration) and relies on the checkpoint for outcomes; the richer kinds
 * drive per-move animation fidelity in a later pass.
 */
export type CoopBattleEvent =
  /** A battle-log line, ALREADY localized by the host (the guest shows it verbatim). */
  | { k: "message"; text: string }
  /** A mon used a move (cue the "X used Y!" + move animation). */
  | { k: "moveUsed"; bi: number; moveId: number; targets: number[] }
  /** Set + tween a mon's hp to this value. */
  | { k: "hp"; bi: number; hp: number; maxHp: number; sp?: number }
  /**
   * A mon fainted. `narrate` (#691, additive optional) is true IFF the host shows an "X fainted!" message
   * for this KO (a FaintPhase runs - either inline at the damage chokepoint or deferred via the move's
   * MoveEffectPhase.onFaintTarget). The guest regenerates the faint line in its OWN language IFF `narrate
   * === true`, so it narrates exactly the KOs the host narrated. The host SUPPRESSES streaming its own
   * host-language `fainted` message for these, so the guest's regenerated line is the sole copy. Absent on
   * an older host -> the guest treats it as falsy and does not narrate (today's silent behavior); the flag
   * stays on the wire (not hardcoded on the guest) so the gating + forward-compat semantics hold.
   */
  | { k: "faint"; bi: number; narrate?: boolean; sp?: number }
  /** A mon's stat stage changed to this absolute value (`Stat` enum). */
  | { k: "statStage"; bi: number; stat: number; value: number }
  /** A mon's status changed (`StatusEffect` enum, 0 = cured). */
  | { k: "status"; bi: number; status: number }
  /** Weather changed (`WeatherType` enum). */
  | { k: "weather"; weather: number; turnsLeft: number }
  /** Terrain changed (`TerrainType` enum). */
  | { k: "terrain"; terrain: number; turnsLeft: number }
  /** A mon switched out for the party member at `partySlot`. */
  | { k: "switch"; bi: number; partySlot: number };

// =============================================================================
// Host-authoritative INTERACTION OUTCOME (#633, TRACK-2 Phase C). Today the owner
// relays only a CHOICE INDEX into a pool BOTH clients regenerate identically; if the
// pools ever diverge (the same RNG-order / stale-build / locale drift Phases A/B
// defeat for battle) the index applies to a DIFFERENT pool -> a different item. The
// fix: the OWNER's client resolves the pick against the HOST's pool and STREAMS the
// authoritative OUTCOME, which the watcher adopts verbatim - so the watcher's own pool
// can never change the result. Plain JSON (enum VALUES / registry id strings, never
// engine TYPES), so the transport stays the lowest layer; the engine-coupled
// (de)serialization lives in the reward/ME phases.
// =============================================================================

/**
 * #818 co-op quiz mirroring: a structural, fully-serializable copy of ErQuizQuestion's fields. The
 * host streams a whole quiz session (see the `mePresent` `subPrompt` `quiz` variant below) so BOTH
 * clients render the SAME quiz off it. This mirrors ErQuizQuestion field-for-field but is kept INLINE
 * here (NOT imported from er-quiz.ts) so the transport stays engine-free - the lowest layer never pulls
 * in the quiz engine / species / modifier registries. `kind` is a bare string (not the ErQuizKind
 * union) for the same reason. If ErQuizQuestion grows a field this mirror follows it.
 */
export interface CoopQuizWireQuestion {
  kind: string;
  answerId: number;
  options: number[];
  prompt: string;
  cipherWord?: string;
  cipherOptions?: string[];
  itemIconFrame?: string;
  itemName?: string;
  itemId?: string;
  itemOptions?: string[];
}

/** The authoritative outcome of one owner interaction pick, adopted by the watcher. */
export type CoopInteractionOutcome =
  /**
   * An item / modifier was granted. `modifierTypeId` is the registry key string (the same
   * stable identity the checksum hashes in `modifiers: [string, number][]`); `args` carries
   * the modifier-type generator scalars (empty for the common case); `partySlot` is the
   * target party slot (-1 for a non-party item); `moneyDelta` is the signed money change.
   */
  | { k: "rewardGrant"; modifierTypeId: string; args: number[]; partySlot: number; moneyDelta: number }
  /** A reroll happened: no item, just the signed money change (the watcher never recomputes the fee). */
  | { k: "reroll"; moneyDelta: number }
  /** The owner left the screen with no further outcome (a terminal). */
  | { k: "leave" }
  /**
   * Co-op authoritative non-battle ME (#633 BLOCK-2 / P0): the HOST streams its authoritative
   * encounter PRESENTATION so the guest renders off it instead of its own diverged party
   * re-derivation. `tokens` is the flat dialogue-token map (itemName, selectedPokemon, ...);
   * `meetsReqs[i]` / `labels[i]` are the host-resolved per-option enablement + button label.
   * The optional `subPrompt` is streamed as a FOLLOW-UP `mePresent` right before the host opens
   * an engine sub-prompt (party target / secondary menu), telling the guest which local capture
   * screen to open. The `quiz` variant (#818) instead streams a WHOLE ErQuizPhase session (its
   * questions + stopOnWrong) so both clients run the identical quiz. The `catchFull` variant (#855)
   * is streamed when an ME GRANTS a mon while the party is full: the guest (the ME owner) drives the
   * real replace-or-skip picker and relays the chosen slot; the host applies the release+add
   * authoritatively (`pokemonName` is only for the guest's party-full text). Plain JSON only (strings /
   * booleans / the inline `CoopQuizWireQuestion`), no engine types.
   */
  | {
      k: "mePresent";
      tokens: Record<string, string>;
      meetsReqs: boolean[];
      labels: string[];
      subPrompt?:
        | { kind: "party" }
        | { kind: "secondary"; labels: string[] }
        | { kind: "quiz"; questions: CoopQuizWireQuestion[]; stopOnWrong: boolean }
        | { kind: "catchFull"; pokemonName: string };
    }
  /**
   * Co-op authoritative non-battle ME (#633 B2 / MAJOR-2 / P4): the comprehensive ME-terminal
   * resync the HOST sends UNCONDITIONALLY after all side effects so the guest's party / save data
   * / RNG cursor / dex converge with the sole-engine host. `base` is the existing full-battle
   * snapshot (field / arena / money / modifier counts) or null when there is no live field;
   * `party[i]` is one serialized {@linkcode PokemonData} JSON string (full per-mon, applied
   * field-by-field onto the live mon); `meSaveData` is the JSON of
   * `mysteryEncounterSaveData.encounteredEvents` (ME tier weighting); `seed` / `waveSeed` are the
   * run-RNG cursor; `dex` is the lz-string-compressed, bigint-safe dex / starter blob
   * ({@linkcode captureCoopDexDelta}). All strings / scalars, no engine types - bigint round-trips
   * via string.
   */
  | {
      k: "meResync";
      base: CoopFullBattleSnapshot | null;
      party: string[];
      meSaveData: string;
      seed: string;
      waveSeed: string;
      dex: string;
      /**
       * #838 UNIFY: the id-based authoritative full-state (captured off-field too, unlike `base`). When
       * present the guest adopts the ME-terminal party / field / arena / modifiers / substrates via the
       * SAME apply the live turns use (mutate-in-place by `Pokemon.id`), replacing the species-based
       * `party` reconcile + `base` species-order/benchParty heal. Optional + additive: an older host omits
       * it and the guest falls back to `base` + `party`.
       */
      authoritativeState?: CoopAuthoritativeBattleStateV1 | undefined;
    }
  /**
   * Co-op AUTHORITATIVE move-learn forward (#633 BUG3+5): the HOST is the sole engine, but a
   * GUEST-owned mon's "which move to forget" pick belongs to the human who owns that mon. When the
   * host's {@linkcode LearnMovePhase} reaches a full-moveset GUEST-owned mon it streams this prompt
   * to the guest (on the disjoint 9_100_000 + partySlot channel) and awaits the guest's chosen
   * forget-slot; the guest opens the real picker, relays an index, and the host applies it (or, on a
   * timeout / disconnect, keeps the mon's current moves). All scalars, no engine types - additive, so
   * an older client harmlessly ignores an unknown `k`.
   *  - `partySlot`    the learning mon's party slot (the guest resolves the SAME Pokemon).
   *  - `moveId`       the move id being learned (cosmetic on the guest; the host applies it).
   *  - `maxMoveCount` the mon's move-slot cap == the "did not learn" sentinel index.
   */
  | { k: "learnMoveForward"; partySlot: number; moveId: number; maxMoveCount: number }
  /**
   * Co-op AUTHORITATIVE batch level-up Move Learn present (#848): the HOST is the sole engine, but the
   * ER batch Move Learn panel is now the SHARED co-op level-up path (owner drives, watcher mirrors) instead
   * of the per-move LearnMovePhase bypass. When the host's {@linkcode LearnMoveBatchPhase} opens the panel
   * it streams this present so the PARTNER opens the SAME panel (on the disjoint 9_150_000 + partySlot
   * channel). The mon's OWNER drives it; the other client renders it as a read-only watcher and both close
   * together on the relayed terminal ({@linkcode CoopInteractionChoice} kind `learnMoveBatch`). All scalars /
   * flat arrays, no engine types - additive, so an older client harmlessly ignores an unknown `k`.
   *  - `partySlot`    the learning mon's party slot (the partner resolves the SAME Pokemon).
   *  - `learnableIds` the offerable new-move ids for this level-up (already de-duped / known-filtered).
   *  - `ownerIsGuest` whether the mon's owner is the GUEST (so the guest drives + relays; else it watches).
   */
  | { k: "learnMoveBatchForward"; partySlot: number; learnableIds: number[]; ownerIsGuest: boolean }
  /**
   * Co-op shared acquisition (#794): the HOST (sole engine) streams its dex / starter blob
   * ({@linkcode captureCoopDexDelta}) right after ANY acquisition event (wild catch, DexNav
   * grant, ME-granted mon) so the partner's ACCOUNT gets the same dex credit + shiny-variant
   * unlocks immediately - not only at the next ME terminal. Throttled sender; merge-only apply.
   */
  | { k: "dexSync"; dex: string };

/**
 * How a wave's battle ended (#633, authoritative wave-advance handshake). The host
 * resolves the battle end (it is the sole engine) and tells the guest WHY so the guest
 * runs the matching post-battle tail:
 *  - `win`      every enemy was KOd (the host's `VictoryPhase` wave-clear branch)
 *  - `capture`  the active wild enemy was caught (`AttemptCapturePhase`)
 *  - `flee`     the player fled / the enemy fled (reserved; not yet emitted)
 *  - `gameOver` the run ended (the host's `GameOverPhase`)
 */
export type CoopWaveOutcome = "win" | "capture" | "flee" | "gameOver";

/**
 * Co-op authoritative CAPTURE PRESENTATION (#689): the tiny cosmetic payload the HOST streams
 * alongside a `waveResolved("capture")` so the GUEST - a pure renderer that never runs the
 * host-only `AttemptCapturePhase` - can play the ball-throw animation and show a LOCALLY-localized
 * "X was caught!" line. PRESENTATION ONLY: the authoritative party / dex state still rides
 * `captureParty` + the checkpoint; this only drives the cosmetic ball animation + message. A
 * SUCCESSFUL catch is the only thing that ever broadcasts `waveResolved("capture")`, so there is
 * no "broke free" arm on the wire (a challenge-blocked catch is host-gated to NOT carry this).
 * All plain JSON (enum VALUES / ids), so the transport stays the lowest layer.
 */
export interface CoopCapturePresentation {
  /** `PokeballType` enum value the ball animation renders. */
  pokeballType: number;
  /** `BattlerIndex` the ball was thrown at (a cosmetic throw-anchor only; never mutated). */
  targetBattlerIndex: number;
  /** Root `speciesId` for the LOCALLY-localized "X was caught!" line (guest's own language). */
  speciesId: number;
}

/**
 * The co-op wire protocol: a discriminated union on `t`. This GROWS per
 * implementation phase. Rule: every addition is a NEW `t` value with a typed
 * payload, so a client can ignore an unknown kind gracefully (clients are also
 * version-gated at pairing, but forward-compat keeps reconnects safe).
 */
export type CoopMessage =
  /**
   * Handshake on connect: protocol/game version + the sender's account name + role.
   * `tiebreak` (#633) is a per-client random nonce used to DETERMINISTICALLY resolve a
   * role CONFLICT: if the lobby ever assigns both clients the same role, each side
   * independently picks host = the lower tiebreak, so exactly one drives field slot 0
   * and the other slot 1 (without it, both await the other slot and the turn stalls).
   * Optional + additive (older clients omit it; reconciliation then falls back to name).
   *
   * `capabilities` (#896 W2e-R2, additive optional) is the sender's advertised co-op CAPABILITY set -
   * the string-keyed feature bits (e.g. "opSurface.biome", "renderer.allowlistEnforce"). Each peer
   * advertises what it supports; the effective session capabilities are the INTERSECTION of both sets,
   * computed identically on both sides (see coop-capabilities.ts). A surface activates ONLY if its
   * capability is negotiated, so a flag-flip / mixed build can never activate a surface on one peer
   * only. ABSENT on an older client -> treated as the empty set (all negotiated features off, legacy
   * paths engaged) - so this stays additive-optional and needs no COOP_PROTOCOL_VERSION bump.
   */
  | {
      t: "hello";
      version: string;
      username: string;
      role: CoopRole;
      tiebreak?: number;
      capabilities?: string[];
      /** Host-minted control-plane epoch; the guest adopts and echoes it before operations begin. */
      epoch: number;
      /** Host-authored persistence identity; absent only from the guest before it adopts the host. */
      runId?: string;
      checkpointRevision?: number;
    }
  /** Authenticated public P33 hello. The signaling bearer is intentionally never peer-visible. */
  | {
      t: "hello";
      version: "er-coop-33";
      pairingId: string;
      account: CoopAccountIdentityV1;
      transportRole: CoopTransportRole;
      authorityClaim: CoopAuthorityRole;
      capabilities: string[];
      existingBinding?: {
        sessionId: string;
        runId?: string;
        sessionEpoch: number;
        seatMapId: string;
        authoritySeatId: CoopSeatId;
        membershipRevision: number;
      };
    }
  /** Authority-authored immutable session binding. Retained and replayed until the exact peer ACKs. */
  | { t: "sessionBinding"; binding: CoopSessionBindingV1 }
  | {
      t: "sessionBindingAck";
      bindingId: string;
      seatId: CoopSeatId;
      accountId: string;
      accepted: boolean;
      reason?: "identity" | "seat-map" | "authority" | "stale" | "unsupported";
    }
  /** Keepalive / latency probe. */
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  /**
   * Host -> peer: the partner's field slot needs a command this `turn`. The host
   * is authoritative, so it sends the LEGAL move slots (indices into the partner
   * mon's moveset) it computed; the peer just picks one and replies with a
   * `command`. `moveSlots` empty => only Struggle is legal (#633, LIVE-C).
   *
   * `owner` (#851, additive optional) is the sender's RESOLVED `coopOwner` role for the
   * awaited slot (`coopOwnerOfPlayerFieldSlot(fieldIndex)`). After a host-half-wipe recenter
   * + party compaction the SURVIVOR sits at DIFFERENT field indexes on the two engines (the
   * host compacted; the guest's reconcile lags a beat), so the legacy `fieldIndex`-only match
   * key never matches and the request times out (the 20-min stall). The owner is STABLE across
   * that divergent geometry, so both clients key the relay on it and the reply matches despite
   * the index skew. Absent on an older client -> the receiver falls back to the `fieldIndex`
   * key (version-handshake safe: paired clients share COOP_PROTOCOL_VERSION, so it is present
   * on both or neither).
   */
  | {
      t: "commandRequest";
      fieldIndex: number;
      turn: number;
      moveSlots: number[];
      offer?: CoopBattleCommandOffer | undefined;
      owner?: CoopRole;
      epoch?: number;
      wave?: number;
      pokemonId?: number;
    }
  /**
   * A player's battle command for their own field slot (phase P2 / LIVE-C reply). `owner`
   * (#851, additive optional) mirrors {@linkcode commandRequest}'s owner: the sender's resolved
   * `coopOwner` for the slot, so the awaiter matches by OWNER (stable across a post-half-wipe
   * index skew) instead of the raw `fieldIndex`. Absent on an older client -> fieldIndex fallback.
   */
  | {
      t: "command";
      fieldIndex: number;
      turn: number;
      command: SerializedCommand;
      decline?: boolean;
      owner?: CoopRole;
      epoch?: number;
      wave?: number;
      pokemonId?: number;
    }
  /** Host -> peer: its command was invalid; host committed the deterministic legal default for this address. */
  | {
      t: "commandRejected";
      fieldIndex: number;
      turn: number;
      reason: string;
      owner?: CoopRole;
      epoch?: number;
      wave?: number;
      pokemonId?: number;
    }
  | { t: "stallBeat"; waitingMs: number }
  /**
   * Either client -> peer (#839, reciprocal rendezvous barrier): "I reached sync `point`". A named
   * two-sided ready handshake SEPARATE from the interaction alternation counter (the counter says WHO
   * picks; this says WHEN both may proceed). Neither client crosses a barrier point until it has ALSO
   * seen the partner's arrival for the same `point`. Idempotent (a re-sent arrival for a point already
   * seen is a no-op) and buffer-safe (an arrival that lands before the peer installs its waiter is
   * remembered). Points today: `cmd:<wave>:<turn>` (next-command-open) and `shop:<wave>:<counter>`
   * (shop-pick-commit). See coop-rendezvous.ts.
   */
  | { t: "rendezvous"; point: string }
  /** Host-authoritative branch selection when peers reach different rendezvous points. */
  | { t: "phaseRoute"; epoch: number; revision: number; point: string; displacedPoint: string }
  /** Guest confirms it adopted a host phaseRoute revision. */
  | { t: "phaseRouteAck"; epoch: number; revision: number }
  /** #809: host asks the partner to pick a Revival Blessing target for its own mon. */
  | { t: "revivalPrompt"; fieldIndex: number; operationId?: string | undefined }
  /**
   * #856: host asks the CATCHER (the partner who threw the ball) to drive the FULL-party keep/release
   * picker for a successful wild catch. The recipient opens the real replace-or-skip picker and relays the
   * chosen party slot on {@linkcode COOP_CATCH_FULL_SEQ}; the host applies the authoritative release+add.
   * `speciesId` is the caught mon's root species (for a locally-localized picker header on the recipient).
   */
  | { t: "catchFullPrompt"; pokemonName: string; speciesId: number; operationId?: string | undefined }
  /** #810 resume flow: host offers to resume the saved run with this partner at `wave`. */
  | { t: "meCursor"; index: number }
  | { t: "resumeOffer"; decisionId: string; epoch: number; commitment: CoopResumeCommitment }
  /** #810 resume flow: guest's answer to the offer. */
  | { t: "resumeReply"; decisionId: string; accept: boolean }
  /** Host -> guest: the exact ACCEPT reply was committed and the cold-resume epoch is authoritative. */
  | { t: "resumeAccepted"; decisionId: string; epoch: number; commitment: CoopResumeCommitment }
  /** Guest -> host: the committed resume snapshot finished materializing (or failed closed). */
  | { t: "resumeApplied"; decisionId: string; success: boolean }
  /** Host -> guest: the apply result is durably observed; guest may clear its reconnect outbox. */
  | { t: "resumeAppliedAck"; decisionId: string }
  /** Host -> guest: both snapshots are materialized; guest may cross the final gameplay barrier. */
  | { t: "resumeRelease"; decisionId: string }
  | { t: "resumeReleaseAck"; decisionId: string }
  /** Host -> guest: a discovered save exists but cannot be mapped safely; both remain out of gameplay. */
  | { t: "resumeBlocked"; decisionId: string; reason: CoopResumeBlockedReason; wave: number }
  | { t: "resumeBlockedAck"; decisionId: string }
  /** Host persistence mirror: exact authoritative checkpoint bytes for the guest's own account/slot. */
  | {
      t: "resumeCheckpoint";
      checkpointId: string;
      commitment: CoopResumeCommitment;
      session: string;
      /** True only when this host save is also on the normal throttled cloud-checkpoint cadence. */
      mirrorCloud: boolean;
    }
  | {
      t: "resumeCheckpointAck";
      checkpointId: string;
      success: boolean;
      reason?: CoopResumeCheckpointNackReason;
    }
  /**
   * #810 resume flow (barrier): host tells the guest "no resume - proceed to a NEW game".
   * Sent whenever the host will NOT resume (no matching save, host picked New Game, guest
   * declined, or the offer timed out), so the guest never sits blocked waiting for an offer
   * that will never come. The guest treats it as the release signal for its wait barrier.
   */
  | { t: "resumeStartNew"; decisionId: string; epoch: number; runId: string; checkpointRevision: number }
  /** Guest -> host: the exact start-new decision was applied to the lobby UI, so the host may enter team select. */
  | { t: "resumeDecisionAck"; decisionId: string }
  /** A forced/voluntary switch replacement: bring in party `partySlot` to `fieldIndex` (P2). */
  | { t: "switchChoice"; fieldIndex: number; partySlot: number }
  /**
   * A player's full starter-select snapshot during co-op selection (phase P1).
   * Each player picks on THEIR OWN screen independently; this mirrors that state
   * to the partner so the UI can show "Partner is choosing... / Partner is ready"
   * without sharing a screen. `entries` is the partner's tentative roster (shape
   * mirrors `CoopRosterEntry`; inlined to keep the protocol the lowest layer with
   * no import cycle); `ready` flips true when they lock in.
   *
   * Each entry MAY carry the partner's FULL `starter` blob (#633, LIVE-B): the
   * complete serialized starter (form / IVs / nature / ability / moves / ...) so
   * the receiving client rebuilds the partner's mons EXACTLY, not from defaults.
   * Optional + additive: during early selection only speciesId+cost are known, and
   * older clients ignore the extra field gracefully.
   */
  | {
      t: "rosterSync";
      role: CoopRole;
      entries: { speciesId: number; cost: number; starter?: CoopSerializedStarter }[];
      ready: boolean;
      /**
       * #896 W2e-R2 (additive optional): the sender's advertised co-op capability set, mirrored from
       * `hello`. Carried here too so a `hello` lost on a channel flap still lets the peer negotiate off
       * the self-healing roster re-broadcast (#868). Absent on an older client -> empty set (legacy).
       */
      capabilities?: string[];
    }
  /**
   * Host -> guest: the AUTHORITATIVE run configuration both players share (#633,
   * LIVE-C). The host decides the ER difficulty (youngster/ace/elite/hell) and the
   * challenge set; the guest mirrors them so the run is coherent (the guest never
   * picks its own). `challenges` is the serialized challenge list ({id,value,severity}).
   *
   * `seed` (#633, LIVE-A) is the HOST's run seed: the guest pins its engine to the
   * SAME seed so both clients roll identical enemies / RNG and stay in lockstep.
   * Optional + additive (older clients fall back to their own seed).
   *
   * `netcodeMode` (#633, selectable A/B) is the HOST's chosen co-op netcode
   * (`"lockstep"` | `"authoritative"`); the guest adopts it so both run the same
   * implementation. Optional + additive (an absent value means `"lockstep"`, the
   * default - so an in-flight save from before this field stays valid). */
  | {
      t: "runConfig";
      difficulty: string;
      challenges: { id: number; value: number; severity: number }[];
      seed?: string;
      netcodeMode?: CoopNetcodeMode;
      /**
       * Showdown 1v1 PvP (C1): the session kind the host pins so the guest adopts it.
       * Optional + additive (absent -> `"coop"`, so an older peer / in-flight save stays
       * valid and unaffected).
       */
      kind?: CoopSessionKind;
    }
  /**
   * Guest -> host (#633): "(re)send me the runConfig". The host broadcasts `runConfig`
   * ONCE when it picks difficulty; if that single message is dropped or mistimed the
   * guest would wait forever on its "choosing difficulty" screen. So the waiting guest
   * actively (re)requests until it lands, and the host re-broadcasts on every request -
   * a self-healing handshake (harmless no-op before the host has picked).
   */
  | { t: "requestRunConfig" }
  /**
   * Either client -> peer (#868 self-healing lobby handshake): "(re)send me your roster + ready".
   * The SYMMETRIC counterpart of {@linkcode requestRunConfig} for the OTHER lobby-critical state.
   * A player's `rosterSync` (their picks + the `ready` lock-in) is broadcast ONE-SHOT when they
   * lock in; if that single frame is lost (dropped on a channel flap, or sent while the transport
   * was momentarily down), the PARTNER's `partnerReady` stays false forever and the run never
   * launches (the live "partner got kicked, no players showing" / "stuck at starter-select" strand).
   * So a waiting client re-requests the peer's roster and the peer re-broadcasts it on every request
   * (a harmless idempotent snapshot re-send) - the roster/ready direction now heals like runConfig.
   */
  | { t: "requestRoster" }
  /** A choice on an alternation-owned interaction screen (reward / shop / ME) (P4). */
  | { t: "interaction"; screen: string; choice: unknown }
  /** Ask the peer to replay its current interaction counter; `need` is diagnostic and monotonic. */
  | { t: "requestInteractionCounter"; need: number }
  /**
   * Host -> guest (#633, TRACK-2): the AUTHORITATIVE full battle snapshot, sent to HEAL
   * a checksum mismatch. `blob` is an lz-string-compressed JSON {@linkcode CoopFullBattleSnapshot}
   * the guest decompresses + adopts field-by-field (never a session reload mid-battle).
   * `seq` echoes the `requestStateSync` it answers, so a stale reply is ignored.
   */
  | { t: "stateSync"; blob: string; seq: number }
  /**
   * Guest -> host (#633, TRACK-2): "my post-turn checksum disagreed with yours at `turn`;
   * send me the authoritative full state". `seq` is a monotonic guest-side counter so the
   * host's `stateSync` reply can be matched + a stale one dropped (one request in flight).
   */
  | { t: "requestStateSync"; turn: number; seq: number }
  /**
   * Host -> guest (#633, LIVE-D): the EXACT enemy party the host generated for this
   * `wave`. The guest adopts these verbatim instead of regenerating (so it never rolls
   * its own enemy species/ability/IVs). Sent at encounter start.
   */
  | {
      t: "enemyPartySync";
      wave: number;
      enemies: CoopSerializedEnemy[];
      meType?: number;
      battleType?: number;
      /** Complete encounter identity; required by the er-coop-21 production sender. */
      encounter?: CoopEncounterAuthority;
      /** Complete host state at the new-wave encounter boundary; additive for older peers. */
      authoritativeState?: CoopAuthoritativeBattleStateV1;
    }
  /**
   * Guest -> host (#633/#698, enemy-party handoff robustness): "(re)send me the enemy party
   * for `wave`". The host broadcasts `enemyPartySync` ONCE inside its EncounterPhase, AFTER the
   * trainer/enemy assets load; if that single message is lost on the wire (or the host is still
   * loading and has not broadcast yet), the waiting guest would otherwise hard-block the full
   * 120s ceiling. So the guest re-requests on a short interval and the host re-broadcasts the
   * moment its party for that wave exists - a self-healing handshake (a harmless no-op before
   * the host has generated, and the parked guest waiter still consumes the eventual broadcast).
   */
  | { t: "requestEnemyParty"; wave: number }
  /**
   * Host -> guest (#633, M4 push-snapshot launch): the AUTHORITATIVE full session snapshot at
   * the launch (and every hard-transition) boundary. `session` is a JSON-serialized
   * {@linkcode SessionSaveData} (the host's `getSessionSaveData()` - the SAME complete serializer
   * cloud-save + resume ride on), keyed by `wave` so a stale wave's snapshot is never adopted.
   * The guest does NOT roll its own enemy / arena / party at launch: it BOOTS from this snapshot
   * via the heavy session-restore apply (`applyCoopLaunchSession`) and lands already synced - so it
   * computes NOTHING that could diverge (§3.6). Pushed the instant the host's session is coherent
   * (its EncounterPhase), replacing the narrow `enemyPartySync` + the `requestEnemyParty` poll.
   */
  | { t: "launchSnapshot"; wave: number; session: string }
  | {
      t: "launchSnapshotAbort";
      wave: number;
      reason: CoopLaunchSnapshotAbortReason;
    }
  /** Guest -> host: re-send the cached authoritative launch/resume snapshot for this exact wave. */
  | { t: "requestLaunchSnapshot"; wave: number }
  /**
   * Host -> guest (#633, authoritative ME battle handoff): the EXACT enemy party the host
   * generated for a mystery-encounter-SPAWNED battle. Unlike `enemyPartySync` (keyed by the
   * wave's starting encounter), an ME battle spawns MID-wave from an option pick, so it is
   * keyed by an ME-interaction `key` (see `meBattleHandoffKey`: waveIndex + the ME interaction
   * counter) - two ME battles in the same wave never collide, and a stale wave's party is never
   * adopted. The guest (which forwarded its option pick when it owned the ME) discards its own
   * locally-rolled party and adopts these verbatim, so the spawned boss is identical + the
   * battle is host-authoritative regardless of who OWNED the encounter.
   */
  | { t: "meBattleEnemyPartySync"; key: string; enemies: CoopSerializedEnemy[] }
  /** Guest -> host: replay the retained authoritative ME-battle party for this exact interaction key. */
  | { t: "requestMeBattleEnemyParty"; key: string }
  /**
   * Host -> guest (#633): the host's fetched GHOST-TEAM POOL. Ghost teams are pulled
   * per-client from the shared server pool, so the two clients otherwise download
   * DIFFERENT teams and field divergent ghost trainers (desync). The host broadcasts
   * its pool once (on prefetch-resolve, well ahead of the first ghost wave); the guest
   * adopts it verbatim and skips its own fetch, so `takeGhostForWave`'s seeded pick is
   * deterministic on both. `pool` is plain-JSON `GhostTeamSnapshot[]` (type-only import,
   * no value dependency, so the transport stays the lowest layer).
   */
  | { t: "ghostPool"; pool: GhostTeamSnapshot[] }
  /**
   * Host -> guest (#633, animation layer - LIVE): ONE visible battle event emitted the INSTANT
   * the host records it (a move / per-hit hp / faint / stat change), so the guest can WATCH the
   * fight unfold with minimal lag instead of waiting for the whole turn to batch at turn-end.
   * Mirrors the cosmetic {@linkcode uiInput} ordering: `turn` scopes the event to its turn and
   * `seq` is a PER-TURN MONOTONIC index so the guest replays them in exact order and DE-DUPES
   * against the batch the turn-end `turnResolution` also carries (a live event already played is
   * skipped). PRESENTATION ONLY - the authoritative post-turn CHECKPOINT in `turnResolution` is
   * still the source of truth, so a dropped / reordered / late `battleEvent` only stutters the
   * animation; it can never desync the guest (the checkpoint reconciles all state).
   */
  | { t: "battleEvent"; epoch: number; wave: number; turn: number; seq: number; event: CoopBattleEvent }
  /**
   * Host -> guest (#633, LIVE-D): a fully-resolved turn. `events` is the ordered visible
   * log the guest narrates/animates; `checkpoint` is the AUTHORITATIVE post-turn state the
   * guest applies so it can never drift. The guest computes none of this itself.
   *
   * `checksum` (#633, TRACK-2) is the host's 64-bit fingerprint of its FULL post-turn
   * state (computed at the SAME boundary the guest reads). The guest recomputes its own
   * and, on a mismatch, requests a `stateSync`. Required (the host always stamps it).
   *
   * `preimage` (#633, diagnostics) is the host's CANONICAL state string the `checksum` was
   * hashed from. Protocol 31 requires it so the guest can deep-DIFF the host pre-image against
   * its own and log the exact divergent fields. Older clients are rejected during negotiation.
   */
  | {
      t: "turnResolution";
      epoch: number;
      wave: number;
      turn: number;
      /** Commit identity; equal to authoritativeState.tick for protocol 32. */
      revision: number;
      events: CoopBattleEvent[];
      checkpoint: CoopBattleCheckpoint;
      checksum: string;
      preimage: string;
      /**
       * The host's COMPLETE per-mon on-field snapshot (#633 M2): heals the on-field state the numeric
       * `checkpoint` omits (moveset+PP / tera / boss / held items / ability / form) IN-LINE each turn.
       * Required by protocol 31.
       */
      fullField: CoopFullMonSnapshot[];
      /**
       * Full normal-turn authoritative state. Version 1 uses PokemonData.summonData
       * for live mon state and keeps field data seating-only.
       */
      authoritativeState: CoopAuthoritativeBattleStateV1;
    }
  /**
   * Host -> guest (#633, LIVE-D): an out-of-turn authoritative checkpoint (after a
   * switch / capture / encounter start / resume). `reason` is a short tag for logging.
   * `checksum` (#633, TRACK-2): the host's full-state fingerprint at this boundary.
   */
  | {
      t: "battleCheckpoint";
      reason: string;
      epoch: number;
      wave: number;
      turn: number;
      /** Commit identity; equal to authoritativeState.tick for protocol 32. */
      revision: number;
      checkpoint: CoopBattleCheckpoint;
      checksum: string;
      /** Complete per-mon field companion for modern out-of-band authority frames. */
      fullField: CoopFullMonSnapshot[];
      authoritativeState: CoopAuthoritativeBattleStateV1;
    }
  /** Guest -> host: request the exact retained turn commit, or learn that the host is still resolving it. */
  | { t: "requestTurnCommit"; epoch: number; wave: number; turn: number; revision?: number }
  | { t: "turnCommitPending"; epoch: number; wave: number; turn: number }
  /** Guest -> host: one ordered protocol-33 evidence stage for an exact retained turn commit. */
  | {
      t: "turnCommitAck";
      epoch: number;
      wave: number;
      turn: number;
      revision: number;
      checkpointTick: number;
      stateTick: number;
      checksum: string;
      stage: CoopAuthorityAckStage;
      status: "applied" | "superseded";
      supersededByRevision?: number;
      supersededByChecksum?: string;
    }
  /** Guest -> host: re-send one exact retained replacement authority frame. */
  | {
      t: "requestBattleCheckpoint";
      reason: "replacement";
      epoch: number;
      wave: number;
      turn: number;
      revision: number;
      checkpointTick: number;
      stateTick: number;
    }
  /** Guest -> host: one ordered protocol-33 evidence stage for an exact retained replacement commit. */
  | {
      t: "battleCheckpointAck";
      reason: "replacement";
      epoch: number;
      wave: number;
      turn: number;
      revision: number;
      checkpointTick: number;
      stateTick: number;
      checksum: string;
      stage: CoopAuthorityAckStage;
    }
  /** Either peer -> peer: a control-critical authority boundary could not be produced/applied safely. */
  | {
      t: "authorityFailure";
      failureId: string;
      epoch: number;
      wave: number;
      turn: number;
      /** Stream-local terminal revision; positive even when no state carrier could be captured. */
      revision: number;
      boundary: "turnResolution" | "replacement";
      reason: string;
    }
  | {
      t: "authorityFailureAck";
      failureId: string;
      epoch: number;
      wave: number;
      turn: number;
      revision: number;
      boundary: "turnResolution" | "replacement";
    }
  /**
   * P33 retained terminal transaction. Receipt alone is insufficient: the receiver first freezes its
   * gameplay/control plane in the addressed terminal state, then returns `sharedTerminalAck`. The immutable
   * commit survives connection replacement; only `ctx` is refreshed for the authenticated live channel.
   */
  | { t: "sharedTerminal"; ctx: CoopFrameContextV1; commit: CoopSharedTerminalCommitV1 }
  /** Exact evidence that one required seat entered the retained shared terminal transaction. */
  | {
      t: "sharedTerminalAck";
      ctx: CoopFrameContextV1;
      terminalId: string;
      terminalRevision: number;
      targetMembershipRevision: number;
      stage: "terminalEntered";
    }
  /**
   * Owner -> watcher (#633): the owner's pick on an ALTERNATING-control interaction
   * screen (reward shop / biome shop / mystery encounter). Same seed -> both clients
   * generate the IDENTICAL option pool, so only the CHOICE crosses the wire: the
   * watcher applies `choice` to its own identical pool for the identical outcome.
   *  - `seq`    the interaction-counter value this choice belongs to (stale seq ignored)
   *  - `kind`   "reward" | "biomeShop" | "me" (routing / logging)
   *  - `choice` the picked option index, or a sentinel (-1 = leave/skip, -2 = reroll)
   *  - `data`   optional extra indices (e.g. party-target slot, ME sub-option)
   */
  | { t: "interactionChoice"; seq: number; kind: string; choice: number; data?: number[] }
  /**
   * Owner -> watcher (#633, TRACK-2 Phase C): the HOST-resolved AUTHORITATIVE outcome of one
   * interaction pick (reward grant / reroll / leave). The watcher ADOPTS this verbatim instead
   * of re-deriving from its own pool, so a pool divergence can never change the result. Pinned
   * to the SAME `seq` the choice relay uses (the interaction counter at screen-open), so a
   * mid-interaction reconcile can't move the watcher's await off the owner's send seq.
   */
  | { t: "interactionOutcome"; seq: number; kind: string; outcome: CoopInteractionOutcome }
  /**
   * Owner -> watcher (#633, TRACK-2 Phase C): the owner's full-state CHECKSUM at a mystery-
   * encounter boundary (`seq` = the ME interaction seq). The ME pump replays the owner's
   * button stream into the watcher's OWN ME state, which is safe ONLY if that state is
   * identical. The watcher compares this digest to its own; on a MISMATCH it requests the
   * authoritative `stateSync` BEFORE replaying, so the pump's one assumption ("identical ME
   * state") becomes self-checking + self-healing instead of silently corrupting both runs.
   */
  | { t: "meChecksum"; seq: number; checksum: string }
  /**
   * Host -> guest (#633, TRACK-2 Phase C, NON-BATTLE ME narration): one mystery-encounter
   * dialogue/text line the host's authoritative ME engine produced, ALREADY localized by the host
   * (the guest's CoopReplayMePhase queues it verbatim so its screen matches the host-run encounter).
   * Cosmetic only - the reward alternation + the full-state snapshot carry the OUTCOME, so a
   * dropped/late `meMessage` can only blank a narration line, never desync the run.
   */
  | { t: "meMessage"; text: string }
  /**
   * Owner -> watcher (#633 Fix #2): the EXACT reward-screen option list the owner rolled
   * for interaction `seq`. The watcher rebuilds these instead of re-rolling its own pool
   * (party luck would otherwise make the two pools - and the shared RNG cursor - diverge).
   * `reroll` is the reroll round these options belong to (a fresh roll per reroll).
   */
  | { t: "rewardOptions"; seq: number; reroll: number; options: CoopSerializedRewardOption[] }
  /** Watcher -> option owner: replay the exact cached reward/market option payload for this key. */
  | { t: "requestRewardOptions"; seq: number; reroll: number }
  /**
   * Owner -> watcher (#633): a COSMETIC live-cursor button on a shared interaction
   * screen. The watcher replays `button` into its identical screen so the partner
   * sees the cursor move / sub-panels open in real time. This is a VISUAL stream
   * only - the authoritative outcome is still the `interactionChoice` commit, so a
   * dropped/late/out-of-order `uiInput` can never change the run, only stutter the
   * cursor.
   *  - `seq`    the shared-screen session id (matches the interaction-counter)
   *  - `n`      monotonic per-session index (FIFO order; dedup; gap detection)
   *  - `button` the Button enum value the owner pressed
   *  - `mode`   the owner's UiMode BEFORE processing it (resync barrier; the watcher
   *             stops mirroring if its mode no longer matches, then the commit drives)
   */
  | { t: "uiInput"; seq: number; n: number; button: number; mode: number }
  /** Session lifecycle signal (P5). */
  | { t: "lifecycle"; event: CoopLifecycleEvent }
  /**
   * Either client -> peer (#633, diagnostics): this client's ER DATA-TABLE FINGERPRINT,
   * exchanged once on connect. `fp` is the per-section hash of the move id-map / live moves /
   * level-up movesets / abilities tables both clients build at boot. The peer diffs it against
   * its own to surface the ROOT data drift (the "host remapped 67 / guest remapped 1" class)
   * BEFORE any battle runs. Plain JSON; an older client ignores it via the default arm.
   */
  | { t: "dataFingerprint"; fp: ErDataFingerprint }
  /**
   * Host -> guest (#633, authoritative wave-advance handshake): the host RESOLVED the
   * `wave`'s battle end (it is the sole engine). In authoritative netcode the GUEST is a
   * pure renderer that removes KOd enemies WITHOUT a FaintPhase / AttemptCapturePhase, so
   * it never gets the `VictoryPhase` -> `NewBattlePhase` -> next `EncounterPhase` tail those
   * phases queue - it would loop the won wave forever (a HANG). This explicit signal lets
   * the guest run the SAME post-battle tail lockstep co-op runs (queue `VictoryPhase`), so it
   * traverses BattleEnd -> the alternation-relayed reward shop -> biome -> the next encounter.
   * `outcome` is WHY the wave ended (see {@linkcode CoopWaveOutcome}); the guest guards against
   * a double-advance by `wave` (it only runs the tail once per wave number).
   *
   * Co-op (#633 B1/B2/B3 capture handshake): on a `"capture"` outcome the host ALSO carries its
   * full post-catch player party as serialized {@linkcode PokemonData} JSON (`captureParty`). The
   * guest reconciles its bench to match - adding the caught mon (with the host-resolved `coopOwner`,
   * B2) and crediting the catch to its OWN gameData (B3) - because a pure renderer never runs the
   * `AttemptCapturePhase` that grows the party. Absent for non-capture outcomes (a hard no-op).
   *
   * Co-op (#689 capture animation): on a SUCCESSFUL `"capture"` the host ALSO carries a tiny
   * cosmetic {@linkcode CoopCapturePresentation} so the guest plays the ball-throw animation +
   * a locally-localized "X was caught!" line (the guest never runs `AttemptCapturePhase`, which
   * owns that presentation). Host-gated to a KEPT catch only (a challenge-blocked catch omits it,
   * so the guest never shows a "caught!" line for a mon that was not added). Absent otherwise.
   */
  | {
      t: "waveResolved";
      wave: number;
      outcome: CoopWaveOutcome;
      captureParty?: string[] | undefined;
      capturePresentation?: CoopCapturePresentation | undefined;
      /** Complete host-stated post-wave control transition; never re-derived by the authoritative guest. */
      transition?: CoopWaveAdvancePayload | undefined;
    }
  /**
   * Host -> guest (#838 WAVE-END authoritative capture): the COMPLETE post-exp authoritative battle
   * state, captured in the host's `BattleEndPhase` AFTER the wave's whole exp/level/evolution chain
   * drained - so the guest's levels / exp / learned moves / evolved species CONVERGE through the
   * between-wave shop off a single id-based full-state apply ({@linkcode CoopAuthoritativeBattleStateV1}
   * -> `applyCoopAuthoritativeBattleState`). This is the sole post-battle progression channel (the
   * legacy per-slot exp-delta relay it superseded has been removed; an older client ignores an unknown `t`).
   */
  | { t: "waveEndState"; wave: number; state: CoopAuthoritativeBattleStateV1 }
  // ===========================================================================
  // Authoritative CONTROL-plane envelope (Wave-2 run-state migration, §1.1 / §4).
  // ADDITIVE + forward-safe: a client that never learns this `t` value ignores it
  // via the unknown-`t` default arm (the same discipline waveEndState / showdown rely on).
  // Paired clients share COOP_PROTOCOL_VERSION, so a field is present on both or neither
  // (§5.2). Wave-2e SENDS this arm: a committed operation rides it through the durability
  // journal (journalCoopCommittedEnvelope -> CoopDurabilityManager.commit), so it is now
  // received (extractKey/apply in coop-operation-journal.ts) as well as sent - no longer a
  // declared-ahead-of-receiver arm. The legacy relay carrier keeps firing in dual-run (§5.1).
  //
  // WIRE CONSOLIDATION (Wave-2e, §4.6): the doc's envelope-specialized ack/reconnect names
  // (`envelopeAck` / `reconnectSync`) are RETIRED - they never shipped a sender or receiver.
  // The generic W2b `coopAck { cls, seq }` / `coopResync { cls, from }` arms (below) ARE the
  // envelope's ack + reconnect, class-parameterized (the envelope is class "op:<surface>",
  // seq = revision). One ack/reconnect family serves every journaled class.
  // ===========================================================================
  /** Host -> guest: the authoritative control+data envelope broadcast on every commit (§1.1). */
  | { t: "envelope"; envelope: CoopAuthoritativeEnvelopeV1 }
  // ===========================================================================
  // W2b APPLICATION-LEVEL DURABILITY (contract doc §4.2/§4.4): the ACK + reconnect
  // arms of the durability layer. Purely additive `t` values keyed on a GENERIC
  // (class, seq) pair so the Wave-2a operation envelope plugs in later as one
  // journaled class keyed by `revision` (envelopeAck / reconnectSync in the doc are
  // the envelope-specialized names of exactly these). A client that never learns
  // durability ignores them via the unknown-`t` default arm (forward-safe).
  // ===========================================================================
  /**
   * Receiver -> committer (§4.2): a CUMULATIVE acknowledgement that this client has APPLIED committed class
   * `cls` through revision `seq`. The committer tracks it and stops resending everything at/below `seq`;
   * anything above is the resend tail. Cumulative (not per-frame) so it stays cheap on the 5s-keepalive
   * channel - the guest acks its last-applied revision, not every frame.
   */
  | {
      t: "coopAck";
      cls: string;
      seq: number;
      /**
       * Protocol-33 operation-envelope evidence. Absent only for non-operation durability classes and
       * backwards-compatible synthetic durability users. Operation commits are never retired by an ACK
       * without this ordered evidence.
       */
      stage?: CoopAuthorityAckStage;
      operationId?: string;
      epoch?: number;
      wave?: number;
      turn?: number;
      /** The real public surface observed after material application (presentation/final stages only). */
      surface?: CoopOperationContinuationSurface;
      /** Exact authority address at which that public continuation was observed. */
      continuationEpoch?: number;
      continuationWave?: number;
      continuationTurn?: number;
    }
  /**
   * Receiver -> snapshot committer: the exact checksum-bound DATA+CONTROL snapshot has been materialized
   * and its executable continuation surface has been restored. Unlike a normal cumulative ACK, this proof
   * is bound to a host-retained `controlDigest` and may therefore retire journal revisions that have already
   * fallen out of the bounded replay ring. Unknown, altered, or unregistered frontiers are fail-closed.
   */
  | { t: "coopSnapshotAck"; controlDigest: string; marks: Record<string, number> }
  /**
   * Receiver -> committer (§4.4, reconnect-from-revision): "resend class `cls`'s committed tail after
   * revision `from`". Sent on a #805 hot rejoin (carrying the last-applied revision instead of a turn, the
   * successor of `requestStateSync`). The committer replays the journal tail after `from`, or falls back to
   * a full `stateSync` snapshot when the gap is deeper than the journal ring.
   */
  | { t: "coopResync"; cls: string; from: number }
  /**
   * Receiver -> committer (§4.4, #898 reconnect asymmetry): a CLASS-AGNOSTIC "resend your entire
   * committed-but-unacked tail, for EVERY class". Broadcast by the reconnecting side (production
   * reconnects only the GUEST, `coop-runtime.ts`), because a per-class `coopResync` can only ask for
   * classes the receiver has ALREADY seen - the FIRST op of a never-seen class, if dropped, is not in
   * the receiver's ledger, so it can never be named in a `coopResync`. This asks the committer to
   * proactively replay its unacked tail (which retains that op regardless of the receiver's ledger),
   * closing the never-seen-class hole. Forward-safe: an older client ignores it via the unknown-`t` arm.
   */
  | { t: "coopResyncAll" }
  // ===========================================================================
  // Showdown 1v1 PvP (A4): additive wire messages layered on the SAME co-op
  // transport. Purely new `t` values, so a co-op client that never speaks Showdown
  // ignores them via the unknown-kind default arm (forward-safe, same rule as above).
  //
  // `matchId` SCOPE RULE: a matchId is minted by the ESCROW server at match
  // registration, so it appears ONLY on escrow-coupled messages: `showdownStakeLock`
  // (which only exists in the staked flow, post-registration) carries a plain
  // `string`; `showdownResult` / `showdownVoid` carry `string | null` (null = a
  // FRIENDLY / no-escrow match - friendlies still exchange result/void but have no
  // server match). Every OTHER message is CONNECTION-scoped and carries no matchId:
  // there is exactly one match per paired connection, and a rematch is a new pairing.
  // ===========================================================================
  /** Either player -> peer: this player's wagered stake for the match (see {@linkcode ShowdownStakeOfferWire}). Connection-scoped. */
  | { t: "showdownStakeOffer"; offer: ShowdownStakeOfferWire }
  /** Either player -> peer: the stake is locked in for `matchId` at the agreed `tier` (escrow-coupled: post-registration). */
  | { t: "showdownStakeLock"; matchId: string; tier: number }
  /**
   * Either player -> peer: this player's RANKED opt-in state at the wager screen. Ranked counts only
   * when BOTH opt in (rides the existing both-locked commit barrier). `rankedMatchId` is the HOST's
   * generated ranked-match id (echoed empty by the guest, who adopts the host's). Connection-scoped.
   */
  | { t: "showdownRankedOptIn"; optIn: boolean; rankedMatchId: string }
  /**
   * Either player -> peer: this player's full built team (see {@linkcode ShowdownMonManifestWire}),
   * plus this player's authored GHOST-TRAINER `presentation` (C7; sprite/class/name/title/dialogue/FX).
   * `presentation` is absent/null when the player authored no profile. The receiver ALWAYS re-sanitizes
   * it (`sanitizeGhostProfile`) before applying - a hostile peer must not bypass sanitize. Connection-scoped.
   */
  | {
      t: "showdownTeam";
      manifest: ShowdownMonManifestWire[];
      presentation?: ShowdownProfileWire | null;
      /**
       * B7 item 11: the sender's SHOWDOWN protocol version. Additive + optional so a co-op peer (which
       * never sends this message) is unaffected and a pre-guard showdown client simply omits it (read as
       * a mismatch). A version difference means one client runs a stale cached bundle - the receiver
       * aborts the versus flow cleanly with a hard-refresh message instead of desyncing one-sided.
       */
      showdownProto?: number;
    }
  /** Either player -> peer: "my team is finalized"; `teamHash` fingerprints it for the anti-cheat cross-check. Connection-scoped. */
  | { t: "showdownReady"; teamHash: string }
  /** Host -> peer: the peer's command is needed for this `turn` (the 1v1 analogue of `commandRequest`). Connection-scoped. */
  | { t: "showdownCommandRequest"; turn: number }
  /** A player's battle command for their own mon this `turn` (reply to `showdownCommandRequest`). Connection-scoped. */
  | { t: "showdownCommand"; turn: number; command: SerializedCommand }
  /** Host -> peer: the match resolved. `winner` is the winning role; `reason` is how it ended. `matchId` is null for a friendly (no escrow). */
  | { t: "showdownResult"; matchId: string | null; winner: CoopRole; reason: "victory" | "forfeit" | "timeout" }
  /** Either player -> peer: the match is VOIDED (no winner) - `reason` is why. `matchId` is null for a friendly (no escrow). */
  | { t: "showdownVoid"; matchId: string | null; reason: "checksum" | "illegalTeam" | "earlyDisconnect" };

/** A transport moves {@linkcode CoopMessage}s between two paired clients. */
export interface CoopTransport {
  readonly role: CoopRole;
  readonly state: CoopConnectionState;
  /** Send a message to the peer. No-op when not connected. */
  send(msg: CoopMessage): void;
  /** Subscribe to inbound messages. Returns an unsubscribe function. */
  onMessage(handler: (msg: CoopMessage) => void): () => void;
  /** Subscribe to connection-state changes. Returns an unsubscribe function. */
  onStateChange(handler: (state: CoopConnectionState) => void): () => void;
  /** Tear down the connection. */
  close(): void;
  /**
   * #857 (optional): a human-readable reason the LIVE channel most recently dropped (the raw SCTP
   * abort / error text). Surfaced by the real WebRTC transport for the reconnect banner; absent on
   * the in-process loopback (which has no wire-level error to report).
   */
  disconnectReason?(): string | undefined;
  /** Current connection generation; increments whenever a hot rejoin replaces the underlying channel. */
  connectionGeneration?(): number;
  /**
   * #diagnostics (optional): age in ms of the last ANY inbound frame received on this transport -
   * INCLUDING transport-internal keepalive ping/pong - or `undefined` if nothing has been received
   * yet. A PASSIVE read (no protocol change, no extra frames): it only stamps the arrival time the
   * receive path already runs. This is the true heartbeat the #808 health-line `peerBeat` is NOT
   * (`peerBeat` is only the age of the last STALL beat, which a healthy peer never sends). Because a
   * live-but-idle tab still emits keepalive pings (~5s), a small `lastRxMs` means the peer is alive;
   * a growing one means a SUSPENDED / dead tab that stopped sending even keepalives - so a stalled
   * session can be told apart from a merely dropped operation. Surfaced in the health line + the
   * report control-plane block.
   */
  lastRxMs?(): number | undefined;
  /**
   * W2b durability (§4.3, optional): the number of DURABLE frames currently held in the outbound queue
   * because the channel is dark (backpressure depth). 0 / absent when nothing is queued or the transport
   * has no queue (loopback). Surfaced in the health line + control-plane block.
   */
  outboundQueueDepth?(): number;
  /**
   * W2b durability (§4.3, optional): whether the outbound queue overflowed and dropped its backlog, so a
   * reconnect-from-revision resync is owed. Absent on transports without a queue.
   */
  outboundQueueNeedsResync?(): boolean;
}

/**
 * Build a SHORT, log-safe one-line summary of a wire message (#633 debug). The transport is the
 * hottest path, so this only pulls a handful of discriminating scalars (seq/turn/wave/counts) per
 * `t` and NEVER dumps the big blobs (snapshots / serialized parties / dex strings). Called only
 * behind an `isCoopDebug()` guard so the string is not built when logging is off.
 */
function summarizeCoopMessage(msg: CoopMessage): string {
  switch (msg.t) {
    case "command":
      return `fi=${msg.fieldIndex} owner=${msg.owner ?? "-"} turn=${msg.turn} cmd=${msg.command.command} cursor=${msg.command.cursor} move=${msg.command.moveId ?? "-"}`;
    case "commandRequest":
      return `fi=${msg.fieldIndex} owner=${msg.owner ?? "-"} turn=${msg.turn} slots=${msg.moveSlots.length}`;
    case "switchChoice":
      return `fi=${msg.fieldIndex} slot=${msg.partySlot}`;
    case "rosterSync":
      return `role=${msg.role} entries=${msg.entries.length} ready=${msg.ready}`;
    case "runConfig":
      return `diff=${msg.difficulty} netcode=${msg.netcodeMode ?? "(lockstep)"} kind=${msg.kind ?? "coop"} seed=${msg.seed != null}`;
    case "stateSync":
      return `seq=${msg.seq} blob=${msg.blob.length}b`;
    case "requestStateSync":
      return `turn=${msg.turn} seq=${msg.seq}`;
    case "enemyPartySync":
      return `wave=${msg.wave} enemies=${msg.enemies.length}${msg.battleType === undefined ? "" : ` battleType=${msg.battleType}`}`;
    case "requestEnemyParty":
      return `wave=${msg.wave}`;
    case "launchSnapshot":
      return `wave=${msg.wave} session=${msg.session.length}b`;
    case "launchSnapshotAbort":
      return `wave=${msg.wave} reason=${msg.reason}`;
    case "requestLaunchSnapshot":
      return `wave=${msg.wave}`;
    case "meBattleEnemyPartySync":
      return `key=${msg.key} enemies=${msg.enemies.length}`;
    case "requestMeBattleEnemyParty":
      return `key=${msg.key}`;
    case "ghostPool":
      return `pool=${msg.pool.length}`;
    case "battleEvent":
      return `e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} seq=${msg.seq} k=${msg.event.k}`;
    case "turnResolution":
      return `e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision} events=${msg.events.length} checksum=${msg.checksum}`;
    case "battleCheckpoint":
      return `reason=${msg.reason} e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision} checksum=${msg.checksum}`;
    case "requestTurnCommit":
      return `e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision ?? "pending"}`;
    case "turnCommitPending":
      return `e=${msg.epoch} wave=${msg.wave} turn=${msg.turn}`;
    case "turnCommitAck":
      return `e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision} stage=${msg.stage} checksum=${msg.checksum}`;
    case "requestBattleCheckpoint":
      return `reason=${msg.reason} e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision} checkpointTick=${msg.checkpointTick} stateTick=${msg.stateTick}`;
    case "battleCheckpointAck":
      return `reason=${msg.reason} e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision} stage=${msg.stage} checksum=${msg.checksum}`;
    case "authorityFailure":
      return `id=${msg.failureId} e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision} boundary=${msg.boundary}`;
    case "authorityFailureAck":
      return `id=${msg.failureId} e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision} boundary=${msg.boundary}`;
    case "sharedTerminal":
      return `id=${msg.commit.terminalId} e=${msg.commit.epoch} wave=${msg.commit.wave} turn=${msg.commit.turn} rev=${msg.commit.terminalRevision} boundary=${msg.commit.boundary}`;
    case "sharedTerminalAck":
      return `id=${msg.terminalId} rev=${msg.terminalRevision} seat=${msg.ctx.fromSeatId} generation=${msg.ctx.connectionGeneration}`;
    case "interactionChoice":
      return `seq=${msg.seq} kind=${msg.kind} choice=${msg.choice}`;
    case "interactionOutcome":
      return `seq=${msg.seq} kind=${msg.kind} outcome=${msg.outcome.k}`;
    case "meChecksum":
      return `seq=${msg.seq} checksum=${msg.checksum}`;
    case "meMessage":
      return `len=${msg.text.length}`;
    case "rewardOptions":
      return `seq=${msg.seq} reroll=${msg.reroll} options=${msg.options.length}`;
    case "requestRewardOptions":
      return `seq=${msg.seq} reroll=${msg.reroll}`;
    case "uiInput":
      return `seq=${msg.seq} n=${msg.n} button=${msg.button} mode=${msg.mode}`;
    case "lifecycle":
      return `event=${msg.event}`;
    case "hello":
      return "pairingId" in msg
        ? `pairing=${msg.pairingId} transport=${msg.transportRole} authority=${msg.authorityClaim} account=${msg.account.accountId}`
        : `role=${msg.role} v=${msg.version} epoch=${msg.epoch} tiebreak=${msg.tiebreak ?? "(none)"}`;
    case "sessionBinding":
      return `id=${msg.binding.bindingId} session=${msg.binding.sessionId} epoch=${msg.binding.sessionEpoch} seatMap=${msg.binding.seatMap.seatMapId}`;
    case "sessionBindingAck":
      return `id=${msg.bindingId} seat=${msg.seatId} accepted=${msg.accepted}`;
    case "ping":
    case "pong":
      return `ts=${msg.ts}`;
    case "waveResolved":
      return `wave=${msg.wave} outcome=${msg.outcome} captureParty=${msg.captureParty?.length ?? "-"} cap=${msg.capturePresentation == null ? "-" : `sp${msg.capturePresentation.speciesId}`}`;
    case "dataFingerprint":
      return "fp";
    case "interaction":
      return `screen=${msg.screen}`;
    case "requestInteractionCounter":
      return `need=${msg.need}`;
    case "requestRunConfig":
      return "(re)request";
    case "rendezvous":
      return `point=${msg.point}`;
    case "phaseRoute":
      return `epoch=${msg.epoch} rev=${msg.revision} point=${msg.point} displaced=${msg.displacedPoint}`;
    case "phaseRouteAck":
      return `epoch=${msg.epoch} rev=${msg.revision}`;
    case "coopAck":
      return `cls=${msg.cls} seq=${msg.seq}`;
    case "coopSnapshotAck":
      return `control=${msg.controlDigest} classes=${Object.keys(msg.marks).length}`;
    case "coopResync":
      return `cls=${msg.cls} from=${msg.from}`;
    case "showdownStakeOffer":
      return `offer=sp${msg.offer.speciesId} shiny=${msg.offer.shiny} v=${msg.offer.variant} cost=${msg.offer.cost}`;
    case "showdownStakeLock":
      return `match=${msg.matchId} tier=${msg.tier}`;
    case "showdownRankedOptIn":
      return `optIn=${msg.optIn} rankedMatch=${msg.rankedMatchId}`;
    case "showdownTeam":
      return `mons=${msg.manifest.length} pres=${msg.presentation == null ? "-" : "y"}`;
    case "showdownReady":
      return `hash=${msg.teamHash}`;
    case "showdownCommandRequest":
      return `turn=${msg.turn}`;
    case "showdownCommand":
      return `turn=${msg.turn} cmd=${msg.command.command} cursor=${msg.command.cursor}`;
    case "showdownResult":
      return `match=${msg.matchId} winner=${msg.winner} reason=${msg.reason}`;
    case "showdownVoid":
      return `match=${msg.matchId} reason=${msg.reason}`;
    default:
      return `t=${(msg as { t?: string }).t ?? "?"}`;
  }
}

/**
 * In-process transport: two endpoints wired directly to each other. Each `send`
 * is delivered to the peer's handlers on a microtask, so a handler can never
 * observe its own send re-entrantly (mimics a real async channel). Powers tests
 * and the local hotseat path; no real network involved.
 */
class LoopbackTransport implements CoopTransport {
  public readonly role: CoopRole;
  private _state: CoopConnectionState = "connecting";
  private peer: LoopbackTransport | null = null;
  private readonly msgHandlers = new Set<(msg: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();
  /** #diagnostics: epoch-ms the last inbound frame was delivered to this endpoint (0 = none yet). */
  private lastRxAt = 0;

  constructor(role: CoopRole) {
    this.role = role;
  }

  get state(): CoopConnectionState {
    return this._state;
  }

  /** @internal Wire the pair and flip to `connected`. */
  _connect(peer: LoopbackTransport): void {
    this.peer = peer;
    this.setState("connected");
  }

  private setState(state: CoopConnectionState): void {
    if (this._state === state) {
      return;
    }
    coopLog("transport", `state ${this.role} ${this._state} -> ${state}`);
    this._state = state;
    for (const h of [...this.stateHandlers]) {
      h(state);
    }
  }

  send(msg: CoopMessage): void {
    const peer = this.peer;
    if (peer == null || this._state !== "connected") {
      if (isCoopDebug()) {
        coopLog(
          "transport",
          `send DROP (not connected) ${this.role} t=${msg.t} state=${this._state} peer=${peer != null}`,
        );
      }
      return;
    }
    if (isCoopDebug()) {
      coopLog("transport", `send ${this.role} t=${msg.t} ${summarizeCoopMessage(msg)}`);
    }
    // A real RTC transport serializes the frame before the remote peer observes it. Mirror that
    // ownership boundary here: the two in-process clients must never share nested message objects.
    // Without this copy, a guest renderer normalizing its disposable working state could mutate the
    // host's retained authority frame and make a later retry differ from the originally admitted wire
    // commit -- a test-only alias that hid production-fidelity bugs and could create false conflicts.
    const frame = structuredClone(msg);
    queueMicrotask(() => {
      if (peer._state !== "connected") {
        if (isCoopDebug()) {
          coopLog(
            "transport",
            `deliver DROP (peer not connected) ->${peer.role} t=${frame.t} peerState=${peer._state}`,
          );
        }
        return;
      }
      // #diagnostics: stamp the last-received-frame time on the RECEIVING endpoint (passive read).
      peer.lastRxAt = Date.now();
      if (isCoopDebug()) {
        coopLog(
          "transport",
          `recv ${peer.role} t=${frame.t} ${summarizeCoopMessage(frame)} handlers=${peer.msgHandlers.size}`,
        );
      }
      for (const h of [...peer.msgHandlers]) {
        try {
          h(frame);
        } catch (error) {
          // A transport is a fan-out bus: one optional observer failing must not starve the
          // command/recovery handlers registered after it. Keep the fault loud and continue.
          coopWarn(
            "transport",
            `recv ${peer.role} t=${frame.t} handler threw (isolated): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    });
  }

  /** #diagnostics: age (ms) of the last inbound frame, or undefined if none received yet. */
  lastRxMs(): number | undefined {
    return this.lastRxAt === 0 ? undefined : Date.now() - this.lastRxAt;
  }

  onMessage(handler: (msg: CoopMessage) => void): () => void {
    this.msgHandlers.add(handler);
    return () => {
      this.msgHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    const peer = this.peer;
    this.peer = null;
    this.setState("closed");
    if (peer != null && peer._state !== "closed") {
      peer.peer = null;
      peer.setState("disconnected");
    }
    this.msgHandlers.clear();
    this.stateHandlers.clear();
  }
}

/** Create a connected host/guest {@linkcode LoopbackTransport} pair (in-process). */
export function createLoopbackPair(): { host: CoopTransport; guest: CoopTransport } {
  const host = new LoopbackTransport("host");
  const guest = new LoopbackTransport("guest");
  host._connect(guest);
  guest._connect(host);
  return { host, guest };
}
