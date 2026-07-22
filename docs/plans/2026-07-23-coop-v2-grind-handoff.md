# Co-op V2 grind — full handoff (2026-07-23)

For the next agent taking over the co-op Authority-V2 effort. Read this, then
`docs/plans/2026-07-22-coop-integration-process-addendum.md` (binding process rules), then
`CLAUDE.md` (the two-engine harness + headless-runner docs). Do not skip the addendum — it exists
because two same-day merge regressions and one premature attribution happened without it.

---

## 0. THE GOAL

Full co-op mode playable e2e with two browsers, no desyncs / no softlocks, and the architecture
itself desync/softlock/deadlock-proof. Showdown (versus) rides the same V2 stack.

## 1. WHERE EVERYTHING IS

- **Working branch**: `ci/coop/v2-showdown-command-coordinate-20260720` on remote `heraklines`
  (`Heraklines/elite-redux`). **Current tip: `982d7367e` (scoping fix) — this handoff doc commit sits
  just above it.**
- **This integration worktree**: `C:\Users\Hafida\pokerogue\.worktrees\elite-redux`. tsc reads
  ~213-216 here; agent worktrees read ~222. The invariant is DELTA-0 per change measured in the
  SAME worktree, never the absolute number. `pnpm test:node` = **515 passed** at the tip.
- **GH token**: `export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"` —
  NEVER print it. Push: `git -c credential.helper='!f(){ echo "username=x"; echo "password=$GH_TOKEN"; };f' push heraklines <ref>`.
- **Commits**: `--no-verify` (Windows biome hook stack-overflows), trailer
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **feat line**: `feat/elite-redux-port` — ships prod/staging patches, has NO V2 flags (legacy
  showdown/co-op). **Staging currently serves `coop/staging-preview-20260721` (tip 898f19d60)** =
  V2 branch + feat + 2 showdown fixes, ~2 days stale. Legacy baselines tagged:
  `coop-legacy-baseline-cycle14` (9358f2ed2), `coop-legacy-baseline-final` (32de383f5).
- **NEVER** touch main / feat / integration branches or deploy prod without explicit maintainer OK.

## 2. IN FLIGHT AT HANDOFF (check these FIRST)

A qualification pair is running on the CURRENT tip `982d7367e`:
- **Gate**: run `29962956889`. **Campaign**: run `29962958374`. READ THESE (not the earlier
  29961408051/29961409516 pair — those ran on the pre-scoping tip and will show the fresh-slot
  5-read regression that `982d7367e` fixes; ignore them).
- `gh run view <id> -R Heraklines/elite-redux --json jobs -q '.jobs[] | "\(.conclusion) \(.name)"'`
- Carries: both lockstep deadlock fixes + fresh-run cloud-read retry (now SCOPED to resume discovery
  only). Read FIRST; it names which lanes the latest merges cleared and the new frontiers.
- NOTE (process lesson, already in the addendum): the fresh-run fix `7f4a113aa` shipped an
  unconditional retry that broke the fresh-slot scan's 5-read gating contract; the agent caught it
  in its own post-merge report and `982d7367e` scoped it (retryTransientReads param, default false;
  only `getCoopResumeLobbySnapshot` opts in). coop-duo-resume 40/40. This is exactly the
  blast-radius miss the pre-merge checklist targets — do the checklist.

## 3. WHAT IS DONE (V2 cutover + convergence — ~40 product fixes, none regressed once landed)

**Architecture (complete, live on the branch):** one global authority log, separate
receive/material/control frontiers, exact peer quorums, durable redelivery, connection-generation
rebind, complete interaction-result commits, typed successors, multi-owner command frontiers,
front-fenced correlated recovery, proposal leases with exact-once identity, hard cutover inside
each surface (no per-event legacy fallback; whole-feature rollback via default-off negotiated
capability flags is intact and byte-identical when off).

**Two-browser journey routes GREEN (real Chrome, real staging workers, all 5 V2 flags on):**
fresh-resume (`29887621621`), faint-replacement continuing route (`29902215737`, `29908398006`).

**Campaign lanes:** surface + solo have gone green; the four gameplay lanes each had every observed
mechanism fixed (see fix ledger). Depth reached wave 5 with ZERO softlocks — it now dies on
wall-clock, not bugs (see §5).

**Fix ledger — the mechanisms killed (all red-first or trace-grounded, sync gates never weakened):**
- faint-journey digest "mismatch" = stack-overflow phase ping-pong + won-wave WAVE_ADVANCE refusal
- won-wave layers 1-4: replay-pivot phantom / queue-empty TurnInit manufacture / WIN replay-supersede
  (`>= settledTurn`) / guest wave-2 launch (the settledTurn off-by-one on a self-turn co-win)
- recovery-fence scoping (watcher instant-null), Frontier-3 reward barrier
- parked-command dissolve (F4), replacement-material finalization
- mystery: ME party sub-pick proposal-wait (`meSub`), ME host-dialogue advance under V2 freeze,
  ME terminal sanction omitting NextEncounterPhase
- dirty: settledTurn deadlock, in-flight-replacement park (stack-overflow), wave-3 terminal-successor
  CONTROL_COMMIT authorization, fresh-run cloud-read retry
- depth: V2 learn-move INLINE opener (#787 recreated), driver faint-ownership misclassification
- surface: mid-wave replacement command-open re-release
- market/biome: pin-aligned boundary-open for the duo family; natural biome-pick interaction-open
  (the SelectBiomePhase establisher); reward-op durability retarget + scheduler-clock seam
- replay pacing: animations-off now fast-forwards message/HP/EXP/faint dwell (sequence-identical)
- showdown: terrain/weather turn-counter carry + forfeit terminal-freeze (merged to staging preview)

## 4. WHAT IS LEFT (ranked)

### A. Campaign lanes to green (read run 29961409516 first for current signatures)
Every lane has a history of "fix engages → frontier moves deeper." Expect the handoff roll to show
NEW frontiers, not the old ones. Triage each per addendum rule #1 (trace-first, no inherited labels).
Known-open at last reading: dirty's fresh-run flake (just fixed — verify it cleared), and whatever
the lockstep fixes did/didn't clear on surface/mystery.

### B. DEPTH lane is a THROUGHPUT problem, not a bug (perf investigation done)
~6-9 min/wave; ~12 min fixed setup; 45-min deadline honestly buys ~4-5 waves. The dominant sink was
per-event lockstep dwell (now fast-forwarded) + checkpoint pixel captures (now DOM-only on depth) +
barrier polling (symptom of the dwell). **Decision owed after re-measuring on the pacing fix**:
either set depth target to ~4-5 waves at 45 min, OR shard the 30 waves into ~6-8 jobs of ~4 waves
with a co-op-session save-handoff so shard N+1 resumes without replay. DO NOT blindly raise the
deadline. (task #119)

### C. GATE fixture-migration tail (task #118)
The B-lane duo suites + C/P2 are mostly LEGACY-semantics fixtures that under-drive V2 (never open
controls / admit proposals / fire redelivery); the V2 log correctly refuses their shortcuts. The
proven migration pattern is the `driveBiomeMarketLeave` real-UI drive + boundary-open + operation
identity (see the market/biome fixes). Many B failures are also `#879` shared-`globalScene`
ordering flakes that PASS SOLO — verify solo before treating a B red as real.
- **task #120**: `coop-duo-wave-operation` ×10 needs a run-to-real-wave rewrite (currently jumps
  waveIndex without playing turns → V2 rightly refuses; not a product bug).

### D. Showdown presentation completion (task #115 — answers the maintainer's live report)
Versus "abilities on switch-in don't show for both players / barely syncs" is NOT a desync (state
converges) — it's the presentation STREAM having enumerated gaps: no `showAbility` wire event
exists; declared weather/terrain events are never emitted; recording opens at TURN start so
summon-time events are never streamed; the peer gets state via silent checkpoint. Fix = open the
recording window at summon, add `showAbility`, emit weather/terrain events. Presentation-only, zero
authority risk. SEPARATELY the versus SWITCH SOFTLOCK is the versus-path cousin of the classic-coop
parked-phase/replacement family (several fixes are gated `!isVersusSession()` and never applied to
versus) — needs a deliberate versus-side pass.

### E. PROMOTION LADDER (task #119, after A-C green)
Freeze one SHA → merge current feat → requalify the merged SHA (gate green-aggregate-or-ratified-
ledger, all campaign lanes, six-profile soak, real two-browser acceptance) → add a machine-verifiable
staging qualification manifest (deploy currently gated by discipline, not run-IDs) → staging as
STABILIZATION build → maintainer two-browser acceptance. NEVER cross-SHA green evidence.

## 5. THE MAINTAINER'S OPEN DECISIONS (surface these)
- **Showdown for the current patch**: staging can be redeployed from `feat` (legacy showdown, works
  today, ~15 min, ZERO co-op impact — feat has no V2) whenever they say. Not done yet (awaiting word).
- **Depth lane target** (§4B) — needs their call after re-measurement.
- **Per-mode capability gate** (showdown-legacy while co-op-V2 in ONE build): feasible later via
  gating activation predicates on `!isVersusSession()` + protocol bump; hold as a contingency lever,
  not a plan, until evidence demands it.

## 6. HOW TO RUN THE LOOP (exact)
```
cd /c/Users/Hafida/pokerogue/.worktrees/elite-redux
export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"
git fetch heraklines <fix-branch> && git merge heraklines/<fix-branch> --no-edit
npx tsc --noEmit 2>&1 | grep -c "error TS"   # delta-0 vs this worktree's own prior count
pnpm test:node                                # all green (515+)
git -c credential.helper='!f(){ echo "username=x"; echo "password=$GH_TOKEN"; };f' push heraklines HEAD:ci/coop/v2-showdown-command-coordinate-20260720
gh workflow run coop-gate-sharded.yml --ref ci/coop/... -R Heraklines/elite-redux
gh workflow run coop-public-ui-campaign.yml --ref ci/coop/... -R Heraklines/elite-redux
# lane signatures: gh api repos/Heraklines/elite-redux/actions/jobs/<jobId>/logs | grep -E "AggregateError|terminal|timed out"
# artifacts: gh run download <id> -p "*<lane>*compact*" -D <dir>   (COMPACT ONLY, delete after — disk)
```

## 7. AGENT-DISPATCH RULES (learned the hard way — all in the addendum)
- Trace-first attribution, ALWAYS. No "expected"/"known family" without the quoted signature+context.
- Product-behavior change pre-merge: tsc delta-0 + test:node green + red-first (or stated gate-only
  proof) + biome on touched files (gate-blocking, node-pass ≠ format-clean) + a blast-radius note
  naming flag-gated lanes.
- ONE behavioral change per MEASUREMENT roll (keeps regression fingerprints unambiguous).
- Every agent brief: commit+push per verified piece; NO journey/campaign/gate dispatch by agents
  (they cancel qualification runs — one dispatcher, the owner); COMPACT artifacts only, delete after.
- Journeys share ONE concurrency group across refs; freeze pushes while qualification rolls run.
- Zero-tool anomalous agent returns (5 so far): discard the text, resume with an explicit execute
  directive. API-drop mid-work: resume with commit-first.
- Never purge worktrees while agents are live.

## 8. OUTSTANDING TASKS (TaskList mirror)
#103 GOAL · #106 Track R promote · #115 showdown presentation + versus switch softlock ·
#118 gate fixture-migration tail · #119 promotion ladder · #120 wave-operation fixture rewrite.
Everything else in the list is completed history.
