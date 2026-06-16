import { BiomeId } from "#enums/biome-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { ATrainersTestEncounter } from "#mystery-encounters/a-trainers-test-encounter";
import { AbsoluteAvariceEncounter } from "#mystery-encounters/absolute-avarice-encounter";
import { AbyssalVentEncounter } from "#mystery-encounters/abyssal-vent-encounter";
import { AnOfferYouCantRefuseEncounter } from "#mystery-encounters/an-offer-you-cant-refuse-encounter";
import { BerriesAboundEncounter } from "#mystery-encounters/berries-abound-encounter";
import { BlackMarketEncounter } from "#mystery-encounters/black-market-encounter";
import { BugTypeSuperfanEncounter } from "#mystery-encounters/bug-type-superfan-encounter";
import { ClowningAroundEncounter } from "#mystery-encounters/clowning-around-encounter";
import { ColosseumEncounter } from "#mystery-encounters/colosseum-encounter";
import { DancingLessonsEncounter } from "#mystery-encounters/dancing-lessons-encounter";
import { DarkDealEncounter } from "#mystery-encounters/dark-deal-encounter";
import { DelibirdyEncounter } from "#mystery-encounters/delibirdy-encounter";
import { DepartmentStoreSaleEncounter } from "#mystery-encounters/department-store-sale-encounter";
import { ExoticTraderEncounter } from "#mystery-encounters/exotic-trader-encounter";
import { FairysBoonEncounter } from "#mystery-encounters/fairys-boon-encounter";
import { FieldTripEncounter } from "#mystery-encounters/field-trip-encounter";
import { FieryFalloutEncounter } from "#mystery-encounters/fiery-fallout-encounter";
import { FightOrFlightEncounter } from "#mystery-encounters/fight-or-flight-encounter";
import { FunAndGamesEncounter } from "#mystery-encounters/fun-and-games-encounter";
import { GlitteringVeinEncounter } from "#mystery-encounters/glittering-vein-encounter";
import { GlobalTradeSystemEncounter } from "#mystery-encounters/global-trade-system-encounter";
import { GravesOfTheFallenEncounter } from "#mystery-encounters/graves-of-the-fallen-encounter";
import { HotSpringEncounter } from "#mystery-encounters/hot-spring-encounter";
import { ImportBazaarEncounter } from "#mystery-encounters/import-bazaar-encounter";
import { LakeSpiritEncounter } from "#mystery-encounters/lake-spirit-encounter";
import { LostAtSeaEncounter } from "#mystery-encounters/lost-at-sea-encounter";
import { MushroomCircleEncounter } from "#mystery-encounters/mushroom-circle-encounter";
import { MysteriousChallengersEncounter } from "#mystery-encounters/mysterious-challengers-encounter";
import { MysteriousChestEncounter } from "#mystery-encounters/mysterious-chest-encounter";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { OvergrownTempleEncounter } from "#mystery-encounters/overgrown-temple-encounter";
import { PartTimerEncounter } from "#mystery-encounters/part-timer-encounter";
import { PicnicEncounter } from "#mystery-encounters/picnic-encounter";
import { SafariZoneEncounter } from "#mystery-encounters/safari-zone-encounter";
import { ScrambledPokedexEncounter } from "#mystery-encounters/scrambled-pokedex-encounter";
import { SealedDoorEncounter } from "#mystery-encounters/sealed-door-encounter";
import { ShadyVitaminDealerEncounter } from "#mystery-encounters/shady-vitamin-dealer-encounter";
import { SlumberingSnorlaxEncounter } from "#mystery-encounters/slumbering-snorlax-encounter";
import { TeleportingHijinksEncounter } from "#mystery-encounters/teleporting-hijinks-encounter";
import { TheExpertPokemonBreederEncounter } from "#mystery-encounters/the-expert-pokemon-breeder-encounter";
import { ThePokemonSalesmanEncounter } from "#mystery-encounters/the-pokemon-salesman-encounter";
import { TheStrongStuffEncounter } from "#mystery-encounters/the-strong-stuff-encounter";
import { TheWinstrateChallengeEncounter } from "#mystery-encounters/the-winstrate-challenge-encounter";
import { TidePoolsEncounter } from "#mystery-encounters/tide-pools-encounter";
import { TotemTrialEncounter } from "#mystery-encounters/totem-trial-encounter";
import { TownGuessingBoothEncounter } from "#mystery-encounters/town-guessing-booth-encounter";
import { TownRaffleEncounter } from "#mystery-encounters/town-raffle-encounter";
import { TrainingSessionEncounter } from "#mystery-encounters/training-session-encounter";
import { TrashToTreasureEncounter } from "#mystery-encounters/trash-to-treasure-encounter";
import { UncommonBreedEncounter } from "#mystery-encounters/uncommon-breed-encounter";
import { WeirdDreamEncounter } from "#mystery-encounters/weird-dream-encounter";
import { WoodlandForagerEncounter } from "#mystery-encounters/woodland-forager-encounter";
import { getBiomeName } from "#utils/common";

export const EXTREME_ENCOUNTER_BIOMES = [
  BiomeId.SEA,
  BiomeId.SEABED,
  BiomeId.BADLANDS,
  BiomeId.DESERT,
  BiomeId.ICE_CAVE,
  BiomeId.VOLCANO,
  BiomeId.WASTELAND,
  BiomeId.ABYSS,
  BiomeId.SPACE,
  BiomeId.END,
];

export const NON_EXTREME_ENCOUNTER_BIOMES = [
  BiomeId.TOWN,
  BiomeId.PLAINS,
  BiomeId.GRASS,
  BiomeId.TALL_GRASS,
  BiomeId.METROPOLIS,
  BiomeId.FOREST,
  BiomeId.SWAMP,
  BiomeId.BEACH,
  BiomeId.LAKE,
  BiomeId.MOUNTAIN,
  BiomeId.CAVE,
  BiomeId.MEADOW,
  BiomeId.POWER_PLANT,
  BiomeId.GRAVEYARD,
  BiomeId.DOJO,
  BiomeId.FACTORY,
  BiomeId.RUINS,
  BiomeId.CONSTRUCTION_SITE,
  BiomeId.JUNGLE,
  BiomeId.FAIRY_CAVE,
  BiomeId.TEMPLE,
  BiomeId.SLUM,
  BiomeId.SNOWY_FOREST,
  BiomeId.ISLAND,
  BiomeId.LABORATORY,
];

/**
 * Places where you could very reasonably expect to encounter a single human
 *
 * Diff from NON_EXTREME_ENCOUNTER_BIOMES:
 * + BADLANDS
 * + DESERT
 * + ICE_CAVE
 */
export const HUMAN_TRANSITABLE_BIOMES = [
  BiomeId.TOWN,
  BiomeId.PLAINS,
  BiomeId.GRASS,
  BiomeId.TALL_GRASS,
  BiomeId.METROPOLIS,
  BiomeId.FOREST,
  BiomeId.SWAMP,
  BiomeId.BEACH,
  BiomeId.LAKE,
  BiomeId.MOUNTAIN,
  BiomeId.BADLANDS,
  BiomeId.CAVE,
  BiomeId.DESERT,
  BiomeId.ICE_CAVE,
  BiomeId.MEADOW,
  BiomeId.POWER_PLANT,
  BiomeId.GRAVEYARD,
  BiomeId.DOJO,
  BiomeId.FACTORY,
  BiomeId.RUINS,
  BiomeId.CONSTRUCTION_SITE,
  BiomeId.JUNGLE,
  BiomeId.FAIRY_CAVE,
  BiomeId.TEMPLE,
  BiomeId.SLUM,
  BiomeId.SNOWY_FOREST,
  BiomeId.ISLAND,
  BiomeId.LABORATORY,
];

/**
 * Places where you could expect a town or city, some form of large civilization
 */
export const CIVILIZATION_ENCOUNTER_BIOMES = [
  BiomeId.TOWN,
  BiomeId.PLAINS,
  BiomeId.GRASS,
  BiomeId.TALL_GRASS,
  BiomeId.METROPOLIS,
  BiomeId.BEACH,
  BiomeId.LAKE,
  BiomeId.MEADOW,
  BiomeId.POWER_PLANT,
  BiomeId.GRAVEYARD,
  BiomeId.DOJO,
  BiomeId.FACTORY,
  BiomeId.CONSTRUCTION_SITE,
  BiomeId.SLUM,
  BiomeId.ISLAND,
];

export const allMysteryEncounters: {
  [encounterType: number]: MysteryEncounter;
} = {};

const extremeBiomeEncounters: MysteryEncounterType[] = [];

const nonExtremeBiomeEncounters: MysteryEncounterType[] = [
  // MysteryEncounterType.FIELD_TRIP, Disabled
  MysteryEncounterType.DANCING_LESSONS, // Is also in BADLANDS, DESERT, VOLCANO, WASTELAND, ABYSS
];

const humanTransitableBiomeEncounters: MysteryEncounterType[] = [
  MysteryEncounterType.MYSTERIOUS_CHALLENGERS,
  MysteryEncounterType.SHADY_VITAMIN_DEALER,
  MysteryEncounterType.THE_POKEMON_SALESMAN,
  // MysteryEncounterType.AN_OFFER_YOU_CANT_REFUSE, Disabled
  MysteryEncounterType.THE_WINSTRATE_CHALLENGE,
  MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER,
  // World Tournament (#439) is NOT a generic human-transitable encounter - it is
  // gated to DOJO + METROPOLIS only (see mysteryEncountersByBiome below).
];

const civilizationBiomeEncounters: MysteryEncounterType[] = [
  MysteryEncounterType.DEPARTMENT_STORE_SALE,
  MysteryEncounterType.PART_TIMER,
  MysteryEncounterType.FUN_AND_GAMES,
  MysteryEncounterType.GLOBAL_TRADE_SYSTEM,
];

/**
 * To add an encounter to every biome possible, use this array
 */
const anyBiomeEncounters: MysteryEncounterType[] = [
  MysteryEncounterType.FIGHT_OR_FLIGHT,
  MysteryEncounterType.DARK_DEAL,
  MysteryEncounterType.MYSTERIOUS_CHEST,
  MysteryEncounterType.TRAINING_SESSION,
  MysteryEncounterType.DELIBIRDY,
  MysteryEncounterType.A_TRAINERS_TEST,
  MysteryEncounterType.TRASH_TO_TREASURE,
  MysteryEncounterType.BERRIES_ABOUND,
  MysteryEncounterType.CLOWNING_AROUND,
  MysteryEncounterType.WEIRD_DREAM,
  MysteryEncounterType.TELEPORTING_HIJINKS,
  MysteryEncounterType.BUG_TYPE_SUPERFAN,
  MysteryEncounterType.UNCOMMON_BREED,
];

/**
 * ENCOUNTER BIOME MAPPING
 * To add an Encounter to a biome group, instead of cluttering the map, use the biome group arrays above
 *
 * Adding specific Encounters to the mysteryEncountersByBiome map is for specific cases and special circumstances
 * that biome groups do not cover
 */
export const mysteryEncountersByBiome = new Map<BiomeId, MysteryEncounterType[]>([
  [
    BiomeId.TOWN,
    [
      MysteryEncounterType.ER_GUESSING_BOOTH,
      MysteryEncounterType.ER_SCRAMBLED_POKEDEX,
      MysteryEncounterType.ER_TOWN_RAFFLE,
    ],
  ],
  [BiomeId.PLAINS, [MysteryEncounterType.SLUMBERING_SNORLAX]],
  [
    BiomeId.GRASS,
    [
      MysteryEncounterType.SLUMBERING_SNORLAX,
      MysteryEncounterType.ABSOLUTE_AVARICE,
      MysteryEncounterType.ER_MUSHROOM_CIRCLE,
    ],
  ],
  [BiomeId.TALL_GRASS, [MysteryEncounterType.SLUMBERING_SNORLAX, MysteryEncounterType.ABSOLUTE_AVARICE]],
  [BiomeId.METROPOLIS, [MysteryEncounterType.COLOSSEUM]],
  [
    BiomeId.FOREST,
    [MysteryEncounterType.SAFARI_ZONE, MysteryEncounterType.ABSOLUTE_AVARICE, MysteryEncounterType.ER_WOODLAND_FORAGER],
  ],
  [BiomeId.SEA, [MysteryEncounterType.LOST_AT_SEA, MysteryEncounterType.ER_EXOTIC_TRADER]],
  [BiomeId.SWAMP, [MysteryEncounterType.SAFARI_ZONE]],
  [BiomeId.BEACH, [MysteryEncounterType.ER_TIDE_POOLS]],
  [BiomeId.LAKE, [MysteryEncounterType.ER_LAKE_SPIRIT]],
  [BiomeId.SEABED, [MysteryEncounterType.ER_ABYSSAL_VENT]],
  [BiomeId.MOUNTAIN, [MysteryEncounterType.ER_HOT_SPRING]],
  [BiomeId.BADLANDS, [MysteryEncounterType.DANCING_LESSONS]],
  [BiomeId.CAVE, [MysteryEncounterType.THE_STRONG_STUFF, MysteryEncounterType.ER_GLITTERING_VEIN]],
  [BiomeId.DESERT, [MysteryEncounterType.DANCING_LESSONS]],
  [BiomeId.ICE_CAVE, []],
  [BiomeId.MEADOW, [MysteryEncounterType.ER_PICNIC]],
  [BiomeId.POWER_PLANT, []],
  [BiomeId.VOLCANO, [MysteryEncounterType.FIERY_FALLOUT, MysteryEncounterType.DANCING_LESSONS]],
  [BiomeId.GRAVEYARD, [MysteryEncounterType.ER_GRAVES_OF_THE_FALLEN]],
  [BiomeId.DOJO, [MysteryEncounterType.COLOSSEUM]],
  [BiomeId.FACTORY, []],
  [BiomeId.RUINS, [MysteryEncounterType.ER_SEALED_DOOR]],
  [BiomeId.WASTELAND, [MysteryEncounterType.DANCING_LESSONS]],
  [BiomeId.ABYSS, [MysteryEncounterType.DANCING_LESSONS]],
  [BiomeId.SPACE, [MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER]],
  [BiomeId.CONSTRUCTION_SITE, []],
  [BiomeId.JUNGLE, [MysteryEncounterType.SAFARI_ZONE, MysteryEncounterType.ER_OVERGROWN_TEMPLE]],
  [BiomeId.FAIRY_CAVE, [MysteryEncounterType.ER_FAIRYS_BOON]],
  [BiomeId.TEMPLE, [MysteryEncounterType.ER_TOTEM_TRIAL]],
  [BiomeId.SLUM, [MysteryEncounterType.ER_BLACK_MARKET]],
  [BiomeId.SNOWY_FOREST, []],
  [BiomeId.ISLAND, [MysteryEncounterType.ER_IMPORT_BAZAAR]],
  [BiomeId.LABORATORY, []],
]);

export function initMysteryEncounters() {
  allMysteryEncounters[MysteryEncounterType.MYSTERIOUS_CHALLENGERS] = MysteriousChallengersEncounter;
  allMysteryEncounters[MysteryEncounterType.MYSTERIOUS_CHEST] = MysteriousChestEncounter;
  allMysteryEncounters[MysteryEncounterType.DARK_DEAL] = DarkDealEncounter;
  allMysteryEncounters[MysteryEncounterType.FIGHT_OR_FLIGHT] = FightOrFlightEncounter;
  allMysteryEncounters[MysteryEncounterType.TRAINING_SESSION] = TrainingSessionEncounter;
  allMysteryEncounters[MysteryEncounterType.SLUMBERING_SNORLAX] = SlumberingSnorlaxEncounter;
  allMysteryEncounters[MysteryEncounterType.DEPARTMENT_STORE_SALE] = DepartmentStoreSaleEncounter;
  allMysteryEncounters[MysteryEncounterType.SHADY_VITAMIN_DEALER] = ShadyVitaminDealerEncounter;
  allMysteryEncounters[MysteryEncounterType.FIELD_TRIP] = FieldTripEncounter;
  allMysteryEncounters[MysteryEncounterType.SAFARI_ZONE] = SafariZoneEncounter;
  allMysteryEncounters[MysteryEncounterType.LOST_AT_SEA] = LostAtSeaEncounter;
  allMysteryEncounters[MysteryEncounterType.FIERY_FALLOUT] = FieryFalloutEncounter;
  allMysteryEncounters[MysteryEncounterType.THE_STRONG_STUFF] = TheStrongStuffEncounter;
  allMysteryEncounters[MysteryEncounterType.THE_POKEMON_SALESMAN] = ThePokemonSalesmanEncounter;
  allMysteryEncounters[MysteryEncounterType.AN_OFFER_YOU_CANT_REFUSE] = AnOfferYouCantRefuseEncounter;
  allMysteryEncounters[MysteryEncounterType.DELIBIRDY] = DelibirdyEncounter;
  allMysteryEncounters[MysteryEncounterType.ABSOLUTE_AVARICE] = AbsoluteAvariceEncounter;
  allMysteryEncounters[MysteryEncounterType.A_TRAINERS_TEST] = ATrainersTestEncounter;
  allMysteryEncounters[MysteryEncounterType.TRASH_TO_TREASURE] = TrashToTreasureEncounter;
  allMysteryEncounters[MysteryEncounterType.BERRIES_ABOUND] = BerriesAboundEncounter;
  allMysteryEncounters[MysteryEncounterType.CLOWNING_AROUND] = ClowningAroundEncounter;
  allMysteryEncounters[MysteryEncounterType.PART_TIMER] = PartTimerEncounter;
  allMysteryEncounters[MysteryEncounterType.DANCING_LESSONS] = DancingLessonsEncounter;
  allMysteryEncounters[MysteryEncounterType.WEIRD_DREAM] = WeirdDreamEncounter;
  allMysteryEncounters[MysteryEncounterType.THE_WINSTRATE_CHALLENGE] = TheWinstrateChallengeEncounter;
  allMysteryEncounters[MysteryEncounterType.TELEPORTING_HIJINKS] = TeleportingHijinksEncounter;
  allMysteryEncounters[MysteryEncounterType.BUG_TYPE_SUPERFAN] = BugTypeSuperfanEncounter;
  allMysteryEncounters[MysteryEncounterType.FUN_AND_GAMES] = FunAndGamesEncounter;
  allMysteryEncounters[MysteryEncounterType.UNCOMMON_BREED] = UncommonBreedEncounter;
  allMysteryEncounters[MysteryEncounterType.GLOBAL_TRADE_SYSTEM] = GlobalTradeSystemEncounter;
  allMysteryEncounters[MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER] = TheExpertPokemonBreederEncounter;
  allMysteryEncounters[MysteryEncounterType.COLOSSEUM] = ColosseumEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_GUESSING_BOOTH] = TownGuessingBoothEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_SCRAMBLED_POKEDEX] = ScrambledPokedexEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_GRAVES_OF_THE_FALLEN] = GravesOfTheFallenEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_WOODLAND_FORAGER] = WoodlandForagerEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_GLITTERING_VEIN] = GlitteringVeinEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_MUSHROOM_CIRCLE] = MushroomCircleEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_TOWN_RAFFLE] = TownRaffleEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_OVERGROWN_TEMPLE] = OvergrownTempleEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_TIDE_POOLS] = TidePoolsEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_ABYSSAL_VENT] = AbyssalVentEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_HOT_SPRING] = HotSpringEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_FAIRYS_BOON] = FairysBoonEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_PICNIC] = PicnicEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_EXOTIC_TRADER] = ExoticTraderEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_TOTEM_TRIAL] = TotemTrialEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_BLACK_MARKET] = BlackMarketEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_LAKE_SPIRIT] = LakeSpiritEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_IMPORT_BAZAAR] = ImportBazaarEncounter;
  allMysteryEncounters[MysteryEncounterType.ER_SEALED_DOOR] = SealedDoorEncounter;

  // Add extreme encounters to biome map
  extremeBiomeEncounters.forEach(encounter => {
    EXTREME_ENCOUNTER_BIOMES.forEach(biome => {
      const encountersForBiome = mysteryEncountersByBiome.get(biome);
      if (encountersForBiome && !encountersForBiome.includes(encounter)) {
        encountersForBiome.push(encounter);
      }
    });
  });
  // Add non-extreme encounters to biome map
  nonExtremeBiomeEncounters.forEach(encounter => {
    NON_EXTREME_ENCOUNTER_BIOMES.forEach(biome => {
      const encountersForBiome = mysteryEncountersByBiome.get(biome);
      if (encountersForBiome && !encountersForBiome.includes(encounter)) {
        encountersForBiome.push(encounter);
      }
    });
  });
  // Add human encounters to biome map
  humanTransitableBiomeEncounters.forEach(encounter => {
    HUMAN_TRANSITABLE_BIOMES.forEach(biome => {
      const encountersForBiome = mysteryEncountersByBiome.get(biome);
      if (encountersForBiome && !encountersForBiome.includes(encounter)) {
        encountersForBiome.push(encounter);
      }
    });
  });
  // Add civilization encounters to biome map
  civilizationBiomeEncounters.forEach(encounter => {
    CIVILIZATION_ENCOUNTER_BIOMES.forEach(biome => {
      const encountersForBiome = mysteryEncountersByBiome.get(biome);
      if (encountersForBiome && !encountersForBiome.includes(encounter)) {
        encountersForBiome.push(encounter);
      }
    });
  });

  // Add ANY biome encounters to biome map
  let _encounterBiomeTableLog = "";
  mysteryEncountersByBiome.forEach((biomeEncounters, biome) => {
    anyBiomeEncounters.forEach(encounter => {
      if (!biomeEncounters.includes(encounter)) {
        biomeEncounters.push(encounter);
      }
    });

    _encounterBiomeTableLog += `${getBiomeName(biome).toUpperCase()}: [${biomeEncounters
      .map(type => MysteryEncounterType[type].toString().toLowerCase())
      .sort()
      .join(", ")}]\n`;
  });

  //console.debug("All Mystery Encounters by Biome:\n" + encounterBiomeTableLog);
}
