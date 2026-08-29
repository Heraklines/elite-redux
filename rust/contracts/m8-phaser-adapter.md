# M8 Phaser view-only adapter

Phaser receives Rust UI models, presentation scenes, event envelopes, asset/audio cues, and terminal state. It creates/updates display objects and collects physical input. It never owns canonical cursor/menu stack, validates commands, chooses targets, mutates HP/status/party/run, decides timers/control/outcomes, creates material, or performs recovery.

Each `GameControlKindV2` in `m8-phaser-surface-map.json` has one Rust presenter. Callback-heavy legacy handlers are not reused as authority. Rust selection and menu instance are rendered verbatim.

Presentation uses stable actor/event IDs. Every blocking event returns exactly one Rendered, IntentionallySkipped(reason), or Failed(reason) settlement. Phaser phase completion alone is not Rendered. Adapter generation invalidates old tweens/timers/callbacks so stale animation cannot settle a new event.

Render traces record semantic source, render node, parent, asset, visibility, bounds, layer, animation state, generation, and settlement. Render diagnostics never enter mechanical identity.
