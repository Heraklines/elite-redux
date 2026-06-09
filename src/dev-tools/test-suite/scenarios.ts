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
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { ErMoveId } from "#enums/er-move-id";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { ModifierOverride } from "#modifiers/modifier-type";
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
    label: "Berry Smash eats a berry",
    description:
      "#342 Berry Smash — the user must EAT one of its held berries.\n"
      + "Snorlax holds a Sitrus AND a Lum berry (two berries). DO: use Berry Smash\n"
      + "on the enemy.  EXPECT: it deals damage AND the user consumes ONE berry\n"
      + "(random of the two) — e.g. Sitrus heals it, or a held berry count drops.\n"
      + "Before the fix it dealt damage but ate nothing.",
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
      return [makeStarter(SpeciesId.CALYREX, { formIndex: form })];
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
    label: "Redux sprites (party)",
    description:
      "Redux form sprites/icons.\n"
      + "DO: open the party/summary and send them out.  EXPECT: Bellsprout-Redux and\n"
      + "Bounsweet-Redux show correct icons + battle sprites (no green box / wrong mon).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.BELLSPROUT, { formIndex: formIndexByKey(SpeciesId.BELLSPROUT, "redux") }),
        makeStarter(SpeciesId.BOUNSWEET, { formIndex: formIndexByKey(SpeciesId.BOUNSWEET, "redux") }),
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
];
