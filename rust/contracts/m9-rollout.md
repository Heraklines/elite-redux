# M9 signed rollout and health policy

`RolloutPolicyV1` is Ed25519-signed over `er-m9:rollout-policy-v1\0` plus canonical payload bytes. It identifies candidate, stable, optional legacy release, ordered rings, hard/soft stops, issue/expiry time, and policy revision. Cohort assignment is deterministic from policy ID and sticky-scope identity; it is never rerandomized on page load.

Rings are R0 CI/local, R1 internal allowlist, R2 signed preview allowlist, R3 1%, R4 5%, R5 25%, R6 50%, and R7 100%. Each promotion requires the same release manifest hash, candidate artifact hashes, minimum session count, minimum duration, health budget, expected current policy hash, and explicit protected approval.

Zero-tolerance hard stops: save corruption/loss, deterministic valid-save migration failure, mechanical divergence, mixed artifact execution, accepted protocol mismatch, cross-generation material, authority/replica material mismatch, unsigned assignment, and renderer/platform canonical mutation.

Initial rate ceilings are frozen in `m9-contract.toml`: Worker initialization 0.20%, unrecoverable kernel fault 0.05%, cloud save regression +0.10 percentage points, co-op regression 10% relative and 0.25 points absolute, input p95 regression 20%, crash-free regression 0.10 points. A soft stop pauses promotion; a hard stop halts candidate assignments and issues Rust-first rollback.

Any code, content, asset, Worker, backend contract, or manifest change creates a new release and restarts R0.
