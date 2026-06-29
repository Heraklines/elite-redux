# Co-op status + open issues (snapshot, parked)

Recorded so co-op work can be picked up cleanly after a pause. This is a STATE snapshot, not a
design doc. Branch: `feat/elite-redux-port` (worktree `coop-me-authoritative`). Authoritative netcode
(HOST = sole engine, GUEST = renderer) is the live default.

---

## 1. Shipped this session (on staging + feat)

| Commit | What | Status |
|--------|------|--------|
| `ea2c32eba` | globalScene "harness citizenship" — duo test files restore `globalScene` so they don't poison the next `ER_SCENARIO` file's `GameManager`. | deployed |
| `33705d49f` | Two-engine harness can DRIVE co-op mystery encounters; all 3 authoritative ME paths (host-owned, guest-owned, battle-handoff) verified CORRECT across two real engines. | deployed |
| `b37c250aa` + `4b9980567` + `7e32f2619` | **Record → Replay pipeline.** A reported bug now ships with a deterministic `ReplayTrace` (seed + roster + ordered command/interaction events) that the duo harness re-runs to reproduce + verify a fix. Schema (`replay-trace.ts`), production recorder (`replay-recorder.ts`, passive ring-buffered, gated by `isReplayRecording()`), bug-report attach (`er-bug-report.ts`), harness loader (`replayCoopTrace`). Documented in CLAUDE.md. | deployed |
| `77cfa95df` | **Reward-shop resync desync FIX (#718).** A benign mid-shop battle checksum mismatch heals via a late `stateSync` whose `cancelWaiters()` was sticky-cancelling EVERY parked interaction wait — including the LIVE reward-shop wait the guest watcher was legitimately holding. The watcher then left the shop + advanced while the host stayed on it. Scoped the rescue to genuinely-ORPHANED waits only (`peerAdvancedPast(seq)` = `pendingRemote > seq`). **This is the most likely cause of the live RARE_CANDY "one player leveled, the other didn't" desync.** | deployed |
| `f05ed1859` | **Party-target reward harness driver + sync regression (#719).** `driveHostPartyRewardOwner` stubs the one `UiMode.PARTY` open so the headless autopilot can pick a slot — closing the hole where the duo harness could only drive NON-party rewards. Verified a held item (host-owned) + a RARE_CANDY level-up (guest-owned) each CONVERGE on both engines, both ownership directions. test-only. | pushed |

---

## 2. Open problems (suspects + what's confirmed)

### 2a. RARE_CANDY level desync (LIVE report) — likely already fixed, NEEDS RETEST
- Symptom: player used Rare Candy; "Kangaskhan is not the same level" (one engine leveled, the other didn't).
- **Basic party-target level-sync is VERIFIED CORRECT** in the duo harness (both ownership directions) post-fix.
- Strong hypothesis: caused by the `cancelWaiters` over-reach fixed in `77cfa95df`. The player's session build (`mqwk244y-b6y0`) may have been cached from before the fix.
- **NEXT: hard-refresh staging, redo a Rare Candy in co-op, confirm both clients' level matches.** If it still desyncs, capture fresh logs (host + guest) and replay them.

### 2b. Candy / level-up that crosses a MOVE-LEARN threshold ("it blocked") — UNCONFIRMED
- Symptom (verbal): Rare Candy "blocked." A candy that levels a mon across a learnset threshold queues an interactive `LearnMovePhase`.
- Code path: `learn-move-phase.ts` — in authoritative netcode EVERY `LearnMovePhase` routes through `coopAuthoritativeLearnMove` (host runs real `learnMove()`, guest no-ops + mirrors `tryRemovePhase`). The move-learn OWNER is the mon's `coopOwner` (line ~125), NOT the reward-interaction owner — so a reward picked by player A on player B's mon hands the move-replace decision to a different client than the one who picked the reward. Plausible UX/desync surface, **not confirmed broken from reading**.
- **NEXT (if 2a retest still shows a problem): build a focused two-engine repro that drives a reward-triggered candy → move-learn (interactive host `LearnMovePhase` + guest no-op) and assert both moveset + level converge.** The harness move-learn driver exists for the TM-case path (`driveGuestTmCaseRegression`); extend it for the candy-triggered path. Do NOT speculate-fix without this repro.

### 2c. Slow launch handshake ("stuck after starter select") — latency, not a hang
- Symptom: after both lock in rosters, ~30s before the battle appears. Guest retries `requestEnemyParty` ~6× (every 5s) before the host answers; the host receives them but is slow to serialize/stream the enemy party. It DID eventually load (not a softlock).
- **NEXT: profile the host's post-launch path (EncounterPhase → enemy-party serialize → stream) to find the ~30s stall. Likely an asset-load / atlas wait before the host can answer `requestEnemyParty`.**

### 2d. Sprite / cache bug — NOT reproduced
- Symptom (verbal): a sprite "not loading" right after the reward (Kangaskhan). Possibly the poisoned-cache / stale-atlas class (see CLAUDE.md `[er-atlas] load error … retrying with cache-buster` — those WARN lines appear in the launch logs).
- **NEXT: need the specific sprite + a screenshot or the exact console 404. Can't reproduce headlessly without specifics (sprite bugs are browser/CDN-cache, mostly out of the duo harness's scope — use the Tier-2 pixel harness `render-sprite.mjs` once we know the slug).**

---

## 3. Harness coverage gaps (what the duo harness still does NOT exercise)

These are the holes that let live bugs through. Closing them is the "expand the harness / patch holes" work.

1. **The real LAUNCH HANDSHAKE is not driven.** The harness boots the host via `game.classicMode.startBattle(...)` and builds the guest directly — it SKIPS `SelectStarterPhase → launchCoopMergedParty → save-slot auto-pick → EncounterPhase → requestEnemyParty`. So a regression in the post-starter-select launch path (e.g. 2c's latency) is INVISIBLE to it. **Highest-value hole to close.**
2. **Guest battle is MIRRORED, not LAUNCHED** (`mirrorHostBattleToGuest` clones the host field via `PokemonData` round-trip instead of the real launch + `adoptCoopHostEnemyParty`). It skips the seed-pin → a benign per-wave checksum mismatch appears + heals via resync. A production-grade run should drive the real launch handshake so a residual mismatch is a REAL bug.
3. **Ghost-bearing MEs + ghost WAVES are not safe.** The `er-ghost-teams` cache is reset-per-client, not save/restored; ghost co-op hooks are last-write-wins process-globals. Need per-client ghost-cache save/restore before any ghost-ME/ghost-wave duo test.
4. **Live per-event streaming is OFF** in the harness (role-gated no-op); only the turn-end BATCH path is exercised.
5. **Party-target rewards: drivable NOW** (`driveHostPartyRewardOwner`), BUT a party-target reward that triggers a downstream INTERACTIVE phase (move-learn, evolution) still needs a driver (see 2b — the move-learn `LearnMovePhase` hangs the headless autopilot today).

---

## 4. To-do backlog (when co-op resumes)

Priority order is a suggestion; the maintainer decides.

1. **Retest 2a** (Rare Candy level-sync) on a fresh staging build — confirm `77cfa95df` resolved it.
2. **Profile 2c** (the ~30s launch stall) — find what blocks the host answering `requestEnemyParty`.
3. **Close harness hole #1** — drive the REAL launch handshake in the duo harness (would catch 2c + the whole post-starter-select class).
4. **Build the candy→move-learn repro (2b)**; fix only if it confirms a desync/block.
5. **Sweep every reward/shop item type** through `driveHostPartyRewardOwner` for apply+sync (the "test every single item" ask) — rare candy ✓, vitamins, mints, ability capsules, TMs, evo/form items, PP items. Each may surface its own sub-menu driving need.
6. **Get specifics for 2d** (the sprite bug) and run it through the Tier-2 pixel harness.
7. Close harness holes #2–#4 (real launch + adopt; ghost-cache per-client; live streaming) as the remaining fidelity work.

---

## 5. Key files / anchors (for whoever picks this up)

- Two-engine harness: `test/tools/coop-duo-harness.ts` (drivers: `hostPlayWave`, `driveGuestReplayTurn`, `driveHostRewardShopOwner`, **`driveHostPartyRewardOwner`** [new], `driveGuestRewardWatch`, `replayCoopTrace`; ctx swap: `withClient`/`withClientSync`).
- Duo tests: `test/tests/elite-redux/coop/coop-duo-{engine,multiwave,mystery,replay,reward-items}.test.ts`. Run gated: `ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/`. Pre-existing red = 5 (checksum-engine:265, battle-events:410, guest-renderer ×3) — NOT regressions.
- Reward UI + co-op owner/watcher: `src/phases/select-modifier-phase.ts` (`openModifierMenu`, `startCoopWatch`, `applyRelayedRewardAction`, `coopFlushPending`).
- Interaction relay: `src/data/elite-redux/coop/coop-interaction-relay.ts` (`sendInteractionChoice`, `awaitInteractionChoice`, `cancelWaiters(predicate)`).
- Interaction counter / ownership parity: `src/data/elite-redux/coop/coop-session.ts` (`CoopInteractionTurn`, `peerAdvancedPast`) + `coop-session-controller.ts`.
- Move-learn co-op: `src/phases/learn-move-phase.ts` (`coopAuthoritativeLearnMove`, `coopLearnMoveRole`, `coopRelayLearnResult`).
- Resync apply (the `cancelWaiters` call site): `src/phases/coop-replay-phases.ts` (`verifyChecksum`).
- Record→replay: `src/data/elite-redux/replay-{trace,recorder}.ts`, `src/data/elite-redux/er-bug-report.ts`.
- Reading live co-op logs: dev-logs branch (two `anon` commits seconds apart = one session's host+guest). See CLAUDE.md "Reading REMOTE tester logs".
