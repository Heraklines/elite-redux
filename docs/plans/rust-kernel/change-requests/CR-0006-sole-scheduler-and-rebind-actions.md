# CR-0006: sole scheduler allocation and observable rebind actions

Status: approved for the immediate M2 contract revision

Owner: integration owner

Base: `c477388d2c857350c7a9657338a82e33056e337d`

## Request

Make `KernelScheduler` the only allocator and owner of live timer
registrations inside one `GameKernel`, make clock identity endpoint-qualified,
and return authority rebind redeliveries as data.

## Current frozen contract

The prose says `KernelScheduler` allocates and owns registrations, but the
frozen component APIs give AuthorityLog, ProposalLeaseManager,
RecoveryTransaction, and the M1 InputRouter no registrar seam. Their current
implementations therefore allocate or hard-code `TimerId` values and construct
`SchedulerCommand` directly. `AuthorityLog::rebind_connection` returns only a
count even though the oracle immediately redelivers every retained entry.

## Why implementation cannot satisfy it

All four timer producers start overlapping ID domains. A composed kernel can
therefore overwrite a registration, route a fired timer to the wrong owner, or
cancel a newer transaction with a stale ID. Authority and proposal action order
can also publish a reentrant-capable send before its retry registration is
observable. Finally, a numeric rebind count cannot carry the mandatory
redelivery effects.

## Source evidence

- `scheduler.ts` is the single runtime allocator; callers receive an opaque
  cancellation handle and never choose a timer ID.
- `authority-log.ts` schedules every delivery through that scheduler and
  publishes rebound retained entries after all binding state has changed.
- `proposal-lease.ts` schedules absolute and connected retries through the same
  scheduler and uses the sender-local runtime clock.
- `recovery.ts` schedules request, control, and pacing deadlines through the
  injected scheduler.
- The frozen Rust `KernelEffect` and `KernelInput` identify a timer with both
  `endpoint` and `timer_id`; two independent kernels may therefore use the same
  local numeric ID without sharing mutable scheduler state.

## Proposed minimal change

1. One `GameKernel` owns exactly one `KernelScheduler`. A producer may not
   construct `SchedulerCommand::Schedule` or `SchedulerCommand::Cancel`; it
   calls that scheduler synchronously and returns the command it received as
   an action/effect value.
2. Add a serializable `TimerSpec { endpoint, owner, delay_ms, time_class }` and
   `KernelScheduler::schedule_batch(Vec<TimerSpec>)`. Batch scheduling validates
   disposal and complete ID capacity before mutation, then allocates all
   registrations atomically in input order. `schedule` remains the one-item
   form. This is required for proposal arm's absolute and retry timers.
3. Timer-producing AuthorityLog, ProposalLeaseManager, and RecoveryTransaction
   transitions accept `&mut KernelScheduler`. They store only IDs returned by
   it. Cancellation also goes through it. Their private counters/fixed IDs are
   removed.
4. On `KernelInput::TimerFired`, `GameKernel` first verifies the endpoint against
   `scheduler.timer(timer_id)`, then calls `scheduler.fired(timer_id)` exactly
   once. It routes the returned `ScheduledTimer` by its exact owner/address and
   passes that removed registration to the owning component. A component may
   then schedule its successor timer through the same scheduler.
5. M1 `InputRouter` becomes scheduler-aware on the production path:
   `handle(endpoint, event, scheduler)`, `timer_fired(fired, scheduler)`,
   `clear(scheduler)`, and `replace_map(map, scheduler)`. Its private timer-ID
   allocator is removed. `InputRouterOutput` remains the effect-facing view of
   commands already applied to scheduler state.
6. Schedule registration and producer state are complete before the returned
   action vector exposes `Send`, `Deliver`, or `ProjectControl`. Schedule actions
   appear before those reentrant-capable actions. Proposal arm emits both
   schedules before its immediate send; retry re-arms before resend.
7. A scheduler's numeric `TimerId` is unique for its lifetime and is scoped to
   one kernel. At the `VirtualClock`/simulator boundary the identity is the pair
   `(endpoint, timer_id)`. The clock stores, cancels, orders, and fires by that
   pair; equal deadlines order by endpoint and then timer ID. This preserves two
   genuinely independent kernels without a shared mutable allocator.
8. A proposal lease timer is owned by `proposal.from`, not `proposal.to`.
   Destination/generation rebind changes the retained send target but never
   changes where its local retry clock fires. Re-arming an existing proposal
   requires the same `proposal.from`; a sender change at equal or newer
   generation fails closed atomically. Owner identities need only be unique
   within their kernel scheduler.
9. Add `AuthorityRebindOutcome { retained_count, actions }` and change
   `AuthorityLog::rebind_connection` to return
   `Result<AuthorityRebindOutcome, AuthorityLogError>`. An unchanged binding
   returns zero and an empty vector. A successful changed binding returns one
   immediate `Deliver` action per retained entry and authenticated peer after
   every context, peer stage, pending entry, and lease has been atomically
   rebound. `retained_count` counts leases, not multiplied delivery actions. A
   failed rebind leaves state and actions unchanged.
10. `dispose` is scheduler-backed and idempotent. After all owners cancel their
    registrations, `GameKernel` disposes its scheduler and exposes zero timers.

The concrete method signatures in `m2-api.md` and crate stubs are revised in
one integration-owned commit. No callback, trait object, async operation, or
ambient scheduler is introduced.

## Affected workers

M1 InputRouter/kernel compatibility, M2-01 scheduler, M2-03 authority log,
M2-05 proposal leases, M2-07 recovery, M2-08 virtual clock, M2-11/12 tests, and
all M2B composition/campaign lanes.

## Serialization impact

`TimerSpec` is an internal command DTO with the same existing timer fields.
Wire frames are unchanged. `AuthorityLog::rebind_connection` changes only its
Rust return type; `AuthorityRebindOutcome` contains existing values and
redeliveries already use the existing `AuthorityLogAction`.

## Fixture impact

Add collisions across input/authority/proposal/recovery, stale-fire/cancel,
atomic two-timer exhaustion, sender-versus-destination ownership, two kernels
using equal numeric IDs on one virtual clock, reentrant send ordering, rebind
redelivery, and resource-zero disposal tests.

## Migration impact

This is an immediate contract correction before G4. All affected M2A branches
restart or amend from the revised exact integration SHA. M2B receives only the
correct sole-scheduler API.

## Alternative rejected

A GameKernel local-to-global remapper was rejected because it would hide two
ID domains behind the same `TimerId` type and weaken static ownership. Global
shared scheduler state across both kernels was rejected because it would break
the required independent-kernel boundary. Caller-supplied timer IDs were
rejected because they preserve the collision class.
