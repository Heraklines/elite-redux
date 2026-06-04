# Egg Quality-of-Life Pack — Design

**Date:** 2026-05-04
**Status:** Validated, awaiting implementation
**Scope:** Three independent features in the egg/voucher system.

## Goals

Make egg pulls less annoying. Today the player must (1) manually visit the gacha each time eggs hatch, (2) hit the same one-pull buttons over and over, and (3) accept a hard 99-egg carry cap that backs up the gacha pipeline. This pack removes all three pain points without changing roll odds or save format compatibility.

## Non-goals

- No change to per-egg roll math (`generatePlayerPokemon`, hatch tier rates).
- No change to voucher earning conditions.
- No multiplayer / online sync changes.
- No reordering of voucher consumption priority via UI in v1.

## Feature 1 — Egg cap raised to 10,000

The current cap is the literal `99`, hardcoded in three call sites. Replace with a single named constant.

**New constant** in `src/data/egg.ts`:
```ts
export const MAX_EGG_COUNT = 10_000;
```

**Edits:**
- `src/ui/handlers/egg-gacha-ui-handler.ts:743` — replace `99` with `MAX_EGG_COUNT`.
- `src/ui/handlers/pokedex-page-ui-handler.ts:2071` — replace `99` with `MAX_EGG_COUNT`.
- `src/ui/handlers/starter-select-ui-handler.ts:2340` — replace `99` with `MAX_EGG_COUNT`.
- i18n: `egg:tooManyEggs` updated to interpolate `{{max}}` so the message stays accurate.

`UNLIMITED_EGG_COUNT_OVERRIDE` (`src/overrides.ts:265`) stays as the dev bypass — it's orthogonal to the player-facing cap.

## Feature 2 — Bulk-buy stepper on each gacha row

The `pull(pulls: number)` method already accepts arbitrary counts; only the UI gates it. The five existing voucher rows keep their one-click semantics; left/right arrow keys on a row scrub a multiplier.

**Multiplier steps:** `1, 5, 10, 25, 50, 100, MAX`

`MAX` resolves at action time to `min(vouchersHeld[type], floor((MAX_EGG_COUNT − eggs.length) / pullsPerVoucher))`.

**UI changes** (all in `egg-gacha-ui-handler.ts`):
- Each voucher row gets a `×N` text element to the right of the existing icon/label.
- New per-row state: `voucherMultipliers: number[]` indexed by cursor 0–4, default `1`.
- `Button.LEFT` / `Button.RIGHT` while a voucher row is focused: cycles the multiplier on that row through the steps array (clamps, doesn't wrap past MAX or below 1).
- `cursorToVoucher(cursor)` becomes `cursorToVoucher(cursor, multiplier)` and returns `[type, vouchersConsumed × N, pulls × N]`.
- Pre-pull validation in `handleVoucherSelectAction` already covers cap + voucher balance — just multiplied by N.

**i18n:** new `egg:bulkMultiplier` and `egg:bulkMax` keys; bulk-buy hint added to `egg:tutorial`.

## Feature 3 — Auto-restock ("egg conveyor")

Keeps the queue topped up after each hatch wave so the player doesn't have to manually visit the gacha.

### Save data

New field on `GameData` (`src/system/game-data.ts`):
```ts
autoEggRestock: AutoEggRestockSettings;

interface AutoEggRestockSettings {
  enabled: boolean;            // default false
  targetCount: number;         // default 50, clamped to [0, MAX_EGG_COUNT]
  gachaType: GachaType;        // default LEGENDARY
  perVoucher: Record<VoucherType, boolean>;
  // perVoucher defaults: REGULAR=true, PLUS=true, PREMIUM=true, GOLDEN=false
}
```

Serialized in `getSystemSaveData()` and restored with sensible defaults in `loadSystemSaveData()` so existing saves migrate cleanly.

### Trigger

Inject at the end of `EggLapsePhase.start()`, after both `hatchEggsRegular` / `hatchEggsSkipped` paths complete and before `this.end()` is called. Implemented as a private method `autoRestockIfEnabled()` to keep the existing flow readable.

```
if !enabled || eggs.length >= targetCount: return
loop:
  pick lowest-tier VoucherType where perVoucher[v] && voucherCounts[v] >= 1
  if none: break
  pulls = pullsPerVoucher[v]
  if eggs.length + pulls > targetCount && eggs.length + pulls > MAX_EGG_COUNT: break
  consume 1 voucher of type v
  silently push N eggs into gameData.eggs[]  (same generation as gacha pull, no animation)
  track totals per type for the toast
queueMessage(i18next.t("egg:autoRestocked", { count, breakdown }))
```

`pullsPerVoucher`: `REGULAR=1, PLUS=5, PREMIUM=10, GOLDEN=25`. Voucher iteration in enum order (cheap → rare) so rare vouchers are spent last; user can always disable Goldens (default off) to fully protect them.

### RNG

Auto-restock egg generation **must not** consume the run's main RNG. It runs outside `executeWithSeedOffset` blocks, in `EggLapsePhase` which is between waves. Egg ID generation already uses its own seeded path inside `Egg`'s constructor, so determinism is preserved per-egg without polluting the global stream.

### UI

A 6th cursor row appears below the 5 voucher rows: **"AUTO RESTOCK..."**. ACTION on it pushes a new `UiMode.AUTO_EGG_RESTOCK` sub-handler with the same windowed style as the gacha. Layout (top to bottom):

```
  ╔══════ AUTO RESTOCK ══════╗
  ║  Status:    ◀ ON  ▶       ║
  ║  Target:    ◀ 50  ▶       ║   (steps: 10/25/50/100/250/500/1000/MAX)
  ║  Machine:   ◀ LEGENDARY ▶ ║
  ║  ─────────────────────    ║
  ║  Regular vouchers   [✓]   ║
  ║  Plus vouchers      [✓]   ║
  ║  Premium vouchers   [✓]   ║
  ║  Golden vouchers    [ ]   ║
  ║  ─────────────────────    ║
  ║  [ Save ]   [ Cancel ]    ║
  ╚═══════════════════════════╝
```

UP/DOWN moves between rows. LEFT/RIGHT cycles values on the focused row. ACTION on a checkbox row toggles. ACTION on Save persists and exits; Cancel discards changes and exits. Style: `addWindow` + existing `TextStyle` constants — fully consistent with the rest of the gacha UI.

## Edge cases handled

| Case | Behavior |
|---|---|
| Save loaded without `autoEggRestock` field | Defaults injected; `enabled=false` so opt-in is explicit |
| Player has 1 voucher but auto-buy would overflow target | One pull happens, target reached, loop exits |
| `eggs.length` already ≥ `targetCount` at trigger time | No-op, no message |
| `UNLIMITED_EGG_COUNT_OVERRIDE` flag is on | Auto-restock still respects `targetCount` (override only bypasses the 10,000 hard cap, not the user's target) |
| Voucher type fully drains mid-loop | Loop tries next-cheapest enabled voucher; exits when no eligible voucher has stock |
| Bulk-buy multiplier set, then player pulls and N exceeds vouchers held | Existing `notEnoughVouchers` error path triggers; multiplier remains as set |

## Out of scope (logged for later)

- Per-voucher gacha-machine override (v2 of F3)
- User-defined voucher consumption priority order (drag-reorder)
- Auto-hatch (skip the hatch ceremony entirely on auto-restocked eggs)

## Files touched (summary)

| File | Reason |
|---|---|
| `src/data/egg.ts` | New `MAX_EGG_COUNT` export |
| `src/ui/handlers/egg-gacha-ui-handler.ts` | F2 stepper + F3 sub-panel cursor row |
| `src/ui/handlers/pokedex-page-ui-handler.ts` | F1 cap reference |
| `src/ui/handlers/starter-select-ui-handler.ts` | F1 cap reference |
| `src/ui/handlers/auto-egg-restock-ui-handler.ts` | NEW — F3 settings panel |
| `src/enums/ui-mode.ts` | NEW UI mode entry for the panel |
| `src/system/game-data.ts` | F3 save-data field, default injection, serialization |
| `src/phases/egg-lapse-phase.ts` | F3 post-hatch hook |
| `public/locales/<lang>/egg.json` | i18n keys for F1/F2/F3 |
| `src/overrides.ts` | (no change — existing override kept) |

## Test plan

- Unit: `MAX_EGG_COUNT` propagation; auto-restock loop with synthetic voucher counts and target values; voucher priority order.
- Manual: open gacha, scrub multiplier, pull 100×Regular → 100 eggs added; enable auto-restock with target=50, REGULAR-only; play through 3 waves and verify queue refills silently; toggle GOLDEN on, verify Goldens spend last.
- Save round-trip: save with auto-restock enabled, reload, verify fields persisted.
- Migration: load a pre-feature save (no field), verify defaults injected and game runs without errors.
