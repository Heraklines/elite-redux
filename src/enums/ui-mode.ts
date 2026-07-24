export enum UiMode {
  MESSAGE,
  TITLE,
  COMMAND,
  FIGHT,
  BALL,
  TARGET_SELECT,
  MODIFIER_SELECT,
  SAVE_SLOT,
  PARTY,
  SUMMARY,
  STARTER_SELECT,
  EVOLUTION_SCENE,
  EGG_HATCH_SCENE,
  EGG_HATCH_SUMMARY,
  CONFIRM,
  OPTION_SELECT,
  MENU,
  MENU_OPTION_SELECT,
  SETTINGS,
  SETTINGS_DISPLAY,
  SETTINGS_AUDIO,
  SETTINGS_GAMEPAD,
  GAMEPAD_BINDING,
  SETTINGS_KEYBOARD,
  KEYBOARD_BINDING,
  ACHIEVEMENTS,
  GAME_STATS,
  EGG_LIST,
  EGG_GACHA,
  AUTO_EGG_RESTOCK,
  POKEDEX,
  POKEDEX_SCAN,
  POKEDEX_PAGE,
  LOGIN_OR_REGISTER,
  LOGIN_FORM,
  REGISTRATION_FORM,
  LOADING,
  SESSION_RELOAD,
  UNAVAILABLE,
  CHALLENGE_SELECT,
  RENAME_POKEMON,
  RENAME_RUN,
  RUN_HISTORY,
  RUN_INFO,
  TEST_DIALOGUE,
  AUTO_COMPLETE,
  ADMIN,
  MYSTERY_ENCOUNTER,
  CHANGE_PASSWORD_FORM,
  LLM_DIRECTOR_THEME_PICKER,
  BUG_REPORT_FORM,
  /** ER #440: the bespoke every-10-waves biome market (full-screen grid shop). */
  BIOME_SHOP,
  /** ER #439: the Colosseum press-your-luck gauntlet choice screen. */
  COLOSSEUM,
  /** ER #439: the compact Quiz/Minigame panel (silhouette / dex multiple-choice). */
  ER_QUIZ,
  /** ER #486: the run's World Map overlay (revealed nodes + Treasure-Map fragments). */
  ER_MAP,
  /** ER #486: the branching World Map node PICKER shown when leaving a biome. */
  ER_MAP_PICKER,
  /** ER QoL: the level-up Move Learn panel (LEARNABLE | CURRENT, silent thin-down). */
  LEARN_MOVE_BATCH,
  /** ER Abyss "The Bargain": Giratina's full-screen deal screen (portrait + bargains). */
  ER_BARGAIN,
  /** ER Shiny Lab: the in-game special-form shiny designer (preview + effect browser). */
  ER_SHINY_LAB,
  /** ER Community Challenges: browse/play community-authored challenge runs. */
  COMMUNITY_CHALLENGES,
  /** ER Community Challenges: the create-a-challenge designer. */
  COMMUNITY_CHALLENGE_CREATE,
  /** ER Community Challenges: a single configurable text-input modal (name/subtitle/description). */
  COMMUNITY_CHALLENGE_TEXT,
  /** ER Profile: the side-nav hub (Ghost Trainer Editor + Run History tabs). */
  PROFILE,
  /** ER Ghost Trainer Editor: author how your published ghost (sprite/name/dialogue) looks to others. */
  GHOST_TRAINER_EDITOR,
  /** Showdown 1v1: the pre-battle WAGER screen (both teams previewed, stake picker, both-ready commit). */
  SHOWDOWN_WAGER,
  /** Showdown 1v1: the full-screen Set Editor (identity column + field rows + shared search pane). */
  SHOWDOWN_SET_EDITOR,
  /** Showdown 1v1: the TEAM PRESET MENU - the new pre-pairing entry screen (build/select before lobby). */
  SHOWDOWN_TEAM_MENU,
  /** Showdown Tournament: the tournament LIST (open / in-progress / finished; register). */
  TOURNAMENT_LIST,
  /** Showdown Tournament: the single-elim BRACKET tree + your-next-match card. */
  TOURNAMENT_BRACKET,
  /** Showdown Sync: the guest commands its canonical enemy-side team in dual-engine mode. */
  SHOWDOWN_SYNC_COMMAND,
}
