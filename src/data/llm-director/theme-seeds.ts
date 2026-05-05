/**
 * Theme seeds — the LLM Director rolls one of these to bootstrap a story bible.
 *
 * Each entry is a tonal hint and a 1-line prompt; they are intentionally varied
 * (light/dark/comedic/tragic/mature/surreal) so re-rolling produces a meaningful
 * tonal shift, not just noise on the same arc.
 *
 * Add seeds liberally — they cost nothing at runtime. v1 ships ~50.
 */

export interface ThemeSeed {
  readonly id: string;
  readonly text: string;
  readonly tones: readonly string[];
}

export const THEME_SEEDS: readonly ThemeSeed[] = [
  // — Mafia / underground —
  {
    id: "underground-fixed-tournament",
    text: "Underground Pokémon tournament where every match is fixed except yours.",
    tones: ["mafia", "tense"],
  },
  {
    id: "league-collapse-mafias",
    text: "The League collapsed; rival mafias now run the gym circuit.",
    tones: ["dystopian", "political"],
  },
  {
    id: "smuggler-quartet",
    text: "Four smuggling families control the ports; you owe one of them a favor.",
    tones: ["mafia", "intrigue"],
  },
  {
    id: "debt-collector",
    text: "You travel as a Pokémon-debt collector for an aging crime boss.",
    tones: ["mafia", "moral-grey"],
  },

  // — Religion / cult —
  {
    id: "saint-with-a-price",
    text: "A forgotten saint walks among the towers, healing the ill — for a price.",
    tones: ["religious", "ambiguous"],
  },
  {
    id: "forest-cult",
    text: "The forests have a new religion. The Pokémon are its prophets.",
    tones: ["mystery", "occult"],
  },
  {
    id: "heretic-evangelist",
    text: "A wandering heretic evangelist preaches that legendaries are imposters.",
    tones: ["religious", "subversive"],
  },
  {
    id: "drowned-god",
    text: "The coastal villages whisper of a drowned god rising in their nets.",
    tones: ["horror", "religious"],
  },

  // — Mystery / investigative —
  {
    id: "champion-mystery",
    text: "The reigning Champion has gone missing. Someone is impersonating them.",
    tones: ["mystery", "investigative"],
  },
  {
    id: "memory-thief",
    text: "Trainers across the region are losing memories of their first Pokémon.",
    tones: ["mystery", "melancholy"],
  },
  {
    id: "lost-route",
    text: "An old route map shows a town that no longer exists. It calls to you.",
    tones: ["mystery", "haunting"],
  },
  {
    id: "false-pokedex",
    text: "Half the entries in your Pokédex are subtly, deliberately wrong.",
    tones: ["mystery", "paranoid"],
  },

  // — Horror —
  {
    id: "haunted-lighthouse",
    text: "A coastal lighthouse where the tides bring back the dead.",
    tones: ["horror", "melancholy"],
  },
  {
    id: "midnight-gym",
    text: "A gym only opens at midnight, and its leader has not been seen in years.",
    tones: ["horror", "mystery"],
  },
  {
    id: "shadow-region",
    text: "An entire region disappears from maps after dusk.",
    tones: ["horror", "surreal"],
  },
  {
    id: "kindred-rot",
    text: "A creeping disease binds trainer to Pokémon: when one suffers, both do.",
    tones: ["horror", "tragic"],
  },

  // — Surreal / whimsical —
  {
    id: "interdimensional-circus",
    text: "An interdimensional traveling circus stops in this region for one week.",
    tones: ["surreal", "whimsical"],
  },
  {
    id: "talking-pokemon-strike",
    text: "Pokémon worldwide have started talking — and they are organizing a strike.",
    tones: ["surreal", "comedic"],
  },
  {
    id: "dream-trader",
    text: "A trader in a small town deals only in dreams. Pokémon are the currency.",
    tones: ["surreal", "ambiguous"],
  },
  {
    id: "mirror-region",
    text: "Every town here has a mirror version where the trainers are villains.",
    tones: ["surreal", "ominous"],
  },

  // — Political / tragic —
  {
    id: "war-of-the-clans",
    text: "Five rival clans fight a generations-old feud over a sacred Pokémon.",
    tones: ["political", "tragic"],
  },
  {
    id: "annexation",
    text: "A neighboring region has been annexed; the gyms are now occupation outposts.",
    tones: ["political", "grim"],
  },
  {
    id: "exiled-prince",
    text: "An exiled prince is raising a rebel team in the badlands.",
    tones: ["political", "epic"],
  },
  {
    id: "famine-summer",
    text: "A long summer has emptied the wild. Trainers fight over the last Pokémon.",
    tones: ["tragic", "scarcity"],
  },

  // — Heist / caper —
  {
    id: "champions-vault",
    text: "The previous Champion's vault holds a secret; you have one week to crack it.",
    tones: ["heist", "tense"],
  },
  {
    id: "pokestar-conspiracy",
    text: "A famous PokéStar director is secretly funding battlefield experiments.",
    tones: ["mystery", "heist"],
  },
  {
    id: "auction-house",
    text: "An invitation-only auction house trades in shiny Pokémon and worse.",
    tones: ["mafia", "moral-grey"],
  },

  // — Comedic / light —
  {
    id: "rival-bakery",
    text: "Your rival quit being a trainer to open a bakery. They are very good at it.",
    tones: ["comedic", "light"],
  },
  {
    id: "intern-champion",
    text: "The Champion's intern is running the league while the Champion is on vacation.",
    tones: ["comedic", "light"],
  },
  {
    id: "tour-guide-job",
    text: "You take a side job as a tour guide. The tourists keep getting kidnapped.",
    tones: ["comedic", "tense"],
  },

  // — Mature / morally complex —
  {
    id: "mercy-killing",
    text: "An old gym leader asks you to put down their final, suffering Pokémon.",
    tones: ["mature", "tragic"],
  },
  {
    id: "ex-team",
    text: "Your starter pokemon was taken from a now-defunct evil team. Survivors hunt you.",
    tones: ["mature", "tense"],
  },
  {
    id: "trolley-problem",
    text: "A scientist offers a cure for one Pokémon's disease — at the cost of another's freedom.",
    tones: ["mature", "moral-grey"],
  },
  {
    id: "champion-burden",
    text: "You ARE the Champion, in hiding. The new league is hunting you.",
    tones: ["mature", "epic"],
  },

  // — Romance / character-driven —
  {
    id: "rival-courtship",
    text: "Two rival trainers are courting you with increasingly elaborate gestures.",
    tones: ["romance", "comedic"],
  },
  {
    id: "lost-friend",
    text: "An old friend disappeared after a botched battle. Their Pokémon are looking for them.",
    tones: ["melancholy", "mystery"],
  },
  {
    id: "letters-home",
    text: "Each town has a letter waiting for you from someone who knows your future.",
    tones: ["mystery", "intimate"],
  },

  // — Cosmic / mythic —
  {
    id: "legendary-conclave",
    text: "Three legendaries have called a council. They are debating whether humans deserve Pokémon.",
    tones: ["mythic", "philosophical"],
  },
  {
    id: "sky-pillar",
    text: "A new pillar has risen from the ocean. Things are climbing down from it.",
    tones: ["horror", "mythic"],
  },
  {
    id: "calendar-error",
    text: "Time is running slightly faster in this region. Pokémon age in real-time.",
    tones: ["surreal", "tragic"],
  },
  {
    id: "memory-of-arceus",
    text: "Arceus remembers a different history of this world. It wants you to remember it too.",
    tones: ["mythic", "philosophical"],
  },

  // — Survival / scarcity —
  {
    id: "frozen-route",
    text: "The route ahead is locked in an unnatural winter. Towns ration heat by the hour.",
    tones: ["survival", "grim"],
  },
  {
    id: "last-trainer",
    text: "You may be the last trainer in a region that has decided to outlaw the practice.",
    tones: ["dystopian", "tragic"],
  },
  {
    id: "plague-towns",
    text: "A plague jumps between Pokémon and trainers. Quarantine lines split every town.",
    tones: ["survival", "horror"],
  },

  // — Espionage —
  {
    id: "double-agent",
    text: "You're a double agent for two evil teams. Neither knows about the other.",
    tones: ["espionage", "tense"],
  },
  {
    id: "league-spy",
    text: "The Elite Four suspects a mole in their ranks. You're the mole.",
    tones: ["espionage", "moral-grey"],
  },

  // — Industrial / steampunk —
  {
    id: "factory-region",
    text: "The factories of this region run on captured Pokémon. The workers are trying to free them.",
    tones: ["dystopian", "political"],
  },
  {
    id: "rail-magnate",
    text: "A railway magnate is buying every gym leader. The trains arrive precisely on time.",
    tones: ["political", "mystery"],
  },
  {
    id: "ghost-radio",
    text: "A pirate radio station broadcasts dialogue from battles that haven't happened yet.",
    tones: ["mystery", "ominous"],
  },
  {
    id: "child-prodigy",
    text: "A nine-year-old has won every gym in record time. Nobody knows where they came from.",
    tones: ["mystery", "investigative"],
  },
] as const;
