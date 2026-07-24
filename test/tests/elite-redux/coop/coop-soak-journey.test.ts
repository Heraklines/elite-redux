/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Production-shaped continuous journey campaign: many distinct mystery-event archetypes are forced into
// one run, ownership alternates naturally, normal battles continue between them, and real biome changes are
// counted. This is deliberately separate from one-event unit repros: a green result proves event teardown
// does not poison a later event, reward shop, biome boundary, or command phase.

import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { BattleType } from "#enums/battle-type";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import { prepareCoopSoakContent, runCoopSoak, SOAK_PROFILES } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const CONTENT_SEED = "test";
const LAST_WAVE = 45;

/** Every wave is non-milestone and known wild-eligible under CONTENT_SEED. */
const EVENT_SCHEDULE = new Map([
  [12, MysteryEncounterType.DEPARTMENT_STORE_SALE], // nested shop
  [14, MysteryEncounterType.ER_HOT_SPRING], // empty healing-shop terminal
  [16, MysteryEncounterType.BERRIES_ABOUND], // explicit leave after a battle-capable offer
  [18, MysteryEncounterType.ER_PICNIC], // account-local candy/affection surface; safe move-on branch
  [24, MysteryEncounterType.FIELD_TRIP], // guest-owned party + nested move sub-picks
  [26, MysteryEncounterType.ER_TOWN_RAFFLE], // money spend + seeded generated reward identity
  [28, MysteryEncounterType.ER_FORTUNE_TELLER], // queued future event + world-map reveal mutation
  [32, MysteryEncounterType.TELEPORTING_HIJINKS], // post-crossroads biome transition + boss battle
  [34, MysteryEncounterType.ER_STILL_WATERS], // full-party mirror battle surface; safe decline terminal
  [36, MysteryEncounterType.WEIRD_DREAM], // legal-range transformation encounter, leave branch
  [39, MysteryEncounterType.ER_CLEANSING_FONT], // party-wide heal/status continuation
  [42, MysteryEncounterType.ER_DRAGONS_HOARD], // catch-capable boss surface; safe decline terminal
  [44, MysteryEncounterType.TRASH_TO_TREASURE], // direct held-item mutation
]);

/** One-based safe non-battle option for each event; both ownership parities use the same semantic choice. */
const EVENT_OPTIONS = new Map([
  [12, 1],
  [14, 2],
  [16, 3],
  [18, 4],
  [24, 1],
  [26, 1],
  [28, 1],
  [32, 3],
  [34, 2],
  [36, 3],
  [39, 1],
  [42, 2],
  [44, 2],
]);

/** Field Trip option 1: choose party slot 0, then that Pokemon's move slot 0. */
const EVENT_SUB_PICKS = new Map<number, readonly number[]>([[24, [0, 0]]]);
const EVENT_BATTLE_WAVES = new Set([32]);
const EVENT_NO_REWARD_WAVES = new Set([39]);

describe.skipIf(!RUN)("co-op continuous journey: many mystery events plus biome transitions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let accuracySpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
    // Entry presentation can legitimately contain many ordered ability/stat phases before the renderer
    // reaches its command rendezvous. A 50 ms ceiling terminated the authority while that healthy replay
    // was still draining; keep a bounded test timeout while allowing the real presentation path to finish.
    setCoopWaveBarrierMs(2_000);
    setCoopFaintSwitchWaitMs(4_000);
    setCoopRendezvousWaitMs(1_000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`soak-journey-${Date.now()}`);
    game.override
      .battleStyle("double")
      .battleType(BattleType.WILD)
      .startingWave(1)
      .startingLevel(SOAK_PROFILES.god.startingLevel)
      .moveset([...SOAK_PROFILES.god.moveset])
      .startingHeldItems([...(SOAK_PROFILES.god.heldItems ?? [])])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    resetCoopRendezvousWaitMs();
    accuracySpy?.mockRestore();
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it("plays through thirteen heterogeneous events, later battles, and repeated world-map boundaries without drift", async () => {
    const seed = 828_633;
    prepareCoopSoakContent(game, seed, CONTENT_SEED);
    await game.classicMode.startBattle(...SOAK_PROFILES.god.species);
    const result = await runCoopSoak(game, {
      seed,
      waves: LAST_WAVE,
      logs,
      profile: "god",
      fidelity: "production",
      pinSeed: CONTENT_SEED,
      meWaves: EVENT_SCHEDULE,
      meOptions: EVENT_OPTIONS,
      meSubPicks: EVENT_SUB_PICKS,
      meBattleWaves: EVENT_BATTLE_WAVES,
      meNoRewardWaves: EVENT_NO_REWARD_WAVES,
    });

    expect(result.wavesCompleted, "the campaign continued after the final forced event").toBe(LAST_WAVE);
    expect(result.runEnded, "the campaign did not silently terminal/degrade").toBeUndefined();
    const biomeMarketActions = result.actionScript.filter(action => action.includes(": biome market owner="));
    expect(
      biomeMarketActions.some(action => action.startsWith("wave 30: biome market owner=") && action.endsWith(" leave")),
      `wave 30 crossed the real biome market terminal: ${JSON.stringify(biomeMarketActions)}`,
    ).toBe(true);
    expect(
      new Set(
        biomeMarketActions.map(action => {
          const owner = / owner=(host|guest) /.exec(action)?.[1];
          return owner ?? "missing-owner";
        }),
      ),
      `the journey exercised both biome-market owner seats: ${JSON.stringify(biomeMarketActions)}`,
    ).toEqual(new Set(["host", "guest"]));
    expect(result.actionScript, "wave 10 drained its milestone continuation without parking either renderer").toContain(
      "wave 10: drained 1 milestone reward continuation(s)",
    );
    expect(result.mysteryEncounters, "every scheduled event was driven exactly once").toHaveLength(EVENT_SCHEDULE.size);
    expect(result.actionScript, "Field Trip selected a real party row through the guest capture UI").toContain(
      "wave 24: ME FIELD_TRIP public PARTY pick=0",
    );
    expect(result.actionScript, "Field Trip selected a real move row through the guest capture UI").toContain(
      "wave 24: ME FIELD_TRIP public OPTION_SELECT pick=0",
    );
    expect(
      result.actionScript.some(action =>
        /^wave 24: ME FIELD_TRIP option=1 driven \((?:host|guest)-owned, counter \d+->\d+\)$/u.test(action),
      ),
      "Field Trip crossed its exact terminal and advanced the shared interaction counter once",
    ).toBe(true);
    expect(new Set(result.mysteryEncounters.map(event => event.type)).size, "event types are heterogeneous").toBe(
      EVENT_SCHEDULE.size,
    );
    expect(
      new Set(result.mysteryEncounters.map(event => event.path)),
      "both alternating owners were exercised",
    ).toEqual(new Set(["host-owned", "guest-owned", "battle-handoff"]));
    expect(result.biomeTransitions, "the same continuous run crossed multiple biome boundaries").toBeGreaterThanOrEqual(
      2,
    );
    expect(result.findings, "no unhealed state divergence across events or transitions").toEqual([]);
    expect(result.assertions, "the production checksum never observed transient drift").toBe(0);
    expect(result.resyncHeals, "the campaign did not rely on a boundary heal").toBe(0);
    logs.flush();
  }, 900_000);
});
