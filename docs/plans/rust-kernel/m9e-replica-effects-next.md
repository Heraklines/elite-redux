# B2: replica presentation delivery without duplicate external storage

Status: IMPLEMENTED_PENDING_REMOTE_CHECKS. The source change and Save witness
are authored after B1 passed. Actual CLI reload and the isolated shared-menu
gate are qualified. This cut is submitted against baseline 823bcc3 / run33943804197.
This note records source evidence, not passing execution evidence.

## Concrete missing behavior

Before this change, `GameKernelV7::apply_authority_material` in
`rust/crates/er-kernel/src/game_kernel_v7.rs` normalized a local battle leaf,
applied material to the runtime and emitted `UiChanged` without delivering the
material's presentations. It also emitted UI effects on duplicate delivery and
could normalize local control before discovering that delivery was a duplicate.

The authority path, `execute_action_transaction`, emits the prepared ordered
presentation and platform vectors. `install_step_effects` installs their pending
ownership. Thus state convergence in the existing cooperative tests does not
prove replica presentation delivery or correct external-effect ownership.

`GameMaterialV6::decode` in `er-game/src/m9e_material_v6.rs` checks bounded,
canonical typed material. `transition()` exposes `presentation` and
`platform_effects`. `GameRuntimeV6::apply_material_bytes` delegates to
`apply_game_material_v6`; that function recognizes `DuplicateApplied` by the
operation ledger and exact fingerprint before checking the live state frontier.
Reuse these paths; do not re-execute the authority action on the replica.

## Small implementation boundary

Product ownership: `er-kernel/src/game_kernel_v7.rs` only. Test ownership:
`er-kernel/tests/m9e_coop_v7.rs`, reusing its natural cooperative
initialization, protocol, and controlled Save-menu helpers.

The implementation stages material delivery in a kernel candidate. It normalizes
the candidate's local battle leaf and calls common validated material application,
then decodes the same material for its typed presentation records when newly applied.
On `DuplicateApplied`, discard the candidate and return an empty step, preserving
the original local control, timers, replay sequence, and pending ownership.
On `Applied`, advance the replay sequence, synchronize the menu allocator, emit
the exact ordered `transition.presentation` vector, and install its pending
presentation ownership through `install_step_effects`. Preserve the existing
UI and terminal consequence paths. Validate the complete candidate before commit.
Any decoding, application, pending-ID collision, or final validation error must
discard all candidate changes and return no effects.

Preserve the existing absence of `transition.platform_effects` fan-out on replica
delivery. In particular, storage writes, reads, deletes, and lists remain
authority-owned external work; replica state application must not invoke or queue
them. This slice delivers typed presentation records, not every platform effect.
It does not classify all platform effects as permanently authority-only:
per-endpoint audio, asset, and telemetry routing and completion ownership need
separate rules and tests. Shared-session calls may stage this kernel candidate a
second time; optimization is separate work.

## Independent witnesses

`replica_delivers_save_presentation_once_without_repeating_authority_storage`
contains all four checks below. The cooperative binary now has three tests.
The existing two-human command-flow test also acknowledges the actual returned
retention-presentation IDs before its next guest raw input. After the guest opens
Fight, it redelivers the retained material and requires an empty step plus exact
full preservation of the private `BattleMove` snapshot before submitting the
original move. This directly covers duplicate handling across local battle-leaf
normalization, beyond the controlled Save-menu witness.

1. From `natural_coop_state`, install a controlled Save Write option analogous
   to the existing Save Cancel fixture. Submit it through guest raw input and
   authority proposal admission. Require an authentic authority material, one
   authority `StorageWrite`, and its pending request. Require the presentation
   semantic to be `Cue(Save)`, its event ID to equal the authority revision, and
   blocking/skip metadata to match the prepared content mapping.
2. Deliver that material to the replica. Compare complete ordered typed
   `GamePresentationEffectV2` values with the independently checked authority
   vector and compare the resulting pending presentation records. Require exact
   game-state convergence. Require no replica `Platform` effect, no pending
   platform request, and no storage frontier change. Do not compare debug strings
   or replace these checks with counts, aliases, or digest non-emptiness.
3. Deliver identical bytes again, both before presentation settlement and after
   settlement. Require an empty step and exact full replica snapshot preservation;
   no presentation resurrection, cursor reset, storage request, or replay advance.
4. Restore an otherwise valid pre-delivery replica snapshot containing the same
   pending presentation ID. Applying the fresh material must fail at ownership
   installation and leave the complete pre-request snapshot unchanged. This
   exercises rollback after material application, beyond a decode-only rejection.

## Limits and verification

No wire/schema change, new runtime, historical V6 behavior change, fixture
download, or broad platform-effect routing is required. The Save menu is an
explicit controlled test seam over a naturally created cooperative state; it
does not prove a fully natural Save UI journey. This slice does not certify
network retransmission timers, renderer completion, distributed storage,
asset/audio platform fan-out, or all presentation-content policy validation.

Run the focused current kernel/cooperative and shared-session dependency tests
remotely, including an isolated mutation that removes replica presentation
delivery and must fail the named behavioral witness after successful compilation.
Additional native/Wasm or browser delivery evidence requires explicit integration
coverage. Product edits are limited to the material import and delivery function;
B1 timer functions remain untouched. No local build/test/format, staging, commit,
or push was performed by this lane.

## Browser host witness prepared

The existing two-host Chromium journey now compares the complete ordered
presentation vector in canonical turn material with authority and replica
Presentation effects, checks replica PresentationSceneChanged semantics and
exact pending ownership, then settles only the IDs actually delivered through
the public host boundary. Duplicate material before/after settlement must emit
an empty effect batch and preserve the full kernel snapshot. The same journey
also re-delivers retained material in the guest's private BattleMove menu and
checks that exact snapshot before continuing. Inventory stays two Chromium
tests. This is still two Wasm hosts with in-page byte relay; it does not certify
Worker/WebRTC transport, rendering, or storage ownership. Source-reviewed only;
submit `test/browser/rust-browser/m9e-v7-corrective.spec.ts` with the B2 Rust cut
and retrieve its exact remote result before claiming the behavior passes.
