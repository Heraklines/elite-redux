/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Tier-2 REAL-PAGE render harness - renders a real UiHandler page to a PNG for
// visual / layout bug reproduction. Boots a full headless GameManager (data +
// every handler) and renders through a real @napi-rs CANVAS scene (see
// ./render-harness for the machinery + how it works).
//
// Add a page: drop a recipe in PAGE_RECIPES. Two shapes:
//   - { mode, prepare? }   a registered handler driven by show(args); prepare(game)
//                          does run setup (startBattle / encounter / dex flags) and
//                          returns the show() args.
//   - { render(game,ctx) } a fully custom build, for screens that aren't a
//                          registered-handler show() (egg-hatch card, starter detail).
// Assets configure themselves (two-pass injector).
//
// Run:  ER_SCENARIO=1 ER_RENDER_PAGE=<page> pnpm vitest run test/tools/render-ui-page.test.ts
// Repro a missing on-demand sprite (e.g. the staging Giratina bug):
//       ... ER_SIMULATE_MISSING=1 ...
// Out:  dev-logs/ui-pages/<page>[-missing].png   (gitignored)
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { allAbilities, modifierTypes } from "#data/data-lists";
import { Egg } from "#data/egg";
import { EggHatchData } from "#data/egg-hatch-data";
import { startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { bargainAbilityDescription } from "#data/elite-redux/er-bargain-sins";
import { applyErBlackShinyKit } from "#data/elite-redux/er-black-shinies";
import { buildInfernoFeed } from "#data/elite-redux/er-community-challenge-inferno";
import { buildDemoChallengesConfig } from "#data/elite-redux/er-community-challenges";
import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";
import { recordErBiomeVisited } from "#data/elite-redux/er-map-nodes";
import { STORMGLASS_WEATHER_CHOICES } from "#data/elite-redux/er-relics";
import {
  ER_SHINY_LAB_DEFAULT_PARAMS,
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  encodeErShinyLabLoadout,
  encodeErShinyLabParams,
  setErShinyLabOwnedBit,
  unlockErShinyLabNameFx,
} from "#data/elite-redux/er-shiny-lab-effects";
import { listMegaStages } from "#data/elite-redux/showdown/showdown-evolutions";
import { manifestToStarter } from "#data/elite-redux/showdown/showdown-manifest";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { DexAttr } from "#enums/dex-attr";
import { EggTier } from "#enums/egg-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import {
  type ErTmCaseModifierType,
  getPlayerShopModifierTypeOptionsForWave,
  ModifierTypeOption,
} from "#modifiers/modifier-type";
import { allMysteryEncounters } from "#mystery-encounters/mystery-encounters";
import { achvs } from "#system/achv";
import { VoucherType } from "#system/voucher";
import type { GameManager } from "#test/framework/game-manager";
import { GameManager as GameManagerClass } from "#test/framework/game-manager";
import {
  createRenderScene,
  findSuspectSprites,
  freezeAnimations,
  injectMissing,
  pixelDiff,
  type RenderContext,
  renderBattlefield,
  renderTwoPass,
  repointGlobalScene,
  restoreGlobalScene,
} from "#test/tools/render-harness";
import { buildDemoConfig } from "#ui/er-shiny-lab-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import { SaveSlotUiMode } from "#ui/save-slot-select-ui-handler";
import { buildShowdownEditorDemoConfig, EditorField } from "#ui/showdown-set-editor-ui-handler";
import { buildShowdownTeamMenuDemoConfig } from "#ui/showdown-team-menu-ui-handler";
import type { ShowdownWagerArgs } from "#ui/showdown-wager-ui-handler";
import { buildTournamentBracketDemoConfig } from "#ui/tournament-bracket-ui-handler";
import { buildTournamentListDemoConfig } from "#ui/tournament-list-ui-handler";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
// ER_RENDER_PAGE: a single page, a comma-separated list, or "all" to render every recipe
// in ONE boot (the GameManager reuses globalScene across pages, so the ~30-50s ER init is
// paid once). With `pnpm vitest` (no `run`) you also get watch-mode re-render on save.
const PAGE_ARG = (process.env.ER_RENDER_PAGE ?? "bargain").trim();
const SIMULATE_MISSING = process.env.ER_SIMULATE_MISSING === "1";
// Golden-image regression gate. Baselines live in test/tools/ui-baselines/<page>.png.
// First run (or ER_UPDATE_BASELINE=1) writes the baseline; later runs pixel-diff against it
// and FAIL if more than ER_DIFF_TOLERANCE pixels changed (writes <page>-diff.png).
const UPDATE_BASELINE = process.env.ER_UPDATE_BASELINE === "1";
const DIFF_TOLERANCE = Math.max(0, Number(process.env.ER_DIFF_TOLERANCE ?? "0") || 0);
const BASELINE_DIR = join("test", "tools", "ui-baselines");

interface Recipe {
  /** Registered-handler page: which handler, + how to build show() args. */
  mode?: UiMode;
  prepare?: (game: GameManager) => any[] | Promise<any[]>;
  /**
   * Phase-flow bridge: instead of a static `mode`, DRIVE the real game through phases in
   * `prepare(game)` (startBattle, run turns, reach a phase) and render WHATEVER screen the
   * phase pipeline transitioned to last. The harness wraps `ui.setMode` during `prepare` to
   * capture the final `(mode, args)`, then renders that handler. Lets you snapshot mid-run
   * screens (the in-battle command menu, post-battle reward, etc.) without hand-building args.
   * NOTE: pair with `field: true` to also draw the battlefield beneath the handler.
   */
  captureActive?: boolean;
  /**
   * Render the BATTLEFIELD beneath the page: arena bg + platforms, on-field pokemon
   * sprites, trainer, and fresh BattleInfo HP bars, rebuilt from live game state
   * (see renderBattlefield in render-harness). Pair with `captureActive` + a
   * `prepare` that drives a battle to the state you want to see. Visibility mirrors
   * the live scene graph, so lingering/fainted-but-shown field objects reproduce.
   */
  field?: boolean;
  /** Fully custom page: build + show the UI directly into the render scene. */
  render?: (game: GameManager, ctx: RenderContext) => void | Promise<void>;
  /**
   * Optional input sequence fired AFTER the page renders. Each `Button` is routed to the
   * currently-active handler (so a press that transitions to another screen renders that
   * screen too), with a `<page>-stepN.png` snapshot after each press. The main `<page>.png`
   * becomes the FINAL state. Set `expectThrow` for a crash/softlock repro recipe (the test
   * then asserts a press DID throw rather than asserting it didn't).
   */
  steps?: Button[];
  expectThrow?: boolean;
  /**
   * Stepped-animation mode: capture this many successive LIVE frames (no freeze) as
   * `<page>-frameNN.png` after the page is built + input fired. Turns the still into a
   * flip-book so animation / sprite-race bugs (e.g. the rapid-cycle stuck-sprite class,
   * #140/#144) are reproducible. Env `ER_FRAMES=N` overrides for any page.
   */
  frames?: number;
  /**
   * Per-page golden-diff tolerance override (px). Default is the global ER_DIFF_TOLERANCE (0,
   * i.e. pixel-exact). Pages with a live ANIMATED battle/hatch sprite (its async
   * loadAssets().then(play) lands on a wall-clock-dependent frame, so the sprite region is
   * inherently non-deterministic here) set a coarse tolerance: the gate then catches gross
   * breakage of the whole screen but not sprite-internal jitter. All other pages stay exact.
   */
  diffTolerance?: number;
}

const CAUGHT = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

/** Mark a species fully caught so the full render branch runs, return its species object. */
function caughtSpecies(game: GameManager, id: SpeciesId) {
  const dex = game.scene.gameData.dexData[id];
  const starter = game.scene.gameData.starterData[id];
  if (dex) {
    dex.caughtAttr = CAUGHT;
    dex.seenAttr = CAUGHT;
  }
  if (starter) {
    starter.abilityAttr = 1;
  }
  return getPokemonSpecies(id);
}

function caughtShinyLabSpecies(game: GameManager, id: SpeciesId) {
  const species = caughtSpecies(game, id);
  const shinyAttr = (CAUGHT | DexAttr.SHINY) & ~DexAttr.NON_SHINY;
  const dex = game.scene.gameData.dexData[id];
  const starter = game.scene.gameData.starterData[id];
  const palette = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette.find(e => e.id === "duoneon");
  const surface = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.surface.find(e => e.id === "starmap");
  const around = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.around.find(e => e.id === "staticfield");
  if (!palette || !surface || !around) {
    throw new Error("starter-select-shiny-lab recipe: unknown Shiny Lab effect");
  }
  if (dex) {
    dex.caughtAttr = shinyAttr;
    dex.seenAttr = shinyAttr;
  }
  if (starter) {
    starter.erShinyLab ??= {};
    const save = starter.erShinyLab;
    setErShinyLabOwnedBit(save, "palette", palette.index);
    setErShinyLabOwnedBit(save, "surface", surface.index);
    setErShinyLabOwnedBit(save, "around", around.index);
    save.l = encodeErShinyLabLoadout({ palette: palette.id, surface: surface.id, around: around.id });
    // Name FX unlocked + on, so the detail-panel NAME renders in the palette's accent
    // colour (the maintainer "Name FX doesn't appear" repro - any shiny, no tier gate).
    save.q = encodeErShinyLabParams({ ...ER_SHINY_LAB_DEFAULT_PARAMS, nameFx: true });
    unlockErShinyLabNameFx(save);
  }
  return species;
}

/** Page.ABILITIES is module-local (not exported) in summary-ui-handler; its value is 1. */
const SUMMARY_PAGE_ABILITIES = 1;
/** Three clearly-distinct gift choices so the cycled row's NAME visibly changes each press. */
const GIFT_CHOICES: [AbilityId, AbilityId, AbilityId] = [AbilityId.STURDY, AbilityId.LEVITATE, AbilityId.INTIMIDATE];

/**
 * Start a battle whose player lead is a BLACK SHINY (#349) with a deterministic 3-choice
 * gift slot at index 0, and return that PlayerPokemon. Used by the `summary` recipe + the
 * gift-cycle before/after verification below. We seed the kit (sets erBlackShiny) then pin
 * the gift list explicitly so the cycled ability name is predictable (the natural roll is a
 * random pool draw).
 */
async function startBattleWithBlackShinyLead(game: GameManager) {
  await game.classicMode.startBattle(SpeciesId.GARCHOMP);
  const mon = game.scene.getPlayerPokemon();
  if (!mon) {
    throw new Error("summary recipe: no player pokemon after startBattle");
  }
  applyErBlackShinyKit(mon); // flips customPokemonData.erBlackShiny = true
  mon.customPokemonData.erBlackShiny = true;
  mon.customPokemonData.erGiftAbilities = [...GIFT_CHOICES];
  mon.customPokemonData.erGiftIndex = 0;
  return mon;
}

async function startBattleWithShinyLabLead(game: GameManager, id: SpeciesId = SpeciesId.BULBASAUR) {
  caughtShinyLabSpecies(game, id);
  await game.classicMode.startBattle(id);
  const mon = game.scene.getPlayerPokemon();
  if (!mon) {
    throw new Error("shiny lab render recipe: no player pokemon after startBattle");
  }
  mon.shiny = true;
  mon.variant = 0;
  await mon.loadAssets();
  return mon;
}

function bargainArgs(): any[] {
  const labels = ["Gluttony", "Sloth", "Pride", "Greed", "Wrath", "Envy", "Lust", "Leave"];
  const descs = [
    "Gorge for power",
    "Rest, lose tempo",
    "+30% to one stat",
    "Riches, at a cost",
    "Rage unbound",
    "Covet a relic",
    "Crave, be cursed",
    "",
  ];
  const offers = labels.slice(0, -1).map(l => `So you choose ${l}... a fine ruin.`);
  return [
    labels,
    descs,
    "So. A human wanders into my hollow. How rare. How convenient.",
    offers,
    () => {},
    () => {},
    () => {},
  ];
}

/**
 * The Curiosity 7-ability picker (the 8th Bargain deal), driving ErBargainUiHandler
 * in its generic PICKER mode. Seven real abilities with their resolved in-game
 * descriptions, in the Bargain aesthetic (void backdrop, Giratina, violet frames,
 * focused-row description sub-box). Fixed abilities keep the golden deterministic.
 */
function curiosityPickerArgs(): any[] {
  const abilities = [
    AbilityId.INTIMIDATE,
    AbilityId.DROUGHT,
    AbilityId.LEVITATE,
    AbilityId.MOXIE,
    AbilityId.MAGIC_GUARD,
    AbilityId.REGENERATOR,
    AbilityId.PROTEAN,
  ];
  return [
    {
      picker: true,
      title: "CURIOSITY",
      greeting: "Seven powers, drawn from the dark at random. Choose the one you would graft.",
      options: abilities.map(id => ({
        label: allAbilities[id]?.name ?? "",
        description: bargainAbilityDescription(id),
      })),
      onPick: () => {},
      onCancel: () => {},
    },
  ];
}

/**
 * The ER Greater Ability Randomizer 4-ability picker (Master-Ball tier), driving
 * ErBargainUiHandler in its generic PICKER mode - the SAME chooser Curiosity uses,
 * generalized to 4 options. Four real abilities with their resolved in-game
 * descriptions, in the Bargain aesthetic. Fixed abilities keep the golden deterministic.
 */
function greaterRandomizerPickerArgs(): any[] {
  const abilities = [AbilityId.DROUGHT, AbilityId.MAGIC_GUARD, AbilityId.REGENERATOR, AbilityId.PROTEAN];
  return [
    {
      picker: true,
      title: i18next.t("modifierType:erGreaterAbilityRandomizer.name").toUpperCase(),
      greeting: i18next.t("modifierType:erGreaterAbilityRandomizer.pickAbility"),
      options: abilities.map(id => ({
        label: allAbilities[id]?.name ?? "",
        description: bargainAbilityDescription(id),
      })),
      onPick: () => {},
      onCancel: () => {},
    },
  ];
}

/**
 * Seed a deterministic ~1/3 of the achievement registry as unlocked (every 3rd entry, the
 * first one - CLASSIC_VICTORY - kept LOCKED). With `distinct`, each gets a unique incrementing
 * timestamp so the "Recent" view's newest-first ordering is reproducible; otherwise a single
 * fixed timestamp. All timestamps stay within one UTC day so the rendered unlock date is
 * stable. Returns [] (the achievements handler ignores show() args).
 */
function seedAchvUnlocks(game: GameManager, distinct = false): any[] {
  const base = 1_700_000_000_000;
  Object.keys(achvs).forEach((id, i) => {
    if (i % 3 === 1) {
      game.scene.gameData.achvUnlocks[id] = distinct ? base + i * 1000 : base;
    }
  });
  return [];
}

/**
 * A realistic Colosseum standings board (#439): a 15-entrant gauntlet mid-run (4 rounds
 * cleared). Mirrors what ColosseumChoicePhase builds - each row's spriteKey is the trainer
 * class atlas key (`trainerConfigs[t].getSpriteKey`, so the two-pass injector resolves the
 * class portrait), tier drives the tag, and only cleared + next-up rows are revealed (the
 * rest render as dark silhouettes). Champion is the final, gold-trophy row. Args match the
 * handler's `show([data, onChoice])`.
 */
function colosseumDemoArgs(): any[] {
  const roster: [TrainerType, string][] = [
    [TrainerType.YOUNGSTER, "normal"],
    [TrainerType.SWIMMER, "normal"],
    [TrainerType.SCHOOL_KID, "normal"],
    [TrainerType.CYCLIST, "normal"],
    [TrainerType.BLACK_BELT, "ghost"],
    [TrainerType.ACE_TRAINER, "ghost"],
    [TrainerType.VETERAN, "gym"],
    [TrainerType.HIKER, "gym"],
    [TrainerType.BEAUTY, "normal"],
    [TrainerType.RICH_KID, "normal"],
    [TrainerType.PSYCHIC, "boss"],
    [TrainerType.SCIENTIST, "boss"],
    [TrainerType.BREEDER, "gym"],
    [TrainerType.PARASOL_LADY, "ghost"],
    [TrainerType.CYNTHIA, "champion"],
  ];
  const tierTag: Record<string, string> = {
    normal: "Normal",
    ghost: "Ghost",
    boss: "Boss",
    gym: "Gym",
    champion: "Champion",
  };
  const wins = 4; // 4 rounds cleared -> rows 0..4 revealed, the rest silhouettes.
  const challengers = roster.map(([type, tier], i) => ({
    name: trainerConfigs[type]?.name || TrainerType[type],
    spriteKey: trainerConfigs[type]?.getSpriteKey(false, false) ?? "veteran_m",
    tier: tierTag[tier],
    revealed: i <= wins,
  }));
  const data = {
    round: wins,
    totalRounds: roster.length,
    tierLabel: "B",
    nextTierLabel: "B+",
    challengers,
  };
  return [data, () => {}];
}

/**
 * Build + show a registered handler exactly the way the it()-body mode path does (fresh
 * instance against the re-pointed scene), but first add no-op shims for the few
 * Container-backed UI-surface methods the render mock omits (`moveTo` / `length`, which the
 * real `ui` inherits from Phaser.Container). Handlers that reorder their own container on
 * show() (GAME_STATS / CHALLENGE_SELECT / MENU) call these and otherwise crash. `moveTo`
 * returns the ui so handlers that CHAIN off it (GAME_STATS does `.moveTo(...).hideTooltip()`)
 * don't crash on an undefined return. We only touch the live mock ui object - never the harness.
 */
function shimUiAndShow(game: GameManager, mode: UiMode, args: any[]): any {
  const ui: any = game.scene.ui;
  ui.moveTo ??= () => ui;
  if (typeof ui.length !== "number") {
    ui.length = 0;
  }
  const registered: any = ui.handlers[mode];
  let handler: any = registered;
  try {
    handler = new registered.constructor();
  } catch {
    handler = registered;
  }
  handler.setup();
  handler.show(args);
  ui.setActiveHandler?.(handler);
  return handler;
}

/** Build the demo args for the Showdown WAGER screen (D3): two full teams + an opponent profile. */
function showdownWagerArgs(): [ShowdownWagerArgs] {
  const mon = (over: Partial<ShowdownMonManifest>): ShowdownMonManifest => ({
    speciesId: SpeciesId.BULBASAUR,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    nature: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [MoveId.TACKLE, MoveId.GROWL, MoveId.VINE_WHIP, MoveId.LEECH_SEED],
    item: "LEFTOVERS",
    rootSpeciesId: SpeciesId.BULBASAUR,
    erBlackShiny: false,
    baseCost: 4,
    ...over,
  });
  // A real mega form (for the mega badge); fall back to base if the line exposes none headlessly.
  const charMega = listMegaStages(SpeciesId.CHARIZARD)[0];
  const ownTeam: ShowdownMonManifest[] = [
    mon({
      speciesId: SpeciesId.BLASTOISE,
      rootSpeciesId: SpeciesId.BLASTOISE,
      shiny: true,
      variant: 2,
      item: "SHELL_BELL",
      baseCost: 7,
    }),
    mon({ speciesId: SpeciesId.VENUSAUR, rootSpeciesId: SpeciesId.VENUSAUR, item: "LEFTOVERS", baseCost: 7 }),
    charMega == null
      ? mon({ speciesId: SpeciesId.CHARIZARD, rootSpeciesId: SpeciesId.CHARIZARD, item: "FLAME_ORB", baseCost: 8 })
      : mon({
          speciesId: charMega.speciesId,
          formIndex: charMega.formIndex,
          rootSpeciesId: SpeciesId.CHARIZARD,
          item: "MEGA_STONE",
          baseCost: 8,
        }),
    mon({
      speciesId: SpeciesId.PIKACHU,
      rootSpeciesId: SpeciesId.PIKACHU,
      shiny: true,
      variant: 0,
      item: "FOCUS_BAND",
      baseCost: 3,
    }),
    mon({ speciesId: SpeciesId.SNORLAX, rootSpeciesId: SpeciesId.SNORLAX, item: "TOXIC_ORB", baseCost: 6 }),
    mon({ speciesId: SpeciesId.GYARADOS, rootSpeciesId: SpeciesId.GYARADOS, item: "QUICK_CLAW", baseCost: 6 }),
  ];
  const opponentTeam: ShowdownMonManifest[] = [
    mon({ speciesId: SpeciesId.TYRANITAR, rootSpeciesId: SpeciesId.LARVITAR, item: "LEFTOVERS", baseCost: 7 }),
    mon({ speciesId: SpeciesId.GENGAR, rootSpeciesId: SpeciesId.GASTLY, item: "KINGS_ROCK", baseCost: 6 }),
    mon({
      speciesId: SpeciesId.ALAKAZAM,
      rootSpeciesId: SpeciesId.ABRA,
      shiny: true,
      variant: 1,
      item: "FOCUS_BAND",
      baseCost: 6,
    }),
    mon({ speciesId: SpeciesId.DRAGONITE, rootSpeciesId: SpeciesId.DRATINI, item: "FLAME_ORB", baseCost: 7 }),
    mon({ speciesId: SpeciesId.LAPRAS, rootSpeciesId: SpeciesId.LAPRAS, item: "SHELL_BELL", baseCost: 6 }),
    mon({ speciesId: SpeciesId.MACHAMP, rootSpeciesId: SpeciesId.MACHOP, item: "TOXIC_ORB", baseCost: 6 }),
  ];
  const opponentProfile: GhostTrainerProfile = { displayName: "Rival Red", title: "Champion" };
  const args: ShowdownWagerArgs = {
    ownTeam,
    opponentTeam,
    opponentProfile,
    role: "host",
    transport: null,
    rendezvous: null,
    onCommit: () => {},
  };
  return [args];
}

const RECIPES: Record<string, Recipe> = {
  bargain: {
    mode: UiMode.ER_BARGAIN,
    prepare: () => bargainArgs(),
  },
  "bargain-curiosity": {
    mode: UiMode.ER_BARGAIN,
    prepare: () => curiosityPickerArgs(),
  },
  // The ER Greater Ability Randomizer 4-ability picker (Master-Ball tier). Reuses the
  // generalized Bargain PICKER chooser with 4 options, each with its in-game ability
  // description. The golden render confirms the 4 rows + the focused-row description
  // sub-box render legibly in the right aesthetic.
  "greater-ability-randomizer-picker": {
    mode: UiMode.ER_BARGAIN,
    prepare: () => greaterRandomizerPickerArgs(),
  },
  // The ER Shiny Lab designer (the in-game special-form shiny tool). Drives the real
  // ErShinyLabUiHandler with a self-contained demo config (Articuno, all tiers earned,
  // a representative owned/locked/buyable mix). The golden render confirms the void/neon
  // theme, the preview pane, the category tabs, the effect list with rarity/lock/cost
  // tokens, the detail box and the contextual tuning bar all render legibly.
  "er-shiny-lab": {
    mode: UiMode.ER_SHINY_LAB,
    prepare: () => [buildDemoConfig(SpeciesId.ARTICUNO)],
    diffTolerance: 120000, // live animated exact FX preview in the preview pane
  },
  // Directional-key navigation tour: browse, switch category (RIGHT), drop into the
  // tuning bar (DOWN past the last effect), step across the sliders (RIGHT), into the
  // presets (RIGHT). Each -stepN.png proves the no-mouse flow + that no press crashes.
  "er-shiny-lab-nav": {
    mode: UiMode.ER_SHINY_LAB,
    prepare: () => [buildDemoConfig(SpeciesId.ARTICUNO)],
    // RIGHT walks the tabs Palette -> Surface -> Aura -> Tune; in the Tune tab DOWN picks
    // a slider row and RIGHT adjusts it. Each -stepN.png proves the no-mouse 4-tab flow
    // (tab switching + slider adjust) with no crash.
    steps: [Button.RIGHT, Button.RIGHT, Button.RIGHT, Button.DOWN, Button.DOWN, Button.RIGHT],
    diffTolerance: 180000, // animated exact FX advances during the six-step navigation tour
  },
  // ER Community Challenges (P1): the populated browser, the ZERO-at-launch empty
  // state ("vacant standards"), and a directional-nav tour. Static (no live anim) -> exact diff.
  "community-challenges": {
    mode: UiMode.COMMUNITY_CHALLENGES,
    prepare: () => [buildDemoChallengesConfig({ populated: true })],
    diffTolerance: 0,
  },
  "community-challenges-empty": {
    mode: UiMode.COMMUNITY_CHALLENGES,
    prepare: () => [buildDemoChallengesConfig({ populated: false })],
    diffTolerance: 0,
  },
  "community-challenges-nav": {
    mode: UiMode.COMMUNITY_CHALLENGES,
    prepare: () => [buildDemoChallengesConfig({ populated: true })],
    steps: [Button.RIGHT, Button.RIGHT, Button.DOWN, Button.DOWN],
    diffTolerance: 0,
  },
  // The single REAL Inferno card: real achievement-completion data + the LIVE NU
  // allowed pool (recomputed from the usage-tier feed, which the harness loads
  // async during boot). The allowed-grid region is therefore non-deterministic
  // (empty until the feed resolves, then ~10 cells + "+N MORE" whose N tracks the
  // live tier ranking) - so, like the animated-sprite pages, it uses a coarse
  // tolerance that covers that one region while still catching gross regressions.
  "community-challenges-inferno": {
    mode: UiMode.COMMUNITY_CHALLENGES,
    prepare: () => [buildInfernoFeed()],
    diffTolerance: 90_000,
  },
  // Stage B nav sections: DOWN to BROWSE (nav index 2) + ACTION switches the section;
  // BROWSE has no live backend offline so it settles on the genuine "BE THE FIRST"
  // empty state (fetchCommunityFeed -> emptyFeed). Static -> exact diff.
  "community-challenges-section-browse": {
    mode: UiMode.COMMUNITY_CHALLENGES,
    prepare: () => [buildDemoChallengesConfig({ populated: true })],
    steps: [Button.DOWN, Button.ACTION],
    diffTolerance: 0,
  },
  // Stage B MY CHALLENGES: DOWN x2 to MY (nav index 3) + ACTION; MY lists the player's own
  // local drafts. The harness has no seeded drafts, so it renders the empty MY state (the
  // generic "BE THE FIRST" empty copy), not "COMING SOON". Static -> exact diff.
  "community-challenges-section-mine": {
    mode: UiMode.COMMUNITY_CHALLENGES,
    prepare: () => [buildDemoChallengesConfig({ populated: true })],
    steps: [Button.DOWN, Button.DOWN, Button.ACTION],
    diffTolerance: 0,
  },
  // Stage C designer (UiMode.COMMUNITY_CHALLENGE_CREATE): the authoring field list
  // (NAME / SUBTITLE / DESCRIPTION / DIFFICULTY / the inline RULES rows / ALLOWED
  // POKEMON / PUBLISH) seeded blank (show([null])). Static text -> exact diff. The
  // text-entry FORM is a DOM overlay (not rasterized here) - it is verified in the
  // real browser, not in the golden.
  "community-challenge-create": {
    mode: UiMode.COMMUNITY_CHALLENGE_CREATE,
    prepare: () => [null],
    diffTolerance: 0,
  },
  // DOWN x4 walks the cursor onto the first inline RULE row; RIGHT increases its value
  // (the copyChallenge row, NOT gameMode.challenges), so the value text flips. Proves the
  // rules picker adjusts in place. Static -> exact diff.
  "community-challenge-create-rules": {
    mode: UiMode.COMMUNITY_CHALLENGE_CREATE,
    prepare: () => [null],
    steps: [Button.DOWN, Button.DOWN, Button.DOWN, Button.DOWN, Button.RIGHT],
    diffTolerance: 0,
  },
  // The ER Profile hub (UiMode.PROFILE): the left side-nav dashboard reached from the title.
  // Static text + panel chrome (no sprites) -> exact diff. The DOWN-step variant proves the
  // nav re-renders the right-hand description per tab.
  profile: {
    mode: UiMode.PROFILE,
    prepare: () => [() => {}],
    diffTolerance: 0,
  },
  "profile-nav": {
    mode: UiMode.PROFILE,
    prepare: () => [() => {}],
    steps: [Button.DOWN],
    diffTolerance: 0,
  },
  // The ER Ghost Trainer Editor (UiMode.GHOST_TRAINER_EDITOR): the player authors how their
  // published ghost looks (cosmetic sprite/class, name, title, three dialogue lines) with a live
  // preview pane (trainer sprite + intro line). Seed an existing profile so the golden exercises
  // seedFromProfile, a gendered sprite (the FEMALE row appears), and the token-bearing intro. The
  // ace_trainer_f atlas is injected via the two-pass recorder; static sprite -> exact diff.
  "ghost-trainer-editor": {
    mode: UiMode.GHOST_TRAINER_EDITOR,
    prepare: game => {
      game.scene.gameData.ghostProfile = {
        trainerType: TrainerType.ACE_TRAINER,
        female: true,
        displayName: "Revenant",
        title: "Champion",
        dialogue: {
          intro: "I have waited a long time for {player}.",
          defeatPlayer: "Your journey ends where mine did.",
          defeated: "You are stronger than the legends say.",
        },
      };
      return [() => {}];
    },
    diffTolerance: 0,
  },
  // The REAL starter-select driven in ER Community Challenge "roster pick" mode (args[1]):
  // ACTION toggles the focused species into the allowed set (no party/cost/cap), and the
  // unselected icons dim. RIGHT then ACTION toggles a second. Confirms the reused screen +
  // its filters work as a multi-select roster picker (live detail sprite -> coarse tolerance).
  "starter-select-roster": {
    mode: UiMode.STARTER_SELECT,
    prepare: game => {
      for (let id = 1; id <= 151; id++) {
        caughtSpecies(game, id as SpeciesId);
      }
      return [() => {}, { rosterPickMode: true, initialSelected: [], onRosterConfirm: () => {} }];
    },
    steps: [Button.ACTION, Button.RIGHT, Button.ACTION],
    diffTolerance: 40000,
  },
  "biome-shop": {
    mode: UiMode.BIOME_SHOP,
    prepare: async game => {
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      const wave = game.scene.currentBattle?.waveIndex ?? 1;
      const options = (getPlayerShopModifierTypeOptionsForWave as any)(wave, 100, true) ?? [];
      return [options, game.scene.arena.biomeId, () => {}, options.map(() => 1)];
    },
  },
  "mystery-encounter": {
    mode: UiMode.MYSTERY_ENCOUNTER,
    prepare: async game => {
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      game.scene.currentBattle.mysteryEncounter = allMysteryEncounters[MysteryEncounterType.FIGHT_OR_FLIGHT];
      return [{}];
    },
  },
  // The overhauled achievement screen: left rail (All + Recent + the 6 categories +
  // Vouchers, with per-category counts), a header with overall completion % + earned/total
  // achievement points, the category-filtered icon grid, and a detail panel showing the
  // selected achievement's tier, points, reward summary and description. A deterministic ~1/3
  // of the registry is unlocked (the first achv, CLASSIC_VICTORY, is kept LOCKED so the
  // cursor-0 detail shows no locale-dependent unlock date -> exact golden diff).
  achievements: {
    mode: UiMode.ACHIEVEMENTS,
    prepare: game => seedAchvUnlocks(game),
    diffTolerance: 0,
  },
  // Directional-nav tour: DOWN x3 walks the rail (All -> Recent -> Victory -> Battle)
  // re-filtering the grid + header each step, then RIGHT drops focus into the grid (cursor
  // highlight appears) and RIGHT steps across the icons. Proves the no-mouse nav + live
  // re-filter + that no press crashes.
  "achievements-nav": {
    mode: UiMode.ACHIEVEMENTS,
    prepare: game => seedAchvUnlocks(game),
    steps: [Button.DOWN, Button.DOWN, Button.DOWN, Button.RIGHT, Button.RIGHT],
    diffTolerance: 0,
  },
  // The "Recent" view (triage what you just earned): DOWN once selects the Recent rail entry,
  // which lists UNLOCKED achievements newest-first by unlock timestamp; the detail shows the
  // most-recent one + its reward. Distinct (incrementing) unlock timestamps make the order
  // deterministic; the coarse tolerance absorbs the one locale-dependent unlock-date string.
  "achievements-recent": {
    mode: UiMode.ACHIEVEMENTS,
    prepare: game => seedAchvUnlocks(game, true),
    steps: [Button.DOWN],
    diffTolerance: 3000,
  },
  pokedex: {
    mode: UiMode.POKEDEX_PAGE,
    prepare: game => [caughtSpecies(game, SpeciesId.RATTATA), {}],
    diffTolerance: 40000, // live animated species sprite - see Recipe.diffTolerance
  },
  // The real egg-summary screen (UiMode.EGG_HATCH_SUMMARY): the hatch-info card on the
  // left + the icon grid of every hatched mon. Drives the genuine EggSummaryUiHandler so
  // the layout, stats hexagon, candy, egg moves and grid are all the real article.
  "egg-hatch": {
    mode: UiMode.EGG_HATCH_SUMMARY,
    prepare: game => {
      const ids = [
        SpeciesId.RATTATA,
        SpeciesId.PIKACHU,
        SpeciesId.BULBASAUR,
        SpeciesId.EEVEE,
        SpeciesId.GASTLY,
        SpeciesId.MACHOP,
      ];
      const data = ids.map(id => {
        caughtSpecies(game, id); // populate dex/starter entries so the card is fully filled
        const mon = new Egg({ scene: game.scene, species: id as SpeciesId }).generatePlayerPokemon();
        const hatchData = new EggHatchData(mon, 0);
        hatchData.setDex();
        return hatchData;
      });
      return [data];
    },
    diffTolerance: 40000, // live animated hatch sprite - see Recipe.diffTolerance
  },
  // The real starter-select screen: drives the genuine show([callback]) so the species
  // grid, value/cost panel, filters and the per-species detail panel all populate.
  // Gen-1 is marked caught so the first page of icons is in colour and the cursor-0
  // detail panel (sprite/abilities/passives/nature) is rich.
  "starter-select": {
    mode: UiMode.STARTER_SELECT,
    prepare: game => {
      for (let id = 1; id <= 151; id++) {
        caughtSpecies(game, id as SpeciesId);
      }
      return [() => {}];
    },
  },
  // Regression for Shiny Lab equipped looks in Starter Select: the selected starter is
  // shiny, owns/equips palette + surface + aura, and the preview must render through the
  // real StarterSelectUiHandler instead of falling back to palette-only shader rendering.
  "starter-select-shiny-lab": {
    mode: UiMode.STARTER_SELECT,
    prepare: game => {
      for (let id = 1; id <= 151; id++) {
        caughtSpecies(game, id as SpeciesId);
      }
      caughtShinyLabSpecies(game, SpeciesId.BULBASAUR);
      return [() => {}];
    },
    diffTolerance: 60000, // live exact FX + mini-icon FX animate during frame-capture runs
  },
  // Co-op (#633) starter-select: forces COOP mode so the budget panel reads 0/5
  // (per-player) and the per-player 3-mon cap applies. This is the real screen the
  // host plays - each player picks their OWN team on their OWN screen.
  "starter-select-coop": {
    mode: UiMode.STARTER_SELECT,
    prepare: game => {
      game.scene.gameMode = getGameMode(GameModes.COOP);
      // Spin up a spoofed co-op session so the partner-status banner populates
      // (the spoof "joins" + locks in; the await in the test flushes its messages).
      const runtime = startLocalCoopSession({ username: "Ash" });
      runtime.spoof?.autoComplete();
      for (let id = 1; id <= 151; id++) {
        caughtSpecies(game, id as SpeciesId);
      }
      return [() => {}];
    },
  },
  // Showdown teambuilder: forces SHOWDOWN mode so the cost panel reads the deferred
  // 999 limit and the party cap is the full 6 (PLAYER_PARTY_MAX_SIZE). Same real screen
  // the player builds their 1v1 duel team on. B7 item 15 ("everything follows the stage"):
  // the custom render drives the REAL teambuilder code paths - Bulbasaur is added to the party
  // (addToParty) and then FIELDED as its terminal evolution Venusaur (setShowdownStage, which
  // re-runs setSpeciesDetails). The final snapshot must show the PICKED stage EVERYWHERE it
  // follows: the big PREVIEW sprite (Venusaur), the PARTY MINI-ICON in slot 0 (a Venusaur icon,
  // not Bulbasaur), and the ABILITY + TYPE + FORM detail fields (the fielded form's data). The
  // GRID keeps base icons (species browser). Driven directly (not via the action-menu keystrokes)
  // because the harness's universal input driver can't reliably re-open the action menu after a
  // cross-mode round-trip; the render path exercises the same production methods. NOTE (baseline
  // drift): re-accept the golden with ER_UPDATE_BASELINE=1 (a fresh baseline is expected).
  "starter-select-showdown": {
    mode: UiMode.STARTER_SELECT,
    prepare: game => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      for (let id = 1; id <= 151; id++) {
        caughtSpecies(game, id as SpeciesId);
      }
      return [() => {}];
    },
    render: game => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      const ui: any = game.scene.ui;
      const registered: any = ui.handlers[UiMode.STARTER_SELECT];
      let handler: any = registered;
      try {
        handler = new registered.constructor();
      } catch {
        handler = registered;
      }
      handler.setup();
      handler.show([() => {}]);
      const internals: any = handler;
      const bulbasaur = getPokemonSpecies(SpeciesId.BULBASAUR);
      internals.lastSpecies = bulbasaur;
      internals.speciesStarterDexEntry = game.scene.gameData.dexData[SpeciesId.BULBASAUR];
      internals.setSpeciesDetails(bulbasaur, {}, false);
      internals.addToParty(
        bulbasaur,
        internals.dexAttrCursor,
        internals.abilityCursor,
        internals.natureCursor,
        internals.starterMoveset?.slice() ?? [],
        internals.teraCursor,
      );
      // Field the terminal evolution - re-stamps the in-party starter AND re-renders the detail
      // panel + party icon through the real item-15 display path.
      internals.setShowdownStage(SpeciesId.BULBASAUR, SpeciesId.VENUSAUR, 0);
      ui.setActiveHandler?.(handler);
      return handler;
    },
  },
  // Showdown Team Menu EDIT entry (addendum): opening the grid to EDIT an existing preset PRE-SEEDS the
  // party with the preset's reconstructed mons via the real show() seed path (args[2].seedStarters ->
  // seedTeamFromStarters -> addToParty). The snapshot must show the team strip PRE-POPULATED (three party
  // mini-icons: Venusaur/Charizard/Blastoise), not the empty grid the player used to rebuild from. The
  // async seed asset-load is awaited (showdownSeedInFlight) before the golden capture.
  "starter-select-showdown-edit": {
    mode: UiMode.STARTER_SELECT,
    prepare: game => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      for (let id = 1; id <= 151; id++) {
        caughtSpecies(game, id as SpeciesId);
      }
      return [() => {}];
    },
    render: async game => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      const ui: any = game.scene.ui;
      const registered: any = ui.handlers[UiMode.STARTER_SELECT];
      let handler: any = registered;
      try {
        handler = new registered.constructor();
      } catch {
        handler = registered;
      }
      handler.setup();
      // Reconstruct three preset mons (each FIELDED as its terminal evolution) exactly as title-phase
      // does, and hand them to the grid via the real edit-seed show arg.
      const seedStarters = [
        manifestToStarter({
          speciesId: SpeciesId.VENUSAUR,
          formIndex: 0,
          level: 100,
          shiny: false,
          variant: 0,
          abilityIndex: 0,
          nature: 5,
          ivs: [31, 31, 31, 31, 31, 31],
          moveset: [MoveId.TACKLE, MoveId.GROWL, MoveId.VINE_WHIP, MoveId.LEECH_SEED],
          item: "LEFTOVERS",
          rootSpeciesId: SpeciesId.BULBASAUR,
          erBlackShiny: false,
          baseCost: 4,
        }),
        manifestToStarter({
          speciesId: SpeciesId.CHARIZARD,
          formIndex: 0,
          level: 100,
          shiny: false,
          variant: 0,
          abilityIndex: 0,
          nature: 2,
          ivs: [31, 31, 31, 31, 31, 31],
          moveset: [MoveId.EMBER, MoveId.GROWL, MoveId.SCRATCH, MoveId.LEER],
          item: "FLAME_ORB",
          rootSpeciesId: SpeciesId.CHARMANDER,
          erBlackShiny: false,
          baseCost: 4,
        }),
        manifestToStarter({
          speciesId: SpeciesId.BLASTOISE,
          formIndex: 0,
          level: 100,
          shiny: false,
          variant: 0,
          abilityIndex: 0,
          nature: 0,
          ivs: [31, 31, 31, 31, 31, 31],
          moveset: [MoveId.TACKLE, MoveId.TAIL_WHIP, MoveId.BUBBLE, MoveId.WITHDRAW],
          item: "LEFTOVERS",
          rootSpeciesId: SpeciesId.SQUIRTLE,
          erBlackShiny: false,
          baseCost: 4,
        }),
      ];
      handler.show([() => {}, undefined, { seedStarters, onCancel: () => {} }]);
      // The seed loads sprites asynchronously and adds the party icons on resolution - await it so the
      // golden captures the fully-seeded team strip (not a race with the empty grid).
      await handler.showdownSeedInFlight;
      ui.setActiveHandler?.(handler);
      return handler;
    },
  },
  // Showdown WAGER screen (D3): both teams previewed (icons + held-item mini-icons + a mega badge),
  // the opponent's name/title, the stake picker + tier-match + lock lamps. Offline (transport/
  // rendezvous null): the local lock lamp still lights. steps drive the picker (DOWN to a staked
  // option -> its offer + tier row updates), then ACTION back on Friendly is proven via the -stepN
  // shots; the main PNG ends on the last state. Static text/icons -> exact diff.
  "showdown-wager": {
    mode: UiMode.SHOWDOWN_WAGER,
    prepare: game => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      return showdownWagerArgs();
    },
    // DOWN x2 walks onto a staked option (its "You: ..." offer + tier-match row change); ACTION on a
    // STAKED row surfaces the escrow-unavailable notice (no lock). The final -stepN shows that path.
    steps: [Button.DOWN, Button.DOWN, Button.ACTION],
  },
  // Showdown TOURNAMENT list (PWT-themed): a mix of open-for-registration, in-progress and finished
  // tournaments, with the "you are registered" flag and entrant counts. Data-driven demo config.
  "tournament-list": {
    mode: UiMode.TOURNAMENT_LIST,
    prepare: () => [buildTournamentListDemoConfig()],
    diffTolerance: 0,
  },
  // Bracket tree (8-field, round-1 settled): the your-next-match card is PLAYABLE (opponent + deadline
  // + Play hint).
  "tournament-bracket-8": {
    mode: UiMode.TOURNAMENT_BRACKET,
    prepare: () => [buildTournamentBracketDemoConfig({ size: 8, advancedRounds: 1, card: "playable" })],
    diffTolerance: 0,
  },
  // Bracket tree (16-field, two rounds settled): a deeper tree, mid-round state.
  "tournament-bracket-16": {
    mode: UiMode.TOURNAMENT_BRACKET,
    prepare: () => [buildTournamentBracketDemoConfig({ size: 16, advancedRounds: 2, card: "playable" })],
    diffTolerance: 0,
  },
  // Bracket with BYES (5-field padded to 8): top seeds auto-advance, "(bye)" slots shown.
  "tournament-bracket-byes": {
    mode: UiMode.TOURNAMENT_BRACKET,
    prepare: () => [buildTournamentBracketDemoConfig({ size: 8, byes: true, advancedRounds: 0, card: "waiting" })],
    diffTolerance: 0,
  },
  // Next-match card: DEADLINE SOON (red countdown, still playable).
  "tournament-bracket-duesoon": {
    mode: UiMode.TOURNAMENT_BRACKET,
    prepare: () => [buildTournamentBracketDemoConfig({ size: 8, advancedRounds: 1, card: "dueSoon" })],
    diffTolerance: 0,
  },
  // Champion screen: the final decided, champion banner.
  "tournament-bracket-champion": {
    mode: UiMode.TOURNAMENT_BRACKET,
    prepare: () => [buildTournamentBracketDemoConfig({ size: 8, advancedRounds: 3, card: "champion" })],
    diffTolerance: 0,
  },
  // Showdown SET EDITOR (P1 layout core). The full-screen teambuilder Layer-3 editor for one
  // team slot: top team strip + validity chips, the left identity column (sprite / stage strip /
  // shiny chips / live stat bars / cost), the right field rows (ability / item / moves x4 /
  // nature), and the bottom shared search pane. Driven by a self-contained honest Garchomp-line
  // config (real move/ability/item metadata). Each recipe fixes a deterministic focus/pane state
  // so the golden is stable; SHOWDOWN_mode gate is not needed (the handler is data-driven).
  "showdown-editor": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [buildShowdownEditorDemoConfig()],
    diffTolerance: 0,
  },
  // Move typeahead pane OPEN mid-filter: Move 1 focused, pane expanded, filter string "out"
  // narrowing the legal move table (Name | Type | Cat | BP | Acc | PP | effect) with the
  // highlighted-row description footer.
  "showdown-editor-moves": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [
      buildShowdownEditorDemoConfig({
        initialField: EditorField.MOVE0,
        initialPaneOpen: true,
        initialFilter: "o",
      }),
    ],
    diffTolerance: 0,
  },
  // Ability row focused (round 4 - NO dropdown): the 1 ACTIVE ability is CYCLED in place (< active >
  // chevrons) and the 3 INNATES read below, a LOCKED innate showing its candy unlock cost (item 6).
  // This is also the locked-innate example render.
  "showdown-editor-ability": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [buildShowdownEditorDemoConfig({ initialField: EditorField.ABILITY })],
    diffTolerance: 0,
  },
  // Move cell focused (no dropdown): the persistent bottom MOVE DESCRIPTION bar shows the focused
  // move's full description (item 8) - the compact NATURE chip (cycled via the N hotkey) sits beside
  // the item row. Proves the desc bar updates while focus merely sits on a move cell.
  "showdown-editor-movedesc": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [buildShowdownEditorDemoConfig({ initialField: EditorField.MOVE1 })],
    diffTolerance: 0,
  },
  // Item pane: the searchable showdown item pool (icon + name + effect line). Item row focused,
  // pane open.
  "showdown-editor-item": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [buildShowdownEditorDemoConfig({ initialField: EditorField.ITEM, initialPaneOpen: true })],
    diffTolerance: 0,
  },
  // Mega stage fielded: the BASE STATS must reflect the FIELDED FORM (Mega Garchomp's spread), NOT the
  // base species (base Garchomp) - the mega-stats fix. The full sprite, item lock + abilities also
  // follow the mega form.
  "showdown-editor-mega": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => {
      const mega = listMegaStages(SpeciesId.GIBLE)[0];
      return [buildShowdownEditorDemoConfig({ stage: { speciesId: mega.speciesId, formIndex: mega.formIndex } })];
    },
    diffTolerance: 0,
  },
  // Input-plumbing proof (not the golden set): drive the round-3 focus -> open -> navigate -> PICK
  // path through processInput. DOWN,DOWN focuses Move 1; ACTION opens its search dropdown (the
  // controller/A path, no ceremony); DOWN moves the result cursor; ACTION commits the highlighted
  // move and closes the dropdown. The final PNG is the set with Move 1 changed - proof the type/pick
  // Bug 2 refusal banner: fielding a MEGA while the team's one mega budget is already spent, then
  // pressing Done (SUBMIT) - the editor REFUSES with the specific "second mega" message instead of
  // committing. The final step PNG shows the red banner over the greyed mega stage strip.
  "showdown-editor-mega-blocked": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => {
      const base = buildShowdownEditorDemoConfig();
      const mega = listMegaStages(SpeciesId.GIBLE)[0];
      return [
        {
          ...base,
          stage: { speciesId: mega.speciesId, formIndex: mega.formIndex },
          unlocks: { ...base.unlocks, megaBudgetSpent: true, megaBudgetSpentBy: "Blastoise" },
        },
      ];
    },
    steps: [Button.SUBMIT],
    diffTolerance: 0,
  },
  // LONG species name (Crabominable) + focused ABILITY row: the overlap golden gate (Bug 3). The identity
  // NAME bar must clip clear of the cost badge, and the focused ACTIVE ability bar + its E glyph must sit
  // INSIDE the abilities panel frame (not kiss/overrun it). Regenerating this pins the fixed geometry.
  "showdown-editor-longname": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [
      buildShowdownEditorDemoConfig({
        rootSpeciesId: SpeciesId.CRABRAWLER,
        stage: { speciesId: SpeciesId.CRABOMINABLE, formIndex: 0 },
        initialField: EditorField.ABILITY,
      }),
    ],
    diffTolerance: 0,
  },
  // P2 SET MENU (STATS/C): the Save / Load / Export / Import option list over the editor.
  "showdown-editor-set-menu": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [buildShowdownEditorDemoConfig({ initialSetMenu: "menu" })],
    diffTolerance: 0,
  },
  // P2 EXPORT confirmation: the Set Menu list with the "copied to clipboard" notice in its footer.
  "showdown-editor-set-export": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [
      buildShowdownEditorDemoConfig({
        initialSetMenu: "menu",
        initialSetMenuNotice: "Copied this set to the clipboard.",
      }),
    ],
    diffTolerance: 0,
  },
  // P2 IMPORT SET paste modal (single set) over the editor.
  "showdown-editor-set-import": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [
      buildShowdownEditorDemoConfig({
        initialSetMenu: "import",
        initialSetMenuBuffer:
          "Garchomp @ Life Orb  [Stage: Base]\nAbility: Rough Skin\nNature: Adamant\n- Earthquake\n- Scale Shot",
      }),
    ],
    diffTolerance: 0,
  },
  // P2 LOAD SET named-set list (injected demoNamedSets so the golden is deterministic).
  "showdown-editor-set-load": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [
      buildShowdownEditorDemoConfig({
        initialSetMenu: "load",
        demoNamedSets: [
          { name: "Sand Sweeper", text: "Garchomp @ Life Orb\n- Earthquake" },
          { name: "Bulky SD", text: "Garchomp @ Leftovers\n- Swords Dance" },
        ],
      }),
    ],
    diffTolerance: 0,
  },
  // Showdown TEAM PRESET MENU (addendum): the pre-pairing entry screen. Left = stylish preset boxes
  // (name + validity marker + 6 mini icons) with a trailing create box; right = the hovered mon's
  // full sprite + ability/innates + item + moveset (live preview). Multi-team with hover preview on
  // the first team's first mon. Data-driven demo config (two valid teams + one invalid).
  "showdown-team-menu": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [buildShowdownTeamMenuDemoConfig()],
    diffTolerance: 0,
  },
  // Empty state: no saved presets -> the large "create your first team" affordance, cursor on it,
  // the right panel inviting a build.
  "showdown-team-menu-empty": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [buildShowdownTeamMenuDemoConfig({ presets: [], initialTeam: 0 })],
    diffTolerance: 0,
  },
  // Invalid-team marker: hover the third (invalid) preset - its box shows the INVALID marker + red
  // edge, and its preview still renders (confirm on it would explain, not enter the lobby).
  "showdown-team-menu-invalid": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [buildShowdownTeamMenuDemoConfig({ initialTeam: 2, initialMon: 0 })],
    diffTolerance: 0,
  },
  // Rename prompt: the in-handler rename overlay (same DOM-input infra as the editor search) composited
  // over the menu, seeded with the hovered team's current name.
  "showdown-team-menu-rename": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [buildShowdownTeamMenuDemoConfig({ initialTeam: 0, initialRenaming: true })],
    diffTolerance: 0,
  },
  // Enter-lobby / delete CONFIRM question banner: the menu paints the QUESTION over the strip (the bare
  // CONFIRM overlay only draws Yes/No), so the player reads what they are agreeing to (maintainer: "it
  // just says yes or no"). Also shows the per-mon held-item mini-icons on the box icons.
  "showdown-team-menu-prompt": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [
      buildShowdownTeamMenuDemoConfig({
        initialTeam: 0,
        initialPromptText: "Enter the lobby with this team?",
      }),
    ],
    diffTolerance: 0,
  },
  // Rank CHIP in the header (unranked): the compact ball+label pill replacing the old bottom-right rank
  // card that covered the moveset (maintainer). rankAvailable forces the chip on; null state = Unranked.
  "showdown-team-menu-rank-unranked": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [buildShowdownTeamMenuDemoConfig({ initialTeam: 0, rankAvailable: true, initialRankState: null })],
    diffTolerance: 0,
  },
  // Rank CHIP in the header (ranked): a concrete Ultra Ball 2 state so the ball frame + tier label render;
  // the full preview (sprite / abilities / item / all 4 moves) must stay UNOBSTRUCTED beneath it.
  "showdown-team-menu-rank-ranked": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [
      buildShowdownTeamMenuDemoConfig({
        initialTeam: 0,
        rankAvailable: true,
        initialRankState: {
          seasonId: "S1",
          tier: 2,
          rank: 2,
          segments: 3,
          streak: 0,
          highestTierReached: 2,
          careerBestTier: 2,
        },
      }),
    ],
    diffTolerance: 0,
  },
  // P2 IMPORT paste modal (F): the off-screen multiline capture; the modal draws the captured buffer +
  // the Enter/Esc hints over the dimmed menu.
  "showdown-team-menu-import": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [
      buildShowdownTeamMenuDemoConfig({
        initialTeam: 0,
        initialImporting: true,
        initialImportBuffer:
          "Garchomp @ Leftovers  [Stage: Base]\nAbility: Rough Skin\nNature: Jolly\n- Earthquake\n- Outrage",
      }),
    ],
    diffTolerance: 0,
  },
  // P2 IMPORT error list: the precise per-mon parse + validation errors with the drop-invalid/cancel
  // fix-up footer.
  "showdown-team-menu-import-error": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [
      buildShowdownTeamMenuDemoConfig({
        initialTeam: 0,
        initialImportErrors: [
          "line 3: unknown move 'Fooblast'",
          "line 8: unknown species 'Notamon'",
          "Pokemon 2 (Tyranitar): Ability 2 is not unlocked (slot 0).",
        ],
      }),
    ],
    diffTolerance: 0,
  },
  // P2 EXPORT confirmation banner (V): the brief green "copied to clipboard" banner at the top of the body.
  "showdown-team-menu-export": {
    mode: UiMode.SHOWDOWN_TEAM_MENU,
    prepare: () => [
      buildShowdownTeamMenuDemoConfig({
        initialTeam: 0,
        initialExportNotice: 'Copied "Sand Rush" to clipboard (4 Pokemon).',
      }),
    ],
    diffTolerance: 0,
  },
  // interaction round-trips (the keystroke half is covered by showdown-editor-input.test.ts).
  "showdown-editor-nav": {
    mode: UiMode.SHOWDOWN_SET_EDITOR,
    prepare: () => [buildShowdownEditorDemoConfig()],
    steps: [Button.DOWN, Button.DOWN, Button.ACTION, Button.DOWN, Button.ACTION],
    diffTolerance: 0,
  },
  // Demo of universal input driving: drives the real starter-select grid cursor. Each
  // `-stepN.png` shows the cursor highlight + detail panel moving - the same mechanism
  // reproduces navigation/scroll bugs and input-triggered crashes on ANY screen/menu.
  "starter-select-nav": {
    mode: UiMode.STARTER_SELECT,
    prepare: game => {
      for (let id = 1; id <= 151; id++) {
        caughtSpecies(game, id as SpeciesId);
      }
      return [() => {}];
    },
    steps: [Button.RIGHT, Button.RIGHT, Button.RIGHT, Button.DOWN],
  },
  // The party SUMMARY screen on its ER ABILITIES page, with a BLACK SHINY (#349) lead so the
  // violet-italic GIFT row ("Gift 1/3 (R)") is present. steps fires R (Button.CYCLE_SHINY):
  // before the fix the data advanced but the page-cursor re-render dropped the forced-refresh
  // flag so the row never redrew; after the fix the handler redraws the page in place, so the
  // gift NAME + idx/choices counter change. The dedicated before/after assertion test below
  // ("summary gift-cycle redraws...") checks that change explicitly; this recipe gives the
  // golden render + the post-R `summary-step0.png` so any future regression of the page shows.
  summary: {
    mode: UiMode.SUMMARY,
    prepare: async game => {
      const mon = await startBattleWithBlackShinyLead(game);
      return [mon, undefined /* SummaryUiMode.DEFAULT */, SUMMARY_PAGE_ABILITIES];
    },
    steps: [Button.CYCLE_SHINY],
    diffTolerance: 40000, // live animated mon sprite in the summary box - see Recipe.diffTolerance
  },
  // Regression for Shiny Lab equipped looks in the party SUMMARY view. The lead owns
  // and equips palette + surface + around FX; the summary mon sprite must use the
  // exact renderer, not the default shiny palette or palette-only shader path.
  "summary-shiny-lab": {
    mode: UiMode.SUMMARY,
    prepare: async game => {
      const mon = await startBattleWithShinyLabLead(game);
      return [mon, undefined /* SummaryUiMode.DEFAULT */, SUMMARY_PAGE_ABILITIES];
    },
    diffTolerance: 60000, // live exact FX overlay animates on the summary mon sprite
  },
  // Regression for Shiny Lab mini-icons in the in-game party screen. Party slots are
  // built via BattleScene.addPokemonIcon, so this covers the shared runtime icon path.
  "party-shiny-lab": {
    mode: UiMode.PARTY,
    prepare: async game => {
      await startBattleWithShinyLabLead(game);
      return [PartyUiMode.SWITCH, -1, () => {}];
    },
    diffTolerance: 40000,
  },
  // Phase-flow bridge demo: drive a real battle (startBattle runs the encounter phases) and
  // render WHATEVER screen the pipeline left active - here the in-battle command menu -
  // WITH the battlefield beneath it (arena, both pokemon, HP bars) via `field: true`.
  // This is the full mid-battle screen, headless.
  "battle-command": {
    captureActive: true,
    field: true,
    prepare: async game => {
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      return []; // captureActive ignores this; satisfies the prepare return type
    },
  },
  // Showdown construction-time vanilla mega. A vanilla-species mega built AT its mega
  // formIndex directly at battle build (addPlayerPokemon(formIndex=1), no mid-run form
  // change) - the same path the showdown teambuilder fields a picked mega stage. The PNG
  // shows the MEGA Garchomp back sprite (er-slug art `elite-redux/garchomp_mega/back`), NOT
  // the base Garchomp - i.e. the redirected form sprite resolves + loads at construction.
  // Guards against a regression where the mega form falls back to the base texture; the
  // matching cry-load fix is asserted in test/tests/elite-redux/showdown/showdown-mega-cry.test.ts.
  "battle-showdown-mega": {
    captureActive: true,
    field: true,
    prepare: async game => {
      game.override.starterForms({ [SpeciesId.GARCHOMP]: 1 });
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      // ClassicModeHelper necessarily launches in CLASSIC; switch to the actual Showdown
      // presentation policy and refresh the panel before capture. This makes the golden cover
      // both the redirected Mega sprite AND the Showdown-only form-qualified name.
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      await game.scene.getPlayerField()[0].updateInfo(true);
      return [];
    },
  },
  // Battlefield in a DOUBLE battle: two mons + stacked HP bars per side. Exercises the
  // slot-offset layout (fieldSpriteOffset / barSlotOffset) of the field renderer.
  "battle-field-doubles": {
    captureActive: true,
    field: true,
    prepare: async game => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      return [];
    },
  },
  // Battlefield in a TRIPLE battle: three mons + three stacked HP bars per side. Verifies
  // the triple slot-offset layout (fieldSpriteOffset/barSlotOffset at capacity 3) AND the
  // "backsprites not showing" report (#4) - the PNG must show THREE player BACK sprites.
  // (If the backs render here, the browser report is the async atlas-load race, headless-
  // invisible - classify it browser-tier.)
  "battle-field-triples": {
    captureActive: true,
    field: true,
    prepare: async game => {
      game.override.battleStyle("triple");
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.CHARIZARD);
      return [];
    },
  },
  // Report #2 visual: the state AFTER winning a triple TRAINER battle and advancing to a
  // NARROWER (single) next wave. The bug left the player's 2nd + 3rd back sprites AND their
  // info bars on screen through the next intro ("the UI doesn't change, doesn't move away").
  // The field renderer mirrors the LIVE scene graph, so post-fix this PNG shows exactly ONE
  // player back sprite (the single lead) + one player bar; pre-fix it showed three.
  "battle-field-triples-postwin": {
    captureActive: true,
    field: true,
    prepare: async game => {
      game.override
        .battleType(BattleType.TRAINER)
        .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
        .battleStyle("triple")
        .criticalHits(false)
        .startingLevel(200) // OHKO every foe -> win in one turn
        .enemyLevel(20)
        .enemyMoveset(MoveId.HARDEN)
        .moveset([MoveId.TACKLE])
        .ability(AbilityId.BALL_FETCH)
        .enemyAbility(AbilityId.BALL_FETCH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);
      const battle = game.scene.currentBattle;
      battle.enemyParty.length = 3; // exactly three foes, no reserves -> KO all three = victory
      const foes = game.scene.getEnemyField();
      const idx = foes.map(e => e.getBattlerIndex());
      for (const e of foes) {
        e.hp = 1;
      }
      game.move.select(MoveId.TACKLE, 0, idx[0]);
      game.move.select(MoveId.TACKLE, 1, idx[1]);
      game.move.select(MoveId.TACKLE, 2, idx[2]);
      // Narrow the next wave to a SINGLE (read fresh at newBattle time) so the transition
      // must recall the leftover triple slots 1-2. Post-fix: only slot 0 remains on-field.
      game.override.battleStyle("single");
      await game.toNextWave();
      return [];
    },
  },
  // The Stormglass relic (#130) weather PICKER - the one-time OPTION_SELECT the
  // ErStormglassPickerPhase opens when a held Stormglass has no chosen weather. It
  // lists the 5 weather choices (Sun, Rain, Sandstorm, Hail, Fog); DOWN,ACTION drives
  // the cursor onto Rain and selects it. The golden render confirms all 5 options
  // render legibly; the step snapshot shows the cursor moved + the pick committed.
  "stormglass-picker": {
    mode: UiMode.OPTION_SELECT,
    prepare: () => [
      {
        // Nudge the right/bottom-anchored menu toward screen-centre so the whole list
        // (all 5 labels) sits inside the blank render canvas - there is no other screen
        // underneath it here, unlike the in-game overlay.
        xOffset: 140,
        yOffset: -8,
        options: STORMGLASS_WEATHER_CHOICES.map(choice => ({
          label: choice.label,
          handler: () => true,
        })),
      },
    ],
    // DOWN walks the cursor onto "Rain" (the player selecting a weather); the menu stays
    // open so the final PNG shows all 5 options legibly. The full confirm-and-record path
    // (ACTION -> setStormglassWeather) is exercised by er-stormglass-picker.test.ts.
    steps: [Button.DOWN],
  },
  // The ER Ability Capsule top-level choice (maintainer request). ErAbilityCapsulePhase
  // shows this OPTION_SELECT first: "Change ability" (cycle) / "Unlock an innate for the
  // run" / Cancel. The golden render confirms both option labels render legibly; DOWN walks
  // the cursor onto the run-unlock option. The full pick paths (cycle + the run-unlock
  // sub-picker) are exercised by er-ability-capsule-run-unlock.test.ts.
  "er-ability-capsule": {
    mode: UiMode.OPTION_SELECT,
    prepare: () => [
      {
        // Nudge the right/bottom-anchored menu toward screen-centre so the whole list
        // sits inside the otherwise-blank render canvas (no screen underneath here).
        xOffset: 140,
        yOffset: -8,
        options: [
          { label: i18next.t("modifierType:erAbilityCapsule.changeAbility"), handler: () => true },
          { label: i18next.t("modifierType:erAbilityCapsule.unlockInnate"), handler: () => true },
          { label: i18next.t("menu:cancel"), handler: () => true },
        ],
      },
    ],
    steps: [Button.DOWN],
  },
  // The ER Greater Ability Capsule top-level choice. ErGreaterAbilityCapsulePhase shows
  // this OPTION_SELECT first: "Permanently unlock an innate" / "Unlock two innates for
  // the run" / Cancel. The golden render confirms both option labels render legibly; DOWN
  // walks the cursor onto the run-unlock-two option. The full pick paths (permanent unlock
  // + the run-unlock-two sub-picker) are exercised by er-greater-ability-capsule.test.ts.
  "er-greater-ability-capsule": {
    mode: UiMode.OPTION_SELECT,
    prepare: () => [
      {
        xOffset: 140,
        yOffset: -8,
        options: [
          { label: i18next.t("modifierType:erGreaterAbilityCapsule.permanentUnlock"), handler: () => true },
          { label: i18next.t("modifierType:erGreaterAbilityCapsule.runUnlockTwo"), handler: () => true },
          { label: i18next.t("menu:cancel"), handler: () => true },
        ],
      },
    ],
    steps: [Button.DOWN],
  },
  // The ER World Map route picker (#129). Starts a battle so arena/currentBattle
  // exist, then opens UiMode.ER_MAP in PICK mode with three effect-rich onward
  // biomes. The new Conditions footer lists the HIGHLIGHTED onward biome's rules;
  // RIGHT,RIGHT walks the cursor across the tiles so the step snapshots show the
  // footer re-listing per biome (Volcano -> Grass -> Ice Cave).
  "er-map": {
    mode: UiMode.ER_MAP,
    prepare: async game => {
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      // Seed a short journey so the "Your journey" chain renders (last = current = HERE).
      recordErBiomeVisited(BiomeId.TOWN);
      recordErBiomeVisited(BiomeId.PLAINS);
      recordErBiomeVisited(BiomeId.GRASS);
      recordErBiomeVisited(game.scene.arena.biomeId);
      const origin = game.scene.arena.biomeId;
      const nodes = [
        { biome: BiomeId.VOLCANO, revealed: true, source: "base" as const },
        { biome: BiomeId.GRASS, revealed: true, source: "base" as const },
        { biome: BiomeId.ICE_CAVE, revealed: true, source: "base" as const },
      ];
      return [{ nodes, origin, onSelect: () => {} }];
    },
    steps: [Button.RIGHT, Button.RIGHT],
  },
  // ER TM Case move-select: open the PARTY screen in the dedicated
  // ER_TM_CASE_MODIFIER mode (the universal single-use TM), then ACTION on the
  // lead Snorlax to reveal its COMPATIBLE TM move list (the moves the TM Case
  // can teach). The step PNG shows the scrollable move list - this is the screen
  // the player picks a TM move from. Snorlax has a 3-move set so the list is rich.
  "tm-case-party": {
    mode: UiMode.PARTY,
    prepare: async game => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      // The TM Case's own type carries the selectFilter (a mon with no learnable
      // TMs is greyed out). Snorlax's compatible-TM list is long, so the picker
      // shows a rich, scrollable move list to choose from.
      const type = getModifierType(modifierTypes.TM_CASE) as ErTmCaseModifierType;
      return [PartyUiMode.ER_TM_CASE_MODIFIER, -1, () => {}, type.selectFilter];
    },
    // ACTION selects the lead mon, opening its TM move list (the pick screen).
    steps: [Button.ACTION],
  },
  // The post-battle REWARD shop (UiMode.MODIFIER_SELECT) - the single highest-value uncovered
  // screen. `mode` triggers `prepare` (a started battle, PRE-repoint, so the handler has its
  // currentBattle for money / wave / shop-status), and a custom `render` builds the REAL
  // ModifierSelectUiHandler with real reward TYPES. It then calls each tile's `revealInstant()`
  // (the same shortcut the Biome Market uses) INSTEAD of the staggered pokeball-bounce /
  // upgrade-reveal tween sequence - the harness force-completes tweens to onComplete but never
  // steps that per-reward stagger, so without this the tiles stay stuck off-screen at their
  // pre-animation position. setCursor(0) then shows option 0's cursor + description
  // deterministically (a nav STEP navigated unpredictably across the batch). Fixed reward TYPES
  // keep the golden stable.
  "modifier-select": {
    mode: UiMode.MODIFIER_SELECT,
    // In-game the reward shop overlays the battlefield - render it too (field: true),
    // not reward tiles floating on black.
    field: true,
    prepare: async game => {
      await game.classicMode.startBattle(SpeciesId.PIKACHU);
      return []; // render (below) builds the handler; this just gives it a currentBattle
    },
    render: game => {
      const ui: any = game.scene.ui;
      const registered: any = ui.handlers[UiMode.MODIFIER_SELECT];
      let handler: any = registered;
      try {
        handler = new registered.constructor();
      } catch {
        handler = registered;
      }
      handler.setup();
      const options = [
        new ModifierTypeOption(modifierTypes.POTION(), 0),
        new ModifierTypeOption(modifierTypes.SUPER_POTION(), 0),
        new ModifierTypeOption(modifierTypes.ETHER(), 0),
        new ModifierTypeOption(modifierTypes.REVIVE(), 0),
      ];
      handler.show([true, options, () => {}, 0]);
      for (const opt of handler.options ?? []) {
        opt.revealInstant?.();
      }
      // NB: no setCursor here - the reward reticle ("cursor" image) rasterizes as a big
      // magenta placeholder box in the harness (same as the accepted stormglass-picker
      // golden) whose presence/position varies with the shared texture cache across the
      // batch. Leaving it at its default keeps the 4 revealed tiles clean + deterministic.
      ui.setActiveHandler?.(handler);
    },
    diffTolerance: 2000,
  },
  // The in-battle FIGHT move-select (UiMode.FIGHT): the 4 moves + PP + type/effectiveness bar,
  // OVER the live battlefield (field: true draws the arena + mon sprites + HP bars beneath the
  // menu). The mode path builds the real FightUiHandler and calls show([fieldIndex]) while the
  // pipeline sits on the CommandPhase (so getPokemon resolves); enemy + moveset are pinned so the
  // move list + field are fixed (coarse tolerance for the live battle sprites). NOTE: these battle
  // menus deliberately do NOT drive the real ui.setMode(FIGHT/BALL/TARGET) in prepare - that leaves
  // the shared globalScene UI stuck in a battle sub-mode and breaks the NEXT recipe's startBattle;
  // the mode path is side-effect-free (pipeline left on the safe COMMAND mode).
  "fight-menu": {
    mode: UiMode.FIGHT,
    field: true,
    prepare: async game => {
      game.override
        .enemySpecies(SpeciesId.MAGIKARP)
        .moveset([MoveId.TACKLE, MoveId.TAIL_WHIP, MoveId.QUICK_ATTACK, MoveId.HYPER_FANG]);
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      return [0]; // fieldIndex 0; fromCommand defaults to Command.FIGHT
    },
    diffTolerance: 60000, // live battle sprites on the field (see Recipe.diffTolerance)
  },
  // The in-battle BALL menu (UiMode.BALL) in a wild battle: the pokeball type list + counts, over
  // the live battlefield. Mode path (side-effect-free, see fight-menu note); enemy pinned; coarse
  // tolerance for the battle sprites.
  "ball-menu": {
    mode: UiMode.BALL,
    field: true,
    prepare: async game => {
      game.override.enemySpecies(SpeciesId.MAGIKARP);
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      return [];
    },
    diffTolerance: 60000, // live battle sprites on the field (see Recipe.diffTolerance)
  },
  // TARGET_SELECT in a DOUBLE battle (UiMode.TARGET_SELECT): the target cursor over the two foes
  // when a single-target move (Tackle) is chosen (getMoveTargets yields both foe slots), over the
  // double battlefield. TARGET_SELECT is a pure OVERLAY with no chrome of its own, so it NEEDS
  // field: true to be meaningful (without the battlefield beneath, it renders a blank frame). Mode
  // path builds the real handler; enemy pinned; coarse tolerance for the battle sprites.
  "target-select": {
    mode: UiMode.TARGET_SELECT,
    field: true,
    prepare: async game => {
      game.override.battleStyle("double").enemySpecies(SpeciesId.MAGIKARP);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      return [0, MoveId.TACKLE, () => {}];
    },
    diffTolerance: 60000, // live battle sprites on the field (see Recipe.diffTolerance)
  },
  // The Egg Gacha machines (UiMode.EGG_GACHA): the three gacha handles + the voucher tallies.
  // Seed a spread of vouchers across tiers so the pull-count displays populate. The legendary
  // gacha panel shows a rotating legendary + a live countdown (wall-clock), so a coarse
  // tolerance covers that one changing region while still catching gross breakage.
  "egg-gacha": {
    mode: UiMode.EGG_GACHA,
    prepare: game => {
      game.scene.gameData.voucherCounts[VoucherType.REGULAR] = 12;
      game.scene.gameData.voucherCounts[VoucherType.PLUS] = 5;
      game.scene.gameData.voucherCounts[VoucherType.PREMIUM] = 2;
      game.scene.gameData.voucherCounts[VoucherType.GOLDEN] = 1;
      return [];
    },
    // The legendary-gacha panel shows a DAILY-rotating featured legendary + a live countdown,
    // so both the sprite and the timer change with the wall-clock date - a coarse tolerance
    // covers that whole panel while the gate still catches gross breakage of the machines/tallies.
    diffTolerance: 80000,
  },
  // The Egg List (UiMode.EGG_LIST): the grid of held eggs + the selected egg's detail panel.
  // Seed three eggs of different tiers (fixed id AND timestamp so both the per-egg roll and the
  // "obtained on" date are deterministic; not shiny so no run-varying sparkle). Static -> exact.
  "egg-list": {
    mode: UiMode.EGG_LIST,
    prepare: game => {
      const ts = 1_600_000_000_000;
      game.scene.gameData.eggs = [
        new Egg({ scene: game.scene, id: 1001, tier: EggTier.COMMON, isShiny: false, timestamp: ts }),
        new Egg({ scene: game.scene, id: 1002, tier: EggTier.RARE, isShiny: false, timestamp: ts }),
        new Egg({ scene: game.scene, id: 1003, tier: EggTier.EPIC, isShiny: false, timestamp: ts }),
      ];
      return [];
    },
    diffTolerance: 0,
  },
  // The Save Slot select (UiMode.SAVE_SLOT) in LOAD mode: the 5 session slots (all Empty on a
  // fresh save) + slot chrome. Args are [SaveSlotUiMode, callback]. Static -> exact diff.
  "save-slot": {
    mode: UiMode.SAVE_SLOT,
    prepare: () => [SaveSlotUiMode.LOAD, () => {}],
    diffTolerance: 0,
  },
  // The Game Stats screen (UiMode.GAME_STATS): the paged stat grid, read from the live gameData
  // (ER init pre-seeds the starter/seen counts, else zeros). Custom render (the handler chains
  // ui.moveTo(...).hideTooltip(), which the mock shims). Coarse tolerance: a prior page in a batch
  // may have caught extra species, nudging the seen/caught stat text.
  "game-stats": {
    render: game => shimUiAndShow(game, UiMode.GAME_STATS, []),
    diffTolerance: 8000,
  },
  // The Run History screen (UiMode.RUN_HISTORY): the saved-run list. No runs are seeded (a real
  // run-history entry needs a full SessionSaveData round-trip, not cheap), so this renders the
  // genuine EMPTY-list state + chrome. Static -> exact diff.
  "run-history": {
    mode: UiMode.RUN_HISTORY,
    prepare: () => [],
    diffTolerance: 0,
  },
  // The Challenge select (UiMode.CHALLENGE_SELECT): the challenge toggle list. Force CHALLENGE
  // mode so gameMode.challenges is populated (classic's is empty) and every challenge row renders
  // with its value stepper. Custom render (the handler reorders its container via ui.moveTo/length,
  // shimmed). Static -> exact diff.
  "challenge-select": {
    render: game => {
      game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
      shimUiAndShow(game, UiMode.CHALLENGE_SELECT, []);
    },
    diffTolerance: 0,
  },
  // The in-run pause MENU (UiMode.MENU): the top-level menu option list. Custom render (the handler
  // reorders its container via ui.moveTo/length, shimmed). Static -> exact diff.
  menu: {
    render: game => shimUiAndShow(game, UiMode.MENU, []),
    diffTolerance: 0,
  },
  // The co-op LOBBY STAGE (#633 lobby v2, #781): the dimmed backdrop + CO-OP LOBBY header +
  // two seat cards + context strip the title-phase lobby renders behind its option panel.
  // Custom render (a bare presentation container, not a UiHandler). This page CAUGHT the
  // live "lobby invisible" bug: the ui container is BOTTOM-anchored, so the original
  // (0,0)-anchored root rendered a full screen below the canvas (0 non-blank px). NB the
  // card texts render light-on-light here (the harness light-window fallback, same as
  // colosseum) - in-game windows are dark, contrast is fine. Static -> exact diff.
  "coop-lobby": {
    render: async game => {
      const { CoopLobbyStage } = await import("#ui/coop-lobby-stage");
      const stage = new CoopLobbyStage("Heraklines");
      stage.setSeat(1, { name: "Scooom", detail: "Wants to join!", dot: "red" });
      stage.setStatus("Scooom wants to join your run!");
      // Compose the INPUT panel exactly as title-phase renderPanel shows it (right-edge
      // anchored, docked into the stage's ACTIONS band) so the golden image guards the
      // COMBINED screen - the "panel overlaps the cards" class is a pixel diff here.
      shimUiAndShow(game, UiMode.OPTION_SELECT, [
        {
          options: [
            { label: "Accept Scooom", handler: () => true },
            { label: "Decline", handler: () => true },
            { label: "Play vs CPU", handler: () => true },
            { label: "Cancel", handler: () => true },
          ],
          maxOptions: 6,
          xOffset: 2,
          yOffset: 40,
        },
      ]);
    },
    diffTolerance: 0,
  },
  // The ER Colosseum standings board (UiMode.COLOSSEUM) [ER, #439] - ZERO prior coverage anywhere.
  // A 15-entrant press-your-luck gauntlet mid-run: the BW2 PWT board, the two-column roster
  // (cleared/next-up revealed, the rest dark silhouettes), the banked-grade panel, and the
  // CONTINUE / CASH OUT buttons. RIGHT toggles the two buttons. NOTE: the deep-navy PWT chrome +
  // class portraits are CDN-only assets that stay behind a `textures.exists` gate the two-pass
  // injector can't pre-satisfy, so the board falls back to the light engine window (text renders
  // low-contrast) - the structure/layout/cursor still render + regress-guard. Static -> exact.
  colosseum: {
    mode: UiMode.COLOSSEUM,
    prepare: () => colosseumDemoArgs(),
    steps: [Button.RIGHT],
    diffTolerance: 0,
  },
  // The ER Quiz/Minigame panel (UiMode.ER_QUIZ) [ER, #439] - ZERO prior coverage. The compact
  // dex-blurb question card: header + wrapped Pokedex blurb + four answer buttons. DOWN walks the
  // answer cursor. NOTE: the card is a dark-themed window; the harness renders windows in their
  // light base colour, so the light card text is low-contrast here (the card + 4 buttons + cursor
  // structure render + regress-guard). Static -> exact diff.
  "er-quiz": {
    mode: UiMode.ER_QUIZ,
    prepare: () => [
      {
        header: "Who's that Pokémon?  (1/5)",
        prompt:
          "A legendary bird Pokémon. It is said that one appears when a doomed ship is about to sink, and guides it to safety.",
        options: ["Articuno", "Lugia", "Ho-Oh", "Zapdos"],
      },
      () => {},
    ],
    steps: [Button.DOWN],
    diffTolerance: 0,
  },
  // The ER World Map node PICKER (UiMode.ER_MAP_PICKER) [ER, #486] - the branching route chooser
  // shown when leaving a biome. Mirrors the er-map recipe's node-building: three revealed onward
  // biomes across the base/upgrade/event colour-key sources. DOWN walks the cursor down the route
  // list. (The route graph + nodes render; the picker's dark-theme biome-name labels are
  // low-contrast, same harness limitation as noted above.) Static -> exact diff.
  "er-map-picker": {
    mode: UiMode.ER_MAP_PICKER,
    prepare: () => {
      const nodes = [
        { biome: BiomeId.VOLCANO, revealed: true, source: "base" as const },
        { biome: BiomeId.GRASS, revealed: true, source: "upgrade" as const },
        { biome: BiomeId.ICE_CAVE, revealed: true, source: "event" as const },
      ];
      return [{ nodes, origin: BiomeId.PLAINS, onSelect: () => {} }];
    },
    steps: [Button.DOWN, Button.DOWN],
    diffTolerance: 0,
  },
  // The level-up Move Learn panel (UiMode.LEARN_MOVE_BATCH) [ER QoL]: LEARNABLE | CURRENT columns +
  // the mon's icon/base-stat side panel + the move-info overlay. Drives the real handler with a
  // live player mon (fixed 2-move set so CURRENT is deterministic) and four offerable moves.
  // Static -> exact diff.
  "learn-move-batch": {
    mode: UiMode.LEARN_MOVE_BATCH,
    prepare: async game => {
      game.override.moveset([MoveId.TACKLE, MoveId.REST]); // pin CURRENT for a stable golden
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const pokemon = game.scene.getPlayerPokemon();
      if (!pokemon) {
        throw new Error("learn-move-batch recipe: no player pokemon after startBattle");
      }
      return [
        {
          pokemon,
          learnableIds: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.FIRE_PUNCH],
          assign: () => {},
          revert: () => {},
          done: () => {},
          fallback: () => {},
        },
      ];
    },
    diffTolerance: 0,
  },
  // NOTE: TITLE (UiMode.TITLE) is intentionally NOT a recipe - it is animation-tier. Its
  // titleContainer starts at alpha 0 and fades in via an alpha tween; the harness force-completes
  // tweens to onComplete WITHOUT applying the tweened alpha, so the container stays invisible (a
  // blank frame, nonBlankPx 0). On top of that the splash line + backdrop Pokemon are picked at
  // RANDOM each show(), so even forcing the alpha would leave the golden non-deterministic.
  // (Verified: renders blank.) Likewise EVOLUTION_SCENE / EGG_HATCH_SCENE are animation-driven
  // cutscenes (a static show() renders only the pre-animation frame) and are left out.
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Resolve ER_RENDER_PAGE into the list of pages to render in this run. */
function resolvePages(): string[] {
  if (PAGE_ARG === "all") {
    return Object.keys(RECIPES);
  }
  if (PAGE_ARG.includes(",")) {
    return PAGE_ARG.split(",")
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [PAGE_ARG];
}
const PAGES = resolvePages();

describe.skipIf(!RUN)("render-ui-page", () => {
  let phaserGame: Phaser.Game;
  let ctx: RenderContext;
  // Across a batch run the GameManager reuses globalScene; restore its real render members
  // before each new construction (the prior page left them re-pointed at our mock).
  let lastScene: any = null;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    ctx = await createRenderScene();
  });

  it.each(PAGES)(`renders the "%s" page to a PNG`, async (PAGE: string) => {
    const recipe = RECIPES[PAGE];
    expect(recipe, `no render recipe for page "${PAGE}" (have: ${Object.keys(RECIPES).join(", ")})`).toBeDefined();

    // Batch run: hand the real UI back before re-instrumenting it in a new GameManager.
    if (lastScene) {
      restoreGlobalScene(lastScene);
    }
    const game = new GameManagerClass(phaserGame);
    lastScene = game.scene;

    // Mode-based pages: run prepare + capture the handler CLASS on the ORIGINAL scene
    // (it still has the full UI + phases), THEN re-point rendering at the canvas.
    // We construct a FRESH handler instance per pass against the re-pointed scene -
    // the registered instance was first setup() under the mock factory, so its cached
    // children are MockSprites that crash when re-added to a real Container.
    let args: any[] = [];
    let HandlerClass: any;
    let registered: any;
    if (recipe.captureActive) {
      // Phase-flow bridge: wrap the REAL ui.setMode to record the last screen the phase
      // pipeline transitions to during prepare(game), then render THAT handler.
      const realUi: any = game.scene.ui;
      let captured: any = null;
      for (const m of ["setMode", "setModeWithoutClear", "setModeForceTransition", "setOverlayMode"]) {
        const orig = realUi[m]?.bind(realUi);
        if (orig) {
          realUi[m] = (mode: any, ...a: any[]) => {
            captured = { mode, args: a };
            return orig(mode, ...a);
          };
        }
      }
      await recipe.prepare?.(game);
      expect(captured, `${PAGE}: captureActive recipe drove no ui.setMode transition`).not.toBeNull();
      args = captured.args;
      registered = game.scene.ui.handlers[captured.mode];
      HandlerClass = registered?.constructor;
    } else if (recipe.mode != null) {
      args = recipe.prepare ? await recipe.prepare(game) : [];
      registered = game.scene.ui.handlers[recipe.mode];
      expect(registered, `handler for mode ${recipe.mode} must be registered`).toBeDefined();
      HandlerClass = registered?.constructor;
    }

    repointGlobalScene(game.scene, ctx);
    await sleep(0);

    let renderError: unknown = null;
    const run = async () => {
      try {
        if (recipe.field) {
          await renderBattlefield(game.scene, ctx);
          // The in-battle bottom band is the MESSAGE handler's window (the command menu
          // renders ON it in-game). Build it fresh beneath the active handler; a failure
          // here only costs the bar, not the page.
          try {
            const msgReg: any = (game.scene as any).ui.handlers[UiMode.MESSAGE];
            const msgHandler: any = new msgReg.constructor();
            msgHandler.setup();
            msgHandler.show([]);
          } catch {
            /* no message bar - battlefield + handler still render */
          }
        }
        if (recipe.render) {
          await recipe.render(game, ctx);
        } else if (HandlerClass || registered) {
          let handler = registered;
          try {
            handler = new HandlerClass();
          } catch {
            handler = registered;
          }
          handler.setup();
          handler.show(args);
          // Make this the active handler so input driving routes presses to it.
          (game.scene as any).ui.setActiveHandler?.(handler);
        }
      } catch (e) {
        renderError = e;
        mkdirSync("dev-logs/ui-pages", { recursive: true });
        writeFileSync(`dev-logs/ui-pages/${PAGE}-error.txt`, String((e as Error)?.stack ?? e));
      }
    };
    const stats = await renderTwoPass(ctx, run).catch(e => {
      renderError = e;
      mkdirSync("dev-logs/ui-pages", { recursive: true });
      writeFileSync(`dev-logs/ui-pages/${PAGE}-error.txt`, String((e as Error)?.stack ?? e));
      return { injected: [], unresolved: [] as string[] };
    });

    // --- Input driving (universal) ----------------------------------------------------
    // Fire the recipe's button sequence on the LIVE page. Each press goes to the currently
    // active handler via the ui surface, so a press that calls setMode() to another screen
    // (confirm dialog, option select, sub-menu) builds + renders that screen too. A throw
    // IS the reproduction of an input-triggered crash/softlock. Per-step snapshots land at
    // `<page>-stepN.png`; the main PNG below ends on the FINAL post-input state.
    let stepCrash: string | null = null;
    const steps: Button[] = recipe.steps ?? [];
    for (let i = 0; i < steps.length && !stepCrash; i++) {
      ctx.missing.clear();
      try {
        const h = (game.scene as any).ui.getHandler?.() ?? registered;
        // await: catch a handler that does async work and rejects later (Codex review).
        await h?.processInput?.(steps[i]);
      } catch (e) {
        stepCrash = String((e as Error)?.stack ?? e);
        mkdirSync("dev-logs/ui-pages", { recursive: true });
        writeFileSync(`dev-logs/ui-pages/${PAGE}-step${i}-crash.txt`, stepCrash);
      }
      ctx.step();
      await injectMissing(ctx); // a freshly opened sub-menu requests its own textures
      for (let s = 0; s < 3; s++) {
        ctx.step();
        await sleep(10);
      }
      freezeAnimations(ctx.uiInner);
      freezeAnimations(ctx.fieldRoot);
      ctx.step();
      ctx.snapshot(join("dev-logs", "ui-pages", `${PAGE}-step${i}.png`));
    }

    // Stepped-animation capture: a flip-book of LIVE frames (no freeze) for anim/race repro.
    const frameCount = Number(process.env.ER_FRAMES ?? "0") || recipe.frames || 0;
    for (let f = 0; f < frameCount; f++) {
      ctx.step();
      await sleep(8);
      ctx.snapshot(join("dev-logs", "ui-pages", `${PAGE}-frame${String(f).padStart(2, "0")}.png`));
    }

    // Pin animated sprites to frame 0 so the snapshot is byte-deterministic (golden diff).
    freezeAnimations(ctx.uiInner);
    freezeAnimations(ctx.fieldRoot);
    ctx.step();
    const out = join("dev-logs", "ui-pages", `${PAGE}${SIMULATE_MISSING ? "-missing" : ""}.png`);
    const { nonBlankPx } = ctx.snapshot(out);
    for (const s of findSuspectSprites(ctx)) {
      // biome-ignore lint/suspicious/noConsole: harness diagnostics
      console.log(`[suspect] ${PAGE}: ${s}`);
    }
    // biome-ignore lint/suspicious/noConsole: harness diagnostics
    console.log(
      "WROTE",
      out,
      "nonBlankPx",
      nonBlankPx,
      "injected",
      stats.injected.length,
      JSON.stringify(stats.injected.slice(0, 30)),
      "unresolved",
      JSON.stringify(stats.unresolved.slice(0, 20)),
      steps.length > 0 ? `steps ${steps.length}${stepCrash ? " CRASHED" : ""}` : "",
    );

    expect(nonBlankPx).toBeGreaterThan(0);
    if (recipe.expectThrow) {
      expect(stepCrash, `${PAGE}: expected an input-triggered crash but none occurred`).not.toBeNull();
    } else {
      expect(renderError, `${PAGE} render threw`).toBeNull();
      expect(stepCrash, `${PAGE}: an input step threw - see dev-logs/ui-pages/${PAGE}-step*-crash.txt`).toBeNull();
    }

    // --- Golden-image regression gate -------------------------------------------------
    // Skip the SIMULATE_MISSING variant and crash-repro recipes (not stable baselines).
    if (!SIMULATE_MISSING && !recipe.expectThrow && !recipe.captureActive) {
      const baseline = join(BASELINE_DIR, `${PAGE}.png`);
      if (UPDATE_BASELINE || !existsSync(baseline)) {
        mkdirSync(BASELINE_DIR, { recursive: true });
        copyFileSync(out, baseline);
        // biome-ignore lint/suspicious/noConsole: harness diagnostics
        console.log("BASELINE", existsSync(baseline) && !UPDATE_BASELINE ? "written (new)" : "updated", baseline);
      } else {
        const diffOut = join("dev-logs", "ui-pages", `${PAGE}-diff.png`);
        const { changed, total, dimsMatch } = await pixelDiff(out, baseline, diffOut);
        const tol = recipe.diffTolerance ?? DIFF_TOLERANCE;
        // biome-ignore lint/suspicious/noConsole: harness diagnostics
        console.log("DIFF", PAGE, "changed", changed, "/", total, "tol", tol, dimsMatch ? "" : "(DIMENSIONS CHANGED)");
        expect(
          changed,
          `${PAGE} differs from its golden baseline by ${changed}px (> ${tol}). See dev-logs/ui-pages/${PAGE}-diff.png (red = changed). If the change is intended, re-baseline with ER_UPDATE_BASELINE=1.`,
        ).toBeLessThanOrEqual(tol);
      }
    }
  }, 180000);

  // ===========================================================================
  // #349 - black-shiny GIFT cycle visibly refreshes the SUMMARY Abilities page.
  // This is the explicit before/after VERIFICATION for the fix (the `summary`
  // recipe above gives the golden render; this drives R and asserts the gift row
  // actually changed). Before the fix the data advanced but the page-cursor
  // re-render dropped the forced-refresh flag, so the rendered row never redrew:
  // name + idx/choices stayed put. After the fix the handler redraws the page in
  // place, so both change. We assert on the rebuilt `abilitiesRows` (the gift is
  // the LAST row) AND pixel-diff the before/after frames (the row text changed).
  // ===========================================================================
  it.skipIf(!(PAGES.includes("summary") || PAGE_ARG === "all"))(
    "summary gift-cycle (R) redraws the black-shiny gift row in place (#349)",
    async () => {
      // Whitebox view of the handler's private state under test (the established
      // pattern in test/tests/ui/summary-ui-3-passive-slots.test.ts - a typed
      // double-cast, NOT `as any`). These are exactly the fields the ABILITIES
      // page render + the gift-cycle handler touch.
      type GiftRow = { ability: { id: AbilityId; name: string }; y: number; locked: boolean };
      type SummaryGiftInternals = {
        pokemon: unknown;
        cursor: number;
        abilitiesRows: GiftRow[];
        setup(): void;
        show(args: any[]): boolean;
        processInput(button: Button): boolean;
      };

      // Batch-run hygiene: hand the real UI back before a new GameManager re-instruments it.
      if (lastScene) {
        restoreGlobalScene(lastScene);
      }
      const game = new GameManagerClass(phaserGame);
      lastScene = game.scene;

      // Build the black-shiny lead on the ORIGINAL scene (full data + phases), capture the
      // registered handler CLASS, THEN re-point rendering at the canvas (mirrors the recipe path).
      const mon = await startBattleWithBlackShinyLead(game);
      const registered: any = game.scene.ui.handlers[UiMode.SUMMARY];
      expect(registered, "SUMMARY handler must be registered").toBeDefined();
      const HandlerClass: any = registered.constructor;

      repointGlobalScene(game.scene, ctx);
      await sleep(0);

      // A fresh handler per the harness convention (the registered instance's children are
      // MockSprites from boot and crash when re-added to a real Container). It opens directly
      // on the ABILITIES page with our black shiny.
      let handler: SummaryGiftInternals;
      const build = () => {
        // HandlerClass is `any` (from the registered instance's constructor), so the new
        // instance flows into the typed view without an `as any` cast. Fall back to the
        // registered instance if the ctor needs args.
        let h: SummaryGiftInternals;
        try {
          h = new HandlerClass();
        } catch {
          h = registered;
        }
        h.setup();
        h.show([mon, undefined /* SummaryUiMode.DEFAULT */, SUMMARY_PAGE_ABILITIES]);
        handler = h;
      };

      // Two-pass render so textures resolve, then settle - this is the BEFORE state.
      await renderTwoPass(ctx, build);
      expect(handler!.cursor, "handler should be on the ABILITIES page").toBe(SUMMARY_PAGE_ABILITIES);
      const giftBefore = handler!.abilitiesRows.at(-1);
      expect(giftBefore, "a gift row must be present for a black shiny").toBeDefined();
      // Sanity: the gift row is our index-0 choice (STURDY) before any cycle.
      expect(giftBefore!.ability.id).toBe(GIFT_CHOICES[0]);
      freezeAnimations(ctx.uiInner);
      ctx.step();
      const beforePng = join("dev-logs", "ui-pages", "summary-before.png");
      ctx.snapshot(beforePng);
      const nameBefore = giftBefore!.ability.name;
      const idBefore = giftBefore!.ability.id;

      // Press R (Button.CYCLE_SHINY) - the gift-cycle handler advances the gift AND (after the
      // fix) redraws the page in place. Settle the same way the recipe step-driver does.
      ctx.missing.clear();
      const pressed = handler!.processInput(Button.CYCLE_SHINY);
      expect(pressed, "R on the ABILITIES page of a player black shiny should be handled").toBe(true);
      ctx.step();
      await injectMissing(ctx);
      for (let s = 0; s < 4; s++) {
        ctx.step();
        await sleep(10);
      }
      freezeAnimations(ctx.uiInner);
      ctx.step();
      const afterPng = join("dev-logs", "ui-pages", "summary-after.png");
      ctx.snapshot(afterPng);

      // The rebuilt gift row must now show the NEXT choice (LEVITATE), with a different name+id.
      const giftAfter = handler!.abilitiesRows.at(-1);
      expect(giftAfter, "gift row must still be present after the cycle").toBeDefined();
      const nameAfter = giftAfter!.ability.name;
      const idAfter = giftAfter!.ability.id;
      // biome-ignore lint/suspicious/noConsole: harness diagnostics (the before/after EVIDENCE)
      console.log(`SUMMARY GIFT CYCLE #349  before="${nameBefore}"(${idBefore})  after="${nameAfter}"(${idAfter})`);

      // THE FIX: the rendered gift row's ability changed. Before the fix idAfter === idBefore
      // (the display was stuck on Sturdy / "Gift 1/3") even though the data advanced.
      expect(idAfter, "the gift row's ability id must advance to the next choice").toBe(GIFT_CHOICES[1]);
      expect(idAfter, "the gift row's ability id must change after R").not.toBe(idBefore);
      expect(nameAfter, "the gift row's ability NAME must change after R").not.toBe(nameBefore);

      // And the pixels changed: the rebuilt row text differs, so the before/after frames diff.
      const { changed, dimsMatch } = await pixelDiff(
        afterPng,
        beforePng,
        join("dev-logs", "ui-pages", "summary-cycle-diff.png"),
      );
      // biome-ignore lint/suspicious/noConsole: harness diagnostics
      console.log(`SUMMARY GIFT CYCLE #349  pixels changed before->after: ${changed} (dimsMatch=${dimsMatch})`);
      expect(dimsMatch, "frames must share dimensions").toBe(true);
      expect(changed, "the gift row redraw must change rendered pixels").toBeGreaterThan(0);
    },
    180000,
  );
});
