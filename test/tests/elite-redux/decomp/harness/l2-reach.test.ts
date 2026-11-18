/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Proves each L2 scenario template really REACHES the trigger it is mapped to. For every WHEN with a
// dispatch key a probe ability is built whose only attr is an instance of that dispatch class (a
// carrier whose canApply says no), the WHEN's template is run, and the trace hook must have looked at
// that attr. A template that never reaches its WHEN would make every twin of that WHEN vacuous.
//
// The result is a ratchet: test/fixtures/elite-redux/ability-studio/decomp-l2-reach.json lists the WHENs
// reached today and may only grow. Unreached WHENs are listed honestly in `unreached` (with the template
// that failed to reach them), never hidden.
//   ER_WRITE_REACH=1 npx vitest run test/tests/elite-redux/decomp/harness/l2-reach.test.ts
import { AbAttr, AbilityAttrs } from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { WHEN_REGISTRY } from "#data/elite-redux/ability-studio/vocabulary/when-registry";
import type { AbilityId } from "#enums/ability-id";
import { BattleTrace } from "#test/tests/elite-redux/decomp/harness/battle-trace";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { runScenario, templateForWhen } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const FILE = resolve(process.cwd(), "test/fixtures/elite-redux/ability-studio/decomp-l2-reach.json");
const WRITE = process.env.ER_WRITE_REACH === "1";
const PROBE_ID = 29400;

interface ReachFile {
  readonly reached: string[];
  readonly unreached: Record<string, string>;
}

function probeAbility(dispatchKey: string): Ability {
  const base = (AbilityAttrs as unknown as Record<string, new (...args: never[]) => AbAttr>)[dispatchKey];
  const attr = Reflect.construct(AbAttr as unknown as new (show?: boolean) => AbAttr, [false], base) as AbAttr;
  // Looked at by the engine (the trace hook records it), but never applied.
  attr.canApply = () => false;
  const builder = new AbBuilder(PROBE_ID as AbilityId, 9);
  builder.attrs.push(attr);
  return builder.build();
}

describe("L2 scenario templates reach their triggers", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  it(
    "each template's trace shows the trigger's dispatch class being evaluated",
    async () => {
      const started = Date.now();
      const reached: string[] = [];
      const unreached: Record<string, string> = {};
      for (const when of WHEN_REGISTRY) {
        const template = templateForWhen(when.id);
        if (template === undefined || when.dispatchKey === null || !(when.dispatchKey in AbilityAttrs)) {
          continue;
        }
        registerShadow(PROBE_ID, probeAbility(when.dispatchKey));
        try {
          const trace = await runScenario(freshGame(phaserGame), template, { abilityId: PROBE_ID }, game =>
            BattleTrace.attach(game, { rng: "max" }),
          );
          const seen = trace.attrEvents.some(
            event => event.startsWith(`${PROBE_ID}#0 `) && event.includes(`via ${when.dispatchKey}`),
          );
          if (seen) {
            reached.push(when.id);
          } else {
            unreached[when.id] = `${template.id}: the engine never evaluated a ${when.dispatchKey} attr of the holder`;
          }
        } catch (error) {
          unreached[when.id] = `${template.id}: ${(error as Error).message.split("\n")[0]}`;
        } finally {
          unregisterShadows();
          delete (allAbilities as Ability[])[PROBE_ID];
        }
      }
      console.log(
        `DECOMP_L2_REACH reached=${reached.length} unreached=${Object.keys(unreached).length} ${Date.now() - started}ms`,
      );
      let committed: ReachFile | undefined;
      try {
        committed = JSON.parse(readFileSync(FILE, "utf8")) as ReachFile;
      } catch {
        committed = undefined;
      }
      if (WRITE) {
        const union = [...new Set([...(committed?.reached ?? []), ...reached])].sort();
        const stillUnreached = Object.fromEntries(
          Object.entries(unreached)
            .filter(([id]) => !union.includes(id))
            .sort(([a], [b]) => a.localeCompare(b)),
        );
        writeFileSync(FILE, `${JSON.stringify({ reached: union, unreached: stillUnreached }, null, 1)}\n`, "utf8");
        committed = { reached: union, unreached: stillUnreached };
      }
      expect(committed, `run ER_WRITE_REACH=1 once to create ${FILE}`).toBeDefined();
      const lost = (committed?.reached ?? []).filter(id => !reached.includes(id));
      expect(lost.map(id => `${id} used to be reached by its template and no longer is`)).toEqual([]);
    },
    30 * 60 * 1000,
  );
});
