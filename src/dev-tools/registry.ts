/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Local-only dev-tools registry (tracked, but inert without local modules).
//
// The actual dev tools (test-scenario harness + console-log button) live under
// `src/dev-tools/local/`, which is GITIGNORED — never pushed to GitHub. This
// registry is the tiny tracked extension point that:
//
//   1. lazily loads those local modules IF they exist AND dev tools are enabled
//      (`import.meta.env.DEV` — i.e. `npm run start:dev` — or `VITE_DEV_TOOLS=1`);
//   2. lets a local module register main-menu items (consumed by TitlePhase);
//   3. lets a local module stage a "pending" party so a scenario can drop the
//      player straight into a battle, skipping starter-select (consumed by
//      SelectStarterPhase).
//
// On a clean checkout (no `src/dev-tools/local/` present) the glob matches
// nothing → every function here is a harmless no-op and no menu items appear.
// =============================================================================

import Overrides from "#app/overrides";
import { speciesStarterCosts } from "#balance/starters";
import { SHOWDOWN_ITEM_POOL } from "#data/elite-redux/showdown/showdown-item-pool";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { makeShowdownTeamPreset, type ShowdownTeamPreset } from "#data/elite-redux/showdown/showdown-team-preset";
import type { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { Starter, StarterMoveset } from "#types/save-data";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";

/** Context handed to dev-menu factories so they can launch runs. */
export interface DevMenuCtx {
  /**
   * Start a fresh run in the given game mode, mirroring the title-screen
   * "New Game" flow. A local module typically calls
   * {@linkcode setPendingDevStarters} first, then `startRunWithMode(CLASSIC)`
   * so SelectStarterPhase auto-submits the staged party.
   */
  startRunWithMode: (gameMode: GameModes) => void;
}

/** A factory that, given launch context, returns one or more menu items. */
export type DevMenuFactory = (ctx: DevMenuCtx) => OptionSelectItem | OptionSelectItem[];

const factories: DevMenuFactory[] = [];

/** Register a main-menu item factory (called by a local dev module on load). */
export function registerDevMenu(factory: DevMenuFactory): void {
  factories.push(factory);
}

/** Resolve all registered dev-menu items for the title screen. Empty if none. */
export function getDevMenuItems(ctx: DevMenuCtx): OptionSelectItem[] {
  return factories.flatMap(factory => {
    try {
      const result = factory(ctx);
      return Array.isArray(result) ? result : [result];
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
      console.warn("[dev-tools] menu factory threw:", err);
      return [];
    }
  });
}

// --- Pending-party handoff (scenario → SelectStarterPhase) -------------------

let pendingStarters: Starter[] | null = null;

/** Stage a party for the next run so starter-select is skipped. */
export function setPendingDevStarters(starters: Starter[]): void {
  pendingStarters = starters;
}

/** Take (and clear) any staged party. Returns null if none was staged. */
export function consumePendingDevStarters(): Starter[] | null {
  const s = pendingStarters;
  pendingStarters = null;
  return s;
}

// --- Exact-build public-browser starter checkpoints -------------------------

/**
 * Whether this exact bundle was built for the dedicated Commander public-UI journey.
 *
 * This is deliberately separate from the broad staging dev-tools switch. Normal local,
 * staging, and production builds never set this exact value, so a URL parameter alone
 * cannot expose an unavailable starter or alter a player's starter screen.
 */
export function isCoopBrowserCommanderFixtureBuild(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return env?.VITE_COOP_BROWSER_FIXTURE === "commander-skip";
}

/** Whether this exact bundle was built for the deterministic faint-replacement browser journey. */
export function isCoopBrowserFaintFixtureBuild(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return env?.VITE_COOP_BROWSER_FIXTURE === "faint-replacement";
}

/** Whether this exact bundle was built for the retained GameOver public-browser journey. */
export function isCoopBrowserGameOverFixtureBuild(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return env?.VITE_COOP_BROWSER_FIXTURE === "game-over";
}

/** Whether this exact bundle was built for the full public-UI campaign matrix. */
export function isCoopBrowserCampaignFixtureBuild(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return env?.VITE_COOP_BROWSER_FIXTURE === "campaign-survival";
}

/** Require both the dedicated campaign bundle and its exact Mystery-profile URL token. */
export function isCoopBrowserCampaignFixtureActive(): boolean {
  if (!isCoopBrowserCampaignFixtureBuild() || typeof location === "undefined") {
    return false;
  }
  return new URLSearchParams(location.search).get("coopfixture") === "campaign-survival";
}

/** Whether this exact bundle was built for the continuous 30-wave navigation journey. */
export function isCoopBrowserNavigationFixtureBuild(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return env?.VITE_COOP_BROWSER_FIXTURE === "navigation-depth-30";
}

/**
 * Require both the immutable bundle identity and the exact public-journey URL token.
 * A copied query parameter in any normal local, staging, or production bundle is inert.
 */
export function isCoopBrowserNavigationFixtureActive(): boolean {
  if (!isCoopBrowserNavigationFixtureBuild() || typeof location === "undefined") {
    return false;
  }
  return new URLSearchParams(location.search).get("coopfixture") === "navigation-depth-30";
}

/** Whether this exact bundle was built to exercise retained evolution presentation in two browsers. */
export function isCoopBrowserEvolutionFixtureBuild(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return env?.VITE_COOP_BROWSER_FIXTURE === "evolution-sync";
}

/** Require both the immutable evolution bundle and its exact public-journey URL token. */
export function isCoopBrowserEvolutionFixtureActive(): boolean {
  if (!isCoopBrowserEvolutionFixtureBuild() || typeof location === "undefined") {
    return false;
  }
  return new URLSearchParams(location.search).get("coopfixture") === "evolution-sync";
}

/** Whether this exact bundle was built for the Revival + Stormglass public-browser journey. */
export function isCoopBrowserRegisteredInteractionFixtureBuild(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return env?.VITE_COOP_BROWSER_FIXTURE === "registered-interactions";
}

/**
 * The registered-interaction fixture needs one later wave-start hook in addition to its visible
 * starter roster. Require both the immutable build identity and one exact per-seat URL token so a
 * copied query parameter can never alter an ordinary staging/production run.
 */
export function isCoopBrowserRegisteredInteractionFixtureActive(): boolean {
  if (!isCoopBrowserRegisteredInteractionFixtureBuild() || typeof location === "undefined") {
    return false;
  }
  const fixture = new URLSearchParams(location.search).get("coopfixture");
  return fixture === "registered-owner" || fixture === "registered-partner";
}

/** Whether this exact bundle was built for the public two-browser Showdown battle journey. */
export function isCoopBrowserShowdownFixtureBuild(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return env?.VITE_COOP_BROWSER_FIXTURE === "showdown-battle";
}

/**
 * Supply one ordinary legal preset to the dedicated Showdown public-browser bundle.
 *
 * This fixture is inert unless both the immutable build identity and the exact page URL agree.
 * It does not persist or auto-select anything: each browser still opens the normal team menu,
 * confirms the visible preset, pairs, chooses its wager, and commands the battle through public
 * keyboard input. Pelipper's ordinary Drizzle lead deterministically exercises both an ability flyout
 * and weather animation before command input. Arcanine supplies a legal voluntary-switch target whose
 * active Intimidate exercises switch, ability, and stat-stage presentation before the next command frontier;
 * the fixture bundle supplies that legal preset independently of the ephemeral test account's unlocks.
 */
export function getCoopBrowserShowdownFixturePreset(): ShowdownTeamPreset | null {
  if (!isCoopBrowserShowdownFixtureBuild() || typeof location === "undefined") {
    return null;
  }
  if (new URLSearchParams(location.search).get("coopfixture") !== "showdown-battle") {
    return null;
  }
  const drizzleLead: ShowdownMonManifest = {
    speciesId: SpeciesId.PELIPPER,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    // Elite Redux Pelipper is [DRIZZLE, RETRIEVER, ...]. Slot 0 is the deterministic entry trigger
    // this fixture promises; slot 1 silently selected Retriever and made the browser oracle wait for
    // an ability/weather presentation the production battle could never emit.
    abilityIndex: 0,
    ivs: new Array(6).fill(15),
    moveset: [MoveId.AIR_CUTTER],
    item: SHOWDOWN_ITEM_POOL[0],
    rootSpeciesId: SpeciesId.PELIPPER,
    erBlackShiny: false,
    baseCost: speciesStarterCosts[SpeciesId.PELIPPER],
  };
  const intimidateSwitch: ShowdownMonManifest = {
    speciesId: SpeciesId.ARCANINE,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    // Elite Redux Arcanine active slot 0 is Intimidate. Gyarados's Intimidate is instead a candy-gated
    // innate on the player side, so using it made the same manifest asymmetric between the authority's
    // player and opponent parties. The journey needs two deterministic active triggers, independent of
    // either ephemeral test account's unlocks.
    abilityIndex: 0,
    ivs: new Array(6).fill(15),
    moveset: [MoveId.TACKLE],
    item: SHOWDOWN_ITEM_POOL[0],
    rootSpeciesId: SpeciesId.ARCANINE,
    erBlackShiny: false,
    baseCost: speciesStarterCosts[SpeciesId.ARCANINE],
  };
  return makeShowdownTeamPreset("Browser Showdown", [drizzleLead, intimidateSwitch]);
}

/**
 * Materialize a durable but point-legal party for the ten-wave Mystery campaign only.
 *
 * The Mystery profile is an interaction-coverage lane, not a fresh-account balance oracle: it must cross five
 * consecutive encounters, the scripted ghost, the boss, and the Bargain without a random early wipe converting
 * a synchronization result into a survivability result. Each co-op seat receives five starter points, so Seel,
 * Castform, and Spinda (one point each) leave the fixture safely inside the real per-seat limit while still
 * fielding three replacement-capable party members. Both browsers still see, submit, and confirm the ordinary
 * starter surface;
 * every battle command, replacement, interaction, reward, and transition remains a production public-UI path.
 */
export function getCoopBrowserCampaignFixtureStarters(): Starter[] | null {
  if (!isCoopBrowserCampaignFixtureActive()) {
    return null;
  }
  return [SpeciesId.SEEL, SpeciesId.CASTFORM, SpeciesId.SPINDA].map(speciesId => ({
    speciesId,
    shiny: false,
    variant: 0,
    formIndex: 0,
    abilityIndex: 0,
    passive: false,
    nature: Nature.MODEST,
    moveset: [MoveId.WATER_SPOUT] as StarterMoveset,
    pokerus: false,
    ivs: new Array(6).fill(31),
  }));
}

/**
 * Point-legal, replacement-capable party for the navigation-only 30-wave browser journey.
 *
 * These are ordinary legal level-up moves with enough PP for longitudinal play. The level is
 * deliberately not carried in the public Starter payload: the exact-build launch boundary below
 * applies it once while constructing the initial shared save, after both humans visibly confirm
 * this normal starter screen. No later battle healing or mutation hook exists.
 */
export function getCoopBrowserNavigationFixtureStarters(): Starter[] | null {
  if (!isCoopBrowserNavigationFixtureActive()) {
    return null;
  }
  const specs = [
    { speciesId: SpeciesId.SEEL, moveId: MoveId.WATER_GUN },
    { speciesId: SpeciesId.CASTFORM, moveId: MoveId.WATER_GUN },
    { speciesId: SpeciesId.SPINDA, moveId: MoveId.TACKLE },
  ];
  return specs.map(({ speciesId, moveId }) => ({
    speciesId,
    shiny: false,
    variant: 0,
    formIndex: 0,
    abilityIndex: 0,
    passive: false,
    nature: Nature.MODEST,
    moveset: [moveId] as StarterMoveset,
    pokerus: false,
    ivs: new Array(6).fill(31),
  }));
}

/**
 * Point-legal party for the short retained-evolution two-browser proof.
 *
 * The exact launch boundary starts these ordinary starters at level 100. Initial-save construction
 * primes the first merged Seel one EXP below level 101 so ordinary wave-one EXP deterministically
 * crosses a level boundary and invokes the natural evolution gate. Unlike the survival/navigation
 * fixtures, evolution is deliberately not paused. After the visible starter confirmation, every
 * command and prompt remains an ordinary keyboard-driven production path.
 */
export function getCoopBrowserEvolutionFixtureStarters(): Starter[] | null {
  if (!isCoopBrowserEvolutionFixtureActive()) {
    return null;
  }
  const specs = [
    { speciesId: SpeciesId.SEEL, moveId: MoveId.WATER_GUN },
    { speciesId: SpeciesId.CASTFORM, moveId: MoveId.WATER_GUN },
    { speciesId: SpeciesId.SPINDA, moveId: MoveId.TACKLE },
  ];
  return specs.map(({ speciesId, moveId }) => ({
    speciesId,
    shiny: false,
    variant: 0,
    formIndex: 0,
    abilityIndex: 0,
    passive: false,
    nature: Nature.MODEST,
    moveset: [moveId] as StarterMoveset,
    pokerus: false,
    ivs: new Array(6).fill(31),
  }));
}

/** Initial-save-only construction level for longitudinal interaction/navigation browser fixtures. */
export function getCoopBrowserLongitudinalFixtureStartingLevel(): number | null {
  return isCoopBrowserCampaignFixtureActive()
    || isCoopBrowserNavigationFixtureActive()
    || isCoopBrowserEvolutionFixtureActive()
    ? 100
    : null;
}

/** Survival/navigation lanes suppress incidental evolution; the dedicated evolution lane must not. */
export function shouldPauseCoopBrowserLongitudinalFixtureEvolutions(): boolean {
  return isCoopBrowserCampaignFixtureActive() || isCoopBrowserNavigationFixtureActive();
}

/**
 * Materialize the two real player rosters for the exact Revival + Stormglass journey.
 *
 * The owner first submits Healing Wish, publicly replaces into Seel, then selects Revival Blessing
 * while Magikarp is fainted. Water Spout remains available after the one-PP revival so the same
 * ordinary battle can finish. The partner's Splash keeps the wave alive until that interaction has
 * occurred. Magikarp (4) plus Seel (1) exactly fills the visible five-point co-op budget; no
 * third reserve may be injected because the ordinary starter UI must remain the authority on cost.
 */
export function getCoopBrowserRegisteredInteractionFixtureStarters(): Starter[] | null {
  if (!isCoopBrowserRegisteredInteractionFixtureActive() || typeof location === "undefined") {
    return null;
  }
  const fixture = new URLSearchParams(location.search).get("coopfixture");
  const specs =
    fixture === "registered-owner"
      ? [
          { speciesId: SpeciesId.MAGIKARP, moveset: [MoveId.HEALING_WISH] },
          { speciesId: SpeciesId.SEEL, moveset: [MoveId.REVIVAL_BLESSING, MoveId.WATER_SPOUT] },
        ]
      : [{ speciesId: SpeciesId.BULBASAUR, moveset: [MoveId.SPLASH] }];
  return specs.map(({ speciesId, moveset }) => ({
    speciesId,
    shiny: false,
    variant: 0,
    formIndex: 0,
    abilityIndex: 0,
    passive: false,
    nature: Nature.HARDY,
    moveset: moveset as StarterMoveset,
    pokerus: false,
    ivs: new Array(6).fill(31),
  }));
}

/**
 * Return the single starter to pre-populate in the normal co-op starter UI for the
 * Commander browser checkpoint. Both the dedicated build flag and an exact per-client
 * URL value are required. The caller still renders the ordinary starter screen and the
 * browser journey must submit and confirm the visible team with public keyboard input.
 */
export function getCoopBrowserCommanderFixtureStarters(): Starter[] | null {
  if (!isCoopBrowserCommanderFixtureBuild() || typeof location === "undefined") {
    return null;
  }
  const fixture = new URLSearchParams(location.search).get("coopfixture");
  const speciesId = fixture === "commander" ? SpeciesId.TATSUGIRI : fixture === "dondozo" ? SpeciesId.DONDOZO : null;
  if (speciesId == null) {
    return null;
  }
  const moveset = (
    speciesId === SpeciesId.DONDOZO ? [MoveId.WATER_SPOUT, MoveId.TACKLE] : [MoveId.TACKLE]
  ) as StarterMoveset;
  return [
    {
      speciesId,
      shiny: false,
      variant: 0,
      formIndex: 0,
      abilityIndex: 0,
      passive: false,
      nature: Nature.HARDY,
      moveset,
      pokerus: false,
      ivs: new Array(6).fill(31),
    },
  ];
}

/**
 * Materialize the deterministic public faint-replacement precondition in the normal starter UI.
 *
 * The configured owner visibly submits a Magikarp lead with Healing Wish plus two legal reserves.
 * Healing Wish makes the first real public command self-faint without depending on a random wave-1
 * enemy, while the other seat receives a one-mon attacking team. The exact build flag and per-page
 * URL value keep this CI-only fixture unreachable in normal local, staging, and production bundles.
 */
export function getCoopBrowserFaintFixtureStarters(): Starter[] | null {
  if (!isCoopBrowserFaintFixtureBuild() || typeof location === "undefined") {
    return null;
  }
  const fixture = new URLSearchParams(location.search).get("coopfixture");
  if (fixture !== "faint-owner" && fixture !== "faint-partner") {
    return null;
  }
  const specs =
    fixture === "faint-owner"
      ? [
          // Healing Wish is self-targeting and executes before the attacking partners erase both enemies.
          // Memento required a live target, so on a won turn it could emit with no targets and never faint.
          // Two reserves keep Healing Wish's party-margin condition strictly true in the two-battler fixture.
          { speciesId: SpeciesId.MAGIKARP, moveset: [MoveId.HEALING_WISH] },
          { speciesId: SpeciesId.SEEL, moveset: [MoveId.WATER_SPOUT] },
          { speciesId: SpeciesId.RATTATA, moveset: [MoveId.TACKLE] },
        ]
      : [{ speciesId: SpeciesId.BULBASAUR, moveset: [MoveId.WATER_SPOUT] }];
  return specs.map(({ speciesId, moveset }) => ({
    speciesId,
    shiny: false,
    variant: 0,
    formIndex: 0,
    abilityIndex: 0,
    passive: false,
    nature: Nature.HARDY,
    moveset: moveset as StarterMoveset,
    pokerus: false,
    ivs: new Array(6).fill(31),
  }));
}

/**
 * Materialize a deterministic public party wipe in the normal co-op starter UI.
 *
 * Both players visibly submit one fast, Inner Focus Crobat whose only move is Memento. Inner Focus
 * makes a random Fake Out/flinch incapable of cancelling the scripted self-faint, while Crobat's
 * speed and a Jolly nature put the move ahead of ordinary wave-1 enemies. The two real command
 * surfaces therefore collect ordinary player choices, then the production battle and faint call
 * chains end the run without depending on a random enemy roll. As with every public-browser fixture,
 * both the exact bundle identity and exact per-page query must agree.
 */
export function getCoopBrowserGameOverFixtureStarters(): Starter[] | null {
  if (!isCoopBrowserGameOverFixtureBuild() || typeof location === "undefined") {
    return null;
  }
  if (new URLSearchParams(location.search).get("coopfixture") !== "game-over") {
    return null;
  }
  return [
    {
      speciesId: SpeciesId.CROBAT,
      shiny: false,
      variant: 0,
      formIndex: 0,
      abilityIndex: 0,
      passive: false,
      // Crobat's primary ability is Inner Focus; keep the slot explicit so fixture determinism
      // cannot silently change if a future caller starts supplying a different default.
      nature: Nature.JOLLY,
      moveset: [MoveId.MEMENTO] as StarterMoveset,
      pokerus: false,
      ivs: new Array(6).fill(31),
    },
  ];
}

let pendingDevStarterLevels: number[] | null = null;

/** Stage per-slot levels for the next dev party. */
export function setPendingDevStarterLevels(levels: readonly number[]): void {
  pendingDevStarterLevels = [...levels];
}

/** Take (and clear) the per-slot levels staged for the next dev party. */
export function consumePendingDevStarterLevels(): number[] | null {
  const levels = pendingDevStarterLevels;
  pendingDevStarterLevels = null;
  return levels;
}

// --- Pending player-party setup (scenario -> SelectStarterPhase) ------------
// Runs after every staged starter has become a PlayerPokemon, but before the
// first battle is created. This is early enough for held items and other roster
// state to be present when the battle UI is first built.

let pendingDevPartySetup: (() => void) | null = null;

/** Stage a callback to run once after the dev party has been constructed. */
export function setPendingDevPartySetup(setup: () => void): void {
  pendingDevPartySetup = setup;
}

/** Take (and clear) the staged pre-battle player-party callback. */
export function consumePendingDevPartySetup(): (() => void) | null {
  const cb = pendingDevPartySetup;
  pendingDevPartySetup = null;
  return cb;
}

// --- Pending custom-trainer force (scenario -> SelectStarterPhase) ----------
// Resetting a dev scenario rebuilds the title screen, whose cleanup correctly
// clears any old force. Keep the next force pending until immediately before
// newBattle() so that cleanup cannot turn Restart into a random encounter.

let pendingDevCustomTrainerForce: string | null = null;

/** Stage the custom trainer key that the next dev run must force. */
export function setPendingDevCustomTrainerForce(key: string): void {
  pendingDevCustomTrainerForce = key;
}

/** Take (and clear) the custom trainer key staged for the next dev run. */
export function consumePendingDevCustomTrainerForce(): string | null {
  const key = pendingDevCustomTrainerForce;
  pendingDevCustomTrainerForce = null;
  return key;
}

// --- One-shot mystery-encounter override (scenario → first ME) ----------------
// A scenario that forces a Mystery Encounter (via MYSTERY_ENCOUNTER_OVERRIDE +
// MYSTERY_ENCOUNTER_RATE_OVERRIDE=256) would otherwise re-force the SAME
// encounter on EVERY subsequent wave - the rate override bypasses the normal
// "no ME within 3 waves" rule. Arming this makes the override fire exactly ONCE:
// MysteryEncounterPhase consumes it after the encounter is committed, clearing
// the overrides so the rest of the run plays normally. Inert in production.

let clearMeOverrideAfterFirst = false;

/** Arm the one-shot: clear the forced-ME overrides after the next encounter. */
export function setClearMeOverrideAfterFirst(): void {
  clearMeOverrideAfterFirst = true;
}

/**
 * If armed, clear the forced-ME overrides so a scenario's forced encounter fires
 * only once (not every wave). Called from MysteryEncounterPhase once the
 * encounter is committed. No-op when not armed (production / normal runs).
 */
export function consumeClearMeOverrideAfterFirst(): void {
  if (!clearMeOverrideAfterFirst) {
    return;
  }
  clearMeOverrideAfterFirst = false;
  const O = Overrides as unknown as {
    MYSTERY_ENCOUNTER_OVERRIDE: unknown;
    MYSTERY_ENCOUNTER_RATE_OVERRIDE: unknown;
  };
  O.MYSTERY_ENCOUNTER_OVERRIDE = null;
  O.MYSTERY_ENCOUNTER_RATE_OVERRIDE = null;
}

// --- Pending mid-combat setup (scenario → first TurnInitPhase) ----------------
// Lets a scenario stage a callback that runs ONCE, after both sides are on the
// field, so it can apply mid-combat state the pre-battle Overrides can't express
// (e.g. pre-boosted stat stages). Returns null in production / clean checkout,
// so the consuming phase is inert there.

let pendingBattleSetup: (() => void) | null = null;

/** Stage a callback to run on the first turn once the battle is set up. */
export function setPendingDevBattleSetup(setup: () => void): void {
  pendingBattleSetup = setup;
}

/** Take (and clear) any staged mid-combat setup. Returns null if none was staged. */
export function consumePendingDevBattleSetup(): (() => void) | null {
  const cb = pendingBattleSetup;
  pendingBattleSetup = null;
  return cb;
}

// --- Pending shop items (scenario → first SelectModifierPhase) ----------------
// Lets a "start in the store, test a specific item" scenario guarantee specific
// reward options in the NEXT reward/shop screen (e.g. a Rare Candy to evolve a
// mon, or a Form-Change Item that resolves to a single-mon party's mega stone).
// Each entry is a `ModifierTypeFunc`; the first SelectModifierPhase merges them
// into its `customModifierSettings.guaranteedModifierTypeFuncs`. Returns null in
// production / clean checkout, so the consuming phase is inert there.

let pendingDevShop: ModifierTypeFunc[] | null = null;

/** Stage guaranteed reward options for the next reward/shop screen. */
export function setPendingDevShop(funcs: ModifierTypeFunc[]): void {
  pendingDevShop = funcs;
}

/** Take (and clear) any staged shop items. Returns null if none was staged. */
export function consumePendingDevShop(): ModifierTypeFunc[] | null {
  const f = pendingDevShop;
  pendingDevShop = null;
  return f;
}

// --- Pending custom ENEMY party (scenario builder → EncounterPhase) -----------
// Lets the scenario builder specify the enemy side slot-by-slot (species, level,
// moves, ability slot, form, boss) - something the uniform ENEMY_*_OVERRIDEs
// cannot express. EncounterPhase consumes it once when generating the wave's
// enemies and constructs each staged mon instead of rolling one. Returns null
// in production / clean checkout, so the consuming phase is inert there.

export interface DevEnemyMonSpec {
  speciesId: number;
  level?: number;
  moveIds?: number[];
  /** 0 = ability1, 1 = ability2, 2 = hidden. */
  abilitySlot?: number;
  nature?: number;
  formIndex?: number;
  isBoss?: boolean;
  shiny?: boolean;
}

let pendingDevEnemyParty: DevEnemyMonSpec[] | null = null;

/** Stage a custom enemy party for the next wave's encounter generation. */
export function setPendingDevEnemyParty(party: DevEnemyMonSpec[]): void {
  pendingDevEnemyParty = party;
}

/** Take (and clear) any staged enemy party. Returns null if none was staged. */
export function consumePendingDevEnemyParty(): DevEnemyMonSpec[] | null {
  const p = pendingDevEnemyParty;
  pendingDevEnemyParty = null;
  return p;
}

// --- Lazy, env-gated loader --------------------------------------------------

// Lazy glob: returns importers WITHOUT running them.
//   - `test-suite/`  TRACKED, shipped to the repo. Built into the STAGING bundle
//                    (which sets VITE_DEV_TOOLS=1) so the test team gets it.
//                    NEVER activates in production (gate below is false there).
//   - `local/`       GITIGNORED scratch area for personal experiments; absent on
//                    CI, so the glob just resolves to nothing there.
const localModules = import.meta.glob("./{local,test-suite}/**/index.ts");

let loadStarted = false;

/**
 * Whether dev tools are enabled: a local dev server (`import.meta.env.DEV`, i.e.
 * `npm run start:dev`) or a build with `VITE_DEV_TOOLS=1` (the staging bundle).
 * False in production. The single source of truth for gating dev-only UI/affordances.
 */
export function isDevToolsEnabled(): boolean {
  const env = import.meta.env as unknown as Record<string, unknown> | undefined;
  return !!env?.DEV || env?.VITE_DEV_TOOLS === "1";
}

/**
 * Load local dev modules if dev tools are enabled. Safe to call repeatedly.
 * Gated by env so the tools never activate in a production build even if the
 * (gitignored) files happen to be present in the working tree.
 */
export async function loadDevTools(): Promise<void> {
  if (loadStarted) {
    return;
  }
  loadStarted = true;

  if (!isDevToolsEnabled()) {
    return;
  }

  for (const load of Object.values(localModules)) {
    try {
      await load();
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
      console.warn("[dev-tools] failed to load a local module:", err);
    }
  }
}
