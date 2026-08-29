# M7.1 environment, model, render, platform, and privacy audit

## Environment and CLI

M7 exposes `er_env::GameEnvironment` over `GameKernelV6` with create/restore, observe, legal visible options, raw input, virtual-time advance, snapshot, and content. `er-cli` supports new-run, resume, replay/save validation, simulation, content inspection, and an interactive physical-key loop. It does not expose pair topology, privileged observations, artifacts, fork/seek, capsules, minimization, impact queries, or JSONL RPC.

M7.1 must wrap this API. It cannot create a second semantic reducer. Agent protocol and CLI map only to raw physical input and existing external environment events.

## Model boundary

There is no inference backend. M7 Authority/proposal/material/control ownership provides the canonical pattern:

```text
authority issues typed request
external backend returns typed response
response identity/hash/backend are validated
output is checked against current legal actions
validated response is recorded as an external trace event
authority commits the resulting ordinary game action
replica receives material only
replay consumes the recorded response
```

Discrete/quantized output only. Active model slot/hash is mechanical identity; backend and latency are diagnostic. Missing backend never selects a fallback action.

## Presentation and future renderer

M7 owns typed battle presentation plans/events, stable operation/ordinal presentation IDs, blocking/skip policy, settlement, pending presentation snapshot, and resource teardown. `er-sim` owns presenter outcomes. M7.1 builds a semantic scene and validates adapter-owned render snapshots; it does not implement pixels, Phaser, WebGPU, shaders, assets, or animation execution.

Presentation event IDs derive from material/operation identity plus ordinal. Render node IDs derive from semantic scene generation/source plus stable local path. Renderer/platform traces cannot enter mechanical identity or state.

## Platform trace

Frozen events include focus/visibility/page lifecycle, raw input device changes, WebRTC callbacks, storage callbacks, service-worker events, mobile suspend/resume, renderer faults, and asset results. These are external evidence records with adapter identity and monotonic virtual/external sequence coordinates.

Classification:

```text
kernel trace differs -> game/kernel
kernel matches and platform differs -> platform/adapter
kernel/platform match and render differs -> renderer/asset
```

## Privacy

Player/Agent observations project only seat-visible state. Debug/Forensic require policy permission. Passwords, tokens, cookies, provider IDs, identity tickets, credentials, raw account identifiers, and platform secrets are always excluded. User/session/peer identifiers are capsule-local aliases by default. Hidden digest nodes and IDs are not exposed below Debug.

## API bypass audit

Reject exported methods or JSONL names matching semantic commands such as choose/select/capture/damage/resolve. Developer-plane crates remain absent from all core Cargo manifests. Observation functions accept immutable references and tests compare snapshots before/after. Renderer/model/platform diagnostic results cannot call material appliers or state mutation APIs directly.
