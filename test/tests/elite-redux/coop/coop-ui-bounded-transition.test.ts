/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import { UI } from "#ui/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

interface UiSeam {
  mode: UiMode;
  modeChain: UiMode[];
  modeTransitionGeneration: number;
  overlayActive: boolean;
  overlay: {
    setAlpha(value: number): void;
    setVisible(value: boolean): void;
  };
  fadeOut(): Promise<void>;
  fadeIn(): Promise<void>;
  getHandler(): { active: boolean; clear(): void; show(args: unknown[]): void };
}

type UiHarness = UiSeam & Pick<UI, "getMode" | "setModeBounded" | "setModeBoundedWhen">;

describe("co-op bounded UI transition seam", () => {
  let previousScene: BattleScene;

  beforeEach(() => {
    vi.useFakeTimers();
    previousScene = globalScene;
    initGlobalScene({
      gameMode: { isCoop: false },
      tweens: { killTweensOf: vi.fn() },
      time: { delayedCall: (_delay: number, callback: () => void) => callback() },
    } as unknown as BattleScene);
  });

  afterEach(() => {
    initGlobalScene(previousScene);
    vi.useRealTimers();
  });

  function makeUi(fade: Deferred): {
    ui: UiHarness;
    clear: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
  } {
    const ui = Object.create(UI.prototype) as UiHarness;
    const clear = vi.fn();
    const show = vi.fn();
    const handler = { active: true, clear, show };
    ui.mode = UiMode.STARTER_SELECT;
    ui.modeChain = [];
    ui.modeTransitionGeneration = 0;
    ui.overlayActive = true;
    ui.overlay = { setAlpha: vi.fn(), setVisible: vi.fn() };
    ui.fadeOut = () => fade.promise;
    ui.fadeIn = () => Promise.resolve();
    ui.getHandler = () => handler;
    return { ui, clear, show };
  }

  it("reactivates an inactive handler when a bounded transition targets the current mode", async () => {
    const fade = deferred();
    const { ui, clear, show } = makeUi(fade);
    const handler = ui.getHandler();
    handler.active = false;
    show.mockImplementation(() => {
      handler.active = true;
    });

    await expect(ui.setModeBounded(UiMode.STARTER_SELECT, 25, { marker: "reopen" })).resolves.toBe("completed");
    expect(clear).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith([{ marker: "reopen" }]);
    expect(handler.active).toBe(true);
  });

  it("a lost fade times out, force-installs the target exactly once, and its late callback cannot overwrite", async () => {
    const fade = deferred();
    const { ui, clear, show } = makeUi(fade);

    const result = ui.setModeBounded(UiMode.PARTY, 25, { marker: "target" });
    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toBe("forced");
    expect(ui.getMode()).toBe(UiMode.PARTY);
    expect(clear).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();

    fade.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.getMode(), "the late fade continuation cannot restore the old transition").toBe(UiMode.PARTY);
    expect(clear).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
  });

  it("a newer transition supersedes an older pending fade and the old callback cannot overwrite it", async () => {
    const fade = deferred();
    const { ui, show } = makeUi(fade);
    let fadeCount = 0;
    ui.fadeOut = () => (++fadeCount === 1 ? fade.promise : Promise.resolve());

    const oldTransition = ui.setModeBounded(UiMode.PARTY, 100, { marker: "old" });
    const newerTransition = ui.setModeBounded(UiMode.SUMMARY, 100, { marker: "new" });
    await expect(newerTransition).resolves.toBe("completed");
    expect(ui.getMode()).toBe(UiMode.SUMMARY);

    fade.resolve();
    await expect(oldTransition).resolves.toBe("superseded");
    expect(ui.getMode()).toBe(UiMode.SUMMARY);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenLastCalledWith([{ marker: "new" }]);
  });

  it.each([
    { label: "direct no-transition", winner: UiMode.CONFIRM },
    { label: "same-mode", winner: UiMode.STARTER_SELECT },
  ])("a $label winner normalizes the opaque overlay left by an older fade", async ({ winner }) => {
    const fade = deferred();
    const { ui } = makeUi(fade);

    const oldTransition = ui.setModeBounded(UiMode.PARTY, 100, { marker: "old" });
    const winnerTransition = ui.setModeBounded(winner, 100, { marker: "winner" });
    await expect(winnerTransition).resolves.toBe("completed");
    expect(ui.overlay.setAlpha).toHaveBeenLastCalledWith(0);
    expect(ui.overlay.setVisible).toHaveBeenLastCalledWith(false);
    expect(ui.overlayActive).toBe(false);

    fade.resolve();
    await expect(oldTransition).resolves.toBe("superseded");
    expect(ui.getMode()).toBe(winner);
    expect(ui.overlay.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("an expired phase/session guard aborts a pending bounded transition before timeout force mutation", async () => {
    const fade = deferred();
    const { ui, clear, show } = makeUi(fade);
    let live = true;

    const transition = ui.setModeBoundedWhen(UiMode.PARTY, 25, () => live, { marker: "stale" });
    live = false;
    await vi.advanceTimersByTimeAsync(25);

    await expect(transition).resolves.toBe("superseded");
    expect(ui.getMode()).toBe(UiMode.STARTER_SELECT);
    expect(clear).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(ui.overlay.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("a rapid transition during fadeIn kills the old owner and its late callback cannot hide the new fade", async () => {
    const unused = deferred();
    const { ui } = makeUi(unused);
    const tweens: { onComplete?: () => void }[] = [];
    const sceneTweens = globalScene.tweens as unknown as {
      add: ReturnType<typeof vi.fn>;
      killTweensOf: ReturnType<typeof vi.fn>;
    };
    sceneTweens.add = vi.fn((config: { onComplete?: () => void }) => {
      tweens.push(config);
      return config;
    });
    ui.fadeOut = (duration = 0) => UI.prototype.fadeOut.call(ui as unknown as UI, duration);
    ui.fadeIn = (duration = 0) => UI.prototype.fadeIn.call(ui as unknown as UI, duration);

    const first = ui.setModeBounded(UiMode.PARTY, 1_000);
    tweens[0].onComplete?.(); // first fadeOut -> mode install -> first fadeIn
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.getMode()).toBe(UiMode.PARTY);
    const staleFadeIn = tweens[1];

    const second = ui.setModeBounded(UiMode.SUMMARY, 1_000);
    const newFadeOut = tweens[2];
    expect(ui.overlay.setVisible).toHaveBeenLastCalledWith(true);
    staleFadeIn.onComplete?.();
    expect(ui.overlay.setVisible, "killed fadeIn cannot hide the newly owned fadeOut").toHaveBeenLastCalledWith(true);

    newFadeOut.onComplete?.();
    await Promise.resolve();
    await Promise.resolve();
    tweens[3].onComplete?.();
    await expect(first).resolves.toBe("completed");
    await expect(second).resolves.toBe("completed");
    expect(ui.getMode()).toBe(UiMode.SUMMARY);
  });
});
