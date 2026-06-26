/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Focused UNIT test of INVARIANT I2 for the LIVE hp cosmetic (#633, near-real-time replay):
// the REAL playCoopHpDrainCosmetic, called with commitHp=false (the live-sequencer path), leaves
// mon.hp BYTE-IDENTICAL before and after - it animates the bar DISPLAY-ONLY toward the host's hp,
// then restores the literal pre-call mon.hp in updateInfo().then BEFORE onDone. The end-of-turn
// CoopFinalizeTurnPhase checkpoint stays the sole durable writer.
//
// Pure unit test - NO GameManager / ER_SCENARIO. We mock #app/global-scene (getField / playSound /
// damageNumberHandler) and drive the REAL cosmetic against a minimal fake mon. The contrast case
// (commitHp=true, the batch path) is asserted to keep mon.hp == toHp (idempotent with the checkpoint,
// pre-redesign behavior).
//
// To avoid importing the heavy battle-anims chain (the cosmetic module's MoveAnim/CommonBattleAnim
// imports), #data/battle-anims is mocked - playCoopHpDrainCosmetic never constructs an anim anyway.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- The fake field the cosmetic resolves bi against (set per-test) -----------------------------
// NB: vi.mock factories are HOISTED above the module top-level, so the state the factory closes over
// MUST be created via vi.hoisted (a plain top-level `const`/`let` is in the TDZ when the factory runs).
type FakeMon = {
  hp: number;
  getMaxHp: () => number;
  updateInfo: () => Promise<void>;
} | null;

const h = vi.hoisted(() => ({
  field: [] as FakeMon[],
  playedSounds: [] as string[],
  damageNumbers: [] as { hp: number; amount: number }[],
}));
const { playedSounds, damageNumbers } = h;

vi.mock("#app/global-scene", () => ({
  globalScene: {
    getField: () => h.field,
    playSound: (key: string) => {
      h.playedSounds.push(key);
    },
    damageNumberHandler: {
      add: (mon: { hp: number }, amount: number) => {
        h.damageNumbers.push({ hp: mon.hp, amount });
      },
    },
    // Touched only by other cosmetics (moveAnimations gate); harmless to expose.
    moveAnimations: false,
  },
}));

// The hp cosmetic does not construct anims, but the module statically imports battle-anims; stub it
// so the import does not pull the full anim/data-lists chain into this lightweight unit test.
vi.mock("#data/battle-anims", () => ({
  MoveAnim: class {
    play() {}
  },
  CommonBattleAnim: class {
    play() {}
  },
}));

vi.mock("#data/elite-redux/coop/coop-debug", () => ({
  isCoopDebug: () => false,
  coopLog: () => {},
  coopWarn: () => {},
}));

// The SUT is loaded DYNAMICALLY in beforeEach after vi.resetModules(): under the suite's
// isolate:false a static import binds the REAL cosmetic to the already-cached (unmocked)
// #app/global-scene, stranding globalScene as undefined inside it. resetModules() + a fresh dynamic
// import rebinds it to the mock in this file.
let playCoopHpDrainCosmetic: typeof import("#phases/coop-replay-cosmetics").playCoopHpDrainCosmetic;

function makeMon(hp: number, maxHp = 100): NonNullable<FakeMon> {
  return {
    hp,
    getMaxHp: () => maxHp,
    // Resolve on a microtask, like the real updateInfo, so the .then restore runs before onDone.
    updateInfo: () => Promise.resolve(),
  };
}

afterEach(() => {
  h.field.length = 0;
  playedSounds.length = 0;
  damageNumbers.length = 0;
});

describe("co-op LIVE hp cosmetic (#633, I2) - mon.hp byte-identical after a presentation-only drain", () => {
  beforeEach(async () => {
    h.field.length = 0;
    vi.resetModules();
    ({ playCoopHpDrainCosmetic } = await import("#phases/coop-replay-cosmetics"));
  });

  it("commitHp=false: a damaging drain leaves mon.hp EXACTLY at its pre-call value", async () => {
    const mon = makeMon(100, 100);
    h.field = [mon];
    const preHp = mon.hp;

    await new Promise<void>(resolve => {
      // Host says this mon is now at 0 (a KO); fromHp 100 -> toHp 0, maxHp 100. LIVE path (commit=false).
      playCoopHpDrainCosmetic(0, 100, 0, 100, /* commitHp */ false, resolve);
    });

    // I2: byte-identical hp after the cosmetic - the checkpoint, not the cosmetic, is the durable writer.
    expect(mon.hp).toBe(preHp);
    expect(mon.hp).toBe(100);
    // The DISPLAY drain still happened (hit sound + damage number for the 100-point hit) - presentation ran.
    expect(playedSounds).toContain("se/hit");
    expect(damageNumbers).toEqual([{ hp: 100, amount: 100 }]);
  });

  it("commitHp=false: a partial drain (75 -> 30) also leaves mon.hp byte-identical", async () => {
    const mon = makeMon(75, 100);
    h.field = [mon];

    await new Promise<void>(resolve => {
      playCoopHpDrainCosmetic(0, 75, 30, 100, false, resolve);
    });

    expect(mon.hp).toBe(75); // unchanged after the cosmetic (I2)
    // The damage number is added while the bar is set to the PRE-hit value (fromHp=75), before the
    // drain to toHp; the amount shown is the 45-point delta (75 - 30).
    expect(damageNumbers).toEqual([{ hp: 75, amount: 45 }]);
  });

  it("commitHp=false: a CHAINED multi-hit drain restores to the literal pre-call hp, NOT the event fromHp", async () => {
    // The running display value for hit 2 is hit 1's toHp (a display-only chain value never written to
    // mon). The cosmetic must restore mon.hp to the LITERAL current mon.hp, never conflate it with fromHp.
    const mon = makeMon(100, 100);
    h.field = [mon];

    // Hit 1: 100 -> 60.
    await new Promise<void>(resolve => playCoopHpDrainCosmetic(0, 100, 60, 100, false, resolve));
    expect(mon.hp).toBe(100); // still pre-turn value

    // Hit 2: fromHp is the chained display value 60 (NOT mon.hp); toHp 25.
    await new Promise<void>(resolve => playCoopHpDrainCosmetic(0, 60, 25, 100, false, resolve));
    // Restored to the LITERAL current mon.hp (100), proving fromHp (60) was never used as the restore.
    expect(mon.hp).toBe(100);
  });

  it("commitHp=TRUE (batch path): mon.hp ends at toHp (idempotent with the checkpoint, pre-redesign behavior)", async () => {
    const mon = makeMon(100, 100);
    h.field = [mon];

    await new Promise<void>(resolve => {
      playCoopHpDrainCosmetic(0, 100, 40, 100, /* commitHp */ true, resolve);
    });

    // Batch path keeps the host's value durable - this is the contrast that proves commitHp gates the write.
    expect(mon.hp).toBe(40);
  });

  it("a missing mon (checkpoint already removed it) finishes without throwing or touching hp", async () => {
    h.field = [null];
    let resolved = false;
    await new Promise<void>(resolve => {
      playCoopHpDrainCosmetic(0, 100, 0, 100, false, () => {
        resolved = true;
        resolve();
      });
    });
    expect(resolved).toBe(true);
    expect(damageNumbers).toEqual([]); // no drain rendered for an absent mon
  });
});
