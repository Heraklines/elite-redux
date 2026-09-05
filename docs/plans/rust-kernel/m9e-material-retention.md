# Current material history retention

Current V7 sessions retain a contiguous suffix of at most 4,096 applied material
records. The material applier can accept further valid revisions after that
window fills. The authority
and replica use the same retention policy, including after snapshot restoration,
loaded saves, natural startup and canonical battle-control reconstruction.

The first retained revision is the evidence floor. A well-formed material below
that floor returns `StaleUnverifiable`; it cannot be accepted as a verified retry.
Inside the retained suffix, an exact duplicate is a no-op and conflicting bytes
reject. New material must match the next authority revision, content identity and
current state digest. Complete candidate validation and checked revision advance
finish before any record is retired or any state is published.

Retention does not promise lifetime uniqueness for an operation-ID string. A
retired string may be used at a new valid revision; its old material remains stale.
The revision frontier does not reset when the evidence window rotates.

Existing V6 material/runtime callers keep `HistoricalHardStop` by default.
`BoundedSuffix { maximum_records }` is an explicit opt-in for those callers, with
capacities from 1 through 4,096. Their existing snapshot wire format does not carry
the policy: restoration must select it explicitly. V7 selects its fixed current
policy internally. Invalid or gapped imported evidence rejects rather than being
silently trimmed into an apparently complete suffix.

Five focused tests cover three full 4,096-record windows through actual domain
dispatch and replica application, smaller boundary windows, retained conflicts,
stale requests, invalid imports, revision exhaustion, and V7 restoration across
rollover with pending presentation and late-error rollback. The large fixtures
use controlled quiescent states and actual Save/Delete materials. They do not
perform external storage operations or prove natural authority gameplay across
three windows.

Material history is separate from proposal receipts and reconnect recovery.
This change does not implement retransmission after lost replies, a checkpoint
recovery exchange, or proposal-admission retirement. Those require their own
protocol behavior and witnesses. It also does not establish an allocation or
throughput improvement.

Exact remote qualification status is recorded in m9e-recovery-ledger.md.
