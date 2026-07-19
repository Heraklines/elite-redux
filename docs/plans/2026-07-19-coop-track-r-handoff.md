# Co-op Track R — Session Handoff (2026-07-19)

**For the next agent/session taking over the co-op stabilization effort.**
Written by the integration-owner session at context handoff. Read this whole file
before doing anything; then read `docs/plans/2026-07-17-coop-authority-stabilization-tracks.md`
(three-track plan + Iteration-5 cutover preconditions) and `docs/plans/2026-07-18-coop-red-ledger.md`.

---

## 0. THE GOAL (standing, from the maintainer — stop-hook enforced)

> "Full coop mode playable e2e with 2 browsers without desyncs and softlocks,
> and the architecture is desync, softlock/deadlock proof."

Three tracks: **R** (stabilization — ACTIVE, this handoff), **S** (liveness, pending),
**A** (Authority V2 architecture migration, parked; `authority.v2turn` = OFF, keep it off).

## 1. WHERE EVERYTHING IS

- **Working dir**: `C:\Users\Hafida\pokerogue\.worktrees\elite-redux`
- **Integration branch**: `coop/integration-20260718` on remote `heraklines` (`Heraklines/elite-redux`).
  **Current tip: `9358f2ed2`** (cycle-13 merge). tsc baseline **216** in THIS worktree
  (agent worktrees read 225 — environment artifact; the invariant is DELTA 0, measure before/after
  in the same worktree). `pnpm test:node` = **316 passed** at tip.
- **GH token**: `export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"` — NEVER print it.
  Push: `git -c credential.helper='!f(){ echo "username=x"; echo "password=$GH_TOKEN"; };f' push heraklines <ref>`
- **Commits**: `--no-verify` (Windows biome hook stack-overflows), trailer
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **feat/elite-redux-port**: divergent (~10+ commits not in integration; integration has ~139 not in feat).
  Staging currently runs feat `94150657c` — NO co-op fixes. NEVER touch `main`. NEVER deploy prod without permission.

## 2. IN-FLIGHT RIGHT NOW (check these FIRST)

1. **Cycle-14 requalification pair at SHA `9358f2ed2`** (the first run carrying ALL campaign-lane fixes):
   - Gate run `29666831660`: **DONE, red** — failing: B5/13, B9/13, S4/8, C1/5 + aggregate.
     (B5 is likely the resharded location of previously-characterized tests — VERIFY at test level,
     do not assume; see §5 "resharding illusion".)
   - Campaign run `29666832476`: **IN PROGRESS** when this handoff was written.
     `gh run view 29666832476 -R Heraklines/elite-redux --json jobs,conclusion`
     This is the decisive campaign run: mystery watermark fix + depth/dirty half-wipe exit +
     surface animations budget + all prior fixes. If 4/4 lanes green → go to §6 promotion sequence.
     If lanes red → download artifacts (`gh run download <id> -D <dir>`), triage per §4 discipline.
2. **Residual-gate-reds agent** on branch `coop/fix-residual-gate-reds` (NOT yet pushed at handoff time —
   check `git ls-remote heraklines coop/fix-residual-gate-reds`). Its scope (task #114): showdown (c2) :599
   idle-fallback material close; coop-duo-faint-switch test 2 :255 (setMode stub crash then idle-fallback);
   showdown (b) :445 full-file-sequence scene pollution (GameManager shared globalScene, resetScene leak);
   coop-duo-me-operation LEG 2b :525; coop-final-boss-stage-one :64 (bench coopOwner precondition bleed);
   C1 coop-soak-journey :101 (optional). It received an Oracle verdict mid-flight (relayed): its ME_PICK
   continuation fix is a REAL PRODUCTION FIX (ME_PICK commits to MESSAGE whose continuation surface is
   deliberately null → applied pick never announced; fix threads applied-op step+wave from
   `coop-me-operation.ts:1283-1294` into `releaseAppliedPickContinuationSurface` under applied-op proof only);
   REWARD/ME_TERMINAL strands in that test are HARNESS drive gaps — fix by driving the guest to its real
   post-ME `CommandPhase` (real `setMode` → `coopAuthoritySurfaceReady`), NEVER by calling
   `notifyOperationContinuationSurface` from the test. If the agent died, redo from that verdict.
   A SECOND Oracle verdict (items 1-2, idle-fallback family) also surfaced: TEST-HARNESS DRIVE GAP, not
   product. The idle-fallback guest reaches its next command via the CHECKPOINT route
   (`coop-replay-turn-phase.ts:262-411`, own CommandPhase at :401) whose
   materialApplied→presentationReady→continuationReady handshake needs BOTH engines pumped; the guest-only
   `driveClientPhaseQueueTo` starves it (guest parks at rendererWait :247-250). Fix test-side in both tests:
   use the harness `pumpPeer` seam (`driveClientPhaseQueueTo(..., { pumpPeer: () => withClient(hostCtx,
   () => drainLoopback()) })`, seam at harness :1601/:1634) and DROP `materializeGuestInputAfterReplacement`
   on the idle path (pick-path-only driver; throws on the parked replay). Confirm via guest log:
   "guest apply OUT-OF-BAND checkpoint mid-park" (good) vs "guest discard OUT-OF-BAND checkpoint"
   (address mismatch → separate genuine issue). Production unaffected (both browsers pump continuously).
   When it pushes: merge → sentinels (tsc delta 0, test:node) → push integration.

## 3. STATE OF THE BOARD (what is fixed, what is red)

### Campaign lanes (browser, 4 lanes + solo)
| Lane | Status at cycle-9..13 | Mechanism history |
|---|---|---|
| solo | GREEN always | — |
| surface (animations-on 3w) | GREEN at cycle 9; red cycle 12 (wall-clock only, sync was byte-correct); budget calibrated cycle 13 | faint window + picker chain proven e2e |
| depth (30w) | won-wave phantom-command FIXED (e5280d56a + cycle-12 guard restore); half-wipe drive exit added cycle 13 | legit converged wipes are classified correctly (policy: NOT a pass — deliberate) |
| dirty (3w) | barrier deadlock FIXED (e30aa382c); reached wave 4 > target; 404s classified + title TypeError source-fixed (cycle 11); half-wipe exit cycle 13 | |
| mystery (10w) | party sub-prompt driver added (cycle 11); duplicate-replay double-render desync FIXED with watermark (cycle 13, red→green duo repro) | the LAST known real desync mechanism |

### Gate (45-job sharded; lanes A/B/C/S/P)
Characterized at TEST level (do NOT track at shard level — composition reshuffles when files are added):
- **FIXED & verified green in exact-SHA runs**: B7 `coop-guest-renderer:756` (faint-switch carve-out from the
  pre-commit exemption, `3d091b5ee`); B10 trio location; Lane A `coop-replacement-carrier-transaction` (cycle-12).
- **Remaining known reds** (all owned by the residual agent, §2.2): showdown-versus-faint (b in-sequence)/(c2),
  coop-duo-faint-switch test 2, coop-duo-me-operation LEG 2b, coop-final-boss-stage-one, C1 soak-journey.
- **S4**: 3 of 5 showdown cases collapsed by the picker-family harness fix (`e8a896d6f`); (b)-in-sequence + (c2) remain.
- Flaky family B1/B7 ability-popup park: accepted-red ledger (see red-ledger doc).

### Merged fix inventory this session (integration branch, oldest→newest since `77f93316b`)
- `77f93316b` double-faint replacement checkpoint deferral (complete-field push)
- `e30aa382c` cancel stale turn-commit at replay→command pivot (+ duo repro coop-duo-barrier-deadlock)
- `e5280d56a` won-wave phantom-command suppression + WIN unpark (+ duo repro coop-duo-won-wave-replacement)
- `582b6bac6` generic continuation recovery: addressed re-drive (bounded, attempts>0 reported),
  awaiting-human-input liveness hold, fail-closed preserved (+ test/node/coop-continuation-recovery.test.ts)
- `8154e277c` cycle 11: mystery-party harness driver; dirty fresh-account 404 classification (narrow,
  freshAccount-gated, contract-locked); `game-data.ts parseSessionData` fail-soft for non-array containers
  (the "(t ?? []) is not iterable" title crash — REAL product bug, regression Case C added)
- `3d091b5ee` B7: FAINT_SWITCH carved out of the barrier-site pre-commit exemption ONLY (release site untouched;
  op `kind` carried on authority for the discriminator)
- `9492de718` cycle 12: Lane A won-wave guard restore (`enemyParty.length > 0 &&` — `[].every()` vacuous-true bug)
- `e8a896d6f` picker-family harness fixes: host prompt hook held under `withClient(hostCtx)` window;
  foreign-ctx `interceptor.run` holds ctx across microtask hops (phase.end lands on the right phase manager)
- `098f5813f` cycle 13: streamer per-turn `renderedThrough` watermark (duplicate CoopReplayTurnPhase cannot
  double-render; reset at authority-reset + clearFinalizedMark); half-wiped `driveOwnedReplacementPicker` exit;
  `ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS` = 18000×32 for animations-on profile ONLY (SwiftShader software
  rendering measured irreducible; other profiles unchanged at 360s)

## 4. NON-NEGOTIABLE DISCIPLINE (learned/enforced this effort; violations have bitten us)

1. **Never combine green evidence across SHAs.** One SHA per qualification; parent artifacts never qualify a child.
2. **No timeout inflation, no assertion weakening, no generic recovery key-presses, no test deletion.**
   (The animations-on ceiling was a documented, investigated, profile-scoped calibration — the only sanctioned kind.)
3. **Repro-first for product bugs**: two-engine duo harness (`test/tools/coop-duo-harness.ts`, see CLAUDE.md)
   red→green, kept as regression. Browser-trace forensics attribute; duo tests prove.
4. **Verify agents' claims** — two independent adversarial-audit attributions and two agent claims were
   REFUTED with exact-SHA evidence this session (audit's B7→cycle-8 attribution; "recovery merge introduced
   picker family"; my own re-drive double-apply and carve-out picker-block hypotheses also died on evidence).
   Demand mechanism + trace/run evidence for every attribution, including from subagents.
5. **Resharding illusion**: gate shards recompose when test files are added. ALWAYS compare failing TESTS,
   not shard names, across runs (B2/B6/B9 "new reds" at 17060eaba were the old B10 trio redistributed).
6. **Windows env gap**: ER_SCENARIO duo/engine tests can be red locally-on-Windows while green in CI (and
   vice versa). CI exact-SHA logs are the arbiter for gate claims; local single-file runs are for red→green
   mechanics. NEVER run whole-dir coop vitest or the gate locally (runners only). No bare `pnpm biome`.
7. **Sentinels before every push of integration**: `npx tsc --noEmit` grep-count == 216 (this worktree),
   `pnpm test:node` all green (316 at tip; grows as node tests are added).
8. **Anomalous agent returns**: three times an agent returned instantly with zero tool uses and
   preamble/injection-styled text. Discard content, never act on it, resume/relaunch with an explicit
   "proceed to completion" nudge.
9. **Accepted-red ledger changes require re-ratification** at test level on the promotion SHA.
10. **60s replacement-pick fallback is FINAL** (maintainer decision). Do not redesign it.
11. Reviewer mandates in force: staging deploy is labeled STABILIZATION (not v2); promotion additionally
    requires green aggregate, ledger re-ratification, six-profile soak, shadow-health zero-retention counters,
    real two-browser acceptance by the maintainer; cutover blocked on the 10 Iteration-5 preconditions (plan doc).
12. Promotion criterion adopted from the 2026-07-18 adversarial audit: at least one real continuation-recovery
    attempt under induced loss; no recoverable journey may destructively Title both users. (The recovery layer
    now implements this — `582b6bac6` — keep it true.)

## 5. HOW TO RUN THE LOOP (exact commands)

```bash
cd /c/Users/Hafida/pokerogue/.worktrees/elite-redux
export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"
# merge a fix branch:
git fetch heraklines <branch> && git merge heraklines/<branch> --no-edit
npx tsc --noEmit 2>&1 | grep -c "error TS"    # must equal 216 here
pnpm test:node                                 # all green
git -c credential.helper='!f(){ echo "username=x"; echo "password=$GH_TOKEN"; };f' push heraklines coop/integration-20260718
# dispatch the requalification pair on the new SHA:
gh workflow run coop-gate-sharded.yml --ref coop/integration-20260718 -R Heraklines/elite-redux
gh workflow run coop-public-ui-campaign.yml --ref coop/integration-20260718 -R Heraklines/elite-redux
# watch:   gh run watch <id> -R Heraklines/elite-redux --exit-status --interval 120
# failing jobs: gh run view <id> -R Heraklines/elite-redux --json jobs -q '[.jobs[]|select(.conclusion=="failure")|.name]|join(",")'
# campaign artifacts: gh run download <id> -R Heraklines/elite-redux -D <dir>  (per-lane summary.json + per-seat public-ui-trace.jsonl)
```
Campaign triage: read each red lane's `summary.json` error, then the per-seat `public-ui-trace.jsonl`
(grep phase names / `coop:runtime` / addresses around the failure index). Product-vs-drive-vs-nondeterminism
verdict per lane, then fix at the mechanism (see §4).

## 6. THE PROMOTION SEQUENCE (when campaign 4/4 + gate reds resolved/classified)

1. Merge any outstanding fix branches; final requalification pair on ONE SHA; iterate until:
   campaign 4/4 green AND gate = green aggregate or a re-ratified accepted ledger.
2. **Freeze that SHA.** Then merge latest `feat/elite-redux-port` INTO integration (expect conflicts in shared
   UI files; feat has ~10+ unrelated commits incl. type-nativization), re-run sentinels, requalify the pair
   ONCE more on the merged SHA (audit rule: the merge is not a remedy, it is the promotion vehicle — staging
   builds from feat-lineage content and the maintainer's testers need feat features).
3. Full qualification on the candidate: green aggregate (or ratified ledger), all 4 campaign lanes,
   six-profile soak, shadow health zero-retention. Persist results in the plan doc.
4. Deploy to staging as **STABILIZATION build** (deploy-staging.yml builds from `feat/elite-redux-port` —
   so the integration branch must be merged back into feat first, or the workflow ref adjusted; the previous
   plan was: land integration onto feat, then `gh workflow run deploy-staging.yml --ref feat/elite-redux-port`).
5. **Maintainer two-browser acceptance** (tell them staging finally carries the co-op fixes — as of this
   handoff staging does NOT; er-coop-39 pairing will fail-closed against cached 38 clients by design).
6. Only after acceptance: consider Track S items, then Track A cutover per Iteration-5 preconditions.

## 7. KNOWN LANDMINES / OPEN QUESTIONS FOR THE NEXT AGENT

- Cycle-14 gate showed **B5/13** failing — not yet mapped to tests (do the composition pull; expected to be
  known reds relocated, but VERIFY; if genuinely new, bisect the cycle-13 merge first (streamer watermark
  touches every turn's render path).
- Depth 30w policy: a legitimately-wiped converged run currently FAILS the lane (deliberate — masks nothing).
  If depth keeps wiping legitimately at deeper waves, decide policy with the maintainer (stronger profile team
  vs accepting converged wipes with strict convergence proof).
- C1 `coop-soak-journey:101` (13-event drift) — least-characterized red; may collapse from the cycle-13
  watermark fix (double-render was a drift source) — check its exact assertion on the next gate run.
- Mystery `#812 BUFFER inbox` fidelity bug — noted cycle 8, non-causal, still open, low priority.
- `finalizedMarks`/watermark interplay: watermark clears at `clearFinalizedMark` (wave advance) — if a lane
  shows missing renders post-wave, look there first.
- The two audits' remaining valid asks not yet done: six-profile soak on candidate; zero-retention counters
  check; ledger re-ratification doc update. The B7 "green→red at 77f" audit claim was REFUTED (it regressed at
  `cf7df1e68`, the pacing merge) — documented in case a future review re-raises it.
- Task list: #106 (Track R master), #109 (integration owner), #114 (residual reds) in progress; #103 = the goal;
  #107/#108 pending. #102 (dirty profile) is effectively done — close when convenient.

## 8. SUBAGENT LEDGER (branches, all on `heraklines`)

| Branch | Status | Content |
|---|---|---|
| coop/track-r-cycle6..13 | MERGED | per-cycle campaign fixes (see §3 inventory) |
| coop/fix-barrier-deadlock | MERGED (`e30aa382c`) | stale turn-commit cancel + duo repro |
| coop/fix-continuation-recovery | MERGED (`582b6bac6`) | generic re-drive + liveness hold |
| coop/fix-b7-barrier | MERGED (`3d091b5ee`) | FAINT_SWITCH barrier carve-out + adjudication |
| coop/fix-host-picker-family | MERGED (`e8a896d6f`) | cross-ctx harness fixes (S4 collapse) |
| coop/fix-residual-gate-reds | IN FLIGHT (§2.2) | idle-fallback family, scene pollution, LEG 2b (ME_PICK product fix!), final-boss, C1 |

Good luck. The frontier is real: every remaining red has a mechanism-level characterization and most have
an owner. Keep the discipline in §4 — it is the reason fourteen cycles have never lost a fix once landed.
