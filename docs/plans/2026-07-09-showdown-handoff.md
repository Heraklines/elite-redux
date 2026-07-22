# Showdown Mode — Agent Handoff (2026-07-09)

You are taking over Showdown Mode (1v1 PvP with real collection-unlock stakes) for
Elite Redux, a PokéRogue fork. This is the single source of truth for where things
stand. Read it fully before touching code.

## TL;DR status

- **Functionally complete and playable on staging.** Full matches have run end to
  end with two live clients: pairing → team select → wager/escrow → battle →
  faints/switches → result → return to title. Testers have finished whole matches.
- **What remains is polish + maintainer-gated prod steps**, not broken foundations.
- **Worktree:** `C:/Users/Hafida/pokerogue/.worktrees/showdown` (detached HEAD — NO
  branch, per maintainer). **HEAD:** `244cffecd`. **Working tree clean.**
- **tsc baseline:** exactly **301** errors (pre-existing; a correct change keeps it
  at 301, NOT the 277 quoted in CLAUDE.md — that number is stale for this worktree).
- **Deploy:** staging only, freely. Prod is maintainer-gated (explicit permission
  each time). The maintainer's standing instruction has been "deploy to staging
  when a fix is green with proof."

## The maintainer's working style (match it)

- Terse. No preamble, no flattery, no status-update filler. Start with the answer.
- She tests live with a partner and pastes console logs / screenshots. Each report
  is a real bug — triage from the log FIRST, then reproduce in a harness, then fix.
- She has repeatedly said the churn of "another guard that limps one phase further"
  is unacceptable. **Find the ROOT cause, prove it, and ship it with a red-proof.**
  Every fix this session was: read the two-client logs → reproduce in the two-engine
  duo harness → fix at the source → red-proof (revert fix, test fails at named
  assertion) → gates → deploy.
- Early on she said "do not delegate, fix this yourself" (that was about hands-on
  battle-presentation work). Since then, delegating deep two-engine fixes to a
  worker WITH rigorous harness proof has been accepted and successful. Her
  frustration was with repeated FAILURES, not delegation. Keep yourself as the
  diagnostician (read the logs, localize the bug) and delegate the implementation
  with an exact target when it's a deep two-engine fix — but never delegate blind.

## Architecture (how showdown sits on the co-op netcode)

Showdown is built ON TOP of the current co-op netcode, which is
**host-authoritative full-state replication**:

- The HOST runs the only real battle engine. The GUEST is a PURE RENDERER: it applies
  streamed per-event cues (`battleEvent` k=moveUsed/hp/faint/statStage/status/message)
  and a per-turn `turnResolution` checkpoint. **The guest must DERIVE NOTHING** — every
  desync this session was the guest computing something locally instead of taking it
  from the host stream.
- **Session kind:** `CoopRunConfig.kind: "coop" | "versus"`. Predicates:
  `isVersusSession()`, `isShowdownGuestFlipGated()` (= versus && role==="guest" &&
  active runtime), `isCoopAuthoritativeGuestGated()`. Pinned on BOTH roles at
  `onConnected` (title-phase.ts) — the guest previously stayed "coop" and all gates
  died.
- **Perspective flip (F1):** the guest's OWN team is the authoritative ENEMY side.
  `swapSessionData` (`src/data/elite-redux/showdown/showdown-side-swap.ts`) swaps
  party↔enemyParty AND flips each `PokemonData.player` flag (a fix this session — the
  reference-swap alone left the guest's team as EnemyPokemon → front sprites, wrong
  panel, getBattlerIndex()=-1 crashes). Presentation flip lives in `pokemon.ts`
  (`presentationIsPlayerSide`, coord swaps, `initBattleInfo` picks the panel CLASS by
  presentation side) — the panel class FOLLOWS the presentation side; do not
  reintroduce the old "corner-only flip."
- **Enemy command relay (NEW for versus):** the host's `EnemyCommandPhase`
  (`resolveVersusEnemyCommand`) awaits the guest's relayed command via
  `ShowdownCommandRelay` (`showdown-command-relay.ts`); 60s turn clock →
  AI fallback. The guest ships from its own CommandPhase (installs the responder;
  `command-phase.ts` `tryShipShowdownGuestCommand`). Requests arriving before the
  responder installs are BUFFERED (mirrors co-op #812), not dropped.
- **Rendezvous barriers:** reciprocal, points `showdown-ready` /
  `showdown-wager-commit`. Pick wait = `getShowdownPickWaitMs()` (600s live / 50ms
  under vitest).
- **Escrow / settlement:** `workers/er-save-api` (showdown-escrow routes, staging
  live). Settlement = mutation records applied client-side, idempotent via a
  persisted ledger. This was heavily reviewed and APPROVED earlier; leave it unless
  a report points at it.

## Where the code lives

- Phases: `src/phases/` — `showdown-result-phase.ts`, `showdown-enemy-faint-switch-phase.ts`,
  `coop-guest-faint-switch-phase.ts`, `coop-replay-phases.ts`, `coop-replay-turn-phase.ts`,
  `command-phase.ts`, `turn-init-phase.ts`, `turn-start-phase.ts`, `faint-phase.ts`,
  `switch-phase.ts`, `switch-summon-phase.ts`, `encounter-phase.ts`,
  `select-starter-phase.ts`, `showdown-vault-pick-phase.ts`.
- Data/logic: `src/data/elite-redux/showdown/` — `showdown-side-swap.ts`,
  `showdown-command-relay.ts`, `showdown-session.ts`, `showdown-manifest.ts`,
  `showdown-team.ts`, `showdown-stakes.ts`, `showdown-item-pool.ts`,
  `showdown-legal-moves.ts`, `showdown-settlement.ts`, `showdown-escrow-client.ts`,
  `showdown-telemetry.ts`, etc.
- Co-op substrate showdown rides on: `src/data/elite-redux/coop/` —
  `coop-runtime.ts` (stall watchdog, relay wiring), `coop-interaction-relay.ts`
  (faint-switch seq band `COOP_FAINT_SWITCH_SEQ_BASE`, faint-switch WINDOW pin,
  resync-rescue), `coop-battle-sync.ts` (#812 buffering), `coop-battle-engine.ts`,
  `coop-renderer-gate.ts`.
- UI: `src/ui/handlers/showdown-wager-ui-handler.ts`,
  `showdown-command-ui-handler.ts`, `starter-select-ui-handler.ts`,
  `src/ui/battle-info/{player,enemy}-battle-info.ts`.
- Workers: `workers/er-save-api/` (escrow), `workers/er-telemetry/`.
- Plan/design docs: `docs/plans/2026-07-06-showdown-mode-design.md` +
  `2026-07-06-showdown-mode-implementation.md` (ARCHITECTURE RESET + ADDENDUM
  sections are binding).

## The gates (run before EVERY commit/deploy)

1. `npx tsc --noEmit | grep -c "error TS"` must be **301** (not 277).
2. Gated showdown suite: `ER_SCENARIO=1 npx vitest run test/tests/elite-redux/showdown/`
   — baseline **302** tests as of HEAD.
3. Co-op regression (showdown shares replay/checkpoint/turn/faint code):
   `ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/` — **778 passed, 1
   skipped**. NOTE: full-dir ER_SCENARIO runs are `isolate:false` and can show
   FLAKY failures from cross-file globalScene contamination + parallel-resource
   contention (the docs call this out). If a suite fails in a big combined run,
   RE-RUN IT IN ISOLATION before believing it — this session had several false
   11-failure scares that were all green solo.
4. biome: pre-commit `biome:staged` is the real gate (it passes). Do NOT run bare
   `pnpm biome` (reformats ~700 files vs stale main). Bare `biome check` reports
   pre-existing `noVoid`/complexity at info-level — ignore those.

## The harnesses (mandatory per CLAUDE.md — use them, don't guess)

- **Two-engine duo harness** `test/tools/coop-duo-harness.ts`: boots a real HOST +
  real GUEST BattleScene over a loopback in one process. THIS is where every co-op /
  versus sync/desync/stall bug MUST be reproduced first. Showdown tests:
  `test/tests/elite-redux/showdown/showdown-duo.test.ts`,
  `showdown-versus-faint.test.ts`, `showdown-versus-host-faint.test.ts`,
  `showdown-guest-real-boot.test.ts`, `showdown-versus-summon-desync.test.ts`,
  `showdown-result-teardown.test.ts`. Read the harness header — ClientCtx atomic
  swap rules, globalScene citizenship afterEach restore, stall-throw pattern.
- **Render harness** `test/tools/render-ui-page.test.ts`: for any UI/visual change
  (golden-image gated). TITLE/animation transitions are out of scope (force-completed
  tweens) — fall back to a state assertion there.
- **Combat scenario runner** `scripts/run-scenario.mjs`: single-engine combat
  behavior (abilities/moves/etc.).

## Deploy recipe (staging)

```
cd C:/Users/Hafida/pokerogue/.worktrees/showdown
OLD=$(git rev-parse HEAD)
git fetch heraklines feat/elite-redux-port --quiet
# if remote moved, re-detach onto it and cherry-pick your commits (range: remote..OLD)
git push heraklines HEAD:feat/elite-redux-port
export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"   # never print it
gh workflow run deploy-staging.yml --ref feat/elite-redux-port -R Heraklines/elite-redux
```
The remote branch `feat/elite-redux-port` moves constantly (other agents push). Always
fetch + re-detach + cherry-pick your local commits on top before pushing. Staging is
live ~2-3 min after dispatch; tell the maintainer to hard-refresh both clients.

## Reading live tester logs

```
export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"
git -c credential.helper='!f(){ echo "username=x"; echo "password=$GH_TOKEN"; };f' fetch heraklines dev-logs --quiet
git log --pretty='%h %ci %s' -8 heraklines/dev-logs
git show --name-only --pretty='' <commit>
git show heraklines/dev-logs:<path>
```
Co-op/versus sessions land as TWO back-to-back commits (host + guest) seconds apart —
ALWAYS read both. Identify role with `grep -m1 -oE "role=(host|guest)"`, build with
`grep -m1 "\[ER\] build"`. The console ring buffer keeps only the last ~6 waves, so a
faint that happened minutes before the "Send Logs" press may have rolled off — the
exact moment isn't always captured; reproduce in the harness instead.

## Fix history this session (context for the next report)

All shipped to staging, each with a red-proofed harness test:
1. Guest double-launch (title EncounterPhase + stale enemyPartySync adopt) → skip both
   for versus guest.
2. Guest lead never summoned (loaded encounter assumes resume) → versus guest gets a
   real SummonPhase + singles ToggleDoublePosition (`encounter-phase.ts`).
3. Side-swap didn't flip `player` flag → guest's team was EnemyPokemon
   (`showdown-side-swap.ts`).
4. Faint replacement: guest picks its own, host awaits it
   (`showdown-enemy-faint-switch-phase.ts`, `faint-phase.ts:257`).
5. Faint-switch vs stall-watchdog clash + resync-rescue killing the pending pick →
   faint-switch WINDOW pin suppresses the 20s watchdog; resync rescue spares the
   `COOP_FAINT_SWITCH_SEQ_BASE` band (`coop-interaction-relay.ts`, `coop-runtime.ts`).
6. Guest didn't open a command turn after its OWN faint-replacement (entered replay
   with a stray inert; co-op seat map pointed at empty slot 1) → resolve the guest's
   active slot in `coop-replay-turn-phase.ts`; + #812 buffer for showdownCommandRequest
   in `showdown-command-relay.ts`.
7. Turn-1 / switch-in abilities: guest DERIVED on-entry abilities locally
   (side-asymmetric innate gating → guest conjured weather/chip the host lacked) →
   early-return the versus guest in `post-summon-phase.ts` +
   `post-summon-activate-ability-phase.ts`. (Switch-in abilities are checkpoint-HEALED
   for correctness; live ANIMATION of the ability on the guest is a DEFERRED cosmetic —
   see below.)
8. Ghost opponent trainer sprite orphaned onto the title after a match (`reset()` drops
   the ref but never removes the field container) → explicit `field.remove(trainer,
   true)` in `showdown-result-phase.ts`.
9. Host-faints direction: guest opened its next command before the host's replacement
   rendered (guest command opens off its own TurnInit, before the replacement
   checkpoint applies) → defer the versus-guest command in `turn-init-phase.ts` when
   the enemy field is empty; TurnStart's pump opens it after the checkpoint (HEAD,
   `244cffecd`).

## Known deferred / open items (NOT yet done)

- **Switch-in ability ANIMATION on the guest** (cosmetic): the effect is correct on
  both screens, but the guest may not play the ability's pop-up for a mid-battle
  switch-in (the `delta===0` tween-skip at `coop-replay-phases.ts:339`). Oracle-classified
  as Phase-2 cosmetic. Maintainer was asked if it bugs her; awaiting word.
- **Different-locale clients**: connect-time `movesName`/`abilitiesName` fingerprint
  mismatch is EXPECTED and cosmetic (German guest vs English host — localized name
  tables differ; mechanics tables match). Do NOT chase it. Verified it doesn't affect
  mechanics.
- **Deferred follow-ups** (from the implementation plan): vanilla mega form icons
  in-game (loading-scene), berry/type-booster/vitamin item families (generator-keyed),
  replay-loader tooling polish, i18n keys for showdown strings, host clock visual
  countdown.
- **Ops (capacity RESOLVED 2026-07-22):** the account is on the Workers Paid plan,
  so D1 is 10GB/db and the free-tier 500MB/db cap is gone. `er-saves` measured at
  **431 MB (~4% of 10GB)**, `er-saves-staging` at **68.7 MB**. Saves are now stored
  UNCOMPRESSED (the gzip that existed only to fit the 500MB cap was removed; reads
  stay back-compat with legacy `GZ1:` blobs). No capacity watch needed.
  Telemetry writes to a separate `er-telemetry` DB.
- **Maintainer-gated:** production worker deploys + prod site deploy
  (`deploy-prod.yml`) — NEVER without explicit permission. The `/devtest/*` save-API
  worker route activation is also maintainer-only.

## Standing rules you must follow (from CLAUDE.md)

- Every observable-in-game bugfix gets an in-game dev test-suite scenario
  (`src/dev-tools/test-suite/scenarios.ts`). Two-client netcode bugs that aren't
  single-player-drivable get a `(note)` entry (that's the established pattern for
  showdown).
- Co-op/versus sync bugs → reproduce in the duo harness FIRST.
- UI/visual changes → render harness before + after.
- Combat behavior → the scenario runner with an `expect` block.
- ER 2.65 Pokédex is the source of truth for move/ability/stat/type data.
- No em dashes in player-facing text.
- Never touch `main`. Work + deploy from `feat/elite-redux-port` only.
