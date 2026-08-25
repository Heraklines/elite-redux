import { saveEncounterCheckpointWithEndlessEntryRecovery } from "#phases/encounter-phase";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Endless entry encounter persistence", () => {
  it("retries the initial Rift checkpoint without cloud sync", async () => {
    const save = vi.fn<(sync: boolean) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(saveEncounterCheckpointWithEndlessEntryRecovery(save, true)).resolves.toBe(true);
    expect(save.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the initial Rift encounter live when both checkpoint attempts fail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const save = vi.fn<(sync: boolean) => Promise<boolean>>().mockRejectedValue(new Error("checkpoint failed"));

    await expect(saveEncounterCheckpointWithEndlessEntryRecovery(save, true)).resolves.toBe(true);
    expect(save.mock.calls).toEqual([[true], [false]]);
    expect(error).toHaveBeenCalledWith(
      "[endless] Initial Rift local checkpoint threw; continuing the live run without resetting.",
      expect.any(Error),
    );
  });

  it("preserves the fatal save behavior for every ordinary encounter", async () => {
    const save = vi.fn<(sync: boolean) => Promise<boolean>>().mockResolvedValue(false);

    await expect(saveEncounterCheckpointWithEndlessEntryRecovery(save, false)).resolves.toBe(false);
    expect(save).toHaveBeenCalledOnce();
  });
});
