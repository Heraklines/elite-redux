# Voucher anti-cheat + remediation — design (parked 2026-06-27)

Players inject vouchers via the browser console (edit `gameData.voucherCounts` in
Sources), which syncs to the server. Goal: (1) block it server-side going forward,
(2) reset existing implausible counts to a play-based plausible amount **without
punishing legit grinders**.

## How vouchers work (code refs)
- **Stored:** system save `voucherCounts: {0,1,2,3}` = REGULAR/PLUS/PREMIUM/GOLDEN
  (`src/@types/save-data.ts`), plus `voucherUnlocks: {id: ts}` (condition vouchers
  earned) and `gameStats` (battles, playTime, classicSessionsPlayed, sessionsWon,
  endlessSessionsPlayed, ...).
- **Earned (`src/system/voucher.ts`, `battle-scene.ts:validateVoucher`, `modifier-type.ts`):**
  - Condition vouchers (recorded in `voucherUnlocks`, granted ONCE each): CLASSIC_VICTORY
    (tier by score; **≥150 = GOLDEN**) + boss-trainer defeats w/ `hasVoucher` (PLUS/PREMIUM).
    Finite set.
  - Reward pickups: `AddVoucherModifier` = VOUCHER / VOUCHER_PLUS / VOUCHER_PREMIUM
    (**no golden reward**). Unbounded, scales with runs/waves.
  - Maintainer rule of thumb: **~3 vouchers per trainer battle WON**; hell mode has a
    trainer ~every 3 waves → **~1 voucher/wave**; plus reward shops (~20-25 regular +
    ~15 bigger per wave-200 run).
  - **GOLDEN comes only from CLASSIC_VICTORY high-score** → legit golden ≈ ≤ classic wins
    (realistically ≤ a handful).

## Data (951 prod saves, 2026-06-27 sample of 40)
- Save blob = `"GZ1:" + base64(gzip(JSON))` in `system_saves.data`. Decode:
  `JSON.parse(zlib.gunzipSync(Buffer.from(data.slice(4),"base64")).toString())`.
- Saves are big: avg ~318 KB, max ~2.1 MB, **~295 MB total** (egg/dex bloat) → bulk pull
  must be batched.
- **Legit players SPEND vouchers on eggs → tiny balances** (sample max = 145, on 10k+ battles).
- Cheaters are blatant: uid23 = **3.99M** vouchers on **470 battles**; uid24 = 327k on 2327;
  uid30 = 26k on 8901; uid4 = 17k on 8915 battles **but only 4h playtime (battles faked)**;
  uid9 = 1427 incl. **515 golden** (impossible). ~12% of the sample flagged → expect ~100
  accounts repo-wide (confirm with a full scan).

## Plausibility model
```
effective_battles = min(gameStats.battles, playTime_seconds / 10)   // bound by playtime (catches battle-faking)
ceiling          = voucherUnlocks_count + effective_battles * RATE + FLOOR
golden_cap       = sessionsWon            // golden only from classic high-score wins
```
- A save is cheated if `sum(voucherCounts) > ceiling` OR `golden > golden_cap`.
- Reset = clamp golden to `golden_cap`, then clamp the total to `ceiling` (put the
  remainder mostly in REGULAR/PLUS). Generous on purpose → grinders keep everything;
  e.g. a 37 h player still keeps ~9k.
- Recommended knobs: **RATE ≈ 1.2/battle, FLOOR ≈ 25, golden ≤ classic wins, battles ≤ playTime/10s**.
- Verified on the 40-sample: 5/5 cheaters flagged, highest legit (145) far under its ceiling.

## Going-forward defense (worker `er-save-api`, in `handleSystemUpdate` + the updateall system path)
On every upload, decompress incoming + the stored save and enforce:
1. **Δ-guard (kills slow-increment cheating):** `Δvouchers ≤ Δbattles * RATE + buffer`.
   You can't gain vouchers without the battle counter moving the matching amount — edit
   in the console with no new battles → Δbattles 0 → gain rejected.
2. **Absolute ceiling** (formula above) as the backstop for the first big injection.
3. **golden ≤ classic wins.**
   All inputs are in the save itself, so no DB query. Re-compress + store. Backup-before-
   write already exists (`system_save_backups`, the KeeganDB92 pattern).
- Edge: `battles` lives in the save so a clever cheat could inflate it too → mitigated by
  the `playTime/10s` bound; optional extra hardening = cross-check against the server-side
  `runs` table (Σ `runs.wave`), but that table is incomplete for pre-recording players, so
  use it only as an upper sanity, never a hard floor.

## Remediation (one-time D1 bulk)
- Pull `system_saves` in batches (~20-50 rows), decompress, compute ceiling, clamp the
  over-ceiling ones. **Dry-run first** (list uid + old total + reset total); confirm before applying.
- Back up each modified save before writing.
- Write via the **D1 REST API with bound params** (`UPDATE system_saves SET data=?1 WHERE
  user_id=?2`) — `wrangler d1 execute --file` UPDATE fails on large blobs.
- D1: name `er-saves`, db id `b2fae947-6971-45e7-b287-d42648fd0a30`; creds in
  `C:\Users\Hafida\Desktop\cloudflare tokens.txt`.

## Open decisions before building
1. Confirm knobs (RATE 1.2 / FLOOR 25 / golden ≤ classic wins / battles ≤ playTime/10s).
2. Build BOTH the worker guard (delta + ceiling) and run the bulk reset now, or just the
   worker guard (which resets each cheater lazily on their next sync)?
3. Per-tier reset distribution (mostly REGULAR vs proportional).
