# M5 error policy

| Failure | Required result |
|---|---|
| Source catalog SHA/tree mismatch | Compiler failure |
| Catalog identity missing or duplicated | Compiler failure |
| Classification missing or duplicated | Compiler failure |
| Unknown classification/reason code | Compiler or pack-load failure |
| Dynamic callback/script/trait-object content | Unsupported classification; never compiled |
| IR node cycle or unreachable node | Compiler and pack-load failure |
| Invalid node/reference/type/cardinality | Compiler and pack-load failure |
| Program budget above ceiling | Compiler and pack-load failure |
| Runtime budget exhausted | Abort atomic transaction; invariant failure with trace |
| Reachable unsupported content | Battle initialization failure before RNG/state mutation |
| Missing program or bespoke implementation | Pack-load or battle initialization failure |
| Unsupported mechanic reached | Invariant failure; never no-op |
| Invalid V2-to-V3 migration input | Migration failure; input unchanged |
| Invalid V3 candidate state | Abort atomic transaction |
| Query type mismatch | Abort atomic transaction |
| Selector cardinality mismatch | Abort atomic transaction |
| Checked arithmetic overflow/division by zero | Abort atomic transaction |
| RNG stream/reason mismatch | Abort atomic transaction and report first divergent draw |
| Material content/program hash mismatch | Protocol violation/shared terminal |
| Material before-digest mismatch | Correlated recovery |
| Malformed V3 material | Protocol violation/shared terminal |
| Replica apply invariant failure | Correlated recovery or shared terminal by existing class |
| Snapshot pack hash/version mismatch | Restoration failure |
| Snapshot mechanic state invalid | Restoration failure |
| Presentation failure | Canonical state remains; renderer recovery/shared terminal; input stays blocked |
| Wrong seat/stale menu/disabled option | Reject external input; no mutation |
| External semantic mechanics injection | API rejection and bypass-test failure |
| Oracle/compiler/native-Wasm mismatch | CI failure; no gameplay fallback |
| Resource leak after teardown | CI failure with owner/address evidence |

All failures produced during resolution, material creation/application, state migration, scheduler allocation, control installation, or mechanics execution occur on staged clones. Live state, protocol revision, RNG, timers, UI, presentations, and external effects remain unchanged until validation and swap succeed.
