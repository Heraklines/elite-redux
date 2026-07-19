# Residual characterized gate reds — WIP handoff (2026-07-19)

Branch: `coop/fix-residual-gate-reds` off `heraklines/coop/integration-20260718` (tip 895e5e1da).
tsc baseline on this worktree = **225 errors** (measured pre-change). Current tsc delta = **0** (still 225).

Files changed this session:
- `src/data/elite-redux/coop/coop-me-operation.ts` (item 4, PRODUCT fix)
- `src/phases/coop-replay-me-phase.ts` (item 4, PRODUCT fix)
- `test/tools/coop-duo-harness.ts` (item 5, harness fix)
- `test/tests/elite-redux/showdown/showdown-versus-faint.test.ts` (item 1)
- `test/tests/elite-redux/coop/coop-duo-faint-switch.test.ts` (item 2)

---

## Item 1 — showdown-versus-faint (c2) :613 "idle real guest picker materially closes…" — PARTIAL

**Layer verdict: TEST (product is correct).** Confirmed by Oracle + empirical probes.

- Original red: assertion at old line 731-734 `expect(SwitchSummonPhase unshifts).toHaveLength(0)` after material proof arrived — got 1. Probe proved the summon fires under HOST ctx during the guest-drain window (the harness delivers the guest `materialApplied` ACK under the DESTINATION/host context, which transiently reactivates the host runtime and flushes the `releaseAfterPeerMaterial` continuation). That is CORRECT product behaviour ("in a real browser the runtime is always active, so this defers nothing live" — switch-phase.ts). The 731-734 assertion over-specified host quiescence between proof-arrival and the manual pump.
- **What I did:** relocated the real "no summon before material proof" invariant to its only valid instant — INSIDE the host material-barrier block, BEFORE the guest closes its picker (mirrors sibling coop-duo-faint-switch test 2 :366-374). Replaced 731-734 with a documented comment. Verified: the relocated no-summon + the summon===1 (740-743) + checkpoint===1 assertions now PASS.
- **What remains (the deeper "idle-fallback mechanism"):** the test then advances to its FINAL guest-materialization step and HANGS: the idle-fallback guest cannot reach its post-replacement CommandPhase. **Layer verdict for this: TEST-HARNESS DRIVE GAP (Oracle-confirmed, NOT product).** The idle guest reaches its next command via the out-of-band CHECKPOINT route (coop-replay-turn-phase.ts pump: materialApplied→presentationReady→continuationReady, own CommandPhase opened ~:401), which needs BOTH engines pumped. The guest-only `driveClientPhaseQueueTo` starves it — the guest parks at `notifyContinuationSurface("rendererWait")` (:247-250). The guest-PICK sibling works only because `settleDuoPromise` dual-pumps.
- **Fix I applied (UNVERIFIED, still failing further along):** replaced the final guest-only drive with `driveClientPhaseQueueTo(..., { pumpPeer: () => withClient(rig.hostCtx, () => drainLoopback()) })` and dropped `materializeGuestInputAfterReplacement` for the idle case. This ADVANCED the hang from `CoopReplayTurnPhase` → `CoopFinalizeTurnPhase; queued=[TitlePhase], ui=MESSAGE`. So dual-pump correctly applies the checkpoint now, but the abbreviated headless guest lacks the NewBattle/TurnInit tail after finalize.
- **NEXT STEP for whoever picks this up:** the guest now reaches `CoopFinalizeTurnPhase` via the dual-pump. `materializeGuestInputAfterReplacement` (harness :1817) is what DRIVES CoopFinalizeTurnPhase + recreates the omitted input tail — but it must run AFTER the checkpoint applied (when current phase IS CoopFinalizeTurnPhase), not before (parked replay). Likely correct shape: dual-pump/`driveClientPhaseQueueTo` to `CoopFinalizeTurnPhase` with `pumpPeer`, THEN `materializeGuestInputAfterReplacement(guestScene)` (which drives finalize + recreates the tail), THEN `driveClientPhaseQueueTo` to `CommandPhase` (also with `pumpPeer`). Confirm via guest log: want `"guest apply OUT-OF-BAND checkpoint mid-park"` (good), not `"guest discard OUT-OF-BAND checkpoint"` (address mismatch = separate real bug).

## Item 2 — coop-duo-faint-switch test 2 :255 "idle guest picker closes…" — PARTIAL (identical to item 1's residual)

**Layer verdict: TEST.**
- Immediate red was a stub crash: the guest `ui.setMode(UiMode.MESSAGE)` stub returned `undefined`, so a genuine guest-side `setMode(MESSAGE).then(...)` (CommandPhase.end) chained `.then` on undefined and threw.
- **What I did:** changed that stub branch (coop-duo-faint-switch.test.ts ~:314-321) to `return Promise.resolve();` (match the real UI.setMode contract). Verified: it advances PAST the crash.
- **What remains:** the SAME deeper hang as item 1 — after the stub fix it now reaches the identical `driveClientPhaseQueueTo → CoopReplayTurnPhase HANG`. I applied the SAME pumpPeer fix (drop `materializeGuestInputAfterReplacement`, add `pumpPeer`). Same result: advanced to `CoopFinalizeTurnPhase; queued=[TitlePhase]`. Same NEXT STEP as item 1 (re-introduce `materializeGuestInputAfterReplacement` AFTER the checkpoint applies, keep `pumpPeer`).

## Item 3 — showdown-versus-faint (b) :445 — NOT RED ON THIS TIP (could not reproduce)

- Ran the full showdown-versus-faint file AND an isolated (a)→(b) sequence (`-t "KO"`): **(a) passes, then (b) passes**. Item 3 does NOT reproduce red on tip 895e5e1da — the tip's "picker-family cross-ctx harness fixes" appear to already clear whatever (a)'s Gyarados-Intimidate summon-with-ability path leaked.
- `resetScene` (game-manager.ts :127) → `scene.reset(false,true)` does NOT reset `abilityBar` state (player/shown/x), a plausible original leak vector, but it no longer manifests. **No change made.** If it resurfaces in the full gate (cross-file, not intra-file), the leak is likely the abilityBar or a phase residue and resetScene is where to clear it.

## Item 4 — coop-duo-me-operation LEG 2b :525 — PRIMARY FIXED (product), secondary partial

**Layer verdict: PRODUCT (primary), TEST-HARNESS DRIVE GAP (secondary).**

- **Root cause (primary):** the guest re-applies the broadcast guest-owned ME_PICK on a FRESH `CoopReplayMePhase` where `pickSent=false`/`pickStep=0` (the two-engine relay path — faithfully reproduces production reconnect/resync, where a fresh phase applies the journaled pick without ever running `handleGuestOptionSelect`). `releaseAppliedPickContinuationSurface()` returned early on `!pickSent` and `pickStep-1<0`, so the retained ME_PICK continuation never released → deadline exhausts → Title. The author had added a `pickWave` fallback for this path but missed `pickSent`/`pickStep`.
- **PRODUCT FIX (shipped):** thread the applied op's EXACT `step`+`wave` from the material-apply hook into the release:
  - `coop-me-operation.ts`: widened `setOnCoopMeGuestOwnerPickApplied` / `onGuestOwnerPickApplied` to `(pinned, step, wave)`; in `applyJournaledMeEnvelope` (ME_PICK, owner===1) compute `step = pinnedSeq - seq*8000 - ME_KIND_TAG.ME_PICK*1000` and pass `envelope.wave`.
  - `coop-replay-me-phase.ts`: `releaseAppliedPickContinuationSurface(applied?: {step,wave})` — the material-apply hook passes `{step,wave}` as PROOF and BYPASSES the `pickSent` gate + uses `applied.step`/`applied.wave`; the cosmetic narration caller (no arg) keeps the `pickSent` gate.
  - Verified: line 606-611 (the `sharedInput` emit for the applied pick) AND line 613 (pending===0 after pick) now PASS. Probe evidence: `[coop:me] released retained ME_PICK continuation from post-pick surface (Track R) { seq: 8_000_001, step: 0, wave: 12 }`.
- **What remains (secondary, NOT fixed):** the test's FINAL assertion (:651-654 `operationContinuationDiagnostics().pending === 0`) fails — 2 OTHER continuations strand at ME end: `…:1:REWARD:105000` (guest-owned reward shop) and `…:0:ME_TERMINAL:…`, both applied (materialApplied) but `observed=false`. **Oracle verdict: TEST-HARNESS DRIVE GAP, not product** — these have real non-null surfaces drained by real `setMode` commits (ui.ts ~:955 `coopAuthoritySurfaceReady`); the harness strands them because `relayGuestMeShopLeaveSync` uses a raw `coopRelaySend` leave (no real setMode) and `drainGuestMeReplayToSettle` stops before the guest's next CommandPhase. **NEXT STEP:** after STEP D, under `withClient(rig.guestCtx)` drive the guest to its real next CommandPhase (wave ME_WAVE+1, turn 1) — a `command` surface there drains BOTH via `operationContinuationMatches` wave+1/turn-1 branch (coop-durability.ts :924-926). Do it through REAL `setMode` (drive to CommandPhase), NEVER by calling `notifyOperationContinuationSurface` directly. Keep line 654 UNWEAKENED. If the guest can't cleanly reach CommandPhase headlessly, fall back to driving the guest's real reward-shop + post-ME setMode commits.
- Note: the full-file run also showed LEG 3 red at `runToMysteryEncounter` (`mysteryEncounter?.encounterType` undefined) — a ME-SPAWN setup failure unrelated to my ME_PICK change; treat as pre-existing/separate.

## Item 5 — coop-final-boss-stage-one :64 — FIXED & VERIFIED

**Layer verdict: HARNESS (NOT a shard bleed).**
- The task suspected a shard module-state/counter bleed, but it fails **deterministically SOLO** (test 3 alone AND the whole file solo). Root cause: `buildDuo`/`buildDuoForMe` tagged `coopOwner` on the ON-FIELD mons only (`getPlayerField()`). In a final-boss STAGE-ONE the player field is single (only slot 0 summoned), so the guest partner's benched mon (slot 1) was never tagged → "no healthy guest-owned bench mon".
- **FIX (shipped):** tag by PARTY index (`getPlayerParty()[0]=host`, `[1]=guest`) instead of field. Byte-identical for every doubles rig (slots 0/1 ARE field 0/1 there); only newly tags the benched partner in a single-field battle. Applied to both `buildDuo` and `buildDuoForMe`.
- **Verified GREEN solo:** all 3 tests in coop-final-boss-stage-one pass. (The test-1 failure seen in a mixed multi-file batch was cross-file globalScene-citizenship interference, passes solo.)
- Regression set all GREEN with this change: coop-duo-double-faint ✓, coop-duo-engine ✓, coop-duo-multiwave ✓, coop-guest-renderer ✓ (35), coop-turn-resolve-precommit-park ✓ (node).

---

## Verification summary (what I actually ran green)
- tsc: 225 (delta 0). 
- Item 4 product fix: LEG 2b lines 606-611 + 613 PASS (pick continuation releases); LEG 2b still red at :654 (secondary drive gap).
- Item 5: coop-final-boss-stage-one 3/3 PASS solo.
- Regression: double-faint, engine, multiwave, guest-renderer, turn-resolve-precommit-park all PASS.
- Items 1 & 2: characterized initial failures fixed; both now fail at the shared `CoopFinalizeTurnPhase` harness-drive hang (see NEXT STEP above).
- Item 3: not reproducible red.

## Oracle action items carried forward
1. Items 1&2: dual-pump (`pumpPeer`) + re-introduce `materializeGuestInputAfterReplacement` AFTER the checkpoint applies (when on CoopFinalizeTurnPhase), then drive to CommandPhase with pumpPeer. Confirm via `"guest apply OUT-OF-BAND checkpoint mid-park"` log.
2. LEG 2b (item 4 secondary): drive the guest to its real post-ME CommandPhase (wave+1) via real setMode; drains REWARD + ME_TERMINAL. Keep :654 unweakened.
