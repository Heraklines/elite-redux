# CR-0012: semantic-oracle claim boundary

Status: approved by the integration owner after M3A bootstrap and before the
M3A-05 exporter implementation.

## Problem

The frozen M3 oracle catalog requires all 38 semantic fixtures to publish the
same eight ordered comparison axes with `gaps = []`. The pinned TypeScript
oracle exposes semantic scenario intent, committed commands, authority-recorded
presentation events, phase/queue state, pending command owners, and selected UI
diagnostics. It does not expose three different kinds of evidence as stable
semantic-oracle facts:

- raw physical input events at the browser/controller boundary;
- renderer completion or settlement outcomes; or
- Rust-owned decision operation IDs, control/menu identities, menu graphs,
  cancel history, menu-instance allocation, or allocator high-water history.

Treating those subdimensions as required fixture evidence would force every
case to carry a blocking gap, contradicting the publication gate. Filling them
with empty, default, or newly invented values would instead fabricate parity.

## Decision

- Keep the ordered eight-axis fixture catalog, `gaps = []`, `gap_free = true`,
  provenance, content hashing, and two-fresh-process byte identity unchanged.
- Add one closed manifest-level `semantic_oracle_unclaimed_subdimensions` list
  containing exactly:
  `RAW_PHYSICAL_INPUT`, `RENDERER_COMPLETION_SETTLEMENT`, and
  `RUST_OWNED_CONTROL_IDENTITY_MENU_ALLOCATOR_HISTORY`.
- Semantic oracle command evidence claims scenario intent and committed
  commands. Its empty raw-input projection carries no raw-input parity claim
  and produces no per-case gap.
- Semantic presentation evidence claims the ordered authority-recorded event
  plan. Renderer completion/settlement is outside that claim and produces no
  per-case gap. Missing semantic presentation evidence remains the blocking
  `PRESENTATION_UNOBSERVABLE` failure.
- Semantic next-control evidence claims the observed frontier: closed control
  kind, wave/turn, phase and queue, pending command owners, plus UI mode,
  handler, and cursor only when observed. Missing a required frontier field is
  `NEXT_CONTROL_UNOBSERVABLE`.
- Rust-owned operation/control/menu identities, menu graphs, cancel history,
  menu instances, and allocator rules remain mandatory in `m3-api.md`,
  `m3-ui-navigation.md`, material application, and non-oracle M3 tests. This
  change does not weaken those contracts.
- The exclusion list is global and closed. Individual fixtures may not add
  private exclusions or nonblocking gaps.

## Required evidence

- the freeze gate requires the exact three-value exclusion list;
- the required axis list remains exactly the original eight axes;
- every generated and published semantic case still has an exact envelope,
  `gaps = []`, and `gap_free = true`;
- two independent fresh exports remain byte-identical and fully provenance and
  content-hash validated;
- differential failures on every claimed command, RNG, action, mutation,
  semantic presentation, state, and observed next-control value still block
  publication; and
- non-oracle M3 tests continue to prove raw-key behavior, exact Rust control and
  menu identity, graph/history behavior, and allocator synchronization.
