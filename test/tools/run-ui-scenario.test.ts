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
// Surface (only "starter-select" for now):
//   For each target species it sets up the dex/starter entry, calls the REAL
//   StarterSelectUiHandler.setSpeciesDetails (the render path), and reports:
//     - threw?            -> the crash-to-black class (#438/#443/#113)
//     - name/ability/passive text  -> the blank/wrong-field class (#319/#428)
//     - resolved spriteKey / spriteAtlas / iconId  -> the wrong-sprite class
//       (#337 Redux Rattata, #338 Redux Minccino, #434/#435), via getSpriteKey
//       which routes through the ER sprite-redirect.
//
// Drive it via the wrapper (preferred):
//   node scripts/run-ui-scenario.mjs [species,species,...] [--strict]
// or directly:
//   ER_SCENARIO=1 ER_UI_SPECIES='RATTATA_REDUX,MINCCINO_REDUX' \
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
import type { PokemonSpecies } from "#data/pokemon-species";
import { DexAttr } from "#enums/dex-attr";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

// Built-in demo: a vanilla baseline that must render cleanly, then the live
// repro species for the wrong-sprite (#337/#338) and ER-custom-form crash classes.
const DEMO_SPECIES = ["RATTATA", "RATTATA_REDUX", "MINCCINO_REDUX", "FLOETTE_ETERNAL_FLOWER", "MIMIKYU_BUSTED"];

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

describe.skipIf(!RUN)("headless UI runner", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("starter-select: renders the target species", () => {
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
});
