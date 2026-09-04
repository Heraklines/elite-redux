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

## Remote runs

| Candidate | Run | Result | Exact scope |
|---|---|---|---|
| `b427d952c6f3c2b07de045f4acca0748ac27632d` | `33920083121` | workflow rejected | Job-level runner context unsupported; moved report path to step env. No runner started. |
| `74bcaea727110a3f235a6ff07a282f35de83c387` | `33920260169` | PASS | F0 readiness: 30 selected/executed/passed, zero failed/skipped; format check passed. |
| `c33a0503ff97a92486f83a136a151547670e0fe4` | `33920552315` | format failure | 13 feedback harness regressions passed; scoped remote formatting patch returned and applied. |
| `e9c4aa464794e93fd5f5cd4da15c95028732c32b` | `33920701633` | target-selection failure | Fixed binary-only Cargo selection from `--lib --bins --tests` to `--tests`; no game test ran. |
| `8909544f6184c61b0193c62a1d1a279dd941ffde` | `33920832537` | EXPECTED RED | 6 CLI tests executed: 4 historical pass, 2 new current-entry failures. Actual agent rejects V2 `guaranteed` content field via V1 loader. |

F0 report: `m9e-summary-74bcaea727110a3f235a6ff07a282f35de83c387`, 1,250 compressed bytes.
Rust 1.97.1, Linux x86_64, test/default features. Format 3,339 ms; build 5,683 ms;
execution 3 ms. Run creation to completion 53 seconds. Harness SHA-256
`f9844ade250d7a2167d51760465467035ad3f4bce783ca693eb1b8a93d3a5a68`;
content manifest SHA-256 `aa8da070c2f929dc4e9903d4adf0455e164d5980d9be506ce5700267cd187698`.
All complete evidence remains in the named remote diagnostics artifact.

Next patch adds real CLI red witnesses and 13 stdlib remote harness regression tests.
Source formatting patches are produced on the runner and the original candidate
restored afterward. Test binaries run from their Cargo manifest directory.

## A1 implementation scope entering remote verification

Current V7 facade in `er-env::current::CurrentGameSession` now owns typed raw,
time, network, transport, storage and presentation ingress, staged failure,
structured observation, snapshot/restore/fork/disposal and shared prepared V2 content.
Normal `er-cli agent` routes to this facade; `agent-v6` explicitly retains historical
compatibility. Four current executable witnesses are committed for remote validation.
The affected native reverse dependency cone is selected; the new facade must also
compile for Wasm and the existing native/Wasm V7 eventwise witness must pass.
Tool binaries and Wasm/native outputs have separate caches.

This does not finish A1: native reload worker, lab/batch/replay and browser host still
need this shared session. Natural CLI setup is currently solo; transport-capable
sessions require snapshots until natural co-op configuration is wired. No real
Worker/WebRTC/storage topology is certified by the focused Wasm witness.
The historical JSONL request-ID window still needs safe retry retirement, and the
current adapter stages an extra clone before serialization. These are implementation
tasks, not external blockers.

No corrected final tag or qualification claim is made here.
