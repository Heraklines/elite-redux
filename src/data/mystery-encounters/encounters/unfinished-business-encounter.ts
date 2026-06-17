/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #517 - Unfinished Business. The SECOND GRAVEYARD event (design transcript
// line 124021, maintainer-approved 124027). Where Graves of the Fallen loots the
// dead, this one settles their SCORE. Every game-over snapshot stores not just
// the fallen's team but the team that KILLED them (GhostTeamSnapshot.opponentParty,
// captured from currentBattle.enemyParty at run end). This event surfaces that:
//
//   FINISH THEIR FIGHT (risk): a grave of someone who almost made it - the
//     epitaph names WHO beat them, at WHAT wave, on WHAT difficulty. Take up
//     their cause and you face the EXACT team that ended their run (the real
//     opponentParty snapshot, presented as a spectral ghost trainer named after
//     the killer, level-scaled to the wave). Win -> the grateful spirit hands
//     over the prize they were reaching for: a RANDOM combat RELIC (maintainer
//     ruling line 124027 - no need to reconstruct their actual would-be prize).
//   WALK ON: leave their fight unfinished, no cost.
//
// The epitaph is full intel - the harder the killer, the better the read on
// whether you can win. Rides the same ghost-team substrate as Graves of the
// Fallen; no new engine. A synthetic legacy grave (with a killer team) is seeded
// so it never softlocks when forced / offline.
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
import type { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Nature } from "#enums/nature";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
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
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/unfinishedBusiness";

/**
 * The combat / utility relics a won avenge fight can yield. The maintainer ruled
 * the "prize they were reaching for" is just a random relic; this is a curated,
 * combat-leaning pool. The three event-signature relics (Molten Core, Capacitor,
 * Pharaoh's Ankh) are deliberately excluded so their own events stay the way to
 * earn them.
 */
const AVENGE_RELIC_FUNCS: ModifierTypeFunc[] = [
  modifierTypes.ER_RELIC_MORALE_BANNER,
  modifierTypes.ER_RELIC_SECOND_WIND,
  modifierTypes.ER_RELIC_TWIN_LINK,
  modifierTypes.ER_RELIC_ANCHOR,
  modifierTypes.ER_RELIC_WEATHERVANE,
  modifierTypes.ER_RELIC_MYSTERY_CHARM,
  modifierTypes.ER_RELIC_FIELD_MEDIC,
  modifierTypes.ER_RELIC_BONDED_CHARM,
];

interface BusinessMisc {
  /** The fallen challenger whose score we can settle. */
  grave: GhostTeamSnapshot;
}

function getMisc(): BusinessMisc | undefined {
  return globalScene.currentBattle.mysteryEncounter?.misc as BusinessMisc | undefined;
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

/** The killer's display name for the epitaph + the spectral trainer. */
function killerName(grave: GhostTeamSnapshot): string {
  return grave.opponentName?.trim() || "a vengeful spirit";
}

/** Stash `grave` on the encounter and (re)write the epitaph dialogue tokens. */
function applyGrave(encounter: MysteryEncounter, grave: GhostTeamSnapshot): void {
  encounter.misc = { grave } satisfies BusinessMisc;
  encounter.setDialogueToken("trainerName", grave.trainerName?.trim() || "An Unknown Challenger");
  encounter.setDialogueToken("difficulty", difficultyLabel(grave.difficulty));
  encounter.setDialogueToken("waveReached", String(grave.waveReached));
  encounter.setDialogueToken("opponentName", killerName(grave));
}

/**
 * A synthetic "legacy" grave used when the ghost pool is empty (offline / guest /
 * forced via a dev override). It carries a real killer team (opponentParty) so the
 * avenge fight always builds, and no opponent name nuance is needed. Never
 * softlocks.
 */
function syntheticLegacyGrave(): GhostTeamSnapshot {
  const level = Math.max(1, globalScene.currentBattle?.getLevelForWave?.() ?? 20);
  const member = (speciesId: number): GhostMember => ({
    speciesId,
    formIndex: 0,
    abilityIndex: 0,
    ivs: [20, 20, 20, 20, 20, 20],
    nature: 0,
    level,
    gender: -1,
    shiny: false,
    variant: 0,
    passive: false,
    moves: [],
  });
  return {
    id: `legacy-business-${globalScene.seed ?? "seed"}`,
    trainerName: "An Unknown Challenger",
    difficulty: getErDifficulty(),
    waveReached: globalScene.currentBattle?.waveIndex ?? 0,
    isVictory: false,
    timestamp: 0,
    // The fallen's own team is irrelevant here; what matters is the killer team.
    party: [member(SpeciesId.GENGAR)],
    opponentName: "A Champion's Shade",
    // A strong-but-fair trio that "ended their run".
    opponentParty: [member(SpeciesId.GARCHOMP), member(SpeciesId.SPIRITOMB), member(SpeciesId.MILOTIC)],
  };
}

/**
 * Resolve a GhostMember to an EnemyPokemonConfig, pinned to `level` so the killer
 * team scales to the current wave. Mirrors Graves of the Fallen's toEnemyConfig.
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

/** Enemy level the killer team is pinned to: the player's strongest party member / wave. */
function avengeTargetLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl));
}

/** The killer team members whose species still resolve (legacy/cross-version safe). */
function resolvableKillers(grave: GhostTeamSnapshot): GhostMember[] {
  return (grave.opponentParty ?? []).slice(0, 6).filter(m => !!getPokemonSpecies(m.speciesId));
}

/** Spectral trainer classes the risen killer can present as (cosmetic only). */
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
 * Build the avenge battle: the killer team as a real (spectral) TRAINER, sized to
 * exactly its mons (no random filler). If nothing resolves, fall back to a single
 * resolvable mon so the battle never spawns an undefined species.
 */
function buildAvengeBattle(grave: GhostTeamSnapshot, killers: GhostMember[]): EnemyPartyConfig {
  const level = avengeTargetLevel();
  const pokemonConfigs = killers.map(m => toEnemyConfig(m, level));
  if (pokemonConfigs.length === 0) {
    pokemonConfigs.push({ species: getPokemonSpecies(SpeciesId.GENGAR), isBoss: false, level });
  }
  const trainerConfig = trainerConfigs[graveTrainerType(grave)]
    .clone()
    .setPartyTemplates(new TrainerPartyTemplate(pokemonConfigs.length, PartyMemberStrength.STRONGER));
  return { trainerConfig, pokemonConfigs };
}

export const UnfinishedBusinessEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_UNFINISHED_BUSINESS,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A soul-gripping spectre lingering by the grave (Dusknoir), shaded ghostly.
    { species: SpeciesId.DUSKNOIR, spriteKey: "", fileRoot: "", hasShadow: true, tint: 0.4, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // onInit is SYNCHRONOUS: seed a synthetic legacy grave + epitaph tokens at
    // once, then fire an async ghost-pool sample that UPGRADES to a real grave
    // WITH a killer team when it resolves. Failure keeps the legacy grave, so the
    // encounter never softlocks (forced / offline).
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    applyGrave(encounter, syntheticLegacyGrave());
    void sampleGhostSnapshots(getErDifficulty(), 8, 0)
      .then(snaps => {
        // Prefer a grave whose killer was a real TEAM (2+), else any with a killer.
        const withKiller = snaps.filter(s => (s.opponentParty?.length ?? 0) > 0);
        const grave = withKiller.find(s => (s.opponentParty?.length ?? 0) >= 2) ?? withKiller[0];
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
        // FINISH THEIR FIGHT: face the exact killer team. Win -> a random relic.
        const grave = getMisc()?.grave ?? syntheticLegacyGrave();
        const killers = resolvableKillers(grave);
        const relic = randSeedItem(AVENGE_RELIC_FUNCS);
        setEncounterRewards({ guaranteedModifierTypeFuncs: [relic], fillRemaining: false });
        await transitionMysteryEncounterIntroVisuals(true, false);
        await initBattleWithEnemyConfig(buildAvengeBattle(grave, killers));
        // Present the killer team as a spectral trainer named after the killer.
        if (globalScene.currentBattle.trainer) {
          markTrainerAsGhost(globalScene.currentBattle.trainer, {
            ...grave,
            party: killers,
            trainerName: killerName(grave),
          });
        }
        return true;
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ text: `${namespace}:option.2.selected` }],
    },
    async () => {
      // Walk on - leave their fight unfinished, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
