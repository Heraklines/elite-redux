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
  /** ER #439: Tide Pools - a Beach press-your-luck comb; bank the haul or keep
   * combing for more, risking a territorial Water guardian sweeping in. */
  ER_TIDE_POOLS,
  /** ER #439: The Abyssal Vent - a Seabed press-your-luck delve; bank the haul or
   * dive deeper for richer treasure, risking a deep-sea guardian. */
  ER_ABYSSAL_VENT,
  /** ER #439: The Hot Spring - a Mountain rest; pay a small fee to soak and fully
   * restore the whole party (HP, status, PP, fainted revived). */
  ER_HOT_SPRING,
  /** ER #439: The Fairy's Boon - a Fairy Cave benevolent gift; accept a blessing
   * to receive a random Formation/buff Relic. */
  ER_FAIRYS_BOON,
  /** ER #439: The Picnic - a Meadow social rest; lay out a spread for Candy and
   * affection across the whole party. */
  ER_PICNIC,
  /** ER #439: The Exotic Trader - a Sea premium market; pay a fee to browse a
   * top-shelf, high-tier reward selection. */
  ER_EXOTIC_TRADER,
  /** ER #439: The Totem Trial - a Temple guardian-boss trial; beat the aura totem
   * (multi-bar boss) for a guaranteed high-tier reward + a Relic. */
  ER_TOTEM_TRIAL,
  /** ER #439: The Black Market - a Slum bargain market; browse cheap "used" goods
   * for a mixed-tier reward selection. */
  ER_BLACK_MARKET,
  /** ER #439: The Lake Spirit - a Lake knowledge trial; answer a guardian's
   * Pokedex riddles for Candy + a blessing scaled to how many you get right. */
  ER_LAKE_SPIRIT,
  /** ER #439: The Import Bazaar - an Island market of goods exclusive to other
   * biomes; browse a curated selection of useful held-item imports. */
  ER_IMPORT_BAZAAR,
  /** ER #439: The Sealed Door - a Ruins glyph puzzle; read the silhouettes to open
   * the vault for a high-tier reward. */
  ER_SEALED_DOOR,
  /** ER #439: Overcharge the Core - a Power Plant guardian-boss trial; best the
   * overcharged Electric guardian for a high-tier reward + a Relic. */
  ER_OVERCHARGE_CORE,
  /** ER #439: Frozen Shapes - an Ice Cave silhouette puzzle; name the shapes
   * trapped in the ice for a reward scaled to your reads. */
  ER_FROZEN_SHAPES,
  /** ER #439: The Foreman's Job - a Construction Site guardian-boss trial; clear
   * the rampaging construction golem for a high-tier reward + a Relic. */
  ER_FOREMANS_JOB,
  /** ER #439: The Aurora - a Snowy Forest blessing; stand under the rare lights
   * for a fleeting high-tier reward. */
  ER_AURORA,
  /** ER #439: The Experiment - a Laboratory gamble; run the experiment for a
   * high-tier reward, with a small chance it backfires. */
  ER_EXPERIMENT,
  /** ER #439: The Salvage Yard - a Factory market of reclaimed parts; browse a
   * curated held-item selection. */
  ER_SALVAGE_YARD,
  /** ER #439: The Gentle Giant - a Grass-biome catch event; a docile Grass titan
   * you can battle (and catch) or leave in peace. */
  ER_GENTLE_GIANT,
  /** ER #439: Rustling Grass - a Tall Grass catch event; a rare hidden mon bursts
   * out - battle and catch it, or let it flee. */
  ER_RUSTLING_GRASS,
  /** ER #439: The Dragon's Hoard - a Wasteland catch event; a hoarder dragon
   * guarding a pile of held items - beat it for the hoard, or catch the dragon. */
  ER_DRAGONS_HOARD,
  /** ER #439: Still Waters - a Lake mirror-match; a still lake reflects your team,
   * and the reflection steps out to fight (a clone of your current squad). */
  ER_STILL_WATERS,
  /** ER #486: Message in a Bottle - a Sea/Beach event; a bottle washes up holding
   * a Treasure-Map fragment and charts a nearby location onto the World Map. */
  ER_MESSAGE_IN_A_BOTTLE,
  /** ER #486: X Marks the Spot - a Beach event; with 3 Treasure-Map fragments in
   * hand, dig up the buried cache for a guaranteed reward. */
  ER_X_MARKS_THE_SPOT,
  /** ER #486: The Observatory - a Space event; chart the heavens to reveal the
   * onward routes and a distant landmark onto the World Map. */
  ER_OBSERVATORY,
  /** ER #486: Echo Chamber - a Cave event; the cavern's echoes map the tunnels
   * ahead (reveal onward routes). */
  ER_ECHO_CHAMBER,
  /** ER #486: The Informant - a Slum event; pay for a tip-off that charts the
   * onward routes (and sometimes a fragment). */
  ER_INFORMANT,
  /** ER #486: The Storm - a Sea event; a squall sweeps the party off-course to a
   * random onward biome (sets a travel target). */
  ER_THE_STORM,
  /** ER #486: Ultra Wormhole - a Space event; step through to be flung to a random
   * onward biome (sets a travel target). */
  ER_ULTRA_WORMHOLE,
  /** Synthetic type used by the LLM Director for runtime-built encounters
   * (dialogue beats authored by the model). Never appears in `allMysteryEncounters`
   * — the encounter instance is pre-set on `currentBattle.mysteryEncounter`. */
  LLM_DIRECTED,
}
