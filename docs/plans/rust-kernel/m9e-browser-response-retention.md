# Current browser response retention

Implementation limits; exact qualification status is recorded in m9e-recovery-ledger.md.

BrowserKernelHostV2 retains at most 2,048 accepted responses and 64 MiB of
serialized response payloads. A single response keeps its existing 32 MiB limit.
Response admission completes before the game transaction commits. The accepted
sequence determines which entry is oldest, independently of request-ID ordering.
An append copies only the new response; it does not copy the retained history.

An exact retained request returns the same response bytes without applying the
operation again. Reusing that request ID with different bytes rejects. An evicted
old request rejects as stale because its sequence no longer matches the next
accepted sequence. Rejected ingress may declare a diagnostic capture gap under
the existing recorder policy. This cache does not provide a reconnect protocol.

Disposal clears the retained payloads and their byte counter. The existing disposed
host behavior rejects all subsequent requests, including a disposal retry. A fresh
host starts with empty cache accounting and sequence zero.

The byte bound covers serialized retained response payloads. Map nodes, request
fingerprints, allocation capacity, temporary serialization, the returned response,
prepared content and the game session consume additional memory. It is neither a
whole-host heap limit nor a peak-memory measurement. Core material history, proposal
receipts and recorder history have separate owners and retention contracts.

The two focused unit witnesses use real accepted host responses and independently
computed encoded lengths for exact-fit and one-byte-short boundaries. They check
acceptance-order eviction, full snapshot/sequence/cache rollback, retries, conflicts,
corrected continuation and disposal. The existing integration witness sends 2,101
active-session snapshot requests across the production count window. Small private
byte budgets exercise byte boundaries without allocating a stress-sized cache.
No 64 MiB stress, allocation, Wasm-memory or throughput result follows from these
source tests alone. Native and platform execution remain required.
