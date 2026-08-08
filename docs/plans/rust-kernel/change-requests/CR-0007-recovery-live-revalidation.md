# CR-0007: recovery live revalidation and terminal action delivery

Status: approved for the immediate M2 contract revision

Owner: integration owner

Base: `c477388d2c857350c7a9657338a82e33056e337d`

Resolves: M2-07 recovery result delivery and scheduler seams.

## Request

Give each recovery continuation the live state and sole scheduler required to
fail closed after asynchronous environment boundaries, and ensure operational
failure actions are returned rather than discarded behind `Err`.

## Current frozen contract

`accept_bundle` and `material_result` receive live context/frontier values, but
`recovered_frontier_staged`, `control_result`, and `timer_fired` do not. The
staging continuation reports only a revision and cannot say that the actual
replica refused the stage. No transition receives `KernelScheduler`, which led
the lane to fixed private timer numbers.

## Why implementation cannot satisfy it

Connection generation, membership, or ordinary frontier state can change
between material application, recovered-frontier staging, control projection,
and a paced retry. Without a fresh boundary value the transaction can install
or acknowledge stale control. Returning `Err` after mutating the fence to
terminal also drops the cancellation, fence-change, and shared-terminal effects
the kernel must execute.

## Source evidence

- `recovery.ts` checks abort/fence/context state throughout the transaction,
  binds the exact frontier entry before stage/control, and returns a terminal
  result on operational failure.
- `recovery-bundle.ts` validates request/context/membership, exact tail density,
  final revision/operation/control binding, and the equal-frontier one-entry
  reconstruction case.
- The Rust kernel is synchronous, so every deferred material/control/timer
  continuation must carry the current state explicitly; it may not retain a
  callback or ambient reference.

## Proposed minimal change

1. Add owned, call-scoped `RecoveryLiveState { frontier, context }`. A
   transaction receives it but never stores it.
2. Add `RecoveryFrontierStagingOutcome` with exact variants
   `Staged { revision }` and `Rejected { reason }`.
3. `start`, `accept_bundle`, `material_result`,
   `recovered_frontier_staged`, `control_result`, `timer_fired`, `abort`, and
   `dispose` receive `&mut KernelScheduler` whenever they can schedule or
   cancel. They follow CR-0006 and never construct a scheduler command.
4. `accept_bundle`, `material_result`, `recovered_frontier_staged`,
   `control_result`, and paced/control timer continuations receive a fresh
   `RecoveryLiveState` and revalidate stable session axes, exact membership and
   generation, captured frontier assumptions, and phase-specific control
   frontier before mutation or egress.
5. `GameKernel` consumes a timer through `KernelScheduler::fired` once and
   passes the removed `ScheduledTimer` to `RecoveryTransaction::timer_fired`.
   The transaction verifies exact timer ID, endpoint, owner, address, reason,
   and time class before acting.
6. The request ID and reason are non-empty. Request/control timeouts and pacing
   are positive. Bundle validation covers every tail entry and its stated
   successor; a material digest follows its own non-empty source rule rather
   than the operation-ID control-character rule.
7. Operational failures—including stale/mismatched bundle, material rejection,
   replica stage rejection, control rejection/timeout, context drift, and
   scheduler exhaustion—return `Ok(actions)` after atomically entering terminal
   state. Actions include all scheduler cancellations, the terminal fence view,
   and exactly one `Terminalize`. Disposed objects, unknown external timer
   injection, and impossible caller phase misuse remain `Err` paths and do not
   partially mutate.
8. One `RecoveryTransaction` owns one `RecoveryFence`; `GameKernel` owns one
   transaction per endpoint. No global, reference-counted, or cross-endpoint
   fence is introduced.

The revised method signatures are frozen in `m2-api.md` and the integration
stubs before the recovery lane restarts.

## Affected workers

M2-01 scheduler, M2-04 replica, M2-07 recovery, M2-11/12 tests, M2B-01 kernel,
M2B-02 pair, and recovery/reconnect/resource campaigns.

## Serialization impact

Wire frames are unchanged. `RecoveryLiveState` and
`RecoveryFrontierStagingOutcome` are internal Rust transition DTOs with explicit
camelCase/SCREAMING_SNAKE_CASE serde only where test traces serialize them.

## Fixture impact

Add context/generation drift at every continuation, rejected frontier staging,
unknown/stale timer metadata, zero pacing/timeouts, empty request/reason, full
tail semantic invalidity, scheduler exhaustion, and exact terminal action/order
fixtures.

## Migration impact

Immediate pre-G4 contract correction. The recovery lane restarts against the
shared scheduler and revised exact signatures. M2B receives no compatibility
shim or private timer domain.

## Alternative rejected

Retaining context/frontier inside the transaction was rejected as stale ambient
state. A shared/global fence was rejected because per-endpoint ownership is
already explicit. Encoding terminal failure only as `Err` was rejected because
it makes required effects unobservable.
