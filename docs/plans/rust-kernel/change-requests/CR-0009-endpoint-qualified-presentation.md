# CR-0009: endpoint-qualified presentation and one-shot storage faults

Status: approved for the immediate M2 contract revision

Owner: integration owner

Base: `f6db3605418c6bc7ce62b7249c9c171c0d4764b8`

## Request

Qualify every live presentation operation by endpoint and make the deterministic
storage fault contract observable, one-shot, and fail-atomic.

## Why the frozen contract was insufficient

Two independent kernels may allocate the same numeric `PresentationEventId`.
An adapter keyed only by that number aliases host and guest events, so settling
one event can remove or tombstone the other. A global set of numeric IDs also
collapses the pair and cannot prove the number of live presentations.

The storage prose required an atomic failure but did not say whether an injected
failure persisted, when it was consumed, or whether a synchronous request ID
could be reused. Those ambiguities make teardown and deterministic replay tests
depend on adapter internals.

## Approved change

1. Presenter state identity is `(SeatId, PresentationEventId)`.
2. `present`, `settle`, and duplicate-completion injection receive the endpoint.
3. `pending_event_ids(endpoint)`, `settled_event_ids(endpoint)`, and
   `diagnostics_for(endpoint)` are authoritative endpoint-scoped evidence.
4. The existing aggregate `diagnostics()` sets remain a compatibility
   projection only. Equal numeric IDs from two endpoints may collapse in those
   sets, so their lengths are not live-resource counts. Settled entries are
   tombstones and never count as live resources.
5. An injected `MemoryStorage` atomic-write rejection applies to exactly the
   next live `apply_recovery_atomically` call. Disposal is checked first. The
   rejection is consumed when returned and the complete stored value map is
   unchanged.
6. `execute` remains synchronous. Its request ID is pending only during the
   call and may be reused after the result is returned.

## Serialization and fixture impact

No protocol wire frame changes. Existing completion values remain unchanged;
the call context carries their endpoint. Adapter tests add equal IDs at both
endpoints, endpoint-specific settling/disposal evidence, one-shot rejection,
unchanged-map proof, and synchronous ID reuse.

## Affected lanes

M2-10 adapters, M2B-01 kernel integration, M2B-02 pair orchestration, M2B-09
native/Wasm parity, and M2B-10 resource teardown.
