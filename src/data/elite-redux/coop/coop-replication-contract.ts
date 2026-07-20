/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP REPLICATION CONTRACT (accepted-review item 4 - the SINGLE SOURCE OF FIELD
// TRUTH). The replicated per-turn state contract is maintained by hand in THREE
// places that must agree field-for-field:
//   - CAPTURE: captureCoopAuthoritativeBattleState (the wire encoding the host sends),
//   - APPLY:   applyCoopAuthoritativeBattleState  (what the guest writes back),
//   - HASH:    captureCoopChecksumState + saveDataDigest (what detects a divergence).
// When the three drift apart, opposite-but-equal bugs appear:
//   - #875 = MATERIAL state captured + applied but OMITTED from the hash (a learned
//            bench moveset): the guest CAN heal it, but nothing ever DETECTS the drift
//            to trigger the heal, so it stays silently diverged forever.
//   - #876 = EPHEMERAL state INCLUDED in the hash but that apply CANNOT carry (a
//            non-serializable FLINCHED tag): the guest can NEVER reproduce it, so the
//            hash reports a permanent, UNHEALABLE false-desync.
// Both are a contract mismatch between capture/apply/hash. This module is the DECLARED
// contract those three implementations are checked against (coop-replication-contract
// .test.ts diffs the LIVE runtime keys of each against these tables and FAILS on any
// field present in one set but missing from another WITHOUT an explicit documented
// exclusion). Every exclusion carries a `reason` string, exactly like KNOWN_UNDRIVABLE.
//
// This is the CONTRACT-TEST form of the single-source-of-truth (a declarative sidecar
// the test enforces against live output), chosen over an invasive engine rewrite: the
// capture/apply are ~1000 lines of hand-tuned, id-keyed, headless-guarded reconciliation
// (PokemonData round-trips, boss re-seating, render differ) that a registry-driven
// rewrite would regress. The table below is the enforceable spec; the test is the gate.
// =============================================================================

/**
 * How a captured wire field is covered by the per-turn HASH (so a divergence in it is DETECTABLE):
 *  - `direct`: hashed by an identically-meaning checksum-state field (named in `into`),
 *  - `derived`: the checksum hashes a PROJECTION of it (named in `into` - e.g. the party PokemonData
 *    feeds `party` / `partyLevels` / `benchMoves` / `field`; a substrate feeds `saveDataDigest`),
 *  - `excluded`: deliberately NOT hashed, with a `reason` (a per-client counter / RNG cursor / host-only
 *    accumulator that would manufacture a false desync - mirrors the checksum header's counter exclusions).
 */
export type CoopHashCoverage =
  | { kind: "direct"; into: string[] }
  | { kind: "derived"; into: string[] }
  | { kind: "excluded"; reason: string };

/** One authoritative-WIRE field (a top-level {@linkcode CoopAuthoritativeBattleStateV1} key). */
export interface CoopWireFieldDescriptor {
  /** The exact key on the wire payload. */
  name: string;
  /** True IFF `applyCoopAuthoritativeBattleState` READS this field to mutate/guard guest state. */
  applied: boolean;
  /** REQUIRED when `applied` is false: why the guest legitimately ignores this captured field. */
  applyExcluded?: string;
  /** How the per-turn hash covers this field (or why it is deliberately excluded). */
  hash: CoopHashCoverage;
}

/** One per-turn HASH field (a top-level {@linkcode CoopChecksumState} key). */
export interface CoopChecksumFieldDescriptor {
  /** The exact key on the checksum-state view. */
  name: string;
  /** The wire field(s) this hash value is captured from / derived from. */
  source: string[];
}

/**
 * The CAPTURE contract: every top-level key `captureCoopAuthoritativeBattleState` puts on the wire, with
 * its APPLY status and HASH coverage. The contract test asserts this set EQUALS the runtime keys exactly
 * (so adding a wire field without registering it, or removing one, FAILS) and that every entry is either
 * applied or documented, and either hashed or documented.
 */
export const COOP_AUTHORITATIVE_WIRE_FIELDS: readonly CoopWireFieldDescriptor[] = [
  {
    name: "version",
    applied: true, // consumed as the payload-shape guard (rejects a non-1 version).
    hash: { kind: "excluded", reason: "wire protocol version - not battle state; identical by construction" },
  },
  {
    name: "tick",
    applied: true, // consumed by coopAcceptStateTick (monotonic snapshot sequencing).
    hash: {
      kind: "excluded",
      reason: "monotonic snapshot-sequencing counter (advances per capture); the checksum excludes ALL counters",
    },
  },
  {
    name: "wave",
    applied: false,
    applyExcluded: "diagnostic/log only; the guest advances its own currentBattle.waveIndex via its phase pipeline",
    hash: {
      kind: "excluded",
      reason:
        "wave-crossing read-skew transient (host advances first); excluded exactly like saveData waveIndex (#846)",
    },
  },
  {
    name: "turn",
    applied: false,
    applyExcluded:
      "generic DATA apply is counter-neutral; the ordered V2 turn/wave projector advances currentBattle.turn at its typed boundary",
    hash: { kind: "excluded", reason: "per-client turn counter; the checksum excludes all counters" },
  },
  {
    name: "double",
    applied: true,
    hash: { kind: "derived", into: ["field"] },
  },
  {
    name: "playerParty",
    applied: true, // reconcileAuthoritativeParty("player", ...): full PokemonData round-trip, id-keyed.
    hash: {
      kind: "derived",
      // The live player party's PokemonData feeds every player-side hash projection.
      into: ["field", "party", "partyLevels", "benchHp", "benchMoves", "heldItems"],
    },
  },
  {
    name: "enemyParty",
    applied: true, // reconcileAuthoritativeParty("enemy", ...).
    hash: {
      kind: "derived",
      // Only the ON-FIELD enemies are hashed (via `field`); the enemy BENCH is host-built + never id-aligned
      // with the guest, so it is intentionally not hashed (documented in the checksum saveData excludes).
      into: ["field"],
    },
  },
  {
    name: "field",
    applied: true, // reconcileAuthoritativeField: seats each on-field mon + boss-segment index.
    hash: { kind: "direct", into: ["field"] },
  },
  { name: "weather", applied: true, hash: { kind: "direct", into: ["weather"] } },
  {
    name: "weatherTurnsLeft",
    applied: false,
    applyExcluded: "weather turn COUNTER; the guest's weather ticks independently - a 1-turn skew is legitimate",
    hash: { kind: "excluded", reason: "weather turn counter - decrements per tick, legitimately differs by one" },
  },
  { name: "terrain", applied: true, hash: { kind: "direct", into: ["terrain"] } },
  {
    name: "terrainTurnsLeft",
    applied: false,
    applyExcluded: "terrain turn COUNTER; the guest's terrain ticks independently - a 1-turn skew is legitimate",
    hash: { kind: "excluded", reason: "terrain turn counter - decrements per tick, legitimately differs by one" },
  },
  { name: "arenaTags", applied: true, hash: { kind: "direct", into: ["arenaTags"] } },
  { name: "money", applied: true, hash: { kind: "direct", into: ["money"] } },
  {
    name: "lockModifierTiers",
    applied: true,
    hash: { kind: "direct", into: ["lockModifierTiers"] },
  },
  {
    name: "score",
    applied: true, // globalScene.score is set.
    hash: {
      kind: "excluded",
      reason:
        "host-authoritative accumulator; excluded from the save-data digest ('score') - the guest never reproduces it turn-for-turn",
    },
  },
  { name: "pokeballCounts", applied: true, hash: { kind: "direct", into: ["pokeballCounts"] } },
  {
    name: "playerModifiers",
    applied: true, // reconcileAuthoritativeModifiers(..., true).
    hash: {
      kind: "derived",
      // [typeId, stackCount] rides `modifiers`; the full args (Stormglass chosenWeather, booster stat) ride
      // the saveDataDigest (normalizeCoopModifierBlobs).
      into: ["modifiers", "heldItems", "saveDataDigest"],
    },
  },
  {
    name: "enemyModifiers",
    applied: true, // reconcileAuthoritativeModifiers(..., false).
    hash: {
      kind: "excluded",
      reason:
        "enemy-side modifiers are host-built + never id-aligned with the guest; excluded from the digest ('enemyModifiers')",
    },
  },
  { name: "biomeId", applied: true, hash: { kind: "direct", into: ["biomeId"] } },
  { name: "seed", applied: true, hash: { kind: "direct", into: ["seed"] } },
  {
    name: "waveSeed",
    applied: true, // waveSeed set + Phaser.Math.RND.sow.
    hash: {
      kind: "excluded",
      reason:
        "RNG cursor derivative; the checksum hashes `seed` (the master input) only - the cursor advances separately (checksum header B8)",
    },
  },
  {
    name: "erMoneyStreaks",
    applied: true, // restoreCoopModuleLetSubstrates -> restoreErMoneyStreaks.
    hash: { kind: "derived", into: ["saveDataDigest"] },
  },
  {
    name: "biomeOverstayAnchor",
    applied: true, // restoreCoopModuleLetSubstrates -> setErBiomeOverstayAnchor.
    hash: { kind: "derived", into: ["saveDataDigest"] },
  },
  {
    name: "erRelicBattleState",
    applied: true, // restoreCoopModuleLetSubstrates -> restoreErRelicBattleState.
    hash: { kind: "derived", into: ["saveDataDigest"] },
  },
  {
    name: "erBiomeStructure",
    applied: true, // restoreCoopModuleLetSubstrates -> setErBiomeStructureExtent.
    hash: { kind: "derived", into: ["saveDataDigest"] },
  },
  {
    name: "erMapState",
    applied: true, // restoreCoopModuleLetSubstrates -> restoreErMapState.
    hash: { kind: "derived", into: ["saveDataDigest"] },
  },
  {
    name: "erPendingNodes",
    applied: true, // restoreCoopModuleLetSubstrates -> setErPendingNodes.
    hash: {
      kind: "derived",
      // The pending set is adopted so both clients' onward sets match; its revealed nodes ride the digest.
      into: ["saveDataDigest"],
    },
  },
] as const;

/**
 * The HASH contract: every top-level key of {@linkcode CoopChecksumState}, with the wire field(s) it is
 * captured/derived from. The contract test asserts this set EQUALS the runtime checksum-state keys exactly -
 * so DROPPING a hash field (the #875 class: removing `benchMoves`) or ADDING an unregistered one FAILS.
 */
export const COOP_CHECKSUM_FIELDS: readonly CoopChecksumFieldDescriptor[] = [
  { name: "field", source: ["field", "playerParty", "enemyParty"] },
  { name: "weather", source: ["weather"] },
  { name: "terrain", source: ["terrain"] },
  { name: "arenaTags", source: ["arenaTags"] },
  { name: "party", source: ["playerParty"] },
  { name: "partyLevels", source: ["playerParty"] },
  { name: "benchHp", source: ["playerParty"] },
  // #875: the bench-mon moveset digest. Dropping this (its checksum-state key, readBenchMovesDigest, or the
  // CoopChecksumState.benchMoves field) is EXACTLY the bug this contract catches - the runtime key set would
  // then miss `benchMoves` and the contract test's exact-set assertion FAILS.
  { name: "benchMoves", source: ["playerParty"] },
  { name: "money", source: ["money"] },
  { name: "lockModifierTiers", source: ["lockModifierTiers"] },
  { name: "modifiers", source: ["playerModifiers"] },
  { name: "heldItems", source: ["playerParty", "playerModifiers"] },
  { name: "pokeballCounts", source: ["pokeballCounts"] },
  { name: "biomeId", source: ["biomeId"] },
  { name: "seed", source: ["seed"] },
  {
    name: "saveDataDigest",
    // The systemic closer: a NORMALIZED getSessionSaveData() hash covering the module-let substrates + full
    // modifier args.
    source: [
      "erMoneyStreaks",
      "biomeOverstayAnchor",
      "erRelicBattleState",
      "erBiomeStructure",
      "erMapState",
      "erPendingNodes",
      "playerModifiers",
    ],
  },
] as const;

/** The set of wire-field names the capture is contracted to emit (for the runtime exact-set diff). */
export const coopWireFieldNames = (): ReadonlySet<string> => new Set(COOP_AUTHORITATIVE_WIRE_FIELDS.map(f => f.name));

/** The set of checksum-field names the hash is contracted to emit (for the runtime exact-set diff). */
export const coopChecksumFieldNames = (): ReadonlySet<string> => new Set(COOP_CHECKSUM_FIELDS.map(f => f.name));
