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
//   DISTURB (risk): the fallen team's ghost RISES and fights you (enemy party is
//     rebuilt from the GhostMember[] snapshot, level-scaled to the wave). Win ->
//     reward is 2 of their held items (or 2 Ultra-tier fallbacks). Combat branch.
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
import { type GhostMember, type GhostTeamSnapshot, sampleGhostSnapshots } from "#data/elite-redux/er-ghost-teams";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { Gender } from "#data/gender";
import { ModifierTier } from "#enums/modifier-tier";
import type { MoveId } from "#enums/move-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Nature } from "#enums/nature";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
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

/** Build the wild-style enemy party config for the risen ghost team. */
function buildGraveBattle(grave: GhostTeamSnapshot): EnemyPartyConfig {
  const level = graveTargetLevel();
  const pokemonConfigs = grave.party.slice(0, 6).map(m => toEnemyConfig(m, level));
  return { pokemonConfigs };
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
    const chosen = funcs[Math.floor(Math.random() * funcs.length)];
    setEncounterRewards({ guaranteedModifierTypeFuncs: [chosen], fillRemaining: false });
  } else {
    setEncounterRewards({ guaranteedModifierTiers: [FALLBACK_TIER], fillRemaining: false });
  }
  leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
}

/**
 * Set up the DISTURB-win reward: up to {@linkcode DISTURB_REWARD_ITEMS} of the
 * fallen team's held items, topped up with Ultra-tier fallbacks so the player
 * always gets exactly that many picks (legacy graves pay out all fallbacks).
 * Called BEFORE initBattleWithEnemyConfig; the shop opens after the win.
 */
function setDisturbRewards(grave: GhostTeamSnapshot): void {
  const funcs = resolvableHeldItemFuncs(grave);
  // Deduplicate while preserving order, then take up to the payout count.
  const seen = new Set<ModifierTypeFunc>();
  const guaranteedModifierTypeFuncs: ModifierTypeFunc[] = [];
  for (const fn of funcs) {
    if (!seen.has(fn)) {
      seen.add(fn);
      guaranteedModifierTypeFuncs.push(fn);
    }
    if (guaranteedModifierTypeFuncs.length >= DISTURB_REWARD_ITEMS) {
      break;
    }
  }
  const fallbackCount = DISTURB_REWARD_ITEMS - guaranteedModifierTypeFuncs.length;
  setEncounterRewards({
    guaranteedModifierTypeFuncs,
    guaranteedModifierTiers: new Array(fallbackCount).fill(FALLBACK_TIER),
    fillRemaining: false,
  });
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
        const grave = getMisc()?.grave ?? syntheticLegacyGrave();
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
        // DISTURB (risk): the fallen team rises and fights. The reward shop (2 of
        // their held items, Ultra-tier fallbacks) opens after the win.
        const grave = getMisc()?.grave ?? syntheticLegacyGrave();
        setDisturbRewards(grave);
        await transitionMysteryEncounterIntroVisuals(true, false);
        await initBattleWithEnemyConfig(buildGraveBattle(grave));
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
