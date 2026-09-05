# Current reload and terminal cut — source prepared, remote proof pending

This file records the bounded work after B1; it is not completion evidence.
All execution remains remote. Never blanket-stage the shared checkout.

## Supervisor cut

Prepared product paths:

- `rust/crates/er-kernel-worker/src/protocol_v2.rs`: derive initializer seat/role.
- `rust/crates/er-lab/src/kernel_reload/endpoint_v2.rs`: retain only acknowledged
  session context; failed operations preserve it, fencing/disposal clears it.
- `rust/crates/er-lab/src/kernel_reload/mod.rs`: export current supervisor.
- `rust/crates/er-lab/src/kernel_reload/supervisor_v2.rs`: bounded absolute event
  frontier, pre-tail checkpoint, complete typed events/effects/observations,
  quarantined exact replay, candidate identity/frontier checks and activation.
- `rust/crates/er-lab/tests/current_kernel_supervisor_v2.rs`: nine actual-worker
  tests, bound to the exact non-test executable and five metadata environment
  fields already used by the verified endpoint tests.

The supervisor adopts acknowledged context instead of caller assertions.
Eviction expires old tickets without limiting session lifetime. A committed
event whose trace record cannot fit returns accepted evidence with an explicit
retention gap. Failed candidates leave the active endpoint unchanged. After
activation, a predecessor-disposal problem is reported on the accepted result;
it must not be relabeled as activation rejection.

The principal test reaches a natural BattleCommand, checkpoints before holding
Down, replays 249/1/500 ms, activates with a live repeat, then checks continued
250 ms repeats and release against the direct shared session. Other tests cover
count/byte retention, stale preparation, identity rejection, a recording gap,
acknowledged context, and actual predecessor retirement failure. The context
fixture explicitly removes authority-only AI before constructing a validated
replica bootstrap snapshot; it does not claim a cooperative journey.

Focused `supervisor_focus` mapping has an eight-path combined supervisor/budget
extension prepared with mandatory worker-process and lab witness targets.
After B1 passes, advance the baseline to its exact passing SHA, commit only
this combined cut plus its mapping and ledger, then
run the mapped native endpoint/supervisor/worker/CLI/historical tests and
worker/lab Clippy. Retrieve only inspected, named compact artifacts. Apply any
remote formatting patch; no local Cargo/fmt/test.

## Normal command cut

Prepared separately: `er-cli/src/current_commands.rs`, current routing in
`er-cli/src/main.rs`, and two added tests in `er-cli/tests/m9e_current_entry.rs`.

`new-run` starts natural V7 Title with explicit V2 content, profile, seed and
preview save slot. `resume` restores V7. Both accept the existing terminal key
shortcuts or a typed CurrentExternalEvent JSON line (including leading JSON
whitespace), plus `snapshot` and `q`. All effects are emitted as data. Storage
success and presentation delivery are never fabricated by the terminal.
`simulate` advances the restored current session with explicit milliseconds and
emits each typed step plus final observation/snapshot. `inspect-content` reports
V2 identity and inventory. Previous implementations have explicit `-v6` aliases.
Replay/save validation and batch still need their own current cut.

Tests use the actual executable for natural start, resume with non-key time,
inspection, legacy-state-injection rejection, and simulation. The same natural
journey continues into combat, captures a held-button snapshot, and verifies
two real repeat consequences against full steps/snapshot and independent
fight/party cursor expectations. Source review is complete; no tests ran yet.
The new module/main paths are prepared in the narrow current CLI map; keep
this separate from the supervisor cut to preserve its Wasm parity witnesses.

## Success-response budget cut (implemented, pending remote)

Worker BootstrapV2 now accepts a serde-defaulted nonzero success-envelope cap,
up to the existing 16 MiB transport bound. Every success is encoded under that
cap before mutating the session, applied count or accepted sequence. Fault
responses retain the hard transport bound. Endpoint `spawn_with_limits` checks
actual consumed envelope bytes, and successor generations inherit cap and
request/shutdown deadlines.

Worker process target now has five tests. Supervisor target has nine. The new
supervisor regression derives a cap from a genuine held-navigation snapshot,
finds an effectful time advance exceeding it, proves the identical event works
in the actual default-cap worker, then verifies negotiated-cap rejection leaves
full snapshot, context and accepted sequence unchanged. A smaller effectful
request succeeds immediately at the same sequence. Generation two repeats the
large-response rejection, proving inheritance. Tiny/invalid bootstrap cap tests
cover fault delivery, initialization/disposal rollback, omission compatibility,
and process exit. These are source-complete; remote execution remains pending.

## Normal JSONL worker/reload adapter (implemented, pending tests and remote)

Separate later cut: `current_worker_agent.rs`, `current_agent.rs`, main module,
CLI manifest + exactly one already-locked workspace dependency, protocol
allowlist (`session.reload`), and `m9e_current_reload.rs` actual process tests.
Keep the preceding supervisor/budget and utility cuts independently qualified.

The normal `agent` accepts optional `--worker-executable`, `--worker-root` and
`--worker-identity` together. The template identity is validated against current
V2 content; each current session is adopted through a V7 snapshot into an
executable whose bytes are verified inside the configured root. In-process
execution remains the ordinary default. Native startup content/profile inputs
remain preview fixtures; no deployment, player-save access or production default
is changed.

`session.reload` action `begin` captures a ticket before later events. Action
`activate` accepts the ticket, candidate executable and newer identity, replays
the complete retained accepted-event tail with quarantined effects, checks full
snapshot/observation/step equality, then activates and retires the predecessor.
Ticket numbers are monotonic across the dispatcher lifetime, including session
close/reuse and restore. Failed activation preserves the ticket; accepted
activation and restore invalidate it. Fork uses the currently active executable
and acknowledged context. Restore creates a validated replacement before swap.
Retirement failures are bounded metadata on an accepted result.

The worker success cap is 4 MiB. Apply returns only step and observation, a
strict JSON subobject of the already bounded worker envelope; no fallible
postcommit adapter bound is introduced. Content/snapshot file reads in normal
agent startup are now bounded. Exact-preservation reload is implemented; intended
behavior-change acceptance, causal export, asynchronous build/watch integration,
and final qualification are still outstanding.

## Following causal export/replay cut (designed, not implemented)

Reuse current typed event, V7 snapshot, step and observation types in a thin
`CurrentReproCapsuleV1` in er-repro, with canonical evidence. Historical ERCAP71
failure-oracle fields cannot honestly stand in for current browser evidence.
Capture content and acknowledged seat/role, checkpoint before tail, absolute
attempt positions and bounded ordered events with applied/rejected outcomes.
Normal `session.from_capsule` (already allowlisted) must validate and replay in
isolation and publish the requested session ID only after complete evidence and
bounded result succeed. Replay effects stay quarantined.

Browser host currently resets to an AFTER-event snapshot for every non-key
request and retains only keys. Replace that recording path and transport the
same capsule through Rust and TypeScript host contracts and export routes.
Capture lifecycle/focus origin and ordered transport generations. Kernel
rejections preserve committed state; late host response-size failures preserve
candidate evidence but are distinct adapter failures, not falsely reproduced
CLI failures. Rotate using a verified pre-attempt checkpoint; if even one event
cannot fit, mark capture explicitly unavailable/gapped. Do not relabel a lost
cause as complete replay. Malformed/admission failures need bounded diagnostics.

Required actual-entry witness: current browser host natural journey, held input
plus 249/1 ms time and release, export capsule, replay via actual normal CLI,
compare every step/observation/full snapshot, then continue a non-key event.
Negative tests remove/reorder non-key events, change content, exceed bounds,
record kernel and adapter rejection, exercise rotation and exact retries, and
prove failed import leaves session ID free. A real Wasm/browser export route
must transport that same capsule. Source-only design is not execution evidence.

The later CLI reload map must separately guard the sole parsed manifest/lock
addition `er-cli -> er-kernel-worker`, with every other package record, manifest
field and lock metadata unchanged. Required actual targets include both CLI
current-entry/reload tests, worker process tests and current lab endpoint/
supervisor witnesses. Extend worker artifact environment binding from name-only
lab targets to crate-qualified pairs including `er-cli:m9e_current_reload`;
update the executable-required selection and witness check as well as both
listing/execution environments. Keep CLI/worker/lab Clippy and add protocol
Clippy for the allowlist. Do not use this exception to admit shared env/kernel/
browser changes. Missing or ambiguous exact worker artifact must fail the gate.
