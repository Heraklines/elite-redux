/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - dynamic per-mode gauntlet composition.
//
// The 15-round ladder is NOT a fixed list of trainers. It is ROLLED at run time
// from the active run's own difficulty pools, so you never know exactly who you
// will face, and the fight is real:
//
//   rounds  1-4  : normal trainers of the mode
//   rounds  5-8  : GHOST trainers (real winning player teams) of the mode
//   rounds  9-10 : boss trainers (Elite-Four-tier)
//   rounds 11-12 : gym leaders
//   rounds 13-14 : strong / late GHOSTS (14 = the "deadliest" - most kills)
//   round  15    : a Champion
//
// Elite / Hell pull their real ER rosters (insane / hell tier teams) + ER ghosts;
// Ace / Youngster stay PURE VANILLA (vanilla trainer/gym/champion teams + only
// ace/youngster ghosts). Every challenger keeps a recognisable trainer-class
// sprite + name (ghosts show the source player's account name). Injected teams
// fight at full power (the BST cap is bypassed for Colosseum battles) and are
// re-levelled to your strongest party member so difficulty comes from team
// QUALITY, not an inflated level.
//
// Everything stored on the encounter is plain JSON (species/move IDs, not live
// objects) so a mid-gauntlet save/load survives. Live PokemonSpecies + configs
// are rebuilt at battle time in colosseumRoundConfig().
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  fetchDeadliestGhosts,
  type GhostTeamSnapshot,
  isErGhostTeamLegal,
  sampleGhostSnapshots,
} from "#data/elite-redux/er-ghost-teams";
import {
  type ErDifficulty,
  erDifficultyToRosterTier,
  getErDifficulty,
  isErVanillaDifficulty,
} from "#data/elite-redux/er-run-difficulty";
import { type ErRosterTier, selectErRoster } from "#data/elite-redux/er-trainer-overlay";
import { teamStrength } from "#data/elite-redux/er-trainer-runtime-hook";
import type { ErTrainerRegistryEntry } from "#data/elite-redux/init-elite-redux-trainers";
import { ER_TRAINER_REGISTRY } from "#data/elite-redux/init-elite-redux-trainers";
import type { Gender } from "#data/gender";
import { trainerConfigs } from "#data/trainers/trainer-config";
import type { MoveId } from "#enums/move-id";
import type { Nature } from "#enums/nature";
import { TrainerType } from "#enums/trainer-type";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import type { Variant } from "#sprites/variant";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Rounds in the gauntlet. */
export const MAX_ROUNDS = 15;

/** The escalation tier a given round belongs to (drives the UI tag + theme). */
export type ColosseumTier = "normal" | "ghost" | "boss" | "gym" | "champion";

/** A single resolved party member, stored as plain JSON (rebuilt at battle time). */
interface RoundMember {
  speciesId: number;
  abilityIndex?: number;
  nature?: number;
  ivs?: number[];
  moves?: number[];
  formIndex?: number;
  gender?: number;
  shiny?: boolean;
  variant?: number;
  passive?: boolean;
}

/** One challenger in the rolled gauntlet. All fields are JSON-serialisable. */
export interface ColosseumChallenger {
  tier: ColosseumTier;
  /** Display name (the source player's account name for ghosts). */
  name: string;
  /** Trainer-class atlas key for the portrait + battle sprite. */
  spriteKey: string;
  /** TrainerType supplying the sprite + (for vanilla rounds) the team. */
  trainerType: TrainerType;
  /** True when this is a real player ghost team. */
  isGhost: boolean;
  /** Explicit team; empty = use the trainerType's own (vanilla) team. */
  members: RoundMember[];
}

// Boss / gym / champion ROM trainer-type ids in the ER registry (mirrors the
// private ER_BOSS_TRAINER_TYPES in er-trainer-runtime-hook).
const ER_LEADER_TYPE = 200;
const ER_ELITE_FOUR_TYPE = 300;
const ER_CHAMPION_TYPES = new Set([350, 352]);

// Vanilla trainer-class pools for sprites + names (and, on Ace/Youngster, teams).
const V_NORMAL: TrainerType[] = [
  TrainerType.YOUNGSTER,
  TrainerType.BUG_CATCHER,
  TrainerType.SCHOOL_KID,
  TrainerType.CYCLIST,
  TrainerType.HIKER,
  TrainerType.BLACK_BELT,
  TrainerType.ROUGHNECK,
  TrainerType.RANGER,
  TrainerType.ACE_TRAINER,
  TrainerType.VETERAN,
];
const V_GYM: TrainerType[] = [
  TrainerType.BROCK,
  TrainerType.MISTY,
  TrainerType.LT_SURGE,
  TrainerType.ERIKA,
  TrainerType.KOGA,
  TrainerType.SABRINA,
  TrainerType.BLAINE,
  TrainerType.GIOVANNI,
  TrainerType.NORMAN,
  TrainerType.WINONA,
  TrainerType.CLAIR,
  TrainerType.WHITNEY,
  TrainerType.JASMINE,
  TrainerType.NESSA,
  TrainerType.RAIHAN,
  TrainerType.MARNIE,
];
const V_BOSS: TrainerType[] = [
  TrainerType.LORELEI,
  TrainerType.BRUNO,
  TrainerType.AGATHA,
  TrainerType.WILL,
  TrainerType.KAREN,
  TrainerType.SIDNEY,
  TrainerType.PHOEBE,
  TrainerType.GLACIA,
  TrainerType.DRAKE,
  TrainerType.AARON,
  TrainerType.BERTHA,
  TrainerType.FLINT,
  TrainerType.LUCIAN,
];
const V_CHAMP: TrainerType[] = [
  TrainerType.CYNTHIA,
  TrainerType.LANCE,
  TrainerType.STEVEN,
  TrainerType.WALLACE,
  TrainerType.ALDER,
  TrainerType.IRIS,
  TrainerType.DIANTHA,
  TrainerType.LEON,
  TrainerType.BLUE,
  TrainerType.RED,
];
// The trainer classes a ghost can wear (mirrors createGhostTrainer's spirit).
const V_GHOST_CLASS: TrainerType[] = [
  TrainerType.VETERAN,
  TrainerType.ACE_TRAINER,
  TrainerType.BLACK_BELT,
  TrainerType.CYCLIST,
  TrainerType.RANGER,
];

// Seeded RNG (NOT Math.random) so the rolled gauntlet is deterministic per run seed - required
// for co-op (#633): both clients must roll the IDENTICAL roster, and it makes the gauntlet replayable.
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randSeedInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: readonly T[]): T {
  return randSeedItem(arr);
}

/** The atlas key + sprite for a trainer class (single, non-double, default gender). */
function spriteKeyFor(type: TrainerType): string {
  return trainerConfigs[type]?.getSpriteKey(false, false) ?? "veteran_m";
}

/** The display class name for a trainer type (used when there's no player name). */
function classNameFor(type: TrainerType): string {
  // Fall back to a humanised enum name if the config has no localized name.
  return TrainerType[type]
    .toString()
    .toLowerCase()
    .split("_")
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function erMember(m: ErTrainerRegistryEntry["party"][number]): RoundMember {
  return {
    speciesId: m.speciesId,
    abilityIndex: m.abilitySlot,
    nature: m.nature,
    ivs: [...m.ivs],
    moves: [...m.moves],
  };
}

function ghostMember(m: GhostTeamSnapshot["party"][number]): RoundMember {
  return {
    speciesId: m.speciesId,
    abilityIndex: m.abilityIndex,
    nature: m.nature,
    ivs: [...m.ivs],
    moves: [...m.moves],
    formIndex: m.formIndex,
    gender: m.gender,
    shiny: m.shiny,
    variant: m.variant,
    passive: m.passive,
  };
}

/** A vanilla-class challenger (sprite + name from the type; team from `members`). */
function trainerChallenger(tier: ColosseumTier, type: TrainerType, members: RoundMember[]): ColosseumChallenger {
  return { tier, name: classNameFor(type), spriteKey: spriteKeyFor(type), trainerType: type, isGhost: false, members };
}

/** A ghost challenger: a ghost-class sprite, the player's name, the ghost team. */
function ghostChallenger(tier: ColosseumTier, snapshot: GhostTeamSnapshot): ColosseumChallenger {
  const type = pick(V_GHOST_CLASS);
  const name = snapshot.trainerName?.trim() || classNameFor(type);
  return {
    tier,
    name: name.slice(0, 16),
    spriteKey: spriteKeyFor(type),
    trainerType: type,
    isGhost: true,
    members: snapshot.party.slice(0, 6).map(ghostMember),
  };
}

/** ER registry entries split into pools, sorted weakest->strongest for the tier. */
function erPools(tier: ErRosterTier) {
  const byStrength = (a: ErTrainerRegistryEntry, b: ErTrainerRegistryEntry) =>
    teamStrength(a, tier) - teamStrength(b, tier);
  const isBoss = (e: ErTrainerRegistryEntry) =>
    e.trainerType === ER_LEADER_TYPE || e.trainerType === ER_ELITE_FOUR_TYPE || ER_CHAMPION_TYPES.has(e.trainerType);
  return {
    normal: ER_TRAINER_REGISTRY.filter(e => !isBoss(e) && e.party.length > 0).sort(byStrength),
    elite4: ER_TRAINER_REGISTRY.filter(e => e.trainerType === ER_ELITE_FOUR_TYPE && e.party.length > 0).sort(
      byStrength,
    ),
    leaders: ER_TRAINER_REGISTRY.filter(e => e.trainerType === ER_LEADER_TYPE && e.party.length > 0).sort(byStrength),
    champions: ER_TRAINER_REGISTRY.filter(e => ER_CHAMPION_TYPES.has(e.trainerType) && e.party.length > 0).sort(
      byStrength,
    ),
  };
}

/**
 * Roll the full 15-challenger gauntlet for the current run's difficulty. Never
 * throws - on any pool/ghost failure it falls back to vanilla trainers so the
 * gauntlet is always complete. Async because it samples the cross-player ghost
 * pool.
 */
export async function buildColosseumGauntlet(): Promise<ColosseumChallenger[]> {
  const diff: ErDifficulty = getErDifficulty();
  const vanilla = isErVanillaDifficulty();
  const tier: ErRosterTier = erDifficultyToRosterTier();

  // Pull ghosts up front (mode-preferred). Deadliest = ranked by kills.
  let sampled: GhostTeamSnapshot[] = [];
  let deadliest: GhostTeamSnapshot[] = [];
  try {
    [sampled, deadliest] = await Promise.all([
      sampleGhostSnapshots(diff, 14, 0).catch(() => []),
      fetchDeadliestGhosts(vanilla ? diff : "any", 4, 0).catch(() => []),
    ]);
  } catch {
    /* offline / guest - fall through to trainer fallbacks */
  }
  const usedGhosts = new Set<string>();
  const takeGhost = (preferStrong: boolean): GhostTeamSnapshot | null => {
    const fromDeadliest = preferStrong ? deadliest.filter(s => isErGhostTeamLegal(s) && !usedGhosts.has(s.id)) : [];
    const general = sampled.filter(s => isErGhostTeamLegal(s) && !usedGhosts.has(s.id));
    // Prefer same-mode ghosts; deepest first when we want a "strong" one.
    const ordered = [
      ...fromDeadliest,
      ...general.filter(s => s.difficulty === diff),
      ...general.filter(s => s.difficulty !== diff),
    ];
    if (preferStrong) {
      ordered.sort((a, b) => b.waveReached - a.waveReached);
    }
    const chosen = ordered[0];
    if (chosen) {
      usedGhosts.add(chosen.id);
    }
    return chosen ?? null;
  };

  // Vanilla-class sprite/name pools (shuffled so each run looks different).
  const normals = shuffle(V_NORMAL);
  const gyms = shuffle(V_GYM);
  const bosses = shuffle(V_BOSS);
  const champs = shuffle(V_CHAMP);

  // ER team pools (Elite/Hell only).
  const pools = vanilla ? null : erPools(tier);
  const erNormalTeam = (round: number): RoundMember[] => {
    if (!pools || pools.normal.length === 0) {
      return [];
    }
    // Lower band of the normal pool, scaled a little by round.
    const band = Math.min(pools.normal.length - 1, Math.floor((pools.normal.length / 3) * (round / 4)));
    const e = pools.normal[Math.max(0, band)];
    return selectErRoster(e, tier).map(erMember);
  };
  const erTeamFrom = (list: ErTrainerRegistryEntry[] | undefined): RoundMember[] => {
    if (!list || list.length === 0) {
      return [];
    }
    // Pick from the stronger half for boss/gym/champion punch (seeded for co-op/replay determinism).
    const half = Math.floor(list.length / 2);
    const e = list[half + randSeedInt(list.length - half)] ?? list.at(-1);
    return e ? selectErRoster(e, tier).map(erMember) : [];
  };

  const out: ColosseumChallenger[] = [];

  // Rounds 1-4: normal trainers.
  for (let i = 0; i < 4; i++) {
    out.push(trainerChallenger("normal", normals[i % normals.length], erNormalTeam(i + 1)));
  }
  // Rounds 5-8: mode ghosts (fallback: a gym trainer if the pool is dry).
  for (let i = 0; i < 4; i++) {
    const g = takeGhost(false);
    out.push(
      g ? ghostChallenger("ghost", g) : trainerChallenger("gym", gyms[i % gyms.length], erTeamFrom(pools?.leaders)),
    );
  }
  // Rounds 9-10: bosses (Elite Four tier).
  for (let i = 0; i < 2; i++) {
    out.push(trainerChallenger("boss", bosses[i % bosses.length], erTeamFrom(pools?.elite4)));
  }
  // Rounds 11-12: gym leaders.
  for (let i = 0; i < 2; i++) {
    out.push(trainerChallenger("gym", gyms[(i + 4) % gyms.length], erTeamFrom(pools?.leaders)));
  }
  // Rounds 13-14: strong / late ghosts (14 = the deadliest if we have one).
  for (let i = 0; i < 2; i++) {
    const g = takeGhost(true);
    out.push(
      g
        ? ghostChallenger("ghost", g)
        : trainerChallenger("boss", bosses[(i + 2) % bosses.length], erTeamFrom(pools?.elite4)),
    );
  }
  // Round 15: a Champion.
  out.push(trainerChallenger("champion", champs[0], erTeamFrom(pools?.champions)));

  return out.slice(0, MAX_ROUNDS);
}

/**
 * The desired FLAT "slightly above" level bump for the vanilla (Ace/Youngster)
 * colosseum round, where the trainer brings its own team so we can't pin each mon
 * to {@linkcode colosseumTargetLevel} directly.
 */
const COLOSSEUM_VANILLA_LEVEL_NUDGE = 2;

/**
 * The `levelAdditiveModifier` that lands the vanilla round's enemies a FLAT
 * {@linkcode COLOSSEUM_VANILLA_LEVEL_NUDGE} levels above the wave curve, at ANY wave.
 * The framework formula is `level += round(waveIndex / 10 * modifier)`, so a fixed
 * modifier of 2 added +2 at wave 20 but a huge +24 at wave 118 (the "tournament
 * trainers were ~20 levels over my cap" report). Scale the modifier by the inverse
 * of the wave so the round is a small constant nudge regardless of depth.
 */
export function colosseumVanillaLevelModifier(waveIndex: number): number {
  return waveIndex > 0 ? (COLOSSEUM_VANILLA_LEVEL_NUDGE * 10) / waveIndex : 0;
}

/** Enemy level every gauntlet mon is pinned to: your strongest party member. */
function colosseumTargetLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl));
}

function toPokemonConfig(m: RoundMember, level: number): EnemyPokemonConfig {
  const cfg: EnemyPokemonConfig = {
    species: getPokemonSpecies(m.speciesId),
    isBoss: false,
    level,
  };
  if (m.abilityIndex !== undefined) {
    cfg.abilityIndex = m.abilityIndex;
  }
  if (m.nature !== undefined) {
    cfg.nature = m.nature as Nature;
  }
  if (m.ivs && m.ivs.length === 6) {
    cfg.ivs = m.ivs as [number, number, number, number, number, number];
  }
  if (m.moves && m.moves.length > 0) {
    cfg.moveSet = m.moves as MoveId[];
  }
  if (m.formIndex !== undefined) {
    cfg.formIndex = m.formIndex;
  }
  if (m.gender !== undefined) {
    cfg.gender = m.gender as Gender;
  }
  if (m.shiny !== undefined) {
    cfg.shiny = m.shiny;
  }
  if (m.variant !== undefined) {
    cfg.variant = m.variant as Variant;
  }
  if (m.passive !== undefined) {
    cfg.passive = m.passive;
  }
  return cfg;
}

/**
 * Build the EnemyPartyConfig for one challenger, pinning injected teams to the
 * player's strongest level. Ghosts use a cloned trainerConfig so the player's
 * name shows; everything else uses the stock trainerType (sprite + name, and the
 * vanilla team on Ace/Youngster where `members` is empty).
 */
export function colosseumRoundConfig(challenger: ColosseumChallenger): EnemyPartyConfig {
  const level = colosseumTargetLevel();
  const pokemonConfigs = challenger.members.map(m => toPokemonConfig(m, level));

  if (challenger.isGhost) {
    const trainerConfig = trainerConfigs[challenger.trainerType].clone();
    trainerConfig.setName(challenger.name);
    return { trainerConfig, pokemonConfigs };
  }
  if (pokemonConfigs.length > 0) {
    return { trainerType: challenger.trainerType, pokemonConfigs };
  }
  // Pure-vanilla round (Ace/Youngster): the trainer brings its own team; nudge the
  // level a FLAT couple of levels above the wave curve so it isn't trivially
  // under-levelled - but wave-independently, so late-wave rounds don't balloon ~20
  // levels over the player's cap (the world-tournament over-level report).
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  return { trainerType: challenger.trainerType, levelAdditiveModifier: colosseumVanillaLevelModifier(wave) };
}
