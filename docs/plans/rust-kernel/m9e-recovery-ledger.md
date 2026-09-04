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
| B0 | causal lane | REVIEWED_NEXT | Existing typed timer purpose reaches real reducer, repeat/restore/pauses | real raw held navigation / release, stale generation, overflow | focused kernel regression after platform mapping |
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
| `f3e711336fe249cde763f19d48313be1fbb72cde` | `33924006886` | format-only failure | 21 harness regressions, 10 selected native tests and one V7 Wasm parity test passed, including session completion rollback. Full native reverse cone compiled. Remote format patch applied in `e4064db`. Compact artifact 4,747 compressed bytes. |
| `e4064dba1c8001724eefb715ab01b62a1eab610a` | `33924401642` | PASS | Format, 21 harness regressions, 10 selected/executed/passed native tests and one V7 Wasm parity test; full native cone compiled, facade Wasm check passed. Compact artifact 2,940 compressed bytes. |
| `52866a27514b6c330dd4abdfb045510eeb780c63` | `33925063385` | compile + format failure | 28 harness regressions passed. Two new browser-test comparisons used MenuOptionId as a string; production host compiled, but no tests executed. Remote 20,842-byte format patch applied and typed comparisons corrected in `3969554`. Compact artifact 10,100 compressed bytes. |
| `3969554e6dc2c9fe7a19b9acdb5cd49f667a610f` | `33925332115` | format-only failure | 28 harness regressions; 24 native tests, one V7 Wasm parity test, two Chromium journeys and one typed-effect test all passed. er-web clippy passed. One test closure required a one-line formatting correction, returned remotely. Compact artifact 5,143 compressed bytes; browser assets retained remotely. |

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
Native build: 92,613 ms; two existing test binaries used 129,022 and 282,641 ms.
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
Formatting correction candidate `e4064dba1c8001724eefb715ab01b62a1eab610a`
passed remote verification in run `33924401642`.

## Browser delegation entering focused verification

`BrowserKernelHostV2` now owns `CurrentGameSession` and delegates all existing
initialization forms and typed events. Mutable requests stage only the session;
projected effects, response encoding/size check and repro delta finish before
commit. Retained response history is outside that transaction. Read-only requests
encode from the live session. Sequence advancement and cache eviction are prepared
before reduction. No browser protocol or content schema changed.

Two private host tests cover late response-size rejection and sequence exhaustion,
including unchanged full snapshot, replay bookkeeping and cached response bytes.
Two integration tests cover direct session/browser event parity and rejected-request
retry behavior. All four new browser tests passed in run `33925332115`; the formatting
correction still requires an entirely green exact candidate.

Browser changes and future shared-session edits select all er-web, er-env and er-cli
tests, native/Wasm V7 parity, er-web clippy, the existing two Chromium host journeys,
and the existing typed effect-router test. Remote browser asset hashes bind to the
candidate; full generated assets and browser traces stay remote. Browser release
Wasm, native debug outputs, test Wasm, tool binaries, dependency downloads and
Chromium downloads have separate cache identities. Native cache v2 stores only debug
outputs. Failed checks may preserve compiled artifacts, but every candidate must
recompile as needed and execute tests; no stored passing status is accepted.

The Chromium spec executes the real generated V7 Wasm host with DOM keyboard input
and direct same-page host byte relay. It does not exercise production Worker/WebRTC
topology. Browser repro remains the existing raw-only capsule with base replacement
after non-key events. Complete causal replay, native reload worker, batch/replay
consumers, causal timer/effect/retention repairs and fault-injected qualification
remain outstanding. This is still a partial current-entry recovery, not checkpoint 1
completion or final M9 qualification.

Next bounded consumer cut: `er-kernel-worker/src/{main,protocol,runtime}.rs` and
`er-lab/src/kernel_reload/{endpoint,types,supervisor}.rs`. The process currently
boots ABI V1 and owns V6/V1 content through `GameEnvironment`; current operation
needs typed V7/V2 session ingress and corresponding reload clients, with ABI V1
explicitly retained for historical compatibility. Do not copy two old semantics:
`handle_checked` assigns accepted sequence before request success, and ExportRepro
pairs a post-event snapshot with the earlier trace. The current path needs staged
response completion and a preceding replay checkpoint. Require a real spawned
current worker and a CLI/browser/worker non-key trace, then generation-replacement
acceptance. Existing worker tests alone certify only the historical ABI.

## Browser focused pass and worker candidate

Exact candidate `b7e2266cfbe774664a7737160c90727a71e4a030` passed run
`33926691832`: 28 harness selftests, 24/24 native tests (zero failures/skips),
one Wasm parity test, two Chromium journeys, one typed effect-routing test,
formatting, and er-web Clippy. Only the named 4,335-byte compressed summary
was retrieved. Harness SHA-256:
`0933b1a7634fa758b5e97aec6ebea7dd7e77f80725aafd1f3e8f918a4af11a59`.
Selected native IDs SHA-256:
`204aa05153d8c1bd92ab632fb633060949eef53c14e6e26b0d5588946da48317`.
The comparison baseline advances to this validated candidate. Native build
took 97,077 ms; `er-web:m9e_host_v2` execution took 333,386 ms; browser build
took 283,088 ms. No production Worker/WebRTC claim follows from this pass.

The next candidate adds explicit ABI2 bootstrap dispatch to the actual native
worker, with V7/V2 initialization, typed current events, observation, snapshot,
restore and disposal through CurrentGameSession. Failed requests retain the
accepted sequence and state; responses are serialized before commit. ABI1
remains explicit compatibility. Current causal repro export is explicitly
unsupported pending the complete preceding-checkpoint/event trace contract.
Two actual-process tests cover natural controls/time, typed effects, disposal,
invalid content/event/sequence recovery and genuine V6 snapshot rejection.
Their source/artifact markers are synthetic; they do not certify an artifact
manager or reload swap. Successful V7 continuation and current reload acceptance
remain outstanding. Independent source review found one test panic lint, fixed
before submission, and no other blocking transaction or framing issue.

Worker-only feedback compiles the complete native reverse dependency cone and
executes worker, CLI and the two named historical reload compatibility targets,
then worker Clippy. A parsed full-lock guard accepts only the three existing
workspace dependencies added to er-kernel-worker. Five additional harness
selftests exercise mapping and lock failures. All candidate execution is pending
remote verification; no local builds, tests, formatting or installations ran.

Worker candidate `7a329cc5c02175ac05a0d06ed5c25ac5d0dd50bb`, run `33928482002`,
passed 33 harness selftests and all 22 selected native tests, including both
actual ABI2 process witnesses and explicit ABI1 compatibility. The run failed
only formatting and Clippy's large initialization-enum finding (3,832 bytes).
The 12,567-byte compact artifact supplied a 30,127-byte formatting patch;
source correction boxes the two large initialization fields without changing
their JSON representation. The comparison baseline remains the green browser
candidate until a complete worker run passes.

A third process witness extends pending verification to genuine natural raw
startup into Active, restoration of that V7 checkpoint into generation 2,
fingerprint/generation/session spoof rejection, and complete ordered effect,
observation and snapshot equality through presentation outcomes, time and raw
navigation. Both generations run the same candidate executable; this does not
certify changed-rule acceptance, a supervisor swap, or complete causal repro.
