/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getErCustomTrainers, setErCustomTrainersForTesting } from "#data/elite-redux/er-custom-trainers";
import { TrainerType } from "#enums/trainer-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import shippedCustomTrainers from "../../../src/data/elite-redux/er-custom-trainers.json";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("shipped custom trainer catalog", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    new GameManager(phaserGame);
    setErCustomTrainersForTesting(undefined);
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("resolves every shipped editor record instead of silently dropping an invalid entry", () => {
    expect(getErCustomTrainers()).toHaveLength(Object.keys(shippedCustomTrainers).length);
  });

  it("resolves both authored Volo variants into the live picker catalog", () => {
    const volo = getErCustomTrainers().filter(trainer => trainer.name === "Volo");

    expect(volo.map(trainer => trainer.key)).toEqual(["TRAINER_70022", "TRAINER_70023"]);
    expect(volo.map(trainer => trainer.trainerType)).toEqual([TrainerType.CYNTHIA, TrainerType.CYNTHIA]);
    expect(volo.map(trainer => trainer.difficulties)).toEqual([["elite"], ["hell"]]);
    expect(volo.every(trainer => trainer.trainerSpriteKey === "volo")).toBe(true);
    expect(volo.every(trainer => trainer.members.length === 6)).toBe(true);
  });

  it("resolves Bernard's latest custom trainers instead of dropping display-only class labels", () => {
    const latest = getErCustomTrainers().filter(trainer => trainer.id >= 70024);

    expect(latest.map(trainer => trainer.key)).toEqual([
      "TRAINER_70024",
      "TRAINER_70025",
      "TRAINER_70026",
      "TRAINER_70027",
    ]);
    expect(latest.map(trainer => trainer.name)).toEqual(["Jacinthe", "Invader Alien", "Red EX", "N"]);
    expect(latest.map(trainer => trainer.trainerType)).toEqual([
      TrainerType.GIOVANNI,
      TrainerType.SCIENTIST,
      TrainerType.RED,
      TrainerType.COLRESS,
    ]);
    expect(latest.map(trainer => trainer.members.length)).toEqual([6, 5, 6, 6]);
  });
});
