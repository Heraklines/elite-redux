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

import { Egg } from "#data/egg";
import { EggHatchData } from "#data/egg-hatch-data";
import { Button } from "#enums/buttons";
import { DexAttr } from "#enums/dex-attr";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { getPlayerShopModifierTypeOptionsForWave } from "#modifiers/modifier-type";
import { allMysteryEncounters } from "#mystery-encounters/mystery-encounters";
import type { GameManager } from "#test/framework/game-manager";
import { GameManager as GameManagerClass } from "#test/framework/game-manager";
import {
  createRenderScene,
  freezeAnimations,
  injectMissing,
  pixelDiff,
  type RenderContext,
  renderTwoPass,
  repointGlobalScene,
  restoreGlobalScene,
} from "#test/tools/render-harness";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
   * NOTE: the battle FIELD (sprites/HP bars) is scene-level, not a UiHandler, so only the
   * active handler's own container renders - the menu chrome, not the battlefield backdrop.
   */
  captureActive?: boolean;
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

const RECIPES: Record<string, Recipe> = {
  bargain: {
    mode: UiMode.ER_BARGAIN,
    prepare: () => bargainArgs(),
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
  // Phase-flow bridge demo: drive a real battle (startBattle runs the encounter phases) and
  // render WHATEVER screen the pipeline left active - here the in-battle command menu. Proves
  // mid-run screens reached through the phase system are renderable. (The battlefield sprites
  // are scene-level, not a handler, so only the command-menu chrome renders.)
  "battle-command": {
    captureActive: true,
    prepare: async game => {
      await game.classicMode.startBattle(SpeciesId.RATTATA);
      return []; // captureActive ignores this; satisfies the prepare return type
    },
  },
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
        if (recipe.render) {
          await recipe.render(game, ctx);
        } else {
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
    ctx.step();
    const out = join("dev-logs", "ui-pages", `${PAGE}${SIMULATE_MISSING ? "-missing" : ""}.png`);
    const { nonBlankPx } = ctx.snapshot(out);
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
});
