# M4 performance contract

## Measurement policy

Benchmarks run release-profile on the same hosted runner class. Build/setup and content-load time are recorded separately from execution. Every result records candidate SHA, runner image, CPU, peak RSS, event/wave/battle count, transition count, and RNG-draw count.

Correctness gates run before benchmarks. A benchmark cannot reduce content fidelity, assertions, transition evidence, raw-key input, fault schedules, snapshots, or teardown checks.

## Initial ceilings

| Workload | Ceiling |
|---|---:|
| 10,000 wave transitions | 30 seconds |
| 1,000 reward/market cycles | 30 seconds |
| 1,000 biome transitions | 30 seconds |
| 100 complete 200-wave runs | 120 seconds |
| 100,000 run-surface raw-key events | 5 seconds |
| 1,000 two-client wave transitions | 30 seconds |
| 200-wave deterministic campaign peak RSS | 512 MiB |

The machine-readable source is `rust/fixtures/m4/m4-benchmark-manifest.json`. This document and that manifest must agree.

## Regression policy

The first accepted all-green M4 hosted run becomes the baseline. A later execution-time or peak-RSS regression greater than 25% fails unless the contract is deliberately revised with causal evidence. Warm-cache results cannot replace clean candidate evidence.

## Allocation rules

Compiled production code avoids avoidable allocation, copying, hashing, and recomputation. Immutable content is shared. Mechanics use staged clone-and-swap at the atomic owner boundary for correctness; internal helpers borrow and update staged state rather than repeatedly cloning nested parties, surfaces, or content.

No optimization may introduce a privileged authority apply path, mutable global content, nondeterministic iteration, fast-math, lossy snapshot, or partial transaction.