/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Graves of the Fallen. A GRAVEYARD-biome mystery encounter that rides
// the cross-player ghost-team substrate (er-ghost-teams.ts). A headstone marks a
// REAL fallen challenger pulled from the ghost pool, with a plain epitaph (name /
// difficulty / "fell at wave N" / "beaten by <opponent>").
//
//   PAY RESPECTS (safe): take a MEMENTO = one of the fallen team's HELD ITEMS
//     (GhostMember.heldItems = [modifierTypeId, count] pairs). Legacy graves with
//     no item data, or items that no longer resolve, fall back to a random
//     Ultra-tier item or berry. Leaves without battle, never softlocks.
//   DISTURB (risk): the fallen team's ghost RISES as a named ghost TRAINER (the
//     source player's account name + ghost BGM, a cosmetic spooky trainer class)
//     fielding the snapshot's actual team, level-scaled to the wave. Unresolvable
//     species are filtered so it never crashes. Win -> reward is 2 of their held
//     items (or 2 Ultra-tier fallbacks).
//   WALK AWAY: leave with no cost.
//
// The chosen grave (a GhostTeamSnapshot) is fetched in onInit and stashed on
// encounter.misc. If the pool is empty / the player is offline, a synthetic
// "legacy" grave is used so the encounter is always reachable (and the memento
// falls back to an Ultra-tier item) - it never softlocks when forced.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import {
  type GhostMember,
  type GhostTeamSnapshot,
  markTrainerAsGhost,
  sampleGhostSnapshots,
} from "#data/elite-redux/er-ghost-teams";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { Gender } from "#data/gender";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { TrainerPartyTemplate } from "#data/trainers/trainer-party-template";
import { ModifierTier } from "#enums/modifier-tier";
import type { MoveId } from "#enums/move-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Nature } from "#enums/nature";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { TrainerType } from "#enums/trainer-type";
import type { CustomModifierSettings, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { Variant } from "#sprites/variant";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedItem, randSeedShuffle } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/gravesOfTheFallen";

/** How many held-item mementos a DISTURB win pays out. */
const DISTURB_REWARD_ITEMS = 2;
/** Tier used for every fallback / legacy-grave reward (a 1-of choice). */
const FALLBACK_TIER = ModifierTier.ULTRA;

/** What is stashed on encounter.misc once a grave is resolved. */
interface GravesMisc {
  /** The fallen challenger whose grave this is. */
  grave: GhostTeamSnapshot;
}

function getMisc(): GravesMisc | undefined {
  return globalScene.currentBattle.mysteryEncounter?.misc as GravesMisc | undefined;
}

/** Stash `grave` on the encounter and (re)write the epitaph dialogue tokens. */
function applyGrave(encounter: MysteryEncounter, grave: GhostTeamSnapshot): void {
  encounter.misc = { grave } satisfies GravesMisc;
  encounter.setDialogueToken("trainerName", grave.trainerName?.trim() || "An Unknown Trainer");
  encounter.setDialogueToken("difficulty", difficultyLabel(grave.difficulty));
  encounter.setDialogueToken("waveReached", String(grave.waveReached));
  encounter.setDialogueToken("opponentName", grave.opponentName?.trim() || "an unknown foe");
}

/**
 * A synthetic "legacy" grave used when the ghost pool is empty (offline / guest /
 * forced via a dev override on a fresh account). It has a small generic party so
 * DISTURB still builds a real, winnable battle, and no heldItems so the memento
 * falls back to an Ultra-tier reward - exactly the legacy-grave behaviour the
 * design calls for. Never softlocks.
 */
function syntheticLegacyGrave(): GhostTeamSnapshot {
  const level = Math.max(1, globalScene.currentBattle?.getLevelForWave?.() ?? 20);
  const member = (speciesId: number): GhostMember => ({
    speciesId,
    formIndex: 0,
    abilityIndex: 0,
    ivs: [15, 15, 15, 15, 15, 15],
    nature: 0,
    level,
    gender: -1,
    shiny: false,
    variant: 0,
    passive: false,
    moves: [],
  });
  return {
    id: `legacy-grave-${globalScene.seed ?? "seed"}`,
    trainerName: "An Unknown Trainer",
    difficulty: getErDifficulty(),
    waveReached: globalScene.currentBattle?.waveIndex ?? 0,
    isVictory: false,
    timestamp: 0,
    // A generic trio so the fight is real but not overwhelming for a legacy grave.
    party: [member(94 /* Gengar */), member(609 /* Chandelure */), member(356 /* Dusclops */)],
    opponentName: "an unknown foe",
  };
}

/** Human-readable difficulty label for the epitaph. */
function difficultyLabel(difficulty: GhostTeamSnapshot["difficulty"]): string {
  switch (difficulty) {
    case "youngster":
      return "Youngster";
    case "ace":
      return "Ace";
    case "elite":
      return "Elite";
    case "hell":
      return "Hell";
    default:
      return "Unknown";
  }
}

/**
 * Resolve a GhostMember to an EnemyPokemonConfig for the DISTURB battle. Mirrors
 * the Colosseum's toPokemonConfig: keep species/form/ability/IVs/nature/moveset,
 * but pin every fallen mon to `level` so the grave scales to the current wave.
 */
function toEnemyConfig(member: GhostMember, level: number): EnemyPokemonConfig {
  const cfg: EnemyPokemonConfig = {
    species: getPokemonSpecies(member.speciesId),
    isBoss: false,
    level,
  };
  cfg.abilityIndex = member.abilityIndex;
  cfg.nature = member.nature as Nature;
  if (member.ivs.length === 6) {
    cfg.ivs = member.ivs as [number, number, number, number, number, number];
  }
  if (member.moves.length > 0) {
    cfg.moveSet = member.moves as MoveId[];
  }
  if (member.formIndex >= 0) {
    cfg.formIndex = member.formIndex;
  }
  cfg.gender = member.gender as Gender;
  cfg.shiny = member.shiny;
  cfg.variant = member.variant as Variant;
  cfg.passive = member.passive;
  return cfg;
}

/** Enemy level the grave is pinned to: the player's strongest party member. */
function graveTargetLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl));
}

/**
 * Spooky-but-strong trainer classes a risen grave can present as. Purely
 * cosmetic - the party is fully the fallen team and the name is overridden to
 * the source player's account - but varying the class keeps it from always
 * looking identical. Picked deterministically from the grave id (same grave =
 * same class everywhere), mirroring BattleScene.createGhostTrainer.
 */
const GRAVE_TRAINER_CLASSES = [
  TrainerType.HEX_MANIAC,
  TrainerType.PSYCHIC,
  TrainerType.VETERAN,
  TrainerType.ACE_TRAINER,
];

function graveTrainerType(grave: GhostTeamSnapshot): TrainerType {
  let hash = 0;
  for (let i = 0; i < grave.id.length; i++) {
    hash = (hash * 31 + grave.id.charCodeAt(i)) >>> 0;
  }
  return GRAVE_TRAINER_CLASSES[hash % GRAVE_TRAINER_CLASSES.length];
}

/**
 * Build the enemy party config for the risen ghost team as a TRAINER battle (a
 * real named ghost trainer, not a wild fight). Members whose species id does NOT
 * resolve (legacy/cross-version data) are filtered out so the battle never tries
 * to spawn an undefined-species enemy; if the whole team filters out, fall back
 * to a single resolvable mon. The trainer's party template is sized to the team
 * so initBattleWithEnemyConfig fields exactly these mons (no random filler), and
 * the option phase then marks the trainer as a ghost (player name + ghost BGM).
 */
function buildGraveBattle(grave: GhostTeamSnapshot): EnemyPartyConfig {
  const level = graveTargetLevel();
  const pokemonConfigs = grave.party
    .slice(0, 6)
    .filter(m => !!getPokemonSpecies(m.speciesId))
    .map(m => toEnemyConfig(m, level));
  if (pokemonConfigs.length === 0) {
    pokemonConfigs.push({ species: getPokemonSpecies(94 /* Gengar */), isBoss: false, level });
  }
  // Clone the cosmetic class config and pin its party size to the grave team so
  // every slot is overridden by pokemonConfigs (the fallen mons), with no filler.
  const trainerConfig = trainerConfigs[graveTrainerType(grave)]
    .clone()
    .setPartyTemplates(new TrainerPartyTemplate(pokemonConfigs.length, PartyMemberStrength.STRONGER));
  return { trainerConfig, pokemonConfigs };
}

/**
 * The held-item modifier funcs a grave can yield as mementos, in [id, count]
 * order, keeping only ids that still resolve to a real modifier type. Empty for
 * legacy graves (no item data) or when nothing resolves - the caller then falls
 * back to an Ultra-tier reward.
 */
function resolvableHeldItemFuncs(grave: GhostTeamSnapshot): ModifierTypeFunc[] {
  const funcs: ModifierTypeFunc[] = [];
  const registry = modifierTypes as Record<string, ModifierTypeFunc | undefined>;
  for (const member of grave.party) {
    for (const [typeId] of member.heldItems ?? []) {
      const factory = registry[typeId];
      if (typeof factory === "function") {
        funcs.push(factory);
      }
    }
  }
  return funcs;
}

/**
 * Grant the memento for PAY RESPECTS: one of the fallen team's held items, or a
 * random Ultra-tier reward when the grave is legacy / nothing resolves. Always a
 * single 1-of choice. Then leave without battle.
 */
function payRespects(grave: GhostTeamSnapshot): void {
  const funcs = resolvableHeldItemFuncs(grave);
  if (funcs.length > 0) {
    // Seeded (NOT Math.random) so co-op clients grant the IDENTICAL memento + it is replayable.
    const chosen = randSeedItem(funcs);
    setEncounterRewards({ guaranteedModifierTypeFuncs: [chosen], fillRemaining: false });
  } else {
    setEncounterRewards({ guaranteedModifierTiers: [FALLBACK_TIER], fillRemaining: false });
  }
  leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
}

/**
 * Solid, definitely-resolving held items used to top up a DISTURB payout. Resolved at
 * CALL time, not module load: `modifierTypes` is populated lazily at game init, after
 * this encounter module is imported, so a module-level capture froze in `undefined`
 * item funcs that were silently dropped from the reward (#616).
 */
function fallbackHeldFuncs(): ModifierTypeFunc[] {
  return [
    modifierTypes.LEFTOVERS,
    modifierTypes.WIDE_LENS,
    modifierTypes.SCOPE_LENS,
    modifierTypes.FOCUS_BAND,
    modifierTypes.QUICK_CLAW,
    modifierTypes.KINGS_ROCK,
  ];
}

/**
 * The pool of held-item reward FUNCS a DISTURB win offers: the fallen team's own
 * held items first, then solid fallbacks. De-duplicated by resolved name (so the
 * same item never appears twice in one selection screen). Returned uncapped - it's
 * a CHOICE pool, not a fixed grant (the player picks {@linkcode DISTURB_REWARD_ITEMS}
 * of these across the two selection rounds).
 */
function disturbRewardFuncs(grave: GhostTeamSnapshot): ModifierTypeFunc[] {
  const out: ModifierTypeFunc[] = [];
  const seen = new Set<string>();
  const tryAdd = (fn: ModifierTypeFunc): void => {
    const type = generateModifierType(fn) as PokemonHeldItemModifierType | null;
    if (type && !seen.has(type.name)) {
      seen.add(type.name);
      out.push(fn);
    }
  };
  for (const fn of resolvableHeldItemFuncs(grave)) {
    tryAdd(fn);
  }
  for (const fn of randSeedShuffle([...fallbackHeldFuncs()])) {
    tryAdd(fn);
  }
  return out;
}

/**
 * Wire the DISTURB win reward as a SELECTION (reported: the old direct-grant felt
 * like "no item was chosen"). On victory the player gets {@linkcode DISTURB_REWARD_ITEMS}
 * reward screens IN A ROW over the memento pool (the fallen team's held items topped
 * with solid fallbacks) - a normal screen only grants one item, so two screens let
 * the player choose two. Falls back to a guaranteed Ultra-tier pick if the pool is
 * somehow empty (it shouldn't be - the fallbacks always resolve).
 */
function setDisturbRewards(grave: GhostTeamSnapshot): void {
  const funcs = disturbRewardFuncs(grave);
  if (funcs.length === 0) {
    setEncounterRewards({ guaranteedModifierTiers: [FALLBACK_TIER, FALLBACK_TIER], fillRemaining: false });
    return;
  }
  const settings: CustomModifierSettings = { guaranteedModifierTypeFuncs: funcs, fillRemaining: false };
  // The first screen comes from `customShopRewards`; the pre-rewards callback explicitly registers
  // the SECOND screen. The helper opens the ordered plan after MysteryEncounterRewardsPhase, so the player
  // picks one item from the pool, then a second - DISTURB_REWARD_ITEMS picks total.
  setEncounterRewards(settings, undefined, ({ registerModifierSurface }) => {
    for (let i = 1; i < DISTURB_REWARD_ITEMS; i++) {
      registerModifierSurface(settings);
    }
    queueEncounterMessage(`${namespace}:disturbReward`);
  });
}

/**
 * Resolve the grave to a REAL fallen challenger: if the onInit prefetch hasn't
 * landed (we are still on the synthetic legacy grave), AWAIT a live ghost sample
 * now so DISTURB really fights a real player's team. Falls back to the synthetic
 * grave only if the pool is genuinely empty.
 */
async function resolveGrave(): Promise<GhostTeamSnapshot> {
  let grave = getMisc()?.grave ?? syntheticLegacyGrave();
  if (grave.id.startsWith("legacy-grave")) {
    try {
      const snaps = await sampleGhostSnapshots(getErDifficulty(), 6, 0);
      const real = snaps.find(s => s.party.length > 0);
      if (real) {
        applyGrave(globalScene.currentBattle.mysteryEncounter!, real);
        grave = real;
      }
    } catch {
      /* keep the synthetic legacy grave - never throw into the encounter flow */
    }
  }
  return grave;
}

export const GravesOfTheFallenEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_GRAVES_OF_THE_FALLEN,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Spectral graveside figure - reuses the already-served WEIRD_DREAM key (no
    // new asset). Swap to a dedicated tombstone/keeper sprite once one is
    // uploaded to er-assets (images/mystery-encounters/<key>.png + .json).
    { spriteKey: "weird_dream_woman", fileRoot: "mystery-encounters", hasShadow: true, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([
    { text: `${namespace}:intro` },
    { speaker: `${namespace}:speaker`, text: `${namespace}:introDialogue` },
  ])
  .withOnInit(() => {
    // onInit is SYNCHRONOUS (its result is not awaited and the description is
    // rendered right after), so seed a synthetic legacy grave + epitaph tokens
    // immediately. Then fire an async ghost-pool sample that UPGRADES the grave
    // to a real fallen challenger when it resolves - by the time the player picks
    // an option, getMisc().grave is the real grave. Failure leaves the synthetic
    // legacy grave in place, so the encounter never softlocks (forced / offline).
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    applyGrave(encounter, syntheticLegacyGrave());
    void sampleGhostSnapshots(getErDifficulty(), 6, 0)
      .then(snaps => {
        const grave = snaps.find(s => s.party.length > 0);
        if (grave) {
          applyGrave(encounter, grave);
        }
      })
      .catch(() => {
        /* keep the synthetic legacy grave - never throws into the encounter flow */
      });
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        // PAY RESPECTS (safe): a memento, then leave in peace.
        const grave = await resolveGrave();
        await transitionMysteryEncounterIntroVisuals(true, false);
        payRespects(grave);
        return true;
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        selected: [{ text: `${namespace}:option.2.selected` }],
      })
      .withOptionPhase(async () => {
        // DISTURB (risk): the fallen team's ghost RISES as a named ghost TRAINER
        // (the source player's account name + ghost BGM), fielding the snapshot's
        // actual team. Win -> the player picks TWO items in a row from the memento
        // pool (the fallen team's held items, topped with solid fallbacks).
        const grave = await resolveGrave();
        setDisturbRewards(grave);
        await transitionMysteryEncounterIntroVisuals(true, false);
        await initBattleWithEnemyConfig(buildGraveBattle(grave));
        // The trainer + its party are now built (party = the grave's mons via
        // pokemonConfigs); flag it as a ghost so it shows the fallen player's
        // name and plays the ghost theme, like the gauntlet/ghost-wave trainers.
        if (globalScene.currentBattle.trainer) {
          markTrainerAsGhost(globalScene.currentBattle.trainer, grave);
        }
        return true;
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ text: `${namespace}:option.3.selected` }],
    },
    async () => {
      // Walk away - leave undisturbed, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
