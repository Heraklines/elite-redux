# M7.2 architecture simplification gate

## Current production owners

Exactly one current production owner is permitted for each concern:

| Concern | Current owner |
|---|---|
| Canonical game state | `er_state::m7_state::GameStateV5` |
| Game runtime | `er_game::m7_runtime::GameRuntimeV5` |
| Kernel | `er_kernel::kernel_v6::GameKernelV6` |
| Environment | `er_env::GameEnvironment` |
| Raw-input route | `GameEnvironment::raw_input -> GameKernelV6::raw_input` |
| Material applier | `er_game::m7_material::apply_game_material_v5` |
| Scheduler | kernel scheduler V2 owner |
| Logical menu | `er_types::m7_menu::GameMenuV2` / `ui_menu::LogicalMenu` |
| Snapshot writer | `RestorableKernelSnapshotV6` |
| Replay writer | `KernelTraceV7` wrapping V6 evidence |
| Content identity | `GameContentIdentity` |
| Natural bootstrap | M7.2 production bootstrap machine |

Historical state, material, snapshot, and trace versions are migration-only. They may be imported by explicit migration modules and fixture readers, not by the current runtime hot path. `er-compat` is optional and requires a measured dependency or compile benefit before creation.

## Forbidden production imports

The gate scans current runtime modules and rejects imports, feature flags, or dynamic lookup of:

```text
legacy resolver
selected-content compatibility runtime
fixture/testkit adapter
old material applier
semantic action bypass
er-lab
```

Core Cargo manifests may not name `er-lab`. Production TypeScript may not become a canonical scenario or bootstrap adapter.

## Security closure

The M7.1 JSONL CLI currently calls `read_until` before enforcing its line bound. M7.2 replaces this with a bounded reader that stops and drains oversized lines without retaining them. The capsule CLI may not call unbounded `fs::read`; it checks metadata and streams within the configured limit. Capsule decode checks aggregate decompression budgets before decompressing any blob and rejects noncanonical manifest bytes.

Bisect, mutation, and build tooling use closed typed commands in isolated worktrees. Requests and capsules cannot supply shell fragments, environment variable names, hook paths, Cargo configuration, absolute paths, or arbitrary file lists. Git hooks are disabled, revisions are allowlisted commit IDs, and cache reuse requires a complete known key; any Unknown identity disables reuse.

## Dependency rule

M7.2 adds only `er-lab`. Modules remain together until measurements show an independent consumer, platform/security boundary, or meaningful compile-time reduction. Always-on forensic instrumentation is forbidden.

## Verification

The architecture manifest is generated/checked deterministically. Source scans are defense in depth; compile-time dependency checks and behavioral bypass tests are authoritative. M0–M7.1 regression, native/Wasm parity, and G38 remain mandatory after any simplification.
