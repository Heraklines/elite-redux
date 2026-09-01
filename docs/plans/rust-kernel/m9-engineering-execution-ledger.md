# M9 Engineering Execution Ledger

Updated: 2026-08-20

## Frozen baseline

- Branch: `arch/rust-kernel-m9-engineering`
- Current HEAD: `81097c72b2f91d332390c8476a476f6256de8bcb`
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
| Harden GameStateV6 allocators/identity validation | integration owner | READY_IMPLEMENTATION | none |
| Harden GameMaterialV6 ledger/evidence/bounds | integration owner | READY_IMPLEMENTATION | none |
| Complete snapshot V7 lifecycle/migration | integration owner | READY_IMPLEMENTATION | none |
| Implement GameRuntimeV6/dispatcher | integration owner | DEPENDS_ON_IMPLEMENTATION | direct GameContentBundleV2 and hardened material |
| Implement GameInternalEventV2 | integration owner | DEPENDS_ON_IMPLEMENTATION | GameRuntimeV6 |
| Implement GameKernelV7 | integration owner | DEPENDS_ON_IMPLEMENTATION | runtime and internal events |
| Implement authority AI/battle collection/co-op | integration owner | DEPENDS_ON_IMPLEMENTATION | GameKernelV7 and AI V2 |
| Implement BrowserKernelHostV2/effects | integration owner | DEPENDS_ON_IMPLEMENTATION | GameKernelV7 |
| Action/control witnesses, journeys and parity | integration owner | DEPENDS_ON_IMPLEMENTATION | kernel/browser/co-op paths |
| Exact-SHA workflow and qualification | integration owner | DEPENDS_ON_IMPLEMENTATION | all engineering implementation and proofs |

## Closure status

- Action-family coverage: 0/14 V7 production executor witnesses complete; existing V5/V6 domain logic is reusable but not yet closed through Runtime V6.
- Control-family coverage: existing M9 control manifest reports 24/24 structural entries; V7 producer/raw-input/material/snapshot/Wasm/co-op witnesses remain incomplete.
- Content-domain closure: battle, run, progression, world, scenario, AI, meta, bootstrap, presentation, and direct bundle complete; fresh-process bundle output is 2/2 byte-identical.
- Migration: V5 state to V6 state foundation present; allocator minima, V6 kernel snapshot, developer-plane snapshot, save, and end-to-end V7 continuation proofs pending.
- Native/Wasm: prior M9 slice parity was green at historical SHA `bfd6fdd4f89806b084f5a801f5adbbf44b8abf94`; generic V7 eventwise parity pending.
- Focused tests at current HEAD: save V2 2/2; progression 1/1; scenario 2/2; AI 2/2; presentation/bundle 7/7; pinned progression/scenario/AI exporters each passed twice in fresh processes; bundle compiler passed twice in fresh processes.
- Current failing tests: none in exercised focused lanes; qualification has not run.

## Current next ready tasks

1. Harden GameStateV6 allocator minima and direct PreparedGameContentV2 identity validation.
2. Harden GameMaterialV6 typed evidence, bounds, revision checks, and applied-material ledger.
3. Complete snapshot V7 lifecycle and migrations.
4. Implement GameRuntimeV6 and the closed GameActionDispatcherV1 over the direct bundle.
5. Build InternalEventV2, Kernel V7, browser/co-op paths, journeys, parity, and exact-SHA qualification in dependency order.
