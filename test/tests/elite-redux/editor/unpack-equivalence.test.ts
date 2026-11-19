/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// "Unpack" must not change what the ability does. Multiscale's legacy event gate (a componentRule that calls the
// attr's own canApply) and the explicit blocks the editor replaces it with are run through the same battle with the
// same seed: the damage taken, HP, messages, phases and random draws must be identical, and the ability must really
// be doing something (damage is halved at full HP and not at max HP - 1), so a vacuous pass is impossible.
import { allAbilities } from "#data/data-lists";
import { validateAbilityStudioBlueprints } from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BattleTrace, diffTraces, type TraceData } from "#test/tests/elite-redux/decomp/harness/battle-trace";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { runScenario, type ScenarioSpec, TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type Json = Record<string, unknown>;

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const LEGACY_ID = 29880;
const UNPACKED_ID = 29881;
// Swift never misses and Snorlax hits hard enough that x0.5 and x0.6 are different numbers.
const HEAVY_HITS: ScenarioSpec = {
  ...TEMPLATES["foe-hits-holder"],
  id: "unpack-heavy-hits",
  label: "A level 100 Snorlax uses Swift on the holder on two turns",
  foe: SpeciesId.SNORLAX,
  foeLevel: 100,
  foeMoves: [MoveId.SWIFT],
};
const MULTISCALE = { abilityId: AbilityId.MULTISCALE, attrIndex: 0, attrType: "ReceivedMoveDamageMultiplierAbAttr" };

function legacyBlueprint(): Json {
  return {
    version: 1,
    id: LEGACY_ID,
    name: "Legacy Gate Probe",
    description: "Multiscale through a legacy event gate.",
    generation: 9,
    includes: [],
    mechanics: [],
    componentRules: [
      {
        key: "multiscale",
        hook: MULTISCALE,
        chance: 100,
        conditionLogic: "all",
        conditions: [{ ...MULTISCALE, kind: "event" }],
        effects: [MULTISCALE],
      },
    ],
    rules: [],
    modifiers: [],
    flags: {},
  };
}

/** What the editor's Unpack button writes: the studio is driven in a jsdom window with the generated data. */
function unpacked(): Json {
  const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", { runScripts: "outside-only" });
  dom.window.eval(read("editor/composition-builder.js"));
  dom.window.eval(read("editor/ability-studio.js"));
  const studio = dom.window.erAbilityStudio;
  const root = dom.window.document.querySelector("#root") as HTMLElement;
  studio.init({
    catalog: JSON.parse(read("editor/data/ability-primitives.json")),
    abilities: [],
    moves: [],
    mechanics: [],
    components: [],
    blueprints: { probe: { ...legacyBlueprint(), id: UNPACKED_ID, name: "Unpacked Gate Probe" } },
    vocabulary: JSON.parse(read("editor/data/vocabulary.json")),
    blocks: JSON.parse(read("editor/data/blocks.json")),
    gates: JSON.parse(read("editor/data/gates.json")),
    callbacks: { render: () => studio.renderContent(root) },
  });
  studio.renderContent(root);
  const button = root.querySelector("[data-as-action='unpack-gate']");
  if (button === null) {
    throw new Error("the editor offers no Unpack for Multiscale's gate");
  }
  studio.handleClick({ target: button });
  return studio.buildDelta().delta.probe as Json;
}

describe("Unpack keeps the behaviour", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const registered: number[] = [];
  function register(blueprint: Json): void {
    const validated = validateAbilityStudioBlueprints({ probe: blueprint } as never);
    expect(validated.errors).toEqual([]);
    (allAbilities as Record<number, unknown>)[blueprint.id as number] = compileAbilityStudioBlueprint(
      validated.blueprints.probe,
      id => allAbilities[id],
    );
    registered.push(blueprint.id as number);
  }
  afterEach(() => {
    for (const id of registered.splice(0)) {
      delete (allAbilities as Record<number, unknown>)[id];
    }
  });

  const run = (abilityId: number, hp: string): Promise<TraceData> =>
    runScenario(freshGame(phaserGame), HEAVY_HITS, { abilityId, axes: { hp } }, game =>
      BattleTrace.attach(game, { rng: "seeded", seed: "unpack-equivalence", aliases: { [UNPACKED_ID]: LEGACY_ID } }),
    );
  const lost = (trace: TraceData): number => {
    const hp = (snapshot: number): number => ((trace.snapshots[snapshot].data.player as Json[])[0]?.hp as number) ?? 0;
    return hp(0) - hp(trace.snapshots.length - 1);
  };

  it("replaces the gate with blocks that compile, and the battle is identical at the HP boundary", async () => {
    const blueprint = unpacked();
    expect(blueprint.componentRules).toEqual([]);
    expect(blueprint.composition).toEqual([
      {
        key: "multiscale",
        when: { block: "calc.damage-taken" },
        if: [{ block: "hp.full", params: { who: "holder" } }],
        do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5, affectsFixedDamage: false } }],
        chance: 100,
      },
    ]);
    register(legacyBlueprint());
    register(blueprint);

    for (const hp of ["max", "max-1"]) {
      const none = await run(AbilityId.BALL_FETCH, hp);
      const legacy = await run(LEGACY_ID, hp);
      const rebuilt = await run(UNPACKED_ID, hp);
      // the attr evaluation log names different carrier classes by design; everything the player can see must match
      const differences = diffTraces(legacy, rebuilt).filter(difference => difference.part !== "attr-events");
      expect(differences, `hp ${hp}`).toEqual([]);
      expect(lost(rebuilt), `hp ${hp}: damage`).toBe(lost(legacy));
      if (hp === "max") {
        expect(lost(legacy), "the gate really halves the damage at full HP").toBeLessThan(lost(none));
      } else {
        expect(lost(legacy), "no reduction below full HP").toBe(lost(none));
      }
    }
  }, 240_000);
});
