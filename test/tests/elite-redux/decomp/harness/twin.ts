/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L2: the battle twin test (spec section 4). Ability A and its rebuild A' run the SAME scenario with the
// SAME pinned seed on two fresh GameManagers, and their BattleTraces must be identical.
//
// A class's scenarios are the product of its WHEN's template and its declared probe axes (each
// condition probe ships a true and a false state, for example hp: ["max", "max-1"]). The proof rule
// "at least one probe pair per distinct param signature" is `signatureSites`: one representative ability
// per distinct (params, bound specs) signature of the class.

import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import type { DeclRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { getWhen } from "#data/elite-redux/ability-studio/vocabulary/when-registry";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Phaser from "phaser";
import { BattleTrace, diffTraces, type TraceData, type TraceDifference } from "./battle-trace";
import { freshGame } from "./game";
import { type RebuildResult, rebuildAbility, registerShadow, SHADOW_ID_BASE, unregisterShadows } from "./rebuild";
import {
  type Axes,
  type AxisValue,
  describeAxes,
  KNOWN_AXES,
  runScenario,
  type ScenarioSpec,
  templateForWhen,
} from "./scenarios";
import type { AttrSite } from "./sites";

export interface TwinScenario {
  readonly template: ScenarioSpec;
  readonly axes: Axes;
  readonly label: string;
  /** The WHEN registry id this scenario was built for (absent for hand-made self-test scenarios). */
  readonly when?: string;
  /** The declaration's written reason for tolerating an unreached WHEN (ClassDecl.l2StaticReason). */
  readonly staticReason?: string;
}

/** What the original's run must show: each of these attrs evaluated at least once. */
export interface ReachExpectation {
  readonly attrs: readonly { readonly attrIndex: number; readonly className: string }[];
  /**
   * Every rebuilt attr is a presence flag (while-active, engine-query): the engine reads it with hasAbilityWithAttr and
   * nothing is dispatched, so no trace event can show it being evaluated. The twin then compares the whole battle.
   */
  readonly presenceOnly?: boolean;
}

const REACH_FILE = resolve(process.cwd(), "test/fixtures/elite-redux/ability-studio/decomp-l2-reach.json");
let unreachedCache: Record<string, string> | undefined;

/** WHEN ids that no scenario template reaches, with the reason, from decomp-l2-reach.json. */
export function unreachedWhens(): Readonly<Record<string, string>> {
  unreachedCache ??= (JSON.parse(readFileSync(REACH_FILE, "utf8")) as { unreached: Record<string, string> }).unreached;
  return unreachedCache;
}

/**
 * The anti-vacuity check. A twin where the original never evaluated the rebuilt attr compares two empty
 * traces and proves nothing, so it must not pass. Without an explicit expectation, the original ability
 * must at least have evaluated one of its attrs.
 */
export function reachProblems(
  abilityId: number,
  original: TraceData,
  scenario: TwinScenario,
  reach: ReachExpectation | undefined,
): TraceDifference[] {
  const problems: TraceDifference[] = [];
  if (scenario.when !== undefined && scenario.staticReason === undefined) {
    const why = unreachedWhens()[scenario.when];
    if (why !== undefined) {
      problems.push({
        part: "when-unreached",
        message: `no scenario template reaches the trigger "${scenario.when}" (${why}); the twin would prove nothing. Add a template, or give the declaration a written l2StaticReason`,
      });
    }
  }
  const events = original.attrEvents.filter(event => event.startsWith(`${abilityId}#`));
  if (reach?.presenceOnly === true) {
    return problems;
  }
  if (reach === undefined || reach.attrs.length === 0) {
    if (events.length === 0) {
      problems.push({
        part: "attr-not-evaluated",
        message: `in "${scenario.label}" the original ability never had any attr evaluated, so the twin compared two empty traces`,
      });
    }
    return problems;
  }
  for (const { attrIndex, className } of reach.attrs) {
    const prefix = `${abilityId}#${attrIndex} ${className} `;
    if (!events.some(event => event.startsWith(prefix))) {
      problems.push({
        part: "attr-not-evaluated",
        message: `in "${scenario.label}" the original never evaluated its attr #${attrIndex} (${className}); the scenario does not steer into the trigger, so the rebuild was never exercised`,
      });
    }
  }
  return problems;
}

export interface TwinOutcome {
  readonly scenario: TwinScenario;
  readonly differences: readonly TraceDifference[];
  readonly original: TraceData;
  readonly rebuild: TraceData;
  readonly millis: number;
}

const DEFAULT_SEED = "decomp-l2";
/** Cartesian products of probe axes are capped; the first values of each axis (the boundaries) win. */
const MAX_AXIS_COMBINATIONS = 6;

/** Expands `{hp: ["max","max-1"], foeMove: ["TACKLE"]}` into one Axes object per combination, capped. */
export function expandAxes(axes: Readonly<Record<string, readonly AxisValue[]>>): Axes[] {
  let combos: Axes[] = [{}];
  for (const [axis, values] of Object.entries(axes)) {
    const next: Axes[] = [];
    for (const combo of combos) {
      for (const value of values) {
        next.push({ ...combo, [axis]: value });
      }
    }
    combos = next;
  }
  return combos.slice(0, MAX_AXIS_COMBINATIONS);
}

/** Plain-language problems with a declaration's probes, as far as the L2 harness is concerned. */
export function probeProblems(module: DeclModule): string[] {
  const problems: string[] = [];
  for (const probe of module.decl.probes ?? []) {
    for (const axis of Object.keys(probe.axes)) {
      if (!(KNOWN_AXES as readonly string[]).includes(axis)) {
        problems.push(
          `${module.className}: probe "${probe.name}" uses the axis "${axis}", which the L2 harness does not know (known: ${KNOWN_AXES.join(", ")})`,
        );
      }
    }
  }
  return problems;
}

/** The scenarios one declaration needs: its WHEN's template times every probe's axis combinations. */
export function scenariosFor(module: DeclModule): TwinScenario[] {
  const template = templateForWhen(module.decl.when);
  if (template === undefined) {
    return [];
  }
  const probes = module.decl.probes ?? [];
  const combos: Axes[] = probes.length === 0 ? [{}] : probes.flatMap(probe => expandAxes(probe.axes));
  const seen = new Set<string>();
  const scenarios: TwinScenario[] = [];
  for (const axes of combos) {
    const key = JSON.stringify(axes);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    scenarios.push({
      template,
      axes,
      label: `${getWhen(module.decl.when)?.label ?? module.decl.when}: ${describeAxes(axes)}`,
      when: module.decl.when,
      ...(module.decl.l2StaticReason === undefined ? {} : { staticReason: module.decl.l2StaticReason }),
    });
  }
  return scenarios;
}

/** One representative site per distinct param signature of the class (the proof rule of section 4). */
export function signatureSites(sites: readonly AttrSite[], module: DeclModule): AttrSite[] {
  const seen = new Map<string, AttrSite>();
  for (const site of sites) {
    const signature = JSON.stringify({
      params: readDeclParams(module, site.attr),
      specs: module.decl.conditions.map(slot => getBinding(site.abilityId, site.attrIndex, slot.slot)?.spec ?? null),
    });
    if (!seen.has(signature)) {
      seen.set(signature, site);
    }
  }
  return [...seen.values()];
}

/** Abilities the engine identifies by id, so their rebuild is twinned inside the live ability (see twinById). */
// 112 Slow Start: SlowStartTag is an AbilityBattlerTag and ends when the holder lacks the real ability id.
// 150 Imposter: PokemonTransformPhase checks the id of a copied Imposter.
const ID_CHECKED_BY_ENGINE: ReadonlySet<number> = new Set([112, 150]);

let nextShadow = SHADOW_ID_BASE;
export function allocateShadowId(): number {
  const id = nextShadow++;
  if (nextShadow >= SHADOW_ID_BASE + 500) {
    nextShadow = SHADOW_ID_BASE;
  }
  return id;
}

/**
 * Runs ability `idA` and ability `idB` (both already in the live ability list) through one scenario.
 * `idB` is renamed to `idA` in the trace, so the comparison is about behaviour, not ids.
 */
export async function twinById(
  phaserGame: Phaser.Game,
  idA: number,
  idB: number,
  scenario: TwinScenario,
  options: { readonly rng?: "max" | "seeded"; readonly seed?: string; readonly reach?: ReachExpectation } = {},
): Promise<TwinOutcome> {
  const started = Date.now();
  const rng = options.rng ?? "seeded";
  const seed = options.seed ?? DEFAULT_SEED;
  const run = (id: number): Promise<TraceData> =>
    runScenario(freshGame(phaserGame), scenario.template, { abilityId: id, axes: scenario.axes }, game =>
      BattleTrace.attach(game, { rng, seed, aliases: { [idB]: idA } }),
    );
  // The engine checks a few ability ids directly (Imposter: the Attack boost of a copied Imposter in
  // PokemonTransformPhase), so a shadow id would differ for a reason that is not the rebuilt attrs. For those, the
  // rebuild run swaps the shadow attrs into the live ability (a NEW array: the ability caches per dispatch type, keyed
  // on the identity of the array) and keeps the real id.
  const runRebuild = async (): Promise<TraceData> => {
    const live = allAbilities[idA];
    const shadow = allAbilities[idB];
    if (!ID_CHECKED_BY_ENGINE.has(idA) || live === undefined || shadow === undefined) {
      return run(idB);
    }
    const liveAttrs = live.attrs;
    (live as unknown as { attrs: readonly unknown[] }).attrs = [...shadow.attrs];
    try {
      return await run(idA);
    } finally {
      (live as unknown as { attrs: readonly unknown[] }).attrs = liveAttrs;
    }
  };
  const original = await run(idA);
  const rebuild = await runRebuild();
  return {
    scenario,
    differences: [...reachProblems(idA, original, scenario, options.reach), ...diffTraces(original, rebuild)],
    original,
    rebuild,
    millis: Date.now() - started,
  };
}

/** Rebuilds `original` from its declarations and twins it in `scenario`. */
export async function twinRebuild(
  phaserGame: Phaser.Game,
  original: Ability,
  registry: DeclRegistry,
  scenario: TwinScenario,
  options: { readonly rng?: "max" | "seeded"; readonly seed?: string } = {},
): Promise<TwinOutcome & { readonly rebuilt: RebuildResult }> {
  const shadowId = allocateShadowId();
  const rebuilt = rebuildAbility(original, shadowId, { registry });
  registerShadow(shadowId, rebuilt.ability);
  try {
    const outcome = await twinById(phaserGame, original.id, shadowId, scenario, options);
    return { ...outcome, rebuilt };
  } finally {
    unregisterShadows();
  }
}

export function liveAbility(id: number): Ability {
  const ability = allAbilities[id];
  if (ability === undefined) {
    throw new Error(`ability ${id} is not registered`);
  }
  return ability;
}

/** Plain-language report of a failed twin, for test failure messages. */
export function describeTwinFailure(abilityName: string, outcome: TwinOutcome): string {
  return [
    `${abilityName}: the rebuild behaves differently in "${outcome.scenario.label}" (${outcome.scenario.template.label}):`,
    ...outcome.differences.slice(0, 6).map(difference => `  - ${difference.message}`),
  ].join("\n");
}
