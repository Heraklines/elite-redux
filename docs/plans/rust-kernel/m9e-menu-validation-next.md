# Shared menu validation cost

Status: IMPLEMENTED_PENDING_REMOTE_CHECKS. The exact preceding CLI reload
candidate5cbba49 passed all44 native tests and both Wasm parity witnesses in
run33941386739. This optimization has not yet run remotely.

`GameMenuV2::validate` previously scanned the entire options vector to establish
visible membership for the selected option and both endpoints of every edge.
For a vertical menu this is quadratic work per validation. Bootstrap snapshots
retain the catalog and menu; natural starter traversal repeatedly validates them
through the current session, worker and snapshot boundary. This is a source-level
cost finding, not proof of the earlier CLI test timeout's sole cause. On the last
unchanged-product pass, reload took402,712ms; other targets were also faster than
on the previous runner, so no speedup is attributed to one diagnostic change.

The patch builds a `BTreeSet<&MenuOptionId>` of visible IDs after the original
per-option checks, then tests membership through that set. It preserves input
ordering, hidden-duplicate behavior, action/layout/visibility/cancel/logical error
precedence and the existing cancel and logical-menu validation paths. It supports
unsorted deserialized option vectors. No canonical representation, kernel,
protocol, content or effect policy changes. Visibility checks become
O(options log options + edges log options), with O(visible IDs) borrowed-pointer
storage. LogicalMenu already uses indexed membership; it remains unchanged.

Five semantic regression tests independently check a valid unsorted graph with
disabled nodes and a hidden duplicate, missing/hidden selection and edge
endpoints, invalid hidden-option actions/layouts, cancel eligibility and error
precedence, and duplicate navigation rejection. No wall-clock threshold is
asserted in these domain tests.

The focused remote gate requires these exact five identities, the unchanged
actual CLI reload/entry, worker/supervisor and native parity identities, current
kernel/state/protocol/environment/browser tests, the full reverse compile cone,
types and adapter Clippy, two Wasm tests, and the existing two Chromium plus one
typed effect test. The current reload target executes first only after complete
discovery and required-identity checks. Unrelated source or lockfile changes fail
planning; the existing paired CLI worker-dependency guard remains mandatory if
that cumulative manifest/lock delta is present. B2 and causal capsule changes
are excluded. All execution and formatting remain remote.
