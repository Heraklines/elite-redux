/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// HEADLESS REPRO of the 2026-06-22 player bug reports (combat mechanics).
//
// Each report came from running an in-game dev scenario. The scenario SETUPS
// were already corrected in source (bumped to wave 145 so the #419 elite
// BST-cap stops swapping the test target out). What is NOT yet verified is
// whether the underlying ABILITY/MOVE code is actually correct.
//
// This harness launches the REAL dev `DevScenario` objects (so all the ER
// ids — High Tide / Locust Swarm / Wispywaspy / etc. — are baked in by the
// scenario itself), plays a scripted handful of turns through the real battle
// phases, and DUMPS the observable state for both fields each turn. Reading
// the dump tells us, per bug, whether the mechanic now works.
//
// Run:  ER_SCENARIO=1 npx vitest run test/tools/repro-reported-bugs.test.ts
// (skipped without ER_SCENARIO=1, like the other heavy scenario suites.)
// =============================================================================

import { DEV_SCENARIOS } from "#app/dev-tools/test-suite/scenarios";
import { getGameMode } from "#app/game-mode";
import Overrides from "#app/overrides";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

interface TurnAction {
  move?: MoveId;
  target?: BattlerIndex;
  move2?: MoveId;
  target2?: BattlerIndex;
}

interface ReproCase {
  /** Substring of the DevScenario.label to find it. */
  labelIncludes: string;
  double: boolean;
  /** One entry per turn. */
  script: TurnAction[];
  /** What "fixed" looks like, for the reader. */
  expect: string;
}

const E = BattlerIndex.ENEMY; // 2
const CASES: ReproCase[] = [
  {
    labelIncludes: "Deadeye: Zap Cannon never misses",
    double: false,
    // Stall with Soft-Boiled; the default test RNG returns the MAX of every
    // range, so a 50%-accuracy move (Zap Cannon) MISSES deterministically
    // unless an always-hit effect (Deadeye) bypasses accuracy. So: enemy
    // Zap Cannon HITTING here == Deadeye-as-innate works.
    script: Array.from({ length: 5 }, () => ({ move: MoveId.SOFT_BOILED })),
    expect: "enemy Porygon-Z has Deadeye innate AND its Zap Cannon HITS every turn (result SUCCESS, player HP drops)",
  },
  {
    labelIncludes: "High Tide: follow-up Surf hits BOTH foes",
    double: true,
    // Greninja Water Pulse the LEAD foe (slot 2) only; Pikachu Quick Attack
    // the same lead. Enemy slot 3 is never directly targeted — so if its HP
    // drops, the High Tide follow-up Surf spread to it.
    script: [
      { move: MoveId.WATER_PULSE, target: E, move2: MoveId.QUICK_ATTACK, target2: E },
      { move: MoveId.WATER_PULSE, target: E, move2: MoveId.QUICK_ATTACK, target2: E },
    ],
    expect: "enemy slot-3 HP drops despite never being directly targeted (the follow-up Surf hit BOTH foes)",
  },
  {
    labelIncludes: "Frisk: reveals items",
    double: false,
    script: Array.from({ length: 3 }, () => ({ move: MoveId.WATER_SHURIKEN, target: E })),
    expect:
      "log shows a Frisk reveal of the enemy's HELD ITEMS; Leftovers heal is suppressed ~2 turns then resumes; Sitrus still works",
  },
  {
    labelIncludes: "Corrosion: Poison moves are super effective vs Steel",
    double: false,
    script: [
      { move: MoveId.ACID_SPRAY, target: E },
      { move: MoveId.ACID_SPRAY, target: E },
    ],
    expect: "Acid Spray (Poison) deals real damage to Steel/Flying Skarmory — super effective, NOT 0/immune",
  },
  {
    labelIncludes: "Wispywaspy School",
    double: false,
    // Lick the foe so Wispywaspy itself takes Blissey's weak Water Gun and
    // (per the dex) schools to the HIVEMIND form while above 1/4 HP.
    script: [
      { move: MoveId.LICK, target: E },
      { move: MoveId.LICK, target: E },
    ],
    expect: "Wispywaspy's formIndex changes to the Hivemind/School form once it has taken a hit while above 1/4 HP",
  },
  {
    labelIncludes: "Decorate: buffs the WHOLE user side",
    double: true,
    // Gardevoir Decorate the lead foe; Kecleon Shadow Sneak the lead foe (so
    // Kecleon's own action never touches its HP — any HP loss = Decorate
    // damaging the ally, the real bug).
    script: [{ move: MoveId.DECORATE, target: E, move2: MoveId.SHADOW_SNEAK, target2: E }],
    expect: "foe damaged; BOTH Gardevoir AND ally Kecleon get +2 ATK / +2 SPATK; ally Kecleon takes NO damage",
  },
];

/**
 * The test framework's OverridesHelper locks override keys with
 * `vi.spyOn(Overrides, KEY, "get")` (getter-only), but the dev scenarios drive
 * the real dev workflow by DIRECTLY assigning `Overrides.KEY = ...` /
 * `Object.assign(Overrides, ...)` — which throws on a getter-only prop. Convert
 * every Overrides accessor into a writable data property seeded with its
 * current value, so the scenario's direct writes work exactly as they do at
 * runtime in the browser. (vi spies are configurable, so this is allowed.)
 */
function unlockOverrides(): void {
  const o = Overrides as unknown as Record<string, unknown>;
  const keys = new Set<string>();
  for (let cur: object | null = o; cur && cur !== Object.prototype; cur = Object.getPrototypeOf(cur)) {
    for (const k of Object.getOwnPropertyNames(cur)) {
      keys.add(k);
    }
  }
  for (const k of keys) {
    if (k === "constructor") {
      continue;
    }
    let val: unknown;
    try {
      val = o[k];
    } catch {
      continue;
    }
    if (typeof val === "function") {
      continue;
    }
    try {
      Object.defineProperty(o, k, { value: val, writable: true, configurable: true, enumerable: true });
    } catch {
      /* non-configurable — leave it */
    }
  }
}

function dumpMon(label: string, mon: Pokemon | undefined): void {
  if (!mon) {
    console.log(`    ${label}: (none)`);
    return;
  }
  const stageStats: (Stat.ATK | Stat.DEF | Stat.SPATK | Stat.SPDEF | Stat.SPD | Stat.ACC | Stat.EVA)[] = [
    Stat.ATK,
    Stat.DEF,
    Stat.SPATK,
    Stat.SPDEF,
    Stat.SPD,
    Stat.ACC,
    Stat.EVA,
  ];
  const stages = stageStats.map(s => mon.getStatStage(s));
  const passives = mon
    .getPassiveAbilities()
    .map(a => a?.name)
    .filter(Boolean)
    .join(", ");
  const lm = mon.getLastXMoves(1)[0];
  const lastMove = lm
    ? `${MoveId[lm.move]}(${lm.result == null ? "?" : MoveResult[lm.result]}, tgts:${lm.targets?.length ?? 0}, hits:${mon.turnData?.hitCount ?? "?"})`
    : "-";
  console.log(
    `    ${label}: ${mon.species.name} form#${mon.formIndex} ${mon.hp}/${mon.getMaxHp()}hp`
      + ` ability="${mon.getAbility()?.name}" passives=[${passives}]`
      + ` stages[atk,def,spa,spd,spe,acc,eva]=${JSON.stringify(stages)} lastMove=${lastMove}`,
  );
}

function dumpField(game: GameManager, when: string): void {
  console.log(`  --- ${when} ---`);
  game.scene.getPlayerField().forEach((m, i) => dumpMon(`P${i}`, m));
  game.scene.getEnemyField().forEach((m, i) => dumpMon(`E${i}`, m));
}

describe.skipIf(!RUN)("repro: 2026-06-22 combat bug reports", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  for (const c of CASES) {
    it(`repro — ${c.labelIncludes}`, async () => {
      const scenario = DEV_SCENARIOS.find(s => s.label.includes(c.labelIncludes));
      expect(scenario, `dev scenario not found for "${c.labelIncludes}"`).toBeTruthy();
      if (!scenario) {
        return;
      }

      console.log(`\n===== ${scenario.label} =====`);
      console.log(`EXPECT (fixed): ${c.expect}`);

      const game = new GameManager(phaserGame);
      game.override.criticalHits(false);
      await game.runToTitle();
      unlockOverrides(); // let the dev scenario's direct Overrides writes work
      const starters = scenario.setup();
      (Overrides as unknown as Record<string, unknown>).BATTLE_STYLE_OVERRIDE = c.double ? "double" : "single";
      // setup() already set the relevant Overrides; surface the key ones.
      console.log(
        `setup: wave=${Overrides.STARTING_WAVE_OVERRIDE} lvl=${Overrides.STARTING_LEVEL_OVERRIDE}`
          + ` enemy=${Overrides.ENEMY_SPECIES_OVERRIDE} style=${Overrides.BATTLE_STYLE_OVERRIDE}`
          + ` playerAbilOverride=${Overrides.ABILITY_OVERRIDE}`,
      );

      game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
        game.scene.gameMode = getGameMode(GameModes.CLASSIC);
        const ssp = new SelectStarterPhase();
        game.scene.phaseManager.pushNew("EncounterPhase", false);
        ssp.initBattle(starters);
      });
      await game.phaseInterceptor.to("EncounterPhase");
      await game.phaseInterceptor.to("CommandPhase");
      scenario.onBattleStart?.();

      const logStart = game.textInterceptor.logs.length;
      dumpField(game, "TURN 0 (battle start)");

      for (let t = 0; t < c.script.length; t++) {
        const a = c.script[t];
        const field = game.scene.getPlayerField();
        if (field[0] && !field[0].isFainted() && a.move != null) {
          game.move.use(a.move, BattlerIndex.PLAYER, a.target);
        }
        if (c.double && field[1] && !field[1].isFainted() && a.move2 != null) {
          game.move.use(a.move2, BattlerIndex.PLAYER_2, a.target2);
        }
        await game.toEndOfTurn();
        dumpField(game, `after TURN ${t + 1}`);
        if (game.isVictory() || game.scene.getPlayerParty().every(p => p.isFainted())) {
          break;
        }
        if (t < c.script.length - 1) {
          await game.toNextTurn();
        }
      }

      const newLogs = game.textInterceptor.logs.slice(logStart);
      console.log("  --- battle message log ---");
      for (const line of newLogs) {
        console.log(`    | ${line}`);
      }

      // No hard assertion — this is an observational repro. The dump above is
      // read to decide fixed-vs-broken per bug. A clean finish (no throw /
      // soft-lock) is the pass.
      expect(true).toBe(true);
    }, 180_000);
  }
});
