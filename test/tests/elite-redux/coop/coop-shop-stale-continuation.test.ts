/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #872 - stale shop continuation NPE (the live "game froze, only arrow keys work" class).
//
// Nightly soak me-asym (run 28999758527) caught the production stack: the co-op shop's
// async waits (shop-pick-commit barrier, up to the 60s anti-hang / option adopt) resume
// AFTER the scene moved on - run over, wave torn down, phase superseded. The continuation
// then opened the shop screen anyway: resetModifierSelect -> getRerollCost reads
// globalScene.currentBattle.waveIndex on NULL -> uncaught TypeError. In a browser an
// uncaught rejection kills the client's phase machine (input death / freeze - the #867
// wave-21 shape).
//
// FAILS-BEFORE: coopOpenOwnerShopAfterBarrier(cb, false, spoofed=true) with
// currentBattle=null rejects with the exact soak TypeError (getRerollCost is evaluated as
// a setMode ARG, so the NPE fires before any UI call). PASSES-AFTER: the #872
// coopShopSceneAlive guard drops the stale continuation LOUDLY - the promise resolves,
// no UI touch, no throw.
//
// Engine-free (no GameManager): a SelectModifierPhase over a minimal scene stub.
// globalScene CITIZENSHIP: the stub is restored in afterEach per the suite rule.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("coop #872 - stale shop continuation is dropped, not an NPE", () => {
  let prevGlobalScene: BattleScene | undefined;
  let setMode: ReturnType<typeof vi.fn>;

  /** Install a stub scene; `battle` null = torn down, `current` = what the phase manager reports as running. */
  function installScene(battle: { waveIndex: number } | null, current: unknown): void {
    // The real UI contract is Promise-returning. Keep the engine-free seam faithful so the positive
    // live-scene case also reaches resetModifierSelect's readiness continuation.
    setMode = vi.fn().mockResolvedValue(undefined);
    initGlobalScene({
      currentBattle: battle,
      phaseManager: { getCurrentPhase: () => current },
      ui: { setMode },
      lockModifierTiers: false,
      gameMode: { isCoop: true },
      // getRerollCost dependencies on the LIVE path (the guard must not over-fire there):
      applyModifier: vi.fn(),
      findModifiers: () => [],
    } as unknown as BattleScene);
  }

  beforeEach(() => {
    prevGlobalScene = globalScene;
  });

  afterEach(() => {
    if (prevGlobalScene != null) {
      initGlobalScene(prevGlobalScene);
    }
    vi.restoreAllMocks();
  });

  it("coopShopSceneAlive: false when the battle is torn down (the soak NPE precondition)", () => {
    const phase = new SelectModifierPhase();
    installScene(null, phase);
    expect(phase["coopShopSceneAlive"]("test: battle gone")).toBe(false);
  });

  it("coopShopSceneAlive: true while the battle is live - EVEN when another phase reports current (the duo-harness ctx-swap shape, must NOT over-fire)", () => {
    const phase = new SelectModifierPhase();
    installScene({ waveIndex: 45 }, { some: "other phase" });
    expect(phase["coopShopSceneAlive"]("test: ctx-swap")).toBe(true);
  });

  it("coopShopSceneAlive: true while the shop is legitimately live", () => {
    const phase = new SelectModifierPhase();
    installScene({ waveIndex: 45 }, phase);
    expect(phase["coopShopSceneAlive"]("test: live")).toBe(true);
  });

  it("post-barrier owner open on a torn-down battle resolves cleanly and never touches the UI (soak stack)", async () => {
    const phase = new SelectModifierPhase();
    installScene(null, phase);
    // spoofed=true short-circuits the rendezvous wait, isolating the post-await continuation -
    // the exact frame the soak's unhandled rejection pointed at (select-modifier-phase NPE).
    await expect(phase["coopOpenOwnerShopAfterBarrier"](() => false, false, true)).resolves.toBeUndefined();
    expect(setMode).not.toHaveBeenCalled();
  });

  it("post-barrier owner open still opens the shop when the scene is live (no over-guard)", async () => {
    const phase = new SelectModifierPhase();
    installScene({ waveIndex: 45 }, phase);
    await expect(phase["coopOpenOwnerShopAfterBarrier"](() => false, false, true)).resolves.toBeUndefined();
    expect(setMode).toHaveBeenCalled();
  });
});
