# M9 production observability

`ProductionHealthEventV1` carries schema, release, kernel generation, coarse browser/platform classes, closed event kind, optional bounded failure fingerprint, and optional bounded performance summary. It never carries raw saves, full party state, unrestricted traces, credentials, cookies, email, messages, or raw input history.

Allowed automatic kinds: bootstrap, Worker initialization, save migration/read/write/conflict, kernel fault, pairing, reconnect/recovery, presentation failure, service-worker mismatch, cache failure, terminal completion, and performance outlier.

Failure fingerprints are deterministic hashes over normalized error class, release/generation, subsystem, and bounded causal code. Raw exception text, URLs with queries, headers, and payload bytes are excluded. Performance aggregation reports count, median, p95/p99, maxima, and bounded resource deltas.

Full repro capsules require explicit user action/consent or a documented internal diagnostic cohort. Shadow sampling is side-effect free, capped by policy, and mechanically divergent samples hard-stop rollout.

Every health decision retains exact policy hash, release manifest hash, input event aggregate hash, decision, and time window so identical inputs reproduce the result.
