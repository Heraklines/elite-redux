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
// TYPE-ONLY import (fully erased at runtime by `import type`, so this file stays the
// zero-runtime-import lowest layer): the ghost-pool message carries plain-JSON
// `GhostTeamSnapshot`s, which already live in er-ghost-teams (#633 ghost-pool sync).
import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";

/** Which side of a co-op session a client is. Auto-assigned at pairing time (the
 *  player never chooses); the run is host-authoritative, so `host` is the engine
 *  source of truth and `guest` is the thin client. */
export type CoopRole = "host" | "guest";

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

/** Connection lifecycle of a transport. */
export type CoopConnectionState = "connecting" | "connected" | "disconnected" | "closed";

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
  /** `MoveUseMode` enum value. */
  useMode?: number;
  /** For POKEMON (switch): whether it is a Baton switch (passes stat changes) (#633). */
  baton?: boolean;
  /** For FIGHT: whether the mon Terastallizes this turn (Command.TERA) (#633 Fix #4a). */
  tera?: boolean;
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
  /** Each move slot as `[moveId, ppUsed]`, in moveset slot order. */
  moves: [number, number][];
  /** Battler-tag TYPE ids present on the mon (identity only). */
  tags: number[];
}

/** The full authoritative battle state the host sends to heal a desync. */
export interface CoopFullBattleSnapshot {
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
  | { k: "hp"; bi: number; hp: number; maxHp: number }
  /** A mon fainted. */
  | { k: "faint"; bi: number }
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
  | { k: "leave" };

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
   */
  | { t: "hello"; version: string; username: string; role: CoopRole; tiebreak?: number }
  /** Keepalive / latency probe. */
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  /**
   * Host -> peer: the partner's field slot needs a command this `turn`. The host
   * is authoritative, so it sends the LEGAL move slots (indices into the partner
   * mon's moveset) it computed; the peer just picks one and replies with a
   * `command`. `moveSlots` empty => only Struggle is legal (#633, LIVE-C).
   */
  | { t: "commandRequest"; fieldIndex: number; turn: number; moveSlots: number[] }
  /** A player's battle command for their own field slot (phase P2 / LIVE-C reply). */
  | { t: "command"; fieldIndex: number; turn: number; command: SerializedCommand }
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
    }
  /**
   * Guest -> host (#633): "(re)send me the runConfig". The host broadcasts `runConfig`
   * ONCE when it picks difficulty; if that single message is dropped or mistimed the
   * guest would wait forever on its "choosing difficulty" screen. So the waiting guest
   * actively (re)requests until it lands, and the host re-broadcasts on every request -
   * a self-healing handshake (harmless no-op before the host has picked).
   */
  | { t: "requestRunConfig" }
  /** A choice on an alternation-owned interaction screen (reward / shop / ME) (P4). */
  | { t: "interaction"; screen: string; choice: unknown }
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
  | { t: "enemyPartySync"; wave: number; enemies: CoopSerializedEnemy[] }
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
  | { t: "battleEvent"; turn: number; seq: number; event: CoopBattleEvent }
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
   * hashed from. Optional + additive: the host always sends it on the authoritative path so
   * that on a mismatch the guest can deep-DIFF the host's pre-image against its own and log
   * the exact divergent field(s). Older clients omit it and ignore it on receipt.
   */
  | {
      t: "turnResolution";
      turn: number;
      events: CoopBattleEvent[];
      checkpoint: CoopBattleCheckpoint;
      checksum: string;
      preimage?: string;
    }
  /**
   * Host -> guest (#633, LIVE-D): an out-of-turn authoritative checkpoint (after a
   * switch / capture / encounter start / resume). `reason` is a short tag for logging.
   * `checksum` (#633, TRACK-2): the host's full-state fingerprint at this boundary.
   */
  | { t: "battleCheckpoint"; reason: string; checkpoint: CoopBattleCheckpoint; checksum: string }
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
   * Owner -> watcher (#633 Fix #2): the EXACT reward-screen option list the owner rolled
   * for interaction `seq`. The watcher rebuilds these instead of re-rolling its own pool
   * (party luck would otherwise make the two pools - and the shared RNG cursor - diverge).
   * `reroll` is the reroll round these options belong to (a fresh roll per reroll).
   */
  | { t: "rewardOptions"; seq: number; reroll: number; options: CoopSerializedRewardOption[] }
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
   */
  | { t: "waveResolved"; wave: number; outcome: CoopWaveOutcome };

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
    this._state = state;
    for (const h of [...this.stateHandlers]) {
      h(state);
    }
  }

  send(msg: CoopMessage): void {
    const peer = this.peer;
    if (peer == null || this._state !== "connected") {
      return;
    }
    queueMicrotask(() => {
      if (peer._state !== "connected") {
        return;
      }
      for (const h of [...peer.msgHandlers]) {
        h(msg);
      }
    });
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
