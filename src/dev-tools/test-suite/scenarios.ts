/*
 * Elite Redux — in-game dev TEST SUITE scenarios.  *** TRACKED — ships to STAGING ***
 *
 * This file IS committed and built into the staging bundle (VITE_DEV_TOOLS=1) so
 * the test team can verify fixes themselves. It NEVER activates in production
 * (the registry gate is false there). See CLAUDE.md → "STANDING RULE".
 *
 * Each scenario has:
 *   - label       → SHORT name shown in the picker list (keep it tight)
 *   - description → the context screen shown before launch: which bug, what to
 *                   DO, and what to EXPECT. Other testers read this, so be clear.
 *   - setup()     → applies pre-battle Overrides and returns the player party
 *   - onBattleStart? → optional; runs ONCE on the first turn (mid-combat state
 *                   the Overrides can't express, e.g. pre-boosted stat stages)
 *
 * Selecting a scenario drops you into a configured CLASSIC battle on a throwaway
 * save slot (4) — your real save (slot 0) is untouched.
 *
 * To add one: copy a block. Party via makeStarter(); pre-battle via setOverrides
 * (weather/status/ability/moveset/enemy); mid-combat via onBattleStart +
 * boostPlayer()/boostEnemy(). resetDevOverrides() runs first so each starts clean.
 */

import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { modifierTypes } from "#data/data-lists";
import type { ErCommunityItemKind } from "#data/elite-redux/er-community-items";
import { advanceErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { erResistBerryModifierType } from "#data/elite-redux/er-resist-berries";
import { setErDifficulty, setErDifficulty as setErDifficultyForScenario } from "#data/elite-redux/er-run-difficulty";
import { erWardStoneModifierType } from "#data/elite-redux/er-ward-stones";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { ErMoveId } from "#enums/er-move-id";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierOverride } from "#modifiers/modifier-type";
import { erCommunityItemModifierType } from "#modifiers/modifier-type";
import type { Variant } from "#sprites/variant";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { Starter, StarterMoveset } from "#types/save-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export interface DevScenario {
  /** Short name for the picker list. */
  label: string;
  /** Context shown before launch: the bug, what to do, what to expect. */
  description: string;
  /** Apply Overrides and return the player party. */
  setup: () => Starter[];
  /** Optional: runs ONCE on the first turn, after both sides are summoned. */
  onBattleStart?: () => void;
  /**
   * Optional: guarantee these reward options in the FIRST shop after the opening
   * battle ("start in the store, test a specific item"). Each is a
   * `ModifierTypeFunc` from `modifierTypes` (e.g. `modifierTypes.RARE_CANDY`, or
   * `modifierTypes.FORM_CHANGE_ITEM` which — with a single-mon party — resolves to
   * that mon's mega stone). Win the opening battle to reach the shop.
   */
  shopItems?: ModifierTypeFunc[];
}

// --- helpers ----------------------------------------------------------------

interface StarterOpts {
  formIndex?: number;
  abilityIndex?: number;
  moveset?: MoveId[];
  female?: boolean;
  shiny?: boolean;
  variant?: Variant;
  nature?: Nature;
}

function makeStarter(speciesId: SpeciesId, opts: StarterOpts = {}): Starter {
  return {
    speciesId,
    shiny: opts.shiny ?? false,
    variant: opts.variant ?? 0,
    formIndex: opts.formIndex ?? 0,
    female: opts.female,
    abilityIndex: opts.abilityIndex ?? 0,
    passive: false,
    nature: opts.nature ?? Nature.HARDY,
    moveset: (opts.moveset?.length ?? 0) > 0 ? (opts.moveset?.slice(0, 4) as StarterMoveset) : undefined,
    pokerus: false,
    ivs: new Array(6).fill(31),
  };
}

/** Resolve the form index whose `formKey` matches (e.g. "redux"); 0 if absent. */
function formIndexByKey(speciesId: SpeciesId, formKey: string): number {
  const idx = getPokemonSpecies(speciesId).forms.findIndex(f => f.formKey === formKey);
  return idx < 0 ? 0 : idx;
}

/** Resolve the first form index whose `formKey` CONTAINS `needle`; 0 if absent. */
function formIndexContaining(speciesId: SpeciesId, needle: string): number {
  const idx = getPokemonSpecies(speciesId).forms.findIndex(f => f.formKey.includes(needle));
  return idx < 0 ? 0 : idx;
}

/** Cast an ER ability id into the extended AbilityId space (for ABILITY_OVERRIDE). */
const erAbility = (id: number): AbilityId => id as unknown as AbilityId;

/** Cast an ER custom move id (≥5000) into the MoveId space (for MOVESET_OVERRIDE). */
const erMove = (id: number): MoveId => id as unknown as MoveId;

// The Overrides singleton fields are `readonly` at compile time but mutable at
// runtime — this is exactly how the dev override workflow is meant to be driven.
type MutableOverrides = { -readonly [K in keyof typeof Overrides]: (typeof Overrides)[K] };
const O = Overrides as unknown as MutableOverrides;

/** Keys this harness sets, with their default ("off") values. */
const DEV_OVERRIDE_DEFAULTS = {
  STARTING_LEVEL_OVERRIDE: 0,
  STARTING_WAVE_OVERRIDE: null,
  BATTLE_STYLE_OVERRIDE: null,
  STARTING_BIOME_OVERRIDE: null,
  STARTER_FORM_OVERRIDES: {},
  ABILITY_OVERRIDE: AbilityId.NONE,
  PASSIVE_ABILITY_OVERRIDE: AbilityId.NONE,
  MOVESET_OVERRIDE: [],
  STARTING_HELD_ITEMS_OVERRIDE: [],
  STARTING_MODIFIER_OVERRIDE: [],
  WEATHER_OVERRIDE: WeatherType.NONE,
  STATUS_OVERRIDE: StatusEffect.NONE,
  ENEMY_STATUS_OVERRIDE: StatusEffect.NONE,
  ENEMY_SPECIES_OVERRIDE: null,
  ENEMY_LEVEL_OVERRIDE: 0,
  ENEMY_ABILITY_OVERRIDE: AbilityId.NONE,
  ENEMY_MOVESET_OVERRIDE: [],
  ENEMY_FORM_OVERRIDES: {},
  ER_BLACK_SHINY_PLAYER_OVERRIDE: null,
  ER_BLACK_SHINY_ENEMY_OVERRIDE: null,
} as const;

/** Reset every dev-managed override so scenarios don't bleed into each other. */
function resetDevOverrides(): void {
  Object.assign(O, structuredClone(DEV_OVERRIDE_DEFAULTS));
}

function setOverrides(partial: Partial<MutableOverrides>): void {
  Object.assign(O, partial);
}

const MEGA_BRACELET: ModifierOverride = { name: "MEGA_BRACELET" };

// --- mid-combat helpers (use inside onBattleStart) --------------------------

/** Set absolute stat stages on the active player Pokémon (e.g. [[Stat.ATK, 4]]). */
function boostPlayer(stages: [BattleStat, number][]): void {
  const p = globalScene.getPlayerPokemon();
  if (!p) {
    return;
  }
  for (const [stat, value] of stages) {
    p.setStatStage(stat, value);
  }
  p.updateInfo();
}

/** Set absolute stat stages on the active enemy Pokémon. */
function boostEnemy(stages: [BattleStat, number][]): void {
  const e = globalScene.getEnemyPokemon();
  if (!e) {
    return;
  }
  for (const [stat, value] of stages) {
    e.setStatStage(stat, value);
  }
  e.updateInfo();
}

/** Convenience: +n to every offensive/defensive/speed stage (not ACC/EVA). */
const ALL_MAIN_STATS: BattleStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];
const allStages = (n: number): [BattleStat, number][] => ALL_MAIN_STATS.map(s => [s, n]);

/** #387: hand the active player Pokemon community items (kind, stacks). */
function givePlayerCommunityItems(items: [ErCommunityItemKind, number][]): void {
  const player = globalScene.getPlayerPokemon();
  if (!player) {
    return;
  }
  for (const [kind, stacks] of items) {
    const mod = erCommunityItemModifierType(kind).newModifier(player) as PokemonHeldItemModifier | null;
    if (mod) {
      mod.stackCount = stacks;
      globalScene.addModifier(mod, true);
    }
  }
  globalScene.updateModifiers(true);
}

// --- scenarios --------------------------------------------------------------

export const DEV_SCENARIOS: DevScenario[] = [
  // ===========================================================================
  // FIXES — this session
  // ===========================================================================
  {
    label: "Eerie Fog: boost decay",
    description:
      "#328 Eerie Fog — stat decay.\n"
      + "In fog, non-Ghost/Psychic mons lose 1 stage off EACH positive stat per turn.\n"
      + "DO: keep using Splash.  EXPECT: Mightyena's +ATK/+SpA/+SpD tick down to 0 over\n"
      + "a few turns; the -1 DEF is left alone. (Open Summary to watch the stages.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        WEATHER_OVERRIDE: WeatherType.FOG,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.MIGHTYENA, { moveset: [MoveId.SPLASH] })];
    },
    onBattleStart: () =>
      boostPlayer([
        [Stat.ATK, 4],
        [Stat.SPATK, 4],
        [Stat.SPD, 3],
        [Stat.DEF, -1],
      ]),
  },
  {
    label: "Eerie Fog: Ghost keeps",
    description:
      "#328 Eerie Fog — Ghost/Psychic are immune to the decay.\n"
      + "DO: keep using Splash in fog.  EXPECT: Gengar (Ghost) KEEPS all its +4 boosts\n"
      + "every turn — they do NOT tick down. (Contrast with the Mightyena scenario.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        WEATHER_OVERRIDE: WeatherType.FOG,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GENGAR, { moveset: [MoveId.SPLASH] })];
    },
    onBattleStart: () => boostPlayer(allStages(4)),
  },
  {
    label: "Eerie Fog: Ominous Wind",
    description:
      "#328 Eerie Fog — Ominous Wind deals 2× in fog (base 60 → 120).\n"
      + "DO: use Ominous Wind on Wailord (bulky, survives).  EXPECT: a big chunk —\n"
      + "roughly double what it would do without fog.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        WEATHER_OVERRIDE: WeatherType.FOG,
        MOVESET_OVERRIDE: [MoveId.OMINOUS_WIND, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WAILORD,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GASTLY, { moveset: [MoveId.OMINOUS_WIND, MoveId.SPLASH] })];
    },
  },
  {
    label: "Triple Axel ramp",
    description:
      "#313 Triple Axel — 3 strikes with ramping power.\n"
      + "DO: use Triple Axel on Blissey (survives).  EXPECT: it hits 3 TIMES, each\n"
      + "stronger than the last (20 → 40 → 60 power).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.TRIPLE_AXEL],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SNEASEL, { moveset: [MoveId.TRIPLE_AXEL] })];
    },
  },
  {
    label: "Money streak ribbon",
    description:
      "#348 Money streak — +1% money per mon per 3 faint-free waves (cap 10%).\n"
      + "This scenario pre-charges your two mons to MAX streak.\n"
      + "DO: open each mon's SUMMARY.  EXPECT: a small gold ribbon next to the\n"
      + "gender symbol on the name bar reading P+10%. Win the battle: the money\n"
      + "reward is ~20% higher than normal. Let a mon faint and win again: its\n"
      + "ribbon disappears (streak reset), the other keeps its bonus.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.FLASH_CANNON, MoveId.SWORDS_DANCE, MoveId.EXTREME_SPEED],
        }),
      ];
    },
    onBattleStart: () => {
      // Pre-charge the party to max streak so the ribbon + payout are testable.
      for (let i = 0; i < 30; i++) {
        advanceErMoneyStreaks();
      }
    },
  },
  {
    label: "Struggle Bug + Antique",
    description:
      "#367 Struggle Bug (ER) + Antique innates.\n"
      + "Your Scyther starts at ~30% HP. DO: use Struggle Bug on the enemy\n"
      + "Sinistea (ANTIQUE form).\n"
      + "EXPECT: Struggle Bug shows 80 BP, CRITS EVERY TIME while you're below\n"
      + "half HP, and does NOT drop SpAtk. Open Battle Info (C) on the enemy:\n"
      + "the Antique Sinistea must show its INNATES (was: none).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.STRUGGLE_BUG, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SINISTEA,
        ENEMY_FORM_OVERRIDES: { [SpeciesId.SINISTEA]: 1 },
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SCYTHER, { moveset: [MoveId.STRUGGLE_BUG, MoveId.SPLASH] })];
    },
    onBattleStart: () => {
      const p = globalScene.getPlayerPokemon();
      if (p) {
        p.hp = Math.max(1, Math.floor(p.getMaxHp() * 0.3));
        p.updateInfo();
      }
    },
  },
  {
    label: "Outburst hits the field",
    description:
      "#366 Outburst (and 26 other customs) used to hit ONE mon.\n"
      + "DOUBLE battle. DO: have Gengar use Outburst.\n"
      + "EXPECT: it damages BOTH enemy mons AND your ally, then Gengar faints.\n"
      + "Also: Bleakwind Storm hits both foes AND sets Tailwind on your side\n"
      + "(check the Field panel in Battle Info).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        MOVESET_OVERRIDE: [erMove(ErMoveId.OUTBURST), MoveId.BLEAKWIND_STORM, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GENGAR, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Oricorio Pom-Pom innate",
    description:
      "#361 Oricorio styles carry their OWN ability kits.\n"
      + "DO: open Battle Info (C) on the enemy Pom-Pom Oricorio and check its\n"
      + "abilities; or hit it with Thunderbolt.\n"
      + "EXPECT: it has LIGHTNING ROD (Electric absorbed/redirected), NOT Baile's\n"
      + "Flash Fire. Also: R cycles the side panel — page 2 description box sits\n"
      + "ABOVE the move list (no text overlap, has its own window), page 3 DMG\n"
      + "CALC counts ALL hits of multi-hit moves (Triple Axel reads ~6x one hit).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.THUNDERBOLT, MoveId.TRIPLE_AXEL, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ORICORIO,
        ENEMY_FORM_OVERRIDES: { [SpeciesId.ORICORIO]: 1 },
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.PIKACHU, { moveset: [MoveId.THUNDERBOLT, MoveId.TRIPLE_AXEL, MoveId.SPLASH] })];
    },
  },
  {
    label: "Hell final rival (Mega Ray)",
    description:
      "#340 Hell final rival battle (wave 195).\n"
      + "DO: beat/skip through the rival fight that starts immediately.\n"
      + "EXPECT: the rival fields a FULLY-EVOLVED late-game team (Vikavolt/\n"
      + "Swellow/Starmie/Tsareena/Mimikyu/Blaziken-line — never Smeargle, contest\n"
      + "Pikachus or unevolved mons) and the LAST mon is MEGA RAYQUAZA.\n"
      + "Before the fix the finale got a leftover early/mid team and no ace.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 95,
        STARTING_WAVE_OVERRIDE: 195,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.METAGROSS, {
          moveset: [MoveId.METEOR_MASH, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH, MoveId.EARTHQUAKE],
        }),
        makeStarter(SpeciesId.MILOTIC, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.RECOVER, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Fury Cutter/Echoed Voice x3",
    description:
      "#360 Fury Cutter + Echoed Voice — Triple Kick's effect.\n"
      + "Fury Cutter: 20 BP / 90% / 10 PP. Echoed Voice: 20 BP / 90% / 15 PP.\n"
      + "DO: check both movecards (R cycles the panel), then use each on Blissey.\n"
      + "EXPECT: each hits 3 TIMES with rising power (20 → 40 → 60), like Triple\n"
      + "Kick/Axel. Before the fix both were single-hit vanilla repeat-use ramps.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.FURY_CUTTER, MoveId.ECHOED_VOICE, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SCYTHER, { moveset: [MoveId.FURY_CUTTER, MoveId.ECHOED_VOICE, MoveId.SPLASH] })];
    },
  },
  {
    label: "Berry Smash eats a berry",
    description:
      "#342/#398 Berry Smash — the user must EAT one of its held berries.\n"
      + "Snorlax holds a Sitrus AND a Lum berry (two berries). DO: use Berry Smash\n"
      + "on the enemy.  EXPECT: it deals damage AND the USER consumes ONE berry\n"
      + "(random of the two) — e.g. Sitrus heals SNORLAX, not Blissey.\n"
      + "ALSO (#398): the berry's effect must NEVER apply to the TARGET — a\n"
      + "report had the defender eating the attacker's berry like a reverse\n"
      + "Pluck. Watch who gets the heal message.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [erMove(ErMoveId.BERRY_SMASH), MoveId.SPLASH],
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "BERRY", type: BerryType.SITRUS, count: 1 },
          { name: "BERRY", type: BerryType.LUM, count: 1 },
        ],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SNORLAX, { moveset: [erMove(ErMoveId.BERRY_SMASH), MoveId.SPLASH] })];
    },
  },
  {
    label: "Fight panel: R cycles 3 pages",
    description:
      "#356 Move info while choosing moves.\n"
      + "DO: open FIGHT, highlight a move, press R (mobile: on-screen R) repeatedly.\n"
      + "EXPECT: page 1 = stats panel; page 2 = a WIDE description box above the\n"
      + "move list (long text auto-scrolls; stats stay in the side panel); page 3 =\n"
      + "DMG CALC in the side panel, fully inside the panel (no overflow); then back\n"
      + "to page 1. Works for every move incl. the 5th rogue-slot move.\n"
      + "ALSO (#377): on the stats page a small static 'R ⇄' hint sits at the\n"
      + "panel edge so the cycling is discoverable. The hint must appear ONLY\n"
      + "there - NOT on the title screen, starter select, command menu or any\n"
      + "other screen (it used to leak everywhere until the first fight).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.FIRE_BLAST, MoveId.STONE_EDGE],
        }),
      ];
    },
  },
  {
    label: "Dragon Rage = 80 BP",
    description:
      "#336 Dragon Rage info — must DISPLAY power 80 (not 1).\n"
      + "ER's Dragon Rage is a normal 80-BP Dragon move that hits Fairy neutrally.\n"
      + "DO: open the move detail (fight menu) / Battle Info Moves panel and read\n"
      + "Dragon Rage's power; then use it on the Clefable.  EXPECT: power shows 80\n"
      + "(was 1), and it HITS the Fairy for a normal 80-BP chunk.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.DRAGON_RAGE, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CLEFABLE,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.DRATINI, { moveset: [MoveId.DRAGON_RAGE, MoveId.SPLASH] })];
    },
  },

  // ===========================================================================
  // FIXES — already merged on the branch
  // ===========================================================================
  {
    label: "Normalize vs resist",
    description:
      "#329 Normalize ignores RESISTANCES.\n"
      + "Normalize makes Tackle a Normal move. Steelix (Steel/Ground) normally resists\n"
      + "Normal.  DO: use Tackle.  EXPECT: NEUTRAL damage — the resistance is ignored\n"
      + "(no 'not very effective').",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.NORMALIZE,
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.STEELIX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.PORYGON, { moveset: [MoveId.TACKLE] })];
    },
  },
  {
    label: "Normalize vs immune",
    description:
      "#329 control — Normalize ignores resistances but NOT immunities.\n"
      + "DO: use Tackle (now Normal) on Gengar (Ghost).  EXPECT: 0 damage / 'doesn't\n"
      + "affect' — Ghost's immunity to Normal still applies.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.NORMALIZE,
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.PORYGON, { moveset: [MoveId.TACKLE] })];
    },
  },
  {
    label: "Fire Aspect burn",
    description:
      "#334 Fire Aspect — all the holder's attacks inflict burn.\n"
      + "DO: hit Snorlax with Tackle (a NON-Fire move).  EXPECT: Snorlax is BURNED\n"
      + "afterwards (burn status + chip damage each turn).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FIRE_ASPECT),
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.CHARIZARD, { moveset: [MoveId.TACKLE] })];
    },
  },
  {
    label: "Gifted Mind: Psychic",
    description:
      "#332/#333 Gifted Mind — nulls the holder's Psychic weakness.\n"
      + "Machamp (Fighting) is normally weak to Psychic.  DO: let Alakazam use Psychic\n"
      + "on you.  EXPECT: NEUTRAL damage, not super-effective. (Remove the ability\n"
      + "override in scenarios.ts to see the 2× it would otherwise take.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.GIFTED_MIND),
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ALAKAZAM,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.PSYCHIC],
      });
      return [makeStarter(SpeciesId.MACHAMP, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "Aura Force vs Ghost",
    description:
      "#326 Aura Force (ER Fighting move) is super-effective vs Ghost.\n"
      + "DO: use Aura Force on Gengar.  EXPECT: it HITS (no 'doesn't affect') AND is\n"
      + "super-effective — a big chunk / likely KO.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [erMove(ErMoveId.AURA_FORCE)],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.LUCARIO, { moveset: [erMove(ErMoveId.AURA_FORCE)] })];
    },
  },
  {
    label: "Pressure clears boosts",
    description:
      "#321 Pressure clears the opponent's POSITIVE stat stages on entry.\n"
      + "The enemy Snorlax starts at +6 all.  DO: switch your lead Magikarp OUT for\n"
      + "Machamp (both have Pressure here).  EXPECT: when Machamp ENTERS, Snorlax's\n"
      + "positive stages snap back to 0.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.PRESSURE,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MAGIKARP, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.MACHAMP, { moveset: [MoveId.SPLASH] }),
      ];
    },
    onBattleStart: () => boostEnemy(allStages(6)),
  },
  {
    // #325. EXPECT: leveling Kadabra-Redux to 32 evolves it into Alakazam-REDUX
    // (Redux sprite/typing), NOT the normal Alakazam. Was reverting to base form
    // on evolve even though the evolution preview showed the Redux sprite.
    label: "Redux evo keeps form (Kadabra)",
    description:
      "#325 Redux line must KEEP its form on evolution.\n"
      + "You start with a L31 Kadabra-Redux (evolves at 32). DO: win the opening\n"
      + "battle, then take the RARE CANDY from the rewards and use it on Kadabra to\n"
      + "hit L32 and evolve.  EXPECT: it becomes Alakazam-REDUX (Redux sprite +\n"
      + "typing + Redux learnset), NOT the normal Alakazam.\n"
      + "(Rare candy, not combat XP — the dev battle gives little/no XP.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 31,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.PSYCHIC, MoveId.SHADOW_BALL],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 31,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.KADABRA, {
          formIndex: formIndexByKey(SpeciesId.KADABRA, "redux"),
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL],
        }),
      ];
    },
    // Evolve via a guaranteed Rare Candy in the post-battle shop (level 31 → 32),
    // not combat XP.
    shopItems: [modifierTypes.RARE_CANDY],
  },
  {
    // The systematic "Redux X → normal evolved form" repro — BOTH shapes:
    //   • form-carry lines (Drilbur→Excadrill-Redux, Kadabra→Alakazam-Redux)
    //   • the LAST-STAGE / single-evo lines whose Redux evolution is a brand-new
    //     custom species (Psyduck→SHYDUCK, Cinccino→FROSTUCCINO,
    //     Excadrill→REXCADRILL) — the ones that wrongly fell down the normal
    //     line before the redux-edge fix.
    // Party is L49 (above every evo level; Excadrill→Rexcadrill needs exactly 50,
    // reached on the next level-up). EXP SHARE ×3 spreads battle XP to the
    // BENCHED mons too, so winning levels everyone — or take the guaranteed
    // RARER CANDY from the shop (whole-party +1) for the deterministic path.
    label: "Redux evos carry form (all)",
    description:
      "Redux lines must evolve WITHIN the Redux line — never into the normal one.\n"
      + "Party (all Redux, L49): Drilbur→Excadrill-Redux, Kadabra→Alakazam-Redux,\n"
      + "Psyduck→SHYDUCK, Cinccino→FROSTUCCINO, Excadrill→REXCADRILL (at L50).\n"
      + "DO: WIN the fight (Chansey + Exp Share = whole party levels) OR take the\n"
      + "RARER CANDY in the shop (party +1).  EXPECT: every one evolves into its\n"
      + "REDUX evolution (sprite/typing/learnset) — e.g. Psyduck becomes Shyduck,\n"
      + "NOT plain Golduck; Cinccino becomes Frostuccino, NOT Beniccino.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 49,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.EARTHQUAKE, MoveId.PSYCHIC, MoveId.SURF, MoveId.ICE_BEAM],
        // Exp Share ×3 → benched party members receive battle XP too, so a win
        // levels (and evolves) the whole overdue party, per the maintainer.
        STARTING_MODIFIER_OVERRIDE: [{ name: "EXP_SHARE", count: 3 }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 49,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      const redux = (id: SpeciesId): Starter => makeStarter(id, { formIndex: formIndexByKey(id, "redux") });
      return [
        redux(SpeciesId.DRILBUR),
        redux(SpeciesId.KADABRA),
        redux(SpeciesId.PSYDUCK),
        redux(SpeciesId.CINCCINO),
        redux(SpeciesId.EXCADRILL),
        redux(SpeciesId.KRABBY),
      ];
    },
    // Whole-party level-up → all overdue Redux mons evolve at once.
    shopItems: [modifierTypes.RARER_CANDY],
  },

  // ===========================================================================
  // EARLIER scenarios (sprites / megas / type-chart / multi-head)
  // ===========================================================================
  {
    label: "Multi-Head x3 (Sandy)",
    description:
      "#312 Multi-Headed — strikes once per head.\n"
      + "Sandy Shocks has 3 heads.  DO: use Thunder Shock on Blissey (survives).\n"
      + "EXPECT: it hits 3 TIMES.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MULTI_HEADED),
        MOVESET_OVERRIDE: [MoveId.THUNDER_SHOCK],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
      });
      return [makeStarter(SpeciesId.SANDY_SHOCKS)];
    },
  },
  {
    label: "Multi-Head x2 (Doduo)",
    description:
      "#312 control — Multi-Headed respects head count.\n"
      + "Doduo has 2 heads.  DO: use Tackle on Blissey.  EXPECT: it hits exactly 2\n"
      + "TIMES (NOT 3) — two-headed mons were not over-bumped.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MULTI_HEADED),
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
      });
      return [makeStarter(SpeciesId.DODUO)];
    },
  },
  {
    label: "Molten Down neutral",
    description:
      "#316 Molten Down — must not over-apply super-effective.\n"
      + "DO: use Ember on Relicanth (Water/Rock).  EXPECT: NEUTRAL damage. Before the\n"
      + "fix the Rock override made it 2× and ignored the Water half.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MOLTEN_DOWN),
        MOVESET_OVERRIDE: [MoveId.EMBER, MoveId.FLAMETHROWER],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RELICANTH,
        ENEMY_LEVEL_OVERRIDE: 50,
      });
      return [makeStarter(SpeciesId.CHARIZARD)];
    },
  },
  {
    label: "Calyrex As One",
    description:
      "#319 Calyrex Shadow Rider — ability must show.\n"
      + "DO: open the party Summary.  EXPECT: the ABILITY line reads 'As One'\n"
      + "(Spectrier), not blank.",
    setup: () => {
      resetDevOverrides();
      const form = formIndexContaining(SpeciesId.CALYREX, "shadow");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 70,
        STARTING_WAVE_OVERRIDE: 5,
        STARTER_FORM_OVERRIDES: { [SpeciesId.CALYREX]: form },
      });
      return [
        makeStarter(SpeciesId.CALYREX, {
          formIndex: form,
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    // In ER, a mega is a permanent form/evo ACTIVATED by giving the mon its mega
    // stone (not an in-battle toggle). This tests the store path: get the stone
    // for a specific mon and apply it. Party is JUST Venusaur, so the guaranteed
    // Form-Change Item the shop offers resolves to Venusaurite.
    label: "Store: Mega stone (Venusaur)",
    description:
      "ER megas = permanent forms unlocked by a MEGA STONE from the shop.\n"
      + "You have a lone Venusaur + a Mega Bracelet. DO: win the opening battle, then\n"
      + "in the rewards take the offered MEGA STONE (Venusaurite) and give it to\n"
      + "Venusaur.  EXPECT: Venusaur takes its Mega form (sprite + stat/ability/typing\n"
      + "change). Tests 'start in the store, apply a specific item to a specific mon'.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [MEGA_BRACELET],
        MOVESET_OVERRIDE: [MoveId.SOLAR_BEAM, MoveId.SLUDGE_BOMB],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SOLAR_BEAM, MoveId.SLUDGE_BOMB, MoveId.GROWTH, MoveId.SYNTHESIS],
        }),
      ];
    },
    // The shop guarantees a Form-Change Item; with only Venusaur in the party it
    // can only roll Venusaurite — the "mega stone for a specific mon".
    shopItems: [modifierTypes.FORM_CHANGE_ITEM],
  },
  {
    // #359/#318 verification: these holders' megas were among the 51 that had
    // NO working stone before the form-change-bridge fix — second megas of
    // multi-mega species (Venusaur Mega-Y, Gyarados Mega-X, Lucario Mega-X AND
    // Mega-Z on distinct stones) and regional-form megas (Galarian Slowbro,
    // Hisuian Arcanine). 6 guaranteed Form-Change Items roll stones for the
    // party; rerolls re-pick if duplicates show.
    label: "Store: fixed megas reachable",
    description:
      "#359 — 51 megas had no obtainable stone; verify the fix.\n"
      + "Party: Venusaur, Gyarados, Lucario, Galarian Slowbro, Hisuian Arcanine\n"
      + "(+ Mega Bracelet). DO: win the opening fight; the shop offers MEGA STONES\n"
      + "for your party (reroll if dupes). Give each mon its stone, then mega in\n"
      + "battle.  EXPECT: every offered stone WORKS (sprite/stats change). Lucario\n"
      + "must offer TWO different stones: Lucarionite (Mega X) + Lucarionite Z\n"
      + "(Mega Z). Note any stone that does nothing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [MEGA_BRACELET],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN, MoveId.GROWTH, MoveId.SYNTHESIS],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.DRAGON_DANCE, MoveId.ICE_FANG],
        }),
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.FLASH_CANNON, MoveId.SWORDS_DANCE, MoveId.EXTREME_SPEED],
        }),
        makeStarter(SpeciesId.GALAR_SLOWBRO, {
          moveset: [MoveId.PSYCHIC, MoveId.SURF, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.HISUI_ARCANINE, {
          moveset: [MoveId.FLARE_BLITZ, MoveId.ROCK_SLIDE, MoveId.EXTREME_SPEED, MoveId.CRUNCH],
        }),
      ];
    },
    shopItems: [
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
    ],
  },
  {
    label: "Resist berries (#357)",
    description:
      "#357 Resistance berries — trainer-only held berries that HALVE one\n"
      + "super-effective hit of their type BEFORE it lands, then are eaten.\n"
      + "Enemy Charizard holds a PASSHO BERRY (Water).\n"
      + "DO: 1) Use SURF — EXPECT roughly HALF damage + message '…Passho Berry\n"
      + "weakened the attack!' and the berry is gone. 2) Surf again — EXPECT full\n"
      + "damage (one use only). 3) Restart and use THIEF first — EXPECT you STEAL\n"
      + "the berry; an enemy Water hit on your mon is then halved once instead.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHARIZARD,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SURF],
      });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.SURF, MoveId.THIEF, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => {
      // Guarantee the berry (the real trainer roll is 1%/5%/10% per mon).
      const enemy = globalScene.getEnemyPokemon();
      if (enemy) {
        const mod = erResistBerryModifierType(PokemonType.WATER).newModifier(enemy);
        if (mod) {
          // ignoreUpdate=false → the enemy item bar refreshes immediately, so
          // the berry icon is visible from turn 1.
          void globalScene.addEnemyModifier(mod as PokemonHeldItemModifier, false, true);
        }
      }
    },
  },
  {
    label: "Ward Stones (#358)",
    description:
      "#358 Ward Stones — charge-based CC blockers (legendary resistance).\n"
      + "Enemy Snorlax holds a GREATER WARD STONE (2 charges, cyan stone icon).\n"
      + "DO: 1) Use THUNDER WAVE twice — EXPECT both BLOCKED ('…Ward Stone\n"
      + "blocked the paralysis!') and the icon's charge number dropping 2->1->0.\n"
      + "2) A third Thunder Wave lands (stone empty). 3) Confuse Ray while it\n"
      + "still has charges is also blocked. 4) Restart and THIEF it — EXPECT the\n"
      + "stolen stone arrives at 0 charges (it refills after 15 won waves).\n"
      + "Bonus: holding ANY stone makes you immune to Shadow-Tag-style trapping\n"
      + "at no charge cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.THUNDER_WAVE, MoveId.CONFUSE_RAY, MoveId.THIEF, MoveId.SURF],
        }),
      ];
    },
    onBattleStart: () => {
      // Guarantee the stone (real rolls: Hell wave 100+ / Elite 150+).
      const enemy = globalScene.getEnemyPokemon();
      if (enemy) {
        const mod = erWardStoneModifierType("greater").newModifier(enemy);
        if (mod) {
          // ignoreUpdate=false → the stone (tinted cyan, charge counter) shows
          // on the enemy item bar from turn 1.
          void globalScene.addEnemyModifier(mod as PokemonHeldItemModifier, false, true);
        }
      }
    },
  },
  {
    label: "Chili Sample (#387)",
    description:
      "#387 CHILI SAMPLE - the holder's DAMAGING moves gain a 10% burn chance,\n"
      + "contact or not. Yanmega holds one (red-tinted charcoal icon).\n"
      + "DO: spam AIR SLASH / BUG BUZZ (both non-contact) for several turns.\n"
      + "EXPECT: Chansey gets BURNED now and then (about 1 hit in 10). Soft-\n"
      + "Boiled does not cure burn, so the status sticks once it lands.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.AIR_SLASH, MoveId.BUG_BUZZ, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["chiliSample", 1]]),
  },
  {
    label: "Loaded Dice (#387)",
    description:
      "#387 LOADED DICE - each stack raises the MINIMUM strikes of 2-5-hit\n"
      + "moves by 1. Yanmega holds the full 3 stacks (gold-tinted lens icon).\n"
      + "DO: use FURY SWIPES repeatedly.\n"
      + "EXPECT: it hits 5 TIMES EVERY USE (normally 2-5, weighted low). Pass\n"
      + "only if you never see fewer than 5 hits across several uses.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.FURY_SWIPES, MoveId.AIR_SLASH, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["loadedDice", 3]]),
  },
  {
    label: "Lucky Heart (#387)",
    description:
      "#387 LUCKY HEART - +15% move effect chance per stack (max 2), additive\n"
      + "with Serene Grace style abilities. Yanmega holds BOTH stacks (pink\n"
      + "charm icon), so Air Slash's flinch chance is +30 points.\n"
      + "DO: open with AIR SLASH every turn (you outspeed).\n"
      + "EXPECT: Snorlax flinches MUCH more often than the move's base chance -\n"
      + "it should visibly fail to act on most turns it gets hit.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.AIR_SLASH, MoveId.BUG_BUZZ, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["luckyHeart", 2]]),
  },
  {
    label: "Omni Gem (#387)",
    description:
      "#387 OMNI GEM - doubles the holder's next damaging move; 2 CHARGES\n"
      + "total, then the gem SHATTERS and vanishes. Yanmega holds one (white\n"
      + "elemental-gem icon on its item bar).\n"
      + "DO: attack three times with BUG BUZZ.\n"
      + "EXPECT: hit 1 - double damage + 'Omni Gem doubled the blow! (1 charge\n"
      + "left)'. Hit 2 - double damage + '...and shattered!' and the gem icon\n"
      + "DISAPPEARS from the item bar. Hit 3 - normal damage, no message.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.BUG_BUZZ, MoveId.AIR_SLASH, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["omniGem", 1]]),
  },
  {
    label: "Minion Control 25% (#399)",
    description:
      "#399 MINION CONTROL (Redux Alakazam line) - '+1 hit per healthy party\n"
      + "member' was hitting up to 6 TIMES AT FULL POWER. Per the ROM text,\n"
      + "extra strikes deal 10% each; the first hit stays 100%.\n"
      + "Your Alakazam has Minion Control via override + 5 healthy benchmates.\n"
      + "DO: use PSYCHIC and read the damage numbers per strike (R dmg panel).\n"
      + "EXPECT: 6 strikes - one big, five tiny (~10% of the first each).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MINION_CONTROL),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT] }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.DRAGON_DANCE, MoveId.ICE_FANG],
        }),
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.FLASH_CANNON, MoveId.SWORDS_DANCE, MoveId.EXTREME_SPEED],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.ARCANINE, {
          moveset: [MoveId.FLARE_BLITZ, MoveId.EXTREME_SPEED, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Evo screen sprite (#396)",
    description:
      "#396 Evolution screen showed the PRE-evolution sprite for redux shinies\n"
      + "(reported: shiny Ralts Redux -> Kirlia Redux kept showing Ralts;\n"
      + "console said 'Missing animation: ..._shiny3'). The front animation is\n"
      + "now rebuilt on demand.\n"
      + "DO: your SHINY Ralts Redux is level 19 - win once, level to 20, evolve.\n"
      + "EXPECT: the evolution cutscene visibly MORPHS into Kirlia Redux and\n"
      + "the end screen shows KIRLIA REDUX's sprite, not Ralts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 19,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.RALTS, {
          formIndex: formIndexByKey(SpeciesId.RALTS, "redux"),
          shiny: true,
          variant: 2,
          moveset: [MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.SHADOW_BALL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Justified absorbs Dark (#397)",
    description:
      "#397 JUSTIFIED - per the ER dex it boosts Attack INSTEAD OF being hit\n"
      + "by Dark-type moves (a Sap Sipper style absorb, not hit-then-boost).\n"
      + "Enemy Weavile spams CRUNCH at your Lucario (ability: Justified).\n"
      + "EXPECT: Crunch does NO damage at all - Lucario absorbs it and gains\n"
      + "+1 Attack every time. Before the fix the hit still dealt damage.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.JUSTIFIED,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WEAVILE,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.CRUNCH],
      });
      return [
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.SPLASH, MoveId.AURA_SPHERE, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Power Herb (#401)",
    description:
      "#401/#406 POWER HERB - skips the charge turn of two-turn moves. 2\n"
      + "charges, regains one every 10 waves. Venusaur holds one (ROM icon).\n"
      + "DO: use SOLAR BEAM three times (no sun is up).\n"
      + "EXPECT: the herb icon shows a GREEN charge number (#406). Uses 1 and\n"
      + "2 FIRE IMMEDIATELY with 'became fully charged due to its Power Herb!'\n"
      + "and the number counts 2 -> 1 -> 0 (red at 0). Use 3 charges normally\n"
      + "for a turn (herb empty). The herb is NOT consumed - after 10 more won\n"
      + "waves the counter ticks back up.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SOLAR_BEAM, MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["powerHerb", 1]]),
  },
  {
    label: "Aftermath vs multihit (#405)",
    description:
      "#405 AFTERMATH vs MULTI-HIT - enemy Koffing has Aftermath as an innate\n"
      + "(on KO it uses a 100 BP Explosion as its dying act).\n"
      + "DO: use ICICLE SPEAR (2-5 strikes) to KO it.\n"
      + "EXPECT: Aftermath triggers ONCE on the lethal strike - the volley\n"
      + "STOPS there (no extra strikes), Koffing immediately explodes and\n"
      + "faints. Before the fix every leftover strike re-triggered Aftermath\n"
      + "and Koffing kept sitting at 1 HP with the popup spamming.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.KOFFING,
        ENEMY_LEVEL_OVERRIDE: 15,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.DEWGONG, {
          moveset: [MoveId.ICICLE_SPEAR, MoveId.SWIFT, MoveId.PROTECT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Claws + Copper Rod (#387)",
    description:
      "#387 Contact status items - your Scizor holds RUSTY CLAW + SPIKED\n"
      + "KNUCKLES; the enemy Snorlax holds a COPPER ROD.\n"
      + "DO: spam BULLET PUNCH (contact) and watch a few turns.\n"
      + "EXPECT: ~10% per hit the Snorlax gets POISONED (Rusty Claw) or BLEEDS\n"
      + "(Spiked Knuckles, red badge). The enemy's Copper Rod can PARALYZE YOUR\n"
      + "Scizor when you make contact (defensive proc). SWIFT (non-contact)\n"
      + "never procs any of them.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SCIZOR, {
          moveset: [MoveId.BULLET_PUNCH, MoveId.SWIFT, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => {
      givePlayerCommunityItems([
        ["rustyClaw", 1],
        ["spikedKnuckles", 1],
      ]);
      const enemy = globalScene.getEnemyPokemon();
      if (enemy) {
        const rod = erCommunityItemModifierType("copperRod").newModifier(enemy);
        if (rod) {
          void globalScene.addEnemyModifier(rod as PokemonHeldItemModifier, false, true);
        }
      }
    },
  },
  {
    label: "Frostbite Orb (#387)",
    description:
      "#387 FROSTBITE ORB - the Toxic/Flame Orb sibling for ER's Frostbite.\n"
      + "Your Machamp holds one (icy-blue orb icon).\n"
      + "DO: end a turn (use Splash).\n"
      + "EXPECT: at turn end Machamp gets the FROSTBITE badge (1/16 chip per\n"
      + "turn, weakened special attacks) - fuel for Guts-style abilities. ALSO:\n"
      + "switch to Glalie (slot 2, also holding one) - it NEVER gets\n"
      + "frostbitten (Ice-types are immune).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.SPLASH, MoveId.CLOSE_COMBAT, MoveId.FACADE, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.GLALIE, {
          moveset: [MoveId.SPLASH, MoveId.ICE_BEAM, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => {
      for (const member of globalScene.getPlayerParty()) {
        const orb = modifierTypes.FROSTBITE_ORB().newModifier(member) as PokemonHeldItemModifier | null;
        if (orb) {
          globalScene.addModifier(orb, true);
        }
      }
      globalScene.updateModifiers(true);
    },
  },
  {
    label: "Dex Nav + Capsule (#387/#392)",
    description:
      "#387/#392/#404 New consumables - win the opening battle; the FIRST\n"
      + "shop guarantees DEX NAV (green scanner), ABILITY CAPSULE, OMNI GEM\n"
      + "and LEARNER'S SHROOM (teal mushroom).\n"
      + "DO+EXPECT: 1) DEX NAV - a species list of the CURRENT BIOME opens;\n"
      + "register 2 Pokemon; both then show as CAUGHT in the Pokedex/starter\n"
      + "select. 2) ABILITY CAPSULE on Yanmega - its ACTIVE ability switches to\n"
      + "the species' next legal one (check the summary). Buying a second\n"
      + "capsule for the same mon shows 'no effect' - it works ONCE per mon.\n"
      + "3) OMNI GEM - held item, see the dedicated Omni Gem scenario.\n"
      + "4) LEARNER'S SHROOM on Yanmega - pick ANY move it can learn (TMs,\n"
      + "tutors, egg moves, reached level-ups) from the big list; it learns it\n"
      + "on the spot. Future level-up moves are NOT in the list.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.AIR_SLASH, MoveId.BUG_BUZZ, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    shopItems: [
      modifierTypes.ER_DEX_NAV,
      modifierTypes.ER_ABILITY_CAPSULE,
      modifierTypes.ER_OMNI_GEM,
      modifierTypes.ER_LEARNERS_SHROOM,
    ],
  },
  {
    label: "Black shiny: REDUX form (#393)",
    description:
      "#393 CRITICAL - Redux-form (and ER-custom) black shinies showed the\n"
      + "TINTED-HUE PLACEHOLDER instead of the real black art, in the suite AND\n"
      + "live. Root cause: black shinies are shiny, so the slug atlas lookup\n"
      + "used the shiny path (elite-redux/{slug}/shiny-3) which is not a\n"
      + "manifest key.\n"
      + "Your starter is a BLACK SHINY RALTS REDUX.\n"
      + "EXPECT: it renders with the REAL black smoke-halo art from its very\n"
      + "first frame - front (summary) AND back (battle) - no dark-tint-over-\n"
      + "normal-sprite look. Check the party screen icon too.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.RALTS,
      });
      return [
        makeStarter(SpeciesId.RALTS, {
          formIndex: formIndexByKey(SpeciesId.RALTS, "redux"),
          moveset: [MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.SHADOW_BALL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Black shiny: acquisition",
    description:
      "#349 Black Shinies - catching one (acquisition path).\n"
      + "The wild Gardevoir is a BLACK SHINY (real black smoke-halo sprite; its\n"
      + "ability + 3 innates are UNTOUCHED, it just gains the 5th GIFT slot).\n"
      + "DO: weaken it (False Swipe) and CATCH it (5 Rogue Balls provided).\n"
      + "EXPECT: it spawns BLACK from its FIRST frame (no normal-then-black\n"
      + "swap - same speed as any shiny). After catching, its summary/ability\n"
      + "screens show its normal abilities plus the Gift row, and the black\n"
      + "state SURVIVES save/reload. ALSO: in starter select, the caught\n"
      + "filter dropdown has a BLACK sparkle option that shows only your\n"
      + "black-unlocked starters.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GARDEVOIR,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_ENEMY_OVERRIDE: SpeciesId.GARDEVOIR,
      });
      return [
        makeStarter(SpeciesId.SCIZOR, {
          moveset: [MoveId.FALSE_SWIPE, MoveId.THUNDER_WAVE, MoveId.BULLET_PUNCH, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    onBattleStart: () => {
      const balls = globalScene.pokeballCounts;
      balls[3] = Math.max(balls[3] ?? 0, 5); // Rogue Balls
    },
  },
  {
    label: "Black shiny: battle kit",
    description:
      "#349 Black Shinies — your OWN black shiny in battle.\n"
      + "Your Garchomp is a BLACK SHINY: normal ability + innates UNTOUCHED,\n"
      + "plus the 5th GIFT slot with 3 switchable pool choices.\n"
      + "DO: open the summary Abilities page or Battle Info — EXPECT the Gift\n"
      + "row (Gift 1/3, violet italic). PRESS R on that page — EXPECT the gift\n"
      + "cycles 1/3 to 2/3 to 3/3 and the shown ability changes (the new gift\n"
      + "is live in combat immediately). EXPECT the real black sprite from the\n"
      + "FIRST frame of the battle (no delayed normal-then-black swap), and at\n"
      + "the SAME HEIGHT as a normal mon (feet on the platform, not floating).\n"
      + "ALSO open the PARTY screen - EXPECT a BLACK star (not red) and an\n"
      + "obsidian-tinted party icon.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.THUNDER_WAVE],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.GARCHOMP,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Black shiny: ally gift share",
    description:
      "#349 Black Shinies — the GIFT is shared with allies on the field.\n"
      + "DOUBLE battle: your Jigglypuff is a BLACK SHINY; its ACTIVE gift\n"
      + "ability is shared with your Snorlax while both are out.\n"
      + "DO: open Battle Info → Abilities for SNORLAX (the non-black ally).\n"
      + "EXPECT: Snorlax's ability list includes the Jigglypuff's active gift\n"
      + "ability, and its effect works for Snorlax in combat. Switch the\n"
      + "Jigglypuff out: the gift disappears from Snorlax.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 10,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.JIGGLYPUFF,
      });
      return [
        makeStarter(SpeciesId.JIGGLYPUFF, {
          moveset: [MoveId.HYPER_VOICE, MoveId.SING, MoveId.PROTECT, MoveId.WISH],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Hell finale: BLACK Cascoon",
    description:
      "#349/#380 — the Hell finale STARTS as PRIMAL CASCOON; stage 2 is its\n"
      + "BLACK SHINY form (real generated black sprite + smoke, black sparkle).\n"
      + "Wave 200 on HELL with a REAL winning hell team (by 'unstressing',\n"
      + "ghost pool). DO: break stage 1's boss bars.  EXPECT: stage 2 turns\n"
      + "BLACK, with a gift ability on top of Angel's Wrath. ALSO (#380): open\n"
      + "Battle Info -> Moves on the boss in BOTH stages - it carries the FULL\n"
      + "7-move Angel's Wrath kit (compressed list), and the AI actually uses\n"
      + "the spread (hazards, omniboost, King's Shield, traps...).",
    setup: () => {
      resetDevOverrides();
      setErDifficultyForScenario("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 200,
        STARTING_WAVE_OVERRIDE: 200,
      });
      // Verbatim winning hell team from the prod ghost pool (player
      // "unstressing", wave 200 victory) — per the maintainer's standing rule.
      const m = (ids: number[]): MoveId[] => ids.map(id => erMove(id));
      return [
        makeStarter(382 as SpeciesId, { formIndex: 1, moveset: m([573, 618, 847, 542]) }),
        makeStarter(413 as SpeciesId, { formIndex: 2, abilityIndex: 2, moveset: m([456, 552, 455, 483]) }),
        makeStarter(157 as SpeciesId, { formIndex: 2, moveset: m([414, 552, 908, 284]) }),
        makeStarter(358 as SpeciesId, { moveset: m([586, 871, 826, 914]) }),
        makeStarter(263 as SpeciesId, { moveset: m([609, 667, 245, 882]) }),
        makeStarter(454 as SpeciesId, { moveset: m([827, 823, 837, 813]) }),
      ];
    },
  },
  {
    label: "Redux sprites (party)",
    description:
      "Redux form sprites/icons.\n"
      + "DO: open the party/summary and send them out.  EXPECT: Bellsprout-Redux and\n"
      + "Bounsweet-Redux show correct icons + battle sprites (no green box / wrong mon).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.BELLSPROUT, {
          formIndex: formIndexByKey(SpeciesId.BELLSPROUT, "redux"),
          moveset: [MoveId.VINE_WHIP, MoveId.RAZOR_LEAF, MoveId.GROWTH, MoveId.SLEEP_POWDER],
        }),
        makeStarter(SpeciesId.BOUNSWEET, {
          formIndex: formIndexByKey(SpeciesId.BOUNSWEET, "redux"),
          moveset: [MoveId.MAGICAL_LEAF, MoveId.PLAY_ROUGH, MoveId.SWEET_SCENT, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Redux sprite (enemy)",
    description:
      "Enemy Redux sprite.\n"
      + "DO: just look at the wild mon.  EXPECT: Bellsprout-Redux enemy renders its\n"
      + "Redux sprite correctly (no dark/green box).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BELLSPROUT,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_FORM_OVERRIDES: { [SpeciesId.BELLSPROUT]: formIndexByKey(SpeciesId.BELLSPROUT, "redux") },
      });
      return [makeStarter(SpeciesId.PIKACHU, { moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK] })];
    },
  },
  {
    label: "Heaven Asunder crit (#373)",
    description:
      "#373 Heaven Asunder: Spacial Rend ALWAYS crits (plus the +1 crit level for\n"
      + "everything else).\n"
      + "DO: use Spacial Rend several times.  EXPECT: EVERY Spacial Rend is a critical\n"
      + "hit. Aura Sphere crits only sometimes (that one just gets the +1 level).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.HEAVEN_ASUNDER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PALKIA, {
          moveset: [MoveId.SPACIAL_REND, MoveId.AURA_SPHERE, MoveId.SURF, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Youngster innates (#368)",
    description:
      "#368 Youngster trial mode: innates unlock FREE by level for the run\n"
      + "(slot 1 always, slot 2 at Lv 15, slot 3 at Lv 24) - no candies needed.\n"
      + "ALSO: on the difficulty picker after team select, HIGHLIGHTING each\n"
      + "mode shows its description in the message box under the list.\n"
      + "DO: open Battle Info -> Abilities (and the summary ability page) on the Lv 30\n"
      + "Gyarados.  EXPECT: all 3 innates show ACTIVE (Intimidate procs on entry too,\n"
      + "if not candy-unlocked it would normally be locked).\n"
      + "(Also #368: NO egg voucher after trainer wins on Youngster; wild shinies are\n"
      + "1.5x on Elite / 2x on Hell. Mode descriptions show when picking a difficulty\n"
      + "after team select.)",
    setup: () => {
      resetDevOverrides();
      setErDifficultyForScenario("youngster");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.ICE_FANG, MoveId.DRAGON_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Outrage retargets (#372)",
    description:
      "#372 Thrash/Outrage in doubles: after the locked move KOs its target, the\n"
      + "remaining frenzy turns used to FAIL every turn.\n"
      + "DOUBLE battle vs two frail Rattata. DO: use Outrage on one of them (it\n"
      + "dies). EXPECT: the NEXT forced Outrage turn automatically hits the OTHER\n"
      + "Rattata instead of failing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 70,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 15,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.OUTRAGE, MoveId.THRASH, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH, MoveId.PROTECT, MoveId.YAWN, MoveId.REST] }),
      ];
    },
  },
  {
    label: "Soul Linker (#376)",
    description:
      "#376 Soul Linker: damage links BOTH ways.\n"
      + "The enemy Snorlax has Soul Linker as its ACTIVE ability.\n"
      + "DO: hit it with Waterfall.  EXPECT: your Gyarados takes the SAME damage\n"
      + "back. The harness regression passes; if your in-run case still fails,\n"
      + "note WHICH mon had Soul Linker (active vs innate slot) and Send Logs.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_ABILITY_OVERRIDE: erAbility(ErAbilityId.SOUL_LINKER),
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.ICE_FANG, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "SE-vs-type moves (#374)",
    description:
      "#374 'Super effective vs X' moves now ACTUALLY override the type chart\n"
      + "(SE message + 2x even into a resist).\n"
      + "Enemy is EMPOLEON (Water/Steel). DO: use each move.  EXPECT ALL FOUR show\n"
      + "'It's super effective!': Tsunami Hammer (vs Water - was resisted and on\n"
      + "the wrong type), Hacksaw + Gigaton Hammer (vs Steel - were resisted),\n"
      + "Brine (vs Water - was missing entirely).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.EMPOLEON,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MELMETAL, {
          moveset: [erMove(1002), erMove(1023), MoveId.GIGATON_HAMMER, MoveId.BRINE],
        }),
      ];
    },
  },
  {
    label: "NGas blocks Scare (#375)",
    description:
      "#375 Neutralizing Gas suppresses Scare's on-entry Sp. Atk drop.\n"
      + "The enemy Weezing has Neutralizing Gas; your Gyarados has SCARE.\n"
      + "DO: just enter the battle, then open Battle Info on the enemy.\n"
      + "EXPECT: Weezing's Sp. Atk stage is 0 (NOT -1). Regression-locked in the\n"
      + "harness for both active and innate Scare; if you can still reproduce a\n"
      + "drop in a real run, Send Logs with the exact mons involved.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SCARE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WEEZING,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_ABILITY_OVERRIDE: AbilityId.NEUTRALIZING_GAS,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.ICE_FANG, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Black art: Redux forms",
    description:
      "#349 Black art now covers ER CUSTOM (Redux) forms too - 4,053 generated\n"
      + "slug atlases. Your Bellsprout-Redux is a BLACK SHINY.\n"
      + "DO: look at its in-battle BACK sprite, then open the summary (FRONT).\n"
      + "EXPECT: REAL black smoke-halo art of the REDUX form on both sides - not\n"
      + "a flat dark tint, and not the base Bellsprout's art - and it is black\n"
      + "from the FIRST frame (no delayed swap).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 10,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.BELLSPROUT,
      });
      return [
        makeStarter(SpeciesId.BELLSPROUT, {
          formIndex: formIndexByKey(SpeciesId.BELLSPROUT, "redux"),
          moveset: [MoveId.VINE_WHIP, MoveId.RAZOR_LEAF, MoveId.GROWTH, MoveId.SLEEP_POWDER],
        }),
      ];
    },
  },
  {
    label: "Black Gardevoir (screenshot)",
    description:
      "#349 - showcase scenario for screenshots. The wild Gardevoir is a\n"
      + "BLACK SHINY with real smoke-halo art, black from the first frame,\n"
      + "standing at normal height. It only uses Splash; take your time\n"
      + "framing the shot.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GARDEVOIR,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_ENEMY_OVERRIDE: SpeciesId.GARDEVOIR,
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Move spec batch (#386)",
    description:
      "#386 community move batch. Your Enamorus carries the reworked moves.\n"
      + "DO: check the fight panel stats, then USE each move twice.\n"
      + "EXPECT: Razor Wind 70 BP, NO charge turn, super effective vs Rock\n"
      + "(the foe is Golem). Springtide Storm sets misty terrain on the first\n"
      + "use and DOES NOT FAIL on the second (it used to). Steel Roller works\n"
      + "with no terrain and clears one when present. Synchronoise hits the\n"
      + "Golem (and runs as the user's SECOND type). ALSO: no move anywhere\n"
      + "shows more than 20 PP now.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GOLEM,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ENAMORUS, {
          moveset: [MoveId.SPRINGTIDE_STORM, MoveId.RAZOR_WIND, MoveId.STEEL_ROLLER, MoveId.SYNCHRONOISE],
        }),
      ];
    },
  },
  {
    label: "Wishmaker heals SELF (#412)",
    description:
      "#412 WISHMAKER - the on-entry Wish used to land on the OPPONENT and\n"
      + "heal THEM. Your Dragonite (Wishmaker) enters hurt vs a Chansey.\n"
      + "DO: stall a turn (Protect) and watch the end of the NEXT turn.\n"
      + "EXPECT: the Wish heal lands on YOUR Dragonite (big HP jump), never\n"
      + "on the enemy.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: ErAbilityId.WISHMAKER as unknown as AbilityId,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.DRAGONITE, {
          moveset: [MoveId.PROTECT, MoveId.DRAGON_CLAW, MoveId.ROOST, MoveId.SPLASH],
        }),
      ];
    },
    onBattleStart: () => {
      const p = globalScene.getPlayerPokemon();
      if (p) {
        p.hp = Math.floor(p.getMaxHp() / 4);
      }
    },
  },
  {
    label: "Two Step dance rider (#413)",
    description:
      "#413 TWO STEP - the Revelation Dance follow-up after a dance move\n"
      + "used to SELF-HIT the dancer when the dance was a self-buff.\n"
      + "DO: use QUIVER DANCE with your Oricorio (Two Step).\n"
      + "EXPECT: the 50 BP Revelation Dance fires INTO the enemy Snorlax -\n"
      + "your dancer never damages itself. Same for Victory Dance.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: ErAbilityId.TWO_STEP as unknown as AbilityId,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.ORICORIO, {
          moveset: [MoveId.QUIVER_DANCE, MoveId.REVELATION_DANCE, MoveId.AIR_SLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Flash hits BOTH foes (#415)",
    description:
      "#415 FLASH - it is multi-target in ER but hit only ONE foe here.\n"
      + "Doubles vs two Snorlax. DO: use FLASH.\n"
      + "EXPECT: BOTH enemies take damage from the single Flash (60 BP\n"
      + "Electric, 50% chance to drop Atk on each).\n"
      + "ALSO CHECK: open High Jump Kick's move info - the description\n"
      + "must now mention its Striker boost (same for punch/bite/slice\n"
      + "moves and their Iron Fist / Strong Jaw / Keen Edge notes).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        BATTLE_STYLE_OVERRIDE: "double",
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.FLASH, MoveId.THUNDERBOLT, MoveId.HIGH_JUMP_KICK, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.RAICHU, {
          moveset: [MoveId.FLASH, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Save and Quit cloud push (#389)",
    description:
      "#389 - Save and Quit force-pushes the FULL save (system + session)\n"
      + "to the cloud, bypassing the sync throttle. NEW: if that push fails\n"
      + "(server down, offline), a warning appears BEFORE quitting telling\n"
      + "you the save is on this device only. CHECK: while logged in, use\n"
      + "Save and Quit normally (no warning, run reappears on another\n"
      + "browser); then disconnect your network and Save and Quit again -\n"
      + "the local-only warning must appear.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Elite curve + ghost challenge + sprite heal (#419/#422/#421)",
    description:
      "#419 - ELITE trainer mons now respect a per-wave BST ceiling (420 at\n"
      + "w1-20 up to 600 at w81-100, +40 on boss waves; legends banned before\n"
      + "w80). Violators devolve a stage or swap. CHECK: early Elite trainer\n"
      + "teams field basic/mid-stage mons, no wave-20 Kyogre. Hell unchanged.\n"
      + "#422 - new challenge GHOST TRAINERS (7 Favour): every trainer wave\n"
      + "is a ghost team when the pool has one, else a normal trainer.\n"
      + "#421 - wrong-sprite self-heal: if a Pokemon atlas key is requested\n"
      + "with a different path than it loaded with, the texture reloads and\n"
      + "a [er-atlas] warning is logged - if you SEE a wrong sprite (mega art\n"
      + "on a base mon), press Send Logs so we capture the culprit trace.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Berry/Ward rates + reuse hint (#420/#382)",
    description:
      "#420 - resist berry rolls doubled (Ace 5% / Elite 10% / Hell 20%)\n"
      + "and Ward Stone rolls doubled on Elite/Hell (boss Prime 20%/Greater\n"
      + "30%, regular Greater 10%/Minor 40%); Ace now gets a flat 5% Ward\n"
      + "Stone roll from wave 150. CHECK: steal from trainer mons past the\n"
      + "gates, drops should feel about twice as common.\n"
      + "#382 - the challenge screen Start bar now SHOWS the (L/R: last\n"
      + "setup) hint whenever a previous setup exists.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Mono Color challenge (#388)",
    description:
      "#388 - new challenge: MONO COLOR (5 Favour). Open Challenges and\n"
      + "pick a dex color (Red, Green, Blue, White, Brown, Yellow, Purple,\n"
      + "Pink, Gray, Black - the ROM's own color table). EXPECT: starter\n"
      + "select only allows Pokemon of that color, and a team member whose\n"
      + "evolution changes color becomes unusable in battle (like Mono\n"
      + "Type). Favour display should show +5.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Faster game speed (#416)",
    description:
      "#416 - two new speed tiers above Turbo: HYPER (7x) and LUDICROUS\n"
      + "(10x). Check in Settings > General > Game Speed, or cycle with the\n"
      + "speed-change hotkeys (plus/minus) mid-battle - the hotkeys now reach\n"
      + "the new tiers too. EXPECT: animations and text run much faster but\n"
      + "the MUSIC and sound pitch stay completely normal, and battles still\n"
      + "resolve cleanly at 10x (no skipped or stuck phases).",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) No wild redux forms on Ace (#421)",
    description:
      "#421 - wild spawns had a 1-in-8 chance to roll their REDUX form on\n"
      + "EVERY difficulty, so pure-vanilla Ace/Youngster met ER customs in\n"
      + "the wild. Now Elite/Hell only. CHECK: play early Ace waves - wild\n"
      + "mons must always be their normal vanilla form (Battle Info shows\n"
      + "vanilla abilities, not ER innates). On Elite/Hell redux forms still\n"
      + "appear in the wild.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) No mega transforms/trades (#414)",
    description:
      "#414 - a wave-13 Weird Dream on Ace turned a party mon into a\n"
      + "permanent MEGA URSHIFU (the standalone ER mega species records\n"
      + "leaked into the transform and GTS trade pools). Not battle-testable\n"
      + "here - check by replaying Weird Dream / GTS encounters: results\n"
      + "must never be a Mega/Primal/battle-form species, and on Ace or\n"
      + "Youngster never an ER custom at all.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Egg declutter + RDX (#407)",
    description:
      "#407/#408/#409 - NOT a battle test, this entry tracks the checks.\n"
      + "DO: (1) hatch a bunch of eggs - NO Unown letters, Arceus types,\n"
      + "Pikachu caps, Furfrou trims, Therians, Castform weather forms etc\n"
      + "may hatch anymore (the vanilla mon covers those forms). (2) If you\n"
      + "owned a removed form SHINY, its shine (incl. red/black) now shows\n"
      + "on the VANILLA base in starter select, candies carried over. (3)\n"
      + "The RDX gen tab (starter select + Pokedex) lists EVERY ER custom\n"
      + "incl. convergents like Wispywaspy and the Iron series. (4) The\n"
      + "mono-gen challenge offers RDX. (5) Egg gacha: a 4th teal REDUX UP\n"
      + "machine pulls mostly ER customs; auto-restock offers it too.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Redux slot un-hijack (#410)",
    description:
      "#410 - NOT a battle test, this entry tracks the check.\n"
      + "DO: catch a Redux-form mon (e.g. Spearow Redux) in a run, then open\n"
      + "starter select. EXPECT: the catch shows up on the RDX tab entry,\n"
      + "NOT on the vanilla gen slot (gen 1 Spearow stays uncaught unless you\n"
      + "really caught a normal one). If your save was already hijacked, one\n"
      + "reload moves the unlock (shiny tiers + candies) to the RDX entry and\n"
      + "frees the vanilla slot. Pass/Fail once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Weedle Redux line (#411)",
    description:
      "#411 - NOT a battle test, this entry tracks the check.\n"
      + "DO: get a Weedle Redux (RDX tab / Redux Up gacha) and level it: 7\n"
      + "then 10. EXPECT: Weedle Redux -> Kakuna Redux -> Beedrill Redux (no\n"
      + "plain Beedrill). The Beedrill Redux learns ITS kit on level-up (Icicle\n"
      + "Spear etc.), not vanilla Beedrill moves. Same for the redux FORM\n"
      + "version caught in runs. Pass/Fail once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) RDX egg moves (#417)",
    description:
      "#417 - NOT a battle test, this entry tracks the check.\n"
      + "DO: in starter select, open the egg-move panel on RDX customs -\n"
      + "especially Flygon Redux B, Mimikyu Apex, Ribombee Redux,\n"
      + "Serena-Delphox and Weavile Redux. EXPECT: all four egg-move slots\n"
      + "show real, kit-appropriate moves (Mimikyu Apex rare = Dragon\n"
      + "Ascent; Ribombee Redux rare = Tail Glow) - no empty/??? slots on\n"
      + "any hatchable RDX mon. Pass/Fail once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Egg countdown (#378)",
    description:
      "#378 QoL - NOT a battle test, this entry just tracks the check.\n"
      + "DO: in a normal run, open the EGG LIST from the menu (and hatch one).\n"
      + "EXPECT: every egg's hatch text ends with the REAL number, e.g.\n"
      + "'(25 more waves to hatch.)' - no vague wording anywhere.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Daily innates (#379)",
    description:
      "#379 - NOT a battle test, this entry just tracks the check.\n"
      + "DO: start a DAILY run and open Battle Info -> Abilities (or the summary\n"
      + "ability page) on your mons.\n"
      + "EXPECT: ALL THREE innate slots are ACTIVE with no candy unlocks, their\n"
      + "effects work in combat, and after the daily ends your save's real\n"
      + "unlock state is unchanged (run-only).  Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Truant is free (#381)",
    description:
      "#381 - NOT a battle test, this entry just tracks the check.\n"
      + "DO: in STARTER SELECT, search ability text 'Truant' and inspect a mon\n"
      + "whose INNATE slot is Truant (Slakoth line is the classic case).\n"
      + "EXPECT: that slot shows unlocked AND enabled by default at ZERO candy\n"
      + "cost (it is a nerf, so it is free), and in battle the Truant innate is\n"
      + "live from turn 1.  Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.SLAKOTH, {
          moveset: [MoveId.SLACK_OFF, MoveId.BODY_SLAM, MoveId.SHADOW_CLAW, MoveId.YAWN],
        }),
      ];
    },
  },
  {
    label: "(note) Challenge reuse (#382)",
    description:
      "#382 QoL - NOT a battle test, this entry just tracks the check.\n"
      + "DO: on the CHALLENGE screen, set modifiers and start a run. Abandon,\n"
      + "return to the challenge screen and press ACTION to focus the bottom\n"
      + "bar (it is reachable even with NOTHING selected when a saved setup\n"
      + "exists). Press LEFT/RIGHT to switch it to 'Reuse Last Setup', confirm.\n"
      + "EXPECT: the exact last-used configuration is re-applied, every value\n"
      + "restored. The R hotkey from the list does the same.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Doubles Only (#383)",
    description:
      "#383 - NOT a battle test, this entry just tracks the check.\n"
      + "DO: start a challenge run with DOUBLES ONLY (grants 3 Favour) and play\n"
      + "past a few trainer waves.\n"
      + "EXPECT: EVERY trainer battle is a double battle; wild encounters keep\n"
      + "their normal single/double odds; the finale is unchanged.\n"
      + "ALSO (#385): trainers whose pool would send a SINGLE mon now field two\n"
      + "instead - the forced double used to FREEZE on the empty second slot.\n"
      + "Play through early trainer waves and EXPECT no freeze, ever.\n"
      + "ALSO (#400): KO BOTH enemy mons in the SAME turn (double KO) - this\n"
      + "used to HARD FREEZE when the trainer had only one reserve left.\n"
      + "EXPECT the lone replacement to come in (or the battle to end) cleanly.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Early gods gate (#395)",
    description:
      "#395 - NOT a battle test, this entry just tracks the check.\n"
      + "Two holes let 600+ BST 'gods' spawn wild before wave 55 on Youngster/\n"
      + "Ace/Elite: (1) after 10 failed rerolls the gated mon was KEPT (always\n"
      + "happened when a biome's boss pool was all high-BST), now a common-pool\n"
      + "pick replaces it; (2) the level-evolution substitution ran AFTER the\n"
      + "gate, so a harmless roll could evolve into a 600+ BST final - now the\n"
      + "evolved form is re-gated and the weaker stage is kept.\n"
      + "DO: play Youngster/Ace runs to wave ~50 and watch wild + boss spawns.\n"
      + "EXPECT: no pseudo-legendary finals, box legendaries or ER endgame\n"
      + "customs in the wild before wave 55. Pass/Fail once satisfied.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 20, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Usage tiers (#384)",
    description:
      "#384 - NOT a battle test, this entry just tracks the check.\n"
      + "DO: start a challenge run with the USAGE TIER challenge at each value.\n"
      + "EXPECT starter select only offers lines BELOW the tier's usage level:\n"
      + "UU < 2.25% (3 Favour, legendary egg lines banned), RU < 1% (8 Favour,\n"
      + "epic eggs banned too), PU < 0.5% (15 Favour, rare eggs banned, Favour\n"
      + "shiny cap rises 3x -> 5x), NU < 0.25% (20 Favour, common eggs only,\n"
      + "5x cap). Tiers self-update nightly from real player runs.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
];
