import { handoffFunModeToTitle } from "#ui/handlers/fun-mode-title-handoff";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  end: vi.fn(),
  playSelect: vi.fn(),
  toTitleScreen: vi.fn(),
}));

describe("Fun Mode title handoff", () => {
  it("hands input to TitlePhase without refreshing the retired Fun Mode surface", () => {
    handoffFunModeToTitle({
      toTitleScreen: mocks.toTitleScreen,
      endCurrentPhase: mocks.end,
      playSelect: mocks.playSelect,
    });

    expect(mocks.toTitleScreen).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.playSelect).toHaveBeenCalledOnce();
  });
});
