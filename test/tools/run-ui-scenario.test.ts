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
import type { PokemonSpecies } from "#data/pokemon-species";
import { DexAttr } from "#enums/dex-attr";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import type { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { PokemonHatchInfoContainer } from "#ui/pokemon-hatch-info-container";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Which surface to drive (the wrapper's --surface flag). Each surface has its own
// built-in demo set: a vanilla baseline that must render cleanly + the live repro
// species for that surface's bug classes.
const SURFACE = (process.env.ER_UI_SURFACE ?? "starter-select").trim();

const DEMO_BY_SURFACE: Record<string, string[]> = {
  // wrong-sprite (#337/#338) + ER-custom-form crash classes.
  "starter-select": ["RATTATA", "RATTATA_REDUX", "MINCCINO_REDUX", "FLOETTE_ETERNAL_FLOWER", "MIMIKYU_BUSTED"],
  // pokedex page render: ER-custom crash (#113), multi-form legendary (#291-adjacent),
  // ER custom multi-form.
  pokedex: ["RATTATA", "RATTATA_REDUX", "CALYREX", "FLOETTE_ETERNAL_FLOWER", "MIMIKYU_BUSTED"],
  // egg-hatch summary card: the starterColors-undefined crash on ER-custom hover (#110).
  "egg-hatch": ["RATTATA", "RATTATA_REDUX", "MINCCINO_REDUX"],
};
const DEMO_SPECIES = DEMO_BY_SURFACE[SURFACE] ?? DEMO_BY_SURFACE["starter-select"];

const STRICT = process.env.ER_UI_STRICT === "1";
const RUN = process.env.ER_SCENARIO === "1";

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
});
