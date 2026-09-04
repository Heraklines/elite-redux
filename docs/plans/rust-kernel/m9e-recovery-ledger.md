# M9E recovery execution ledger

## Source and resource boundary

- Recovery base: `5c21f3dc9e899a0d1902ee3637af1b58a29fbd24`, published engineering tip verified 2026-09-04.
- Work branch: `wrk/m9e-recovery-20260904-source`. Original engineering branch and historical tag are untouched.
- Fresh shallow, blob-filtered, non-cone sparse checkout; no submodules or LFS hydration.
- Source-only local work. Workspace-local editor automatic build/check tasks disabled. No applicable instruction files or active commit hooks found in this checkout.
- The downloaded bootstrap was read completely. Windows rejected its unsigned script; equivalent reviewed Git commands performed the bootstrap without changing execution policy.
- User handoff: `M9E_fresh_agent_remote_only_handoff.md`, prepared 2026-09-04, supersedes historical completion claims.
- No deploy, production defaults, legacy saves, new provider/runner, rollout, or G53 work authorized by this recovery.

## Tasks and evidence

| ID | Owner | State | Production path / required behavior | Positive / negative witness | Remote target |
|---|---|---|---|---|---|
| F0 | integrator + independent feedback reviewer | READY_REMOTE | Read-only isolated push workflow, exact SHA, cumulative impact selection, bounded summaries | actual nonzero canonical tests / any build, execution, count or unmapped-scope failure fails job | M9E Focused Feedback; `cargo test --locked -p er-canonical --lib --bins --tests` |
| A0 | current-entry lane | IN_PROGRESS | Actual CLI accepts current V2 content and owns a V7 natural session | title to mode selection via raw input / invalid historical snapshot rejected | `cargo test --locked -p er-cli --test m9e_current_entry` |
| A1 | integrator + current-entry lane | READY_IMPLEMENTATION | Connect environment, CLI, worker, batch, replay and browser to existing V7 | non-key-inclusive browser trace through normal CLI / first-divergence test | depends on F0 and A0 |
| B0 | causal lane | IN_PROGRESS | Existing typed timer purpose reaches real reducer, repeat/restore/pauses | real raw held navigation / release, stale generation, overflow | focused kernel regression after platform mapping |
| D0 | independent feedback reviewer | REVIEWED_TRIGGERS | Safe recovery branch triggers | 65 existing workflows inspected; no matching deploy/full-gate trigger or workflow_run chain | no local test execution |

## Focused feedback scope

The first run proves remote readiness only. It is not a gameplay qualification.
The committed map derives reverse dependencies including target/build/dev dependencies
from Cargo manifests remotely. Comparison remains cumulative from the reviewed base,
so a canceled source run cannot be hidden by a later docs-only push. Unknown source
inputs widen native selection and fail planning; shared/Wasm/browser boundaries fail
closed until executable platform checks are added. They must not appear as native-only
green evidence. This is a staged first deliverable, not a complete integration gate.

Cache downloads and compiled native tests are separate. Every candidate recompiles as
needed and runs the enumerated binaries; cached green statuses are never evidence.
Full logs, per-test identities and artifact hashes remain remote. Retrieve named compact
artifacts only after checking their size. Format patches and compile-once distribution
remain subsequent measured work.

## Continuation

1. Push F0 alone; record exact candidate/run/counts and retrieve bounded summary.
2. Run real CLI current-entry negative baseline, then implement the shared-session cutover.
3. Add dependency-ready timer/effect/retention repairs with explicit platform coverage.
4. Continue handoff checkpoints 1–5; do not call this checkpoint M9 completion or tag it.

No corrected final tag or qualification claim is made here.
