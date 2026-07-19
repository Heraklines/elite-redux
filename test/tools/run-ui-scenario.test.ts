/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// HEADLESS UI-SURFACE RUNNER (NOT a real test — a CLI-driven harness).
//
// The combat sibling (run-scenario.test.ts) plays BATTLES headlessly. This one
// drives the NON-combat UI surfaces the same way: it boots the REAL game
// headlessly (GameManager, real BattleScene, real UI handlers, ER species/sprite
// wiring) and exercises a surface's handler directly, then prints what the screen
// WOULD render — without a browser and without pixels.
//
// Why this catches "visual" bugs without rendering: most reported visual bugs are
// really DATA bugs surfaced visually — a crash-to-black (the handler throws), a
// wrong/missing sprite (the resolved sprite KEY/atlas points at the wrong slug —
// e.g. "Redux Rattata shows Mega Charizard X"), or a blank/wrong field (the
// handler computes empty/garbled ability text). All three are observable from the
// handler's computed state + the sprite keys it resolves. True pixel inspection
// (alignment/colour/transparency) is a separate, heavier CANVAS harness — not this.
//
// Surfaces (pick with ER_UI_SURFACE / the wrapper's --surface; default starter-select):
//   starter-select - calls the REAL StarterSelectUiHandler.setSpeciesDetails and reports:
//     - threw?            -> the crash-to-black class (#438/#443/#113)
//     - ability/passive text  -> the blank/wrong-field class (#319/#428)
//     - resolved spriteKey / spriteAtlas / iconId  -> the wrong-sprite class
//       (#337 Redux Rattata, #338 Redux Minccino, #434/#435), via getSpriteKey
//       which routes through the ER sprite-redirect.
//   pokedex - calls the REAL PokedexPageUiHandler.show([species,{}]) and reports threw
//     / crashed (the page's show() swallows + logs "[pokedex-page] show() crashed:",
//     so we spy console.error) / name / form / category / spriteKey. Crash classes
//     #113 / #291.
//
// Drive it via the wrapper (preferred):
//   node scripts/run-ui-scenario.mjs [species,species,...] [--surface S] [--strict]
// or directly:
//   ER_SCENARIO=1 ER_UI_SURFACE=pokedex ER_UI_SPECIES='CALYREX,RATTATA_REDUX' \
//     npx vitest run test/tools/run-ui-scenario.test.ts --silent=false
//
// Env:
//   ER_UI_SPECIES   comma-separated species (SpeciesId OR ErSpeciesId NAME, or a
//                   numeric id). Omitted = a built-in demo set (a vanilla baseline
//                   + the famous wrong-sprite / crash repros).
//   ER_UI_STRICT    "1" -> promote sprite-mismatch WARNINGS to hard errors.
//
// Output: a `=== <species> ===` block per target with a `STATE { ... }` snapshot,
// then a final `RESULT { ... }` with errors[] (threw / blank ability) and
// warnings[] (sprite atlas may not match the species). Errors fail the run with a
// nonzero exit; warnings are reported but non-fatal unless ER_UI_STRICT=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { Egg } from "#data/egg";
import { EggHatchData } from "#data/egg-hatch-data";
import { BARGAIN_SIN_ORDER, DISABLED_BARGAIN_SINS } from "#data/elite-redux/er-bargain-sins";
import type { PokemonSpecies } from "#data/pokemon-species";
import { Button } from "#enums/buttons";
import { DexAttr } from "#enums/dex-attr";
import { ErSpeciesId } from "#enums/er-species-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { getPlayerShopModifierTypeOptionsForWave } from "#modifiers/modifier-type";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { allMysteryEncounters } from "#mystery-encounters/mystery-encounters";
import { GameManager } from "#test/framework/game-manager";
import type { BiomeShopUiHandler } from "#ui/biome-shop-ui-handler";
import type { ErBargainUiHandler } from "#ui/er-bargain-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import type { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { PokemonHatchInfoContainer } from "#ui/pokemon-hatch-info-container";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Which surface to drive (the wrapper's --surface flag). Each surface has its own
// built-in demo set: a vanilla baseline that must render cleanly + the live repro
// species for that surface's bug classes.
const SURFACE = (process.env.ER_UI_SURFACE ?? "starter-select").trim();

const DEMO_BY_SURFACE: Record<string, string[]> = {
  // wrong-sprite (#337/#338) + ER-custom-form crash classes.
  "starter-select": ["RATTATA", "RATTATA_REDUX", "MINCCINO_REDUX", "FLOETTE_ETERNAL_FLOWER", "MIMIKYU_BUSTED"],
  // Black Shiny starter-select state: real t4 preview, Luck 5, and one-per-team cap.
  "starter-black-shiny": ["BULBASAUR", "CHARMANDER"],
  // pokedex page render: ER-custom crash (#113), multi-form legendary (#291-adjacent),
  // ER custom multi-form.
  pokedex: ["RATTATA", "RATTATA_REDUX", "CALYREX", "FLOETTE_ETERNAL_FLOWER", "MIMIKYU_BUSTED"],
  // egg-hatch summary card: the starterColors-undefined crash on ER-custom hover (#110).
  "egg-hatch": ["RATTATA", "RATTATA_REDUX", "MINCCINO_REDUX"],
  // mystery-encounter: tokens are MysteryEncounterType NAMES (ER custom MEs). Render
  // each ME's option panel - the intro-sprite / option-render crash class (#490 etc.).
  "mystery-encounter": ["ER_FORTUNE_TELLER", "ER_BOG_WITCH", "ER_HIGH_NOON"],
};
const DEMO_SPECIES = DEMO_BY_SURFACE[SURFACE] ?? DEMO_BY_SURFACE["starter-select"];

const STRICT = process.env.ER_UI_STRICT === "1";
const RUN = process.env.ER_SCENARIO === "1";

// ER_UI_ME=all sweeps EVERY registered ER MysteryEncounterType through the option-panel render
// path (the default demo token list is only 3). The token list is read from the LIVE
// allMysteryEncounters registry at runtime (never hardcoded) so a newly-added ER encounter is
// swept automatically. Only meaningful for the `mystery-encounter` surface.
const ME_ALL = process.env.ER_UI_ME === "all";

/**
 * MEs that legitimately CANNOT render through the direct `handler.show([{}])` option-panel path,
 * so they are SKIPPED from the sweep (never attempted) with a reason. These are structural, not
 * failures: a phase-driven screen (its choices are not the ME option panel) or a synthetic type
 * that is never in the registry.
 */
const ME_SWEEP_SKIP = new Map<string, string>([
  [
    "ER_THE_BARGAIN",
    "phase-driven: TheBargainPhase drives ErBargainUiHandler (Seven Sins), not the ME option panel; not registered in allMysteryEncounters",
  ],
  [
    "LLM_DIRECTED",
    "synthetic LLM Director type; the instance is pre-set on currentBattle, never in allMysteryEncounters",
  ],
]);

/**
 * MEs that ARE swept but are KNOWN to fail this direct-render path. They stay in the run as
 * signal (a regression on any OTHER ME still fails the sweep) but are reported as EXPECTED
 * failures rather than hard errors. Each entry carries the observed reason. Populated from the
 * sweep's own verdicts - a failure NOT listed here fails the run (that is the point). The full
 * ER sweep currently renders 59/59 ok, so this is empty.
 */
const ME_SWEEP_EXPECTED_FAIL = new Map<string, string>([
  // (none - every registered ER ME currently renders its option panel; see the report table)
]);

/**
 * The ER MysteryEncounterType NAMES to sweep: every ER_* entry plus COLOSSEUM that is actually
 * registered in allMysteryEncounters, minus the structural skip-list. Read from the live registry.
 */
function erMysteryEncounterTokens(): string[] {
  const enumMap = MysteryEncounterType as unknown as Record<number, string>;
  return Object.keys(allMysteryEncounters)
    .map(Number)
    .filter(t => Number.isInteger(t))
    .map(t => enumMap[t])
    .filter((name): name is string => typeof name === "string" && (name.startsWith("ER_") || name === "COLOSSEUM"))
    .filter(name => !ME_SWEEP_SKIP.has(name))
    .sort();
}

/** Resolve a token (numeric id, SpeciesId name, or ErSpeciesId name) to a numeric species id. */
function resolveSpecies(token: string): number | undefined {
  const t = token.trim();
  if (t === "") {
    return;
  }
  if (/^\d+$/.test(t)) {
    return Number(t);
  }
  const upper = t.toUpperCase();
  const fromVanilla = (SpeciesId as Record<string, unknown>)[upper];
  if (typeof fromVanilla === "number") {
    return fromVanilla;
  }
  const fromEr = (ErSpeciesId as Record<string, unknown>)[upper];
  if (typeof fromEr === "number") {
    return fromEr;
  }
  return;
}

const TARGET_TOKENS = (process.env.ER_UI_SPECIES?.split(",")
  .map(s => s.trim())
  .filter(Boolean) ?? DEMO_SPECIES) as string[];

// The handler keeps these private; the headless harness reads them the same way
// the existing crash-regression test does (cast through unknown).
type HandlerInternals = {
  lastSpecies: PokemonSpecies;
  speciesStarterDexEntry: unknown;
  setSpeciesDetails(species: PokemonSpecies, options?: object, save?: boolean): void;
  pokemonAbilityText: { text: string };
  pokemonPassiveText: { text: string };
};

interface SpeciesSnapshot {
  token: string;
  id: number;
  species: string;
  threw: string | false;
  ability: string;
  passives: string;
  spriteKey: string;
  spriteAtlas: string;
  iconId: string;
}

interface BlackShinyStarterSnapshot {
  enteredBlack: boolean;
  previewKey: string;
  requestedKeys: string[];
  luck: string;
  firstAdded: boolean;
  secondAdded: boolean;
  partySize: number;
  blackCount: number;
  partyBlackFlags: boolean[];
}

type BlackShinyHandlerInternals = HandlerInternals & {
  starterPreferences: Record<number, { shiny?: boolean; variant?: number; erBlackShiny?: boolean }>;
  originalStarterPreferences: Record<number, { shiny?: boolean; variant?: number; erBlackShiny?: boolean }>;
  pokemonSprite: { pipelineData: Record<string, unknown> };
  pokemonLuckText: { text: string };
  spriteLoadAttempts: Map<string, number>;
  starters: Array<{ erBlackShiny?: boolean }>;
};

/**
 * Drive the real starter-select handler through epic -> Black Shiny, then try to
 * add two Black Shinies. This is the reported stale-preview/luck + team-cap path.
 */
async function snapBlackShinyStarters(game: GameManager): Promise<BlackShinyStarterSnapshot> {
  const species = [SpeciesId.BULBASAUR, SpeciesId.CHARMANDER].map(id => {
    const found = allSpecies.find(s => s.speciesId === id);
    if (!found) {
      throw new Error(`missing starter species ${id}`);
    }
    const dexEntry = game.scene.gameData.dexData[id];
    const starterEntry = game.scene.gameData.starterData[id];
    dexEntry.caughtAttr = DexAttr.NON_SHINY | DexAttr.SHINY | DexAttr.MALE | DexAttr.VARIANT_3 | DexAttr.DEFAULT_FORM;
    dexEntry.seenAttr = dexEntry.caughtAttr;
    starterEntry.abilityAttr = 1;
    starterEntry.erBlackShiny = true;
    return found;
  });

  const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
  expect(handler.show([() => {}]), "starter-select must open in the headless harness").toBe(true);
  const internals = handler as unknown as BlackShinyHandlerInternals;

  const selectEpic = (target: PokemonSpecies): void => {
    internals.starterPreferences[target.speciesId] = { shiny: true, variant: 2, erBlackShiny: false };
    internals.originalStarterPreferences[target.speciesId] = { shiny: true, variant: 2, erBlackShiny: false };
    handler.setSpecies(target);
  };

  selectEpic(species[0]);
  const enteredBlack = handler.processInput(Button.CYCLE_SHINY);
  const previewKey = String(internals.pokemonSprite.pipelineData["requestedTextureKey"] ?? "");
  await vi.waitFor(() => expect(internals.spriteLoadAttempts.has(previewKey)).toBe(true), {
    timeout: 12000,
    interval: 50,
  });
  const requestedKeys = [...internals.spriteLoadAttempts.keys()];
  const luck = internals.pokemonLuckText.text;
  const firstAdded = handler.addToParty(
    species[0],
    handler.getCurrentDexProps(species[0].speciesId),
    0,
    Nature.HARDY,
    [] as never,
    species[0].type1,
    true,
  );

  selectEpic(species[1]);
  handler.processInput(Button.CYCLE_SHINY);
  const secondAdded = handler.addToParty(
    species[1],
    handler.getCurrentDexProps(species[1].speciesId),
    0,
    Nature.HARDY,
    [] as never,
    species[1].type1,
    true,
  );

  return {
    enteredBlack,
    previewKey,
    requestedKeys,
    luck,
    firstAdded,
    secondAdded,
    partySize: internals.starters.length,
    blackCount: internals.starters.filter(s => s.erBlackShiny).length,
    partyBlackFlags: internals.starters.map(s => !!s.erBlackShiny),
  };
}

/** A single non-alnum-stripped lowercase token from the species' display name (e.g. "rattata"). */
function nameToken(species: PokemonSpecies): string {
  return (species.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Render one species through the real handler and capture what the screen would show. */
function snapSpecies(
  game: GameManager,
  handler: StarterSelectUiHandler,
  token: string,
): SpeciesSnapshot | { token: string; error: string } {
  const id = resolveSpecies(token);
  if (id === undefined) {
    return { token, error: `unresolved species "${token}"` };
  }
  const species = allSpecies.find(s => (s.speciesId as number) === id);
  if (!species) {
    return { token, error: `species ${token} (${id}) not registered (ER init off? wrong id?)` };
  }
  const dexEntry = game.scene.gameData.dexData[id];
  const starterEntry = game.scene.gameData.starterData[id];
  if (!dexEntry || !starterEntry) {
    return { token, error: `no dex/starter entry for ${token} (${id})` };
  }

  // Enter the caughtAttr render branch so ability/passive/sprite are computed.
  dexEntry.caughtAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
  dexEntry.seenAttr = dexEntry.caughtAttr;
  starterEntry.abilityAttr = 1; // ABILITY_1 unlocked

  const internals = handler as unknown as HandlerInternals;
  internals.lastSpecies = species;
  internals.speciesStarterDexEntry = dexEntry;

  let threw: string | false = false;
  try {
    internals.setSpeciesDetails(species, {}, false);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }

  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  return {
    token,
    id,
    species: species.name ?? String(id),
    threw,
    ability: internals.pokemonAbilityText?.text ?? "",
    passives: internals.pokemonPassiveText?.text ?? "",
    spriteKey: safe(() => species.getSpriteKey(false, 0, false, 0), "<threw>"),
    spriteAtlas: safe(() => species.getSpriteAtlasPath(false, 0, false, 0), "<threw>"),
    iconId: safe(() => species.getIconId(false, 0, false, 0), "<threw>"),
  };
}

interface PokedexSnapshot {
  token: string;
  id: number;
  species: string;
  threw: string | false;
  crashed: string | false;
  name: string;
  form: string;
  category: string;
  spriteKey: string;
}

/** Render one species' pokedex PAGE through the real handler and capture its state. */
function snapPokedex(game: GameManager, token: string): PokedexSnapshot | { token: string; error: string } {
  const id = resolveSpecies(token);
  if (id === undefined) {
    return { token, error: `unresolved species "${token}"` };
  }
  const species = allSpecies.find(s => (s.speciesId as number) === id);
  if (!species) {
    return { token, error: `species ${token} (${id}) not registered (ER init off? wrong id?)` };
  }
  const dexEntry = game.scene.gameData.dexData[id];
  if (!dexEntry) {
    return { token, error: `no dex entry for ${token} (${id})` };
  }
  // Mark caught so the FULL render branch runs (the crash classes live there).
  dexEntry.caughtAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
  dexEntry.seenAttr = dexEntry.caughtAttr;

  const handler = game.scene.ui.handlers[UiMode.POKEDEX_PAGE] as PokedexPageUiHandler;
  // The page's show() body is wrapped in try/catch: a crash is SWALLOWED and logged
  // as "[pokedex-page] show() crashed: …" rather than thrown. Capture that line so
  // the crash-to-black class (#113 / #291) still surfaces.
  const crashes: string[] = [];
  const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes("[pokedex-page] show() crashed")) {
      crashes.push(line);
    }
  });

  let threw: string | false = false;
  try {
    handler.show([species, {}]);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  errSpy.mockRestore();

  const h = handler as unknown as {
    pokemonNameText?: { text: string };
    pokemonFormText?: { text: string };
    pokemonCategoryText?: { text: string };
  };
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    token,
    id,
    species: species.name ?? String(id),
    threw,
    crashed: crashes[0] ?? false,
    name: h.pokemonNameText?.text ?? "",
    form: h.pokemonFormText?.text ?? "",
    category: h.pokemonCategoryText?.text ?? "",
    spriteKey: safe(() => species.getSpriteKey(false, 0, false, 0), "<threw>"),
  };
}

interface EggSnapshot {
  token: string;
  id: number;
  requested: string;
  hatched: string;
  hatchedId: number;
  threw: string | false;
  name: string;
  number: string;
  candy: string;
  spriteKey: string;
}

/** Hatch an egg for the species and render its egg-summary hatch-info card (the #110 crash site). */
function snapEgg(game: GameManager, token: string): EggSnapshot | { token: string; error: string } {
  const id = resolveSpecies(token);
  if (id === undefined) {
    return { token, error: `unresolved species "${token}"` };
  }
  const species = allSpecies.find(s => (s.speciesId as number) === id);
  if (!species) {
    return { token, error: `species ${token} (${id}) not registered (ER init off? wrong id?)` };
  }

  let mon: PlayerPokemon;
  try {
    // Egg's `species` option is a numeric SpeciesId, NOT the PokemonSpecies object.
    mon = new Egg({ scene: game.scene, species: id as SpeciesId }).generatePlayerPokemon();
  } catch (e) {
    return { token, error: `egg hatch failed for ${token}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const hatchData = new EggHatchData(mon, 0);
  hatchData.setDex();

  // Build the REAL hatch-info card; setup() constructs its Phaser children.
  const listContainer = game.scene.add.container(0, 0);
  const container = new PokemonHatchInfoContainer(listContainer);
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  let threw: string | false = false;
  try {
    container.setup();
    // displayPokemon() kicks an async sprite load + play the headless sprite mock
    // can't animate; the #110 crash is the SYNC starterColors/data path AFTER it, so
    // stub the sprite render and capture the key separately.
    vi.spyOn(container as unknown as { displayPokemon(p: PlayerPokemon): void }, "displayPokemon").mockImplementation(
      () => {},
    );
    container.showHatchInfo(hatchData);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }

  const c = container as unknown as {
    pokemonNameText?: { text: string };
    pokemonNumberText?: { text: string };
    pokemonCandyCountText?: { text: string };
  };
  return {
    token,
    id,
    requested: species.name ?? String(id),
    hatched: mon.species?.name ?? "",
    hatchedId: (mon.species?.speciesId as number) ?? id,
    threw,
    name: c.pokemonNameText?.text ?? "",
    number: c.pokemonNumberText?.text ?? "",
    candy: c.pokemonCandyCountText?.text ?? "",
    spriteKey: safe(
      () => species.getSpriteKey(false, mon.formIndex ?? 0, mon.shiny ?? false, mon.variant ?? 0),
      "<threw>",
    ),
  };
}

interface ShopSnapshot {
  shown: boolean;
  threw: string | false;
  itemCount: number;
  items: string[];
}

/** Render the ER biome-shop with the wave's REAL rolled stock (needs a started battle for arena/currentBattle). */
function snapBiomeShop(game: GameManager): ShopSnapshot {
  const wave = game.scene.currentBattle?.waveIndex ?? 1;
  // forBiomeShop=true rolls the per-biome market stock (needs currentBattle + arena).
  const options = getPlayerShopModifierTypeOptionsForWave(wave, 100, true);
  const handler = game.scene.ui.handlers[UiMode.BIOME_SHOP] as BiomeShopUiHandler;
  let threw: string | false = false;
  let shown = false;
  try {
    shown = handler.show([options, game.scene.arena.biomeId, () => {}, options.map(() => 1)]);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  return { shown, threw, itemCount: options.length, items: options.map(o => o.type?.name ?? "?") };
}

interface BargainSnapshot {
  shown: boolean;
  threw: string | false;
  labels: string[];
  offers: string[];
  greeting: string;
}

/** Render the Giratina bargain screen (ErBargainUiHandler) - the #550 "never renders in-game" diagnostic. */
function snapBargain(game: GameManager): BargainSnapshot {
  // Mirror TheBargainPhase.openScreen: build labels/descs/offers/greeting from the
  // bargain i18next namespace for the first few (non-disabled) Sins + a Leave row.
  const ns = "mysteryEncounters/theBargain";
  const sins = BARGAIN_SIN_ORDER.filter(k => !DISABLED_BARGAIN_SINS.has(k)).slice(0, 3);
  const labels = [...sins.map(k => i18next.t(`${ns}:sins.${k}.name`)), i18next.t(`${ns}:option.leave.label`)];
  const descs = [...sins.map(k => i18next.t(`${ns}:sins.${k}.tooltip`)), i18next.t(`${ns}:option.leave.tooltip`)];
  const offers = sins.map(k => i18next.t(`${ns}:sins.${k}.offer`));
  const greeting = i18next.t(`${ns}:introDialogue`).split("$").slice(0, 2).join(" ");
  const handler = game.scene.ui.handlers[UiMode.ER_BARGAIN] as ErBargainUiHandler;
  let threw: string | false = false;
  let shown = false;
  try {
    shown = handler.show([labels, descs, greeting, offers, () => {}, () => {}, () => {}]);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  return { shown, threw, labels, offers, greeting };
}

interface EncounterSnapshot {
  token: string;
  type: number;
  threw: string | false;
  shown: boolean;
  optionCount: number;
  options: string[];
  title: string;
}

/**
 * Render a specific ER mystery encounter's option panel. Assigns the registry encounter
 * directly to the (already-started) battle - ER gates ME spawns by biome/wave, so the
 * override path won't force an ER ME onto an arbitrary wave. Caller must have started a
 * battle first (the handler reads `currentBattle.mysteryEncounter`).
 */
function snapEncounter(game: GameManager, token: string): EncounterSnapshot | { token: string; error: string } {
  const type = (MysteryEncounterType as Record<string, unknown>)[token];
  if (typeof type !== "number") {
    return { token, error: `unknown ME type "${token}"` };
  }
  const encounter = allMysteryEncounters[type as number];
  if (!encounter) {
    return { token, error: `no registered encounter for ${token} (#${type})` };
  }
  game.scene.currentBattle.mysteryEncounter = encounter;
  const me = encounter;
  const handler = game.scene.ui.handlers[UiMode.MYSTERY_ENCOUNTER] as MysteryEncounterUiHandler;
  const safeText = (k: unknown): string => {
    try {
      return (getEncounterText(k as never) as string | null) ?? "";
    } catch {
      return "";
    }
  };
  let threw: string | false = false;
  let shown = false;
  try {
    // show([{}]) runs displayEncounterOptions against the live encounter - the
    // intro-sprite / option-panel render path.
    shown = handler.show([{}]);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  const opts = me?.options ?? [];
  return {
    token,
    type: type as number,
    threw,
    shown,
    optionCount: opts.length,
    options: opts.map(o => safeText(o.dialogue?.buttonLabel)),
    title: safeText(me?.dialogue?.encounterOptionsDialogue?.title),
  };
}

describe.skipIf(!RUN)("headless UI runner", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it.skipIf(SURFACE !== "starter-select")("starter-select: renders the target species", () => {
    console.log("\n===== UI SURFACE: starter-select =====");
    console.log(`species: ${TARGET_TOKENS.length} target(s)${STRICT ? " (strict)" : ""}`);

    const game = new GameManager(phaserGame);
    const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    expect(handler, "STARTER_SELECT handler must be constructed").toBeDefined();

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const token of TARGET_TOKENS) {
      const snap = snapSpecies(game, handler, token);
      if ("error" in snap) {
        console.log(`\n=== ${token} ===\nERROR ${snap.error}`);
        errors.push(snap.error);
        continue;
      }
      console.log(`\n=== ${snap.species} (${snap.token} #${snap.id}) ===`);
      console.log("STATE", JSON.stringify(snap));

      if (snap.threw) {
        errors.push(`${snap.species} (${snap.token}): setSpeciesDetails threw — ${snap.threw}`);
      }
      if (snap.ability.trim() === "") {
        errors.push(`${snap.species} (${snap.token}): blank ability text`);
      }
      // Wrong-sprite heuristic: the resolved atlas should reference this species'
      // own name token (e.g. "rattata"). If it doesn't, the sprite-redirect may be
      // serving a DIFFERENT species' sprite (the #337/#338/#434 class). A warning,
      // not a hard error (custom slugs can legitimately differ) unless --strict.
      const species = allSpecies.find(s => (s.speciesId as number) === snap.id) as PokemonSpecies;
      const tok = nameToken(species);
      // Normalize the atlas the SAME way as the name token (strip "/" and "_") so
      // "elite-redux/rattata_redux/front" matches the name token "rattataredux".
      const atlasNorm = snap.spriteAtlas.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (tok.length >= 3 && !atlasNorm.includes(tok) && !atlasNorm.includes(String(snap.id))) {
        const msg = `${snap.species} (${snap.token}): sprite atlas "${snap.spriteAtlas}" does not reference the species name token "${tok}" — possible wrong sprite`;
        (STRICT ? errors : warnings).push(msg);
      }
    }

    console.log(
      "\nRESULT",
      JSON.stringify({ surface: "starter-select", count: TARGET_TOKENS.length, errors, warnings }),
    );
    if (warnings.length > 0) {
      console.log(`\n${warnings.length} WARNING(S):`);
      for (const w of warnings) {
        console.log(`  ! ${w}`);
      }
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it.skipIf(SURFACE !== "starter-black-shiny")(
    "starter-black-shiny: refreshes the real t4 look and caps the selected team at one",
    async () => {
      console.log("\n===== UI SURFACE: starter-black-shiny =====");
      const game = new GameManager(phaserGame);
      const snap = await snapBlackShinyStarters(game);
      console.log("STATE", JSON.stringify(snap));

      expect(snap.enteredBlack, "epic -> Black Shiny cycle must be handled").toBe(true);
      expect(snap.previewKey, "the preview refresh must publish its requested texture key").toMatch(/-erblack$/);
      expect(snap.requestedKeys, "the single-flight loader must request the Black Shiny atlas").toContain(
        snap.previewKey,
      );
      expect(snap.luck, "selected Black Shiny must display Luck 5 immediately").toBe("5");
      expect(snap.firstAdded, "the first Black Shiny pick must be accepted").toBe(true);
      expect(snap.secondAdded, "a second Black Shiny pick must be rejected").toBe(false);
      expect(snap.partySize).toBe(1);
      expect(snap.blackCount).toBe(1);
      expect(snap.partyBlackFlags).toEqual([true]);

      console.log("\nRESULT", JSON.stringify({ surface: "starter-black-shiny", errors: [], warnings: [] }));
    },
  );

  it.skipIf(SURFACE !== "pokedex")("pokedex: renders the target species page", () => {
    console.log("\n===== UI SURFACE: pokedex =====");
    console.log(`species: ${TARGET_TOKENS.length} target(s)`);

    const game = new GameManager(phaserGame);
    const errors: string[] = [];

    for (const token of TARGET_TOKENS) {
      const snap = snapPokedex(game, token);
      if ("error" in snap) {
        console.log(`\n=== ${token} ===\nERROR ${snap.error}`);
        errors.push(snap.error);
        continue;
      }
      console.log(`\n=== ${snap.species} (${snap.token} #${snap.id}) ===`);
      console.log("STATE", JSON.stringify(snap));
      // The crash-to-black class (#113 / #291): show() threw, or its internal
      // try/catch swallowed + logged a crash. Either fails the run.
      if (snap.threw) {
        errors.push(`${snap.species} (${snap.token}): pokedex show() threw — ${snap.threw}`);
      }
      if (snap.crashed) {
        errors.push(`${snap.species} (${snap.token}): pokedex page crashed — ${snap.crashed}`);
      }
    }

    console.log("\nRESULT", JSON.stringify({ surface: "pokedex", count: TARGET_TOKENS.length, errors }));
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it.skipIf(SURFACE !== "egg-hatch")("egg-hatch: renders the hatched-mon summary card", () => {
    console.log("\n===== UI SURFACE: egg-hatch =====");
    console.log(`species: ${TARGET_TOKENS.length} target(s)`);

    const game = new GameManager(phaserGame);
    const errors: string[] = [];

    for (const token of TARGET_TOKENS) {
      const snap = snapEgg(game, token);
      if ("error" in snap) {
        console.log(`\n=== ${token} ===\nERROR ${snap.error}`);
        errors.push(snap.error);
        continue;
      }
      console.log(`\n=== ${snap.hatched} (${snap.token} #${snap.hatchedId}) ===`);
      console.log("STATE", JSON.stringify(snap));
      // The crash class (#110): showHatchInfo threw (e.g. starterColors[id] undefined).
      if (snap.threw) {
        errors.push(`${snap.hatched} (${snap.token}): egg-summary showHatchInfo threw — ${snap.threw}`);
      }
    }

    console.log("\nRESULT", JSON.stringify({ surface: "egg-hatch", count: TARGET_TOKENS.length, errors }));
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it.skipIf(SURFACE !== "biome-shop")("biome-shop: renders the ER biome market with real stock", async () => {
    console.log("\n===== UI SURFACE: biome-shop =====");
    const game = new GameManager(phaserGame);
    // A started battle gives the stock roller its currentBattle + arena (biome).
    await game.classicMode.startBattle(SpeciesId.RATTATA);

    const snap = snapBiomeShop(game);
    console.log("STATE", JSON.stringify(snap));

    const errors: string[] = [];
    if (snap.threw) {
      errors.push(`biome-shop show() threw — ${snap.threw}`);
    }
    if (!snap.shown && !snap.threw) {
      errors.push("biome-shop show() returned false (bad args / not rendered)");
    }
    console.log("\nRESULT", JSON.stringify({ surface: "biome-shop", errors }));
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it.skipIf(SURFACE !== "bargain")("bargain: renders Giratina's bargain screen (#550 diagnostic)", () => {
    console.log("\n===== UI SURFACE: bargain =====");
    const game = new GameManager(phaserGame);

    const snap = snapBargain(game);
    console.log("STATE", JSON.stringify(snap));

    const errors: string[] = [];
    if (snap.threw) {
      errors.push(`bargain show() threw — ${snap.threw}`);
    }
    if (!snap.shown && !snap.threw) {
      errors.push('bargain show() returned false (bad args) — the #550 "never renders" failure mode');
    }
    console.log("\nRESULT", JSON.stringify({ surface: "bargain", errors }));
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it.skipIf(SURFACE !== "mystery-encounter")(
    "mystery-encounter: renders each ME's option panel",
    async () => {
      console.log("\n===== UI SURFACE: mystery-encounter =====");
      // ER_UI_ME=all: sweep EVERY registered ER ME (read from the live registry). Otherwise the
      // caller's ER_UI_SPECIES list, or the built-in 3-ME demo set.
      const tokens = ME_ALL ? erMysteryEncounterTokens() : TARGET_TOKENS;
      console.log(`encounters: ${tokens.length}${ME_ALL ? " (ER_UI_ME=all sweep)" : ""}`);
      if (ME_ALL) {
        for (const [name, reason] of ME_SWEEP_SKIP) {
          console.log(`  (skip) ${name} — ${reason}`);
        }
      }

      // ONE battle (so currentBattle exists); each ME just swaps currentBattle.mysteryEncounter
      // and re-renders. Reusing the GameManager avoids the per-test prompt-interval static.
      const game = new GameManager(phaserGame);
      await game.classicMode.startBattle(SpeciesId.RATTATA);

      // Per-ME verdict, for the report table. status: ok | threw | not-shown | zero-options | error.
      const verdicts: { token: string; status: string; detail: string; optionCount: number }[] = [];
      // Hard errors fail the run; expectedFails are KNOWN, listed failures (kept in the run as signal).
      const errors: string[] = [];
      const expectedFails: string[] = [];

      for (const token of tokens) {
        const snap = snapEncounter(game, token);
        if ("error" in snap) {
          console.log(`\n=== ${token} ===\nERROR ${snap.error}`);
          verdicts.push({ token, status: "error", detail: snap.error, optionCount: 0 });
          const expected = ME_SWEEP_EXPECTED_FAIL.get(token);
          (expected ? expectedFails : errors).push(
            `${token}: ${snap.error}${expected ? ` [expected: ${expected}]` : ""}`,
          );
          continue;
        }
        console.log(`\n=== ${token} (#${snap.type}) ===`);
        console.log("STATE", JSON.stringify(snap));
        // Per-ME assertions: no throw, shown, optionCount > 0.
        let status = "ok";
        let detail = "";
        if (snap.threw) {
          status = "threw";
          detail = snap.threw;
        } else if (!snap.shown) {
          status = "not-shown";
          detail = "show() returned false";
        } else if (snap.optionCount === 0) {
          status = "zero-options";
          detail = "rendered with ZERO options";
        }
        verdicts.push({ token, status, detail, optionCount: snap.optionCount });
        if (status !== "ok") {
          const expected = ME_SWEEP_EXPECTED_FAIL.get(token);
          const msg = `${token}: ME ${status}${detail ? ` — ${detail}` : ""}${expected ? ` [expected: ${expected}]` : ""}`;
          (expected ? expectedFails : errors).push(msg);
        }
      }

      // Verdict table (the report evidence): one aligned row per swept ME.
      if (ME_ALL) {
        const pad = Math.max(...verdicts.map(v => v.token.length), 4);
        console.log("\n===== ME SWEEP VERDICT TABLE =====");
        console.log(`${"ME".padEnd(pad)}  status        opts`);
        for (const v of verdicts) {
          const mark =
            v.status === "ok" ? "ok" : ME_SWEEP_EXPECTED_FAIL.has(v.token) ? `${v.status} (expected)` : v.status;
          console.log(`${v.token.padEnd(pad)}  ${mark.padEnd(13)} ${v.optionCount}`);
        }
        const okCount = verdicts.filter(v => v.status === "ok").length;
        console.log(
          `\nSWEPT ${verdicts.length}  ok ${okCount}  expected-fail ${expectedFails.length}  UNEXPECTED-FAIL ${errors.length}  skipped ${ME_SWEEP_SKIP.size}`,
        );
      }

      if (expectedFails.length > 0) {
        console.log(`\n${expectedFails.length} EXPECTED FAILURE(S) (kept in the run as signal):`);
        for (const e of expectedFails) {
          console.log(`  ~ ${e}`);
        }
      }
      console.log(
        "\nRESULT",
        JSON.stringify({ surface: "mystery-encounter", count: tokens.length, errors, expectedFails }),
      );
      expect(errors, errors.join("\n")).toEqual([]);
    },
    300000,
  );
});
