# Co-op maintenance handoff — for the next orchestrating agent

Date: 2026-07-09. You are taking over the co-op (2-player) mode's live maintenance.
Read this whole file first, then `CLAUDE.md` (root). The co-op ARCHITECTURE is complete
and shipped; your job is **live triage**: player/maintainer bug reports arrive as logs,
you root-cause them, dispatch fixes, verify, and ship to STAGING. This doc is the durable
knowledge that is NOT obvious from the code.

---

## 0. The one mental model that explains ~every co-op bug

**Host is the sole engine; guest is a pure renderer. Anything the guest DERIVES itself
(instead of ADOPTING from the host) eventually diverges.** Every live bug this month
reduced to a guest re-deriving some value the host also computed independently:
- ME presence roll (per-client pity state) → #862
- biome travel result (deterministic per-client) → #864
- turn-1 / switch-in ability derivation (showdown) → 4fc86f624
- reward pick matched by seq alone, not kind → #861

When you diagnose, ask: *"is the guest computing this, or adopting the host's value?"* If
computing, that is almost always the bug. The fix is always the same shape: **host states
it authoritatively, guest adopts it, never re-rolls.** Do not add cleverer derivation —
remove the derivation.

Corollary hazards that also recur:
- **Phantom / parked awaits**: a guest phase awaits an event the host will never send
  (non-battle ME leftover battle turn #859/#860; watcher biome screen awaiting a pick that
  the owner's path never relayed #863/#864). Fix: the terminal/owner path must dissolve or
  relay; never leave a 20-min timeout as the only exit.
- **Stale cross-session buffers**: seq numbers reset per session/epoch; a leftover message
  can impersonate a new one (#861). Buffers are purged at session boundaries now; keep it.
- **Client death (NEW class, rising)**: reports are shifting from sync-logic to one client's
  page dying (crash/tab). The keepalive keeps the pipe open, but a dead page can't play.
  When a log shows the PARTNER went silent (heartbeats stop) with no error on the surviving
  side, ask the reporter for the OTHER client's capture — the root is on the dead side.

---

## 1. Operating model (how this seat works)

- **You orchestrate; you do not hand-code most fixes.** Dispatch `hephaestus` agents in
  isolated worktrees for each fix. You root-cause from logs first (so the agent gets a tight
  brief), integrate, run the gate, and ship. Do small/surgical fixes yourself only when the
  maintainer says "don't delegate" or it is a 1-3 line change you have already pinpointed.
- **Adversarially verify.** Read what agents claim against the actual log / diff. Agents
  sometimes fix a sibling of the reported bug, or claim a path is covered that the live
  capture contradicts (happened with #864 — the agent said the picker path already relayed;
  the live log proved the *other* terminals didn't). Trust the log over the summary.
- **Gate on a QUIET box.** The full `coop/` dir under `isolate:false` produces disjoint
  flaky failures + hook timeouts under load (multiple vitest runs, many node processes).
  Policy: never gate/ship under load; a red-twice on the SAME test is real, disjoint reds
  across reruns are contention. Final gates run clean (last was 128 files / 778 tests green).
- **Ship to STAGING only. PROD IS FROZEN** until the maintainer explicitly clears each prod
  deploy. Staging deploys are generally welcome (the maintainer says "deploy" / it's the
  test surface) but confirm if unsure. Never deploy prod without an explicit yes.

---

## 2. Security + deploy constraints (VERBATIM — do not paraphrase away)

- GH token at `C:\Users\Hafida\Desktop\github_token.txt`. Read via
  `export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"`. **NEVER
  print or echo it.**
- Work + deploy ONLY from `feat/elite-redux-port` on remote `heraklines`
  (`Heraklines/elite-redux`). **NEVER touch `main`** (sole historical exception: syncing
  `.github/workflows/nightly-coop-soak.yml` to main = the established #820 practice; the cron
  reads the workflow from main).
- Push with the credential helper:
  `git -c credential.helper='!f(){ echo "username=x"; echo "password=$GH_TOKEN"; };f' push heraklines feat/elite-redux-port`
- Staging deploy: `gh workflow run deploy-staging.yml --ref feat/elite-redux-port -R Heraklines/elite-redux`
- Prod deploy (NEVER without explicit permission): `deploy-prod.yml`, same dispatch form.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- The remote moves under you (maintainer + a showdown agent push too). Always
  `fetch` + `rebase heraklines/feat/elite-redux-port` before pushing. Rebases have been
  clean; showdown commits interleave harmlessly.

Current feat HEAD at handoff: **244cffecd** (mix of coop #863/#864 + showdown fixes from the
parallel agent — that agent owns `showdown`/`versus` files; stay out of them).

---

## 3. The live-triage loop (your core workflow)

1. **Pull the logs.** Both the maintainer's "Send Logs" and players' "Report a bug" POST to
   the `dev-logs` branch. Quick read without the pull script:
   ```
   export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"
   git -c credential.helper='!f(){ echo "username=x"; echo "password=$GH_TOKEN"; };f' fetch heraklines dev-logs --quiet
   git log --pretty='%h %ci %s' -8 heraklines/dev-logs      # newest first; "(by <name>)" = tester
   git show heraklines/dev-logs:<path>                      # print a capture
   ```
   A co-op session lands as TWO back-to-back commits (host + guest) seconds apart — **read
   BOTH**. Host shows as its account name; guest often `anon` or a chosen name.
2. **Find the reason line.** Every capture has a header (build/wave/seed/party) + a
   `----- COMMENT -----` (the player's words) + `----- CONSOLE -----`. Grep the console for
   `coop:` lines: `interactionCounter`, `coop:health` (tick/counter/wait/peerBeat), `AWAIT …
   -> network-wait` (a park), `RENDEZVOUS TIMEOUT`, `WARN`, `ABORT`, `role=`, `seq=`, `kind=`.
   The health line's `wait=NNNms` climbing + `counter` divergence between the two clients is
   the desync fingerprint. `peerBeat` climbing = the partner went silent (client-death class).
3. **Root-cause it yourself** enough to write a tight agent brief. Establish each client's
   phase order and WHERE they diverged. State the exact mechanism (which relay didn't fire,
   which await parked, which value was derived).
4. **Dispatch a `hephaestus` agent** (isolated worktree, `run_in_background: true`) with the
   full diagnosis, the standing rules (below), and a MANDATORY duo repro (fails-before /
   passes-after). One P0 per agent; disjoint file territory if you run two in parallel.
5. **Integrate**: `git -c core.hooksPath=/dev/null cherry-pick <sha>` from the agent's branch
   (shared object store — its commit is reachable without pushing).
6. **Gate** the combined tree on a quiet box (full `coop/` dir), then **push + deploy
   staging**. Update the task ledger. Tell the maintainer the root cause in plain language.

---

## 4. Tooling you must know

- **Two-engine duo harness** (`test/tools/coop-duo-harness.ts`): the ONLY way to reproduce a
  co-op desync deterministically — boots a real HOST `BattleScene` + a real GUEST renderer
  over `LoopbackTransport`. STANDING RULE: every co-op fix gets a `coop-duo-*` repro here
  first. Read the header — it documents the `ClientCtx` atomic swap, the `globalScene`
  citizenship rule (restore in `afterEach` or the next file crashes), and the layered design.
- **Headless combat runner** (`scripts/run-scenario.mjs`) + **UI runner**
  (`scripts/run-ui-scenario.mjs`) + **render harness** (`test/tools/render-ui-page.test.ts`):
  for single-client behavior/visual bugs. See CLAUDE.md for all three.
- **Nightly 3-leg soak** (`.github/workflows/nightly-coop-soak.yml`, cron reads it from main):
  god / level-55 / me-asymmetric profiles, findings pre-diagnosed by the P5 checksum
  assertion. Check its verdict each morning — it is the formal seal on the shipped tree.
- **Record→replay**: production runs capture a `ReplayTrace` (last 6 waves) attached to bug
  reports; `replayCoopTrace` / `replaySingleTrace` re-drive them. Use when a report carries a
  trace.

---

## 5. Recurring operational hazards (you WILL hit these)

- **Agent worktrees boot on UPSTREAM pokerogue** (`6c3fbb195`), not the fork — the ER coop
  code is absent. EVERY agent brief must say: "VERIFY the worktree is based on feat; if wrong,
  `git reset --hard feat HEAD` + `pnpm install`." Agents have hit this every single time.
- **Agents must NOT arm background monitors** — they can't wake a stopped agent. Brief them to
  run verification synchronously and deliver the report in-turn.
- **`isolate:false` cross-file latch**: co-op tests share module state (incl. `globalScene`).
  A test that sets a process-global flag must reset it in teardown, or it leaks to the next
  file in run order (bit us on #847). Full-dir run is the only way to catch it.
- **`scenarios.ts` conflicts on cherry-pick**: the dev test-suite note entries collide almost
  every integration. Resolve keep-both and ensure each entry keeps its `setup` tail (a note
  entry with no `setup` breaks tsc — cost us 422 errors once when hooks were bypassed).
- **tsc baseline drift**: CLAUDE.md says 277; freshly-`pnpm install`ed worktrees measure
  ~292-301. Measure zero-NEW by stash-diff on the same worktree, not against the doc number.
- **biome**: never bare `pnpm biome` (reformats ~700 files vs main). Use
  `npx biome check --write <files>`.

---

## 6. Open items (what's NOT done)

- **#865 (P1 residual from #864)**: the single-node non-chained biome-travel terminal still
  DERIVES (doesn't relay), relying on `erMapState` determinism — but revealed nodes are NOT
  synced (only the biome-structure trio rides the checksum). Narrow (needs a single-node
  boundary AND divergent map state) but it is the last derived-state landmine in the biome
  path. Durable close = make `erMapState` (revealed nodes/fragments/crossroads reveal)
  host-authoritative + adopted; also closes the latent #841-item-1 gap. RECOMMENDED next
  proactive fix.
- **#856 (P1)**: wild-catch full-party RELEASE is host-only — a guest-thrown full-party catch
  lets the HOST drive the release (#800 class). Plan registered in-code at
  `attempt-capture-phase.ts` partyFull branch (#855 recipient-drives pattern). ~1-2 days incl.
  a new duo scenario; all-or-nothing landing (registry guards). Benign today (can't hang).
- **wave-29 "host client died" finding** (in #863): a session where the HOST's page died
  (heartbeats stopped, no log). Needs the partner's capture to diagnose — client-death class,
  likely a crash on the dead side. Watch for a repro + the other client's log.
- **Nightly verdict**: check each run; findings arrive pre-diagnosed via the P5 assertion.
- Non-coop pending (not your seat unless asked): #435 sprite, #497 Rotom, #566-570 ability
  audit, #613/#614/#618 misc, #803 showdown epic (the parallel agent owns it).

---

## 7. Fix ledger — the last ~week (patterns to recognize)

All shipped to staging; each has a permanent duo/unit regression test. Recognizing these
means the NEXT report that rhymes with one gets diagnosed in one read:

- **#838** — full-state turn replication epic (the architecture: host streams
  `CoopAuthoritativeBattleStateV1`, guest applies by `Pokemon.id`, never re-derives). DONE.
- **#857** — connection flapping: (a) no keepalive → idle channel torn down at ~30s; (b)
  zombie-pc cascade — rejoin leaked the old `RTCPeerConnection`, its late teardown killed the
  live channel. Fix: 5s keepalive + reap the superseded pc + generation-guard handlers.
- **#858** — wave-10 biome-shop vs map ordering: two owner interactions on one boundary raced;
  fallback fired one-sided. Fix: reciprocal `biomepick:<wave>` rendezvous barrier.
- **#859 / #860** — phantom ME turn: a non-battle ME's leftover battle chain parks the guest
  awaiting a battle the host never fights. Fixed at BOTH entry points (embedded-shop handoff +
  detached terminal). Gift-ME ordering vs quiz-ME ordering differ; both covered.
- **#861** — relay `kind`-blindness: awaits matched by seq alone; a stale cross-session
  message impersonated a reward pick. Fix: kind-validated awaits (27 call sites) + purge all
  relay/rendezvous buffers at every session boundary + log kind everywhere.
- **#862** — wave-TYPE divergence (host WILD, guest ME, same seed): per-client pity state.
  Fix: host states the ME verdict (type or `COOP_WAVE_NO_ME`) at wave start; guest adopts both
  ways; MysteryEncounterPhase divert guard drops a self-rolled phantom.
- **#863 / #864** — biome map relay: the owner's pick only relayed on the multi-node picker's
  onSelect; every other travel terminal (single node, travel-target, chained Leave, fallback)
  traveled silently. Fix: funnel ALL owner biome-travel through one relay + counter advance;
  watcher adopts; watcher-side orphan backstop as safety net.

The through-line: **half-wired relays and guest-side derivation.** When a new report lands,
first suspect an un-relayed path or a derived value, not a fresh mechanism.

---

## 8. Communication with the maintainer

- Lead with the plain-language root cause ("the map's owner never told your partner what they
  picked"), then the fix, then verification. The maintainer reasons about mechanics — a good
  one-paragraph "how this happened" is valued.
- The maintainer's own observations are gold (the "sometimes it works" clue cracked #864).
  When they describe a pattern, fold it into the agent brief as the primary lead.
- Be honest about residuals and what a fix does NOT cover. Track them (TaskCreate) rather than
  silently shipping a partial.
- Don't over-claim "fixed" — say what was verified (which test, which gate) and what's still
  conditional.
