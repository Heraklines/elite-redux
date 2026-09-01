# M9 Engineering Execution Ledger

Updated: 2026-09-01

## Frozen baseline

- Branch: `arch/rust-kernel-m9-engineering`
- Implementation tip entering qualification-ledger update: `2ac1edc063421578cf95c1cb5e8b40853d91d4ab`
- Expected base: `06341375ee2d206ed246c0504789ed853039fd6c`
- TypeScript oracle: `399d5d368f0b5642ebf8f45bd8a5e73350fa4de7`
- Architecture: `CLEAN_V7_CUTOVER`
- Final tag, after exact-SHA qualification only: `rust-kernel-m9-engineering-final`
- Release boundary: engineering only; no deployment, G53, R2-R7 rollout, production default change, or legacy production-save access/migration.

## Prepared content

| Domain | Counts | Hash | State |
|---|---|---|---|
| Battle V3 | 1,962 species; 3,384 forms; 1,109 moves; 1,261 abilities; 215 held items; 8 statuses; 13 weather; 6 terrain; 168 fields/tags; 3,678 programs; 9,411 classifications; 120 type-chart entries | `blake3-v3:b53078e1088c3c3f645fa1d209fb6bb72ef17bd9411d6bddc2c08c447d794201` | COMPLETE |
| World V2 | 9 modes; 35 biomes; 539 encounter pools; 101 trainer pools; 65 biome links | `c87d890c9f1658e0526b49d35ae003165ade1f5a0156227a6722b77841786a64` | COMPLETE |
| Bootstrap V1 | 9 modes; 706 starters; 4 difficulties | `e61066de38fac8e31586ccab8e25d3dd39d36244cb02f655840a6133473db47a` | COMPLETE |
| Progression V2 | 6 growth rates; 25 natures; 6 capture balls; 3,384 species/forms; 793 evolutions; 72,230 level moves; 132,218 TM links; 15/15 condition bindings | `751643168aa2c2405d700c13b6438b10dec901d969de2c6b1048663b421b2695` | COMPLETE |
| Scenario V2 | 91 scenarios; 219 options; 620 graph nodes; 324 callback witnesses; 154 typed requirements; 841/841 behavior bindings | `e45bfe0c126dd4b1c3f69ce153def8aa99efe0f1e835ddcbcafa98b689a68fb8` | COMPLETE |
| AI V2 | 4 policies; 273 trainer profiles; 186 boss profiles; 895 registered trainers; 7,469 party members; 9 modes; 2,586/2,586 behavior bindings | `3229a33fcf2f88c4272efb9e21f376f579357d79a9d77451892394dd3ebfbaf9` | COMPLETE |
| Presentation V1 | 24 controls; 20 cue families; 11 UI roles; 55 typed mappings | `6b06dd16f77709e8bb5863f58a2b460b686069fa353981bbc62ed54f2c54ecc0` | COMPLETE |
| Bundle V2 | Direct ownership of all nine domains; 6,870 meta behaviors; zero V1 fields/fallbacks | `blake3-v1:9de581e0d922874eaf17b8a9c355e4d154b051b34935fad60d5779c70de68429` | COMPLETE |

## Completed foundation commits

| Commit | Deliverable |
|---|---|
| `2805ad18b7569fe186ad86a41c56e06261be0167` | Content identity V2 and state allocator foundation |
| `282da291cc09de6a07a2466f5ac80f54d07f731c` | Game material V6 foundation |
| `ff77f724164eb88575d1c76761da430f2a29d787` | Core snapshot V7 foundation |
| `06341375ee2d206ed246c0504789ed853039fd6c` | Game save V2 foundation |
| `8693f0d9c01f51f994c4c62e959b7afede25e74e` | Canonical SHA-256 GameSaveV2 checksums and corruption tests |
| `aade3ed083e1112ade64ab1de27703ade487896e` | Complete pinned ProgressionContentPackV2 and proof artifacts |
| `204f08066c259b7d988ce4fc2c87ead1b75cc72f` | Complete pinned ScenarioContentPackV2, prepared runtime, and proof artifacts |
| `f195aba77c5c7d483567988e150b99320c34e7ed` | Complete AiPolicyPackV2 and authority-only deterministic AI |
| `a8a54a23c30be7fbfa628c3a819da50d1257a578` | Closed typed presentation mappings for all 55 semantics |
| `d43844b03851012efcbe2a277ab4e294a23b5cfa` | Direct GameContentBundleV2 and prepared indexes |
| `41ea0ff0b78cebfdab2d9cb3bb6fe01a23d4c233` | Removed V1 bundle fallback from compiler and production content |
| `81097c72b2f91d332390c8476a476f6256de8bcb` | Fresh-process bundle byte-determinism proof |
| `e460cd9893` through `dbf0b14766` | Hardened V6 allocator, material, and Snapshot V7 invariants |
| `dcf388f6c1` through `e9b4f09b10` | Common material applier and closed Runtime V6 domain dispatch |
| `f24fefb270` through `2cc21981cb` | Bounded InternalEventV2 and sole production GameKernelV7 owner |
| `fc72d8154e` through `184257e607` | Authority AI, battle command collection, and generic V7 proposal/replica flow |
| `107e66d98d` through `ebbce0f05f` | BrowserKernelHostV2, ten typed adapters, and V7 production import closure |
| `04a0477e80` through `2d0c980169` | Raw solo/co-op/domain journeys, reconnect fencing, save restoration for all 24 controls, and native/Wasm eventwise parity |
| `ea2ce29dcd` through `2ac1edc063` | Permanent browser adapter contract and dedicated 29-shard exact-SHA qualification workflow |
| `6f76059c65` | Repaired first hosted-gate roots: bounded browser wire variants, calibrated production Clippy, and M9-safe simulator API audit |

Additional integrated foundations: complete battle content, world V2, bootstrap V1, progression V2 schema, closed evolution conditions, GameStateV6, and V5-to-V6 state migration.

## Dependency graph

```text
Pinned TS oracle
  -> Progression V2 -----\
  -> Scenario V2 --------+-> direct GameContentBundleV2 -> PreparedGameContentV2
  -> AI V2 --------------+                                  |
  -> Presentation V1 ----/                                  v
GameStateV6 + allocator -> hardened GameMaterialV6 -> GameRuntimeV6/dispatcher
SnapshotV7 + GameSaveV2 -------------------------------> GameInternalEventV2
PreparedGameContentV2 + runtime + internal events -----> GameKernelV7
GameKernelV7 + common material applier + AI -----------> generic co-op V7
GameKernelV7 -------------------------------------------> BrowserKernelHostV2/effects
All above -> action/control closure -> journeys -> native/Wasm -> exact-SHA gate -> tag
```

## Implementation tasks and ownership

All active ownership is held by the integration owner in this worktree; no parallel writer currently owns files.

| Task | Owner | State | Ready prerequisite |
|---|---|---|---|
| Correct and harden GameSaveV2 checksum/validation | integration owner | COMPLETE | none |
| Populate ProgressionContentPackV2 and proof artifacts | integration owner | COMPLETE | none |
| Implement ScenarioContentPackV2/compiler | integration owner | COMPLETE | none |
| Implement AiPolicyPackV2/compiler | integration owner | COMPLETE | none |
| Populate presentation mappings | integration owner | COMPLETE | none |
| Assemble direct GameContentBundleV2 | integration owner | COMPLETE | none |
| Remove production V1 content fallbacks | integration owner | COMPLETE | none |
| Harden GameStateV6 allocators/identity validation | integration owner | COMPLETE | none |
| Harden GameMaterialV6 ledger/evidence/bounds | integration owner | COMPLETE | none |
| Complete snapshot V7 lifecycle/migration | integration owner | COMPLETE | none |
| Implement GameRuntimeV6/dispatcher | integration owner | COMPLETE | none |
| Implement GameInternalEventV2 | integration owner | COMPLETE | none |
| Implement GameKernelV7 | integration owner | COMPLETE | none |
| Implement authority AI/battle collection/co-op | integration owner | COMPLETE | none |
| Implement BrowserKernelHostV2/effects | integration owner | COMPLETE | none |
| Action/control witnesses, journeys and parity | integration owner | COMPLETE | none |
| Exact-SHA workflow and qualification | integration owner | WORKFLOW_READY | push exact candidate and require aggregate green |

## Closure status

- Action-family coverage: 14/14 V7 production executor families have raw-control or browser-host witnesses through the one Runtime V6 dispatcher.
- Control-family coverage: 24/24 controls survive canonical GameSaveV2 encode/decode and GameKernelV7 restoration; presentation mappings remain 24/24.
- Content-domain closure: battle, run, progression, world, scenario, AI, meta, bootstrap, presentation, and the direct V2 bundle are complete; fresh-process bundle output is 2/2 byte-identical.
- Migration: V5-to-V6 state migration, V6-to-V7 snapshot migration, allocator minima, material ledger, pending effects, save, and V7 continuation checks are implemented.
- Native/Wasm: the V7 raw-input report is locked to digest `13aee334c66c6e0da239f0c4f56317ccc039af6362d340a7b56c753c92b7c1c3`; native execution is green and the wasm32 test binary compiles locally. Hosted wasm execution remains part of the exact-SHA gate.
- Focused tests at current HEAD: V7 natural solo terminal, natural co-op proposal/material/recovery, four domain journeys including 24-control save reload, Snapshot V7, BrowserHostV2, browser effect routing, and native eventwise parity are green. Static ownership, TypeScript, Biome, and Rust formatting checks are green on the exercised surface.
- Current failing tests: run `33484904634` at exact SHA `c6b047d239e3c9909b68854f95daaf147db20e04` exposed two roots; both are repaired in `6f76059c65`, and the replacement exact-SHA qualification is pending.

## Qualification attempts

| Attempt | Candidate | Run | Result | Classified roots |
|---|---|---|---|---|
| 1 | `c6b047d239e3c9909b68854f95daaf147db20e04` | `33484904634` | RED | Static used an uncalibrated workspace-wide Clippy scope; simulator ran a historical M3 ancestry audit and its token audit falsely rejected the production `GameRuntimeV6` identifier. All other 30 pre-aggregate jobs were green. |

## Current next ready tasks

1. Push the immutable candidate containing this ledger and workflow to `origin/arch/rust-kernel-m9-engineering`.
2. Require `Rust Kernel M9 Engineering Qualification` to finish green at that exact SHA, including all 29 Rust shards, independent static checks, browser contract, wasm32 execution, and aggregate.
3. If any shard is red, classify exact artifacts, repair one incremental candidate, update this ledger, and rerun the whole exact-SHA gate.
4. Create `rust-kernel-m9-engineering-final` only after the aggregate is green at the exact tagged SHA.
