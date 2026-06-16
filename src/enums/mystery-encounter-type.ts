export enum MysteryEncounterType {
  MYSTERIOUS_CHALLENGERS,
  MYSTERIOUS_CHEST,
  DARK_DEAL,
  FIGHT_OR_FLIGHT,
  SLUMBERING_SNORLAX,
  TRAINING_SESSION,
  DEPARTMENT_STORE_SALE,
  SHADY_VITAMIN_DEALER,
  FIELD_TRIP,
  SAFARI_ZONE,
  LOST_AT_SEA,
  FIERY_FALLOUT,
  THE_STRONG_STUFF,
  THE_POKEMON_SALESMAN,
  AN_OFFER_YOU_CANT_REFUSE,
  DELIBIRDY,
  ABSOLUTE_AVARICE,
  A_TRAINERS_TEST,
  TRASH_TO_TREASURE,
  BERRIES_ABOUND,
  CLOWNING_AROUND,
  PART_TIMER,
  DANCING_LESSONS,
  WEIRD_DREAM,
  THE_WINSTRATE_CHALLENGE,
  TELEPORTING_HIJINKS,
  BUG_TYPE_SUPERFAN,
  FUN_AND_GAMES,
  UNCOMMON_BREED,
  GLOBAL_TRADE_SYSTEM,
  THE_EXPERT_POKEMON_BREEDER,
  /** ER #439: the Colosseum press-your-luck trainer gauntlet. */
  COLOSSEUM,
  /** ER #439: Town Guessing Booth - silhouette press-your-luck quiz. */
  ER_GUESSING_BOOTH,
  /** ER #439: Professor's Scrambled Pokedex - dex-entry quiz -> Damage Calculator. */
  ER_SCRAMBLED_POKEDEX,
  /** ER #439: Graves of the Fallen - a Graveyard grave of a real ghost-pool team;
   * pay respects for a memento, or disturb it for a level-scaled ghost battle. */
  ER_GRAVES_OF_THE_FALLEN,
  /** ER #439: Woodland Forager - a Forest press-your-luck forage loop; bank the
   * haul or push for more, risking a territorial Bug-swarm interrupt fight. */
  ER_WOODLAND_FORAGER,
  /** ER #439: Glittering Vein - a Cave press-your-luck mining loop; bank the haul
   * or keep digging for more, risking a cave-in / Rock-Ground ambush fight. */
  ER_GLITTERING_VEIN,
  /** ER #439: The Mushroom Circle - a Grass one-shot gamble; taste a fairy-ring
   * mushroom for a candy windfall or a curse-lite money nip. */
  ER_MUSHROOM_CIRCLE,
  /** ER #439: Town Raffle - a Town relic gamble; pay a fee and draw a ticket for a
   * tiered prize, with a small chance at a rare Formation Relic. */
  ER_TOWN_RAFFLE,
  /** ER #439: The Overgrown Temple - a Jungle press-your-luck delve; bank the haul
   * or press deeper for richer treasure, risking a trap / Grass-Rock guardian. */
  ER_OVERGROWN_TEMPLE,
  /** Synthetic type used by the LLM Director for runtime-built encounters
   * (dialogue beats authored by the model). Never appears in `allMysteryEncounters`
   * — the encounter instance is pre-set on `currentBattle.mysteryEncounter`. */
  LLM_DIRECTED,
}
