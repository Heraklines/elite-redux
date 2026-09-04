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
| F0 | integrator + independent feedback reviewer | VALIDATED | Read-only isolated push workflow, exact SHA, cumulative impact selection, bounded summaries | actual nonzero tests / build, execution, count or unmapped-scope failure fails job | M9E Focused Feedback; validated integration run `33921848212` |
| A0 | current-entry lane | VALIDATED | Actual CLI accepts current V2 content and owns a V7 natural session | real V2 rejection baseline, then four positive/negative executable witnesses | `er-cli::m9e_current_entry` at `e79aa6a` |
| A1 | integrator + current-entry lane | PARTIAL_VALIDATED | Current environment and CLI use V7; worker, batch, replay and browser delegation remain | four CLI witnesses passed; non-key-inclusive browser replay still pending | integration run `33921848212`; next transaction prerequisite |
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

1. Validate the single-stage session completion transaction and CLI delegation remotely.
2. Delegate BrowserKernelHostV2 to this session while preserving rollback through response encoding; see `m9e-browser-session-next.md`.
3. Connect remaining normal consumers and causal replay, then add timer/effect/retention repairs with explicit platform coverage.
4. Continue handoff checkpoints 1–5; do not call these checkpoints M9 completion or tag them.

## Remote runs

| Candidate | Run | Result | Exact scope |
|---|---|---|---|
| `b427d952c6f3c2b07de045f4acca0748ac27632d` | `33920083121` | workflow rejected | Job-level runner context unsupported; moved report path to step env. No runner started. |
| `74bcaea727110a3f235a6ff07a282f35de83c387` | `33920260169` | PASS | F0 readiness: 30 selected/executed/passed, zero failed/skipped; format check passed. |
| `c33a0503ff97a92486f83a136a151547670e0fe4` | `33920552315` | format failure | 13 feedback harness regressions passed; scoped remote formatting patch returned and applied. |
| `e9c4aa464794e93fd5f5cd4da15c95028732c32b` | `33920701633` | target-selection failure | Fixed binary-only Cargo selection from `--lib --bins --tests` to `--tests`; no game test ran. |
| `8909544f6184c61b0193c62a1d1a279dd941ffde` | `33920832537` | EXPECTED RED | 6 CLI tests executed: 4 historical pass, 2 new current-entry failures. Actual agent rejects V2 `guaranteed` content field via V1 loader. |
| `a887f7831179c7a6548a6dfc34fa7ef554307f17` | `33921183079` | format failure | A1 remote patch exceeded initial 24 KB allocation; compact budget increased within total 64 KiB ceiling. |
| `ef2881daa1b143107937e1e1c5e7a63a0508e2d2` | `33921362838` | superseded | Replaced by compile-plus-format feedback on same recovery branch. |
| `03ec01438ba4871c27e82b95ee244e16d6d1137d` | `33921419907` | historical audit + format failure | A1 and full native cone compiled; 447 enumerated, 82 executed, 81 passed, one historical M3 audit failed. Remaining tests did not run. Remote 26,292-byte formatting patch returned and applied. |
| `e79aa6a51c7ccc9b6364a33399cc2874e1e034fb` | `33921848212` | PASS | Format, 16 harness regressions, 446 native selected/executed/passed, zero failed/skipped, one explicitly excluded historical audit; current facade Wasm compile check and one V7 Wasm parity witness passed. All four actual current CLI witnesses passed. |

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
The historical JSONL request-ID window still needs safe retry retirement. The next
transaction patch removes the adapter's extra clone and preserves rollback through
fallible response preparation. These are implementation tasks, not external blockers.

Historical audit disposition: `m2_api_bypass::m3_audited_production_surface_matches_frozen_manifest`
requires the old oracle/M3 ancestry and frozen production blobs; it is not a current
M9 ownership test. The published M9 workflow already excludes this exact test in
shard 16. Focused feedback mirrors that one exclusion, reports its name/reason
separately, and still executes the other 12 tests in that binary. No blanket skips,
golden digest rewrites, or changes to the published qualification workflow are made.
The normal CLI V7 positive/negative executable witnesses supply the new entry evidence;
this does not replace the full current source-fidelity acceptance required by the handoff.

No corrected final tag or qualification claim is made here.

## Validated integration baseline and focused transaction follow-up

Run `33921848212` completed in 14m24s at exact candidate `e79aa6a51c7ccc9b6364a33399cc2874e1e034fb`.
Named compact artifact: 1,828 compressed bytes; full diagnostics remain remote.
Rust 1.97.1, Linux x86_64, default features, test profile with debug information disabled.
Native build: 92,613 ms; two historical test binaries used 129,022 and 282,641 ms.
Harness SHA-256: `82fd73437655c2ca960e169652b8c27c645446c78c9b94cee17f54298a197aad`.
Selected native IDs SHA-256: `4c74db30e020a6e0b452934eabff06720d325738b9f6bfb8306368797a324acc`.
Full summary SHA-256: `6750784f2947bf5fae987152a2b86abdc228ebf9459bf48ec70103760903153d`.

The cumulative comparison baseline advances only to that validated SHA. For changes
confined to the three explicitly mapped current session/CLI files, compile the full
native reverse dependency cone but execute all er-env and er-cli targets plus native
and Wasm V7 parity. Built-only targets are listed separately and never counted as
executed or passed. Any additional Rust path disables this narrow execution scope;
unknown or shared/browser changes continue to fail closed pending explicit mapping.

The follow-up stages one session copy, applies the event, validates, and prepares the
adapter response before committing. A fifth test exercises completion rejection and
successful retry directly through the session; it is not a fifth CLI subprocess test.
Exact scheduler construction, active-state construction and existing proposal/material
ingress prepare browser delegation. This API change does not itself migrate the browser.
Remote validation for this follow-up is pending.
