# Co-op Authority V2 progress audit handoff (2026-07-21)

## Read this first

Repository/worktree:

```text
C:\Users\Hafida\pokerogue\.worktrees\codex-coop-v2-integration-20260720
```

Read the root `AGENTS.md` and `CLAUDE.md` before doing anything. In particular: do not run co-op Vitest,
browser journeys, campaigns, or soaks locally. Local verification is static only. Run co-op workloads on
GitHub-hosted runners and inspect their artifacts. The worktree has widespread line-ending noise; use
`git diff --ignore-space-at-eol`, stage named files only, and never stage `.artifacts/`.

Working branch and push target:

```text
local:  codex/coop-v2-integration-20260720
remote: heraklines/ci/coop/v2-showdown-command-coordinate-20260720
push:   git push heraklines HEAD:ci/coop/v2-showdown-command-coordinate-20260720
```

The local upstream is intentionally/unhelpfully pointed at the integration branch, so always push explicitly.

## Exact state at handoff

Implementation tip before this document: `dd8a190c67529ab746643a18c14740a4f72affa7`.

Current named branch tips observed during this audit:

```text
coop/integration-20260718: 125f6edb2f8dcf8ab352cddab59112c3c9617228
feat/elite-redux-port:     c71757615d96457de5405eeb107be76ce8611cab
```

The working branch contains 80 commits beyond integration. It is still 34 feature commits behind the current
feature line and has merge base `bcca4844c0a65cc0857dfdd5a7ee496f6bdd5880`. Any final candidate must merge
the then-current feature tip and requalify the merge result; qualification before that merge is not release evidence.

No staging or production deployment was performed.

## What the stale review got wrong now

The supplied review was useful but stale. Its four implementation findings have moved:

1. Guest proposal exactly-once identity is implemented (`563fb465c`, `68e9b9519`, `03b35986a`) with exact
   proposal identity and authority-side deduplication.
2. Recovery/wave and multi-command control cycles were addressed (`c6ff32f6b` and follow-ups).
3. Broad direct reward/biome/Mystery successor acceptance was removed (`a42985840` and later exact Mystery work).
4. The all-V2 ordinary graph now has a global log, typed successors, address-exact control proof, retained receipts,
   proposal leases, and cutover-native interaction application.

The review's process finding remains valid: staging promotion is still policy-gated, not machine-gated. The deploy
workflow seals the ref/SHA and enables all V2 flags, but it does not require exact successful gate/campaign/nightly
run IDs through a qualification manifest. Add this before calling promotion bulletproof.

Legacy authority code also remains behind cutover flags and has not all been deleted. Six-player membership and
transport are not implemented: session/controller/transport still fundamentally model one peer and two seats even
though several log/control types are more general.

## Work completed in this audit

### 1. Real public faint/replacement race fixed

Commit: `4c84f39fe66168050bcf58fdfc4fc20d5a5ddaef`

The two-browser faint journey at prior SHA `898ee7fca` failed because the guest's committed replacement closed its
picker asynchronously. The exact trace showed:

```text
guest replacement commit admitted
picker close begins
material retry still deferred
TurnInit -> local CommandPhase parks on stale target
replacement checkpoint buffers 7 ms later, behind CommandPhase
```

The production fix in `src/phases/coop-guest-faint-switch-phase.ts` now records the exact picker terminal and retries
the already-admitted V2 entry before `shiftPhase()`. TurnInit therefore sees the complete replacement carrier and
routes through replay rather than manufacturing local command control.

The public browser harness also stopped inferring replacement ownership from a host `SwitchPhase` log. Only the
semantic `party:replacement` surface with exact local/owner seat and actionability may select the browser to drive.
Static failure-first contracts were added in `test/browser/coop-public-ui/authority-v2-gate-contract.test.mjs`.

Real two-browser proof is GitHub run `29832035821`, exact SHA `4c84f39fe`, journey `faint-replacement`, guest-owned,
normal cadence. It was still running when this handoff was written. Inspect the final artifacts even if green.

Prior failing artifacts:

```text
C:\Users\Hafida\.codex\tmp-coop-artifacts-20260721\run-29829246957
```

### 2. Mystery PhaseInterceptor false deadlock fixed

Commit: `c30f49faf185c9fcd5682354932aa13f0b2c0155`

The earlier C1/C3 failure was not a product Mystery softlock. The soak explicitly opened the real
`MysteryEncounterPhase` public UI, then a shared helper called `to("MysteryEncounterPhase", true)` again. The
interceptor only remembered a global `interrupted` state, not which phase object owned it, and waited for the caller
to end the UI that the caller could not drive until the await returned.

`PhaseInterceptor` now records the exact interrupted phase object. A run-target request reuses only that exact
already-open object and never reruns it. A matching phase name with stale state is insufficient. The remote gate
proved the correction: C1/C3 logged `Reusing already-open MysteryEncounterPhase public surface`; the old timeout
disappeared in all three reproductions.

### 3. Next Mystery one-process scheduler omission fixed

Commit: `dd8a190c67529ab746643a18c14740a4f72affa7`

After item 2, C1/C3 advanced to a new failure:

```text
guest ME shop handoff FAILED: the running CoopReplayMePhase never queued its production reward tail
```

This was also a harness omission. With destination-context delivery active, rev N+1 reached the guest as a gap while
rev N's real Mystery surface was being installed. The guest emitted a `tailRequest`, but `startGuestMeShopOwner`
pumped only the guest event loop 16 times. The request remained queued for the host. Real browsers execute both
event loops concurrently.

The helper now accepts an exact reciprocal `pumpPeer` callback, and the continuous soak alternates host and guest
while preserving ordinary V2 ordered admission. It does not inject a revision, call private progression, or bypass
control proof.

New failure artifacts proving the progressed frontier:

```text
C:\Users\Hafida\.codex\tmp-coop-artifacts-20260721\run-29832264711\C1
C:\Users\Hafida\.codex\tmp-coop-artifacts-20260721\run-29832264711\C3
```

The repository contains `.github/workflows/coop-soak-focused.yml`, but GitHub does not register it on the default
branch. Both attempted focused dispatches returned HTTP 404. Do not claim focused validation. Either land/register
that workflow on the default CI line or use the full sharded gate.

## Current remote evidence

Full gate `29832264711`, exact SHA `c30f49faf`, completed red:

- Green: static/type/format, fast public UI and Authority V2 contracts, immutable browser bundle, browser-native
  WebRTC/rejoin, all four P33 mutation shards, S1-S8, T1-T4, C2/C4/C5, P1, B13.
- C1/C3: the old phase-interceptor timeout is gone; both reached the reciprocal-pump failure fixed by `dd8a190c6`.
- A1: three stale V2-incompatible fixtures remained in the preceding gate (raw catch-full proposals without exact
  operation identity and a learn-move spy signature mismatch). Classify/update them; do not waive blindly.
- Most B shards and P2 remain red from a mixture of legacy fixtures and potentially useful regressions. Use each
  job artifact to classify by exact test; do not call the whole lane noise.

Earlier full gate `29830757143` at `3bca247f` and `29828806124` at `3ea2a9a60` are useful comparison points.

The branch-focused gate will fail immediately on the frozen P33 ownership/schema check because this long-lived
integration branch contains accumulated P33 changes outside its focused manifest. That known planner failure is not
product evidence. The full gate does validate the exact SHA.

## Immediate next steps

1. Check real faint run `29832035821`. If red, download compact/full artifacts and continue from its first exact
   public frontier. If green, record that `4c84f39fe` fixes the production race and driver misrouting.
2. Run the full sharded gate on the handoff tip (which includes `dd8a190c6`) and first inspect C1/C3. Expected result:
   the guest replay consumes the re-delivered ME terminal and queues the production reward tail. If it advances to
   another red, diagnose that named mechanism from artifacts before changing code.
3. Classify A1, every red B shard, and P2 into:
   - production defect;
   - V2-incompatible legacy fixture needing migration;
   - genuine infrastructure/harness failure.
   Fix tests that assert retired legacy authority instead of weakening V2 behavior.
4. Run current two-browser campaign profiles only after the relevant focused mechanisms are green. Require at least
   surface, Mystery-heavy, faint/replacement, save/resume, reconnect/recovery, market, and depth evidence.
5. Merge the current `feat/elite-redux-port` into the integration candidate, resolve carefully, freeze one SHA, and
   repeat the full gate plus browser campaigns on that merged SHA.
6. Add a machine-verifiable staging qualification manifest and an explicitly labelled unqualified-development
   override. Do not deploy production.
7. After two-player closure, redesign membership/transport for N peers before claiming six-player readiness. Do not
   extrapolate `localSeat === 0 ? 1 : 0` or one-remote-peer assumptions.

Useful commands:

```powershell
gh run view 29832035821 -R Heraklines/elite-redux --json status,conclusion,jobs,headSha,url
gh run view 29832264711 -R Heraklines/elite-redux --json status,conclusion,jobs,headSha,url
gh workflow run coop-gate-sharded.yml -R Heraklines/elite-redux --ref ci/coop/v2-showdown-command-coordinate-20260720
gh run list -R Heraklines/elite-redux --branch ci/coop/v2-showdown-command-coordinate-20260720 --limit 10
```

## Honest readiness assessment

Authority V2 is now substantially more coherent than the attached stale audit suggested: the main proposal,
successor, recovery, receipt, and interaction building blocks are present, and Showdown/triples plus WebRTC and
mutation protections are strong. It is still HOLD for a stable staging acceptance checkpoint because the exact
current SHA lacks a green complete gate and green representative campaigns, the feature merge is pending, and the
promotion gate is not machine-enforced.

Do not convert those evidence gaps into a percentage-based claim of “bulletproof.” The correct closure criterion is
one merged immutable SHA with no production-owned red, representative two-browser campaigns green, exact artifacts,
and a promotion workflow that verifies those same run IDs and V2 flags.
