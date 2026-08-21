/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { pokemonEvolutions, SpeciesEvolution } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves } from "#balance/tms";
import { registerErEditorMon } from "#data/elite-redux/init-elite-redux-custom-species";
import { EggTier } from "#enums/egg-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { AbilityId } from "#enums/ability-id";

/** Append-only species ids for the Discord fakemon-pitch roster (2026-08). */
export const ER_TREMBURR_SPECIES_ID = 70033;
export const ER_GURDURUR_SPECIES_ID = 70034;
export const ER_CONKAPITATOR_SPECIES_ID = 70035;
export const ER_DIPPOWDOWN_SPECIES_ID = 70036;
export const ER_JUSTYKE_SPECIES_ID = 70037;
export const ER_EQUILIBRA_SPECIES_ID = 70038;
export const ER_LICKILICKING_SPECIES_ID = 70039;
export const ER_MANGLING_BLADE_SPECIES_ID = 70040;
export const ER_OCTILLERY_REDUX_SPECIES_ID = 70041;
export const ER_SNUGLETT_SPECIES_ID = 70042;
export const ER_SNUGTRIO_SPECIES_ID = 70043;
export const ER_PENTASNUG_SPECIES_ID = 70044;
export const ER_POWER_PLANT_SPECIES_ID = 70045;
export const ER_PYROTHON_SPECIES_ID = 70046;
export const ER_PONYTA_REDUX_SPECIES_ID = 70047;
export const ER_RAPIDASH_REDUX_SPECIES_ID = 70048;
export const ER_VOLTRIEVER_SPECIES_ID = 70049;
export const ER_WAILBORE_SPECIES_ID = 70050;

/** New standalone 70051-70057 pitch species ids. Existing 70020+ newcomers stay canonical. */
export const ER_MISHAMANUS_SPECIES_ID = 70051;
export const ER_FALINKS_CONVERGENT_SPECIES_ID = 70052;
export const ER_IRON_STREAM_SPECIES_ID = 70053;
export const ER_SLABBERIGUS_SPECIES_ID = 70054;
export const ER_TAGELA_SPECIES_ID = 70055;
export const ER_INTANGROWTH_SPECIES_ID = 70056;
export const ER_LILLIGANT_VERDANT_SPECIES_ID = 70057;

interface PitchSpeciesDef {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly editorConst?: string;
  readonly category?: string;
  readonly types: readonly [PokemonType, ...PokemonType[]];
  readonly stats: readonly [number, number, number, number, number, number];
  readonly actives: readonly [number, number, number];
  readonly innates: readonly [number, number, number];
  readonly weight: number;
  readonly catchRate?: number;
  readonly evolvesFrom?: SpeciesId | number;
  readonly evolveLevel?: number;
  readonly learnsetSource: SpeciesId | number;
  readonly learnsetAdditions?: ReadonlyArray<readonly [number, MoveId]>;
  readonly eggTier?: EggTier;
  readonly starterCost?: number;
  readonly eggMoveSource?: SpeciesId | number;
}

// The pitch defines final-stage kits. Named pre-evolutions retain that family kit
// so no temporary placeholder abilities leak into save data before evolution.
const CONKAPITATOR_ACTIVES = [5305, 5121, 116] as const; // Malicious / Low Blow / Solid Rock
const CONKAPITATOR_INNATES = [5140, 5454, 5346] as const; // Mineralize / Crust Coat / Jackhammer
const EQUILIBRA_ACTIVES = [6007, 6008, 6009] as const;
const EQUILIBRA_INNATES = [6010, 80, 6011] as const; // Magistrate / Steadfast / Deadly Sentencing
const PENTASNUG_ACTIVES = [5007, 5511, 6026] as const;
const PENTASNUG_INNATES = [5085, 6027, 6022] as const;
const RAPIDASH_REDUX_ACTIVES = [5452, 5049, 182] as const;
const RAPIDASH_REDUX_INNATES = [6034, 5356, 5963] as const;

export const ER_FAKEMON_PITCH_SPECIES: readonly PitchSpeciesDef[] = [
  {
    id: ER_TREMBURR_SPECIES_ID,
    name: "Tremburr",
    slug: "tremburr",
    types: [PokemonType.DARK, PokemonType.FIGHTING, PokemonType.ROCK],
    stats: [75, 80, 55, 25, 35, 35],
    actives: CONKAPITATOR_ACTIVES,
    innates: CONKAPITATOR_INNATES,
    weight: 12.5,
    learnsetSource: SpeciesId.TIMBURR,
    eggTier: EggTier.RARE,
    starterCost: 3,
    eggMoveSource: SpeciesId.TIMBURR,
  },
  {
    id: ER_GURDURUR_SPECIES_ID,
    name: "Gurdurur",
    slug: "gurdurur",
    types: [PokemonType.DARK, PokemonType.FIGHTING, PokemonType.ROCK],
    stats: [85, 105, 85, 40, 50, 40],
    actives: CONKAPITATOR_ACTIVES,
    innates: CONKAPITATOR_INNATES,
    weight: 40,
    evolvesFrom: ER_TREMBURR_SPECIES_ID,
    evolveLevel: 23,
    learnsetSource: ER_TREMBURR_SPECIES_ID,
  },
  {
    id: ER_CONKAPITATOR_SPECIES_ID,
    name: "Conkapitator",
    slug: "conkapitator",
    types: [PokemonType.DARK, PokemonType.FIGHTING, PokemonType.ROCK],
    stats: [110, 130, 105, 45, 95, 20],
    actives: CONKAPITATOR_ACTIVES,
    innates: CONKAPITATOR_INNATES,
    weight: 87,
    catchRate: 45,
    evolvesFrom: ER_GURDURUR_SPECIES_ID,
    evolveLevel: 32,
    learnsetSource: ER_GURDURUR_SPECIES_ID,
    learnsetAdditions: [[32, MoveId.DARK_PULSE], [32, MoveId.ROCK_SLIDE]],
  },
  {
    id: ER_DIPPOWDOWN_SPECIES_ID,
    name: "Dippowdown",
    slug: "dippowdown",
    types: [PokemonType.STEEL, PokemonType.WATER],
    stats: [118, 62, 120, 110, 78, 37],
    actives: [5114, 100, 2],
    innates: [6006, 6005, 5053],
    weight: 145,
    catchRate: 45,
    learnsetSource: SpeciesId.HIPPOWDON,
    learnsetAdditions: [[1, MoveId.WATER_GUN], [28, MoveId.FLASH_CANNON], [46, MoveId.STEAM_ERUPTION]],
    eggTier: EggTier.EPIC,
    starterCost: 5,
    eggMoveSource: SpeciesId.HIPPOPOTAS,
  },
  {
    id: ER_JUSTYKE_SPECIES_ID,
    name: "Justyke",
    slug: "justyke",
    types: [PokemonType.STEEL, PokemonType.GROUND],
    // Official CAP pre-evolution statline.
    stats: [72, 70, 56, 83, 68, 30],
    actives: EQUILIBRA_ACTIVES,
    innates: EQUILIBRA_INNATES,
    weight: 36.5,
    learnsetSource: SpeciesId.BALTOY,
    learnsetAdditions: [[1, MoveId.WONDER_ROOM], [24, MoveId.FLASH_CANNON]],
    eggTier: EggTier.RARE,
    starterCost: 3,
    eggMoveSource: SpeciesId.BALTOY,
  },
  {
    id: ER_EQUILIBRA_SPECIES_ID,
    name: "Equilibra",
    slug: "equilibra",
    types: [PokemonType.STEEL, PokemonType.GROUND],
    stats: [102, 50, 96, 133, 118, 60],
    actives: EQUILIBRA_ACTIVES,
    innates: EQUILIBRA_INNATES,
    weight: 52,
    catchRate: 45,
    evolvesFrom: ER_JUSTYKE_SPECIES_ID,
    evolveLevel: 36,
    learnsetSource: ER_JUSTYKE_SPECIES_ID,
    learnsetAdditions: [[36, MoveId.EARTH_POWER], [36, MoveId.DOOM_DESIRE]],
  },
  {
    id: ER_LICKILICKING_SPECIES_ID,
    name: "Lickilicking",
    slug: "lickilicking",
    types: [PokemonType.NORMAL],
    stats: [160, 115, 85, 55, 85, 55],
    actives: [5031, 144, 86],
    innates: [6020, 6021, 6022],
    weight: 180,
    catchRate: 30,
    evolvesFrom: SpeciesId.LICKILICKY,
    evolveLevel: 50,
    learnsetSource: SpeciesId.LICKILICKY,
    learnsetAdditions: [[50, MoveId.ROLLOUT], [50, MoveId.BODY_SLAM]],
  },
  {
    id: ER_MANGLING_BLADE_SPECIES_ID,
    name: "Mangling Blade",
    slug: "mangling_blade",
    types: [PokemonType.GRASS, PokemonType.ROCK, PokemonType.STEEL, PokemonType.FIGHTING],
    stats: [101, 129, 91, 71, 89, 109],
    actives: [5157, 5038, 5169],
    innates: [281, 6023, 6024],
    weight: 115,
    catchRate: 10,
    learnsetSource: SpeciesId.IRON_LEAVES,
    eggTier: EggTier.EPIC,
    starterCost: 6,
    eggMoveSource: SpeciesId.IRON_LEAVES,
  },
  {
    id: ER_OCTILLERY_REDUX_SPECIES_ID,
    name: "Octillery Redux",
    slug: "octillery_redux",
    types: [PokemonType.WATER, PokemonType.STEEL],
    stats: [80, 65, 110, 110, 110, 35],
    actives: [6025, 5101, 5114],
    innates: [4, 5034, 5515],
    weight: 34,
    catchRate: 45,
    evolvesFrom: SpeciesId.REMORAID,
    evolveLevel: 25,
    learnsetSource: SpeciesId.OCTILLERY,
    learnsetAdditions: [[25, MoveId.FLASH_CANNON]],
  },
  {
    id: ER_SNUGLETT_SPECIES_ID,
    name: "Snuglett",
    slug: "snuglett",
    types: [PokemonType.ICE],
    stats: [10, 55, 25, 35, 45, 95],
    actives: PENTASNUG_ACTIVES,
    innates: PENTASNUG_INNATES,
    weight: 0.8,
    learnsetSource: SpeciesId.DIGLETT,
    learnsetAdditions: [[1, MoveId.POWDER_SNOW], [20, MoveId.ICE_BALL]],
    eggTier: EggTier.RARE,
    starterCost: 3,
    eggMoveSource: SpeciesId.DIGLETT,
  },
  {
    id: ER_SNUGTRIO_SPECIES_ID,
    name: "Snugtrio",
    slug: "snugtrio",
    types: [PokemonType.ICE],
    stats: [35, 100, 50, 50, 70, 120],
    actives: PENTASNUG_ACTIVES,
    innates: PENTASNUG_INNATES,
    weight: 33.3,
    evolvesFrom: ER_SNUGLETT_SPECIES_ID,
    evolveLevel: 26,
    learnsetSource: ER_SNUGLETT_SPECIES_ID,
  },
  {
    id: ER_PENTASNUG_SPECIES_ID,
    name: "Pentasnug",
    slug: "pentasnug",
    types: [PokemonType.ICE],
    stats: [100, 120, 65, 50, 75, 115],
    actives: PENTASNUG_ACTIVES,
    innates: PENTASNUG_INNATES,
    weight: 88,
    catchRate: 45,
    evolvesFrom: ER_SNUGTRIO_SPECIES_ID,
    evolveLevel: 37,
    learnsetSource: ER_SNUGTRIO_SPECIES_ID,
    learnsetAdditions: [[37, MoveId.ICE_SPINNER], [37, MoveId.TRIPLE_AXEL]],
  },
  {
    id: ER_POWER_PLANT_SPECIES_ID,
    name: "Power Plant",
    slug: "power_plant",
    types: [PokemonType.GRASS, PokemonType.STEEL],
    stats: [120, 40, 120, 130, 120, 40],
    actives: [85, 5350, 252],
    innates: [281, 6028, 6029],
    weight: 100,
    catchRate: 10,
    learnsetSource: SpeciesId.SUNFLORA,
    learnsetAdditions: [[1, MoveId.FLASH_CANNON], [42, MoveId.SOLAR_BEAM]],
    eggTier: EggTier.EPIC,
    starterCost: 6,
    eggMoveSource: SpeciesId.SUNFLORA,
  },
  {
    id: ER_PYROTHON_SPECIES_ID,
    name: "Pyrothon",
    slug: "pyrothon",
    types: [PokemonType.FIRE, PokemonType.PSYCHIC],
    stats: [80, 70, 84, 125, 100, 91],
    actives: [5065, 6031, 6032],
    innates: [5371, 5411, 5254],
    weight: 31,
    catchRate: 45,
    learnsetSource: SpeciesId.SEVIPER,
    learnsetAdditions: [[1, MoveId.EMBER], [24, MoveId.PSYCHIC_FANGS], [42, MoveId.FLAMETHROWER]],
    eggTier: EggTier.EPIC,
    starterCost: 5,
    eggMoveSource: SpeciesId.SEVIPER,
  },
  {
    id: ER_PONYTA_REDUX_SPECIES_ID,
    name: "Ponyta Redux",
    slug: "ponyta_redux",
    types: [PokemonType.GRASS, PokemonType.FAIRY],
    stats: [50, 85, 55, 65, 65, 90],
    actives: RAPIDASH_REDUX_ACTIVES,
    innates: RAPIDASH_REDUX_INNATES,
    weight: 30,
    learnsetSource: SpeciesId.PONYTA,
    learnsetAdditions: [[1, MoveId.VINE_WHIP], [20, MoveId.HORN_LEECH], [28, MoveId.DAZZLING_GLEAM]],
    eggTier: EggTier.RARE,
    starterCost: 3,
    eggMoveSource: SpeciesId.PONYTA,
  },
  {
    id: ER_RAPIDASH_REDUX_SPECIES_ID,
    name: "Rapidash Redux",
    slug: "rapidash_redux",
    types: [PokemonType.GRASS, PokemonType.FAIRY],
    stats: [85, 110, 60, 110, 55, 120],
    actives: RAPIDASH_REDUX_ACTIVES,
    innates: RAPIDASH_REDUX_INNATES,
    weight: 95,
    catchRate: 60,
    evolvesFrom: ER_PONYTA_REDUX_SPECIES_ID,
    evolveLevel: 40,
    learnsetSource: ER_PONYTA_REDUX_SPECIES_ID,
    learnsetAdditions: [[40, MoveId.PLAY_ROUGH], [40, MoveId.POWER_WHIP]],
  },
  {
    id: ER_VOLTRIEVER_SPECIES_ID,
    name: "Voltriever",
    slug: "voltriever",
    types: [PokemonType.ELECTRIC, PokemonType.PSYCHIC],
    stats: [64, 123, 56, 56, 88, 133],
    actives: [6037, 5087, 5174],
    innates: [6038, 6039, 6040],
    weight: 34,
    catchRate: 45,
    learnsetSource: SpeciesId.BOLTUND,
    learnsetAdditions: [[1, MoveId.PSYCHIC_FANGS], [36, MoveId.WILD_CHARGE]],
    eggTier: EggTier.EPIC,
    starterCost: 5,
    eggMoveSource: SpeciesId.BOLTUND,
  },
  {
    id: ER_WAILBORE_SPECIES_ID,
    name: "Wailbore",
    slug: "wailbore",
    types: [PokemonType.STEEL, PokemonType.GROUND],
    stats: [150, 115, 135, 45, 45, 35],
    actives: [200, 5128, 6041],
    innates: [6042, 6043, 6044],
    weight: 398,
    catchRate: 45,
    learnsetSource: SpeciesId.WAILORD,
    learnsetAdditions: [[1, MoveId.METAL_BURST], [32, MoveId.DRILL_RUN], [44, MoveId.IRON_HEAD]],
    eggTier: EggTier.EPIC,
    starterCost: 5,
    eggMoveSource: SpeciesId.WAILMER,
  },
  {
    id: ER_MISHAMANUS_SPECIES_ID,
    name: "Mishamanus",
    slug: "mishamanus",
    editorConst: "SPECIES_MISHAMANUS",
    category: "Astromancer Pokémon",
    types: [PokemonType.GHOST, PokemonType.FAIRY],
    stats: [75, 60, 60, 120, 120, 120],
    actives: [5325, 5224, 6052],
    innates: [AbilityId.LEVITATE, AbilityId.SHADOW_TAG, 6053],
    weight: 4.4,
    catchRate: 45,
    evolvesFrom: SpeciesId.MISMAGIUS,
    evolveLevel: 55,
    learnsetSource: SpeciesId.MISMAGIUS,
  },
  {
    id: ER_FALINKS_CONVERGENT_SPECIES_ID,
    name: "Falinks Convergent",
    slug: "falinks_convergent",
    editorConst: "SPECIES_FALINKS_CONVERGENT",
    types: [PokemonType.PSYCHIC, PokemonType.FIGHTING],
    stats: [65, 70, 60, 100, 100, 75],
    actives: [5158, 5620, AbilityId.FRIEND_GUARD],
    innates: [5452, 5190, 5085],
    weight: 62,
    catchRate: 45,
    learnsetSource: SpeciesId.FALINKS,
    eggTier: EggTier.RARE,
    starterCost: 4,
    eggMoveSource: SpeciesId.FALINKS,
  },
  {
    id: ER_IRON_STREAM_SPECIES_ID,
    name: "Iron Stream",
    slug: "iron_stream",
    editorConst: "SPECIES_IRON_STREAM",
    types: [PokemonType.WATER, PokemonType.PSYCHIC],
    stats: [86, 66, 90, 124, 96, 128],
    actives: [6079, 5159, 5224],
    innates: [AbilityId.QUARK_DRIVE, 6064, 6065],
    weight: 125,
    catchRate: 10,
    learnsetSource: SpeciesId.IRON_LEAVES,
    eggTier: EggTier.EPIC,
    starterCost: 6,
    eggMoveSource: SpeciesId.IRON_LEAVES,
  },
  {
    id: ER_SLABBERIGUS_SPECIES_ID,
    name: "Slabberigus",
    slug: "slabberigus",
    editorConst: "SPECIES_SLABBERIGUS",
    types: [PokemonType.ROCK, PokemonType.GHOST],
    stats: [88, 65, 105, 50, 145, 30],
    actives: [5306, AbilityId.SHADOW_SHIELD, 5024],
    innates: [6066, 6067, 5697],
    weight: 76.5,
    catchRate: 90,
    // The pitch names an unspecified Yamask variant, so keep this final form direct.
    eggTier: EggTier.RARE,
    starterCost: 4,
    learnsetSource: SpeciesId.COFAGRIGUS,
  },
  {
    id: ER_TAGELA_SPECIES_ID,
    name: "Tagela",
    slug: "tagela",
    editorConst: "SPECIES_TAGELA",
    types: [PokemonType.GHOST, PokemonType.PSYCHIC],
    stats: [65, 55, 115, 100, 40, 60],
    // Tagela's pitch data is silent on abilities; preserve Tangela's live ER kit.
    actives: [34, 4, 102],
    innates: [144, 5080, 221],
    weight: 35,
    catchRate: 45,
    learnsetSource: SpeciesId.TANGELA,
    eggTier: EggTier.COMMON,
    starterCost: 3,
    eggMoveSource: SpeciesId.TANGELA,
  },
  {
    id: ER_INTANGROWTH_SPECIES_ID,
    name: "Intangrowth",
    slug: "intangrowth",
    editorConst: "SPECIES_INTANGROWTH",
    types: [PokemonType.GHOST, PokemonType.PSYCHIC],
    stats: [100, 100, 50, 110, 125, 50],
    actives: [6068, 5070, 5367],
    innates: [5283, 6069, 6070],
    weight: 128.6,
    catchRate: 30,
    evolvesFrom: ER_TAGELA_SPECIES_ID,
    evolveLevel: 26,
    learnsetSource: SpeciesId.TANGROWTH,
  },
  {
    id: ER_LILLIGANT_VERDANT_SPECIES_ID,
    name: "Lilligant Verdant",
    slug: "lilligant_verdant",
    editorConst: "SPECIES_LILLIGANT_VERDANT",
    types: [PokemonType.WATER, PokemonType.FAIRY],
    stats: [90, 50, 80, 110, 90, 80],
    actives: [6071, 5298, 5281],
    innates: [5596, 5233, AbilityId.QUEENLY_MAJESTY],
    weight: 16.3,
    catchRate: 75,
    evolvesFrom: SpeciesId.PETILIL,
    evolveLevel: 20,
    learnsetSource: SpeciesId.LILLIGANT,
  },
];

/** Stable editor source mapping for every Discord fakemon-pitch species. */
export const ER_FAKEMON_PITCH_EDITOR_SPECIES = Object.freeze(
  Object.fromEntries(
    ER_FAKEMON_PITCH_SPECIES.map(def => {
      const speciesConst =
        def.editorConst
        ?? `SPECIES_${def.name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")}`;
      return [speciesConst, { id: def.id, slug: def.slug }] as const;
    }),
  ),
) as Readonly<Record<string, Readonly<{ id: number; slug: string }>>>;

export interface InjectErFakemonPitchSpeciesResult {
  registered: number;
  skipped: number;
  evolutionEdges: number;
}

export function injectErFakemonPitchSpecies(): InjectErFakemonPitchSpeciesResult {
  const result: InjectErFakemonPitchSpeciesResult = { registered: 0, skipped: 0, evolutionEdges: 0 };
  const evolutions = pokemonEvolutions as Record<number, SpeciesEvolution[]>;

  for (const def of ER_FAKEMON_PITCH_SPECIES) {
    const added = registerErEditorMon({
      speciesId: def.id,
      name: def.name,
      slug: def.slug,
      ...(def.category === undefined ? {} : { category: def.category }),
      type1: def.types[0],
      type2: def.types[1] ?? null,
      extraTypes: def.types.length > 2 ? def.types.slice(2) : undefined,
      baseStats: def.stats,
      abilities: def.actives,
      innates: def.innates,
      catchRate: def.catchRate ?? 90,
      weight: def.weight,
    });
    added ? result.registered++ : result.skipped++;

    if (def.evolvesFrom !== undefined && def.evolveLevel !== undefined) {
      const list = (evolutions[def.evolvesFrom] ??= []);
      if (!list.some(edge => Number(edge.speciesId) === def.id)) {
        list.push(new SpeciesEvolution(def.id as SpeciesId, def.evolveLevel, null, null));
        result.evolutionEdges++;
      }
    }
    if (def.eggTier !== undefined) {
      (speciesEggTiers as Record<number, EggTier>)[def.id] = def.eggTier;
    }
    if (def.starterCost !== undefined) {
      (speciesStarterCosts as Record<number, number>)[def.id] = def.starterCost;
    }
  }
  return result;
}

function cloneLevelMoves(sourceId: number, additions: ReadonlyArray<readonly [number, MoveId]> = []): [number, number][] {
  const table = pokemonSpeciesLevelMoves as Record<number, [number, number][]>;
  const moves = (table[sourceId] ?? []).map(([level, move]) => [level, move] as [number, number]);
  for (const [level, move] of additions) {
    if (!moves.some(([, existing]) => existing === move)) {
      moves.push([level, move]);
    }
  }
  moves.sort((a, b) => a[0] - b[0]);
  return moves;
}

export function applyErFakemonPitchLearnsets(): number {
  const table = pokemonSpeciesLevelMoves as Record<number, [number, number][]>;
  for (const def of ER_FAKEMON_PITCH_SPECIES) {
    table[def.id] = cloneLevelMoves(def.learnsetSource, def.learnsetAdditions);
  }
  return ER_FAKEMON_PITCH_SPECIES.length;
}

export function applyErFakemonPitchEggMoves(): number {
  let wired = 0;
  for (const def of ER_FAKEMON_PITCH_SPECIES) {
    if (def.eggMoveSource === undefined) {
      continue;
    }
    (speciesEggMoves as Record<number, MoveId[]>)[def.id] = [...(speciesEggMoves[def.eggMoveSource] ?? [])];
    wired++;
  }
  return wired;
}

export function applyErFakemonPitchTmCompatibility(): number {
  type FormTmEntry = [SpeciesId, ...string[]];
  const bySpecies = speciesTmMoves as Record<number, (MoveId | [unknown, MoveId])[]>;
  const byMove = tmSpecies as Record<number, (SpeciesId | FormTmEntry)[]>;

  for (const def of ER_FAKEMON_PITCH_SPECIES) {
    const inherited = (bySpecies[def.learnsetSource] ?? []).map(entry => Array.isArray(entry) ? entry[1] : entry);
    const additions = (def.learnsetAdditions ?? []).map(([, move]) => move);
    const moves = [...new Set([...inherited, ...additions])];
    bySpecies[def.id] = [...moves];
    for (const move of moves) {
      const compatible = byMove[move];
      if (compatible && !compatible.some(entry => !Array.isArray(entry) && Number(entry) === def.id)) {
        compatible.push(def.id as SpeciesId);
      }
    }
  }
  return ER_FAKEMON_PITCH_SPECIES.length;
}
