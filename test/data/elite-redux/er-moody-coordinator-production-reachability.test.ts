import { MOODY_MECHANICS_SCENARIOS } from "#data/elite-redux/moody/moody-mechanics-scenarios";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("Moody coordinator production reachability", () => {
  it.each([
    ["warranty and contraband", "src/battle-scene.ts", "prepareMoodyCoordinatorItemActivation"],
    ["contraband cap", "src/battle-scene.ts", "getMoodyCoordinatorItemRule"],
    ["recapitulation and pocket turn", "src/phases/move-phase.ts", "notifyMoodyCoordinatorMoveResolved"],
    ["negative space selection", "src/phases/move-phase.ts", "getMoodyCoordinatorMoveSelection"],
    ["spectral execution", "src/phases/moody-coordinator-echo-phase.ts", "MoodyCoordinatorEchoPhase"],
    ["spectral suppression", "src/phases/move-effect-phase.ts", "isMoodyCoordinatorSpectral"],
    ["time loop and apex", "src/phases/faint-phase.ts", "notifyMoodyCoordinatorFaint"],
    ["ability carousel and phase shift", "src/phases/turn-init-phase.ts", "notifyMoodyCoordinatorTurnStart"],
    ["inversion window", "src/field/pokemon.ts", "applyMoodyCoordinatorTypeEffectiveness"],
    ["pressure valve", "src/phases/stat-stage-change-phase.ts", "notifyMoodyCoordinatorPositiveStatOverflow"],
    ["mirror theft", "src/phases/stat-stage-change-phase.ts", "notifyMoodyCoordinatorEnemyStatIncrease"],
    ["bench and growth lifecycle", "src/phases/exp-phase.ts", "notifyMoodyCoordinatorExperience"],
    ["growth evolution", "src/phases/evolution-phase.ts", "notifyMoodyCoordinatorPokemonEvolved"],
    ["bossbreaker", "src/field/pokemon.ts", "notifyMoodyCoordinatorBossSegmentBroken"],
    ["trainer roster", "src/phases/encounter-phase.ts", "prepareMoodyCoordinatorTrainerRoster"],
    ["enemy projection", "src/battle-scene.ts", "prepareMoodyCoordinatorEnemyGeneration"],
    ["blood market", "src/phases/biome-shop-phase.ts", "notifyMoodyCoordinatorMarketPurchase"],
    ["hunter choice", "src/phases/battle-end-phase.ts", "notifyMoodyCoordinatorBattleEnd"],
  ])("keeps %s connected", (_label, file, hook) => {
    expect(source(file)).toContain(hook);
  });

  it("keeps coordinator action triggers connected to active-only Feedback Loop accounting", () => {
    expect(source("src/data/elite-redux/moody/moody-coordinator-gameplay.ts")).toContain(
      "recordMoodyRuntimeActionTriggers",
    );
    const scene = source("src/data/elite-redux/moody/moody-scene-adapter.ts");
    expect(scene).toContain("activeBoonIds");
    expect(scene).not.toContain("activeItemSetEffects");
  });

  it("documents harness scenarios for every audited production mechanic", () => {
    const ids = new Set(MOODY_MECHANICS_SCENARIOS.map(scenario => scenario.effectId));
    expect(ids).toEqual(
      new Set([
        "warranty",
        "recycler",
        "contraband-slot",
        "bounty-board",
        "legacy-slot",
        "borrowed-future",
        "blood-market",
        "ability-carousel",
        "time-loop",
        "recapitulation",
        "pocket-turn",
        "hunter-s-mark",
        "mirror-theft",
        "pressure-valve",
        "inversion-window",
        "diversity-charter",
        "monotype-oath",
        "underdog-dividend",
        "growth-ring",
        "pair-bond",
        "bench-academy",
        "bossbreaker",
        "phase-shift",
        "negative-space",
        "cursed-inventory",
        "mortal-wounds",
        "elite-pursuit",
        "apex-plunder",
        "no-takebacks",
        "jealous-relics",
      ]),
    );
    for (const scenario of MOODY_MECHANICS_SCENARIOS) {
      expect(scenario.setup.length).toBeGreaterThan(0);
      expect(scenario.assertions.length).toBeGreaterThanOrEqual(3);
      expect(scenario.producer).not.toBe("");
      expect(scenario.executor).not.toBe("");
    }
  });
});
