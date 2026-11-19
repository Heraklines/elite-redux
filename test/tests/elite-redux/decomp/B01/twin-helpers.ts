/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Shared helpers of the B01 tests: run an ability and its rebuild through one custom scenario and report the trace
// difference. These tests exist for the attrs that no shared L2 template reaches (see requests/B01.md, R-B01-7/8).
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattleTrace, diffTraces, type TraceData } from "#test/tests/elite-redux/decomp/harness/battle-trace";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import type { Axes, ScenarioSpec } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { runScenario } from "#test/tests/elite-redux/decomp/harness/scenarios";
import {
  allocateShadowId,
  describeTwinFailure,
  liveAbility,
  reachProblems,
  type TwinOutcome,
  twinById,
} from "#test/tests/elite-redux/decomp/harness/twin";
import type Phaser from "phaser";

export interface TwinRun {
  /** The attrs of the ability that the original must show being evaluated (the anti-vacuity check). */
  readonly attrs: readonly { readonly attrIndex: number; readonly className: string }[];
  /** Drop these attr indices from the rebuild (mutation check: the twin must then DIFFER). */
  readonly drop?: readonly number[];
  readonly axes?: Axes;
  /**
   * Start the battle at this wave. The opening wild battle (wave 1) is always single, so a doubles scenario needs a
   * later wave (battle-scene.ts checkIsDouble); the shared harness has no wave setting (requests/B01.md, R-B01-8).
   */
  readonly wave?: number;
}

export interface TwinResult {
  readonly outcome: TwinOutcome;
  readonly rebuiltAttrs: readonly number[];
  /** Plain-language failure text, empty when the traces match. */
  readonly report: string;
}

/** Rebuilds `abilityId` from its declarations and runs both through `template` with the same pinned seed. */
export async function twinRebuild(
  phaserGame: Phaser.Game,
  abilityId: number,
  template: ScenarioSpec,
  run: TwinRun,
): Promise<TwinResult> {
  const original = liveAbility(abilityId);
  const shadowId = allocateShadowId();
  const rebuilt = rebuildAbility(original, shadowId, {
    registry: declRegistry,
    ...(run.drop === undefined ? {} : { drop: run.drop }),
  });
  registerShadow(shadowId, rebuilt.ability);
  try {
    const scenario = { template, axes: run.axes ?? {}, label: template.label };
    const outcome =
      run.wave === undefined
        ? await twinById(phaserGame, abilityId, shadowId, scenario, { reach: { attrs: run.attrs } })
        : await twinAtWave(phaserGame, abilityId, shadowId, scenario, run);
    return {
      outcome,
      rebuiltAttrs: rebuilt.rebuilt,
      report: outcome.differences.length === 0 ? "" : describeTwinFailure(original.name, outcome),
    };
  } finally {
    unregisterShadows();
  }
}

/** Same as the shared `twinById`, but the battle starts at `run.wave` (same seed, same trace, same checks). */
async function twinAtWave(
  phaserGame: Phaser.Game,
  idA: number,
  idB: number,
  scenario: { template: ScenarioSpec; axes: Axes; label: string },
  run: TwinRun,
): Promise<TwinOutcome> {
  const started = Date.now();
  const once = (id: number): Promise<TraceData> => {
    const game = freshGame(phaserGame);
    game.override.startingWave(run.wave ?? 1);
    return runScenario(game, scenario.template, { abilityId: id, axes: scenario.axes }, g =>
      BattleTrace.attach(g, { rng: "seeded", seed: "decomp-l2", aliases: { [idB]: idA } }),
    );
  };
  const original = await once(idA);
  const rebuild = await once(idB);
  return {
    scenario,
    differences: [...reachProblems(idA, original, scenario, { attrs: run.attrs }), ...diffTraces(original, rebuild)],
    original,
    rebuild,
    millis: Date.now() - started,
  };
}
