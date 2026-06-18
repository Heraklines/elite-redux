/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "Seven Sins" - The Bargain (a NEW ER mystery event, SEPARATE from the
// vanilla DARK_DEAL, which is left untouched). Giratina Origin offers 3 random
// Sins (of 7) plus Leave. Each Sin is a run-scoped cost -> payoff. EVERY mechanic
// here uses operations the game already round-trips (stat curses, vitamins, candy,
// level, shiny fields, eggs, relics, money) - nothing changes party size UPWARD
// and nothing adds new serialized save state, so the save / ghost / trainer /
// run-history systems are untouched.
//
//   Greed    - empty a mon's candy            -> money + Greater Golden Ball
//   Gluttony - give up one mon for the run    -> a Legendary egg
//   Pride    - dull a shiny mon (lose Luck)   -> +30% to a chosen stat
//   Wrath    - curse a random stat on a mon   -> +20% to another mon's best stat
//   Envy     - strip all held items (>=3)     -> choose a powerful relic (Cursed Idol)
//   Sloth    - 2 mons -> Lv 1 + wipe candy    -> Covenant of Rest relic (heal every 7)
//   Lust     - curse a random stat team-wide  -> a black-shiny reroll on one mon
//
// The 7th-party-slot, slot-seal, and borrow-and-return mechanics are intentionally
// NOT here (parked: they need cross-system save work).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { Egg } from "#data/egg";
import {
  applyErBlackShinyKit,
  playerHasErBlackShiny,
  resetErBlackShinyState,
} from "#data/elite-redux/er-black-shinies";
import { getLevelTotalExp } from "#data/exp";
import { Challenges } from "#enums/challenges";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import type { ModifierType, ModifierTypeGenerator } from "#modifiers/modifier-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle, selectPokemonForOption } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { randSeedInt } from "#utils/common";
import i18next from "i18next";

/** i18n namespace for encounter */
const namespace = "mysteryEncounters/theBargain";

type SinKey = "greed" | "gluttony" | "pride" | "wrath" | "envy" | "sloth" | "lust";
const SIN_ORDER: readonly SinKey[] = ["greed", "gluttony", "pride", "wrath", "envy", "sloth", "lust"];

/** Stat choices offered for the Pride boost (HP excluded - a chosen combat stat). */
const STAT_CHOICES: { label: string; stat: Stat }[] = [
  { label: "Attack", stat: Stat.ATK },
  { label: "Defense", stat: Stat.DEF },
  { label: "Sp. Atk", stat: Stat.SPATK },
  { label: "Sp. Def", stat: Stat.SPDEF },
  { label: "Speed", stat: Stat.SPD },
];

/** Relics offered by Envy (the strong + the double-edged Cursed Idol). */
const RELIC_CHOICES: { label: string; make: () => ModifierType }[] = [
  { label: "Cursed Idol", make: () => modifierTypes.ER_RELIC_CURSED_IDOL() },
  { label: "Second Wind", make: () => modifierTypes.ER_RELIC_SECOND_WIND() },
  { label: "Molten Core", make: () => modifierTypes.ER_RELIC_MOLTEN_CORE() },
  { label: "Capacitor", make: () => modifierTypes.ER_RELIC_CAPACITOR() },
];

/** Non-form-change held items a mon carries (the strippable ones for Envy). */
function heldCount(pokemon: PlayerPokemon): number {
  return pokemon.getHeldItems().filter(m => !(m instanceof PokemonFormChangeItemModifier)).length;
}

/** Whether a Sin's preconditions are met against the current party. */
function sinAvailable(key: SinKey): boolean {
  const party = globalScene.getPlayerParty();
  switch (key) {
    case "greed":
      return party.length > 0;
    case "gluttony":
    case "wrath":
    case "sloth":
      return party.length >= 2;
    case "pride":
      return party.some(p => p.isShiny());
    case "envy":
      return party.some(p => heldCount(p) >= 3);
    case "lust":
      return party.length > 0 && !playerHasErBlackShiny();
  }
}

/** Seeded Fisher-Yates pick of up to 3 keys (party >= 2 guarantees >= 4 available). */
function pickThreeSins(keys: SinKey[]): SinKey[] {
  const arr = [...keys];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randSeedInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 3);
}

/** The mon's strongest base combat stat (ATK..SPD) - target of the Wrath boost. */
function bestCombatStat(pokemon: PlayerPokemon): Stat {
  const base = pokemon.getSpeciesForm().baseStats;
  const candidates = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];
  let best = candidates[0];
  for (const s of candidates) {
    if (base[s] > base[best]) {
      best = s;
    }
  }
  return best;
}

/** Permanently boost one stat by `stacks` * 10% via the real vitamin modifier (so
 * it serializes exactly like a bought vitamin). Capped by the mon's IV in the stat. */
function grantStatBoost(pokemon: PlayerPokemon, stat: Stat, stacks: number): void {
  const generator = modifierTypes.BASE_STAT_BOOSTER() as ModifierTypeGenerator;
  const vitamin = generator.generateType(globalScene.getPlayerParty(), [stat]);
  if (!vitamin) {
    return;
  }
  for (let i = 0; i < stacks; i++) {
    const mod = vitamin.newModifier(pokemon);
    if (mod) {
      globalScene.addModifier(mod, true, false);
    }
  }
  pokemon.calculateStats();
  pokemon.updateInfo(true);
}

/** Reset one mon to Lv 1 (exp consistent) and recompute stats. */
function resetToLevelOne(pokemon: PlayerPokemon): void {
  pokemon.level = 1;
  pokemon.exp = getLevelTotalExp(1, pokemon.species.growthRate);
  pokemon.calculateStats();
  pokemon.hp = Math.min(pokemon.hp, pokemon.getMaxHp());
  pokemon.updateInfo(true);
}

/** Zero a mon's starter-line candy (the only account-level cost; consciously spent). */
function wipeCandy(pokemon: PlayerPokemon): void {
  const entry = globalScene.gameData.getStarterDataEntry(pokemon.species.speciesId);
  entry.candyCount = 0;
}

/** Strip the live shine + Luck off a mon for the run (instance-only, dex-safe). */
function dullShine(pokemon: PlayerPokemon): void {
  if (pokemon.customPokemonData?.erBlackShiny) {
    resetErBlackShinyState(pokemon);
  }
  pokemon.shiny = false;
  pokemon.variant = 0;
  pokemon.luck = 0;
  pokemon.fusionShiny = false;
  pokemon.fusionVariant = 0;
  pokemon.fusionLuck = 0;
}

/** Apply a persistent -10% curse to a random base stat (the Bog Witch pattern). */
function curseRandomStat(pokemon: PlayerPokemon): void {
  pokemon.customPokemonData.erCursedStat = randSeedInt(6) as Stat;
  pokemon.calculateStats();
  pokemon.updateInfo();
}

/**
 * Run the party-selection step(s) for the chosen Sin (inside onPreOptionPhase).
 * Stores the picked mon(s) and any sub-choice on `encounter.misc`. Returns false
 * if the player backs out, which cleanly aborts the option.
 */
async function pickForSin(key: SinKey, misc: BargainMisc): Promise<boolean> {
  switch (key) {
    case "greed":
    case "gluttony":
    case "lust":
      return selectPokemonForOption(pokemon => {
        misc.picks = [pokemon];
      });
    case "pride":
      return selectPokemonForOption(
        pokemon => {
          misc.picks = [pokemon];
          return STAT_CHOICES.map(
            (c): OptionSelectItem => ({
              label: c.label,
              handler: () => {
                misc.chosenStat = c.stat;
                return true;
              },
            }),
          );
        },
        undefined,
        pokemon => (pokemon.isShiny() ? null : "This Pokémon does not shine."),
      );
    case "envy":
      return selectPokemonForOption(
        pokemon => {
          misc.picks = [pokemon];
          return RELIC_CHOICES.map(
            (c): OptionSelectItem => ({
              label: c.label,
              handler: () => {
                misc.chosenRelic = c.make;
                return true;
              },
            }),
          );
        },
        undefined,
        pokemon => (heldCount(pokemon) >= 3 ? null : "This Pokémon isn't carrying enough."),
      );
    case "wrath":
    case "sloth": {
      const firstPicked = await selectPokemonForOption(pokemon => {
        misc.picks = [pokemon];
      });
      if (!firstPicked) {
        return false;
      }
      const first = misc.picks[0];
      return selectPokemonForOption(
        pokemon => {
          misc.picks = [first, pokemon];
        },
        undefined,
        pokemon => (pokemon === first ? "Choose a different Pokémon." : null),
      );
    }
  }
}

/**
 * Apply the chosen Sin's cost + payoff (inside onOptionPhase), set the result
 * token, and show the result line. The caller leaves the encounter afterward.
 */
async function applySin(key: SinKey, misc: BargainMisc): Promise<void> {
  const setName = (p: PlayerPokemon) =>
    globalScene.currentBattle.mysteryEncounter!.setDialogueToken("pokeName", p.getNameToRender());

  switch (key) {
    case "greed": {
      const mon = misc.picks[0];
      wipeCandy(mon);
      const wave = globalScene.currentBattle?.waveIndex ?? 1;
      globalScene.addMoney(2000 + wave * 300);
      globalScene.addModifier(modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier(), false, true);
      setName(mon);
      break;
    }
    case "gluttony": {
      const mon = misc.picks[0];
      setName(mon);
      globalScene.removePokemonFromPlayerParty(mon, true);
      new Egg({ sourceType: EggSourceType.EVENT, tier: EggTier.LEGENDARY }).addEggToGameData();
      break;
    }
    case "pride": {
      const mon = misc.picks[0];
      setName(mon);
      dullShine(mon);
      await mon.loadAssets();
      grantStatBoost(mon, misc.chosenStat ?? Stat.ATK, 3);
      break;
    }
    case "wrath": {
      const [victim, beneficiary] = misc.picks;
      curseRandomStat(victim);
      grantStatBoost(beneficiary, bestCombatStat(beneficiary), 2);
      setName(victim);
      break;
    }
    case "envy": {
      const mon = misc.picks[0];
      const items = mon.getHeldItems().filter(m => !(m instanceof PokemonFormChangeItemModifier));
      for (const item of items) {
        globalScene.removeModifier(item);
      }
      globalScene.updateModifiers(true);
      const relic = (misc.chosenRelic ?? RELIC_CHOICES[0].make)().newModifier();
      if (relic) {
        globalScene.addModifier(relic, false, true);
      }
      setName(mon);
      break;
    }
    case "sloth": {
      for (const mon of misc.picks) {
        resetToLevelOne(mon);
        wipeCandy(mon);
      }
      globalScene.addModifier(modifierTypes.ER_RELIC_COVENANT().newModifier(), false, true);
      break;
    }
    case "lust": {
      const target = misc.picks[0];
      for (const mon of globalScene.getPlayerParty()) {
        curseRandomStat(mon);
      }
      applyErBlackShinyKit(target);
      target.shiny = true;
      target.variant = 2;
      await target.loadAssets();
      target.updateInfo(true);
      setName(target);
      break;
    }
  }

  await showEncounterText(`${namespace}:sins.${key}.result`);
}

/** Shape of the per-run scratch state stored on the encounter. */
interface BargainMisc {
  sins: SinKey[];
  activeSin?: SinKey;
  picks: PlayerPokemon[];
  chosenStat?: Stat;
  chosenRelic?: () => ModifierType;
}

/** Build one of the three dynamic Sin options (1-based slot). */
function buildSinOption(slot: number) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${slot}.label`,
      buttonTooltip: `${namespace}:option.${slot}.tooltip`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.${slot}.selected`,
        },
      ],
    })
    .withPreOptionPhase(async (): Promise<boolean> => {
      const misc = globalScene.currentBattle.mysteryEncounter!.misc as BargainMisc;
      const key = misc.sins[slot - 1];
      misc.activeSin = key;
      misc.picks = [];
      return pickForSin(key, misc);
    })
    .withOptionPhase(async () => {
      const misc = globalScene.currentBattle.mysteryEncounter!.misc as BargainMisc;
      if (misc.activeSin) {
        await applySin(misc.activeSin, misc);
      }
      leaveEncounterWithoutBattle(false);
    })
    .build();
}

/**
 * The Bargain encounter (ER Abyss "Seven Sins"). Distinct from the vanilla Dark Deal.
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const TheBargainEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_THE_BARGAIN,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withDisallowedChallenges(Challenges.HARDCORE)
  .withIntroSpriteConfigs([
    {
      // The six-winged Giratina Origin (form 1) from the pokemon atlas - served
      // everywhere, no new asset. (The ripped PMD talking-head portrait is staged
      // in tmp-pmd-extract for a future er-assets CDN swap.)
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.GIRATINA,
      formIndex: 1,
      hasShadow: true,
      repeat: true,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
  .withSceneWaveRangeRequirement(30, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[1])
  .withScenePartySizeRequirement(2, 6, true)
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const available = SIN_ORDER.filter(sinAvailable);
    const chosen = pickThreeSins(available);
    const misc: BargainMisc = { sins: chosen, picks: [] };
    encounter.misc = misc;
    chosen.forEach((key, i) => {
      const n = i + 1;
      encounter.setDialogueToken(`sin${n}Name`, i18next.t(`${namespace}:sins.${key}.name`));
      encounter.setDialogueToken(`sin${n}Tooltip`, i18next.t(`${namespace}:sins.${key}.tooltip`));
      encounter.setDialogueToken(`sin${n}Offer`, i18next.t(`${namespace}:sins.${key}.offer`));
    });
    return true;
  })
  .withOption(buildSinOption(1))
  .withOption(buildSinOption(2))
  .withOption(buildSinOption(3))
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.leave.label`,
      buttonTooltip: `${namespace}:option.leave.tooltip`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.leave.line1`,
        },
        {
          text: `${namespace}:option.leave.line2`,
        },
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.leave.line3`,
        },
      ],
    },
    async () => {
      leaveEncounterWithoutBattle(false);
      return true;
    },
  )
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();
