import type { Beat } from "#data/llm-director/beat-schema";
import { DirectorQueue } from "#system/llm-director/director-queue";
import { describe, expect, it, vi } from "vitest";

const narrativeBeat = (id: string): Beat => ({
  beatId: id,
  type: "narrative_only",
  introText: "x",
  bodyText: "y",
});

describe("DirectorQueue", () => {
  it("generates beat in background; tryTake returns it once ready", async () => {
    const generate = vi.fn().mockResolvedValue(narrativeBeat("b1"));
    const q = new DirectorQueue({ generate });
    q.kickOff(3);
    await new Promise(r => setTimeout(r, 0));
    const b = await q.tryTake(3, { timeoutMs: 50 });
    expect(b?.beatId).toBe("b1");
  });

  it("tryTake times out and returns null if not ready", async () => {
    const generate = vi.fn().mockImplementation(() => new Promise<Beat>(() => {}));
    const q = new DirectorQueue({ generate });
    q.kickOff(3);
    const b = await q.tryTake(3, { timeoutMs: 30 });
    expect(b).toBeNull();
  });

  it("ignores duplicate kickOff for same wave", () => {
    const generate = vi.fn().mockResolvedValue(narrativeBeat("b1"));
    const q = new DirectorQueue({ generate });
    q.kickOff(3);
    q.kickOff(3);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("tryTake returns immediately if a ready beat is already cached", async () => {
    const generate = vi.fn().mockResolvedValue(narrativeBeat("b9"));
    const q = new DirectorQueue({ generate });
    q.kickOff(9);
    // Wait for promise to resolve
    await new Promise(r => setTimeout(r, 5));
    const t0 = Date.now();
    const b = await q.tryTake(9, { timeoutMs: 1000 });
    expect(Date.now() - t0).toBeLessThan(50);
    expect(b?.beatId).toBe("b9");
  });

  it("supports interBeatOverrides storage", () => {
    const generate = vi.fn().mockResolvedValue(narrativeBeat("b1"));
    const q = new DirectorQueue({ generate });
    q.setInterBeatOverride(4, { trainerOverride: { levelDelta: 2 } });
    expect(q.takeInterBeatOverride(4)?.trainerOverride?.levelDelta).toBe(2);
    // Once taken, it's gone.
    expect(q.takeInterBeatOverride(4)).toBeUndefined();
  });

  it("cancel stops accepting new kickoffs and clears state", async () => {
    const generate = vi.fn().mockResolvedValue(narrativeBeat("b1"));
    const q = new DirectorQueue({ generate });
    q.kickOff(3);
    q.cancel();
    expect(await q.tryTake(3, { timeoutMs: 30 })).toBeNull();
  });
});
