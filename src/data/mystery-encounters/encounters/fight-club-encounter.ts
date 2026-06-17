/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #524 - The Fight Club. A SLUM bet/brawl event (design PART XIX / transcript
// line 124231). An illegal back-alley ring: ante your money and brawl a no-rules
// fighter who pulls every dirty trick to beat you down. Win the bet for a big
// payout; lose and your ante is gone.
//
// The fighters fight DIRTY, and they OUTNUMBER you to mess with you:
//   - they field MORE Pokemon than your lead (a 2-mon tag team, a 3-mon gang on
//     the big bet) and TRAP you in the ring (no switching out);
//   - some SWAGGER in juiced up - an illegal all-stats power-up on entry;
//   - cheap-shot leads: Fake Out flinches, Sand Attack blinds you, Toxic / Swagger
//     cripple you, Knock Off swipes your item;
//   - rigged gear: Quick Claw (cheap first strike), Focus Band (cheats death),
//     King's Rock (extra flinches), Wide Lens (their dirty moves never miss).
// Every trick is announced (on-entry messages + the engine's own move/stat text)
// so the player can SEE they're being cheated, then beat the cheaters down.
//
//   STEP IN (small ante): a 2-mon dirty tag team -> an Ultra+Great payout.
//   UP THE ANTE (big ante): a 3-mon dirty gang, nastier -> a Rogue+Ultra+Great haul.
//   BACK OUT: walk away from the ring, no cost.
//
// NOTE: the design's "you may only use 1-2 of your own mons" handicap needs a
// player-party-restriction mechanic that isn't built; this ships the bet + the
// dirty, outnumbering fight (a full-party brawl) instead. The ante is a buy-in
// (spent on entry); the payout is the fighters' loot + the trainer winnings.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { TrainerPartyTemplate } from "#data/trainers/trainer-party-template";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const namespace = "mysteryEncounters/fightClub";

/** Wave-money multipliers for the two bet sizes (the buy-in, spent on entry). */
const SMALL_ANTE_MULT = 1.5;
const BIG_ANTE_MULT = 4;

const ALL_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

/**
 * The back-alley brawler roster: thuggish, hard-hitting VANILLA species (so the
 * Fight Club stays vanilla-safe in every difficulty mode). Fighters are sampled
 * fresh from this pool each run, so the crew is varied and never the same set
 * twice. Their movesets are forced (see the dirty kits below), so type/legality
 * does not matter - any of them can throw the same dirty tricks.
 */
const BRAWLER_POOL: SpeciesId[] = [
  SpeciesId.SCRAFTY,
  SpeciesId.OBSTAGOON,
  SpeciesId.INCINEROAR,
  SpeciesId.MACHAMP,
  SpeciesId.CONKELDURR,
  SpeciesId.HARIYAMA,
  SpeciesId.PANGORO,
  SpeciesId.MIENSHAO,
  SpeciesId.TOXICROAK,
  SpeciesId.BEWEAR,
  SpeciesId.PRIMEAPE,
  SpeciesId.HITMONLEE,
  SpeciesId.HITMONCHAN,
  SpeciesId.HITMONTOP,
  SpeciesId.GURDURR,
  SpeciesId.GRIMMSNARL,
  SpeciesId.WEAVILE,
  SpeciesId.ABSOL,
  SpeciesId.MIGHTYENA,
  SpeciesId.KROOKODILE,
  SpeciesId.ZANGOOSE,
  SpeciesId.URSARING,
  SpeciesId.GRANBULL,
];

/**
 * Forced "dirty fighter" movesets - every fighter throws cheap shots regardless
 * of its species (the moveSet is forced, so legality is irrelevant). One generic
 * kit per crew slot.
 */
const DIRTY_KITS: MoveId[][] = [
  [MoveId.FAKE_OUT, MoveId.SAND_ATTACK, MoveId.KNOCK_OFF, MoveId.BODY_SLAM],
  [MoveId.FAKE_OUT, MoveId.TOXIC, MoveId.SWAGGER, MoveId.FACADE],
  [MoveId.FAKE_OUT, MoveId.SAND_ATTACK, MoveId.SWAGGER, MoveId.BODY_SLAM],
];

/** Rigged gear sets, one per crew slot (cheat items that never miss / cheat death). */
const RIGGED_GEAR: ModifierTypeFunc[][] = [
  [modifierTypes.QUICK_CLAW, modifierTypes.FOCUS_BAND],
  [modifierTypes.KINGS_ROCK, modifierTypes.LEFTOVERS],
  [modifierTypes.QUICK_CLAW, modifierTypes.WIDE_LENS],
];

/** Pick `n` distinct entries from `pool` using the seeded RNG (for run variety). */
function pickDistinct<T>(pool: readonly T[], n: number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    out.push(copy.splice(randSeedInt(copy.length), 1)[0]);
  }
  return out;
}

interface DirtyOpts {
  moves: MoveId[];
  items: ModifierTypeFunc[];
  /** Boss-segment staying power (the big-bet gang). */
  boss?: boolean;
  /** Swaggers in with an illegal all-stats power-up on entry. */
  swagger?: boolean;
}

function ante(mult: number): number {
  return Math.max(1, Math.floor(globalScene.getWaveMoneyAmount(mult)));
}

/** Level the fighters are pinned to: the player's strongest party member / wave. */
function fightLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl));
}

/** Build one dirty fighter: rigged gear, cheap-shot moveset, optional swagger boost. */
function dirtyMon(species: SpeciesId, level: number, opts: DirtyOpts): EnemyPokemonConfig {
  const cfg: EnemyPokemonConfig = {
    species: getPokemonSpecies(species),
    isBoss: opts.boss ?? false,
    level,
    moveSet: opts.moves,
    modifierConfigs: opts.items.map(fn => ({
      modifier: generateModifierType(fn) as PokemonHeldItemModifierType,
      isTransferable: false,
    })),
  };
  if (opts.boss) {
    cfg.bossSegments = 2;
  }
  if (opts.swagger) {
    cfg.tags = [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON];
    cfg.mysteryEncounterBattleEffects = (pokemon: Pokemon) => {
      // Announce the cheat, then apply the illegal all-stats power-up on entry.
      globalScene.phaseManager.queueMessage(
        i18next.t(`${namespace}:dirtyEntry`, { pokemonName: pokemon.getNameToRender() }),
        null,
        true,
      );
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, ALL_STATS, 1);
    };
  }
  return cfg;
}

/**
 * The dirty fighter's crew, sampled fresh from the brawler pool each run (varied,
 * never the same set twice). Two mons for the small bet, a third (nastier) for the
 * big bet. Every fighter gets a forced dirty kit + rigged gear; the lead (and the
 * big-bet enforcer) also swaggers in juiced up.
 */
function buildFight(big: boolean): EnemyPartyConfig {
  const level = fightLevel();
  const count = big ? 3 : 2;
  const species = pickDistinct(BRAWLER_POOL, count);
  const pokemonConfigs: EnemyPokemonConfig[] = species.map((sp, i) =>
    dirtyMon(sp, level, {
      moves: DIRTY_KITS[i % DIRTY_KITS.length],
      items: RIGGED_GEAR[i % RIGGED_GEAR.length],
      // The lead and the big-bet enforcer get the illegal entry juicing.
      swagger: i === 0 || (big && i === 2),
      boss: big,
    }),
  );
  const trainerConfig = trainerConfigs[TrainerType.ROUGHNECK]
    .clone()
    .setPartyTemplates(new TrainerPartyTemplate(pokemonConfigs.length, PartyMemberStrength.STRONGER));
  // disableSwitch: they trap you in the ring (no switching out) - a dirty trick in itself.
  return { trainerConfig, pokemonConfigs, disableSwitch: true };
}

/** Take the bet: spend the ante, set the payout, warn of the dirty fight, then brawl. */
async function takeBet(big: boolean): Promise<void> {
  updatePlayerMoney(-ante(big ? BIG_ANTE_MULT : SMALL_ANTE_MULT), true, false);
  setEncounterRewards({
    guaranteedModifierTiers: big
      ? [ModifierTier.ROGUE, ModifierTier.ULTRA, ModifierTier.GREAT]
      : [ModifierTier.ULTRA, ModifierTier.GREAT],
    fillRemaining: false,
  });
  queueEncounterMessage(`${namespace}:dirtyWarning`);
  await transitionMysteryEncounterIntroVisuals(true, false);
  await initBattleWithEnemyConfig(buildFight(big));
}

export const FightClubEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_FIGHT_CLUB,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The ring's headliner - a back-alley punk (Obstagoon).
    { species: SpeciesId.OBSTAGOON, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Surface both ante sizes so the player can read the bet before choosing.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.setDialogueToken("smallAnte", String(ante(SMALL_ANTE_MULT)));
    encounter.setDialogueToken("bigAnte", String(ante(BIG_ANTE_MULT)));
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [{ text: `${namespace}:option.1.selected` }],
    },
    async () => {
      await takeBet(false);
      return true;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ text: `${namespace}:option.2.selected` }],
    },
    async () => {
      await takeBet(true);
      return true;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ text: `${namespace}:option.3.selected` }],
    },
    async () => {
      // Back out of the ring - no bet, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
