/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { SaveSlotSelectUiHandler, SaveSlotUiMode } from "#ui/save-slot-select-ui-handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => {
  const deleteSession = vi.fn<(slot: number) => Promise<boolean>>();
  const reset = vi.fn();
  const setOverlayMode = vi.fn();
  const ui = {
    playSelect: vi.fn(),
    playError: vi.fn(),
    revertMode: vi.fn(),
    setOverlayMode,
    setMode: vi.fn(),
    showText: vi.fn((_text: string, _delay?: number | null, callback?: () => void) => callback?.()),
  };
  return { deleteSession, reset, setOverlayMode, ui };
});

type HandlerInternals = {
  cursor: number;
  scrollCursor: number;
  uiMode: SaveSlotUiMode;
  saveSlotSelectCallback: ((cursor: number) => void) | null;
  sessionSlots: { slotId: number; hasData?: boolean; malformed?: boolean }[];
  clearSessionSlots: ReturnType<typeof vi.fn>;
  populateSessionSlots: ReturnType<typeof vi.fn>;
  setScrollCursor: ReturnType<typeof vi.fn>;
  setCursor: ReturnType<typeof vi.fn>;
};

function configuredHandler(
  mode: SaveSlotUiMode,
  callback = vi.fn(),
): { handler: SaveSlotSelectUiHandler; internals: HandlerInternals } {
  const handler = new SaveSlotSelectUiHandler();
  const internals = handler as unknown as HandlerInternals;
  internals.cursor = 0;
  internals.scrollCursor = 0;
  internals.uiMode = mode;
  internals.saveSlotSelectCallback = callback;
  internals.sessionSlots = [{ slotId: 0, hasData: true, malformed: false }];
  internals.clearSessionSlots = vi.fn();
  internals.populateSessionSlots = vi.fn();
  internals.setScrollCursor = vi.fn(() => true);
  internals.setCursor = vi.fn(() => true);
  return { handler, internals };
}

function openMenu(handler: SaveSlotSelectUiHandler): { label: string; handler: () => boolean }[] {
  expect(handler.processInput(Button.ACTION)).toBe(true);
  const [, config] = scene.setOverlayMode.mock.calls.at(-1)!;
  return config.options;
}

async function confirmDelete(options: { label: string; handler: () => boolean }[]): Promise<void> {
  expect(options.at(-2)?.handler()).toBe(true);
  expect(scene.setOverlayMode.mock.calls.at(-1)?.[0]).toBe(UiMode.CONFIRM);
  const [, confirm] = scene.setOverlayMode.mock.calls.at(-1)!;
  confirm();
  await vi.waitFor(() => expect(scene.deleteSession).toHaveBeenCalledWith(0));
}

describe("save-slot semantic readiness projection", () => {
  it.each([
    [{ slotId: 0 }, { slotId: 0, loaded: false, state: "loading" }],
    [
      { slotId: 1, hasData: false },
      { slotId: 1, loaded: true, state: "empty" },
    ],
    [
      { slotId: 2, hasData: true, malformed: false },
      { slotId: 2, loaded: true, state: "occupied" },
    ],
    [
      { slotId: 3, hasData: true, malformed: true },
      { slotId: 3, loaded: true, state: "malformed" },
    ],
  ] as const)("projects the selected slot without mutating it", (slot, expected) => {
    const { handler, internals } = configuredHandler(SaveSlotUiMode.SAVE);
    internals.sessionSlots = [slot];

    expect(handler.getSelectedSlotSemanticSelection()).toEqual(expected);
    expect(internals.sessionSlots[0]).toEqual(slot);
  });
});

// This test replaces the process-global scene binding, so keep it in the isolated co-op lane and restore it.
describe.skipIf(process.env.ER_SCENARIO !== "1")("co-op save-slot mutation UI", () => {
  let previousScene: BattleScene | undefined;

  beforeEach(() => {
    previousScene = globalScene;
    vi.clearAllMocks();
    initGlobalScene({
      gameData: { deleteSession: scene.deleteSession },
      reset: scene.reset,
      ui: scene.ui,
    } as unknown as BattleScene);
  });

  afterEach(() => {
    if (previousScene != null) {
      initGlobalScene(previousScene);
    }
  });

  it("keeps a manually deleted slot visible and resets when protected cloud deletion fails", async () => {
    scene.deleteSession.mockResolvedValue(false);
    const { handler, internals } = configuredHandler(SaveSlotUiMode.LOAD);

    await confirmDelete(openMenu(handler));

    await vi.waitFor(() => expect(scene.reset).toHaveBeenCalledWith(true));
    expect(internals.clearSessionSlots).not.toHaveBeenCalled();
    expect(internals.populateSessionSlots).not.toHaveBeenCalled();
  });

  it("repopulates the load menu only after the exact cloud deletion succeeds", async () => {
    scene.deleteSession.mockResolvedValue(true);
    const { handler, internals } = configuredHandler(SaveSlotUiMode.LOAD);

    await confirmDelete(openMenu(handler));

    await vi.waitFor(() => expect(internals.populateSessionSlots).toHaveBeenCalledOnce());
    expect(scene.reset).not.toHaveBeenCalled();
    expect(internals.clearSessionSlots).toHaveBeenCalledOnce();
  });

  it("does not continue an overwrite when the existing co-op checkpoint cannot be tombstoned", async () => {
    scene.deleteSession.mockResolvedValue(false);
    const callback = vi.fn();
    const { handler } = configuredHandler(SaveSlotUiMode.SAVE, callback);

    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(scene.setOverlayMode.mock.calls.at(-1)?.[0]).toBe(UiMode.CONFIRM);
    const [, confirm] = scene.setOverlayMode.mock.calls.at(-1)!;
    confirm();

    await vi.waitFor(() => expect(scene.reset).toHaveBeenCalledWith(true));
    expect(callback).not.toHaveBeenCalled();
  });
});
