/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op battle CHECKSUM (#633, TRACK-2). The PURE core of the per-turn state
// fingerprint: a deterministic 64-bit hash of the FULL authoritative battle state.
// The host stamps its hash on each turn/checkpoint; the guest recomputes the same
// hash over its own state and, on a MISMATCH, requests + adopts a full authoritative
// `stateSync` snapshot so it can never drift unnoticed.
//
// Deliberately engine-FREE (no `globalScene` / `Pokemon` import) so the hashing +
// canonicalization is unit-testable headlessly. The thin engine adapter that READS a
// live field/arena/party/money/modifiers into the `CoopChecksumState` view lives in
// `coop-battle-engine.ts`; this module is just the canonical-string + hash transform,
// so the determinism guarantees are verifiable without booting the game.
//
// DETERMINISM RULES (the whole point - break one and two correct engines mismatch):
//   - Object keys are ALWAYS emitted in sorted order, NEVER `Object.keys` insertion
//     order. The `canonicalize` walker enforces this.
//   - The state type carries NO optionals: every field is a concrete value (an absent
//     ability/form resolves to 0 at read time), so `undefined` can never reach the
//     stringifier and `exactOptionalPropertyTypes` ambiguity is sidestepped entirely.
//   - Turn/duration COUNTERS (weather/terrain `turnsLeft`, per-tag `turnCount`) are
//     EXCLUDED: they decrement on tick and legitimately differ by one between two
//     correct engines depending on exactly when each side reads. Only TYPE / IDENTITY
//     is hashed. Adding a counter back to the hashed shape re-introduces false desyncs.
// =============================================================================

/** Canonicalize string-enum battler tag identities independently of engine insertion order. */
export function sortCoopChecksumTagIds(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Canonicalize string-enum arena tag identities by tag name, then numeric side. */
export function sortCoopChecksumArenaTags(
  tags: readonly (readonly [string, number])[],
): [string, number][] {
  return tags
    .map(([tagType, side]) => [tagType, side] as [string, number])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
}

/** One field mon's full deterministic state for the checksum (NO optionals). */
export interface CoopChecksumMon {
  /** Battler index (0 host lead, 1 guest lead, 2/3 enemies). */
  bi: number;
  /**
   * STABLE party-slot identity (#633, enemy-switch mirror): the host's `getEnemyParty().indexOf`
   * (player: `getPlayerParty().indexOf`). For an on-field mon this equals its field slot, so it
   * does not by itself detect a switch; {@linkcode speciesId} below is the detectable identity.
   */
  partyIndex: number;
  /**
   * `species.speciesId` (#633, enemy-switch mirror). Hashing it is INTENDED: a host enemy switch
   * keeps the same `bi` but swaps in a different SPECIES, so without this the checksum could miss a
   * switch between two mons of identical hp/stats. A switch now changes the checksum (detectable)
   * and re-converges once the guest mirrors the switch.
   */
  speciesId: number;
  hp: number;
  maxHp: number;
  /** `StatusEffect` enum value (0 = none). */
  status: number;
  /** The 7 stat stages (ATK..ACC/EVA). */
  statStages: number[];
  fainted: boolean;
  /** Active ability id (`AbilityId`); 0 when unknown/absent. */
  abilityId: number;
  /** Current form index; 0 when absent. */
  formIndex: number;
  /**
   * Whether this mon is Terastallized (#633 GAP 7). Hashing it is INTENDED: a Tera command the
   * guest dropped changes the mon's type/STAB on the host but not the guest, so without this the
   * checksum could miss a Tera divergence. A drop now changes the checksum (detectable) and
   * re-converges once the guest's snapshot apply forces the host's tera state.
   */
  isTerastallized: boolean;
  /** Tera type (`PokemonType` enum); 0 when not relevant. Carried so a wrong-type Tera is detected. */
  teraType: number;
  /**
   * Boss segment COUNT (#633, A/BLOCKING-2); 0 = not a boss. Hashing it makes a missing-boss guest
   * (bossSegments=0 vs host=N) detectable - without it a missing-boss guest with a matching maxHp is
   * invisible to the checksum, so the bars silently never render and no resync is ever triggered.
   */
  bossSegments: number;
  /**
   * Boss segment INDEX (#633, A/BLOCKING-2): how many shields are still up. The shield dividers render
   * from THIS, not the count, and the host decrements it as segments break while the guest's HP-drain
   * replay sets hp by direct assignment (never via `damage()`), so the index can diverge with a
   * matching count. Hashing it makes that divergence detectable + re-convergeable on resync.
   */
  bossSegmentIndex: number;
  /** Each move slot as `[moveId, ppUsed]`, in moveset slot order (NOT sorted). */
  moves: [number, number][];
  /** Sorted ascending list of the battler-tag TYPE ids present (identity only, no counters). */
  tags: string[];
  /**
   * TRANSFORM / Imposter copied species id (#836/#837); 0 when NOT transformed. Hashing it is INTENDED:
   * a Transform / Imposter copies the target's identity into `summonData` while `species` (hashed by
   * {@linkcode speciesId} above) stays the ORIGINAL, so without this a host Ditto's transform is
   * INVISIBLE to the checksum and never triggers a heal on the pure-renderer guest (live #836). The
   * per-turn field snapshot applies the copied identity on the guest BEFORE this is recomputed, so a
   * healthy transformed pair matches; a divergence is now detectable + re-convergeable.
   */
  transformSpeciesId: number;
  /** TRANSFORM / Imposter copied form index (#836/#837); 0 when not transformed. Carried alongside {@linkcode transformSpeciesId}. */
  transformFormIndex: number;
}

/**
 * The full authoritative battle state hashed each turn. Every field is concrete (no
 * optionals); arrays whose ORDER is meaningful (party order, move slots) are kept in
 * order, while identity-only sets (tags, modifiers) are pre-sorted by the adapter so
 * the hash is order-stable regardless of engine iteration order.
 */
export interface CoopChecksumState {
  /** Every occupied field mon, sorted ascending by `bi`. */
  field: CoopChecksumMon[];
  /** `WeatherType` enum value (0 = none). Turn counter is intentionally excluded. */
  weather: number;
  /** `TerrainType` enum value (0 = none). Turn counter is intentionally excluded. */
  terrain: number;
  /** Arena tag identities as `[tagType, side]`, sorted. Turn counts are excluded. */
  arenaTags: [string, number][];
  /** Player party `speciesId`s in slot order (order is meaningful - do NOT sort). */
  party: number[];
  /**
   * Player party LEVELS in slot order (#633 B4): detects BENCH-mon level drift the speciesId-only
   * `party` list misses - e.g. a bench mon REVIVED / level-changed in the shop on the host but not
   * the guest (the live revive desync), or a pre-evolution level-boundary divergence. Integer, slot
   * order, settled at the CommandPhase boundary (the host's B5 exp delivery lands in BattleEndPhase,
   * many phases before the next wave's checksum), so it is deterministic and never a false-resync.
   */
  partyLevels: number[];
  /**
   * BENCH-mon hp + fainted state (#719 revive/heal backstop): one `[partyIndex, hp, faintedFlag]` entry
   * per OFF-FIELD party mon, in slot order (faintedFlag 1 = fainted, 0 = alive). The base {@linkcode field}
   * checksum hashes ON-FIELD hp only, so a Revive / Max Revive on a FAINTED bench mon - whose owner->watcher
   * interaction relay was DROPPED (the #787 lost-relay class) - left the mon fainted forever on the watcher,
   * INVISIBLE to the hash: a revive changes NO species (so `party` misses it) and NO level (so `partyLevels`
   * misses it). Hashing each bench mon's hp+fainted makes that divergence DETECTABLE, so the checksum trips
   * the same full-snapshot resync that HEALS it (its `benchParty` reconcile revives the mon). TARGETED: bench
   * hp/fainted only moves on a revive/heal item, so it adds NO resync noise on ordinary turns (on-field mons
   * already hash hp; this extends the SAME coverage to the bench). Slot order is meaningful - do NOT sort.
   */
  benchHp: [number, number, number][];
  /**
   * BENCH-mon MOVESET digest (#875): one `[partyIndex, movesetHashHex]` entry per OFF-FIELD party mon, in
   * slot order. `movesetHashHex` is a fold ({@linkcode fnv1a64} over the canonical `[[moveId, ppUsed], ...]`
   * slot list) of the bench mon's moveset. The base {@linkcode field} checksum hashes ON-FIELD `moves` only,
   * so a move LEARNED onto a BENCH mon - a reward-shop TM / Learner's Shroom / free Memory Mushroom the HOST
   * picked for a HOST-owned bench mon (the #875 latent gap #873 left open, where the host applies the learn
   * but the guest's MIRROR copy does not) - changed NO species (so `party` misses it), NO level (so
   * `partyLevels` misses it), and NO on-field move (so `field` misses it): it was INVISIBLE to the checksum,
   * so no resync ever detected it. Folding each bench mon's moveset makes that divergence DETECTABLE, so the
   * checksum trips the same full-snapshot resync that HEALS it (the resync's authoritative-state apply
   * rebuilds every mon's moveset from the host). CONVERGENCE (adopt-then-hash): the guest adopts the host's
   * full party moveset - bench included - via the per-turn authoritative-state apply BEFORE it recomputes
   * this hash, so a HEALTHY run hashes identical values every turn and this adds NO resync noise (bench
   * movesets only move on a learn/forget). Slot order is meaningful - do NOT sort.
   */
  benchMoves: [number, string][];
  money: number;
  /** Persistent modifiers as `[typeId, stackCount]`, sorted by `typeId`. */
  modifiers: [string, number][];
  /**
   * ON-FIELD per-mon held-item identity digest (#633 RISKY #2/#3): each entry is
   * `[bi, typeId, stackCount]`, sorted. `bi` is the battler index (the same key the snapshot heal lands
   * on), never pokemonId. Makes a stack change (Bug-Bite/Knock-Off) AND a wrong-holder rebind among
   * on-field mons (Grip Claw/Covet) - same global total - detectable, where the aggregate `modifiers`
   * digest cannot. BENCH held items are intentionally excluded (the snapshot heals on-field only; bench
   * drift converges at the wave boundary).
   */
  heldItems: [number, string, number][];
  /** Ball inventory as `[ballType, count]`, sorted by ballType (#633 RISKY #4). Cheap + deterministic. */
  pokeballCounts: [number, number][];
  /**
   * Active `BiomeId` (B7). Hashing it makes an independent biome re-roll (a host/guest seed or
   * waveIndex drift that landed the two clients in DIFFERENT biomes) detectable. Settled by
   * SwitchBiomePhase's newArena (tween-deferred, but the phase queue blocks the next turn-boundary
   * checksum until that phase ends), so it is stable + identical across healthy clients at the read
   * point - it can ONLY differ on a real split.
   */
  biomeId: number;
  /**
   * Run seed (B8): the master determinism input. runConfig-pinned identical across clients, mutated
   * only by setSeed (never mid-turn; the RNG cursor advances separately and is deliberately excluded),
   * so it is stable + identical across healthy clients and only differs on a real seed split that a
   * no-ME run segment would otherwise leave permanent + silent.
   */
  seed: string;
  /**
   * FULL SESSION SAVE-DATA digest (#837): a 64-bit hash of the NORMALIZED `getSessionSaveData()` view,
   * built by the engine adapter ({@linkcode captureCoopSaveDataDigest} in `coop-battle-engine.ts`).
   * This is the systemic desync closer: the session save already serializes EVERY run-state substrate
   * (money-streak, ward stones, relic-battle-state, biome overstay anchor, and all modifiers as full
   * `ModifierData` blobs incl. their `getArgs` internals), so hashing that canonical form makes the
   * whole "modifier internal state / module-let substrate" blind-spot class DETECTABLE - a Stormglass
   * `chosenWeather` change, a money-streak counter drift, or a relic-list divergence now moves this
   * digest and trips the same resync heal the field checksum does. DERIVED from the serializer (not a
   * hand-maintained list) so a NEW substrate added to `SessionSaveData` is covered automatically; the
   * engine strips the fields that legitimately differ per client / per moment (each exclusion is
   * commented at the capture site). The pure core just carries + hashes the opaque digest string.
   */
  saveDataDigest: string;
}

/** A read-failure sentinel digest. Both sides agree to SKIP the comparison on it. */
export const COOP_CHECKSUM_SENTINEL = "0000000000000000";

/**
 * Deterministic stringifier: object keys ALWAYS emitted in sorted order (never
 * insertion order), arrays in their given order, numbers normalized so `1`, `1.0`,
 * and `-0` hash equal, and `undefined` impossible (the state type forbids it). This
 * is the ONLY stringifier the hash ever sees.
 */
export function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number") {
    return canonNumber(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  // undefined / function / symbol must never reach here - the state type forbids them.
  return "null";
}

/** Normalize a number so `1`, `1.0`, `-0`, and non-finite values hash stably. */
function canonNumber(n: number): string {
  if (!Number.isFinite(n)) {
    // NaN / Infinity can't legitimately appear in battle state; neutralize them.
    return "0";
  }
  if (n === 0) {
    // Collapse -0 and 0.
    return "0";
  }
  if (Number.isInteger(n)) {
    return n.toString();
  }
  // Stable float formatting (battle-state numbers are integers anyway; this guards a
  // stray fractional value from formatting differently across engines).
  return n.toPrecision(12);
}

// FNV-1a 64-bit. BigInt (not two 32-bit halves): exactOptionalPropertyTypes-neutral,
// no manual carry/overflow bugs, and it runs once per turn over a ~1KB string, so the
// BigInt cost is irrelevant. The pure-core boundary lets this swap to a halves impl
// behind the same signature if a hot path ever needs it.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-16 code units of `s`, returned as a 16-char hex string. */
export function fnv1a64(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

/** Hash a canonical battle state into its stable 64-bit hex digest. */
export function checksumState(state: CoopChecksumState): string {
  return fnv1a64(canonicalize(state));
}
