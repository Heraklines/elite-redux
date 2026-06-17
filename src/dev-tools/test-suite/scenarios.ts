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

import { setClearMeOverrideAfterFirst } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { modifierTypes } from "#data/data-lists";
import type { ErCommunityItemKind } from "#data/elite-redux/er-community-items";
import { seedDevGhostGrave } from "#data/elite-redux/er-ghost-teams";
import { addTreasureFragments, resetErMapNodes, revealMapNodes } from "#data/elite-redux/er-map-nodes";
import { advanceErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { erResistBerryModifierType } from "#data/elite-redux/er-resist-berries";
import { setErDifficulty, setErDifficulty as setErDifficultyForScenario } from "#data/elite-redux/er-run-difficulty";
import { erWardStoneModifierType } from "#data/elite-redux/er-ward-stones";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { ErMoveId } from "#enums/er-move-id";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
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
import { openErMapOverlay } from "#ui/er-map-ui-handler";
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
  STARTING_MONEY_OVERRIDE: 0,
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
  // ER Colosseum (#439): scrub the ME overrides so a scenario that forces an
  // encounter doesn't leak into the next run/scenario.
  MYSTERY_ENCOUNTER_OVERRIDE: null,
  MYSTERY_ENCOUNTER_RATE_OVERRIDE: null,
  // ER: a forced ME only replaces a WILD wave (a trainer wave skips it). ME
  // scenarios set this true so the wave is guaranteed wild; reset here so it
  // never leaks into a normal run (which would have NO trainers).
  DISABLE_STANDARD_TRAINERS_OVERRIDE: false,
  // ER #486: clear the Treasure-Map fragment seed so it never leaks between runs.
  ER_TREASURE_FRAGMENTS_OVERRIDE: 0,
} as const;

/**
 * Reset every dev-managed override so scenarios don't bleed into each other.
 * Also called from index.ts whenever the player is back at the TITLE screen:
 * without that, a scenario's overrides (pinned enemy species/level, starting
 * wave, movesets) leaked into the next NORMAL run started from the title.
 */
export function resetDevOverrides(): void {
  Object.assign(O, structuredClone(DEV_OVERRIDE_DEFAULTS));
}

function setOverrides(partial: Partial<MutableOverrides>): void {
  Object.assign(O, partial);
  // When a scenario FORCES a mystery encounter, arm the one-shot clear so it
  // fires once instead of re-spawning every wave (the rate override otherwise
  // bypasses the "no ME within 3 waves" rule and loops forever).
  if (partial.MYSTERY_ENCOUNTER_OVERRIDE != null) {
    setClearMeOverrideAfterFirst();
    // A forced ME only replaces a WILD wave - if the starting wave happens to
    // roll a trainer (isWaveTrainer is seeded per run), the override is skipped
    // and you get a normal battle instead. Guarantee a wild wave so the ME
    // triggers on EVERY launch, not just the lucky seeds.
    O.DISABLE_STANDARD_TRAINERS_OVERRIDE = true;
  }
}

const MEGA_BRACELET: ModifierOverride = { name: "MEGA_BRACELET" };

/** Shared strong trio for the ER Colosseum gauntlet scenarios (#439). */
function colosseumTestParty(): Starter[] {
  return [
    makeStarter(SpeciesId.GARCHOMP, {
      moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
    }),
    makeStarter(SpeciesId.GARDEVOIR, {
      moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.CALM_MIND],
    }),
    makeStarter(SpeciesId.METAGROSS, {
      moveset: [MoveId.METEOR_MASH, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH, MoveId.EARTHQUAKE],
    }),
  ];
}

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
  // QoL — level-up Move Learn panel
  // ===========================================================================
  {
    label: "QoL: level-up Move Learn panel (mass evolve to 17)",
    description:
      "ER QoL - the level-up Move Learn panel (LEARNABLE | CURRENT) replaces the\n"
      + "per-move text barrage. A 6-mon team of starters at LEVEL 16 (all evolve at 16).\n"
      + "KO the Magikarp, then in the FIRST shop take RARER CANDY - it levels the WHOLE\n"
      + "team +1, so everyone hits 17 at once.\n"
      + "EXPECT: for each mon that learns a move at 17 the panel opens - pick a move\n"
      + "(free slot learns silently; a full set asks which CURRENT move to overwrite),\n"
      + "the list thins down, the highlighted move's type/BP/PP/desc show, and Cancel\n"
      + "asks to confirm. Then all six EVOLVE. No softlock, no text barrage.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 16,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
      });
      const base = (a: MoveId, b: MoveId): MoveId[] => [a, b, MoveId.TACKLE, MoveId.GROWL];
      return [
        makeStarter(SpeciesId.BULBASAUR, { moveset: base(MoveId.VINE_WHIP, MoveId.ABSORB) }),
        makeStarter(SpeciesId.CHARMANDER, { moveset: base(MoveId.EMBER, MoveId.SCRATCH) }),
        makeStarter(SpeciesId.SQUIRTLE, { moveset: base(MoveId.WATER_GUN, MoveId.BUBBLE) }),
        makeStarter(SpeciesId.TREECKO, { moveset: base(MoveId.ABSORB, MoveId.SCRATCH) }),
        makeStarter(SpeciesId.MUDKIP, { moveset: base(MoveId.WATER_GUN, MoveId.MUD_SLAP) }),
        makeStarter(SpeciesId.TORCHIC, { moveset: base(MoveId.EMBER, MoveId.PECK) }),
      ];
    },
    shopItems: [modifierTypes.RARER_CANDY, modifierTypes.RARER_CANDY],
  },
  // ===========================================================================
  // FEATURES — this session
  // ===========================================================================
  {
    label: "ER Relics: Coin Purse + Mystery Charm (#439)",
    description:
      "#439 relics batch. You start holding COIN PURSE (gold amulet) + MYSTERY CHARM\n"
      + "(purple charm) - both visible in the item bar.\n"
      + "EXPECT: Coin Purse = +20% money from all sources (KO the Magikarp and watch the\n"
      + "money reward); Mystery Charm = mystery encounters spawn more often (raises the\n"
      + "natural ME weight - relic + description confirm it).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_COIN_PURSE" }, { name: "ER_RELIC_MYSTERY_CHARM" }],
      });
      return [makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE] })];
    },
  },
  {
    label: "ER Relic: Field Medic (reserves) (#439)",
    description:
      "#439 - Field Medic heals the BENCHED reserves (slots 2 and 3), NOT the active\n"
      + "mon. You hold FIELD MEDIC; slots 2-3 (Pidgey, Rattata) start at ~40% HP, the\n"
      + "active Snorlax is full. Use SPLASH each turn and watch.\n"
      + "EXPECT: every 3rd turn-end, ONLY the slot-2 and slot-3 reserves heal ~1/12 of\n"
      + "max HP (a message names them). The active Snorlax is NEVER healed by it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_FIELD_MEDIC" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.RATTATA, { moveset: [MoveId.SPLASH] }),
      ];
    },
    onBattleStart: () => {
      const party = globalScene.getPlayerParty();
      for (const i of [1, 2]) {
        const p = party[i];
        if (p) {
          p.hp = Math.max(1, Math.floor(p.getMaxHp() * 0.4));
          p.updateInfo();
        }
      }
    },
  },
  {
    label: "ER Relic: Weathervane (#439)",
    description:
      "#439 relic - Weathervane: your team ignores hostile ambient-weather chip\n"
      + "damage. A SANDSTORM is active and you hold WEATHERVANE. Use SPLASH and watch\n"
      + "end-of-turn weather damage.\n"
      + "EXPECT: your Normal-type Snorlax takes NO sandstorm residual; the enemy\n"
      + "Magikarp DOES chip each turn (it has no relic).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        WEATHER_OVERRIDE: WeatherType.SANDSTORM,
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_WEATHERVANE" }],
      });
      return [makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER Relics: Banner/Link/Magnet (#439)",
    description:
      "#439 relics. You hold MORALE BANNER (+15% team dmg while no mon has fainted\n"
      + "this biome), TWIN LINK (+15% to the type SHARED by party slots 2 and 3 -\n"
      + "here both WATER, so Water moves get it), and SCRAP MAGNET.\n"
      + "DO: hit the Magikarp with Snorlax's WATER PULSE (gets BOTH damage boosts);\n"
      + "note the number. Let a mon faint in a later wave -> Morale Banner BREAKS for\n"
      + "the rest of the biome (Water Pulse dmg drops by Morale's 15%; Twin Link stays).\n"
      + "SCRAP MAGNET (note): on a TRAINER win, ~25% chance of one EXTRA reward option.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [
          { name: "ER_RELIC_MORALE_BANNER" },
          { name: "ER_RELIC_TWIN_LINK" },
          { name: "ER_RELIC_SCRAP_MAGNET" },
        ],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.WATER_PULSE, MoveId.TACKLE] }),
        makeStarter(SpeciesId.SQUIRTLE, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PSYDUCK, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Relics: Second Wind + Anchor (#439)",
    description:
      "#439 relics (survival). You hold SECOND WIND (once per biome, the first mon\n"
      + "that would faint survives at 1 HP) and ANCHOR (your slot-6 mon full-heals\n"
      + "once when it becomes your last mon standing).\n"
      + "DO: your active Snorlax starts at ~15% HP vs a strong Magikarp using TACKLE.\n"
      + "EXPECT: the hit that would KO it instead leaves it at 1 HP (Second Wind),\n"
      + "ONCE this biome. (Anchor: harder to stage - faint everyone but the slot-6\n"
      + "mon and it full-heals once as the last standing.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_SECOND_WIND" }, { name: "ER_RELIC_ANCHOR" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.RATTATA, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.CATERPIE, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.WEEDLE, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.MAGIKARP, { moveset: [MoveId.SPLASH] }),
      ];
    },
    onBattleStart: () => {
      const p = globalScene.getPlayerPokemon();
      if (p) {
        p.hp = Math.max(1, Math.floor(p.getMaxHp() * 0.15));
        p.updateInfo();
      }
    },
  },
  {
    label: "ER Relic: Bonded Charm (#439)",
    description:
      "#439 relic - Bonded Charm (soft baton pass): a VOLUNTARY switch carries the\n"
      + "outgoing mon's POSITIVE stat boosts to the incoming mon.\n"
      + "DO: your lead Snorlax starts at +2 to all stats. SWITCH to Pidgey on turn 1\n"
      + "(open the party menu, pick Pidgey).\n"
      + "EXPECT: Pidgey enters KEEPING the +2 boosts. A faint replacement or a forced\n"
      + "switch would NOT carry them (and negatives never carry).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_BONDED_CHARM" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
    onBattleStart: () => boostPlayer(allStages(2)),
  },
  {
    label: "ER Relics: Lookout/Quartermaster/Collector (#439)",
    description:
      "#439 formation relics. You hold LOOKOUT, QUARTERMASTER, and COLLECTOR'S ALBUM.\n"
      + "LOOKOUT (observe now): before the fight, a scout line names the lead enemy\n"
      + "(Gengar) and its TYPES.\n"
      + "QUARTERMASTER (note): every 10th wave, the slot-5 mon copies one transferable\n"
      + "held item from slot 4 or 6 - give slot 4/6 an item (e.g. Leftovers) in a shop,\n"
      + "then reach a wave divisible by 10.\n"
      + "COLLECTOR'S ALBUM (note): every 3rd NEW species you CATCH grants +3 candy to\n"
      + "that species - catch 3 different wild mons and watch the 3rd.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [
          { name: "ER_RELIC_LOOKOUT" },
          { name: "ER_RELIC_QUARTERMASTER" },
          { name: "ER_RELIC_COLLECTORS_ALBUM" },
        ],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.RATTATA, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.SPEAROW, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.EKANS, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.SANDSHREW, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Town: Guessing Booth (#439)",
    description:
      "#439 - Town Guessing Booth mystery encounter (rides the Quiz engine).\n"
      + "DO: on wave 12 the booth spawns. Choose 'Play (pay the fee)'. A small card\n"
      + "shows a black battle-sprite SILHOUETTE + 4 names; UP/DOWN + ACTION to answer.\n"
      + "EXPECT: 4-question press-your-luck (one wrong answer ends it). Reward scales\n"
      + "with consecutive correct: 4/4 -> Damage Calculator unlock; 3 -> choose 1 of 3\n"
      + "ULTRA-tier rewards; 2 -> choose 1 of 3 GREAT-tier; 1 -> choose 1 of 3 COMMON;\n"
      + "0 -> a heal. 'Walk on by' just leaves.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_MONEY_OVERRIDE: 50000,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GUESSING_BOOTH,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Town: Scrambled Pokedex (#439)",
    description:
      "#439 - Professor's Scrambled Pokedex (rides the Quiz engine). The Professor\n"
      + "shows four jumbled dex entries.\n"
      + "DO: on wave 12, choose 'Help the Professor'. A card shows a Pokedex blurb +\n"
      + "4 names; answer all 4 (no stop-on-wrong).\n"
      + "EXPECT: 4/4 -> +5 research Candy for EACH team member (notification) + choose\n"
      + "1 of 3 ROGUE-tier rewards; 3 -> choose 1 of 3 ULTRA; 2 -> GREAT; 1 -> COMMON;\n"
      + "0 -> a heal. Verify the answer's name is NOT shown in its own blurb\n"
      + "(redacted to '[this Pokemon]').",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SCRAMBLED_POKEDEX,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER City: Fortune Teller (#500)",
    description:
      "#500 - The Fortune Teller (Metropolis / Slum settlement seer). Forces\n"
      + "ER_FORTUNE_TELLER. She PREVIEWS the next mystery encounter and, if you let\n"
      + "her, forces it to actually spawn.\n"
      + "DO: on wave 12, read the description + 'Hear the prophecy' tooltip. Note the\n"
      + "named encounter + biome she foresees, then choose 'Hear the prophecy'.\n"
      + "EXPECT: her line names that SAME encounter + biome (no raw ER_ enum text,\n"
      + "no missing-locale keys). It charts that biome onto the World Map (blue node).\n"
      + "Then keep playing to the NEXT mystery wave: the foreseen encounter should be\n"
      + "the one that appears (the prophecy comes true), and only once. 'Decline'\n"
      + "leaves with no queue. (note) The forced-spawn is verifiable only by playing\n"
      + "on to the next ME wave.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FORTUNE_TELLER,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Desert: The Mirage (#511)",
    description:
      "#511 - The Mirage (Desert read-the-tell). Forces ER_THE_MIRAGE. A mon with an\n"
      + "acuity ability (Frisk, Compound Eyes, Keen Eye, Anticipation, Forewarn) sees\n"
      + "through the haze to a hidden cache.\n"
      + "DO: on wave 12 read the description - it should NAME your sharp-eyed mon (this\n"
      + "party has Vespiquen w/ no acuity by default, so swap in one or rely on the\n"
      + "blind path). Choose 'Search the mirage'.\n"
      + "EXPECT: with an acuity mon -> an Ultra + Great reward pick; without one -> a\n"
      + "single Great pick. No raw enum text / missing locale keys.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_THE_MIRAGE,
        ABILITY_OVERRIDE: AbilityId.COMPOUND_EYES,
      });
      return [
        makeStarter(SpeciesId.BUTTERFREE, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Temple: Cleansing Font (#515)",
    description:
      "#515 - The Cleansing Font (Temple shrine). Forces ER_CLEANSING_FONT.\n"
      + "DO: on wave 12, with a hurt party (the lead is pre-damaged), choose 'Drink\n"
      + "from the font'.\n"
      + "EXPECT: the whole party is fully restored (HP + status) via PartyHealPhase,\n"
      + "and the 'restored' line shows (curses are not a built mechanic yet, so it\n"
      + "always takes the restore branch). 'Leave it untouched' just moves on.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_CLEANSING_FONT,
      });
      return [
        makeStarter(SpeciesId.LUMINEON, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Fairy Cave: Wishing Crystal (#521)",
    description:
      "#521 - The Wishing Crystal (Fairy Cave blessing). Forces ER_WISHING_CRYSTAL\n"
      + "in FAIRY_CAVE.\n"
      + "DO: read the description - it names the rolled tier (mostly Great, rarely\n"
      + "Ultra/Rogue). Pick a blessing: power, fortune, or protection.\n"
      + "EXPECT: a reward screen of picks at the ROLLED tier (1 for Great, 2 Ultra, 3\n"
      + "Rogue); on an Ultra+ roll the matching relic is included (power=Morale Banner,\n"
      + "fortune=Coin Purse, protection=Field Medic). No battle.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FAIRY_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_WISHING_CRYSTAL,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Ice Cave: Frozen in Time - with Fire (#518)",
    description:
      "#518 - Frozen in Time (Ice Cave preservation). Forces ER_FROZEN_IN_TIME in\n"
      + "ICE_CAVE. Party HAS a Fire source (Arcanine) -> the gentle-thaw branch.\n"
      + "DO: 'Thaw it free' -> the ancient mon wakes DROWSY and DOCILE (asleep), an\n"
      + "easy catch (throw a Ball). OR 'Chip out the item' for the preserved loot.\n"
      + "EXPECT: thaw -> a catchable wild battle vs a frozen ancient mon (Arctozolt/\n"
      + "Arctovish/Aurorus/Amaura), already asleep. Chip -> a reward (usually a\n"
      + "Never-Melt Ice, sometimes a heal item), no fight.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ICE_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FROZEN_IN_TIME,
      });
      return [
        makeStarter(SpeciesId.ARCANINE, {
          moveset: [MoveId.FLAMETHROWER, MoveId.EXTREME_SPEED, MoveId.CRUNCH, MoveId.WILL_O_WISP],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Ice Cave: Frozen in Time - no Fire (#518)",
    description:
      "#518 - Frozen in Time (Ice Cave preservation). Forces ER_FROZEN_IN_TIME in\n"
      + "ICE_CAVE. Party has NO Fire source -> the careless-thaw branch.\n"
      + "DO: 'Thaw it free' -> with no flame you crack the ice the hard way and the\n"
      + "ancient mon wakes HOSTILE.\n"
      + "EXPECT: thaw -> a boss-tier wild battle vs the frozen ancient mon (still\n"
      + "catchable once weakened, +levels). Chip out the item = same no-fight reward as\n"
      + "the with-Fire scenario.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ICE_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FROZEN_IN_TIME,
      });
      return [
        makeStarter(SpeciesId.LAPRAS, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.THUNDERBOLT, MoveId.BODY_SLAM],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Factory: The Fabricator (#525)",
    description:
      "#525 - The Fabricator (Factory crafting, rework of Salvage Yard). Forces\n"
      + "ER_FABRICATOR in FACTORY. Party carries a 5-stack of Sitrus + Leftovers + Soul\n"
      + "Dew to feed.\n"
      + "DO: 'Use the Smelter' (melt a whole stack -> higher-rarity item, more/finer =\n"
      + "better) or 'Use the Fabricator' (one item -> a production relic), then pick the\n"
      + "item, or 'Walk away'.\n"
      + "EXPECT: smelt -> a reward one-to-three tiers above the fed item (feeding the\n"
      + "5-stack Sitrus pushes it toward Rogue); the whole stack is consumed. Fabricate\n"
      + "-> a Scrap Magnet / Quartermaster / Collector's Album relic (one item consumed).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FACTORY,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FABRICATOR,
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "BERRY", type: BerryType.SITRUS, count: 5 },
          { name: "LEFTOVERS" },
          { name: "SOUL_DEW" },
        ],
      });
      return [
        makeStarter(SpeciesId.METAGROSS, {
          moveset: [MoveId.METEOR_MASH, MoveId.EARTHQUAKE, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Temple: The Innate Shrine (#514)",
    description:
      "#514 - The Innate Shrine (Temple trial). Forces ER_INNATE_SHRINE in TEMPLE.\n"
      + "DO: 'Take the trial', pick a party mon to attune, then beat the shrine guardian\n"
      + "(Bronzong, a 3-4 bar omni-boosted boss, +5 levels). Or 'Leave the shrine'.\n"
      + "EXPECT: on WIN, all of the chosen mon's ER innate slots unlock for the run\n"
      + "(check its Abilities screen - previously locked innates are now active). Lose =\n"
      + "the run is at risk like any boss. Leave -> no fight, no boon.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.TEMPLE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_INNATE_SHRINE,
      });
      return [
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.CONKELDURR, {
          moveset: [MoveId.DRAIN_PUNCH, MoveId.MACH_PUNCH, MoveId.KNOCK_OFF, MoveId.BULK_UP],
        }),
      ];
    },
  },
  {
    label: "ER Volcano: The Great Forge (#513)",
    description:
      "#513 - The Great Forge (Volcano crafting). Forces ER_GREAT_FORGE in VOLCANO.\n"
      + "Party carries held items of different rarities (Leftovers/Soul Dew/Sitrus) to\n"
      + "feed.\n"
      + "DO: 'Temper gently' (+1 tier, low crack) or 'Stoke white-hot' (+2 tiers, high\n"
      + "crack), then pick a held item to feed, or 'Leave the forge'.\n"
      + "EXPECT: success -> a reward screen one/two rarity tiers above the fed item\n"
      + "(a Master-tier feed -> a relic); crack -> the item is consumed and you get a\n"
      + "little slag money, no item. The fed item is consumed either way. Crack chance\n"
      + "rises with heat AND the fed item's rarity.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.VOLCANO,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GREAT_FORGE,
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "LEFTOVERS" },
          { name: "SOUL_DEW" },
          { name: "BERRY", type: BerryType.SITRUS },
        ],
      });
      return [
        makeStarter(SpeciesId.TYPHLOSION, {
          moveset: [MoveId.ERUPTION, MoveId.FLAMETHROWER, MoveId.FOCUS_BLAST, MoveId.SOLAR_BEAM],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Ruins: The Dormant Guardian (#520)",
    description:
      "#520 - The Dormant Guardian (Ruins Braille puzzle -> boss). Forces\n"
      + "ER_DORMANT_GUARDIAN in RUINS.\n"
      + "DO: 'Read the seal' and decode the BRAILLE word (raised dot-cells shown as the\n"
      + "prompt, pick the matching word), or 'Leave it sealed'.\n"
      + "EXPECT: correct -> attune, a reward screen with a relic + a Rogue pick, no\n"
      + "fight. Wrong -> the construct (Golurk/Regirock/Registeel/Golem) wakes as a 5-6\n"
      + "bar omni-boosted boss (+5 levels, all stats +1 on entry); win for the same\n"
      + "relic + Rogue reward. Leave -> no battle, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.RUINS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_DORMANT_GUARDIAN,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.METEOR_MASH, MoveId.AURA_SPHERE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Island: The Regional Emissary (#526)",
    description:
      "#526 - The Regional Emissary (Island exhibition, rework of Import Bazaar).\n"
      + "Forces ER_REGIONAL_EMISSARY in ISLAND.\n"
      + "DO: 'Battle for Alolan Ninetales' or 'Battle for Hisuian Zoroark' to fight the\n"
      + "regional exhibition team (Alolan Ninetales / Galarian Weezing / Hisuian\n"
      + "Zoroark), or 'Decline'.\n"
      + "EXPECT: a trainer battle vs the regional team; on WIN the star you chose joins\n"
      + "your party (a catch/obtain message). Decline -> no battle, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ISLAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_REGIONAL_EMISSARY,
      });
      return [
        makeStarter(SpeciesId.METAGROSS, {
          moveset: [MoveId.METEOR_MASH, MoveId.EARTHQUAKE, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH],
        }),
        makeStarter(SpeciesId.SALAMENCE, {
          moveset: [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.FIRE_FANG, MoveId.DRAGON_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Wasteland: The Scavenger's Pact (#523)",
    description:
      "#523 - The Scavenger's Pact (Wasteland character test). Forces\n"
      + "ER_SCAVENGERS_PACT in WASTELAND.\n"
      + "DO: 'Split it fairly' (no fight), 'Take it all' (betray + fight the rival\n"
      + "scavenger), or 'Walk away'.\n"
      + "EXPECT: split -> a reward screen (Ultra+Great), no battle; betray -> a trainer\n"
      + "fight vs a ROUGHNECK scavenger fielding Krookodile/Mightyena/Flygon, win for\n"
      + "Rogue+Ultra; walk away -> no battle, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 55,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.WASTELAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SCAVENGERS_PACT,
      });
      return [
        makeStarter(SpeciesId.DRAGONITE, {
          moveset: [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.FIRE_PUNCH, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.SLOWBRO, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.PSYCHIC, MoveId.SLACK_OFF],
        }),
      ];
    },
  },
  {
    label: "ER Slum: The Fight Club (#524)",
    description:
      "#524 - The Fight Club (Slum bet/brawl). Forces ER_FIGHT_CLUB in SLUM.\n"
      + "DO: 'Step into the ring' (small ante) or 'Up the ante' (big ante) to brawl a\n"
      + "dirty fighter, or 'Back out'.\n"
      + "EXPECT: ante is deducted from your money up front; the fighter OUTNUMBERS you\n"
      + "(2 mons small / 3 big), TRAPS you in (no switching), some SWAGGER in with an\n"
      + "announced all-stats power-up, and they pull dirty tricks (Fake Out, Sand\n"
      + "Attack, Toxic, Knock Off, Quick Claw/Focus Band/King's Rock). Win -> the loot\n"
      + "payout (Ultra+Great small / Rogue+Ultra+Great big). Back out = no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SLUM,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FIGHT_CLUB,
        STARTING_MONEY_OVERRIDE: 50000,
      });
      return [
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.METEOR_MASH, MoveId.EXTREME_SPEED, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Swamp: The Bog Witch's Bargain (#508)",
    description:
      "#508 - The Bog Witch's Bargain (Swamp DEAL). Forces ER_BOG_WITCH in SWAMP.\n"
      + "The witch wants an offering at or above a HIDDEN rarity (Great/Ultra/Rogue),\n"
      + "which she never names.\n"
      + "DO: 'Leave an offering', pick a held item. The party here carries items of\n"
      + "different tiers (Leftovers/Eviolite vs a Soul Dew-tier) to test both outcomes.\n"
      + "EXPECT: offer >= her hidden bar -> she purges all party status + a Weathervane\n"
      + "relic reward; offer below it -> a bog-rot curse chips the whole party ~1/6 HP\n"
      + "(never below 1). The offered item is consumed either way. 'Refuse' = no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SWAMP,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_BOG_WITCH,
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "LEFTOVERS" },
          { name: "SOUL_DEW" },
          { name: "BERRY", type: BerryType.SITRUS },
        ],
      });
      return [
        makeStarter(SpeciesId.GRIMER, {
          moveset: [MoveId.SLUDGE_BOMB, MoveId.TOXIC, MoveId.MINIMIZE, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Swamp: The Sinking Mire (#509)",
    description:
      "#509 - The Sinking Mire (Swamp read-the-typing). Forces ER_SINKING_MIRE in\n"
      + "SWAMP. A random party mon starts sinking.\n"
      + "DO: 'Haul it out' and pick a rescuer. A Flying/Levitate/light/strong-Attack mon\n"
      + "succeeds; a heavy weakling flounders. (Party: Crobat = Flying rescuer that\n"
      + "always works; Munchlax = heavy weakling that flounders.) Or 'Leave it'.\n"
      + "EXPECT: good rescuer -> a Rogue-tier reward + the sinker's status cleared; bad\n"
      + "rescuer -> the sinking mon takes ~1/4 HP mire damage + loses a held item. Leave\n"
      + "-> the bog takes one of the sinker's held items (or chips it), no reward.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SWAMP,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SINKING_MIRE,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
      });
      return [
        makeStarter(SpeciesId.CROBAT, {
          moveset: [MoveId.CROSS_POISON, MoveId.AIR_SLASH, MoveId.ROOST, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.MUNCHLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Graveyard: Unfinished Business (#517)",
    description:
      "#517 - Unfinished Business (Graveyard score-settling). Forces\n"
      + "ER_UNFINISHED_BUSINESS in GRAVEYARD. With an empty ghost pool it uses the\n"
      + "synthetic legacy grave: killer team = Garchomp / Spiritomb / Milotic.\n"
      + "DO: read the epitaph (challenger name / difficulty / wave / killer), then\n"
      + "'Finish their fight' to battle the killer team, or 'Walk on'.\n"
      + "EXPECT: finish -> a spectral TRAINER (named after the killer) fielding the\n"
      + "exact killer team, level-scaled; win -> a reward screen with one random\n"
      + "relic. Walk on -> no battle, no cost. (Online, the grave/killer are real\n"
      + "ghost-pool data instead of the legacy trio.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.GRAVEYARD,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_UNFINISHED_BUSINESS,
      });
      return [
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.ICE_BEAM, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Badlands: High Noon (#516)",
    description:
      "#516 - High Noon (Badlands single-strike duel). Forces ER_HIGH_NOON in\n"
      + "BADLANDS.\n"
      + "DO: 'Take the duel' and pick a Pokemon. The outlaw draws at a FIXED, wave-scaled\n"
      + "speed (shown in the dialogue), compared ONLY against the mon you pick - not the\n"
      + "team average.\n"
      + "EXPECT: both ante (money drops by the ante); pick the fast Ninjask -> its Speed\n"
      + "beats the outlaw's draw, you win back 2x the ante (net gain); pick the slow\n"
      + "Munchlax -> it is out-drawn, you lose the ante. No battle. 'Walk away' = no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.BADLANDS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_HIGH_NOON,
      });
      return [
        makeStarter(SpeciesId.NINJASK, {
          moveset: [MoveId.X_SCISSOR, MoveId.AERIAL_ACE, MoveId.SWORDS_DANCE, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.MUNCHLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Mountain: The Mountain Sage (#522)",
    description:
      "#522 - The Mountain Sage (Mountain training event). Forces ER_MOUNTAIN_SAGE\n"
      + "in MOUNTAIN.\n"
      + "DO: on wave 12 choose 'Train the body', 'Train the technique', or bow out.\n"
      + "EXPECT: body -> a reward screen with 2 vitamins + a Rare Candy; technique ->\n"
      + "a Learner's Shroom (teach any move); bow -> move on, no reward. No battle.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.MOUNTAIN,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_MOUNTAIN_SAGE,
      });
      return [
        makeStarter(SpeciesId.MEDICHAM, {
          moveset: [MoveId.HIGH_JUMP_KICK, MoveId.ZEN_HEADBUTT, MoveId.ICE_PUNCH, MoveId.BULK_UP],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Power Plant: Reactor Meltdown (#519)",
    description:
      "#519 - Reactor Meltdown (Power Plant gauge-read). Forces ER_REACTOR_MELTDOWN\n"
      + "in POWER_PLANT.\n"
      + "DO: read the three unit gauges in the option tooltips and 'Shut down' the unit\n"
      + "with the HIGHEST reading.\n"
      + "EXPECT: correct (hottest) unit -> the core stabilises, reward = Capacitor relic\n"
      + "+ an Ultra pick. WRONG unit -> a blowout chips the whole party ~1/8 max HP\n"
      + "(never below 1) + a single Great pick. (This is the OTHER power-plant event,\n"
      + "distinct from Overcharge the Core's stat surge.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.POWER_PLANT,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_REACTOR_MELTDOWN,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Desert: The Buried City (#510)",
    description:
      "#510 - The Buried City (Desert press-your-luck delve). Forces ER_BURIED_CITY\n"
      + "in DESERT.\n"
      + "DO: 'Dig into the city', then 'Dig deeper' past guardian stirs until the warden\n"
      + "RUNERIGUS rises (after 3 stirs), beat it, then 'Climb out'.\n"
      + "EXPECT: money per dig; stirs = Ground guardians (BST climbs); the 4th stir is\n"
      + "Runerigus (3-4 bars, +5 levels). Banking AFTER beating Runerigus grants the\n"
      + "Pharaoh's Ankh relic + Ultra picks; banking WITHOUT beating it = NO Ankh.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.DESERT,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_BURIED_CITY,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.CRUNCH, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "ER Volcano: Into the Caldera (#512)",
    description:
      "#512 - Into the Caldera (Volcano press-your-luck delve). Forces\n"
      + "ER_INTO_THE_CALDERA in VOLCANO.\n"
      + "DO: 'Descend the tube', then 'Descend deeper' a few times; 'Rise to the rim'\n"
      + "to bank.\n"
      + "EXPECT: each descent pays money + scorches your NON-Fire mons ~1/16 max HP\n"
      + "(the Magcargo lead is Fire, so it is spared; the Pidgey takes heat, never\n"
      + "below 1 HP). Pushing raises the eruption chance -> a Fire guardian fight\n"
      + "(BST climbs, boss after 3); win and the dive resumes, money kept. A DEEP\n"
      + "bank can offer the Molten Core relic / Greater Golden Ball + high-tier picks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.VOLCANO,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_INTO_THE_CALDERA,
      });
      return [
        makeStarter(SpeciesId.MAGCARGO, {
          moveset: [MoveId.LAVA_PLUME, MoveId.ROCK_SLIDE, MoveId.RECOVER, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Graveyard: Graves of the Fallen (#439)",
    description:
      "#439 Graveyard ME (rides the ghost-team substrate). Forces\n"
      + "ER_GRAVES_OF_THE_FALLEN in the GRAVEYARD biome. This scenario PLANTS a real\n"
      + "named grave (Veteran Lance, hell, fell at wave 147, beaten by Champion\n"
      + "Cynthia) so the epitaph + mementos always render even on an empty pool.\n"
      + "EXPECT: the epitaph shows that NAME / difficulty / wave / killer. PAY\n"
      + "RESPECTS -> a memento (their held item: Leftovers/Wide Lens) and leave.\n"
      + "DISTURB -> they rise as a NAMED GHOST TRAINER (Lance's team, ghost theme);\n"
      + "win -> 2 of their held items. WALK AWAY -> no cost. Never softlocks.",
    setup: () => {
      resetDevOverrides();
      // Plant a real named grave so the epitaph (name/wave/mode/killer) and the
      // held-item mementos render regardless of the live ghost pool's contents.
      seedDevGhostGrave();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.GRAVEYARD,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GRAVES_OF_THE_FALLEN,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.CRUNCH],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Forest: Woodland Forager (#439)",
    description:
      "#439 Forest press-your-luck FORAGE loop (Phase A3 substrate + first event).\n"
      + "Forces ER_WOODLAND_FORAGER in the FOREST biome.\n"
      + "DO: pick 'Forage the grove', then 'Forage on' repeatedly (common -> rare\n"
      + "berries, a Rogue ingredient deep in) while the BUST chance climbs; or 'Pack\n"
      + "up and leave' to stop.\n"
      + "EXPECT: each forage hands a berry to your party RIGHT AWAY (check held items).\n"
      + "Pushing into an interrupt spawns an escalating 2-mon Bug swarm - WIN and\n"
      + "foraging RESUMES (it does NOT end). Each interrupt pulls a tougher lead and\n"
      + "more levels; after 3 the lead is the chain BOSS (2-3 health bars, >= 5 levels\n"
      + "over your strongest mon). Berries already held are never lost. Pack up = leave\n"
      + "with everything (+ Rogue pick on a jackpot). Round-0 leave = nothing. A party\n"
      + "wipe ends the run; never softlocks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FOREST,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_WOODLAND_FORAGER,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.FIRE_FANG],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Glittering Vein (#439)",
    description:
      "#439 Cave press-your-luck MINING (reuses the press-luck substrate). Forces\n"
      + "ER_GLITTERING_VEIN in the CAVE biome.\n"
      + "DO: 'Work the vein', then keep digging or pack up. Each round rolls money:\n"
      + "usually a jittered payout, sometimes a NUGGET (big), sometimes NOTHING (dud).\n"
      + "Item finds are HELD only: Eviolite / Mystical Rock (uncommon, deep), a King's\n"
      + "Rock (rare, ~mega-rare), or a party-line Mega Stone. BUST chance climbs.\n"
      + "EXPECT: money is paid per strike and kept on a bust (nothing scatters). bank =\n"
      + "item shop if any found. A bust spawns an escalating wild Rock/Ground mon\n"
      + "(Onix->Gigalith); after 3 it is the chain BOSS (2-3 bars, >= 5 levels over your\n"
      + "strongest). Win and mining RESUMES. Round-0 leave = nothing. Never softlocks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GLITTERING_VEIN,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.WATERFALL, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Overgrown Temple (#439)",
    description:
      "#439 Jungle press-your-luck DELVE (reuses the press-luck substrate). Forces\n"
      + "ER_OVERGROWN_TEMPLE in the JUNGLE biome.\n"
      + "DO: 'Delve into the temple', then press deeper or climb out. Each chamber rolls\n"
      + "money: usually jittered, sometimes a NUGGET (big), sometimes NOTHING (dud). Item\n"
      + "finds are HELD only: Eviolite / Mystical Rock (uncommon, deep), a King's Rock\n"
      + "(rare, ~mega-rare), or a party-line Mega Stone. WAKE chance climbs each step.\n"
      + "EXPECT: money is paid per chamber and kept on a wake (nothing scatters). climb\n"
      + "out = item shop if any found. A wake spawns an escalating wild Grass/Rock\n"
      + "guardian (Sudowoodo->Tangrowth); after 3 it is the chain BOSS - BURMY ETERNA\n"
      + "('Eternaburm', 2-3 bars, >= 5 levels over your strongest). Win and delving\n"
      + "RESUMES. Chamber-0 leave = nothing. Never softlocks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.JUNGLE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_OVERGROWN_TEMPLE,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.FIRE_FANG, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Tide Pools (#439)",
    description:
      "#439 Beach press-your-luck COMB (reuses the press-luck substrate). Forces\n"
      + "ER_TIDE_POOLS in the BEACH biome.\n"
      + "DO: 'Comb the pools', then keep combing or pack up. Each comb rolls money:\n"
      + "usually jittered, sometimes a PEARL (big), sometimes NOTHING (dud). Item finds\n"
      + "are HELD only: Eviolite / Mystical Rock (uncommon, deep), a King's Rock (rare),\n"
      + "or a party-line Mega Stone. BUST chance climbs.\n"
      + "EXPECT: money paid per comb and kept on a bust. pack up = item shop if any.\n"
      + "A bust spawns an escalating wild Water mon (Corsola->Gyarados); after 3 it is\n"
      + "the chain BOSS (2-3 bars, >= 5 levels over your strongest). Win and combing\n"
      + "RESUMES. Round-0 leave = nothing. Never softlocks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.BEACH,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_TIDE_POOLS,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Abyssal Vent (#439)",
    description:
      "#439 Seabed press-your-luck DELVE (reuses the press-luck substrate). Forces\n"
      + "ER_ABYSSAL_VENT in the SEABED biome.\n"
      + "DO: 'Dive the trench', then dive deeper or rise up. Each descent rolls money:\n"
      + "usually jittered, sometimes a NUGGET (big), sometimes NOTHING (dud). Item finds\n"
      + "are HELD only: Eviolite / Mystical Rock (uncommon, deep), a King's Rock (rare),\n"
      + "or a party-line Mega Stone. STIR chance climbs each level.\n"
      + "EXPECT: money paid per descent and kept on a stir. rise = item shop if any.\n"
      + "A stir spawns an escalating wild deep-sea mon (Lanturn->Dhelmise); after 3 it\n"
      + "is the chain BOSS (2-3 bars, >= 5 levels over your strongest). Win and diving\n"
      + "RESUMES. Level-0 rise = nothing. Never softlocks.\n"
      + "#492 REGRESSION: keep diving until the trench STIRS - the guardian (often an\n"
      + "ER custom) must spawn and its enemy HP/info bar must render with NO crash. The\n"
      + "crash was unguarded dex/starter lookups in enemy-battle-info for not-in-dex\n"
      + "enemies; ER custom guardians are intended and now render fine.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEABED,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_ABYSSAL_VENT,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Hot Spring (#439)",
    description:
      "#439 Mountain REST, redesigned: guardian Pokemon (a Slowking sprite) watch the\n"
      + "spring and accept BERRIES as tribute, not money. Party seeded with 5 Sitrus\n"
      + "Berries so the toll is affordable.\n"
      + "DO: 'Offer Berries (3)' or 'Move on' for free.\n"
      + "EXPECT: the intro shows a Slowking guardian (not a chest); Offer spends 3\n"
      + "berries (check held items: 5 -> 2) and fully restores the WHOLE party via\n"
      + "PartyHealPhase with a 'fully restored' message. The Offer option greys out if\n"
      + "the party holds fewer than 3 berries. (Party spawns at full HP, so the heal is\n"
      + "a no-op visually - verify no error and the berries are spent.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.MOUNTAIN,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS, count: 5 }],
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_HOT_SPRING,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEOT, { moveset: [MoveId.AIR_SLASH, MoveId.HURRICANE, MoveId.ROOST, MoveId.U_TURN] }),
      ];
    },
  },
  {
    label: "ER Fairy's Boon (#439)",
    description:
      "#439 Fairy Cave RELIC gift. Forces ER_FAIRYS_BOON in the FAIRY_CAVE biome.\n"
      + "DO: 'Accept the blessing' or 'Decline politely'.\n"
      + "EXPECT: Accept opens a no-battle reward with ONE guaranteed Formation/buff\n"
      + "Relic (Morale Banner / Second Wind / Mystery Charm / Weathervane) - take it and\n"
      + "check it lands in your held items + the buff panel. Decline = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FAIRY_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FAIRYS_BOON,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SYLVEON, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYSHOCK, MoveId.SHADOW_BALL, MoveId.WISH],
        }),
      ];
    },
  },
  {
    label: "ER The Picnic (#439)",
    description:
      "#439 Meadow social REST. Forces ER_PICNIC in the MEADOW biome.\n"
      + "DO: 'Lay out a spread' or 'Move on'.\n"
      + "EXPECT: the spread grants +5 Candy to EACH party member's species (check candy\n"
      + "on the starter screen) and adds affection to the whole party, with a message.\n"
      + "Move on = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.MEADOW,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_PICNIC,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Exotic Trader (#439)",
    description:
      "#439 Sea premium MARKET. Forces ER_EXOTIC_TRADER in the SEA biome (with money).\n"
      + "DO: 'Board and browse' (steep wave-scaled fee) or 'Sail on' for free.\n"
      + "EXPECT: Board deducts the fee and opens a no-battle reward of 3 GUARANTEED\n"
      + "high-tier picks (1 Rogue + 2 Ultra). The board option greys out if you cannot\n"
      + "afford it. Sail on = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_MONEY_OVERRIDE: 200000,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEA,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_EXOTIC_TRADER,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Totem Trial (#503)",
    description:
      "#503 ISLAND Trial (moved off Temple). Forces ER_TOTEM_TRIAL in the ISLAND\n"
      + "biome. DO: 'Face the totem' or 'Leave it at rest'.\n"
      + "EXPECT: Face = a DOUBLE battle - a multi-bar totem boss (Golurk / Regirock /\n"
      + "Runerigus) that SUMMONS an ally (Sableye / Bronzong / Carbink), the totem\n"
      + ">= 5 levels above your strongest mon. WIN and the reward fires: a guaranteed\n"
      + "POWER GEM (its TM) + one ROGUE pick (no relic - that was Temple's Innate\n"
      + "Shrine). Leave = nothing, no cost. A wipe ends the run (never softlocks).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ISLAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_TOTEM_TRIAL,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Black Market (#439)",
    description:
      "#439 Slum bargain MARKET. Forces ER_BLACK_MARKET in the SLUM biome.\n"
      + "DO: 'Browse the stalls' or 'Walk away'.\n"
      + "EXPECT: Browse opens a no-battle reward of 3 mixed-tier picks (2 Great + 1\n"
      + "Ultra). Walk away = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SLUM,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_BLACK_MARKET,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Lake Spirit (#439)",
    description:
      "#439 Lake knowledge TRIAL (reuses the ErQuiz dex engine). Forces ER_LAKE_SPIRIT\n"
      + "in the LAKE biome.\n"
      + "DO: 'Take the test' (3 Pokedex riddles) or 'Decline'.\n"
      + "EXPECT: the blessing scales with correct answers - 3/3 = +5 Candy each + a\n"
      + "blessing Relic + 2 Ultra picks; 2 = 3 Ultra picks; 1 = 3 Great picks; 0 = leave\n"
      + "with a heal. Decline = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.LAKE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_LAKE_SPIRIT,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Import Bazaar (#439)",
    description:
      "#439 Island MARKET. Forces ER_IMPORT_BAZAAR in the ISLAND biome.\n"
      + "DO: 'Browse the imports' or 'Move on'.\n"
      + "EXPECT: Browse opens a no-battle reward of curated held-item imports (Wide Lens,\n"
      + "Scope Lens, Leftovers, Shell Bell, Quick Claw, King's Rock) - pick one. Move on\n"
      + "= nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ISLAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_IMPORT_BAZAAR,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Sealed Door / Unown Cipher (#506)",
    description:
      "#506 Ruins UNOWN CIPHER (no longer the silhouette game). Forces\n"
      + "ER_SEALED_DOOR in the RUINS biome.\n"
      + "DO: 'Read the glyphs' or 'Leave it sealed'. EXPECT: each of 3 questions shows\n"
      + "a WORD spelled out in a row of UNOWN letter glyphs; pick the matching word\n"
      + "from the 4 choices (NOT a Pokemon silhouette). The vault tier scales with\n"
      + "correct decodes - 3/3 = 3 Rogue picks; 2 = 3 Ultra; 1 = 3 Great; 0 = leave\n"
      + "with a heal. Leave it sealed = nothing, no cost. CHECK the Unown glyphs render\n"
      + "(a row of distinct letter icons, not blank).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.RUINS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SEALED_DOOR,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Overcharge the Core (#439)",
    description:
      "#439 Power Plant PERMANENT STAT SURGE (reworked from the old boss fight).\n"
      + "Forces ER_OVERCHARGE_CORE in POWER_PLANT.\n"
      + "DO: 'Channel the core' -> pick a Pokemon. A press-your-luck loop opens: each\n"
      + "'Surge again' permanently raises that mon's Sp. Atk OR Speed (a vitamin, fixed\n"
      + "stat for the session); 'Stabilize' to keep them.\n"
      + "EXPECT: each surge bumps the stat for good (check Summary stats climb); pushing\n"
      + "raises the short-circuit chance - on a short-circuit the WHOLE session's surges\n"
      + "vanish and the mon is chipped (HP drops, never below 1). 'Pull the breaker' =\n"
      + "nothing, no cost. NO boss battle should appear.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.POWER_PLANT,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_OVERCHARGE_CORE,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Frozen Shapes (#439)",
    description:
      "#439 Ice Cave silhouette puzzle (reuses the ErQuiz engine). Forces\n"
      + "ER_FROZEN_SHAPES in the ICE_CAVE biome.\n"
      + "DO: 'Read the shapes' (3 silhouette questions) or 'Leave the ice'.\n"
      + "EXPECT: the cache tier scales with correct answers - 3/3 = 3 Rogue picks; 2 = 3\n"
      + "Ultra; 1 = 3 Great; 0 = leave with a heal. Leave = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ICE_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FROZEN_SHAPES,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Salvage Yard (#439)",
    description:
      "#439 Factory MARKET. Forces ER_SALVAGE_YARD in the FACTORY biome.\n"
      + "DO: 'Pick through the salvage' or 'Leave it be'.\n"
      + "EXPECT: Pick opens a no-battle reward of curated reclaimed parts (Quick Claw,\n"
      + "Grip Claw, Wide Lens, Scope Lens, King's Rock, Leftovers) - pick one. Leave =\n"
      + "nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FACTORY,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SALVAGE_YARD,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Foreman's Job (#439)",
    description:
      "#439 Construction Site boss TRIAL. Forces ER_FOREMANS_JOB in the\n"
      + "CONSTRUCTION_SITE biome.\n"
      + "DO: 'Take the job' or 'Clock out'.\n"
      + "EXPECT: Take = a BOSS battle vs a construction golem (Conkeldurr / Bronzong /\n"
      + "Coalossal), 2-3 bars and >= 5 levels above your strongest mon. WIN for 2 Rogue\n"
      + "picks + a Relic. Clock out = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.CONSTRUCTION_SITE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FOREMANS_JOB,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER The Aurora (#439)",
    description:
      "#439 Snowy Forest blessing. Forces ER_AURORA in the SNOWY_FOREST biome.\n"
      + "DO: 'Stand under the lights' or 'Walk on'.\n"
      + "EXPECT: Stand opens a no-battle reward of 3 guaranteed Ultra picks. Walk on =\n"
      + "nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SNOWY_FOREST,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_AURORA,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Tracks in the Snow (#498)",
    description:
      "#498 Snowy Forest footprint hunt. Forces ER_TRACKS_IN_THE_SNOW in SNOWY_FOREST.\n"
      + "DO: 'Read the tracks' -> a FOOTPRINT sprite shows; pick who made it from 3\n"
      + "names. (Species with no footprint art fall back to a black silhouette.)\n"
      + "EXPECT: Right = a no-battle reward of 3 Ultra picks; wrong = 2 Great picks\n"
      + "(never empty). 'Leave the trail' = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SNOWY_FOREST,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_TRACKS_IN_THE_SNOW,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER The Experiment (#439)",
    description:
      "#439 Laboratory GAMBLE. Forces ER_EXPERIMENT in the LABORATORY biome (money).\n"
      + "DO: 'Run the experiment' or 'Decline'.\n"
      + "EXPECT: ~80% success = a no-battle reward of 3 Ultra picks; ~20% backfire = no\n"
      + "reward + a wave-scaled cleanup fee deducted, with a backfire message. Decline =\n"
      + "nothing, no cost. (Outcome is RNG; re-roll the scenario to see both.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_MONEY_OVERRIDE: 50000,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.LABORATORY,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_EXPERIMENT,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Gentle Giant (#439)",
    description:
      "#439 Grass CATCH event. Forces ER_GENTLE_GIANT in the GRASS biome.\n"
      + "DO: 'Approach it' or 'Leave it be'.\n"
      + "EXPECT: Approach = a wild-boss battle vs a docile Grass titan (Torterra /\n"
      + "Tangrowth / Gogoat / Tsareena), asleep + multi-bar. Weaken it, then the Ball\n"
      + "command CATCHES it (catch is allowed; flee is not). Leave = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.GRASS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GENTLE_GIANT,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Rustling Grass (#439)",
    description:
      "#439 Tall Grass CATCH event. Forces ER_RUSTLING_GRASS in the TALL_GRASS biome.\n"
      + "DO: 'Flush it out' or 'Leave it hidden'.\n"
      + "EXPECT: Flush = a wild-boss battle vs a rare hidden mon (Ditto / Chansey /\n"
      + "Kangaskhan / Bouffalant). Weaken it, then the Ball command CATCHES it. Leave =\n"
      + "nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.TALL_GRASS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_RUSTLING_GRASS,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Dragon's Hoard (#439)",
    description:
      "#439 Wasteland CATCH + loot event. Forces ER_DRAGONS_HOARD in the WASTELAND\n"
      + "biome.\n"
      + "DO: 'Challenge it' or 'Back away'.\n"
      + "EXPECT: Challenge = a wild-boss battle vs a strong dragon (Hydreigon /\n"
      + "Dragonite / Salamence / Garchomp). WIN to collect the hoard (2 Rogue + 1 Ultra\n"
      + "picks), or throw a Ball to CATCH the dragon instead. Back away = nothing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.WASTELAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_DRAGONS_HOARD,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Still Waters (#439)",
    description:
      "#439 Lake MIRROR-match. Forces ER_STILL_WATERS in the LAKE biome.\n"
      + "DO: 'Face your reflection' or 'Step away'.\n"
      + "EXPECT: Face = a battle vs a MIRROR of your current party (same species,\n"
      + "levels, abilities, forms, movesets - held items are NOT copied). WIN for 2\n"
      + "Rogue picks. Step away = nothing, no cost. (Bring a real 2-3 mon team to see\n"
      + "the mirror; the enemy side should match your roster.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.LAKE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_STILL_WATERS,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Mushroom Circle (#439)",
    description:
      "#439 Grass one-shot GAMBLE. Forces ER_MUSHROOM_CIRCLE (wave-only override,\n"
      + "matching the proven Booth scenario - the forced type does not depend on the\n"
      + "backdrop biome).\n"
      + "DO: 'Taste a mushroom' (a single 50/50 roll, no loop, no battle) or 'Leave the\n"
      + "ring be' for nothing.\n"
      + "EXPECT: WINDFALL = +3 Candy to each party member's species (check candy on the\n"
      + "starter screen) with a notification; or CURSE-LITE = a small money nip. Leave\n"
      + "= no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_MONEY_OVERRIDE: 20000,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_MUSHROOM_CIRCLE,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Town Raffle (#439)",
    description:
      "#439 Town RELIC gamble. Forces ER_TOWN_RAFFLE in the TOWN biome (you start\n"
      + "with money for the fee).\n"
      + "DO: 'Buy a ticket' (a small fee, Super-Potion sized) for a seeded draw, or\n"
      + "'Decline' for no cost.\n"
      + "EXPECT: a tiered reward shop - JACKPOT (~10%) = a Formation relic (Quartermaster\n"
      + "/ Lookout / Anchor / Twin Link); MID = pick 1 of 3 Great/Ultra; CONSOLATION = 2\n"
      + "Poke Balls. Always pays something. Buy repeatedly to see the jackpot.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_MONEY_OVERRIDE: 50000,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.TOWN,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_TOWN_RAFFLE,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "World Tournament - ACE (vanilla) (#439)",
    description:
      "#439 Colosseum - dynamic 15-round press-your-luck gauntlet, ACE mode.\n"
      + "DO: on wave 12 the Colosseum spawns. Enter, win, then CONTINUE / CASH OUT.\n"
      + "EXPECT (Ace = PURE VANILLA): challengers are rolled from VANILLA pools -\n"
      + "rounds 1-4 normal trainers, 5-8 GHOSTS (real player teams, shown by the\n"
      + "uploader's name; may be sparse so some fall back to gym trainers), 9-10\n"
      + "bosses (Elite Four), 11-12 gym leaders, 13-14 strong ghosts, 15 a Champion.\n"
      + "The standings board reveals only cleared + next challengers (portrait +\n"
      + "name); upcoming ones are SILHOUETTES tagged Ghost/Boss/Gym/Champion. NO ER\n"
      + "custom mons (pure vanilla). Grade D..EX; CASH OUT = money + grade-locked shop.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("ace");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.COLOSSEUM,
      });
      return colosseumTestParty();
    },
  },
  {
    label: "World Tournament - ELITE (#439)",
    description:
      "#439 Colosseum - dynamic gauntlet, ELITE mode (full ER).\n"
      + "DO: enter on wave 12, fight through, watch the escalation.\n"
      + "EXPECT: normal/boss/gym/champion rounds field REAL ER 'insane'-tier teams\n"
      + "(not weak vanilla mons), ghosts are real Elite player teams (uploader names),\n"
      + "round 14 is the 'deadliest' ghost when the kill-pool has one. Teams fight at\n"
      + "FULL power (BST cap bypassed) re-levelled to your strongest mon. Silhouette\n"
      + "board reveals only cleared + next. Champion (round 15) = a Champion sprite.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("elite");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 110,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.COLOSSEUM,
      });
      return colosseumTestParty();
    },
  },
  {
    label: "World Tournament - HELL (#439)",
    description:
      "#439 Colosseum - dynamic gauntlet, HELL mode (hardest pools).\n"
      + "DO: enter on wave 12, push as deep as you can.\n"
      + "EXPECT: ER 'hell'-tier rosters + Hell ghosts, brutal boss/gym/champion teams\n"
      + "at full power re-levelled to your strongest mon; round 14 the deadliest ghost.\n"
      + "Mystery silhouette board; grade climbs D..EX; CASH OUT banks the grade shop.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 130,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.COLOSSEUM,
      });
      return colosseumTestParty();
    },
  },
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
    label: "Hell: enemy = your top level",
    description:
      "ER HELL-ONLY level scaling, eased in by wave. Enemies spawn relative to the\n"
      + "HIGHEST level in YOUR party (benching a low mon can't soften a wave):\n"
      + "  waves 1-9: top - 3,  10-19: top - 2,  20-39: top - 1,  40+: top (parity).\n"
      + "Your party here is all LEVEL 50 at wave 5.\n"
      + "EXPECT: the wild enemy spawns at LEVEL 47 (top 50 minus 3 at this wave),\n"
      + "NOT the usual ~level 5 wave-scaled mon. By wave 10 it's 48, wave 20 it's 49,\n"
      + "and from wave 40 it matches your top level exactly.\n"
      + "OTHER MODES UNAFFECTED: the same setup on Ace/Elite/Youngster keeps the\n"
      + "normal low wave-scaled enemy level.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.BULBASAUR, {
          moveset: [MoveId.GIGA_DRAIN, MoveId.SLUDGE_BOMB, MoveId.SYNTHESIS, MoveId.PROTECT],
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
    label: "First Impression flinches",
    description:
      "First Impression - in ER it shares the Fake Out effect (#623, effect\n"
      + "139): a GUARANTEED flinch, usable only on the first turn. Report: it\n"
      + "wasn't flinching (vanilla First Impression never did).\n"
      + "DO: turn 1, use First Impression on the slow Snorlax.\n"
      + "EXPECT: Golisopod moves first (+3 priority), and Snorlax FLINCHES -\n"
      + "it cannot use Tackle this turn ('flinched and couldn't move'). Turn 2,\n"
      + "First Impression FAILS (first-turn only), confirming the gate still works.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.FIRST_IMPRESSION, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [makeStarter(SpeciesId.GOLISOPOD, { moveset: [MoveId.FIRST_IMPRESSION, MoveId.SPLASH] })];
    },
  },
  {
    label: "Biome identity: Power Plant terrain",
    description:
      "#439 §3 biome battle identity (GROUP A). Power Plant has Electric Terrain\n"
      + "ALWAYS on (vanilla biomes never set terrain). DO: start the battle.\n"
      + "EXPECT: Electric Terrain is active from turn 1 (the field glows; grounded\n"
      + "mons can't be put to sleep; Electric moves are boosted). It persists for\n"
      + "the whole biome, not 5 turns. Use the builder to also check GRASS/JUNGLE\n"
      + "(Grassy Terrain) and SPACE (Psychic Terrain).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.POWER_PLANT,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.PIKACHU, { moveset: [MoveId.SPLASH, MoveId.THUNDERBOLT] })];
    },
  },
  {
    label: "Biome identity: Desert sandstorm",
    description:
      "#439 §3 biome battle identity (GROUP A). Desert/Badlands have sandstorm as\n"
      + "a BASELINE (guaranteed on entry, not just a likely pool roll). DO: start.\n"
      + "EXPECT: a sandstorm is whipping from turn 1 and stays up the whole biome.\n"
      + "Builder check the other baselines too: ICE_CAVE/SNOWY_FOREST = snow,\n"
      + "GRAVEYARD = fog, BEACH = harsh-less sun.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.DESERT,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SANDILE,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GARCHOMP, { moveset: [MoveId.SPLASH, MoveId.EARTHQUAKE] })];
    },
  },
  {
    label: "Biome: Sea non-swimmer -1 Spd",
    description:
      "#439 §3 Group C. SEA saps non-swimmers (no Water/Flying type, no Levitate)\n"
      + "of 1 Speed stage WHEN THEY ENTER. DO: just start the battle.\n"
      + "EXPECT: turn 0, 'SNORLAX's Speed fell!' (Snorlax is a non-swimmer). A\n"
      + "Water/Flying mon or a Levitate mon would be exempt. Builder check SPACE\n"
      + "(STARTING_BIOME_OVERRIDE) too: there ALL grounded mons get -1 Spd on entry\n"
      + "AND -10% accuracy, with Psychic Terrain up.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.SEA,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH, MoveId.BODY_SLAM] })];
    },
  },
  {
    label: "Biome: Swamp bog chip",
    description:
      "#439 §3 Group E. SWAMP attrition: grounded non-Poison/Steel mons lose 1/16\n"
      + "max HP at the END of every turn (Magic Guard exempts). DO: use Splash and\n"
      + "watch the turn end. EXPECT: 'SNORLAX is sapped by the bog!' and ~6% HP lost\n"
      + "each turn. A Poison, Steel, or Flying/Levitate (ungrounded) mon takes NO\n"
      + "chip - swap the starter to test the immunity.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.SWAMP,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH, MoveId.BODY_SLAM] })];
    },
  },
  {
    label: "Biome: Plains free run",
    description:
      "#439 §3 Group F. PLAINS open fields: fleeing ALWAYS succeeds. DO: pick Run\n"
      + "(Flee) on turn 1, repeatedly if you like. EXPECT: you escape every time,\n"
      + "even against a faster wild mon (vanilla flee can fail on a speed deficit).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 5,
        STARTING_BIOME_OVERRIDE: BiomeId.PLAINS,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.NINJASK, // very fast - vanilla flee would often fail
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SLOWPOKE, { moveset: [MoveId.SPLASH, MoveId.TACKLE] })];
    },
  },
  {
    label: "Biome: Fairy Cave - no infatuation",
    description:
      "#439 §3 Group F. FAIRY CAVE blessing: your fielded mons CANNOT be infatuated,\n"
      + "and sleep wears off a turn faster. DO: let the enemy use Attract (it leads\n"
      + "with it). EXPECT: Attract FAILS - no '...fell in love!' / infatuation; your\n"
      + "mon acts freely every turn. (Outside Fairy Cave the same Attract would\n"
      + "infatuate.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.FAIRY_CAVE,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GARDEVOIR,
        ENEMY_MOVESET_OVERRIDE: [MoveId.ATTRACT],
      });
      return [makeStarter(SpeciesId.GALLADE, { moveset: [MoveId.SPLASH, MoveId.PSYCHO_CUT] })];
    },
  },
  {
    label: "Biome: Mountain Flying+20%/-acc",
    description:
      "#439 §3 Group B. MOUNTAIN wind: Flying-type moves deal +20% (both sides) and\n"
      + "ALL moves take -5% accuracy. DO: open the move panel (R cycles to the Damage\n"
      + "Calc) and compare Air Slash here vs in a neutral biome - it should read ~20%\n"
      + "higher. EXPECT also slightly more misses across the board. Builder check\n"
      + "VOLCANO: Fire moves +20% AND a ~10% burn risk on grounded non-Fire entry;\n"
      + "CAVE: -10% accuracy unless a Flash/Illuminate ability is on the field.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_BIOME_OVERRIDE: BiomeId.MOUNTAIN,
        MOVESET_OVERRIDE: [MoveId.AIR_SLASH, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.STARAPTOR, { moveset: [MoveId.AIR_SLASH, MoveId.SPLASH] })];
    },
  },
  {
    label: "Biome: Abyss Dark +1 crit",
    description:
      "#439 §3 Group F. ABYSS: Dark-type attackers get +1 crit stage. DO: spam a\n"
      + "Dark move (Night Slash) and watch the crit rate - it should crit far more\n"
      + "often than the base 1/24 (one stage = ~1/8). Non-Dark moves are unaffected.\n"
      + "Statistical - take several swings to see it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_BIOME_OVERRIDE: BiomeId.ABYSS,
        MOVESET_OVERRIDE: [MoveId.NIGHT_SLASH, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.WEAVILE, { moveset: [MoveId.NIGHT_SLASH, MoveId.SPLASH] })];
    },
  },
  {
    label: "Biome: Jungle wild +2 levels",
    description:
      "#439 §3 encounter shape. JUNGLE overgrowth: WILD mons spawn +2 levels above\n"
      + "the normal wave level. DO: start (a wild battle), open the enemy's summary\n"
      + "and read its level - it should be ~2 higher than a same-wave wild elsewhere.\n"
      + "Trainer mons are unaffected (their levels come from the party template).\n"
      + "Builder check GRASS/TALL_GRASS: those DOUBLE the wild double-battle rate -\n"
      + "re-enter several wild waves and you'll see doubles roughly twice as often.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 20,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.JUNGLE,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GARCHOMP, { moveset: [MoveId.SPLASH, MoveId.EARTHQUAKE] })];
    },
  },
  {
    label: "Biome: Forest ambush (free turn)",
    description:
      "#439 §3 encounter shape. FOREST/SNOWY FOREST: ~20% of WILD encounters, the\n"
      + "foe gets a FREE turn-1 move before you act - UNLESS your lead outspeeds it.\n"
      + "This lead is a slow Munchlax (the fast wild Electrode outspeeds it), so the\n"
      + "ambush can fire. DO: start a few wild Forest waves. EXPECT: ~1 in 5, the\n"
      + "Electrode attacks ONCE for free before your first command. Swap the lead to\n"
      + "something faster than the foe and the ambush should never trigger.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_BIOME_OVERRIDE: BiomeId.FOREST,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ELECTRODE,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [makeStarter(SpeciesId.MUNCHLAX, { moveset: [MoveId.SPLASH, MoveId.BODY_SLAM] })];
    },
  },
  {
    label: "Biome: Island exotic spawns",
    description:
      "#439 §3 encounter shape. ISLAND (Elite/Hell only): wild spawns are biased\n"
      + "toward REGIONAL variants (Alolan/Galarian/etc) AND ER REDUX forms - 'exotic\n"
      + "imports'. DO: on Elite/Hell, walk several wild Island waves and check the\n"
      + "foes. EXPECT: noticeably more regionals + Redux-form mons than a normal\n"
      + "biome. On ACE/YOUNGSTER it stays PURE vanilla (no Redux, normal pool) -\n"
      + "switch difficulty to confirm the gate.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_BIOME_OVERRIDE: BiomeId.ISLAND,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GARCHOMP, { moveset: [MoveId.SPLASH, MoveId.EARTHQUAKE] })];
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
      + "never procs any of them. ALSO (#437): win and check the SHOP - the\n"
      + "guaranteed Copper Rod offer must show the COPPER-tinted claw icon\n"
      + "(it used to render untinted, like a plain Quick Claw).",
    shopItems: [modifierTypes.ER_COPPER_ROD],
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
    label: "Frostbite Orb vs Magma Armor",
    description:
      "Frostbite Orb must NOT proc frostbite on a MAGMA ARMOR holder (Magma Armor\n"
      + "grants freeze immunity, and ER frostbite is the freeze analog). Reported on\n"
      + "a Heatran with Magma Armor.\n"
      + "Your SLUGMA has Magma Armor and holds a Frostbite Orb; the Machamp also\n"
      + "holds one but has no immunity.\n"
      + "EXPECT: Slugma NEVER gains the FROST badge at turn end (orb blocked by\n"
      + "Magma Armor), while the Machamp DOES get frostbitten by its orb.",
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
        makeStarter(SpeciesId.SLUGMA, {
          abilityIndex: 0, // Magma Armor
          moveset: [MoveId.SPLASH, MoveId.LAVA_PLUME, MoveId.FLAMETHROWER, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.SPLASH, MoveId.CLOSE_COMBAT, MoveId.FACADE, MoveId.PROTECT],
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
    label: "(note) Redux dex crash + move-loop",
    description:
      "DATA / FLOW fixes - verify outside a forced battle:\n"
      + "1) POKEDEX CRASH: open the Pokedex and view Redux / ER-custom / mid-stage\n"
      + "forms (Monferno Redux, Flaaffy Redux 'Fluffbee', etc.). The ABILITIES,\n"
      + "EVOLUTION, and EGG-MOVE screens must open WITHOUT crashing (was 'show()\n"
      + "crashed: ...eggMoves / abilityAttr of undefined' for basically every Redux\n"
      + "mon). Root: starterId resolved to an id with no starterData entry.\n"
      + "2) INFINITE MOVE-LEARN LOOP: a mon hitting a 4-move learnset tier (Latios\n"
      + "lv37: Confusion / Dragon Rage / Power Swap / Guard Swap) no longer re-offers\n"
      + "the same moves forever (was a run-blocker). Root: a leaked MOVESET_OVERRIDE\n"
      + "made the 'already knows it' check read the override view, not the real\n"
      + "moveset; the dedup now reads the real moveset.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1 });
      return [
        makeStarter(SpeciesId.LATIOS, {
          moveset: [MoveId.PSYCHIC, MoveId.DRAGON_PULSE, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
      ];
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
      + "Then EXIT to title -> starter select -> Yanmega: the ability the\n"
      + "capsule switched it to is now UNLOCKED (selectable), not greyed.\n"
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
      + "obsidian-tinted party icon.\n"
      + "ALSO (#432): black shinies grant LUCK 5 - win and check the shop's\n"
      + "luck readout / reroll discount reflects 5 (normal shiny max is 3).",
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
    label: "Locked innate must stay OFF (#425)",
    description:
      "#425 - a LOCKED Overwhelm innate let Dragon moves hit Fairies.\n"
      + "Zekrom (Overwhelm NOT unlocked) vs Clefable.\n"
      + "DO: use Dragon Claw on Clefable.\n"
      + "EXPECT: 'It doesn't affect...' - NO damage. Fairy stays immune\n"
      + "to Dragon until Overwhelm is actually unlocked and enabled.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 20,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CLEFABLE,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ZEKROM, {
          moveset: [MoveId.DRAGON_CLAW, MoveId.THUNDERBOLT, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Wildbolt Storm: no miss in rain (#426)",
    description:
      "#426 report said Wildbolt Storm always misses in rain - it\n"
      + "verifies CORRECT here, so please confirm in-game.\n"
      + "DO: use Wildbolt Storm repeatedly (it sets rain itself).\n"
      + "EXPECT: once rain is up it NEVER misses (90% accuracy without\n"
      + "rain). If you ever see a miss IN RAIN, press Fail + Send Logs.",
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
        makeStarter(SpeciesId.ZEKROM, {
          moveset: [MoveId.WILDBOLT_STORM, MoveId.THUNDERBOLT, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Infatuation: ER stat cut (#427)",
    description:
      "#427 - ER infatuation replaces vanilla's 50% immobilize: the\n"
      + "infatuated mon ALWAYS acts but its Atk AND Sp.Atk are HALVED.\n"
      + "Your male Snorlax vs female Lopunny (Cute Charm).\n"
      + "DO: poke it with Tackle until Cute Charm infatuates you, note\n"
      + "Tackle's damage before vs after (about half), and confirm you\n"
      + "are NEVER 'immobilized by love' across many turns.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.LOPUNNY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_ABILITY_OVERRIDE: AbilityId.CUTE_CHARM,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.HYPER_VOICE, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Power of Alchemy: transmute (#429)",
    description:
      "#429 - ER Power of Alchemy transmutes opposing Berries on entry\n"
      + "(it had vanilla's copy-fainted-ally effect with the ER text).\n"
      + "Your Alolan Muk (Power of Alchemy) vs Snorlax holding berries.\n"
      + "DO: just enter the battle. EXPECT a 'transmuted ... Berries away'\n"
      + "message and the Snorlax has NO berries left (it never heals via\n"
      + "Sitrus). ALSO check the ability description reads the ER text.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ABILITY_OVERRIDE: AbilityId.POWER_OF_ALCHEMY,
      });
      return [
        makeStarter(SpeciesId.ALOLA_MUK, {
          moveset: [MoveId.TACKLE, MoveId.SLUDGE_BOMB, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Ogerpon Cornerstone audit (#391)",
    description:
      "#391 - Cornerstone Ogerpon full check (old report: dead Rockhard\n"
      + "Will innate + Ivy Cudgel not type-shifting; both verified fixed).\n"
      + "DO: open Ivy Cudgel's move info - EXPECT it reads ROCK type on\n"
      + "this form (Water/Fire on the other masks). Open the abilities\n"
      + "panel - EXPECT Rockhard Will listed as an innate. Use Power Gem\n"
      + "or Ivy Cudgel and sanity-check the Rock boost feels ~1.2x.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        STARTER_FORM_OVERRIDES: { [SpeciesId.OGERPON]: 3 },
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.OGERPON, {
          moveset: [MoveId.IVY_CUDGEL, MoveId.POWER_GEM, MoveId.LEAFAGE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Cloud push warn (#389)",
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
    label: "Biome Market preview (#440)",
    description:
      "#440 BIOME MARKET - x0 boss waves now OPEN A BESPOKE SHOP SCREEN (they\n"
      + "had none before - vanilla skips the item screen on boss waves). After\n"
      + "the wave-10 boss + reward popups, the MARKET opens: a full-screen BW\n"
      + "backdrop with a biome shopkeeper on the LEFT and a '<BIOME> MARKET'\n"
      + "banner up top - clearly NOT the vanilla potion shop. The priced row is\n"
      + "the biome's signature items + discounted-category picks + a wildcard.\n"
      + "NO healing items appear (healing stays the normal-wave shop's job).\n"
      + "DO: win this wave-10 fight, wait through the reward popups. EXPECT:\n"
      + "the market opens with the BW art; buy items REPEATEDLY - each buy\n"
      + "deducts money + applies the item and the shop STAYS OPEN (buy as much\n"
      + "as you can afford). Press B/Cancel to LEAVE: a Yes/No confirm now asks\n"
      + "'Are you sure you want to leave the market?' (so a stray Cancel does\n"
      + "not skip the shop). Pick No to return to the market; pick Yes to\n"
      + "continue to biome-select. The Abyss biome has NO market by design.\n"
      + "REGRESSION: the normal reward/shop screen must NOT list the market's\n"
      + "items - they used to leak into the vanilla shop row and be re-bought\n"
      + "unlimited times. Now only the dedicated market shows them.\n"
      + "#504: the market fires every 10 GLOBAL waves even INSIDE a long biome\n"
      + "(not only at the biome boundary), and it NEVER shows healing items no\n"
      + "matter which wave it opens on (the old bug fell through to the vanilla\n"
      + "potion row when it fired off a non-x0 boundary wave). You ALSO get a\n"
      + "full party HEAL on every 10th wave (mid-biome x0 waves heal here; biome-\n"
      + "change waves still heal on transition).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 10,
        STARTING_MONEY_OVERRIDE: 20000,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Curve/ghost/sprite (#419+)",
    description:
      "#419 - ELITE trainer mons now respect a per-wave BST ceiling (420 at\n"
      + "w1-20 up to 600 at w81-100, +40 on boss waves; legends banned before\n"
      + "w80). Violators devolve a stage or swap. CHECK: early Elite trainer\n"
      + "teams field basic/mid-stage mons, no wave-20 Kyogre. Hell unchanged.\n"
      + "#422 - new challenge GHOST TRAINERS (7 Favour): every trainer wave\n"
      + "is a ghost team when the pool has one, else a normal trainer.\n"
      + "#436 - wave 5 (the fixed Youngster/Lass battle) is now ALSO a ghost\n"
      + "in the challenge. CHECK: start a Ghost Trainers run, the wave-5\n"
      + "trainer is a ghost (player name + ghost music), not a Youngster.\n"
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
    label: "Wishiwashi Schooling form (#451)",
    description:
      "#451 - Schooling is a HP-gated FORM change (not an evolution): with the\n"
      + "Schooling ability and level >= 20, Wishiwashi is in School (big) form\n"
      + "above 1/4 HP and reverts to Solo form at or below 1/4 HP. CHECK: this\n"
      + "Wishiwashi (Lv30) starts in School form; chip it below 1/4 HP and it\n"
      + "should shrink back to Solo, then return to School when healed above 1/4.\n"
      + "If it stays stuck in School form, report it (Send Logs).",
    setup: () => {
      resetDevOverrides();
      O.STARTING_LEVEL_OVERRIDE = 30;
      O.ABILITY_OVERRIDE = AbilityId.SCHOOLING;
      return [
        makeStarter(SpeciesId.WISHIWASHI, {
          moveset: [MoveId.WATER_GUN, MoveId.TAKE_DOWN, MoveId.PROTECT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Grappler trap 1/6 HP (#454)",
    description:
      "#454 - Grappler (ER 523) trapping moves now deal 1/6 max HP per turn\n"
      + "(was 1/8) and last 6 turns. CHECK: this Snorlax has Grappler + Wrap;\n"
      + "use Wrap on the foe and watch the end-of-turn chip - it should take\n"
      + "~16.7% of the foe's max HP each turn, not ~12.5%.",
    setup: () => {
      resetDevOverrides();
      O.ABILITY_OVERRIDE = erAbility(523); // Grappler
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.WRAP, MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Restraining Order force-out (#452)",
    description:
      "#452 - Restraining Order (Gooschase sig, ER ability 690) + Chuckster\n"
      + "(864) now force the ATTACKER out when the holder is hit, once per\n"
      + "switch-in - NOT the holder (the old wire acted like Wimp Out). CHECK:\n"
      + "this Snorlax has Restraining Order; vs a TRAINER (has back-up mons),\n"
      + "let the foe hit you - the ATTACKER should be dragged out, you stay in.\n"
      + "It fires only once per send-out.",
    setup: () => {
      resetDevOverrides();
      O.ABILITY_OVERRIDE = erAbility(690); // Restraining Order
      O.STARTING_WAVE_OVERRIDE = 5; // a trainer battle (foe has switch targets)
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Ability Capsule + evo (#445)",
    description:
      "#445 - Ability Capsule no longer leaves a wasted active ability that\n"
      + "duplicates an innate after evolution. If the capsule-set active ability\n"
      + "becomes an innate on the evolved form, it is dropped (active re-derives\n"
      + "to a distinct ability, innate kept) and the capsule re-arms so you can\n"
      + "re-pick. CHECK: capsule a pre-evo to an ability its evolved form has as\n"
      + "an INNATE, evolve - the active should change (not double the innate) and\n"
      + "the capsule should be usable again on the evolved mon.",
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
    label: "(note) Ability-boost move flags (#449/#453)",
    description:
      "#449/#453 - move flags now derive from the ER 2.65 dex 'X boost' text\n"
      + "(authoritative), fixing moves that shipped with no flags. Affects ALL\n"
      + "ability-boost families: Keen Edge (slicing, e.g. Dire Claw), Mega\n"
      + "Launcher (pulse), Iron Fist (punch), Strong Jaw (bite), Mighty Horn,\n"
      + "Striker (kick), Archer (arrow). CHECK: Dire Claw + Sweeping Edge/\n"
      + "Sharpness never-miss + 1.5x; a Mega Launcher / Iron Fist / Strong Jaw\n"
      + "mon now boosts the right moves. Kicks use Roundhouse, not Sweeping Edge.",
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
    label: "ER Wind Rider higher atk (#496)",
    description:
      "#496 - ER Wind Rider raises whichever ATTACKING stat is higher (Atk vs\n"
      + "SpAtk), not always physical Attack. Player Gardevoir (SpAtk >> Atk) has\n"
      + "Wind Rider forced; the enemy spams Gust (a wind move).\n"
      + "EXPECT: Gust is absorbed (no damage) and Gardevoir's SP. ATK rises +1 each\n"
      + "time (NOT its Attack). Also applies to the Tailwind-on-entry boost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: AbilityId.WIND_RIDER,
        ENEMY_MOVESET_OVERRIDE: [MoveId.GUST],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.PIDGEOT,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER Accelerate instant charge (#449)",
    description:
      "#449 - ER Accelerate ('Moves that need a charge turn are now used instantly')\n"
      + "now actually skips the charge turn (was a no-op). Player has Accelerate forced\n"
      + "and Solar Beam + Fly in its moveset.\n"
      + "EXPECT: Solar Beam and Fly both fire the SAME turn (no charge/semi-invuln turn),\n"
      + "every time, with no item needed (same skip Power Herb does).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.ACCELERATE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SOLAR_BEAM, MoveId.FLY, MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN],
        }),
      ];
    },
  },
  {
    label: "ER Aegislash stance swap (#480)",
    description:
      "#480 - Redux Aegislash's Stance Change is an INNATE (not the active ability),\n"
      + "which was being candy/level gated, so the form never switched ('stuck'). It\n"
      + "is now treated as a form-change driver, so the swap is never locked out, and\n"
      + "it swaps by MOVE CATEGORY per the 2.65 dex: physical -> Axe ('blade' form),\n"
      + "special / King's Shield / switch-out -> Bow ('shield' form).\n"
      + "Aegislash here is a FRESH starter (Stance Change innate NOT unlocked).\n"
      + "EXPECT: starts as Bow (shield). Iron Head (physical) -> switches to Axe (blade)\n"
      + "sprite. Shadow Ball (special) -> back to Bow. King's Shield -> Bow. Every time.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
      });
      return [
        makeStarter(SpeciesId.AEGISLASH, {
          moveset: [MoveId.IRON_HEAD, MoveId.SHADOW_BALL, MoveId.KINGS_SHIELD, MoveId.SACRED_SWORD],
        }),
      ];
    },
  },
  {
    label: "ER Cloud Nine clears weather (#450)",
    description:
      "#450 - per the 2.65 dex, ER Cloud Nine CLEARS all weather on switch-in (not\n"
      + "just nullifies its effects like vanilla). Both player mons have Cloud Nine\n"
      + "forced; the enemy has Drizzle (sets Rain on entry).\n"
      + "EXPECT: the Rain weather indicator is CLEARED entirely (gone, not just 'no\n"
      + "effect'). Switch your other Cloud Nine mon in - if Rain was re-set it is\n"
      + "cleared again on entry. Any weather set while a Cloud Nine mon is out also\n"
      + "gives NO damage boost / ability triggers (suppressed).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: AbilityId.CLOUD_NINE,
        ENEMY_ABILITY_OVERRIDE: AbilityId.DRIZZLE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.PELIPPER,
      });
      return [
        makeStarter(SpeciesId.GOLDUCK, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.LICKILICKY, {
          moveset: [MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Castform Foggy form (#450)",
    description:
      "#450 - ER added Fog as a real weather and a matching Foggy (Ghost-type)\n"
      + "Castform form. Forecast Castform is forced; the battle starts in Fog.\n"
      + "EXPECT: Castform takes its FOGGY form (Ghost type, the castform_foggy ER\n"
      + "sprite - not Normal form, not a placeholder). Use Sunny Day -> Sunny (Fire)\n"
      + "form; Rain Dance -> Rainy (Water); back to fog (e.g. via a fog setter or\n"
      + "switch) -> Foggy again. Reverts to Normal when weather clears / on switch-out.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        WEATHER_OVERRIDE: WeatherType.FOG,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
      });
      return [
        makeStarter(SpeciesId.CASTFORM, {
          moveset: [MoveId.WEATHER_BALL, MoveId.SUNNY_DAY, MoveId.RAIN_DANCE, MoveId.SHADOW_BALL],
        }),
      ];
    },
  },
  {
    label: "ER Raging Storm in rain (#452)",
    description:
      "#452 - Primal Kyogre's Raging Storm: 'Ups highest attacking stat by 1.5x in\n"
      + "rain.' Kyogre (SpAtk >> Atk) has Raging Storm forced; battle starts in Rain.\n"
      + "EXPECT: its SP. ATK is multiplied 1.5x while it's raining (special moves hit\n"
      + "~50% harder); in clear weather, no boost. Picks whichever attack stat is\n"
      + "higher, so it boosts SP. ATK here (not Attack).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.RAGING_STORM),
        WEATHER_OVERRIDE: WeatherType.RAIN,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
      });
      return [
        makeStarter(SpeciesId.KYOGRE, {
          moveset: [MoveId.ORIGIN_PULSE, MoveId.ICE_BEAM, MoveId.THUNDER, MoveId.CALM_MIND],
        }),
      ];
    },
  },
  {
    label: "ER Roar of Time rework (#452)",
    description:
      "#452 - Roar of Time is reworked per the 2.65 dex: 90 BP, 100 acc, 10 PP,\n"
      + "priority -6 (MOVES LAST), forces the target to switch, and NO recharge\n"
      + "(was vanilla 150 BP + recharge turn). Temporal Rupture is forced, so it ALSO\n"
      + "sets the target's ability to Slow Start on hit.\n"
      + "EXPECT: Dialga acts again next turn (no recharge), Roar of Time goes last,\n"
      + "and the target's ability becomes Slow Start. Best vs a multi-mon trainer to\n"
      + "see the forced switch.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.TEMPORAL_RUPTURE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
      });
      return [
        makeStarter(SpeciesId.DIALGA, {
          moveset: [MoveId.ROAR_OF_TIME, MoveId.FLASH_CANNON, MoveId.DRACO_METEOR, MoveId.CALM_MIND],
        }),
      ];
    },
  },
  {
    label: "ER Inverse Kecleon (#452)",
    description:
      "#452 - Kecleon's Inversion: 'Sets up Inverse Room on entry, lasts 3 turns.'\n"
      + "Inversion is forced on Kecleon.\n"
      + "EXPECT: on entry, Inverse Room is set (type chart inverted) for 3 turns -\n"
      + "normally-resisted/immune hits become super-effective and vice versa. Confirm\n"
      + "via a move that is normally weak/immune now landing super-effective.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.INVERSION),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
      });
      return [
        makeStarter(SpeciesId.KECLEON, {
          moveset: [MoveId.SHADOW_SNEAK, MoveId.POWER_UP_PUNCH, MoveId.SUCKER_PUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER Restraining Order / Gooschase (#452)",
    description:
      "#452 - Restraining Order (Gooschase line): 'Forces the ATTACKER out when hit,\n"
      + "once each switch-in' - NOT Wimp Out (which switches the holder out). Forced\n"
      + "on the player; the enemy is a multi-mon trainer that attacks.\n"
      + "EXPECT: when the holder is hit by a move, the ATTACKER (not the holder) is\n"
      + "forced to switch out, once per the holder's switch-in.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.RESTRAINING_ORDER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.CRUNCH],
        }),
      ];
    },
  },
  {
    label: "ER Smokescreen smoke field (#394)",
    description:
      "#394 - ER Smokescreen no longer lowers the target's accuracy. Instead it\n"
      + "'obscures the user's party in smoke for 5 turns, increasing evasiveness by\n"
      + "25%.' Use Smokescreen turn 1.\n"
      + "EXPECT: 'Smoke billowed across the field...' message; for the next 5 turns the\n"
      + "ENEMY's moves miss noticeably more often (your whole side has +25% evasion,\n"
      + "i.e. incoming accuracy x0.8). Switching in your other mon keeps the buff (it's\n"
      + "side-wide). After 5 turns 'The smoke cleared away.' and accuracy is normal.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
      });
      return [
        makeStarter(SpeciesId.KOFFING, {
          moveset: [MoveId.SMOKESCREEN, MoveId.SLUDGE_BOMB, MoveId.PROTECT, MoveId.PAIN_SPLIT],
        }),
        makeStarter(SpeciesId.PIDGEOT, {
          moveset: [MoveId.AIR_SLASH, MoveId.ROOST, MoveId.PROTECT, MoveId.HURRICANE],
        }),
      ];
    },
  },
  {
    label: "(note) No custom evo on vanilla (#479)",
    description:
      "#479 - on the PURE-VANILLA difficulties (Youngster / Ace) a wild vanilla\n"
      + "mon must never EVOLVE into its ER custom final stage. A high-wave wild\n"
      + "Kecleon was being substituted into the custom 'Kecleong' (cost 12).\n"
      + "Root cause: arena.randomSpecies' level-evolution substitution re-gated only\n"
      + "by BST, not by custom-id. Now: on a vanilla difficulty, a custom (id >=\n"
      + "10000) evolution is skipped and the vanilla stage is kept (Elite/Hell keep\n"
      + "custom evolutions). CHECK (no forced-spawn override exists - the override\n"
      + "bypasses the evo path): play a YOUNGSTER run to a high wave in a biome with\n"
      + "a Kecleon-line spawn and confirm NO ER custom ('Kecleong', any Redux/\n"
      + "paradox name) ever appears as a WILD; only vanilla mons spawn.",
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
    label: "(note) Ability screen crash (#443)",
    description:
      "#443 - the Pokemon Info / summary ABILITIES screen no longer hard-\n"
      + "crashes or renders garbled for edge-case mons (reported on a freshly-\n"
      + "evolved Gholdengo and on Bloodmoon Ursaluna). The render is now\n"
      + "guarded: a bad row is skipped and logged instead of killing the page.\n"
      + "CHECK: evolve a Gimmighoul to Gholdengo and open its abilities; open\n"
      + "Bloodmoon Ursaluna's abilities - both should display, not crash. If a\n"
      + "row is missing, press Send Logs so the underlying cause is captured.",
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
    label: "(note) Evo cancel freeze (#444)",
    description:
      "#444 - cancelling an evolution no longer freezes the game. The UI was\n"
      + "left stuck in the evolution scene when the player declined; it now\n"
      + "hands control back like a normal completed/failed evolution.\n"
      + "CHECK: bring an Eevee to a level where it can evolve (its branched-\n"
      + "evolution PICK list appears post-battle), choose Cancel - you should\n"
      + "return to the field/party normally, not a black screen. Same for\n"
      + "pressing B to stop any single-path evolution mid-animation.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.EEVEE, {
          moveset: [MoveId.QUICK_ATTACK, MoveId.BITE, MoveId.SWIFT, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Event intro sprites (#490)",
    description:
      "#490 - ER mystery events no longer all reuse the blue chest sprite for\n"
      + "their intro art. Each now shows a thematic Pokemon: e.g. Fairy's Boon =\n"
      + "Clefable, Still Waters = Milotic, Glittering Vein = Carbink, Abyssal\n"
      + "Vent = Lanturn, Overgrown Temple = Cradily, Tide Pools = Corsola, Lake\n"
      + "Spirit = Uxie, Observatory = Lunatone, Echo Chamber = Noibat, Informant\n"
      + "= Nickit, The Storm = Pelipper, Ultra Wormhole = Cosmog, Sunken Vessel\n"
      + "= Dhelmise, X Marks the Spot = Gimmighoul, Aurora = Cryogonal, etc.\n"
      + "CHECK: trigger these ER events (delve/map/blessing events) - the intro\n"
      + "should be the themed mon, not the generic chest. (The Exotic Trader and\n"
      + "Black Market keep theirs until their shop rework lands.)",
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
    label: "(note) Unown egg hatch (#442)",
    description:
      "#442 - Unown REVELATION (the battle-only school form) no longer\n"
      + "hatches from eggs or appears as a wild Unown's resting form. The\n"
      + "form is only reachable in battle via the Revelation ability.\n"
      + "CHECK: hatch Unown eggs / catch wild Unown - always a letter form\n"
      + "(A-Z, ! or ?), never the big multi-Unown school sprite. Already-\n"
      + "hatched Revelation Unown from before the fix are unaffected.",
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
    label: "(note) Delve ward/berry finds (#491)",
    description:
      "#491 - the delve press-your-luck events (Abyssal Vent, Glittering Vein,\n"
      + "Overgrown Temple) now turn up WARD STONES and RESIST BERRIES, with a\n"
      + "find chance that climbs DRASTICALLY the deeper you push. Shallow strikes\n"
      + "never yield them; deep strikes very often do (Ward Stone ~0/0/15/30/45/\n"
      + "60% by depth, tier Minor->Greater->Prime; resist berry ~0/12/24/38/52/\n"
      + "68%). Found items bank into the cash-in shop on RISE/PACK UP.\n"
      + "CHECK: dive these events deep (push 4+ levels) and bank - the reward\n"
      + "shop should include Ward Stones / resist berries far more often than a\n"
      + "shallow dive. They are lost on a party wipe like the rest of the haul.",
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
    label: "(note) Berry/Ward rates (#420)",
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
    label: "(note) No Ace redux wilds (#421)",
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
    label: "(note) No mega transforms (#414)",
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
  {
    label: "Cross Chop: 2 hits + high crit",
    description:
      "Community report - Cross Chop should be TWO 40BP hits with a high crit\n"
      + "ratio (ER 2.65 dex), not the vanilla single 100BP hit.\n"
      + "DO: select Cross Chop against the Snorlax (tanky, survives a turn).\n"
      + "EXPECT: the move strikes TWICE in one turn (two damage numbers), each\n"
      + "hit ~40BP, and crits often (high critical-hit ratio). 100% acc, 15 PP.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.CROSS_CHOP, MoveId.PROTECT, MoveId.BULK_UP, MoveId.DETECT],
        }),
      ];
    },
  },
  {
    label: "Clobbopus evolves at lv24 (no Taunt)",
    description:
      "Community report - Clobbopus would not evolve by level because it kept a\n"
      + "vanilla 'knows Taunt' gate. ER 2.65 dex = plain level-24 evolution.\n"
      + "DO: this Clobbopus starts at level 23 and does NOT know Taunt. Win a\n"
      + "battle so it reaches level 24.\n"
      + "EXPECT: it evolves into Grapploct on hitting level 24 with no Taunt\n"
      + "requirement. (note) Pure data fix - if it evolves, pass.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 23,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CLOBBOPUS, {
          moveset: [MoveId.BRUTAL_SWING, MoveId.DETECT, MoveId.ROCK_SMASH, MoveId.BIND],
        }),
      ];
    },
  },
  {
    label: "Mind Reader = SpDef protect",
    description:
      "ER 2.65 dex - Mind Reader is no longer a lock-on. It is now a King's\n"
      + "Shield-style PROTECT (priority +4, Psychic, Status, self): it dodges ALL\n"
      + "attacks and, on CONTACT, drops the ATTACKER's Special Defense by 1 stage.\n"
      + "May fail if used in succession.\n"
      + "DO: your Alakazam uses Mind Reader; the enemy Rattata uses Tackle (a\n"
      + "CONTACT move) into it.\n"
      + "EXPECT: Tackle is BLOCKED (Alakazam takes 0 damage / 'protected itself')\n"
      + "AND the enemy Rattata's Sp. Def falls by 1 stage. (Use Battle Info / the\n"
      + "stat arrows to confirm the -1 SpDef on the enemy.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.MIND_READER, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [makeStarter(SpeciesId.ALAKAZAM, { moveset: [MoveId.MIND_READER, MoveId.SPLASH] })];
    },
  },
  {
    label: "Drifloon move list: no duplicates",
    description:
      "Community report - the move-swap list showed Psycho Shift TWICE (and a\n"
      + "long list). Drifloon has Psycho Shift in BOTH its ER level-up learnset\n"
      + "and its egg moves; the swap list was not de-duplicated.\n"
      + "DO: win the opening battle, take the Move Slot Expander from the shop, use\n"
      + "it on Drifloon, and open the move-to-learn list.\n"
      + "EXPECT: every move appears exactly ONCE (Psycho Shift listed a single\n"
      + "time). The list being long is fine - that is Drifloon's full ER movepool;\n"
      + "the bug was the duplicate. (note) Pure UI/data fix.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.DRIFLOON, {
          moveset: [MoveId.SHADOW_BALL, MoveId.CALM_MIND, MoveId.GUST, MoveId.THUNDERBOLT],
        }),
      ];
    },
    shopItems: [modifierTypes.MOVE_SLOT_EXPANDER],
  },
  {
    label: "Pichu line: candy + passives pool to root",
    description:
      "Community report - evolving a Pichu showed Pikachu/Raichu passives\n"
      + "'Locked' and candy split across stages (Pichu 26 / Pikachu 0 / Raichu 98).\n"
      + "Cause: candy + passive unlocks keyed by different species ids across the\n"
      + "line (Pichu AND Pikachu are both starters). Now everything pools to the\n"
      + "line root, and a one-time load migration merges historic scatter.\n"
      + "DO: this Pichu starts at lv24; win the opening battle so it evolves to\n"
      + "Pikachu, take the Rare Candy from the shop to push it toward Raichu, and\n"
      + "open Pokemon Info > Abilities at each stage.\n"
      + "EXPECT: the candy count is the SAME pooled total at every stage, and any\n"
      + "passive you unlocked stays Unlocked through both evolutions. (note) Save-\n"
      + "data fix - existing saves consolidate on load with no candy lost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 24,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PICHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.NUZZLE, MoveId.QUICK_ATTACK, MoveId.PROTECT],
        }),
      ];
    },
    shopItems: [modifierTypes.RARE_CANDY],
  },
  {
    label: "ER #486: World Map overlay",
    description:
      "Phase D Map system, increment 3 - the read-only World Map overlay.\n"
      + "DO: start this scenario. On the first turn it reveals a handful of sample\n"
      + "map nodes + 2 Treasure-Map fragments, then opens the World Map overlay\n"
      + "automatically. Scroll the list with Up/Down; press B (or the action\n"
      + "button) to close it and return to the battle.\n"
      + "EXPECT: a centred 'World Map' card listing the revealed nodes (label, biome\n"
      + "name, and a [Route]/[Landmark]/[Treasure] tag), a 'Treasure-Map Fragments:\n"
      + "2 / 3' line, the cursor highlighting the selected row and scrolling when\n"
      + "the list runs past 6 entries, and a clean close back to combat. (note) UI-\n"
      + "only; revealed nodes also persist across save/load (see er-map-nodes test).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.PROTECT, MoveId.IRON_TAIL],
        }),
      ];
    },
    onBattleStart: () => {
      // Seed a clean, recognisable map state, then pop the overlay.
      resetErMapNodes();
      revealMapNodes([
        { biome: BiomeId.SEA, label: "Distant Isle", kind: "biome" },
        { biome: BiomeId.SPACE, label: "The Observatory", kind: "landmark" },
        { biome: BiomeId.BEACH, label: "Buried Cache", kind: "treasure" },
        { biome: BiomeId.LAKE, label: "Quiet Lake", kind: "biome" },
        { biome: BiomeId.CAVE, label: "Echoing Cavern", kind: "landmark" },
        { biome: BiomeId.JUNGLE, label: "Overgrown Temple", kind: "landmark" },
        { biome: BiomeId.VOLCANO, label: "Smoking Crater", kind: "biome" },
      ]);
      addTreasureFragments(2);
      openErMapOverlay();
    },
  },
  {
    label: "ER #486: Message in a Bottle",
    description:
      "Phase D map event - a Sea bottle that grants a Treasure-Map fragment and\n"
      + "charts nearby routes. Starts you with 2 fragments seeded.\n"
      + "DO: on wave 12 (SEA) the bottle spawns. Choose 'Open the bottle'. Then press\n"
      + "M to open the World Map.\n"
      + "EXPECT: a message confirming a fragment + chart; the World Map now shows\n"
      + "'Treasure-Map Fragments: 3 / 3' and lists the onward routes as [Route] nodes.\n"
      + "(note) With 3 fragments, the Beach 'X Marks the Spot' dig now pays out.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEA,
        ER_TREASURE_FRAGMENTS_OVERRIDE: 2,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_MESSAGE_IN_A_BOTTLE,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: X Marks the Spot (dig)",
    description:
      "Phase D map payout - the Beach buried-cache event. Starts you with 3\n"
      + "Treasure-Map fragments seeded (press J before choosing to confirm 3 / 3).\n"
      + "DO: on wave 12 (BEACH) choose 'Dig at the X'.\n"
      + "EXPECT: a 'buried cache' message, then a reward selection of solid items\n"
      + "(Rogue / Ultra / Great tier). After taking the reward, press J: the fragment\n"
      + "count is back to 0 / 3 (the three were spent). 'Scratch around' instead would\n"
      + "add one fragment; 'Walk the shoreline' just leaves.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.BEACH,
        ER_TREASURE_FRAGMENTS_OVERRIDE: 3,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_X_MARKS_THE_SPOT,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: The Observatory (reveal)",
    description:
      "Phase D reveal event (Space). DO: on wave 12 choose 'Chart the heavens',\n"
      + "then press J.\n"
      + "EXPECT: the World Map lists the onward routes as [Route] nodes plus 'The\n"
      + "Observatory' as a [Landmark]. 'Leave' just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SPACE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_OBSERVATORY,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: Echo Chamber (reveal)",
    description:
      "Phase D reveal event (Cave). DO: on wave 12 choose 'Listen to the echoes',\n"
      + "then press J.\n"
      + "EXPECT: the World Map lists the onward routes as [Route] nodes. 'Move on'\n"
      + "just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_ECHO_CHAMBER,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: The Informant (reveal + fragment)",
    description:
      "Phase D reveal event (Slum), money-gated. Starts with 50000 money.\n"
      + "DO: on wave 12 choose 'Buy the tip' (greyed if you cannot afford it), then\n"
      + "press J.\n"
      + "EXPECT: money drops by the fee; the World Map shows the onward [Route] nodes\n"
      + "and the fragment count went up by 1. 'Walk on' just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SLUM,
        STARTING_MONEY_OVERRIDE: 50000,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_INFORMANT,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: The Storm (travel)",
    description:
      "Phase D travel event (Sea). DO: on wave 12 choose 'Brave the storm'.\n"
      + "EXPECT: a 'swept off-course' message. The travel target is set - at the NEXT\n"
      + "biome transition (wave 20) the run jumps to that destination instead of the\n"
      + "normal choice. 'Turn back' sets no travel. (note) the jump is verified at the\n"
      + "biome boundary, so play on to wave 20 to confirm the destination.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEA,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_THE_STORM,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: Ultra Wormhole (travel)",
    description:
      "Phase D travel event (Space). DO: on wave 12 choose 'Step through'.\n"
      + "EXPECT: a 'flung onward' message. Like The Storm, the next biome transition\n"
      + "(wave 20) is forced to the chosen destination. 'Back away' sets no travel.\n"
      + "(note) verify the jump at the wave-20 biome boundary.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SPACE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_ULTRA_WORMHOLE,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: Lost Wanderer (reveal + fragment)",
    description:
      "Phase D reveal event (Plains). DO: on wave 12 choose 'Point the way', then\n"
      + "press J.\n"
      + "EXPECT: the World Map shows the onward [Route] nodes and the fragment count\n"
      + "went up by 1. 'Leave them be' just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.PLAINS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_LOST_WANDERER,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: Sunken Vessel (reveal + fragment)",
    description:
      "Phase D reveal event (Seabed). DO: on wave 12 choose 'Scout the wreck', then\n"
      + "press J.\n"
      + "EXPECT: the World Map shows the onward [Route] nodes and the fragment count\n"
      + "went up by 1. 'Drift on' just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEABED,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SUNKEN_VESSEL,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "(note) ER #486: World Map core (length / crossroads / picker)",
    description:
      "#486 World Map CORE (dev/staging only, classic non-daily). Three new pieces\n"
      + "to verify across a real run with this strong team:\n"
      + "1) VARIABLE BIOME LENGTH - biomes are no longer a fixed 10 waves. Each biome\n"
      + "   rolls a length in [7, 25] waves (#504; biased long, most rolls clear 10),\n"
      + "   re-rolled on every biome entry. The roll is a HARD cap. Two runs of the\n"
      + "   same biome should differ.\n"
      + "2) CROSSROADS - every 5 waves spent in a biome (after the reward, not on the\n"
      + "   biome's final wave), a 'Stay / Move on' prompt appears. STAY keeps going;\n"
      + "   MOVE ON ends the biome now and opens the map picker.\n"
      + "3) VISUAL MAP PICKER - leaving a biome (forced end OR Move on) shows a\n"
      + "   BRANCHING map screen (origin node on the left, destination biomes\n"
      + "   branching right with route lines; gated nodes show as '???'), NOT the old\n"
      + "   plain text list. Up/Down picks a revealed route, A travels.\n"
      + "CHECK: play several biomes. Lengths vary; the biome SHOP + heal/interest\n"
      + "still bookend each biome (no double or missing shop); the J overlay still\n"
      + "shows onward routes. FINALE SAFETY (most important): from wave ~170 on,\n"
      + "biomes revert to the vanilla 10-wave cadence and the END biome must enter\n"
      + "at wave 191 with the wave-200 finale exactly as vanilla. Save+reload\n"
      + "mid-biome must keep the SAME boundary (no skipped/repeated transition). If\n"
      + "anything desyncs near the finale, press Send Logs.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 100,
        STARTING_BIOME_OVERRIDE: BiomeId.PLAINS,
      });
      return [
        makeStarter(SpeciesId.MEWTWO, {
          moveset: [MoveId.PSYSTRIKE, MoveId.ICE_BEAM, MoveId.AURA_SPHERE, MoveId.RECOVER],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GHOLDENGO, {
          moveset: [MoveId.MAKE_IT_RAIN, MoveId.SHADOW_BALL, MoveId.NASTY_PLOT, MoveId.RECOVER],
        }),
      ];
    },
  },
  {
    label: "ER #504: Biome Notoriety (overstay)",
    description:
      "#504 biome NOTORIETY / overstay escalation (dev/staging only, classic\n"
      + "non-daily). This run STARTS deep inside a biome (wave 18 = 8 waves OVER the\n"
      + "10-wave free window) so notoriety is ALREADY in effect on the opening\n"
      + "battle. The first 10 in-biome waves run the GLOBAL curve unchanged; past 10\n"
      + "the place turns hostile, escalating with each extra wave (LOCAL to this\n"
      + "biome only).\n"
      + "DO: fight on in this biome (choose the Stay verb at each Crossroads). Watch\n"
      + "the next several waves.\n"
      + "EXPECT: a one-time 'you are gaining notoriety' warning the first time you\n"
      + "pass 10 waves in a biome (already shown if you keep staying here). Bosses\n"
      + "and trainers come far more often (roughly every 2-3 waves, climbing toward\n"
      + "EVERY wave by ~wave 20 in-biome). Enemy BST climbs above the normal cap (up\n"
      + "to +100 by ~wave 20 in-biome, then holds), enemy LEVELS run over the normal\n"
      + "cap, and enemies hold more resist berries / ward stones / held items. The\n"
      + "biome still HARD-ENDS at its rolled cap (max 25 waves) even if you keep\n"
      + "staying. CRITICAL: when you LEAVE this biome (Move on, or the cap ends it),\n"
      + "notoriety RESETS - the very next biome drops back to the NORMAL global curve\n"
      + "(no inflated BST/level/boss-rate carried over). If overstay inflation leaks\n"
      + "into the next biome, that is the bug - press Send Logs.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("elite");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 18,
        STARTING_BIOME_OVERRIDE: BiomeId.CAVE,
      });
      return [
        makeStarter(SpeciesId.MEWTWO, {
          moveset: [MoveId.PSYSTRIKE, MoveId.ICE_BEAM, MoveId.AURA_SPHERE, MoveId.RECOVER],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GHOLDENGO, {
          moveset: [MoveId.MAKE_IT_RAIN, MoveId.SHADOW_BALL, MoveId.NASTY_PLOT, MoveId.RECOVER],
        }),
      ];
    },
  },
  {
    label: "(note) Pokedex Editor overrides",
    description:
      "Editor feature - the er-editor 'Learnsets / TMs / Abilities' tabs now\n"
      + "write per-species overrides (er-learnsets.json / er-tm-learnsets.json /\n"
      + "er-species-abilities.json) that the game applies LAST at init, on top of\n"
      + "every other pass. The loader is FAIL-SAFE: bad ids are dropped, unmapped\n"
      + "species skipped, and it can only no-op on error (never crashes a run).\n"
      + "With NO override committed, the dex is unchanged.\n"
      + "CHECK (after committing an edit in the editor + a staging redeploy): the\n"
      + "edited species shows the new level-up learnset (catch/hatch it and check\n"
      + "its moves), the new TM-learnable moves (starter-select / TM rewards), and\n"
      + "the new ability slots (summary ABILITIES screen). Console logs an\n"
      + "[er-pokedex-overrides] summary line. If anything is off, press Send Logs.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.VOLT_SWITCH, MoveId.GRASS_KNOT, MoveId.NUZZLE],
        }),
      ];
    },
  },
  {
    label: "Hell AI: smarter move pick (Slice 1)",
    description:
      "Slice 1 of the smarter Elite/Hell AI. On HELL, trainer/boss enemies now\n"
      + "score moves by REAL simulated damage vs your mon's actual bulk (accuracy-\n"
      + "weighted, with a big bonus for a guaranteed KO) instead of the old power x\n"
      + "type-effectiveness proxy, and they NEVER deliberately throw - they always\n"
      + "use their best-scored move (sharpness 1 on Hell).\n"
      + "DO: fight this Hell boss Tyranitar a few turns, then press Send Logs. The\n"
      + "console prints 'Move Pool', 'Move Scores' and 'Chosen Move' each enemy\n"
      + "turn; the CHOSEN move should always be the TOP score, and a guaranteed-KO\n"
      + "move should dominate (huge score). On Ace/Youngster and vs wild mons the\n"
      + "old behavior is unchanged - switch difficulty to confirm.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.TYRANITAR,
        ENEMY_HEALTH_SEGMENTS_OVERRIDE: 2, // force a boss so the AI profile is active
        ENEMY_MOVESET_OVERRIDE: [MoveId.CRUNCH, MoveId.STONE_EDGE, MoveId.EARTHQUAKE, MoveId.LOW_KICK],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "(note) Hell AI: smarter switching (Slice 2)",
    description:
      "Slice 2 of the smarter Elite/Hell AI - switching. On Elite/Hell, trainer\n"
      + "switch decisions now use a BEST-MOVE matchup (the strongest damaging move\n"
      + "vs you, not the diluted average of all moves), a LOWER switch threshold\n"
      + "(Hell 1.5 / Elite 2.0 vs vanilla 2/3) so they swap to a real counter more\n"
      + "readily, and forced/faint replacements are now HAZARD-AWARE (the AI no\n"
      + "longer sends a Stealth-Rock-weak mon into its own hazards after a KO).\n"
      + "DO: play a Hell TRAINER fight (set Rocks/Spikes on the enemy side if you\n"
      + "can). EXPECT the AI to pivot to type counters and to avoid bringing a\n"
      + "4x-hazard-weak mon in after a faint. Switch to Ace to confirm the old\n"
      + "behavior. Press Send Logs if a switch looks wrong.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 11 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STEALTH_ROCK, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE],
        }),
      ];
    },
  },
  {
    label: "(note) Hell AI: setup + hazards (Slice 3)",
    description:
      "Slice 3 of the smarter Elite/Hell AI - field & strategy. On Elite/Hell the\n"
      + "AI now: (1) refuses to use a SETUP move (Swords Dance, etc.) while frail\n"
      + "(<45% HP / about to be KO'd) and is willing to set up when healthy; (2)\n"
      + "values ENTRY HAZARDS (Rocks/Spikes) when you still have a bench to punish\n"
      + "and none are up yet - and won't waste a turn re-setting one that's already\n"
      + "down or when you're on your last mon.\n"
      + "DO: bring a FULL party vs a Hell boss/trainer that has a hazard or setup\n"
      + "move. EXPECT it to lay hazards early (full bench) but not re-lay them, and\n"
      + "to set up only when it's healthy, not at low HP. Send Logs if it sets up\n"
      + "while nearly fainted or re-lays a hazard.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 11 });
      return [
        makeStarter(SpeciesId.DRAGONITE, {
          moveset: [MoveId.DRAGON_DANCE, MoveId.EARTHQUAKE, MoveId.STEALTH_ROCK, MoveId.EXTREME_SPEED],
        }),
        makeStarter(SpeciesId.METAGROSS, {
          moveset: [MoveId.METEOR_MASH, MoveId.EARTHQUAKE, MoveId.BULLET_PUNCH, MoveId.ICE_PUNCH],
        }),
      ];
    },
  },
];
