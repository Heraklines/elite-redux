# Current shared-content batch execution

Status: source implementation pending remote checks. This cut follows the
replica-effect and causal-capsule cuts. No native, CLI, throughput, or memory
qualification is claimed from source review.

## Ownership and publication

`er-batch::current::CurrentBatch` owns independent CurrentGameSession values over
one Arc<PreparedGameContentV2>. Equal independently prepared content is validated
and restored onto that shared allocation while preserving the actual snapshot,
seat and role. Different content identities reject. Historical batch types remain
explicit compatibility code; the normal current CLI uses the new typed module.

An execution preserves the complete caller event order, including repeated and
interleaved environment IDs. It privately forks only affected sessions, applies
all typed CurrentExternalEvent values, and prepares the aggregate response before
publishing any candidate. Results contain ordinal, environment, full typed step
and observation. No platform request is silently completed and no returned effect
is delivered by the batch library. Invalid events, missing IDs, result-byte limits
or completion errors preserve every live environment. Read-only candidate access
lets adapters prepare aggregate evidence before publication.

Limits are explicit: at most 256 environments per batch, at most 4,096 events per
call (default 256), and a complete serialized result-array limit up to 16 MiB
(default 4 MiB). The byte counter includes delimiters and counts each result
before retaining it; it does not construct a second serialized array. These are
per-call bounds, not lifetime event limits. The CLI separately limits the complete
inline result to 4 MiB and admits the complete success JSONL envelope, including
the real request ID, before publication. Contextual admission is
implemented and must pass its remote tests before qualification. It covers batch
success envelopes; historical error-response framing is unchanged.

## Normal JSONL methods

| Method | Parameters | Result |
| --- | --- | --- |
| batch.create | batch, environments[{environment,start}], optional limits | New batch and environment identities |
| batch.reset | batch, environments[{environment,start}] | Atomic replacement, retaining original limits |
| batch.events | batch, events[{environment,event}] | Ordered typed results |
| batch.raw_input | batch, inputs[{environment,input}] | Raw-input alias for ordered typed events |
| batch.advance_time | batch, advances[{environment,milliseconds}] | Time-event alias |
| batch.observe | batch, environments[id,...] | Observations in requested order |
| batch.snapshot | batch, environments[id,...] | Complete snapshots in requested order |
| batch.fork | batch, source_environment, target_environment | Independent new environment identity |
| batch.close | batch | Disposed batch identity |

Environment IDs are SafeU53 values. Starts use current NATURAL/SNAPSHOT validation
or CAPSULE replay into a private session. Import never redelivers recorded effects.
Create/reset build and bound their complete candidates before claiming IDs or
replacing state. The CLI enforces a shared environment quota across batches and
standalone sessions, plus a bounded number of batch handles. Batches cannot alias
standalone mutable sessions. Worker-configured agents explicitly reject batch
operations until one worker generation supports multiple environments.

## Required evidence

Six core tests exercise natural Title-to-BattleCommand progression with actual
presentation receipts, held 249/1/500-ms input, two-environment ordered continuation,
late event rollback, aggregate callback rollback, exact byte boundaries, shared
content normalization, fork isolation, invalid IDs/capacities and disposal.
Two actual CLI test scenarios compare full steps, observations and snapshots with
direct sessions; cover import/reset failure and retry, quotas, small result limits,
raw/time aliases, fork/close, and success-envelope rejection before publication.
The protocol helper needs exact-boundary and escaped-request-ID witnesses.

The future isolated CI gate must compile the full reverse dependency cone and
execute the current batch, session, CLI, protocol, process and browser witnesses,
including the actual Chromium capsule-to-normal-CLI bridge. It must allow only
paired manifest/lock additions of existing dependencies: er-batch adds er-env,
er-game, er-kernel, er-state and serde_json; er-cli adds er-batch. Unmapped shared
kernel or dependency changes fail closed. All execution stays remote.

This cut does not finish generation-owned worker batching, reusable temporary
buffers, advance-to-an-identified-external-wait, continued batch capsule capture,
repro minimization, long-session retention or measured throughput/allocations.
The inner CurrentGameSession transaction also still clones a candidate. These
remain implementation and qualification work, not waived acceptance criteria.

## Measurable bootstrap copy follow-up

Source tracing found that session forks and kernel snapshot construction clone
RunBootstrapMachineV1's owned catalog vectors. Starter menus also repeat full
O(N)-sized controls per navigation and key release. These are measurement targets,
not a proven explanation of the current reload timing. The workspace already
enables Serde rc; inspected machine methods mutate the incoming catalog only
while sorting/validating in the constructor, then read it. Storing the validated
catalog in Arc could avoid catalog copies in forks and snapshots while preserving
serialized shape, but changes the public Rust field type and does not deduplicate
independently deserialized sessions. No such product change has been made.

Before qualification, remotely measure clone, reduction, validation, observation,
snapshot, encoding and digest separately at fixed bootstrap checkpoints with
prepared content outside the timed region. An Arc change needs an explicit owned
wire-view byte comparison, allocation-sharing and mutable-state isolation checks,
constructor rejection/sorting preservation and the full reverse/platform gate.
Profiles, controls and serialization still cost work; no binary codec or new
persistent-state framework is proposed.
