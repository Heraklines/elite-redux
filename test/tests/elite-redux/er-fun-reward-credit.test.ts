/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { DEFAULT_FUN_MODE_CONFIG, setFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { getCurrentErRewardRates } from "#data/elite-redux/er-reward-rates";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { VoucherType } from "#enums/voucher-type";
import { AddVoucherModifier } from "#modifiers/modifier";
import { AddVoucherModifierType } from "#modifiers/modifier-type";
import { Voucher } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Fun Mode reward credit", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("credits both one-time and modifier vouchers that the UI announces", async () => {
    const game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.FUN);

    const oneTime = new Voucher(VoucherType.PLUS, "Fun reward regression");
    oneTime.id = "__ER_FUN_REWARD_CREDIT__";
    const plusBefore = globalScene.gameData.voucherCounts[VoucherType.PLUS];
    expect(globalScene.validateVoucher(oneTime)).toBe(true);
    expect(globalScene.gameData.voucherCounts[VoucherType.PLUS]).toBe(plusBefore + 1);

    const regularBefore = globalScene.gameData.voucherCounts[VoucherType.REGULAR];
    const type = new AddVoucherModifierType(VoucherType.REGULAR, 3);
    expect(new AddVoucherModifier(type, VoucherType.REGULAR, 3).apply()).toBe(true);
    expect(globalScene.gameData.voucherCounts[VoucherType.REGULAR]).toBe(regularBefore + 3);

    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, difficulty: "hell" });
    game.scene.currentBattle.waveIndex = 181;
    const candyEntry = globalScene.gameData.getStarterDataEntry(SpeciesId.MAGIKARP);
    const candyBefore = candyEntry.candyCount;
    expect(globalScene.gameData.addStarterCandy(SpeciesId.MAGIKARP, 1, false, false)).toBe(true);
    expect(candyEntry.candyCount).toBe(candyBefore + getCurrentErRewardRates().totalCandy);
  });

  it("suppresses voucher rewards in Fun Debug", async () => {
    const game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, debugMode: true });

    const voucher = new Voucher(VoucherType.PLUS, "Fun Debug isolation");
    voucher.id = "__ER_FUN_DEBUG_NO_REWARD__";
    const plusBefore = globalScene.gameData.voucherCounts[VoucherType.PLUS];
    expect(globalScene.validateVoucher(voucher)).toBe(false);
    expect(globalScene.gameData.voucherCounts[VoucherType.PLUS]).toBe(plusBefore);

    const regularBefore = globalScene.gameData.voucherCounts[VoucherType.REGULAR];
    const type = new AddVoucherModifierType(VoucherType.REGULAR, 3);
    expect(new AddVoucherModifier(type, VoucherType.REGULAR, 3).apply()).toBe(true);
    expect(globalScene.gameData.voucherCounts[VoucherType.REGULAR]).toBe(regularBefore);
  });
});
