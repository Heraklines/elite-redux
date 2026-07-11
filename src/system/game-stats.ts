//  public (.*?): number;
//    this.$1 = source?.$1 || 0;

export class GameStats {
  public playTime: number;
  public battles: number;
  public classicSessionsPlayed: number;
  public sessionsWon: number;
  public ribbonsOwned: number;
  public dailyRunSessionsPlayed: number;
  public dailyRunSessionsWon: number;
  public endlessSessionsPlayed: number;
  public highestEndlessWave: number;
  public highestLevel: number;
  public highestMoney: number;
  public highestDamage: number;
  public highestHeal: number;
  public pokemonSeen: number;
  public pokemonDefeated: number;
  public pokemonCaught: number;
  public pokemonHatched: number;
  public subLegendaryPokemonSeen: number;
  public subLegendaryPokemonCaught: number;
  public subLegendaryPokemonHatched: number;
  public legendaryPokemonSeen: number;
  public legendaryPokemonCaught: number;
  public legendaryPokemonHatched: number;
  public mythicalPokemonSeen: number;
  public mythicalPokemonCaught: number;
  public mythicalPokemonHatched: number;
  public shinyPokemonSeen: number;
  public shinyPokemonCaught: number;
  public shinyPokemonHatched: number;
  public pokemonFused: number;
  public trainersDefeated: number;
  public eggsPulled: number;
  public rareEggsPulled: number;
  public epicEggsPulled: number;
  public legendaryEggsPulled: number;
  public manaphyEggsPulled: number;
  // ER achievement-expansion wave (#900): persistent counters for the count-threshold
  // achievements (Showdown match/win records, Triple Battle win tally). New optional
  // fields default to 0 for legacy saves (the `source?.X || 0` idiom), so an older save
  // loads unchanged and simply starts counting from here.
  public showdownMatchesPlayed: number;
  public showdownWins: number;
  public tripleBattleWins: number;
  // ER achievement-expansion catalog-v2 (#900): account-lifetime counters + bitsets for the
  // 70-achievement catalog (§6.3). Numbers default 0, arrays default [] via the constructor
  // idiom, so an older save loads unchanged and starts counting from here. Bitset arrays hold
  // the DISTINCT ids/keys already credited (dedupe on write); counters saturate at their gate.
  public rankedWinStreak: number;
  public rankedNoMegaWins: number;
  public showdownStakedWins: number;
  public showdownShinyStakeStreak: number;
  public coopPartnerRevives: number;
  public naturalTripleWins: number;
  public naturalGhostWins: number;
  public hellGhostWins: number;
  public sevenSinsOutcomes: string[];
  public mysteryEncounterTypesResolved: number[];
  public relicKindsAcquired: string[];
  public blackMarketRunCount: number;
  public biomeShopTypesPurchased: string[];
  public gachaRarePlusHatchSources: number[];
  public gachaLegendaryHatchSources: number[];
  public shinyLabSpeciesPurchased: number[];
  public presetNamedBossWins: string[];
  public nameFxTrainerWins: number;
  public nameFxWinSpecies: number[];
  public dailySeedsWon: string[];
  public stakeWonSpecies: number[];

  constructor(source?: any) {
    this.playTime = source?.playTime || 0;
    this.battles = source?.battles || 0;
    this.classicSessionsPlayed = source?.classicSessionsPlayed || 0;
    this.sessionsWon = source?.sessionsWon || 0;
    this.ribbonsOwned = source?.ribbonsOwned || 0;
    this.dailyRunSessionsPlayed = source?.dailyRunSessionsPlayed || 0;
    this.dailyRunSessionsWon = source?.dailyRunSessionsWon || 0;
    this.endlessSessionsPlayed = source?.endlessSessionsPlayed || 0;
    this.highestEndlessWave = source?.highestEndlessWave || 0;
    this.highestLevel = source?.highestLevel || 0;
    this.highestMoney = source?.highestMoney || 0;
    this.highestDamage = source?.highestDamage || 0;
    this.highestHeal = source?.highestHeal || 0;
    this.pokemonSeen = source?.pokemonSeen || 0;
    this.pokemonDefeated = source?.pokemonDefeated || 0;
    this.pokemonCaught = source?.pokemonCaught || 0;
    this.pokemonHatched = source?.pokemonHatched || 0;
    // Currently handled by migration
    this.subLegendaryPokemonSeen = source?.subLegendaryPokemonSeen ?? 0;
    this.subLegendaryPokemonCaught = source?.subLegendaryPokemonCaught ?? 0;
    this.subLegendaryPokemonHatched = source?.subLegendaryPokemonHatched ?? 0;
    this.legendaryPokemonSeen = source?.legendaryPokemonSeen || 0;
    this.legendaryPokemonCaught = source?.legendaryPokemonCaught || 0;
    this.legendaryPokemonHatched = source?.legendaryPokemonHatched || 0;
    this.mythicalPokemonSeen = source?.mythicalPokemonSeen || 0;
    this.mythicalPokemonCaught = source?.mythicalPokemonCaught || 0;
    this.mythicalPokemonHatched = source?.mythicalPokemonHatched || 0;
    this.shinyPokemonSeen = source?.shinyPokemonSeen || 0;
    this.shinyPokemonCaught = source?.shinyPokemonCaught || 0;
    this.shinyPokemonHatched = source?.shinyPokemonHatched || 0;
    this.pokemonFused = source?.pokemonFused || 0;
    this.trainersDefeated = source?.trainersDefeated || 0;
    this.eggsPulled = source?.eggsPulled || 0;
    this.rareEggsPulled = source?.rareEggsPulled || 0;
    this.epicEggsPulled = source?.epicEggsPulled || 0;
    this.legendaryEggsPulled = source?.legendaryEggsPulled || 0;
    this.manaphyEggsPulled = source?.manaphyEggsPulled || 0;
    this.showdownMatchesPlayed = source?.showdownMatchesPlayed || 0;
    this.showdownWins = source?.showdownWins || 0;
    this.tripleBattleWins = source?.tripleBattleWins || 0;
    this.rankedWinStreak = source?.rankedWinStreak || 0;
    this.rankedNoMegaWins = source?.rankedNoMegaWins || 0;
    this.showdownStakedWins = source?.showdownStakedWins || 0;
    this.showdownShinyStakeStreak = source?.showdownShinyStakeStreak || 0;
    this.coopPartnerRevives = source?.coopPartnerRevives || 0;
    this.naturalTripleWins = source?.naturalTripleWins || 0;
    this.naturalGhostWins = source?.naturalGhostWins || 0;
    this.hellGhostWins = source?.hellGhostWins || 0;
    this.sevenSinsOutcomes = source?.sevenSinsOutcomes || [];
    this.mysteryEncounterTypesResolved = source?.mysteryEncounterTypesResolved || [];
    this.relicKindsAcquired = source?.relicKindsAcquired || [];
    this.blackMarketRunCount = source?.blackMarketRunCount || 0;
    this.biomeShopTypesPurchased = source?.biomeShopTypesPurchased || [];
    this.gachaRarePlusHatchSources = source?.gachaRarePlusHatchSources || [];
    this.gachaLegendaryHatchSources = source?.gachaLegendaryHatchSources || [];
    this.shinyLabSpeciesPurchased = source?.shinyLabSpeciesPurchased || [];
    this.presetNamedBossWins = source?.presetNamedBossWins || [];
    this.nameFxTrainerWins = source?.nameFxTrainerWins || 0;
    this.nameFxWinSpecies = source?.nameFxWinSpecies || [];
    this.dailySeedsWon = source?.dailySeedsWon || [];
    this.stakeWonSpecies = source?.stakeWonSpecies || [];
  }
}
