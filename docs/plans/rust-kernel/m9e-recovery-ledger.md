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

Candidate `2affd3f9f19e337c01d6ba400fd532634facf94d`, run `33929343581`,
passed all 23 selected native tests, including the third actual worker
restoration/continuation witness, and worker Clippy. Only one test formatting
line failed; the compact artifact was 4,234 bytes. Worker process tests took
111,541 ms. Its remote formatting patch is applied in the endpoint candidate.
The baseline remains `b7e2266` until a fully green exact candidate.

## Current reload endpoint entering verification

The additive lab endpoint launches a read-only verified executable reference,
performs the ABI2 sequence-zero handshake, and returns typed current results.
It validates response addresses, kinds, sequences and observation identity.
Typed faults preserve the accepted frontier; uncertain writes, reads or invalid
responses fence the endpoint. One bounded I/O queue covers write/read deadlines.
Disposal requires acknowledgement and child exit while stdin remains open.
Only finished pipe threads are joined; exceptional delayed OS reaping is moved
off the caller thread. This is not an unconditional zero-resource proof under
arbitrary OS failures. Executable containment/hash are rechecked before launch;
the producer's source/build labels and immutable-directory contract remain
explicit, not independent executable self-attestation.

Two actual endpoint tests bind the non-test worker executable discovered from
the exact Cargo build, its SHA-256, product SHA, target and profile. They compare
two processes and the direct current session through raw/time events, rejected
presentation outcomes, V7 restore and disposal. Two separate Linux fault-peer
tests verify bounded rejection/reaping for silence and malformed framed JSON;
they are not current game execution evidence. All four require remote execution.

Focused endpoint feedback compiles the reverse cone plus the worker, executes
worker/CLI/current endpoint/fault and historical reload targets, and runs worker
and lab Clippy. Required executable discovery fails on absent or ambiguous
non-test Cargo artifacts. The five worker metadata environment variables are
supplied only to the actual endpoint target. Four added harness tests bring the
source inventory to 37; none ran locally. Full Q will need equivalent explicit
worker binding when corrected qualification is prepared; its workflow remains
unchanged during focused implementation.

Still outstanding after this endpoint slice: activation supervision through
current tools, batch/replay migration, complete causal input/effect retention,
timer consequences, co-op/persistence/fidelity/control work and corrected Q.

Endpoint candidate `c84b0553ce3ecf29d87f81864b8a75aaa5759805`, run `33929854075`,
compiled and bound the actual non-test Cargo worker artifact (73,016,248 bytes;
SHA-256 `640e0f358be68cc5ccf919f32a2ce36ee51e906b34fe6c139df2869a6842e8b5`).
Its two fault tests rejected malformed dummy content hashes before spawning;
the other 25 selected tests were not executed after that failure. The exact
32,012-byte formatting patch exceeded the original compact cap by 12 bytes.
The cap was raised to 32 KiB, retaining the 48 KiB patch/diagnostic total bound.

Follow-up `e6112d6eebe45a398220785563564293c82fc247`, run `33930530515`, passed
both transport fault/reaping tests and the artifact rejection test. Its actual
endpoint continuation test returned Kernel(Invalid) before worker launch because
the direct fixture supplied no save slots; bootstrap_catalog explicitly requires
a nonempty list. Both direct and worker fixture initialization now use the same
preview slot. The 13,849-byte named compact artifact included the full 32,012-byte
remote formatting patch, applied without local formatting. These are fixture
corrections; endpoint functional/Clippy completion still requires the next run.

## Current worker/endpoint focused pass; B1a candidate

Exact `c2c3ca6383762cc411582e089e2cf26e1caf20d6` passed run `33930869104`:
37 harness selftests, all 27 selected native tests, formatting, worker Clippy
and lab Clippy. The 3,909-byte named compact artifact binds the same worker
executable hash listed above to this exact source/build invocation. Harness
SHA-256: `34b9dda375d1c83a3bf9ab05abfe84eaa9c83c588e170542c93a7f3ad8ce1a17`.
Selected native IDs SHA-256:
`9f630db5928c43ac436a80542c5bfef72ecd0316d1cf3b8a4d664bdb71445d82`.
Actual endpoint tests took 33,088 ms; worker tests 111,314 ms; fault peers
214 ms. The cumulative comparison baseline advances only now, to this SHA.

B1a implements active held keyboard/gamepad navigation at 250 ms intervals.
Elapsed time dispatches due consequences chronologically with endpoint/timer-ID
tie ordering, respects independent pause reasons, and admits successor timers
within the same advance. Release, blur, obsolete menu ownership, blocking
presentation, load and terminal paths retire repeats. Snapshot validation
cross-checks physical/logical/repeat/timer ownership and globally unique IDs.
Unknown due timer purposes fail explicitly; this slice implements navigation
only. Exhausted IDs remain exhausted. The 1,024-consequence bound and rejected
directional navigation preserve the complete public-kernel snapshot.

Nine behavioral tests share one genuinely natural active checkpoint and cover
timing/effects, chunking/restore, key/gamepad release and suppression, menu
changes, pause reasons/ties, corrupted ownership, exhausted allocation and
budget/unsupported-purpose failures. Independent review found and corrected
horizontal-navigation mutation before rejection, duplicate IDs across seats,
an ignored must-use cancel result, test lint issues and missing preview slots.
Ten fresh V7 constructors now start allocator zero; restored None is unchanged.

B1 focused feedback requires five named current kernel targets with actual
test inventories, state/protocol regressions, all current native adapters and
worker endpoints, native/Wasm parity and the existing browser witnesses. After
ordinary checks pass, a separate remote build removes only the due timer's
button consequence. Exactly one cursor/effect test must compile and fail its
specific assertion; unrelated failure or an unexpectedly green mutant fails
the gate. Source hashes and a clean exact candidate are checked before/after
restoration; mutant outputs are isolated and deleted. Seven additional harness
tests bring the pending inventory to 44. No B1 test or mutant ran locally.

Performance limitation: public advance_time and active directional presses
stage for direct-call atomicity; CurrentGameSession currently stages them again.
Transaction reuse remains a measured optimization task, not a claimed speedup.
The source-only current supervisor and acknowledged-context binding are queued
separately and are not included in this B1 commit or its evidence.

### B1 first remote feedback and explicit timer parity

Candidate `7910ab85b8964e037e6a24a1210ad6bbcec6c83f`, run `33931362507`,
failed at the existing native eventwise golden after 542 passing tests and one
failure (543 executed of 560 selected, zero skips). Compilation succeeded.
The five required kernel targets were inventoried, but the nine timer tests
were not reached before the alphabetical parity failure. Wasm, browser and
the behavioral mutant were not reached. The compact artifact was inspected
before download: 5,539 bytes; full diagnostics remain remote.

The frozen parity digest changed from `ee3f694f9f766c2a8e730fbad3c81d533b0ce39dd97c7e673da3f67478cd584b`
to `ec51f4cd7f6e6232054583b9208ce28fb3bb84e0559258932109c82234552beb`.
Source comparison confirms that the fresh scheduler changed from exhausted
None to Some(0); full snapshot digests include that field and subsequent
directional timer allocations. Gameplay/control assertions passed. The next
candidate retains those assertions and additionally checks that allocation
matches directional presses and no repeats remain after releases. Its golden
is explicitly tied to this observed native result, with independent Wasm
confirmation still mandatory. The boosted three-wave fixture remains synthetic.

A separate six-event parity trace starts from a genuinely natural active
checkpoint without stat edits. It holds Down, advances 249/1/250 ms, releases,
then advances 500 ms. Independent cursor/effect assertions and complete
midpoint-restored step/snapshot equality accompany the parity report. Native
and the Wasm JSON export must emit the same full-record digest; the focused
gate requires both exact test names per platform and rejects absent, duplicate,
malformed or mismatched digests. This is kernel/JSON parity, not real browser
clock or transport proof.

Formatting is still pending. The first patch exceeded the compact bound;
the next report uses minimal diff context and bounded complete-file patches,
with omitted bytes recorded. No local formatter or test has been run.
The current-supervisor CI mapping is prepared but inert until its separate
source cut is committed. Baseline remains the last fully green `c2c3ca6`.

### B1 native, Wasm and browser pass; formatting-only correction

Candidate `d1e6da9d6118c57a42e9c4bec126f606cfdc5ee2`, run `33932418436`,
executed all 561 selected native tests: 561 passed, zero failures/skips. This
includes all nine timer regressions and the five required current kernel targets.
Both exact Wasm tests passed, both Chromium journeys passed, and the typed-effect
test passed. Worker, lab and browser Clippy passed. The only failure was format;
the mutation phase correctly did not run while formatting was still failing.

Native/Wasm held-timer report digest:
`9002fe7f032760abb343efebeb6b0a75a74c10578d3e38bdf21fc205cf4b650e`.
Harness SHA-256: `fee9125c8ded700dcf70936bbb34a74da7216f34ec6ea6e801d2b00a04d17bd8`.
Selected native IDs SHA-256:
`5e83fa16946c157b392746ed6175ed04fa9d847c30126d406c84651260b9ff8e`.
Inspected/downloaded compact artifact: 12,516 bytes. Browser assets and full
diagnostics stayed remote. Timings: build 112,106 ms, native browser-host target
335,460 ms, native timer target 3,071 ms, Wasm eventwise 97,242 ms, browser build
310,695 ms and Chromium journeys 39,163 ms.

The remote format patch totaled 38,959 bytes. The compact patch carried 29,677
bytes for four complete files. Its bounded diagnostic excerpt also contained
all 13 formatting blocks for the omitted Wasm test file. Those exact remote
edits were matched uniquely and applied as text; their resulting Git patch is
9,282 bytes, exactly the reported omitted byte count. No local formatter ran.
Only these five formatting changes and this ledger are staged for the next
candidate. The independent supervisor, normal-command, and B2 presentation
patches remain uncommitted and are excluded from B1 evidence.

### B1a complete focused gate; supervisor/budget candidate follows

Candidate `7557e92eb1873314370013980e81132a8605489f`, run `33934326265`,
passed the complete focused gate: 561/561 native tests, zero failures/skips;
2/2 exact Wasm parity tests; 2/2 Chromium journeys; 1/1 typed-effect test;
formatting and worker/lab/browser Clippy. All nine held-navigation regressions
ran. The native/Wasm timer digest remained
`9002fe7f032760abb343efebeb6b0a75a74c10578d3e38bdf21fc205cf4b650e`.

The isolated timer mutant compiled and failed exactly the intended cursor-effect
assertion (exit 101, one failed test, zero passed/skipped). Mutant status:
`detected`; source hash before/after restoration:
`698318e68b134b7bdb0955ff9060f3190a28be601818e16619c0771d498fa7c6`.
This failure is successful mutation detection, separate from ordinary pass
counts. Mutant build took 40,815 ms and execution 2,820 ms.

Harness SHA-256 `fee9125c8ded700dcf70936bbb34a74da7216f34ec6ea6e801d2b00a04d17bd8`;
selected IDs SHA-256 `5e83fa16946c157b392746ed6175ed04fa9d847c30126d406c84651260b9ff8e`.
Actual worker executable SHA-256
`3f2d2c6ae3090265e6b0089dcb83f5c59a171a278440946fdf87d70d6567f649`,
73,767,208 bytes, bound to this source SHA. The named compact artifact was
3,969 bytes, inspected before download. Diagnostics (92,330 bytes) and browser
assets (4,234,375 bytes) were not downloaded. The comparison baseline now
advances to this fully passing candidate. Browser evidence remains in-page
Wasm/byte relay, not production Worker/WebRTC certification.

Next submitted cut: acknowledged current-worker context, bounded process
supervisor with exact-preservation replay, and negotiated precommit success
response caps inherited across generations. Nine actual supervisor tests and
five worker process tests are prepared; runtime execution remains pending.
Independent source review found no blockers. Required native process targets
and worker/lab Clippy stay mandatory. Future utility mappings and CLI Clippy
are inert until their source is submitted separately.

The focused workflow also offers a separately named source formatting repair
patch only when the routine compact patch omits files and the full repair fits
256 KiB (the handoff's failure-diagnostic budget). Inspect its size and summary
SHA before any necessary transfer. Routine summaries keep the existing 64 KiB
budget; full diagnostics/assets remain remote. No local formatter executes.

Preserved uncommitted subsequent work: normal terminal utilities; actual normal
JSONL worker/reload adapter and two process tests; replica presentation delivery.
The following causal capsule is designed but not implemented. These are not
covered by the B1 pass. Full M9 remains incomplete; no deployment, final-tag
change, production-default change, or legacy player-save access has occurred.

### Supervisor/budget preflight correction

Run `33935654690` at `579e7a839f3013720fda00b0068c40588fdab197` stopped
before product compilation: 53 harness selftests passed and one failed.
The broad environment-plus-ordinary-CLI regression still used `main.rs`, which
is now explicitly mapped by the separately prepared utility scope. The actual
selection correctly retained browser/Wasm coverage in its focused scope. The
test now uses unmapped historical `m72.rs` so its unchanged assertions continue
to verify the broad fallback, browser and Wasm requirements. No production
assertion or gate was relaxed. The inspected compact artifact was 2,763 bytes;
full diagnostics remained remote. Baseline remains fully passing `7557e92`.

### Supervisor remote compile/format repair

Run `33935940054` at `fcfe58e9dee45cebad5544c7d573b11a24a7f767` passed
harness preflight and selected the exact native supervisor scope. Compilation
then found one E0308: the new `reach_active_battle` test helper declared Result
but omitted its final `Ok(())`. Added that return; no product tests executed in
this run. The remote formatter also produced a 53,062-byte patch. The optional
named repair artifact was inspected (10,021 compressed bytes), downloaded, and
its exact SHA-256 verified as
`74615d9f1a84d8170dbd1d05d08ade58608d36b1f926c5a8a59a0216a37e1747`
before applying its six complete source-file edits. Compact summary: 10,559
bytes. Full diagnostics stayed remote; no local formatter/build/test ran.
Baseline remains passing `7557e92`; unrelated CLI/B2 changes remain excluded.

### Current supervisor and response budget verified; utilities submitted

Run `33936401079`, exact candidate
`f8f69832749cc389f8853f9fa1de04f1ae0fb237`, passed all 38 selected/executed
native tests, zero failures/skips. Required targets: endpoint 2, supervisor 9,
worker process 5. Formatting and worker/lab Clippy passed. The principal reload,
retention, stale preparation, context, retirement and effectful response-budget
rejection/retry/inheritance witnesses all executed. This is exact-preservation
process reload, not intended semantic-change acceptance or complete causal export.

Harness SHA-256 `d8f13301cef6ec685a69fb23e446ba619205667bbe693a4e4af758211f377a0e`;
selected IDs SHA-256 `521fcd9ada5663288e5a5cdeedce1d8664ec73cd6c064ed16cb1bece89220912`.
Actual executable SHA-256
`4e41c4f8d8ac83876bc114ba3a2b3c8beb296be4e47e7565f5a99fe68cdf3951`,
73,863,936 bytes, source-bound to this candidate. Inspected compact artifact:
4,108 bytes. Diagnostics (21,926 bytes) stayed remote. Build 94,141 ms;
supervisor tests 264,379 ms; worker process tests 111,147 ms. Baseline advances
to this fully passing checkpoint.

Next candidate migrates normal `new-run`, `resume`, `simulate` and
`inspect-content` to the current V7/V2 session, preserving explicit `-v6`
aliases. New-run is natural Title, file/input reads are bounded, time is typed,
and platform results are never fabricated. Two added actual executable tests
exercise these routes and held-repeat simulation through the natural journey.
CurrentStart uses boxed profile/snapshot values to keep its enum size bounded
when CLI Clippy becomes mandatory; serde JSON shape is unchanged. Focused
selection preserves native current-entry and both Wasm parity witnesses.

The actual JSONL worker/reload adapter, strict CLI lock/artifact gate and two
actual-process tests remain uncommitted for the following independent cut.
B2 now also has an extended existing Chromium journey checking replica
presentation vectors/settlement and exact duplicate snapshots; it remains
unverified and outside the utility candidate. Full M9 remains unfinished.

### Normal utilities: native pass and bounded lint repair

Candidate `05393d4d47d2f150cf5fcb25da5c70635f9aabd1`, run `33937060679`,
passed all 13 selected/executed native tests (zero failures/skips), including
seven actual CLI entry witnesses and both native parity tests. It failed
formatting and mandatory CLI Clippy: historical WarmCliSessionV1 stored a
5,744-byte GameEnvironment inline. Both session variants and their five
constructors are now boxed; borrowed calls and serde output remain unchanged.
The existing CLI-wide execution scope also admits this exact compatibility
module path. No lint allowance or test assertion was weakened.

Applied the complete 19,094-byte remote format patch for current_commands.rs
and m9e_current_entry.rs. Inspected compact download: 10,115 compressed bytes;
full diagnostics (22,849 bytes) stayed remote. Build 42,945 ms; current CLI
witnesses 28,489 ms; native parity 10,081 ms. Wasm was not reached after Clippy
failed. Baseline remains fully green f8f6983; utilities are not yet qualified.
Worker/reload and B2 edits remain excluded from this repair candidate.

### Normal current utilities verified; actual CLI reload submitted

Candidate `da73baacc6cfc57b0a7ce78b484d48d666851fb6`, run `33937641185`,
passed all 13 selected/executed native tests, both Wasm parity tests, formatting,
and CLI Clippy (zero failures/skips). Native and Wasm held-timer digest matches
`9002fe7f032760abb343efebeb6b0a75a74c10578d3e38bdf21fc205cf4b650e`.
Harness SHA-256 `d8f13301cef6ec685a69fb23e446ba619205667bbe693a4e4af758211f377a0e`;
selected IDs SHA-256 `e1d4876c3c6ff3a53c20d0895044615ff4056b598bfc5eb3d1a5ff37d7b29a2e`.
Build 42,197 ms, actual current CLI tests 29,333 ms, native parity 10,282 ms,
Wasm execution 62,755 ms. Inspected compact artifact 2,541 compressed bytes;
diagnostics 14,777 bytes remained remote. Baseline advances to this exact pass.

The next candidate connects the normal JSONL current agent to the verified ABI2
worker/supervisor with optional executable/root/identity configuration. It adds
bounded begin/activate reload, failed-candidate preservation, monotonic ticket
IDs, live timer-tail replay, fork, restore and bounded retirement reporting.
Two actual CLI/worker executable tests assert full state and effect results,
artifact/ticket rejection categories, continued held-timer behavior and restore
invalidation. The unchanged default remains the in-process current V7 backend.

The focused gate strictly accepts only the paired er-cli manifest/lock addition
of the already locked workspace worker. It binds the exact non-test Cargo worker
artifact during both test discovery and execution; requires nonempty current
CLI/reload, worker, endpoint, supervisor and parity targets; preserves native
and Wasm parity plus CLI/worker/lab/protocol Clippy. Seven added harness tests
cover guards and failure handling. Independent source review found no blockers;
remote validation remains pending. B2 replica effects stay outside this cut.

Next after reload and B2: implement complete causal capsule export/replay and
normal batch execution. Batch protocol names currently exist without normal
agent handlers; the historical er-batch V1 library still owns DeveloperSession.
Reuse CurrentGameSession with shared V2 content, staged all-or-nothing batch
results and bounded aggregate responses. Full M9 remains incomplete.

### CLI reload interrupted; bounded process witness and early format feedback

Candidate `d415db11e2739ada6aa09819297e389df053487f`, run `33937932009`
attempt 1, was terminated when the runner received a shutdown signal (exit143).
All artifact and cache-save steps were skipped. No completed product result is
claimed. A HEAD request inspected the single job log size (31,229 bytes); only
an HTTP206 final8,192-byte excerpt was retrieved. It shows compile completion,
test discovery, prior target progress and entry into the two CLI reload tests,
then explicit runner shutdown. Complete logs and build assets were not fetched.
One unchanged-candidate retry was started; this repair supersedes it through
the existing same-branch concurrency policy. Shutdown cause remains unproven.

Independent source review found avoidable O(events * full snapshot) retention
in the new CLI process test: full expected Values, a cloned request list, entire
stdout bytes and all parsed responses. The test now retains canonical full-JSON
result digests and checks one bounded response at a time. Every original event,
snapshot, scenario and rejection assertion remains; explicit field/error checks
stay structural. Stderr is continuously drained with a64KiB retained prefix.
A dedicated test CLI process group is killed/reaped on failure to collect its
worker descendants. This resource correction does not assert a runner diagnosis.

Formatting now returns its bounded source repair immediately, before compilation
or process tests. Previously a known format failure waited through long tests,
and the interrupted run lost that repair entirely. Updated two harness tests
require zero executed product tests on format failure and exact scoped patch /
source restoration. Final passing candidates still require every selected test,
Clippy and platform gate; no test count or timeout is relaxed. Baseline remains
fully qualified `da73baa`. Only this test/feedback repair is submitted now.

B2 remains unstaged with native+Chromium delivery tests and two isolated compiled
behavioral mutants (existing timer plus replica presentation omission). Current
capsule recorder/replay, browser host and TS transport integration are also
unstaged and unverified. Parent is wiring normal replay and session.from_capsule;
actual browser-to-CLI witness and focused gate are still required. Full M9 is not
complete; no deploy, final-tag change or legacy player-save access occurred.

### Early format gate returned the complete CLI repair

Run `33939479499`, candidate `c7886b5866a3ef2c288906e2a4fc3ae19a9e6e98`,
passed harness preflight and stopped at formatting with zero product tests, as
intended. Format check and repair took3,322ms each. Inspected/downloaded compact
artifact8,985bytes and named repair9,070bytes; the complete47,903-byte source
patch was verified against SHA-256
`5edf2079ef918d14e393a53a0c12e7eb046dee8400e9910591067922fd516b6e`
before applying its four complete CLI source/test edits. Full diagnostics stayed
remote. The repair includes the bounded streaming process witness; future B2 /
current-capsule sources remain excluded. Remote full reload validation is next.

Correction to preceding retry note: d415 run33937932009 attempt2 had already
ended with exit143 before the c788 push; it was not canceled by that push.
Its artifact steps again produced no report. No full test pass is claimed for
either terminated attempt; da73baa remains the qualified baseline.

### Current capsule source and cross-entry witnesses prepared

While `e9442e69139ad5adfebcdf3d69e05abd27957890` runs the formatted,
bounded actual CLI reload gate (`33939661739`), the next capsule sources have
independent source review. No capsule execution pass is claimed. Shared recorder
tests cover nine cases; the native Rust browser host exports into two actual CLI
process tests, including optional worker import, failed-ID reuse, fork isolation
and continued raw/time input. Production browser capture may rotate at its bound;
the witness checks absolute positions and retained recent non-key evidence instead
of demanding an unbounded natural journey history.

The first existing Chromium journey is extended in the worktree to export a
capsule from actual Wasm and invoke the normal native `replay` command through a
verified non-test Cargo artifact. The helper compares the full final snapshot
and observation, then removes a time event, repairs positions and requires a
causal divergence at that position. CLI output, runtime and cleanup are bounded.
The B2 version of this browser test is staged separately; the capsule extension
will not be included in B2. The pending capsule gate must bind both actual worker
and CLI artifacts, enforce exact existing-workspace dependency additions and run
native, Wasm, Chromium and typed effect witnesses.

Source contracts and limits are in `m9e-current-repro-next.md`. Admitted read-only
host requests preserve capture even when their response exceeds its cap; invalid
admission attempts mark a gap even if labelled Snapshot/ExportRepro. Capsule
build/executable identity, all adapter-failure replay, production download/upload
wiring, minimization and continued CLI recording remain outstanding.

The source-only retention investigation in `m9e-retention-next.md` confirms the
current material lifetime cap and missing duplicate-proposal reply recovery;
no retention repair has been implemented or qualified. Full M9 remains incomplete.

### CLI reload timeout is now captured; diagnostic repair next

Candidate `e9442e69139ad5adfebcdf3d69e05abd27957890`, run `33939661739`,
passed format and 36 native tests, then the two-test `m9e_current_reload` target
exceeded its unchanged 600-second limit. One test printed a completion dot; the
terse log cannot identify which one. No pass is claimed for that target, the
remaining eight selected tests, Clippy or Wasm. All 44 tests were enumerated with
required crate-qualified target counts. Baseline remains fully green `da73baa`.

The inspected compact artifact was4,490compressed bytes; diagnostics24,231bytes
remained remote. The243-byte failed-target excerpt contains both tests' over60s
notices and one dot. Build107,717ms; supervisor266,109ms; worker114,382ms; current
entry48,757ms; reload600,003ms. This completed report distinguishes an actual
target timeout from the earlier runner shutdowns, without establishing its cause.

Source review found no definite pipe cycle. The natural reference and worker
journey perform repeated validation, hashing and serialization, and the test still
has blocking response/EOF/exit waits. Add uncaptured bounded phase/progress
diagnostics and response/exit deadlines while keeping all events and assertions.
Execute this required target first after full discovery in its explicit reload
scope; the remaining inventory must still execute before a passing result. No
timeout increase or reduction in qualification is authorized by this repair.
B2 and capsule changes remain excluded from the diagnostic candidate.

### Actual current CLI reload qualified; shared menu cost repair next

The diagnostic source first returned format-only feedback in run33941274988,
candidatee1feec06565c21dbf19a12ea1cf7e3b06a3f5545: zero product tests, complete
9,452-byte source patch in a7,021-byte compact artifact, no omitted patch files.
Applied that remote patch only to the reload test.

Candidate `5cbba49ec726fe6e4260f11ad9acfc7ad40c1d10`, run `33941386739`,
passed all44 selected/executed native tests, both Wasm tests, formatting and
CLI/protocol/worker/lab Clippy. Zero failures/skips. The unchanged held-timer
native/Wasm digest is9002fe7f032760abb343efebeb6b0a75a74c10578d3e38bdf21fc205cf4b650e.
Harness SHA-256682f48ad6af886e6c7c22bda982892bbffbc440c7e0622d301b32b3367bd0799;
selected IDs SHA-25680d737d5ba85bb828217fd56881c751bc553db1bb660819ba42ebdc525cdbf6b.
Inspected compact2,426bytes; diagnostics34,281bytes remained remote. Build74,035ms,
actual CLI reload402,712ms, supervisor148,926ms, worker65,555ms, current entry28,409ms,
native parity9,938ms, Wasm70,018ms. Both actual reload tests passed. Baseline advances
to this exact candidate and run.

The result does not prove the earlier timeout was a deadlock or attribute the
speedup to the reader change: unchanged worker/supervisor targets also ran faster
on this runner. Source review independently found quadratic visible-option scans
in `GameMenuV2::validate`. The next isolated cut replaces repeated scans with a
borrowed visible-ID set, preserves error precedence and adds five domain tests.
See `m9e-menu-validation-next.md`. Its gate covers current native tools, the full
shared compile cone and Wasm/Chromium boundaries; B2 and capsules stay excluded.
No menu performance improvement is claimed before remote measurement. Full M9
remains incomplete; batch, retention, full failure replay and final qualification
still require implementation and evidence.

### Shared menu native witnesses pass; historical types lint repair

Candidate `b2b32edb8cc13cb9960f653c78045e229a2913e6`, run `33942520353`,
passed all 680 selected/executed native tests with zero failures/skips, including
five menu tests and both actual CLI reload tests. Formatting and CLI Clippy
passed. Types Clippy then found 14 existing unwrap calls in historical
`er-types/tests/m4_types.rs`; later lint, Wasm and Chromium checks did not run.
The small repair adds explicit expect messages while preserving all assertions
and includes that exact test path in the menu gate. No lint suppression or
reduced test inventory is introduced. Baseline remains fully green `5cbba49`.

Inspected and downloaded compact artifact 4,501 compressed bytes; the 96,386-byte
diagnostics artifact remains remote. Harness SHA-256
`3c34e167119924029dfb028e68c6737039496206b35da77c2e3f2a82620e587b`;
selected IDs SHA-256
`bba162b11cac9471b30938b725f6772ac366c544fa8e3434c128e8d744369588`.
Build 139,430 ms; actual CLI reload 584,096 ms; supervisor 231,659 ms;
worker 98,639 ms; current browser host 246,806 ms. The menu test target took
4 ms. The native timer parity digest remains unchanged. These runner timings
do not demonstrate a speedup from the menu optimization; full qualification
and any controlled performance comparison remain outstanding.

### Shared menu qualification passed; submit replica effects

Candidate `823bcc3522683c3f9903b1e521e2a7cd3c551701`, run `33943804197`,
passed all 680 selected/executed native tests, both Wasm parity tests, both
Chromium journeys, the typed effect-route test, formatting and all required
CLI/types/protocol/worker/lab/browser Clippy checks. Zero failures/skips. The
workflow completed successfully in 33 minutes 31 seconds. Baseline advances to
this exact candidate and run. The historical types repair changed assertion
messages only. The five menu semantics tests passed; unchanged canonical timer
parity remains `9002fe7f032760abb343efebeb6b0a75a74c10578d3e38bdf21fc205cf4b650e`.

Inspected/downloaded compact artifact 4,340 compressed bytes. Diagnostics 107,724
bytes and browser assets 4,239,714 bytes remain remote. Harness SHA-256
`3c34e167119924029dfb028e68c6737039496206b35da77c2e3f2a82620e587b`;
selected IDs SHA-256
`bba162b11cac9471b30938b725f6772ac366c544fa8e3434c128e8d744369588`.
Content manifest SHA-256
`aa8da070c2f929dc4e9903d4adf0455e164d5980d9be506ce5700267cd187698`;
oracle `399d5d368f0b5642ebf8f45bd8a5e73350fa4de7`.
Browser asset manifest SHA-256
`cad7b125e85686dd018079482bc2a0ef9adea9a96c37651f6102edadcab773ec`.
Worker executable SHA-256
`22a3bff369cbc4dd4aaa7db63d439406d96cd8c3b4bbb146842f0466be9f39a5`.

Build 143,384 ms; CLI reload 556,966 ms; supervisor 232,150 ms; worker 96,042 ms;
current host 258,966 ms; Wasm eventwise 73,758 ms; browser build 313,482 ms;
Chromium journeys 23,377 ms. These uncontrolled runner timings do not prove a
menu speedup; the source complexity improvement preserves behavior but requires
separate controlled performance evidence. Chromium remains two Wasm hosts with
in-page byte relay, without production Worker/WebRTC or renderer qualification.

The next isolated B2 cut delivers exact replica presentations once, suppresses
all duplicate delivery effects, preserves private snapshots on duplicates and
rolls back ownership collisions after material application. It retains authority
storage ownership and adds native/browser witnesses plus a compiled replica
presentation-omission mutant alongside the existing timer mutant. See
`m9e-replica-effects-next.md`. Capsules, current batch code, dependency changes
and the prepared early-lint ordering repair are excluded from this submission.
Those source-reviewed future cuts remain unqualified; full M9 is incomplete.

### Replica gate returned its complete formatting repair

Candidate `2000be4e3508f97c569f5c56cded2969c896da6c`, run `33945436561`,
passed harness preflight and stopped at formatting before selecting or executing
product tests. The complete 11,462-byte patch covers only the kernel delivery
function and cooperative witness. Inspected/downloaded compact artifact 7,514
compressed bytes; 9,631-byte diagnostics remain remote. Format check/repair took
3,372/3,322 ms. Applied the complete remote patch, committed
`9459b9cbce2eebc7cc4800569160d6d2eedc6856`, and started run `33945799459`.
No B2 execution pass is claimed yet; baseline remains qualified `823bcc3`.

While that cut runs, current capsule source is preserved as an isolated tree
excluding all batch edits; the future capsule gate also moves native Clippy
(including browser-host Clippy) after complete test discovery and validation but
before native execution. It preserves the complete selected inventory on lint
failure, with zero tests executed, and still requires all native/platform checks
on success. The batch core/CLI and exact success-envelope admission have source
review, with six core, two actual CLI and three protocol witnesses. They await
separate remote qualification after capsules; no local workload was executed.

### Replica qualification passed; submit current causal capsules

Candidate `9459b9cbce2eebc7cc4800569160d6d2eedc6856`, run `33945799459`,
passed all 568 selected/executed native tests, both Wasm parity tests, both
Chromium journeys and the typed effect-route test, with zero failures/skips.
Formatting and the required worker/lab/browser Clippy checks passed. Both
compiled behavioral mutants were detected by the exact intended assertions:
timer and replica each executed one test, exited 101 with one failure, and
restored source SHA-256
`48cf5addd7eaaa7a4329f453e43d68a5d119b7f5b60a7592bf6e2be6bdd30bf4`.
The supervisor target was build-only in this scope; its prior menu execution
remains separate evidence. Workflow duration was 25 minutes 2 seconds.
Baseline advances to this exact candidate and run.

Inspected/downloaded compact artifact 4,227 compressed bytes (13,923-byte JSON).
Diagnostics 100,678 bytes and browser assets 4,238,951 bytes remain remote.
Harness SHA-256 `db2f536620b67bc407476f6e3ceddaedff36b21aa6a6a10d60eaba82e5ddf155`;
selected IDs SHA-256
`6eb49e460fc9e04b53007b9b699933d809d1fbb848cf32a2608c284306c97745`.
Content manifest SHA-256
`aa8da070c2f929dc4e9903d4adf0455e164d5980d9be506ce5700267cd187698`;
oracle `399d5d368f0b5642ebf8f45bd8a5e73350fa4de7`.
Native/Wasm timer digest remains
`9002fe7f032760abb343efebeb6b0a75a74c10578d3e38bdf21fc205cf4b650e`.
Worker executable SHA-256
`61a977866fda33c5cb56e3ca2897ad10e04920e56b6849aeaf8481a55575d49f`;
browser asset manifest SHA-256
`d93124da057e9d74f6db19413d47f2c376e0f116944f2796d8849d375e0c63bb`.
Build 92,226 ms; CLI reload 462,023 ms; worker 76,841 ms; host 195,515 ms;
Wasm eventwise 60,869 ms; browser build 247,365 ms; Chromium 17,469 ms.
Mutant build/execute timings: timer 35,515/2,220 ms, replica 34,958/2,270 ms.
These uncontrolled timings establish no performance claim. Chromium covers
Wasm hosts with in-page byte relay, not production Worker/WebRTC/rendering.

The next isolated cut adds bounded current causal capsules with full typed
attempts, checkpoints, absolute positions, browser transport generations,
rejected-attempt evidence, isolated replay, normal CLI replay/import and current
browser export/import. Nine core and two real CLI witnesses plus the actual
Chromium/Wasm-export-to-normal-CLI bridge are required. The gate runs native
lint after complete inventory validation and before native execution. Capsule
wire bounds fit the existing default browser request/response limits. Current
batch, protocol success-envelope additions and retention/AI/performance source
investigations remain excluded and unqualified. No local workload was run.
Full M9 remains incomplete.

### Capsule preflight passed; complete remote formatting repair applied

Candidate `53332a3b8b837583ad8cb2f5c1d9ff432746b459`, run `33947140563`,
passed harness preflight and stopped at formatting before selecting/executing
product tests. Compact artifact 12,181 compressed bytes was inspected/downloaded.
Its formatting excerpt omitted four files, so the separately named repair
artifact was inspected (21,721 compressed bytes) and downloaded. Full patch
125,091 bytes, SHA-256
`11eef98ab73af4d95a8e9d32bb7aefe2b4f97716003eac9bd4a46c2bc2ca83c5`,
was verified and applied to all eight capsule-owned Rust files. Diagnostics
49,851 bytes remain remote. Batch CLI edits were retained through a clean
three-way source merge; the submitted index contains only the capsule repair.
Baseline remains qualified `9459b9c`. No capsule execution pass is claimed.

### Capsule compiler correction

Candidate `e7e9f36e4897ce47e653118e815358ec57806fa1`, run `33947259124`,
passed formatting and reached remote compilation. Build stopped after 68,547 ms
on a test-only attempt to push a character into validated GameContentBundleHash.
The same expression existed in the core witness; both now parse a valid different
blake3 hash and assert the content identity actually differs. This preserves the
intended replay content-identity rejection rather than relying on malformed input.
Zero product tests selected/executed. Compact 4,329 compressed bytes downloaded;
15,973-byte diagnostics remain remote. Baseline remains qualified `9459b9c`.

The hash fixture correction candidate `a29696510b478959f8a4f5bef5148da02d1e3a33`,
run `33947489507`, returned one complete 646-byte formatting patch for the core
assertion. Applied as returned. Compact 3,583 compressed bytes downloaded;
6,144-byte diagnostics remain remote. Zero selected/executed product tests.

### Capsule execution candidate and independent source preparation

Candidate `b58d5908ed5f4a311564d68b87a863c6af27cd69` is running in
`33947601082` (job started 2026-09-05 05:35:25 UTC). No capsule pass is
claimed pending the final compact result. The normal index is empty; future
batch code remains separate. Its exact source-only tree is preserved in
`.git/m9e-batch-tree.txt` and `.git/m9e-batch-next.patch` (133,730 bytes), based
on b58d5908e. The saved batch gate still requires advancing to an actually
qualified capsule baseline before submission. Its analogous validated-hash
fixture compile mistake has also been corrected in that source-only tree.

Source review identified an invalid core-test assumption that all natural starter
navigation remains in a bounded capsule forever. A separate proposal at
`.git/m9e-repro-fixture-next.rs` replays a real Title-to-Mode prefix and a declared
real active checkpoint's held-time suffix independently, with natural raw-input
setup between them. It preserves all nine core test IDs and actual browser/CLI
full-natural capture witnesses. The actual test is unchanged while the run ends.

The recorder currently serializes the full retained capsule twice after each
append. An isolated exact byte-accounting proposal and independent encoder-boundary
helper live at `.git/m9e-repro-byte-accounting-next.rs` and
`.git/m9e-repro-byte-accounting-test-next.rs`. They are not applied or measured.
Review covers import/rotation/cache gaps, decimal width, browser generation and
escaped text. No codec/schema change or performance claim is implied. The
current platform boundary source investigation is recorded separately in
`m9e-platform-boundary-next.md`; it remains unimplemented and unqualified.

### Outer timeout identified; capsule accounting and fixture correction

Run `33947601082` on `b58d5908ed5f4a311564d68b87a863c6af27cd69` was
cancelled at the 35-minute job limit. Compact summary upload failed because the
harness finally block did not run. The named 31,039-byte diagnostics artifact
was inspected but not downloaded. Its full files remain remote. After inspecting
the 40,442-byte job log size, retrieved only the final 8,192 bytes through HTTP
206 explicit range 32250-40441. Suffix-range requests were not honored and their
bodies were not read. Existing GitHub keyring authentication was used; Desktop
credentials were not read.

The bounded log identifies execution progression: CLI reload began 05:45:24.808
UTC, two actual CLI capsule tests began 05:54:37.582, and nine core capsule tests
began 06:01:03.925. Cancellation occurred 06:10:38.736, about 575 seconds into
the core target, before its 600-second limit. Phase transitions show the CLI
capsule target completed in about 386 seconds and reload in about 553 seconds.
No full native/Wasm/browser qualification or completed core-target result is
claimed. Native execution had passed complete inventory validation and required
lint. The baseline remains qualified `9459b9c`.

Apply the reviewed core fixture with separate replayed real Title-to-Mode and
real active held-time checkpoints; natural bootstrap setup still uses actual raw
inputs. Actual browser/CLI full-natural capture tests remain. Apply exact cached
JSON byte accounting to avoid serializing retained history twice per append.
Independent full-encoding tests cover exact and one-byte-short bounds, decimal
positions, escaped Unicode origins, rejection, import, rotation, gaps and a real
accepted retained protocol generation 9-to-10 transition. Nine core and fourteen
host test IDs remain. The schema, capture limits and replay validation do not
change. This is a source complexity correction; the interrupted run is not a
controlled speedup measurement.

Also repair compact progress checkpointing so an outer interruption preserves an
explicitly unfinished summary with source identities, completed prefix counts
and the active phase/target. Final normal summaries must replace it; no timeout
or execution limit is increased. All execution remains remote.

Candidate `a860d19f85d2c2edb969d78b68907c313c432d6d`, run `33949789445`,
passed the expanded harness preflight and returned a complete 24,081-byte remote
formatting patch for the three capsule/accounting Rust files. Zero product tests
selected/executed. Compact artifact 9,945 compressed bytes was inspected and
downloaded; 15,173-byte diagnostics remain remote. Applied the complete patch;
baseline remains qualified `9459b9c`. No execution or speedup claim yet.

### Capsule native progress preserved at the outer job limit

Candidate `c3c7d92ec8543cfbe2210a58ac173f355e54ae18`, run `33949885217`,
was cancelled at the 35-minute job limit (job 101262528392, started
2026-09-05 06:28:01 UTC). The new atomic progress checkpoint worked: its
660-byte compressed artifact reports 72 selected, 52 executed/passed, zero
failed/skipped, full inventory validated, and unfinished native target
`er-web:m9e_host_v2`. No full capsule/native/platform qualification is claimed.
The baseline remains qualified `9459b9c`.

Harness SHA `841e42644fed800ae344a5cf0223884cebc318edad90d86590922771f8802ed1`;
selected-ID SHA `bb197580c4145dc841726ce7a9f7619d47f0cc885c749b13ad1b7af400bfecdf`.
Lock SHA `f86e807a75f847ce12cd5459b98e9f1a75f6aac638ef0f9d05e518f8ec1e05db`.
Content manifest and pinned oracle remain unchanged. The named 39,649-byte
compressed diagnostics artifact remains remote. Inspected the 41,200-byte job
log size and retrieved only explicit HTTP206 ranges 33008-41199 and 24816-33007,
8,192 bytes each, to identify phase timings. No Desktop credentials were read.

Phase starts establish successful completed targets: CLI reload approximately
589.607 seconds; two actual CLI capsule tests 311.728 seconds; all nine core
capsule tests 9.888 seconds. The host target began 06:53:16.033 and was interrupted
at 07:03:14.175, about 598 seconds later, before its 600-second target limit.
Native build took about 104.483 seconds; all required native lint completed
before test execution. These are job timings, not a controlled speedup claim.

Moving only platform checks to another job cannot fix this observed native
interruption. A source-only feedback proposal now separates two disjoint native
execution groups, retaining full compilation/discovery/lint and identical global
inventory in each. The aggregate must require exact union and all platform
witnesses at the same candidate identities. Repeating the approximately
104-second focused compilation is intentionally simpler than transporting all
large embedded-path native test binaries when execution dominates. Individual
600-second target bounds and 35-minute job bounds remain unchanged. The host
may still expose an actual target timeout and must not be marked passed.

The source-only batch tree remains in `.git/m9e-batch-tree.txt` (base c3c7d92,
tree 27b44d4bed30b20e1fb4c6625dd1c61e31b1dacd, patch 133,778 bytes).
The independently reviewed private-control repair is separately preserved in
`.git/m9e-private-control-tree.txt` (base c3c7d92, tree
1f0db68438d730e760c09664867fd4b8dc2a319b, patch 50,542 bytes). Its seven files
include explicit canonical/return ownership, repeated Fight/Party and snapshot
witnesses, and a freshly consistent boosted Wasm fixture. It still requires
its own gate and evidence for the frozen parity digest; no guessed golden edit.
Neither future product cut is in the normal index or current remote candidate.

An isolated measurement witness at `.git/m9e-current-cost-probe.rs` covers real
Title/Mode/Starter/active checkpoints, decode/preparation, copies, validation,
observation, encoding/digest and separate effectful application/recording phases.
Setup and semantic replay checks are outside timing; one warmup and three samples,
no thresholds or allocator claims, output below 8 KiB. It is not integrated or run.

Source review of the interrupted host target found 2,101 read-only Title snapshot
requests in `browser_host_survives_request_window`, with full serialization and
response deserialization each time. The product retry cache is count-bounded to
2,048 entries and responses individually to 32 MiB, but has no small aggregate
byte budget. Test setup reuse is not a product cache-memory fix. A separate
bounded byte-retention policy and actual large-response/eviction coverage remain
necessary before claiming production memory reliability. Six other host tests
repeat the full starter journey only as setup; an actual-checkpoint test fixture
is being prepared without removing dedicated natural/capture/parity witnesses.

The next candidate applies the reviewed two-native-lane/platform/aggregate split
and the host test-only setup repair. The gate now has 99 source-declared selftests
(85 existing, 14 new); all remain subject to remote preflight. Required execution
and per-target limits are unchanged. Phase manifests carry the exact global
inventory/partition and selected mutant/bridge ownership; compact results retain
counts, hashes and timings while full proofs/logs remain remote.

The host target keeps all 14 test IDs and 2,101 accepted request-window snapshots,
adds a real Title snapshot equality check, exact recent retry and old-ID rejection,
and initializes seven setup-only callers from an immutable checkpoint reached by
real current-session raw input. Dedicated full natural browser/current parity and
capsule/import witnesses remain. Shared prepared content and actual snapshot
setup avoid repeated construction; no product cache/memory or speedup claim.
Future batch and private-control product files remain unstaged.

Candidate `724a42a64d4b125a3b024ac9b2d76763ad219aca`, run `33952611842`,
was rejected before any job started. Source inspection and GitHub's context
availability reference identify four runner.temp expressions in platform/aggregate
job-level env, where runner context is unavailable. Move those path settings into
the corresponding execution step env. No product tests or artifacts were produced;
this is a workflow syntax/context correction, with no baseline advancement.

Candidate `4dc49797c1158186235a09ad45644caff8385a41`, run `33952690935`,
started both native jobs and passed expanded harness preflight. Both stopped
at formatting before product compilation/selection/execution. Downloaded only
the inspected native-A compact artifact (6,566 compressed bytes); native-A/B
9,606-byte diagnostics remain remote, as do duplicate B summaries. Applied the
complete 7,834-byte formatter patch for m9e_host_v2.rs (zero omitted bytes).
The aggregate failed closed on missing successful phase proofs. Baseline stays9459.

Candidate `d6fd1c426d8a5e9769a5e3f78e5b3f7c0e456268`, run `33952840591`,
has completed native lane B successfully: 16 executed/passed (2 actual CLI capsule,
14 browser-host), zero failed/skipped, global inventory72 validated. Qualification
is explicitly pending lane A and platform/aggregate. Native-B compact 2,422 bytes
was inspected/downloaded; 36,254-byte diagnostics and 4,510-byte proof remain remote.
Native-B proof SHA `9155a094f1bc3737c4a983b19d9bbf846f17f223ab195675edd35febf8e728d7`.
Selected-ID hash remains bb197580c4145dc841726ce7a9f7619d47f0cc885c749b13ad1b7af400bfecdf.
Target timings: CLI capsule 186,596 ms, host 194,662 ms; build 77,193 ms. These establish
completion under their limits, not a controlled source-only speedup measurement.
The future batch tree has been regenerated against d6fd1c4:
4b9471954b3a056ba66f173730113737b6fb126e, 15 files, patch 133,733 bytes.
It includes 106 source-declared harness tests (99 current + 7 batch) and still needs an
actually qualified capsule baseline. The normal index is empty.

### Current capsule and split feedback qualification passed

Candidate `d6fd1c426d8a5e9769a5e3f78e5b3f7c0e456268`, run `33952840591`,
passed all four jobs and the exact aggregate. Native A passed 56 and B passed 16,
with all 72 selected tests executed once, zero failures/skips. All required lint
and 99 harness selftests passed. Two Wasm, two Chromium and one typed-effect test
passed without failures/skips/retries. No behavioral mutant was selected by this
capsule-only scope; prior B2 mutant qualification remains separately recorded.

The actual Chromium capsule replayed through the normal native CLI: declared
base 1417, final 1433, 16 retained attempts, full final snapshot digest
`blake3-v1:f4e7ad23f09dd59e1e1e7bf678e052f754c334a04261bb1e44d187e1ccb9dc4b`.
Removing a retained applied time event produced the required causal divergence
at 1428. CLI artifact SHA
`e2861dc9e93c7b924d621f7944f64a8be6e851365a136efd0c3b34be0ba2f9b0`,
80,124,264 bytes, was transferred only between remote jobs. This remains in-page
Wasm-host/byte-relay Chromium coverage, not production Worker/WebRTC topology.

Native-A proof 4273faa5cd05cf695bf5d5be4c530553b4638a87092ed352d16e3eea91c86eb2;
native-B proof 9155a094f1bc3737c4a983b19d9bbf846f17f223ab195675edd35febf8e728d7;
platform proof 6d90e4b089d9deb269503ae8474df8461d7382665df4b688e2bd65dc0a11c07e.
Global inventory SHA
`b13477b261ee5988a289bf52746733aac01d3f7648c575b3af3756c9bcd1ff6f`;
plan SHA 08a088122979fbe94aa2f6e3311e9bfac9b5c1623444ac2088160353c0370560.
Native/Wasm timer digest remains 9002fe7f032760abb343efebeb6b0a75a74c10578d3e38bdf21fc205cf4b650e.
Harness SHA 140054ed41d469668e7a12f2e794c81b91328c7121adc7d5713297d40de42e31;
phase helper 5b9ce02a68c3e4dd9f78af0b52db5525a2740981977b0749fbc3f9aaadb42038.
Content manifest and pinned oracle remain unchanged.

Browser asset manifest SHA
`f29a6da3d01a7ab25cb5def7b96a2011c6baa30dd0231c5efcdb4a4cbc2728e3`;
Wasm SHA edbf9ea386c9c1f9bae98f89a5105a4f33dc678cca5aefc893d664ae7a6dc716,
16,168,477 bytes. Content JSON remains 15,810,979 bytes and SHA
640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4.

Downloaded only inspected compact summaries: native A 2,709 bytes, native B 2,422,
platform 2,067, aggregate 2,562 compressed bytes. The 80,124,390-byte CLI archive,
4,579,529-byte browser assets, all full diagnostics/proofs and aggregate evidence
remain remote. Native A ran 19m44, B 9m09, platform 9m40, aggregate 26s; overall
07:32:29-08:02:24 UTC. Platform timings: Wasm check 24,932 ms, parity 81,451 ms,
browser build 315,912 ms, Chromium 72,850 ms, typed effects 867 ms. No controlled
performance comparison is claimed. Each job stayed within 35 minutes.

Advance the focused baseline to this exact qualified capsule commit/run.
Submit the separately preserved current batch implementation and its 106-test
harness next: typed shared V7 environments, global order/rollback/fork/limits,
actual CLI batch commands and exact outer success-envelope precommit bounds.
Private-control and response-cache changes remain separate, unqualified work.
This capsule milestone is not full M9 completion.

### Current batch remote formatting repair

Candidate `a675dec2fb545b6222a36c4aa75e2b0e1c434cf4`, run `33954833074`,
passed the 106-test harness preflight and stopped at formatting. No product tests
were selected/executed. Inspected/downloaded native-A compact12,245 compressed
bytes, then the named complete repair20,499 compressed bytes because the compact
patch omitted three files. Verified full115,628-byte patch SHA
`e95455dc58f59eeea8f63d472466ad20b5f641d65d9a71da5b01dc467d91244a`
and applied all six batch-owned Rust files. Both48,740-byte diagnostics and
redundant laneB evidence remain remote. Baseline remains qualified d6fd1c4.

### Current batch native lanes passed; platform pending

Candidate `9a3e8db3fb17d4cc0223c4c0a82800125caeb3b7`, run `33954961024`,
passed both native jobs: A65 plus B18, all83 selected tests executed, zero failures
or skips. All six core batch, both actual native CLI batch and three protocol
response-context tests passed, with required current/historical adapter targets,
formatting, lint and106 harness preflight checks. Platform/aggregate remains
pending; baseline stays fully qualified d6fd1c4 until the complete run passes.

Native A ran08:19:54-08:40:39 UTC (20m45); B08:19:53-08:41:22 (21m29).
Core batch50,953 ms; actual CLI batch482,440 ms; current CLI reload559,608 ms;
CLI capsule299,232 ms; browser host297,466 ms. Build A121,329/B119,719 ms.
These are test-profile phase timings, not throughput or a controlled speedup.
The current two-lane split and all600-second target/35-minute job limits held.

Native-A proof83cb05afb2a576bada6749221f6dcd90e0ce99601cef0f68a88cb5b9cb00d065;
B9bb03147a1501d651b5a0a67f44c8693a3a42e0034511377b9db2728bf9955d4.
Selected-ID file SHA d9225c4c088b843ee2f6596f0f7675544746923be27aee59e432c793773be6c6;
plan a78e52f42b9ecbc5be6bb0cbdbcecbbdfc507dd4f4cf464fb686fec2cd362571.
Both builds independently produced CLI SHA
c73c0e99c92e4ec9364b03013f474f8647faef4f9dfe20a2043a3389f87beb97,
85,869,144 bytes; worker SHA remains a8188f5c6f3688e438eb5381133e569ea524af2375246d4e40e3dac2d9a8e388.
Only inspected native compact artifacts were downloaded (A2792/B2486 compressed
bytes). Diagnostics A48,447/B41,227 bytes, proofs and85,869,270-byte CLI archive
remain remote. Platform started08:40:42 UTC.

The isolated private-control gate now preserves batch requirements and adds exact
core batch6/CLI batch2/protocol3 to timer scope, along with existing capsule,
co-op/private, snapshot/domain, process and both mutant requirements.109 source
selftests remain; proposal22,843 bytes, not yet executed. The actual private
product sources remain separate and unstaged; frozen parity digest is unchanged.

Source-reviewed followups: browser response-cache payload bound (approved source
review, no runtime/heap claim), current-entry map `.git/m9e-current-entry-cutover.md`,
and batch usage `.git/m9e-current-batch-usage.md`. An isolated current validator
proposal is in progress; default gameplay already selects V7, while historical
validators and unsupported lab/developer-plane capabilities remain explicit work.
### Current native batch fully qualified

Candidate9a3e8db3fb17d4cc0223c4c0a82800125caeb3b7, run33954961024,
passed all four jobs and exact aggregation:83 native,2 Wasm,2 Chromium and1 typed
route test, zero failures/skips.106 harness preflight tests passed. Current batch
scope selected no behavioral mutants; private kernel scope retains both mandatory
mutants. This is focused batch qualification, not full M9 completion.

The actual browser capsule replayed through the candidate CLI: base1417/final1433,
16 attempts, full digest blake3-v1:f4e7ad23f09dd59e1e1e7bf678e052f754c334a04261bb1e44d187e1ccb9dc4b.
Omitted applied time event was rejected at1428. CLI SHA c73c0e99c92e4ec9364b03013f474f8647faef4f9dfe20a2043a3389f87beb97.
This remains in-page Wasm-host/byte-relay Chromium evidence, not real Worker/WebRTC.

Aggregate full summary SHA d7f76130c42a5d84bad4127a32f5bd14f3acd50b3c4740cc10c136873e5c90ee;
platform proof e9477df37b0855054747b74bf9579b821743dcc96a364f3860982e9958d0e6e8;
global inventory24a901a3d00341b5f920c7abb4de489dbaf45780dc85691402a608702f25605f;
normalized plan ee640b4f4f7398b8b14ed6445ab9f8feb9cd308abb05ce07acda6a06a3207b14
(the earlier a78e52 entry identifies the raw plan.json file).
Harness7b1f7bfa8d7e3e4c97a8476fa3ee888a10ffe79ac02319549e1d9a539356821d;
lock47cc9677555a235e8e29a9ca9c6f0d24d06248f07d3b400c63f4a33401138073;
selftests1d7c94179c15850b335c423b6bbb102af59de2655bab1acb4669506e6b36f7a9.
Phase helper, workflow, pinned oracle/content and native/Wasm timer digest remain
as recorded above. Browser asset manifest7445da775b72533e29baa659cf32401eb8647c2dc61f359e6ec6dd93e7b965d4;
actual Wasm remains16,168,477 bytes and SHA edbf9ea386c9c1f9bae98f89a5105a4f33dc678cca5aefc893d664ae7a6dc716.

Downloaded only inspected platform2069 and aggregate2625 compressed-byte summaries,
in addition to native A2792/B2486. Platform15,256-byte diagnostics, proof and all
large assets stay remote. Platform08:40:42-08:50:03 UTC (9m21), aggregate26 seconds;
overall08:19:53-08:50:31 (30m38). Platform timings: Wasm check23,481 ms,
eventwise68,726 ms, browser build294,500 ms, Chromium61,876 ms, typed route716 ms.
No allocation, throughput or controlled performance claim.

Advance baseline to exact qualified9a3/run33954961024. Submit the separately
reviewed private-control source and109-selftest gate next. It retains exact
canonical and return control from before local navigation; removes allocator-1
parent guessing; restores canonical control only on staged material/action paths;
and preserves complete private state on duplicate or rejected transitions.
Repeated Fight/Party, genuine private snapshot continuation, bad ownership and
late collision regressions are included. Old synthetic leaf-only states remain
decodable as GameSaveV2 but cannot restore by guessing a missing parent. The fresh
boosted Wasm fixture starts with a consistent ledger; its frozen parity digest is
unchanged until an actual remote result supports a specific update.

The source-only candidate is saved as .git/m9e-private-control-candidate.patch,
base9a3, tree13c215bcdac7757556f3f42736f8bb48ee02e9a2 before baseline advancement.
The live submission supersedes that saved candidate after the baseline changes.
Cache, current validator and cost-probe proposals remain isolated/unqualified;
long-session retention, lost-response/reconnect, actual browser topology,
full source fidelity, native capture and remaining lab/developer-plane work remain.
Private candidate936c9b954aafde3969849879b5772652f7f7f2a8/run33956480191
passed109 harness preflight tests and stopped at formatting before selecting or
executing product tests. Downloaded only inspected native-A compact10,857 bytes;
redundant B evidence and both16,251-byte diagnostics remain remote. Its complete
24,194-byte four-file formatting patch had zero omissions and verified SHA
eff01661a78a009928dbce185e377ab14b0cb763a2a33f81cee5a4595cd4721e.
Applied that remote-generated patch; baseline remains fully qualified9a3e8db3.
Private candidate8fb78aae243d4e633593fc3617a88243c17565d1/run33956904749
compiled and passed required formatting/lint and109 harness tests, then failed
four existing constructed fixtures. NativeA selected603, executed566, passed563,
failed3; B executed18, passed17, failed1. Aggregate failed closed, platform skipped;
19 selected tests were not executed. No private qualification/baseline advance.
All four coop/private-control tests,12 domain journeys, six core batch and both
actual CLI batch/capsule suites completed successfully before these failures.

Native failures: authority_ai_can_choose_a_legal_enemy_switch,
final_wave_victory_terminates_the_run and nonterminal_battle_progresses_to_next_wave
in m9e_game_kernel_v7. Each changed a naturally reached battle state while retaining
material records for the original state. Browser all_five_initialization_modes_and_repro_effect_are_live
likewise injected a Scenario into the reached BattleCommand state and retained its
old ledger. Each now requires rejection of that contradictory snapshot, then uses
GameKernelV7::from_active to construct an explicit fresh controlled boundary with
preserved intended state/revision/seat/role/input/scheduler/protocol. Native tests
also serialize/restore a genuine fresh snapshot and assert full equality; Scenario
initialization compares the full host snapshot. Existing seven native test IDs,
fourteen host IDs, five initialization modes and gameplay/repro assertions remain.
No ledger hash is fabricated and validation is not weakened. These controlled
one-HP/enemy-switch/Scenario fixtures do not certify natural campaigns.

Downloaded only inspected nativeA4108/B3563 compressed-byte compact artifacts;
108,236/91,134-byte full diagnostics remain remote. A09:02:46-09:23:53 UTC,
B09:02:46-09:24:34. Actual CLIreload561,169 ms, supervisor221,964 ms,
worker92,214 ms preceded native kernel failures; B CLIbatch468,226 andCLIcaps295,203
ms preceded host target296,083 ms. To shorten the next relevant failure feedback,
timer scope now prioritizes current kernel, native parity and affected host targets
before long CLI/process suites. Exact crate/target ordering retains all inventories,
phase membership, required checks, mutants and limits. Other scopes keep their
existing order. Expanded mocked ordering assertions require110 selftests, still
unexecuted at this edit. No measured speedup or test-count reduction is claimed.

Frozen native/Wasm parity digest has not yet been reached in this failed run and
remains unchanged. Baseline stays exact fully qualified9a3e8db3/run33954961024.
The wave200 controlled fixture also regenerates its root operation identifier
through player_command_operation_id using its actual player field and owner;
its wave1 identifier is asserted different. OpenFight must reach BattleMove
before the existing strongest-move/terminal assertions. No ledger digest changes.

Fixture repair c4667b59845c7be0c94c6ff0689374c3d0e27cb4/run33959516905
passed110 harness preflight and stopped at formatting before product execution.
Downloaded inspected nativeA compact4,993 compressed bytes only; full diagnostics
8,255/8,256 bytes remain remote. Verified and applied complete1,201-byte two-file
remote formatter patch, zero omissions, SHA256
cd6f8992b7176c3b819357029c175d0a89a0bfb0b76521f16205b98ae4bb1e26.
Baseline and frozen golden remain unchanged pending execution.

Remote11bd20bd9417c5e2673eb2ef5eff51f240dc0e27/run33959674311 passed110
harness checks, formatting, reverse compilation and required lint. NativeA now
ran all7 current-kernel,4 coop,4 snapshot,9 timer and12 domain tests successfully
before native parity:38 executed/37 passed/1 failed of603 globally selected.
Failure is only the old frozen raw-event report digest after all its gameplay
assertions passed. Actual native report4d5ef01099d9942c0dec32227366a3faf018a77aa5c5b6a1d60e84b3e75bf0c5;
held-timer test passed with8be9ebd2eebae0f5741a511e68542182bb9c67b5d2c312c259abae45eb0e6942.
The controlled boosted fixture resets bootstrap ledger/replay bookkeeping; exact
private root/return ownership now serializes into snapshots and canonical-root
material affects fingerprints/effect evidence. Updated only the frozen digest
from this actual remote result, preserving progression/reward/wave3/timer checks.
Wasm must match independently in a later successful run; no qualification yet.
Inspected and downloaded only nativeA compact3,697 compressed bytes;92,220-byte
diagnostics stay remote. NativeB still running when superseding the failed cut.
Build146,504ms; priority targets8,947/4,880/3,825/3,072/12,808/8,785ms.
Baseline remains9a3/run33954961024; no rollout or tag changes.

Superseded11bd/run33959674311 nativeB compact (inspected706 compressed bytes)
records all14 host tests passed in188,359ms before cancellation during CLIbatch.
All four original controlled-fixture failures are thus repaired remotely, but
this interrupted candidate did not qualify. B diagnostics68,721 bytes remain
remote. Current golden candidate977200b02251d7a736876bba6549410a06205274
is executing run33959991266; no baseline advance pending allphase success.

977200b/run33959991266 nativeA succeeded10:12:25-10:31:16 UTC:
585 assigned native tests passed,0 failed/skipped;60/60 assigned targets complete
of63 globally selected targets and603 globaltests. Both realcompiled timer and
replica mutants were detected by their required exact tests; each restored source
SHA25676edbd7a4a36df7644ef2916387be6dafd8d18c238d43811383f20a6d0e3ae89.
Native held-timer digest8be9ebd2eebae0f5741a511e68542182bb9c67b5d2c312c259abae45eb0e6942.
CLI b1dd190f8c149bda89227fbab885505f5d89f85b843614c4023a76027def26f7
(86,023,448 bytes); worker53516b5cc003b9bf3c6952339d0e1a9d34dc16136693777da70c3e0221e723a9
(73,928,432 bytes). Downloaded only inspected nativeA2,128-byte compact artifact;
120,642-byte diagnostics,16,953-byte proof archive and86,023,574-byte CLI archive
remain remote. Native manifestcc50d1147cbfb680bfaa653bf0981cb6fc9566eddcdc74169b0a6393240dd84c.
LaneB/platform/aggregate still required; qualification remains pending.

977200b/run33959991266 nativeB succeeded10:12:25-10:34:39 UTC:
18/18 passed,0 failed/skipped; combined native603/603. Its CLI and worker hashes
match laneA exactly. Host297,089ms, CLIbatch472,145ms, CLIcaps295,846ms.
Inspected/downloaded only3,057-byte compressed Bcompact;90,901-byte diagnostics
and15,797-byte proof archive remain remote. Bmanifest
0576b149d4fddca4a58cbfaf1ea3fc6aac79b6d9c9b42bbacda2879844c6b793.
Platform started10:31:19 UTC; its exact CLI bridge and aggregate are pending.

FULL FOCUSED QUALIFICATION PASSED for977200b02251d7a736876bba6549410a06205274
run33959991266:603 native,2 Wasm,2 Chromium and1 typed-effect witness, zero
failures/skips;110 harness, requiredformat/lint and both restored mutants passed.
Native/Wasm held-timer digest8be9ebd2eebae0f5741a511e68542182bb9c67b5d2c312c259abae45eb0e6942;
raw-event frozen4d5ef01099d9942c0dec32227366a3faf018a77aa5c5b6a1d60e84b3e75bf0c5 passedboth.
Actual Chromium capsule-to-exactCLI:base1417/final1433,16attempts, fullsnapshot
blake3-v1:3ebd6118c4d9500bbbde971eb9100eb199cd0496c94ec367200b7a24ddeb8690;
omitted appliedtime rejected at1428. This remains in-page V2 Wasm-host/byte-relay
evidence, not realWorker/WebRTC/renderer integration or wholeM9completion.
Aggregate binds nativeA/B/platform proofs to same source/toolchain/defaultprofile,
full disjoint targetunion and exactexecutable hash. Inventory
aefdcdb1222f3ecd0018b5d9da1133694399c816dae3ec00e1710e64038c4534;
normalizedplana0e3aebdb25345ad32fedb375e8e75f7f7510e25cebae21a73e7759e637c82cb;
aggregatec353fe157e7d0cfb3a3efcb46ea049f4af0a00032920bc3e18a025563755ce7d;
platformf5a9c8b43130fed5e09e2cf037fa713460e98aefda488fa8f183647b58ab5d2f.
Browserassetmanifest75ac19e0c5a4bda90412eb82d1073c4713d9d101fa3877d5ca219819cc1582b2;
Wasm44872678c37a6eacb9bf656a885632bd5f42b2545440d2eed0cdd332856d6a50
(16,249,212bytes); contentJSON remains640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4.
Inspected/downloaded only platform2,072/aggregate3,461 compressed-byte summaries.
Fullbrowserassets4,527,969, platformdiagnostics14,736, platformproof4,575 and
aggregateevidence3,419 compressedbytes remainremote. Browserbuild322,585ms,
Wasmparity73,935ms, Chromium75,575ms, typed1,016ms. Timings describe this run;
no controlledoptimization/allocation claim. Advance focusedbaseline only to this
qualified exact977200b/run33959991266. Existing finaltag andproduction untouched.

### Next isolated cut: bounded browser response payload retention

Integrated the separately reviewed BrowserKernelHostV2 cache proposal on the
fully qualified977200b baseline. Serialized retained responses are bounded by
2,048 entries and64MiB; per-response32MiB remains. Newresponse completion fits
before gamecommit, eviction follows accepted sequence, onlynewreply iscloned,
and disposal clears payloads/counter. Metadata/temporary/returnedbuffer/session
memory isadditional; no wholeheap/peakmemory or protocolrecovery claim.
Two exact realrequest unitIDs check independent encodedbyte exactfit/onebyte
boundaries, chronologyvsrequestID, state/sequence/cache/counterrollback, retries,
conflicts, correctedcontinuation anddisposal; all14 hostjourneys are retained.
Focused gate admits onlyhost_v2.rs plusCI/docs, rejects mixedproduct/dependency
changes, pins allfivehostunitIDs andexistingcurrentcapsule/batch/protocol/reload/
worker/supervisor/parity consumers. MandatoryWasm/Chromium/typed/CLIbridge and
evidenceidentity/limits remain. Native order unit→host→CLIreload yields Aunit
first andBhost first without changingpartition or membership. Four meaningful
mocked gate tests addto110, for114 source tests awaitingremoteexecution.
Product base blob125318ee46ea52735a5e5454071ad916076993f9 matched actualHEAD
before application. No local compilation/format/lint/tests ran. Cachecandidate
is not yet qualified; currentbaseline remains exact977200b/run33959991266.

Cache d69cce2b4efe3de959cb1568d7a06882f54d2e3b/run33961596778 passed114
harness checks and stopped at formatting before productexecution. Inspected and
downloaded only nativeA7,869 compressed-byte summary; duplicateB/full10,970-byte
diagnostics remainremote. Complete9,879-byte host_v2.rs formatterpatch, zero
omissions, verified SHA256a581e89eb60780c06a17de82b13045b52d5daeaa10fee7958551538c4ef73e38,
was applied. No qualification/baseline advance beyond977200b.

Cache1b9567295b56cb2775ad5762713885c3e6275d80/run33961778505 passed both
native lanes: A67/67, B18/18, total85, zero failures/skips;114 harness and
required formatting/all-target lint passed. Exact five host unit IDs and14
host integration IDs executed. Cache units5,433ms; host290,068ms; reload527,993ms;
CLIbatch472,349ms; CLIcaps296,264ms. A10:51:55-11:11:31 UTC, B10:51:54-11:13:10.
Only inspected A2,797/B2,507 compressed-byte summaries downloaded; diagnostics
48,528/41,317, proof5,335/5,002 and86,023,574-byte CLI archive remain remote.
CLI b1dd190f8c149bda89227fbab885505f5d89f85b843614c4023a76027def26f7
(86,023,448bytes) and worker53516b5cc003b9bf3c6952339d0e1a9d34dc16136693777da70c3e0221e723a9
(73,928,432bytes) match across lanes. Native timer parity remains8be9ebd2eebae0f5741a511e68542182bb9c67b5d2c312c259abae45eb0e6942.
Amanifest7cfc83fbec6a46cc2ac0df2046099fac104674e3c2eef97be50a071a0709f7ff;
Bmanifest1910e21f04f2686c9d13d3497aeeee5ca119f721a344f8cd36553e96e54eb5e1.
Platform and aggregate still pending; baseline remains977200b/run33959991266.
This scoped cache run selects no behavioral mutants; private-control mutant
qualification remains separate evidence at977. No performance/heap claim.
FULL FOCUSED QUALIFICATION PASSED for1b9567295b56cb2775ad5762713885c3e6275d80
run33961778505:85native(A67+B18),2Wasm,2Chromium,1typed-effect check; zero
failures/skips,114harness and requiredformat/lint. Platform11:11:34-11:21:10 UTC;
aggregate11:21:12-11:21:40; overall29m46. Exact CLI bridge retained16attempts,
base1417/final1433, fullsnapshot
blake3-v1:3ebd6118c4d9500bbbde971eb9100eb199cd0496c94ec367200b7a24ddeb8690;
omitted appliedtime rejected at1428. This is in-page Wasm-host/byte-relay evidence,
not actual Worker/WebRTC/renderer qualification or complete M9 acceptance.
Platformmanifest26eda37ea9e60c1f660e7baf7aced9fe29a9f6d889fff01f5bd1a1811382562a;
aggregate74e42bbb8ef2628baee14a8f782435a5fc1e63e187e79fed0f76e1631e59ded8;
normalizedinventoryd25e391aaaddc2e4c62dd3303cf5d292b30677e3d8b90f1f15b6ace46043f3b7;
normalizedplan60b03ea187a8b49bd07305b369e230490e5df7c9155c01f60d58fd115c5df6f9;
selectedIDs0e834481f33d62cf60378f24f8c5f0eb4ff15ba45223e4d930b32fed8c039cf5.
Harnessf78c8c30a9b65b469b3ec08ba58173be03548d74dc95653b26258701f70ed6e2;
selftestsc625d4321508444886d9bc274426557ef9dd51e2a7a5efa3caab15e1f40d668c;
configa8c97a5b8ca45e603eab56b4d49abe1b8bdca29c358d1e4d767e124c7df6dd79.
Content/lock/phasehelper/workflow/oracle identities are unchanged from977.
Browserassetmanifest95c6abe1a8f999804b039c06d5c1286fca6185a20e9bd79e215d1f67870e4ad5;
Wasm540982dece5a6791fc189095706ccf7ea4b0e670835788226e509af94f486d51
(16,249,560bytes); contentJSON640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4.
Only inspected platform2,069/aggregate2,637 compressed-byte summaries downloaded.
Browserassets4,527,519, platformdiagnostics14,747, proof4,598 andaggregateevidence
2,594 compressedbytes remainremote. Browserbuild308,575ms, Wasm71,381ms,
Chromium73,552ms, typed816ms. These are run timings, not controlled speedup or
allocation measurements. Focused baseline now advances to exact1b/run33961778505.

### Next isolated cut: ordinary current save and capsule validators

Integrated the previously reviewed CLI main/current_commands and two realprocess
test proposal. Both preservedbase blobs exactly matched actualsource at1b. Normal
validate-save now validates canonical/checksummed GameSaveV2/current-content state;
normalcapsule-validate performs isolated current replay. Explicit historical
validate-save-v6/capsule-validate-v1 routes remain. No dependency changes.
The118-selftest gate was three-way refreshed onto actual114-cache CI, independently
reviewed, and applied with all five actualhost unit IDs and two validator IDs.
Exact validator target runs first, exact CLIreload second, remaining order stable;
wrong-crate decoys verify priority is crate-bound and membership unchanged.
Full reverse compile, early Clippy, mandatory parity/platform/exactCLI bridge and
fail-closed mixed-product scope remain. New regression process witnesses exercise
valid-checksum absent-species validation, exact causal divergence and byte-limit
errors. They remain unformatted/uncompiled/unexecuted until the remote run.
No local build, formatter, lint, test, dependency or browser workload ran.

Validator4218ea4303f6eda7ea262a1f531e2d91c686f95a/run33963278951 passed the
118-test harness and failed formatting before any product test. Downloaded only
the inspected11,991 compressed-byte nativeA summary; duplicateB11,992 and18,370-byte
diagnostics stayremote. Complete22,849-byte newvalidator-test formatterpatch had
zeroomissions and verified SHA25673f64a121e37f6cb1b0f323685bf4fdb69cd243443750a3ccdad03aed7f40aa4;
applied exactly that remote patch. Baseline remains qualified1b/run33961778505.

Validator3aa4a0cd4488d82ef739cd9a204a45374e3eb98d/run33963418110 passed both
native lanes: A69/69, B18/18, total87, zero failures/skips. New two actual validator
process tests passed first in24,615ms, followed by current CLIreload583,994ms.
Required formatting,118 harness and all-target Clippy passed. A11:28:25-11:50:05UTC;
B11:28:25-11:46:07; platform started11:50:07 and remains required.
CLIacacd84ec83cc323ac91a9cc2c7309096f0bdf222d73cfd42e374d692b69e397
(86,042,440bytes), worker53516b5cc003b9bf3c6952339d0e1a9d34dc16136693777da70c3e0221e723a9
(73,928,432bytes), exactA/B matches. Amanifest
2b9f153f5a65bec292dfab42a1478b5a81dce7c0daef0671b86943750898288e;
Bmanifest2665673332c3bc7b55a75ebf86ac855542aa5a4d620840311cfb90f7455012cf.
Only inspected A2,814/B2,515 compressed-byte summaries downloaded. Diagnostics
49,578/41,917, proofs5,444/5,086 and86,042,566-byte CLI archive stayremote.
B CLIbatch385,065ms, CLIcaps241,988ms, host236,756ms; A supervisor232,941ms,
worker98,652ms, corebatch51,796ms, entry24,788ms, corecaps10,888ms, parity9,684ms.
Reload approached the unchanged600-second target bound; this successful run is
not a speedup claim or a reason to raise limits. Platform/aggregate remainpending;
baseline stays fullyqualified1b/run33961778505.

FULL FOCUSED QUALIFICATION PASSED for3aa4a0cd4488d82ef739cd9a204a45374e3eb98d
run33963418110:87native(A69+B18),2Wasm,2Chromium,1typed-effect check, zero
failures/skips;118 harness and requiredformat/lint passed. Platform11:50:07-11:59:50UTC;
aggregate11:59:53-12:00:21; overall31m56. Exact CLI bridge used the new
acacd84ec83cc323ac91a9cc2c7309096f0bdf222d73cfd42e374d692b69e397 executable,
retaining16attempts at1417->1433 and fullsnapshot
blake3-v1:3ebd6118c4d9500bbbde971eb9100eb199cd0496c94ec367200b7a24ddeb8690;
omitted appliedtime rejected at1428. Native/Wasm heldtimer digest remains
8be9ebd2eebae0f5741a511e68542182bb9c67b5d2c312c259abae45eb0e6942.
Aggregatecf98852ade2a62d187b3ae92d6dcfa029d42ec7e27d4dbd60779997aae5d7875;
platform6137959e70dc2bab4217082e02d8ee961954703d28b716f6bb4c4e6330afc8d7;
normalizedinventory7447366c567a2e4698b210baa1ecb0c45deb79dc42d2baf5423aa71bdadba8b1;
normalizedplana5bdddc82824b1b7d6121ddf00f66bbc687695af241c3a7374849d904488f63d;
selectedIDsba55ba39389a83d62677e49daf982156c912c68e0f03e20076d1014811d5e82b.
Harnesse7900e6be1896d590c55f1ac3d17569bd765e48f1cac925059f7ac43dc097f24;
selftestse2512ce71f3d071010f6d733c2036e7b88f99023b5522ed9a891423064956eb0;
configc0d00bc30695c2a084fb6ec0bdab730ff40e4f31e7ced3abb4a24c289c18599c.
Content/lock/phasehelper/workflow/oracle identities unchanged from1b. Browserasset
manifest64e6e7ebb3668e509f1636bb595d8045734df51a1ede8db0af4abf734d8e5372;
Wasm540982dece5a6791fc189095706ccf7ea4b0e670835788226e509af94f486d51
(16,249,560bytes), contentJSON640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4.
Only inspected platform2,070/aggregate2,647 compressed-byte summaries downloaded.
Browserassets4,527,519, platformdiagnostics14,809, proof4,671 andaggregateevidence
2,608 compressedbytes remainremote. Browserbuild313,541ms, Wasm72,335ms,
Chromium74,909ms, typed816ms; no controlled performance claim. This remains
in-page Wasm-host/byte-relay evidence, not shipping Worker/WebRTC/renderer or
wholeM9 qualification. Advance focused baseline only to exact3aa/run33963418110.

### Next isolated cut: current material suffix retention

Integrated the separately reviewed three material/runtime/kernel source changes
and five new regression tests. Their preserved base blobs exactly matched actual
source at3aa: materialffe2d846513d2a65ad2bcd15558f14330f2ffddc,
runtime63212628d9d89bbee4915d5c4b34702325c25c83,
kernelbea79cbb9689308e09b47f4c6ca05c5f58f905dd.
V7 explicitly selects a contiguous4096 suffix at all six construction/restore
sites; historicalV6 defaults keep their hardstop and wire schema. Whole candidate
validation and checked frontier advance precede retirement/publication. Retained
exact retries are no-ops, conflicts reject, old admitted materials below the
floor are StaleUnverifiable. No lifetime operation-string uniqueness claim.
Three helper tests include12289 realSave/Delete dispatches+replicaapplications,
three full4096 windows with explicitrestore, independently expected fullstate,
small-window conflict/rollback and revision exhaustion. Two V7 tests include4098
actual materials, pendingpresentation restore/settlement, latecollision rollback,
retainedduplicates/staleoldbytes and oldgapped evidence rejection. These controlled
fixtures do not prove natural authority rollover, proposal retirement, lostreply
recovery, reconnect, externalstorage, throughput or allocation improvements.
The standalone122-test/33-required-target retention gate preserves currentcache/
validator checks and both realtimer/replica mutants. New exact helper/kernel
retention targets receive early execution priority before the existing timer
sequence; all discovery/lint/membership/phase/platform/artifact requirements stay.
Remote formatting/compilation/execution remain required; no local workloads ran.
The separate native-capture product and combined126 gate are still unintegrated.

Retentiona49579da3e1926235181c70b1c3ca4e62f5a78c2/run33965131277 passed122
harness checks and stopped at formatting,0producttests. Downloaded only inspected
8,822 compressed-byte nativeA summary. Its27,486-byte patch omitted19,530 bytes
for the V7test, so it was NOT applied. Inspected/downloaded named7,854 compressed-byte
repair artifact instead. Complete47,016-byte format-repair.patch verified SHA256
33481d5e15c4ede77537fb297cc7cd361344e5a1e7432995918b6abbeb22d647
and applied to all five touchedRustfiles. DuplicateB/full30,033-byte diagnostics
remainremote. Baseline remains qualified3aa/run33963418110; no productqualification.

Retention formatter commit9ad64c5ea812e98e8e0f44ef197e34fb69e1a8c4,
run33965432507, passed122 harness checks, formatting and full reverse compilation.
Discovery selected662 tests;0 executed because new early er-game all-target Clippy
reported27 warnings in existing m6/m7/current source. Earlier CLI no-deps lint did
not lint this dependency. CLI/protocol/repro/env lint passed; kernel/batch lint,
product tests, both mutants and platform were not reached. Build137,983ms.
Inspected/downloaded only nativeA summary5,471 compressed bytes. The88,551-byte
A diagnostic ZIP stayed remote: explicit HTTP byte ranges fetched its8,192-byte
central-directory tail,30-byte member header and3,322-byte compressed member.
Only the needed21,856-byte er-game-clippy.log was inflated locally as bounded text;
no build/test/formatter ran locally. Duplicate B5,454-byte summary and88,505-byte
B diagnostics stayed remote. No Desktop tokens were read or credentials logged.

Bounded lint repair preserves public Rust payload/constructor shapes and behavior.
Copy fields replace redundant clones; derived empty/zero queue Default, let-chain
conditions, saturating arithmetic and matches! preserve the reported expressions.
Fourteen exact historical SoloCampaign result functions and its diagnostic enum
have item-scoped expected large-error/variant lints with reasons; two current
public by-value input/event enums likewise retain their ownership shape. The
historical8-argument material constructor has one item-scoped expected lint.
These are explicit API-layout decisions, not allocation/performance improvements.
The existing AI_budget_failure_retains_replayable_evidence unit is renamed to
ai_budget_failure_retains_replayable_evidence; its assertions/body are unchanged,
and full er-game:* inventory still discovers it. No obsolete-name waiver is added.
The strict retention allowlist adds only the eight compiler-reported game paths,
for13 product paths total. Existing122 selftests now independently pin those exact
paths and reject adjacent unmapped names. All33 required targets, five exact
retention IDs, full reverse compilation, all-target lint, both real mutants and
mandatory platform checks remain required. Qualified baseline stays3aa/run33963418110.
This repair is awaiting remote formatting/lint/test evidence; retention remains
unqualified and proposal/reconnect/native-capture work remains outstanding.

Lint-repair ff7011b69664e303e94ebec8bc076c2d12ed8dbf/run33966659698 passed122
harness checks and stopped at remote formatting of the new matches! expression.
No compilation/producttests ran. Only the inspected2,306 compressed-byte nativeA
summary was downloaded; duplicateB2,307 and fullA15,332/B15,333-byte diagnostics
stayremote. Complete3,535-byte one-file format.patch, zero omitted paths/bytes,
SHA256edac002d5888ba1cc0ed6a9d17fee2ec00bfe5b06b3646e414d792b43db7732a,
was verified applicable and applied. No local formatter executed. Baseline remains
qualified3aa/run33963418110; all remaining lint and retention evidence is pending.

09317fb5d28f920e88742da39edb9d72a16254cb/run33966823622 passed122 harness,
formatting, full reverse compilation and er-game all-target Clippy. The next
newly enforced er-kernel all-target lint stopped on32 prior warnings:28 Option
unwrap calls in m9e_domain_journeys_v7, a constant-false test assertion, a hex-length
modulo expression, and the public lifecycle enum size/nested snapshot guard.
662tests selected,0executed. Build148,945ms; CLIClippy28,856ms; game5,678ms;
kernel3,727ms. Batch lint and all product/platform/mutant execution remainpending.
Only inspected nativeA4,934 compressed-byte summary downloaded. Full A87,400-byte
ZIP stayedremote: selective directory/header/member HTTP ranges retrieved only
17,705-byte er-kernel-clippy.log (2,199 compressed member bytes). Two initial
metadata-only attempts did not match its prefixed member name; no full archive
was fetched. Duplicate B4,436 summary/B86,417 diagnostics stayedremote.

The kernel lint repair adds descriptive fixture expectations to those28 Option
accesses with all12 journey IDs/actions/assertions preserved. The historical
proposal unit returns an explicit failing Result when its expected variant is
missing; this preserves failure without adding a panic macro forbidden by the
workspace. Hex even-length validation and the active revision guard keep the
same acceptance/rejection behavior. One item-scoped expected large-variant lint
preserves the current public lifecycle snapshot's by-value API and wire fields.
Four exact diagnosed kernel files join the strict retention allowlist (17total).
The12 domain-journey IDs and whole er-kernel unit target were already selected
and required; there is no inventory removal or new target shortcut. Existing122
harness tests retain exact-path and neighboring-path failures,33requiredtargets,
bothmutants, earlyall-targetlint and platform. Fullyqualified baseline stays3aa.
This source repair still requires remote formatting/lint/execution; no local
workloads, production changes or qualification claim are made.

Kernel lint cut9157cf360070990626744d3fcc2e160a20f25deb/run33967679812 passed122
harness and returned only formatting changes for the journey expectations.
Downloaded inspected nativeA summary3,808 compressedbytes; duplicateB3,807 and
fullA16,883/B16,881-byte diagnostics stayedremote. Complete6,175-byte one-file
formatter patch,0omittedbytes/paths, SHA256
5a31fdfd9326ddf81fe35dde336ed97c67c8f2bcec721b6d5f81daf967251840,
was applicability-checked and applied. No product tests ran in this fmt-only run;
all lint/test evidence and qualified baseline3aa remainunchanged/pending.

22fb7c814a43c37bf6b6f672f48b69f7fe4ced5e/run33967846046 passed122 harness,
formatting/full compilation and prior game lint, then er-kernel Clippy found only
two redundant cloned singleton arrays in m9e_coop_v7 assertions. Complete compact
diagnostic fit in the inspected3,581 compressed-byte nativeA summary; only that
artifact was downloaded. B3,586-byte summary and fullA85,640/B85,624 diagnostics
stayremote. Prior32 kernel warnings are cleared;0 producttests executed.
The two assertions now compare the same ordered full values using borrowed
singleton slices, preserving cardinality, test IDs and later ownership. Independent
source review approved. Only this exact co-op test path joins the retention
allowlist(18total); the122 existing gate tests pin it and reject its adjacent
unknown name. Co-op was already an exact required target; all33 targets, both
mutants, platform and limits remain. No product logic/API or baseline changed.
Remote lint and actual retention execution remain pending.

976da3722d9d61d3a911d570dd064c7fe45f5004/run33968266289 passed122 harness,
formatting, full reverse compilation and ALL required early Clippy targets:
CLI/protocol/repro/env/game/kernel/batch/worker/lab/web. Build151,862ms.
Actual662-test discovery validated all33 required targets. NativeA then timed
out at600,002ms on the FIRST target er-game:m9e_material_retention. Its two short
tests emitted success dots, but the12289-material three-full-window test remained
running; no target completed, so aggregate executed/passed counts correctly remain0.
No capacity/window/time limit is raised or reduced. Only inspected3,411 compressed-
byte nativeA summary downloaded; the complete needed timeout excerpt fit there.
Full101,623-byte diagnostics stayremote. B was still running when this repair was
prepared and will be superseded on the same focused branch; no mixed-SHA reuse.

Applied independently reviewed one-file cost repair, patch SHA256
5c3000d627e09d1731a6a25d45fa75aa70099d7e3808d7d23c694a0fd2e98c94.
Ledger uniqueness validation borrows OperationIds instead of cloning them.
The initial full ledger validation and every stale/duplicate/conflict/hardstop/
revision/content/state/frontier/checked-next rejection remain in original order.
After state cloning, the append tail now prunes/pushes/updates/publishes directly.
The former inner candidate-ledger clone and full revalidation added no reachable
Result rejection: the validated prefix, absent new operation, valid new digests,
exact next revision and oldest-only retirement preserve all ledger invariants,
including capacity1 and the historical gapped-ledger compatibility policy.
Outer runtime execute/dispatcher proof staging remains for CandidateMismatch
rollback. No Result-returning work is left after mutation; no new panic/OOM
guarantee or measured speedup is claimed. The unchanged five regressions/full
selected cone must still pass remotely. Baseline remains qualified3aa.

### Retention cost repair result and bounded timing follow-up

The exact 94645744d62500a61d62dd1445eebd88c81956c2 candidate, run
33969172226, again passed all 122 harness checks, formatting, full reverse-cone
compilation and required Clippy checks. Native A validated the 662-test inventory
but its first target, er-game:m9e_material_retention, timed out at 600003 ms;
the two short cases completed, while the 12289-material case remained active.
The first cost repair is therefore insufficient; no retention qualification or
measured speedup is claimed. Native B completed all 18 assigned tests (host
182284 ms, batch CLI 281424 ms, repro CLI 170610 ms) and then failed while writing
its phase manifest because the existing 64 KiB limit was exceeded. Platform was
skipped; aggregate failed. The qualified comparison baseline remains 3aa4a0c.
Only the inspected native A/B compact summaries (3414/3309 compressed bytes)
were retrieved; complete diagnostics remain remote.

The long helper test now emits bounded progress directly to stderr at revision1,
every512 revisions, and completion. It records cumulative real dispatcher and
replica-apply duration, total loop duration and one sampled full-ledger validation.
At most26 lines are emitted. These diagnostic timings have no pass threshold,
are from the existing unoptimized test profile, and overlap total duration.
The 12289 operations, real4096-record windows, independent effects/state/frontier
assertions, restore/preview, historical hard stop and stale/conflict checks remain
unchanged. The 600-second target and 35-minute job limits remain unchanged.

### Native phase evidence encoding repair (execution pending)

The native phase wire now uses a versioned native-inventory-indices-v1 wrapper.
It keeps the complete test inventory once and indexes repeated required-test
names plus assigned/completed target pairs. Reconstruction preserves every field
and list order before the existing plan/inventory hashes, exact test identities,
counts, lane ownership/union, mutants, and CLI/worker bindings are validated.
Both platform and aggregate use that reader; inline proofs remain readable.
Wire and compact limits remain65536 bytes. Indexed reconstruction additionally
rejects expanded proof serialization above131072 bytes, invalid integer types,
negative/out-of-range/duplicate references, incomplete permutations, missing
or ambiguous targets, unknown wrapper fields/versions and semantic hash mismatch.
No test identity, result, artifact, required target, workflow or timeout is removed.

Three phase regressions raise harness selftest declarations122 to125. They cover
an originally oversized proof roundtrip with reversed required-ID order and all
values retained, correctly wire-hashed tampering, and both encoded/expanded
bounds. All earlier assertions remain. Complete raw evidence stays remote.
The actual producer and consumers have not yet executed this source repair.

Source-size accounting used only the needed plan13772 bytes and inventory60215
bytes from the inspected946 native-B diagnostics archive, extracted by bounded
ZIP ranges (compressed members4013/13775 bytes), plus its existing compact metadata.
Required-ID indexing saves6186 bytes of repeated strings. A conservative lane-A
shape including all76 targets, inflated durations and extra artifact/policy fields
is64935 bytes; this estimate is not a successful actual manifest or future-growth
guarantee. Oversize evidence still fails closed. Independent source reviews passed.
The fully qualified baseline remains3aa4a0c/run33963418110; the timing-only4145
candidate remains bound to its separate remote run33970667797.

### First complete native retention result and private proof reuse

Timing-only4145afafcc95214372aa65b5773f7cf6e4811cf1/run33970667797 passed
all662 native tests (A644 across73 targets, B18 across3 targets), all122 harness
checks, full reverse compilation, formatting, required Clippy, native parity and
both real compiled timer/replica mutation controls. Both lanes then failed only
while writing the oversized phase manifest. Platform was skipped and aggregate
failed, so this is native evidence, not a fully qualified retention baseline.
It does not erase the earlier same-product600-second timeouts or prove stable
throughput across runners. Baseline remains the fully qualified3aa4a0c.

The helper retention target passed3 tests in422289 ms. Its12289-operation loop
reported420797 ms total,314435 ms dispatch and103477 ms replica apply; near the
full4096-record suffix, sampled validation cost was approximately8.6-9.2 ms.
The two V7 retention cases passed in150913 ms. Current CLI reload passed349109 ms;
all existing assertions, exact IDs and workload/window limits remained intact.
Native B's18 tests also passed but were slower than the preceding run, so absolute
cross-run timing comparisons require caution. Only inspected compact A/B artifacts
(2883/3303 compressed bytes) and the specifically needed3526-byte timing log plus
56767-byte full native summary were retrieved by bounded ZIP ranges from the
inspected136783-byte diagnostic archive; complete logs/assets stayed remote.

The reviewed runtime change now retains the private state and ledger already
produced and checked by the dispatcher's common material application. Public
prepare signatures still return only PreparedGameTransitionV2; callers cannot
supply or forge the private proof. Runtime execute publishes that verified owned
state/ledger and returns its prepared result, removing the second identical
state/ledger clone and common application. Initial policy validation, action/
content/context validation, canonical material encoding, common decoding/apply,
Applied outcome and exact candidate equality remain in their original order.
No Result-returning operation follows proof construction before publication.
Replica application, historical defaults, material identity, retention caps and
all rejection/restore boundaries remain unchanged. This removes one of the four
full-ledger validations in a dispatch-plus-replica iteration. It does not add a
validation cache or claim measured speedup. Root and independent causal review
approved the source; the same tests and bounded timing trace must verify it
remotely with the separately committed125-test phase-manifest repair.

### Native lane timeout and validation-cost repair (remote execution pending)

Candidate 3a441203aa35330ad7d2fc7b918c7ee2fd368901, run 33972172531,
was cancelled when native A exceeded its 35-minute job limit. Its last compact
checkpoint reports 610 passing tests, zero failures/skips and unfinished native
execution at er-batch:m9e_current_batch; it published no native A proof. Native B
passed all 18 assigned tests and published its indexed bounded proof. Platform
was skipped and aggregate failed. The fully qualified baseline remains
3aa4a0c/run33963418110. Partial passing counts are not retention qualification.

The retention helper target passed in 599060 ms, with the full 12289-operation
loop taking 596687 ms (dispatch 392843 ms, replica apply 200472 ms). Full-ledger
validation samples near the 4096-record capacity were about 17 ms. V7 retention
passed in 255667 ms and current CLI reload in 567462 ms. Cross-run runner variance
prevents attributing an absolute speedup or regression to private proof reuse.
Only inspected A/B compact archives (1371/3162 compressed bytes) and the needed
3563-byte retention progress member (849 compressed bytes) were retrieved, the
latter through bounded ZIP ranges from the inspected 94394-byte A diagnostics.
Complete logs, build outputs and proof artifacts remain remote.

The next cut moves only er-cli:m9e_current_reload to native B. Both existing
reload tests, worker/CLI bindings, full inventory validation, exact lane union,
required IDs and A-owned timer/replica controls remain mandatory. Platform still
uses A's parity and exact CLI; aggregate still requires successful complete B.
Three existing harness test bodies add exact crate-qualified assignment,
omission/completion, union and mutant ownership checks; all 125 declarations
remain. Target limits stay 600 seconds and job limits stay 35 minutes.

Ledger validation retains every existing check and error stage. Duplicate IDs
are checked using one bounded vector of borrowed OperationId references, sorted
and compared adjacently, replacing BTreeSet node insertion at the same stage.
Derived String equality and ordering make these predicates equivalent; record
order is untouched. The shared digest predicate uses explicit ASCII byte-range
patterns with the same exact prefix, 64-byte length and lowercase-only acceptance.
Full validation still runs on every invocation; no cache, trusted flag, skipped
import validation, schema change or retention-bound change is introduced. These
source changes require the unchanged remote ordinary and platform checks; no
measured speedup is claimed before that run.
