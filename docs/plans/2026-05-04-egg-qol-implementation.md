# Egg Quality-of-Life Pack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship three egg-system QoL features: (F1) raise the 99 carry cap to 10,000, (F2) per-row bulk-buy stepper in the gacha, (F3) auto-restock that refills the egg queue silently after each hatch wave.

**Architecture:** F1 is one new constant + 3 call-site swaps. F2 extends the existing `cursorToVoucher` switch with a multiplier and adds a stepper widget per voucher row in `egg-gacha-ui-handler.ts`. F3 adds a new save-data field on `GameData`, a private `autoRestockIfEnabled()` method called from the end of `EggLapsePhase.start()`, and a new `UiMode.AUTO_EGG_RESTOCK` settings panel reached from a 6th cursor row in the gacha.

**Tech Stack:** TypeScript, Phaser 3, vitest, biome, lefthook, i18next. PokéRogue uses pnpm.

**Reference design:** `docs/plans/2026-05-04-egg-qol-design.md`

**Branch:** `feat/egg-qol` (already created off `beta`)

**Test runner:** `pnpm test path/to/file.test.ts` for one file, `pnpm test:silent` for the suite.

**Lint:** `pnpm biome` auto-fixes most issues; `pnpm typecheck` for tsc.

**Pre-commit:** Lefthook runs biome on staged files. If a commit fails the hook, fix the underlying issue (don't `--no-verify`).

---

## Task 1 — Add `MAX_EGG_COUNT` constant (TDD)

**Files:**
- Modify: `src/data/egg.ts` (add new export near the top)
- Test: `test/tests/eggs/egg.test.ts` (append)

**Step 1.1: Write failing test**

Append at the bottom of `egg.test.ts`'s top-level `describe`:

```ts
it("MAX_EGG_COUNT is exported as 10000", async () => {
  const { MAX_EGG_COUNT } = await import("#data/egg");
  expect(MAX_EGG_COUNT).toBe(10_000);
});
```

**Step 1.2: Run — must fail**

```
pnpm test test/tests/eggs/egg.test.ts -t "MAX_EGG_COUNT"
```
Expected: FAIL — `MAX_EGG_COUNT` is undefined.

**Step 1.3: Implement**

Add to `src/data/egg.ts` (after the existing `EGG_SEED` export near line 41):

```ts
/** Maximum number of unhatched eggs the player can hold at once. */
export const MAX_EGG_COUNT = 10_000;
```

**Step 1.4: Run — must pass**

```
pnpm test test/tests/eggs/egg.test.ts -t "MAX_EGG_COUNT"
```
Expected: PASS.

**Step 1.5: Commit**

```
git add src/data/egg.ts test/tests/eggs/egg.test.ts
git commit -m "feat(egg): add MAX_EGG_COUNT constant (10,000)"
```

---

## Task 2 — Use `MAX_EGG_COUNT` at all 3 call sites

**Files:**
- Modify: `src/ui/handlers/egg-gacha-ui-handler.ts:743`
- Modify: `src/ui/handlers/pokedex-page-ui-handler.ts:2071`
- Modify: `src/ui/handlers/starter-select-ui-handler.ts:2340`
- Modify: `locales/en/egg.json` (`tooManyEggs`)

**Step 2.1: Update i18n**

In `locales/en/egg.json`, change:
```json
"tooManyEggs": "You have too many Eggs!",
```
to:
```json
"tooManyEggs": "You can hold at most {{max}} Eggs!",
```

**Step 2.2: Update gacha handler**

In `egg-gacha-ui-handler.ts`, at the top of the file, add to the `#data/egg` import: `MAX_EGG_COUNT`. At line 743, replace `99` with `MAX_EGG_COUNT`. At the `i18next.t(errorKey)` call (line ~750), pass `{ max: MAX_EGG_COUNT }` so the message interpolates.

**Step 2.3: Update pokedex handler**

In `pokedex-page-ui-handler.ts`, import `MAX_EGG_COUNT` from `#data/egg`. Replace `>= 99` at line 2071 with `>= MAX_EGG_COUNT`.

**Step 2.4: Update starter-select handler**

Same change in `starter-select-ui-handler.ts:2340`.

**Step 2.5: Verify other locales**

Run:
```
grep -l "tooManyEggs" locales/*/egg.json
```
For each non-English locale, leave existing translation but ensure no breaking change (i18next falls back to English when `{{max}}` is missing). No edits needed in v1; add a note in the commit message.

**Step 2.6: Lint + typecheck**

```
pnpm biome
pnpm typecheck
```
Both must succeed.

**Step 2.7: Manual sanity**

Start dev server (`pnpm start:dev`), open localhost:8000, go to gacha. The cap-exceeded message should now read "You can hold at most 10000 Eggs!" — confirm by importing a save with many eggs or temporarily lowering `MAX_EGG_COUNT` to 5 to trigger.

**Step 2.8: Commit**

```
git add -p
git commit -m "feat(egg): use MAX_EGG_COUNT at all cap call sites; raise cap to 10,000"
```

---

## Task 3 — Extend `cursorToVoucher` with multiplier (TDD)

**Files:**
- Modify: `src/ui/handlers/egg-gacha-ui-handler.ts` (the `cursorToVoucher` static method, ~line 702)
- Test: `test/tests/eggs/egg-gacha-ui-handler.test.ts` (NEW)

**Step 3.1: Create test file**

```ts
import { describe, expect, it } from "vitest";
import { EggGachaUiHandler } from "#ui/handlers/egg-gacha-ui-handler";
import { VoucherType } from "#system/voucher";

// Access the private static via cast for testing
const cursorToVoucher = (EggGachaUiHandler as any).cursorToVoucher as (
  cursor: number,
  multiplier?: number,
) => [VoucherType, number, number] | undefined;

describe("EggGachaUiHandler.cursorToVoucher", () => {
  it("default multiplier of 1 preserves legacy behavior", () => {
    expect(cursorToVoucher(0)).toEqual([VoucherType.REGULAR, 1, 1]);
    expect(cursorToVoucher(1)).toEqual([VoucherType.REGULAR, 10, 10]);
    expect(cursorToVoucher(4)).toEqual([VoucherType.GOLDEN, 1, 25]);
  });
  it("multiplier scales both vouchers consumed and pulls", () => {
    expect(cursorToVoucher(0, 5)).toEqual([VoucherType.REGULAR, 5, 5]);
    expect(cursorToVoucher(4, 100)).toEqual([VoucherType.GOLDEN, 100, 2500]);
    expect(cursorToVoucher(2, 10)).toEqual([VoucherType.PLUS, 10, 50]);
  });
  it("returns undefined for out-of-range cursor", () => {
    expect(cursorToVoucher(5)).toBeUndefined();
    expect(cursorToVoucher(-1)).toBeUndefined();
  });
});
```

**Step 3.2: Run — must fail**

```
pnpm test test/tests/eggs/egg-gacha-ui-handler.test.ts
```
Expected: FAIL on the multiplier cases (current method ignores second arg).

**Step 3.3: Implement**

Replace the existing `cursorToVoucher` (egg-gacha-ui-handler.ts ~line 702) with:

```ts
/**
 * Convert a cursor index + multiplier to a voucher type and counts.
 * @param cursor - The cursor index (0-4)
 * @param multiplier - How many times to apply the row's base cost (default 1)
 */
private static cursorToVoucher(
  cursor: number,
  multiplier = 1,
): [VoucherType, number, number] | undefined {
  const base = ((): [VoucherType, number, number] | undefined => {
    switch (cursor) {
      case 0: return [VoucherType.REGULAR, 1, 1];
      case 1: return [VoucherType.REGULAR, 10, 10];
      case 2: return [VoucherType.PLUS, 1, 5];
      case 3: return [VoucherType.PREMIUM, 1, 10];
      case 4: return [VoucherType.GOLDEN, 1, 25];
    }
  })();
  if (!base) return undefined;
  return [base[0], base[1] * multiplier, base[2] * multiplier];
}
```

**Step 3.4: Run — must pass**

```
pnpm test test/tests/eggs/egg-gacha-ui-handler.test.ts
```
Expected: all 3 tests PASS.

**Step 3.5: Commit**

```
git add src/ui/handlers/egg-gacha-ui-handler.ts test/tests/eggs/egg-gacha-ui-handler.test.ts
git commit -m "feat(egg-gacha): cursorToVoucher accepts a quantity multiplier"
```

---

## Task 4 — Add per-row multiplier state and step cycling (TDD pure)

**Files:**
- Modify: `src/ui/handlers/egg-gacha-ui-handler.ts`
- Test: `test/tests/eggs/egg-gacha-ui-handler.test.ts` (append)

**Step 4.1: Append failing tests**

```ts
import { cycleMultiplier, MULTIPLIER_STEPS, resolveMaxMultiplier } from "#ui/handlers/egg-gacha-ui-handler";

describe("multiplier stepping", () => {
  it("MULTIPLIER_STEPS exposes the canonical sequence", () => {
    expect(MULTIPLIER_STEPS).toEqual([1, 5, 10, 25, 50, 100, "MAX"]);
  });
  it("cycleMultiplier(+1) advances; clamps at MAX", () => {
    expect(cycleMultiplier(1, +1)).toBe(5);
    expect(cycleMultiplier(100, +1)).toBe("MAX");
    expect(cycleMultiplier("MAX", +1)).toBe("MAX");
  });
  it("cycleMultiplier(-1) retreats; clamps at 1", () => {
    expect(cycleMultiplier(5, -1)).toBe(1);
    expect(cycleMultiplier(1, -1)).toBe(1);
    expect(cycleMultiplier("MAX", -1)).toBe(100);
  });
  it("resolveMaxMultiplier respects vouchers held and remaining cap", () => {
    // 200 GOLDEN vouchers held, 0 eggs already, cap 10000 → 25 pulls each → max 200 (vouchers)
    expect(resolveMaxMultiplier({ vouchersPerStep: 1, pullsPerStep: 25, vouchersHeld: 200, eggsHeld: 0, maxEggs: 10_000 })).toBe(200);
    // 5 eggs already, cap 10 → 5 slots / 5 pulls each → max 1
    expect(resolveMaxMultiplier({ vouchersPerStep: 1, pullsPerStep: 5, vouchersHeld: 99, eggsHeld: 5, maxEggs: 10 })).toBe(1);
    // No room → 0
    expect(resolveMaxMultiplier({ vouchersPerStep: 1, pullsPerStep: 1, vouchersHeld: 99, eggsHeld: 10, maxEggs: 10 })).toBe(0);
  });
});
```

**Step 4.2: Run — must fail**

Expected: imports fail because `cycleMultiplier`, `MULTIPLIER_STEPS`, `resolveMaxMultiplier` don't exist.

**Step 4.3: Implement helpers**

In `egg-gacha-ui-handler.ts`, before the class declaration, export:

```ts
export const MULTIPLIER_STEPS = [1, 5, 10, 25, 50, 100, "MAX"] as const;
export type MultiplierStep = (typeof MULTIPLIER_STEPS)[number];

export function cycleMultiplier(current: MultiplierStep, direction: 1 | -1): MultiplierStep {
  const idx = MULTIPLIER_STEPS.indexOf(current);
  const next = Math.min(MULTIPLIER_STEPS.length - 1, Math.max(0, idx + direction));
  return MULTIPLIER_STEPS[next];
}

export function resolveMaxMultiplier(p: {
  vouchersPerStep: number;
  pullsPerStep: number;
  vouchersHeld: number;
  eggsHeld: number;
  maxEggs: number;
}): number {
  const byVouchers = Math.floor(p.vouchersHeld / p.vouchersPerStep);
  const remainingEggSlots = Math.max(0, p.maxEggs - p.eggsHeld);
  const byEggSpace = Math.floor(remainingEggSlots / p.pullsPerStep);
  return Math.max(0, Math.min(byVouchers, byEggSpace));
}
```

**Step 4.4: Add per-row state field on the handler**

Inside `EggGachaUiHandler`, near `gachaCursor: number;`, add:

```ts
private voucherMultipliers: MultiplierStep[] = [1, 1, 1, 1, 1];
```

**Step 4.5: Run — must pass**

```
pnpm test test/tests/eggs/egg-gacha-ui-handler.test.ts
```
Expected: all stepping tests PASS.

**Step 4.6: Commit**

```
git add src/ui/handlers/egg-gacha-ui-handler.ts test/tests/eggs/egg-gacha-ui-handler.test.ts
git commit -m "feat(egg-gacha): add multiplier step + max-resolver pure helpers"
```

---

## Task 5 — Render multiplier text on each voucher row

**Files:**
- Modify: `src/ui/handlers/egg-gacha-ui-handler.ts`
- Modify: `locales/en/egg.json`

**Step 5.1: Add i18n keys**

Add to `locales/en/egg.json`:

```json
"bulkMultiplier": "×{{n}}",
"bulkMax": "MAX",
"bulkHint": "←/→ to scrub quantity"
```

**Step 5.2: Add multiplier label per voucher row**

In `egg-gacha-ui-handler.ts`, find the section in `setup()` that creates the 5 voucher option rows (search for the loop that produces `voucherCountLabels`). Adjacent to each voucher row, add a small text element rendered via `addTextObject(x, y, this.formatMultiplier(this.voucherMultipliers[i]), TextStyle.WINDOW_ALT)` placed to the right of the voucher icon. Store these in a new `private voucherMultiplierLabels: Phaser.GameObjects.Text[] = [];`.

Helper:
```ts
private formatMultiplier(m: MultiplierStep): string {
  return m === "MAX" ? i18next.t("egg:bulkMax") : i18next.t("egg:bulkMultiplier", { n: m });
}
```

**Step 5.3: Wire label refresh**

Add:
```ts
private refreshMultiplierLabel(rowIndex: number): void {
  this.voucherMultiplierLabels[rowIndex]?.setText(this.formatMultiplier(this.voucherMultipliers[rowIndex]));
}
```
Call once for each row at the end of `setup()`.

**Step 5.4: Visual smoke check**

`pnpm start:dev`, open gacha, confirm each row shows `×1` next to the voucher icon. Style should match existing labels — same font, same window-alt color. Adjust X/Y offsets if cramped.

**Step 5.5: Lint + commit**

```
pnpm biome
git add src/ui/handlers/egg-gacha-ui-handler.ts locales/en/egg.json
git commit -m "feat(egg-gacha): render per-row quantity multiplier label"
```

---

## Task 6 — Wire LEFT/RIGHT input to cycle multipliers + use them in pull

**Files:**
- Modify: `src/ui/handlers/egg-gacha-ui-handler.ts`

**Step 6.1: Intercept LEFT/RIGHT in voucher menu**

Find the input handler for the voucher menu (search for `handleVoucherSelectAction` and the surrounding `processInput`/menu navigation block). When the cursor is on a voucher row (0–4) and `Button.LEFT` or `Button.RIGHT` arrives, call:

```ts
const dir = button === Button.RIGHT ? 1 : -1;
this.voucherMultipliers[cursor] = cycleMultiplier(this.voucherMultipliers[cursor], dir);
this.refreshMultiplierLabel(cursor);
ui.playSelect(); // matches PokéRogue's existing nav SFX convention
return true;
```

Make sure existing UP/DOWN navigation still works (don't swallow those).

**Step 6.2: Resolve multiplier at pull time**

Inside `handleVoucherSelectAction(cursor)`, before calling `cursorToVoucher`:

```ts
const rawMult = this.voucherMultipliers[cursor];
const base = EggGachaUiHandler.cursorToVoucher(cursor, 1);
if (!base) { ui.revertMode(); return true; }
const [type, baseVouchers, basePulls] = base;
const heldVouchers = globalScene.gameData.voucherCounts[type];
const heldEggs = globalScene.gameData.eggs.length;
const resolvedMult = rawMult === "MAX"
  ? resolveMaxMultiplier({
      vouchersPerStep: baseVouchers,
      pullsPerStep: basePulls,
      vouchersHeld: heldVouchers,
      eggsHeld: heldEggs,
      maxEggs: MAX_EGG_COUNT,
    })
  : rawMult;
if (resolvedMult < 1) {
  this.showError(i18next.t("egg:vouchersExceedEggCap"));
  return false;
}
const voucher = EggGachaUiHandler.cursorToVoucher(cursor, resolvedMult);
```

Then continue with the existing flow using `voucher`.

**Step 6.3: Manual smoke test**

`pnpm start:dev`. Scrub a voucher row left/right — multiplier label should cycle through `×1, ×5, ×10, ×25, ×50, ×100, MAX`. Press ACTION on `×5` of regular vouchers; 5 vouchers should be consumed, 5 eggs added (assuming cap allows). Press ACTION on `MAX`: should pull as many as vouchers/cap allow.

**Step 6.4: Commit**

```
git add src/ui/handlers/egg-gacha-ui-handler.ts
git commit -m "feat(egg-gacha): bulk-buy stepper input + max resolution at pull"
```

---

## Task 7 — Define `AutoEggRestockSettings` type + defaults (TDD)

**Files:**
- Create: `src/system/auto-egg-restock-settings.ts` (NEW)
- Test: `test/tests/eggs/auto-egg-restock-settings.test.ts` (NEW)

**Step 7.1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { defaultAutoEggRestockSettings, mergeAutoEggRestockSettings } from "#system/auto-egg-restock-settings";
import { VoucherType } from "#system/voucher";
import { GachaType } from "#enums/gacha-types";

describe("AutoEggRestockSettings", () => {
  it("default settings are opt-in and conservative", () => {
    const d = defaultAutoEggRestockSettings();
    expect(d.enabled).toBe(false);
    expect(d.targetCount).toBe(50);
    expect(d.gachaType).toBe(GachaType.LEGENDARY);
    expect(d.perVoucher[VoucherType.REGULAR]).toBe(true);
    expect(d.perVoucher[VoucherType.PLUS]).toBe(true);
    expect(d.perVoucher[VoucherType.PREMIUM]).toBe(true);
    expect(d.perVoucher[VoucherType.GOLDEN]).toBe(false);
  });
  it("merge fills missing fields from defaults", () => {
    const merged = mergeAutoEggRestockSettings({ enabled: true } as any);
    expect(merged.enabled).toBe(true);
    expect(merged.targetCount).toBe(50);
    expect(merged.perVoucher[VoucherType.GOLDEN]).toBe(false);
  });
  it("merge clamps targetCount to [0, 10000]", () => {
    expect(mergeAutoEggRestockSettings({ targetCount: -5 } as any).targetCount).toBe(0);
    expect(mergeAutoEggRestockSettings({ targetCount: 99_999 } as any).targetCount).toBe(10_000);
  });
});
```

**Step 7.2: Run — must fail**

```
pnpm test test/tests/eggs/auto-egg-restock-settings.test.ts
```

**Step 7.3: Implement**

`src/system/auto-egg-restock-settings.ts`:

```ts
import { MAX_EGG_COUNT } from "#data/egg";
import { GachaType } from "#enums/gacha-types";
import { VoucherType } from "#system/voucher";

export interface AutoEggRestockSettings {
  enabled: boolean;
  targetCount: number;
  gachaType: GachaType;
  perVoucher: Record<VoucherType, boolean>;
}

export function defaultAutoEggRestockSettings(): AutoEggRestockSettings {
  return {
    enabled: false,
    targetCount: 50,
    gachaType: GachaType.LEGENDARY,
    perVoucher: {
      [VoucherType.REGULAR]: true,
      [VoucherType.PLUS]: true,
      [VoucherType.PREMIUM]: true,
      [VoucherType.GOLDEN]: false,
    },
  };
}

export function mergeAutoEggRestockSettings(
  partial: Partial<AutoEggRestockSettings> | undefined,
): AutoEggRestockSettings {
  const d = defaultAutoEggRestockSettings();
  if (!partial) return d;
  return {
    enabled: partial.enabled ?? d.enabled,
    targetCount: Math.max(0, Math.min(MAX_EGG_COUNT, partial.targetCount ?? d.targetCount)),
    gachaType: partial.gachaType ?? d.gachaType,
    perVoucher: { ...d.perVoucher, ...(partial.perVoucher ?? {}) },
  };
}
```

**Step 7.4: Run — must pass**

**Step 7.5: Commit**

```
git add src/system/auto-egg-restock-settings.ts test/tests/eggs/auto-egg-restock-settings.test.ts
git commit -m "feat(egg): AutoEggRestockSettings type + defaults + clamp"
```

---

## Task 8 — Persist settings on `GameData` (round-trip test)

**Files:**
- Modify: `src/system/game-data.ts`
- Test: `test/tests/eggs/auto-egg-restock-save.test.ts` (NEW)

**Step 8.1: Write failing test**

```ts
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import Phaser from "phaser";
import { GameManager } from "#test/framework/game-manager";
import { VoucherType } from "#system/voucher";

describe("autoEggRestock save round-trip", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => { phaserGame = new Phaser.Game({ type: Phaser.HEADLESS }); game = new GameManager(phaserGame); });
  beforeEach(async () => { await game.importData("./test/utils/saves/everything.prsv"); });

  it("starts with default settings", () => {
    expect(game.scene.gameData.autoEggRestock.enabled).toBe(false);
    expect(game.scene.gameData.autoEggRestock.targetCount).toBe(50);
  });

  it("persists changed settings through getSystemSaveData/loadSystemSaveData", () => {
    game.scene.gameData.autoEggRestock.enabled = true;
    game.scene.gameData.autoEggRestock.targetCount = 200;
    game.scene.gameData.autoEggRestock.perVoucher[VoucherType.GOLDEN] = true;

    const saved = game.scene.gameData.getSystemSaveData();
    const fresh = game.scene.gameData;
    fresh.autoEggRestock = undefined as any; // simulate older save
    fresh.loadSystemSaveData(saved);

    expect(fresh.autoEggRestock.enabled).toBe(true);
    expect(fresh.autoEggRestock.targetCount).toBe(200);
    expect(fresh.autoEggRestock.perVoucher[VoucherType.GOLDEN]).toBe(true);
  });

  it("loads pre-feature save with defaults", () => {
    const saved = game.scene.gameData.getSystemSaveData();
    delete (saved as any).autoEggRestock;
    game.scene.gameData.loadSystemSaveData(saved);
    expect(game.scene.gameData.autoEggRestock.enabled).toBe(false);
    expect(game.scene.gameData.autoEggRestock.targetCount).toBe(50);
  });
});
```

**Step 8.2: Run — must fail (field doesn't exist)**

**Step 8.3: Implement on `GameData`**

In `src/system/game-data.ts`:

1. Import:
```ts
import {
  type AutoEggRestockSettings,
  defaultAutoEggRestockSettings,
  mergeAutoEggRestockSettings,
} from "#system/auto-egg-restock-settings";
```

2. Add field (near `eggs: Egg[]` ~line 146):
```ts
public autoEggRestock: AutoEggRestockSettings = defaultAutoEggRestockSettings();
```

3. Initialize in constructor (where `eggs = []` is set ~line 175):
```ts
this.autoEggRestock = defaultAutoEggRestockSettings();
```

4. Serialize in `getSystemSaveData()` (~line 199): add the field to the returned object.

5. Deserialize in `loadSystemSaveData()` (~line 373):
```ts
this.autoEggRestock = mergeAutoEggRestockSettings(systemData.autoEggRestock);
```

6. Update the `SystemSaveData` type interface to include `autoEggRestock?: AutoEggRestockSettings;` (optional for back-compat).

**Step 8.4: Run — must pass**

**Step 8.5: Commit**

```
git add src/system/game-data.ts test/tests/eggs/auto-egg-restock-save.test.ts
git commit -m "feat(egg): persist autoEggRestock settings in system save data"
```

---

## Task 9 — Pure auto-restock loop (TDD)

**Files:**
- Create: `src/system/auto-egg-restock.ts` (NEW — pure logic, no Phaser deps)
- Test: `test/tests/eggs/auto-egg-restock.test.ts` (NEW)

**Step 9.1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { planAutoRestock } from "#system/auto-egg-restock";
import { defaultAutoEggRestockSettings } from "#system/auto-egg-restock-settings";
import { VoucherType } from "#system/voucher";

const baseSettings = (overrides: any = {}) => ({ ...defaultAutoEggRestockSettings(), enabled: true, ...overrides });

describe("planAutoRestock", () => {
  it("disabled → no plan", () => {
    const plan = planAutoRestock({
      settings: { ...defaultAutoEggRestockSettings() },
      eggsHeld: 0,
      voucherCounts: { [VoucherType.REGULAR]: 100, [VoucherType.PLUS]: 0, [VoucherType.PREMIUM]: 0, [VoucherType.GOLDEN]: 0 },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([]);
  });

  it("eggs already at target → no plan", () => {
    const plan = planAutoRestock({
      settings: baseSettings({ targetCount: 50 }),
      eggsHeld: 50,
      voucherCounts: { [VoucherType.REGULAR]: 100, [VoucherType.PLUS]: 0, [VoucherType.PREMIUM]: 0, [VoucherType.GOLDEN]: 0 },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([]);
  });

  it("spends cheapest enabled voucher first; stops at target", () => {
    // target=10, eggsHeld=0 → need 10 pulls. Regular gives 1 pull each. Should buy 10 REGULAR.
    const plan = planAutoRestock({
      settings: baseSettings({ targetCount: 10 }),
      eggsHeld: 0,
      voucherCounts: { [VoucherType.REGULAR]: 100, [VoucherType.PLUS]: 100, [VoucherType.PREMIUM]: 100, [VoucherType.GOLDEN]: 100 },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([{ voucherType: VoucherType.REGULAR, vouchers: 10, pulls: 10 }]);
  });

  it("rolls over to next-cheapest when one drains", () => {
    // 3 REGULAR (=3 pulls), then PLUS @ 5 pulls each. Target 10. Result: 3 reg + 2 plus (5 each = 10 pulls? no = 13 pulls). Cap shouldn't overshoot beyond available pulls — partial spend.
    const plan = planAutoRestock({
      settings: baseSettings({ targetCount: 10 }),
      eggsHeld: 0,
      voucherCounts: { [VoucherType.REGULAR]: 3, [VoucherType.PLUS]: 5, [VoucherType.PREMIUM]: 0, [VoucherType.GOLDEN]: 0 },
      maxEggs: 10_000,
    });
    // 3 REGULAR → 3 pulls. Need 7 more. PLUS gives 5 pulls each. 1 PLUS → 8 total. 1 more PLUS → 13 total which OVERSHOOTS target. Behavior: stop before overshooting.
    expect(plan.purchases).toEqual([
      { voucherType: VoucherType.REGULAR, vouchers: 3, pulls: 3 },
      { voucherType: VoucherType.PLUS, vouchers: 1, pulls: 5 },
    ]);
    expect(plan.eggsAfter).toBe(8);
  });

  it("skips disabled voucher type", () => {
    const settings = baseSettings({ targetCount: 50 });
    settings.perVoucher[VoucherType.REGULAR] = false;
    const plan = planAutoRestock({
      settings,
      eggsHeld: 0,
      voucherCounts: { [VoucherType.REGULAR]: 999, [VoucherType.PLUS]: 1, [VoucherType.PREMIUM]: 0, [VoucherType.GOLDEN]: 0 },
      maxEggs: 10_000,
    });
    expect(plan.purchases).toEqual([{ voucherType: VoucherType.PLUS, vouchers: 1, pulls: 5 }]);
  });

  it("respects maxEggs cap", () => {
    const plan = planAutoRestock({
      settings: baseSettings({ targetCount: 100 }),
      eggsHeld: 95,
      voucherCounts: { [VoucherType.REGULAR]: 999, [VoucherType.PLUS]: 0, [VoucherType.PREMIUM]: 0, [VoucherType.GOLDEN]: 0 },
      maxEggs: 100,
    });
    expect(plan.purchases).toEqual([{ voucherType: VoucherType.REGULAR, vouchers: 5, pulls: 5 }]);
  });
});
```

**Step 9.2: Run — must fail**

**Step 9.3: Implement**

`src/system/auto-egg-restock.ts`:

```ts
import { VoucherType } from "#system/voucher";
import type { AutoEggRestockSettings } from "#system/auto-egg-restock-settings";

const PULLS_PER_VOUCHER: Record<VoucherType, number> = {
  [VoucherType.REGULAR]: 1,
  [VoucherType.PLUS]: 5,
  [VoucherType.PREMIUM]: 10,
  [VoucherType.GOLDEN]: 25,
};
const VOUCHER_PRIORITY: VoucherType[] = [
  VoucherType.REGULAR,
  VoucherType.PLUS,
  VoucherType.PREMIUM,
  VoucherType.GOLDEN,
];

export interface AutoRestockInput {
  settings: AutoEggRestockSettings;
  eggsHeld: number;
  voucherCounts: Record<VoucherType, number>;
  maxEggs: number;
}
export interface AutoRestockPurchase {
  voucherType: VoucherType;
  vouchers: number;
  pulls: number;
}
export interface AutoRestockPlan {
  purchases: AutoRestockPurchase[];
  eggsAfter: number;
}

export function planAutoRestock(input: AutoRestockInput): AutoRestockPlan {
  const { settings, eggsHeld, voucherCounts, maxEggs } = input;
  const purchases: AutoRestockPurchase[] = [];
  let eggs = eggsHeld;

  if (!settings.enabled) return { purchases, eggsAfter: eggs };
  const target = Math.min(settings.targetCount, maxEggs);
  if (eggs >= target) return { purchases, eggsAfter: eggs };

  const remainingVouchers = { ...voucherCounts };
  for (const v of VOUCHER_PRIORITY) {
    if (!settings.perVoucher[v]) continue;
    while (eggs < target && remainingVouchers[v] > 0) {
      const pulls = PULLS_PER_VOUCHER[v];
      if (eggs + pulls > target) break;          // don't overshoot the user's target
      if (eggs + pulls > maxEggs) break;          // don't overshoot the hard cap
      eggs += pulls;
      remainingVouchers[v] -= 1;
      const last = purchases[purchases.length - 1];
      if (last && last.voucherType === v) {
        last.vouchers += 1;
        last.pulls += pulls;
      } else {
        purchases.push({ voucherType: v, vouchers: 1, pulls });
      }
    }
  }
  return { purchases, eggsAfter: eggs };
}
```

**Step 9.4: Run — must pass all 6 cases**

**Step 9.5: Commit**

```
git add src/system/auto-egg-restock.ts test/tests/eggs/auto-egg-restock.test.ts
git commit -m "feat(egg): pure auto-restock planner (priority order, cap-aware)"
```

---

## Task 10 — Hook auto-restock into `EggLapsePhase`

**Files:**
- Modify: `src/phases/egg-lapse-phase.ts`
- Test: `test/tests/eggs/auto-restock-phase.test.ts` (NEW)

**Step 10.1: Write integration test**

Use the `GameManager` framework to fire an `EggLapsePhase` with a configured save:
- pre: 0 eggs, target=10, REGULAR enabled, 100 REGULAR vouchers held
- run phase
- post: 10 eggs in queue, voucher count = 90

(Reference `egg.test.ts` and other phase tests for the exact `game.runToTitle()` + `game.scene.phaseManager.unshiftNew("EggLapsePhase")` patterns. If the existing helper for phase invocation isn't obvious, use a simpler unit-level test that calls a private method via `(phase as any).autoRestockIfEnabled()`.)

**Step 10.2: Run — must fail**

**Step 10.3: Implement**

In `src/phases/egg-lapse-phase.ts`, add a new private method and call it at the end of `start()`:

```ts
private autoRestockIfEnabled(): void {
  const gd = globalScene.gameData;
  const plan = planAutoRestock({
    settings: gd.autoEggRestock,
    eggsHeld: gd.eggs.length,
    voucherCounts: gd.voucherCounts,
    maxEggs: MAX_EGG_COUNT,
  });
  if (!plan.purchases.length) return;
  const breakdown: string[] = [];
  for (const purchase of plan.purchases) {
    gd.voucherCounts[purchase.voucherType] -= purchase.vouchers;
    for (let i = 0; i < purchase.pulls; i++) {
      const egg = new Egg({
        scene: globalScene,
        sourceType: gachaSourceTypeFor(gd.autoEggRestock.gachaType),
        pulled: true,
      });
      egg.addToGame();
    }
    breakdown.push(`${purchase.pulls}× from ${VoucherType[purchase.voucherType]}`);
  }
  globalScene.phaseManager.queueMessage(
    i18next.t("egg:autoRestocked", { count: plan.purchases.reduce((s, p) => s + p.pulls, 0), breakdown: breakdown.join(", ") }),
  );
}
```

Where `gachaSourceTypeFor(GachaType)` is a small helper mapping `MOVE → EggSourceType.GACHA_MOVE`, `LEGENDARY → EggSourceType.GACHA_LEGENDARY`, `SHINY → EggSourceType.GACHA_SHINY` (verify exact enum names in `src/enums/egg-source-types.ts`).

Insert call site: in `start()`, in **all three** branches (skip-prompt-yes path's `showSummary`, skip-prompt-no path before `this.end()`, and the no-prompt branch before `this.end()`). Or simpler: extract a private `finish()` method that calls `autoRestockIfEnabled()` then either `showSummary()` or `this.end()` and route every branch through it.

**Step 10.4: Add i18n key**

`locales/en/egg.json`:
```json
"autoRestocked": "Auto-restocked {{count}} Eggs ({{breakdown}})."
```

**Step 10.5: Run — must pass**

**Step 10.6: Commit**

```
git add src/phases/egg-lapse-phase.ts locales/en/egg.json test/tests/eggs/auto-restock-phase.test.ts
git commit -m "feat(egg): EggLapsePhase silently auto-restocks queue when enabled"
```

---

## Task 11 — Add `UiMode.AUTO_EGG_RESTOCK` + handler skeleton

**Files:**
- Modify: `src/enums/ui-mode.ts`
- Create: `src/ui/handlers/auto-egg-restock-ui-handler.ts` (NEW)
- Modify: `src/ui/ui.ts` (or wherever handlers are registered — search for `EggGachaUiHandler`'s registration to find the spot)

**Step 11.1: Add enum entry**

In `src/enums/ui-mode.ts`, add `AUTO_EGG_RESTOCK` to the enum (next to `EGG_GACHA`).

**Step 11.2: Create handler skeleton**

`src/ui/handlers/auto-egg-restock-ui-handler.ts`:

```ts
import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

export class AutoEggRestockUiHandler extends MessageUiHandler {
  private container: Phaser.GameObjects.Container;
  // TODO row controls populated in setup()

  constructor() {
    super(UiMode.AUTO_EGG_RESTOCK);
  }

  setup(): void {
    this.container = globalScene.add.container(0, 0);
    this.container.setVisible(false);
    const bg = addWindow(0, 0, 220, 180);
    this.container.add(bg);
    this.container.add(addTextObject(8, 4, i18next.t("egg:autoRestockTitle"), TextStyle.WINDOW));
    globalScene.uiContainer.add(this.container);
  }

  show(_args: any[]): boolean {
    super.show(_args);
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, globalScene.uiContainer.getAll().length - 1);
    return true;
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
  }

  processInput(button: Button): boolean {
    if (button === Button.CANCEL) {
      this.getUi().revertMode();
      return true;
    }
    return false;
  }
}
```

**Step 11.3: Register handler**

In `src/ui/ui.ts` (or wherever `EggGachaUiHandler` is added to the handlers map), add `AutoEggRestockUiHandler` for `UiMode.AUTO_EGG_RESTOCK`.

**Step 11.4: Add i18n title**

`locales/en/egg.json`:
```json
"autoRestockTitle": "Auto Restock"
```

**Step 11.5: Typecheck + lint**

```
pnpm typecheck && pnpm biome
```

**Step 11.6: Commit**

```
git add src/enums/ui-mode.ts src/ui/handlers/auto-egg-restock-ui-handler.ts src/ui/ui.ts locales/en/egg.json
git commit -m "feat(egg): scaffold AutoEggRestockUiHandler (empty panel, cancel only)"
```

---

## Task 12 — Build the auto-restock panel rows

**Files:**
- Modify: `src/ui/handlers/auto-egg-restock-ui-handler.ts`
- Modify: `locales/en/egg.json`

**Step 12.1: Add i18n keys**

```json
"autoRestockStatus": "Status",
"autoRestockOn": "ON",
"autoRestockOff": "OFF",
"autoRestockTarget": "Target",
"autoRestockMachine": "Machine",
"autoRestockSave": "Save",
"autoRestockCancel": "Cancel",
"voucherRegular": "Regular",
"voucherPlus": "Plus",
"voucherPremium": "Premium",
"voucherGolden": "Golden"
```

**Step 12.2: Implement rows**

Inside the handler, add a `private working: AutoEggRestockSettings` (a deep-copy of `globalScene.gameData.autoEggRestock` snapshotted in `show()`). Render rows top-down in the container:

1. Status row — left/right toggles `working.enabled` between true/false; shows `ON`/`OFF`.
2. Target row — left/right cycles through `[10, 25, 50, 100, 250, 500, 1000, MAX]` (where MAX = `MAX_EGG_COUNT`).
3. Machine row — left/right cycles `[GachaType.MOVE, GachaType.LEGENDARY, GachaType.SHINY]`; label uses existing keys `egg:gachaTypeMove/Legendary/Shiny`.
4. 4× voucher checkbox rows — ACTION toggles `working.perVoucher[v]`. Render `[ ]`/`[✓]` prefix.
5. Save / Cancel row — two side-by-side buttons. Save writes `working` back into `globalScene.gameData.autoEggRestock` and reverts mode. Cancel discards and reverts.

Cursor state: integer index 0–8 (status, target, machine, 4 vouchers, save, cancel). Up/Down moves cursor; Left/Right and Action behave per row above.

**Step 12.3: Cursor highlight**

Use the same `cursorObj: Phaser.GameObjects.Image` pattern that `egg-gacha-ui-handler.ts` uses (the `cursor.png` arrow asset) for visual continuity.

**Step 12.4: Manual smoke**

`pnpm start:dev`. Open the panel (until task 13 wires the entry, you'll need to invoke it manually via `globalScene.ui.setMode(UiMode.AUTO_EGG_RESTOCK, [])` from the dev console). Confirm: navigation works; toggling persists in `working`; Save writes, Cancel discards.

**Step 12.5: Lint + commit**

```
pnpm biome
git add src/ui/handlers/auto-egg-restock-ui-handler.ts locales/en/egg.json
git commit -m "feat(egg): auto-restock panel rows (status/target/machine/vouchers/save)"
```

---

## Task 13 — Wire 6th cursor row in gacha to open the panel

**Files:**
- Modify: `src/ui/handlers/egg-gacha-ui-handler.ts`
- Modify: `locales/en/egg.json`

**Step 13.1: Add i18n key**

```json
"autoRestockEntry": "Auto Restock..."
```

**Step 13.2: Add 6th cursor row**

In `egg-gacha-ui-handler.ts`'s setup of voucher rows, after the 5 existing rows, add a new entry rendered with the same row style. No multiplier label on this row. Update the cursor max from `5` to `6` (the existing bound check at `cursor < 0 || cursor > 5` becomes `> 6`).

**Step 13.3: Handle ACTION on row 5 (the 6th cursor)**

In `handleVoucherSelectAction`, before the existing `cursorToVoucher` path, branch:

```ts
if (cursor === 5) {
  ui.setOverlayMode(UiMode.AUTO_EGG_RESTOCK);
  return true;
}
```

Confirm `setOverlayMode` is the right call vs. `setMode` — search the codebase for how settings menus are opened (`UiMode.SETTINGS`).

**Step 13.4: Manual end-to-end**

Start dev server. Title screen → gacha → scroll to "Auto Restock..." → ACTION → panel opens. Configure: enabled=ON, target=20, REGULAR only. Save. Begin a run, win a wave (or use `EGG_IMMEDIATE_HATCH_OVERRIDE`). After the hatch, eggs queue should auto-fill back to 20 from regular vouchers. Toast appears.

**Step 13.5: Commit**

```
git add src/ui/handlers/egg-gacha-ui-handler.ts locales/en/egg.json
git commit -m "feat(egg-gacha): 6th cursor row opens auto-restock panel"
```

---

## Task 14 — Final pass: full test suite, typecheck, manual save round-trip

**Step 14.1: Suite**

```
pnpm test:silent
pnpm typecheck
pnpm biome:all
```

All must pass. If anything fails, root-cause and fix; don't `--no-verify`.

**Step 14.2: Save round-trip in browser**

Start dev server. Configure auto-restock; save the game; close tab; reopen; verify settings persisted and panel reflects them.

**Step 14.3: Backwards compatibility**

Drop a pre-feature save file into the import dialog. Verify it loads with default auto-restock settings injected, and the game runs.

**Step 14.4: Commit any followups**

```
git add -p
git commit -m "chore(egg): final cleanup for QoL pack"
```

---

## Task 15 — Wrap-up

**Step 15.1: Update CHANGELOG (if one exists)**

Search for `CHANGELOG.md`. If it exists, add an entry under "Unreleased":
```
- Egg cap raised to 10,000.
- Bulk-buy stepper in the egg gacha (×1/5/10/25/50/100/MAX).
- Auto-restock that silently refills the egg queue after each hatch wave.
```

**Step 15.2: Confirm branch state**

```
git log --oneline beta..feat/egg-qol
```
Should show ~10–14 commits, each focused.

**Step 15.3: Hand off**

Done. Next decisions for the user:
- Stay on `feat/egg-qol` for further work, or merge into `beta`?
- Move on to Bucket B (content additions) or Bucket C (LLM director design)?

---

## Implementation notes

- **No `--no-verify`** under any circumstance. If lefthook fails, fix the underlying issue.
- **No type suppressions** (`as any`, `@ts-ignore`). The single `(EggGachaUiHandler as any).cursorToVoucher` in the test file is acceptable for accessing a private static; flag any other `as any` for review.
- **i18n fallback:** Only `locales/en/egg.json` updated. Other locales fall back to English at runtime via i18next's default fallback.
- **Save format:** All new save data is purely additive and optional. Old saves load with defaults; new saves remain readable by builds that don't yet know about the field (i18next ignores unknown keys; `loadSystemSaveData` already tolerates extras).
- **RNG:** Auto-restock egg generation runs in `EggLapsePhase` outside any `executeWithSeedOffset` block. Each `Egg` constructor uses its own per-egg seed (`EGG_SEED + id`), so determinism per egg is preserved without polluting the run RNG.
