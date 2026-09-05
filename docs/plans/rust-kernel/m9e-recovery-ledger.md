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
