/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import type { Pokemon } from "#field/pokemon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shiftPhase: vi.fn(),
  playSound: vi.fn(),
  addDamageNumber: vi.fn(),
  addEvent: vi.fn(),
  callback: undefined as (() => void) | undefined,
  timer: { repeatCount: 0 },
}));

import { DamageAnimPhase } from "#phases/damage-anim-phase";

describe("DamageAnimPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callback = undefined;
    mocks.timer.repeatCount = 0;
    mocks.addEvent.mockImplementation((config: { callback: () => void }) => {
      mocks.callback = config.callback;
      return mocks.timer;
    });
    initGlobalScene({
      playSound: mocks.playSound,
      damageNumberHandler: { add: mocks.addDamageNumber },
      time: { addEvent: mocks.addEvent },
      phaseManager: { shiftPhase: mocks.shiftPhase },
      currentBattle: {
        isClassicFinalBoss: false,
        arrangement: {
          locate: () => ({ side: 0, position: 0 }),
          ownerOf: () => 0,
        },
      },
      getField: () => [],
    } as unknown as BattleScene);
  });

  it("keeps the original target when its field slot changes during the flash", async () => {
    const sprite = { active: true, setVisible: vi.fn() };
    const pokemon = {
      getSprite: vi.fn(() => sprite),
      isActive: vi.fn(() => true),
      updateInfo: vi.fn(() => Promise.resolve()),
    } as unknown as Pokemon;
    const phase = new DamageAnimPhase(BattlerIndex.PLAYER, 10, HitResult.EFFECTIVE);
    const getPokemon = vi.fn().mockReturnValueOnce(pokemon).mockReturnValue(undefined);
    phase.getPokemon = getPokemon;

    (phase as unknown as { applyDamage(): void }).applyDamage();
    expect(getPokemon).toHaveBeenCalledTimes(1);

    expect(() => mocks.callback?.()).not.toThrow();
    await Promise.resolve();

    expect(sprite.setVisible).toHaveBeenCalledWith(true);
    expect(pokemon.updateInfo).toHaveBeenCalledOnce();
    expect(mocks.shiftPhase).toHaveBeenCalledWith(phase);
    expect(getPokemon).toHaveBeenCalledTimes(1);
  });

  it("ends cleanly when the target no longer exists before the animation starts", () => {
    const phase = new DamageAnimPhase(BattlerIndex.PLAYER, 10, HitResult.EFFECTIVE);
    phase.getPokemon = vi.fn(() => undefined as unknown as Pokemon);

    expect(() => (phase as unknown as { applyDamage(): void }).applyDamage()).not.toThrow();
    expect(mocks.shiftPhase).toHaveBeenCalledWith(phase);
    expect(mocks.addEvent).not.toHaveBeenCalled();
  });
});
