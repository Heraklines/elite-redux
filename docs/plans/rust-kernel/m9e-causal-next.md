# B1a: current V7 held-navigation timer consequence

Status: READY_IMPLEMENTATION. Source review only; no build, test, formatting,
commit, or push performed by this lane.

Base: `5c21f3dc9e899a0d1902ee3637af1b58a29fbd24`.

## Observed seam

`GameKernelV7::advance_time` (`game_kernel_v7.rs:642`) subtracts elapsed
time, removes expired registrations, and emits anonymous `TimerFired` kind
observations. It never dispatches an owner consequence. Its active keyboard
and gamepad handlers record held sources but never register a repeat. Browser
repeat is ignored. Existing `m9e_game_kernel_v7` and `m9e_snapshot_v7` tests do
not call `advance_time`.

Existing reusable structures are `InputRepeatSnapshotV2` (seat, button,
physical source, menu identity, timer ID), `RestorableTimerSnapshotV2`,
`KernelSchedulerSnapshotV2::{into_scheduler,from_scheduler}`, and
`KernelScheduler::{schedule,cancel,fired}`. `TimerOwner::input_repeat` and
`TimeClass::HumanInput` already name the purpose. The established input router
normalizes the initial delay and successor interval to 250 ms.

`BattleInputRouter` supplies a useful ownership/cancellation reference, but
cannot directly restore V7 input: its fixed map differs (Enter is Submit,
Escape/gamepad mappings differ). Do not silently replace V7 mappings or weaken
that historical router's fixed-map validator.

`KernelSchedulerSnapshotV2.next_timer_id = None` means exhausted allocation,
not a new scheduler. Current V7 test helpers use this value. Fresh current
session constructors must use `Some(SafeU53::ZERO)`; restored exhausted
snapshots must retain `None`.

## Bounded implementation ownership

- Integrator grants this lane exclusive edits to
  `rust/crates/er-kernel/src/game_kernel_v7.rs` and
  `rust/crates/er-kernel/src/snapshot_v7.rs` for this patch.
- New test ownership: `rust/crates/er-kernel/tests/m9e_timers_v7.rs`.
- Integrator/current-session lane updates its fresh scheduler constructors.
  Existing V7 test helper constructor corrections are agreed integration
  edits. No changes to historical V6 semantics or shared wire types needed.

The slice is active-session held navigation. Accepted directional keyboard
or gamepad input registers exactly one repeat owned by its held source/menu;
expiration re-enters `handle_button`, publishes the real `UiChanged`, and
registers its successor. Release, blur, obsolete menu identity, lost
actionability, blocking presentation, and terminal state prevent stale
navigation. Recheck logical locks so two physical sources cannot create
duplicate repeat streams for one logical button.

Advance virtual time chronologically, selecting the next unpaused deadline
and then `(endpoint, timer_id)` for ties. Dispatch each consequence before
consuming the remaining elapsed duration, so its successor participates in
the same request. Reuse scheduler allocation/cancellation through the
existing snapshot bridge; do not resurrect exhausted IDs. Preserve time
class pause reasons and validate exact repeat/registration ownership during
V7 snapshot validation (currently the two halves validate separately).

Stage the request and commit only after success. Enforce the existing
`GAME_INTERNAL_TIMER_CONSEQUENCE_BUDGET_V2` (1,024) with a typed timer-budget
error containing bounded identifying evidence. An excessive advance must
not publish partial cursor/timer/replay changes. Unknown timer purposes
must produce an explicit unsupported-purpose error without deleting the
registration; completing retry/recovery/presentation purposes is subsequent
B1 work, not certified by this slice.

## Witnesses and remote gates

Positive: genuine natural initialization, settle setup presentations, then
hold ArrowDown through raw input. Assert one immediate movement, none at
249 ms, movement plus `UiChanged` at 250 ms, and another at 500 ms. Compare a
750 ms advance with three 250 ms advances using cursor, timer successor IDs,
remaining durations, and effects (external replay sequence counts differ).
Snapshot/restore mid-delay must continue identically. Cover gamepad input,
two equal deadlines, and independent pause reasons.

Negative: release/blur before deadline yields no repeat consequence; old
menu ownership cannot move a new menu; corrupted repeat/registration pairing
fails restore; allocator exhaustion and timer budget overflow leave the
complete pre-request snapshot unchanged. An isolated remote mutant removing
the dispatch into `handle_button` must fail the cursor/effect assertion.

F remote target: `cargo test --manifest-path rust/Cargo.toml -p er-kernel
--test m9e_timers_v7`, plus existing V7 kernel/snapshot/co-op regressions and
the focused map's mandatory shared-state/material/eventwise dependency
targets. All fixtures remain on the remote runner. A later integration gate
must exercise the same event sequence through current native and Wasm
entries. This report is source evidence, not a passing gate or M9 completion.

Handoff commit/report artifact: pending implementation and remote execution.
