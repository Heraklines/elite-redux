# M8.1 reload performance

Measure on hosted release-profile runners after dependency/build setup. Report candidate process/Worker startup, artifact verification, snapshot capture, migration, restore, replay, atomic routing switch, predecessor retirement, peak RSS, snapshot bytes, tail events, and live-resource deltas separately.

Typical reload means: warm immutable artifact cache; snapshot at or below 1 MiB; at most 32 tail events; no schema migration or one additive edge; no network/storage latency; one solo session. Its end-to-end capture-to-active p95 ceiling is 250 ms. Atomic route switch p95 is 5 ms; snapshot migration plus restore p95 is 50 ms; short-tail replay p95 is 50 ms. Candidate startup is measured and reported separately and has a 10 s safety timeout.

Qualification includes 1,000 consecutive native swaps and 1,000 browser swaps. RSS after collection/retirement may not grow more than 25% or 64 MiB, whichever is smaller, relative to the settled baseline. Final live counts must be zero for retired processes/Workers, ports, pending requests, timers, listeners, and quarantined effects.

Benchmarks cannot omit verification, migration, replay comparison, generation fencing, or cleanup to meet the ceiling. A regression above 25% from the accepted M8.1 baseline fails the gate unless the contract is deliberately revised with new exact-SHA evidence.
