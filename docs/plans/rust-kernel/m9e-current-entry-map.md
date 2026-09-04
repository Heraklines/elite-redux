# M9E A0: current entry ownership and first executable witness

Base: `5c21f3dc9e899a0d1902ee3637af1b58a29fbd24` on
`wrk/m9e-recovery-20260904-source`. This is a bounded source inspection and
regression specification, not a completed cutover or remote test result.

## Observed entry paths at the base

| Entry | Actual session/kernel | Content and boundary | Gap |
|---|---|---|---|
| `er-cli new-run` | `GameEnvironment::new_run` -> `GameKernelV6` | Caller-supplied `GameStateV5`, `PreparedGameContentV1`, raw physical keys; terminal effects formatted with Debug | No natural V7 initialization |
| `er-cli resume`, `simulate` | `GameEnvironment::from_snapshot` -> `GameKernelV6` | `RestorableKernelSnapshotV6`, V1 content; simulation advances time | Current V7 snapshots/content cannot enter |
| `er-cli agent --protocol jsonl` | `CliAgentDispatcher` -> existing `GameEnvironment` | V6 snapshot loaded before JSONL starts; `AgentRequestV1`/`AgentResponseV1`; raw input/time return effect counts | `session.create` only reports SOLO; it does not create a new game |
| `er-cli agent --protocol jsonl --warm true` | `WarmCliDispatcherV1` -> `WarmCliSessionV1::{Bootstrap,Game}` | Standalone `RunBootstrapMachineV1` or V6 environment; V1 content | Natural bootstrap forwards raw keys but never installs a current V7 game when complete |
| `er-cli replay` | `validate_replay` -> `GameReplayV1::validate` | V1 content identity | Validation only; no event execution |
| `er-cli capsule-validate` | `ReproCapsuleV1::decode` | Bounded capsule files | Validation only; no event execution |
| `er-cli inspect-content`, `validate-save` | V1 prepared content / `GameSaveV1` | Historical identity/save format | Not current content/save verification |
| `er-env::GameEnvironment` | Owns `GameKernelV6` and `Arc<PreparedGameContentV1>` | V6 snapshots; raw input/time; custom `GameEffect` wrapper | Current public facade is historical |
| `KernelWorkerRuntimeV1` | `Option<GameEnvironment>` | V6 restore/trace types and V1 content | Native generation worker shares historical environment; sequence accepted before fallible operation |
| Direct `GameKernelV7` | Bootstrap -> `GameRuntimeV6` -> terminal lifecycle | `PreparedGameContentV2`, `CoreGameKernelSnapshotV7`, typed `GameKernelStepV7` | Existing implementation to reuse |

Inspected files: `er-cli/src/main.rs`, `er-cli/src/m72_lab.rs`,
`er-env/src/lib.rs`, `er-agent-protocol/src/lib.rs`,
`er-kernel-worker/src/runtime.rs`, `er-kernel/src/game_kernel_v7.rs`,
`er-kernel/src/snapshot_v7.rs`, `er-game/src/m9e_content_v2.rs`,
`er-game/src/m9e_new_run_v6.rs`, and the constructor/control witness in
`er-kernel/tests/m9e_game_kernel_v7.rs` (paths relative to `rust/crates`).

The lab's module inventory alone does not establish execution ownership.
`er-lab` reload/daemon, `er-batch`, `er-devplane`, `er-repro` replay, and the
browser delegate need their own bounded consumer trace before claiming the
complete tools cutover. The handoff identifies `BrowserKernelHostV2` as V7;
this A0 witness does not certify browser, worker, batch, or co-op execution.

## Existing current interface to reuse

`GameKernelV7::natural_start(profile, seed, local_seat, save_slots,
local_is_host, content, scheduler, protocol)` creates the title bootstrap
inside the kernel. It derives the bootstrap catalog from current prepared
content. Normal clients should not supply a second catalog.

`from_snapshot(snapshot, local_seat, role, content)` restores V7 explicitly;
seat and role are restore context, not inferred from a V6 fallback.
`snapshot()` returns a validated current lifecycle snapshot. `state()` is
optional during bootstrap; `current_control()` supports bootstrap and play.

Already implemented external operations include `raw_input`, `advance_time`,
`ingest_network_frame`, `transport_changed`, `settle_presentation_outcome`,
and `apply_storage_result`. Preserve their typed `GameKernelStepV7` effects
(`UiChanged`, `ProposalReady`, `AuthorityMaterial`, `Presentation`,
`Platform`, `Terminal`) at the shared session boundary. Exact lifecycle,
timer-wakeup and model-result support remains implementation work where the
existing kernel lacks the required causal operation.

## First remote executable regression

Owned test: `rust/crates/er-cli/tests/m9e_current_entry.rs`.

Remote command, from `rust/`:

```sh
cargo test --locked -p er-cli --test m9e_current_entry
```

Initial A0 test count: **2**. The runner needs the existing committed fixture
`rust/fixtures/m9/engineering/game-content-bundle-v2.json`; do not download
or generate it locally. The test launches the actual `CARGO_BIN_EXE_er-cli`
with finite JSONL input and closes stdin.

1. `public_agent_natural_start_owns_v7_content_and_raw_controls`: launch the
   normal warm agent using V2 content, create NATURAL, verify current content
   identity, decode and validate an actual V7 snapshot, send Enter keydown
   and keyup, then verify Title -> ModeSelect in another V7 snapshot.
2. `public_agent_rejects_old_snapshot_schema_without_replacing_current_session`:
   create NATURAL, accept a valid V7 snapshot in a second session, reject an
   otherwise identical snapshot with schema version changed to 6, and verify
   the first session snapshot remains unchanged. Acceptance of the valid
   snapshot prevents an always-rejecting restore from satisfying the witness.

The expected baseline failure is the real executable rejecting V2 content
through its V1 loader, before it serves the JSONL requests. This expectation
must be observed remotely; no tests, builds, or formatters ran locally.
The deliberately invalid schema is only an in-memory negative test payload,
not a committed runtime fault or a claim of full legacy migration coverage.

## Minimal adapter contract required for the next cutover

Keep the current `agent --protocol jsonl --warm true --content <V2 bundle>`
entry and protocol envelope. Add `kernel_version: 7` and the serialized
`PreparedGameContentV2::identity()` as `content_identity` to `protocol.hello`;
the existing hello has no identity fields. Identity labels supplement the
executable snapshot/control assertions and cannot replace them.

`session.create` NATURAL accepts `profile`, `seed`, `owner_seat`, `save_slots`,
and `local_is_host`, passing them to the existing V7 constructor. SNAPSHOT
accepts `snapshot`, `owner_seat`, and `role` (`AUTHORITY` in this witness).
`session.snapshot` returns `CoreGameKernelSnapshotV7` directly;
`session.raw_input` accepts the existing serialized `RawInputEvent`.

The shared current facade belongs in `er-env`. Preserve historical APIs with
explicit compatibility naming/routing while consumer changes land; do not
switch historical types by search-and-replace, hide another bootstrap beside
V7, or make native CLI depend on Wasm/browser bindings. One current session
must own construction, typed external events, observation, snapshot/fork and
disposal before the worker/browser consumers delegate to it.

Status: **CLI_VALIDATED** at `e4064dba1c8001724eefb715ab01b62a1eab610a`,
run `33924401642`; see `m9e-recovery-ledger.md` for the preceding real red baseline
and full integration run. This closes the bounded current CLI identity/bootstrap
seam, not Gate A or M9 engineering.

## A1 CLI implementation checkpoint (remotely validated)

`er-env/src/current.rs` adds `CurrentGameSession` beside the retained historical
facade. It owns the existing V7 kernel, shared prepared V2 content, local seat
and role. Natural initialization starts the real V7 bootstrap with a live empty
scheduler (`next_timer_id: Some(0)`). Restore validates V7 snapshots explicitly.
The facade exposes read-only structured observation, snapshot, validation,
typed external events, fork and disposal. An active-state mechanical digest
is absent during bootstrap rather than labeling a control-only digest as game
state. Observation does not clone the complete session or snapshot.

`er-cli/src/current_agent.rs` serves the normal `agent` command using that
facade. The old route is explicitly `agent-v6`. Current `new-run`, `resume`,
`simulate`, `replay`, and the remaining developer tools require their own
consumer cutovers. Explicit current worker ABI2 and its real lab endpoint passed
27 native witnesses plus formatting/Clippy at `c2c3ca6383762cc411582e089e2cf26e1caf20d6`
(run `33930869104`); activation supervision and current tool integration remain
separate work. Browser delegation has since passed
focused remote verification at `b7e2266cfbe774664a7737160c90727a71e4a030`
(run `33926691832`); this checkpoint does
not silently relabel the remaining entries as current.

Callable methods added to the current adapter use the existing protocol
allowlist: `session.create`, `session.from_snapshot`, `session.observe`,
`session.snapshot`, `session.checkpoint`, `session.raw_input`,
`session.advance_time`, `session.network_frame`, `session.transport_changed`,
`session.storage_result`, `session.presentation_settled`, `platform.event`,
`session.restore`, `session.fork`, `session.close`, and `session.invariants`.
The latter invokes kernel validation. `session.state_delta` is unsupported;
full observations are not mislabeled as deltas. Read structured menus through
`session.observe.control`. Fork names its destination in `target_session`.

`CurrentExternalEvent` forwards existing V7 raw input, time, generation-bound
network, transport, storage outcome and presentation outcome operations.
Responses contain a typed `GameKernelStepV7` as `step`, not debug strings or
only effect counts. Missing suspend/model/repro operations return unsupported
results until implemented; no successful no-op is used as a substitute.

The adapter caps requests and directly readable responses at 4 MiB, and live
sessions at 256. The historical server's inaccessible artifact-reference path
is not used: responses above the cap fail. Event execution and response-size
validation occur on a candidate session before it replaces the original.
The facade stages its kernel once through `apply_with`; the CLI prepares its bounded
response in the completion closure before commit. A native helper regression rejects
completion after a valid event and proves full snapshot rollback and successful retry.
Immutable content is shared across sessions. No measured throughput claim is made.

The same remote command now selects **4** executable tests. The two additional
tests verify time-event replay sequence changes, exact fork equality under the
same non-key event, snapshot restoration, closed-session rejection, and exact
state preservation when generation-bound network, storage, and presentation
results have no corresponding valid pending operation. They require actual
`BACKEND_ERROR` responses, so an unrecognized method or malformed payload does
not accidentally count as exercising the kernel's negative path.

All verification and formatting remain remote. No local build, test,
installation, fixture download, runtime process, or formatter was executed.
Remote evidence includes four real CLI executable witnesses plus the native session
transaction regression. Timer consequences, natural
campaign/co-op play, complete repro, hot reload, and browser topology remain
outside these four bounded witnesses.
