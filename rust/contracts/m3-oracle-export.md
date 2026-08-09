# PokéRogue Redux Rust kernel M3 oracle-export contract

Status: normative once the G6 contract-freeze commit is accepted.

The M3 TypeScript oracle remains immutable at
`3b534099919efae827019d4a3f3c4ab0ecd6d67b`. Export tooling may be added only
under `scripts/` and `test/kernel-fixtures/m3/`; no production TypeScript file
may change. An exporter fixture is evidence about the pinned game, not a second
mechanics implementation and not authority to fill an unobservable field with
a guessed value.

## Required tools and output

The owned exporter paths are:

```text
scripts/export-kernel-m3-oracle.mjs
test/kernel-fixtures/m3/export-battle-oracle.test.ts
rust/fixtures/m3/oracle/**
```

The sole publication command is:

```text
node scripts/export-kernel-m3-oracle.mjs --output-root <absolute-directory>
```

`--output-root` is mandatory. The path must either not exist or name an empty
directory. The exporter refuses a non-empty output root and writes only the
38 case files under `battle-cases/`, plus `content-pack-v1.json` and
`rng-vectors-v1.json`, beneath it. It never edits the catalog manifests. This
keeps each hosted determinism pass independent of both the checkout and the
other pass. Publication copies one verified fresh-process tree to
`rust/fixtures/m3/oracle/`; the integration owner alone updates the manifest
publication arrays after verifying that tree.

Each selected scenario produces canonical UTF-8 JSON with sorted object keys,
preserved array order, normalized finite numbers, and one trailing newline.
Canonical output contains no timestamp, duration, PID, random process-local
identifier, log interleaving, filesystem path, or ambient locale/timezone
value. Environment identity belongs only in stable provenance fields named by
the manifest.

The exporter is invoked twice from two independent fresh Node processes in two
separate clean detached Git checkouts at the same exact SHA, each with its own
dependency links and exact recursive asset-submodule checkout. The two runs use
identical scenario bytes, pinned source, environment, and options. Each
checkout is asserted completely clean immediately after its export, before the
other process may run. The two
output byte strings and SHA-256 values must match before Rust differential
tests may consume either output. A mismatch reports the first byte offset and,
when both values parse, the first decoded JSON path.

## Case envelope

Every generated case contains these required top-level values:

```text
schema_version
scenario_id
provenance
initial_state
initial_rng
commands
expected_rng_draws
expected_action_order
expected_mutations
expected_presentation
expected_final_state
final_rng
expected_next_control
gaps
```

`provenance` contains at least the exact fields `oracle_game_sha`,
`oracle_tree_sha`, `exporter_commit_sha`, `content_pack_hash`, `node_version`,
`phaser_version`, `runner_class`, `platform`, `architecture`, `locale`, and
`timezone`. For the hosted publication job the latter seven values are exactly
the current `node --version`, installed Phaser package version,
`GITHUB_HOSTED_UBUNTU`, `linux`, `x64`, `C`, and `UTC`.
The oracle tree must be the Git tree resolved from the pinned oracle commit.
The exporter commit must exist, be an ancestor of the publication SHA, and
contain byte-identical exporter/test sources. `content_pack_hash` is the raw
64-hex portion of the independently recomputed `ContentPackHash`. A missing or
unverified complete content hash blocks publication; a partial legacy
fingerprint is diagnostic only.

`initial_state` and `expected_final_state` contain the full selected canonical
authoritative state. Transport tick and renderer-only state are excluded from
mechanical parity. The legacy checksum state, preimage, and checksum may be
retained as separately named diagnostics; they never replace complete state
because their oracle shape intentionally omits fields.

Initial capture requires the full authoritative party and summon image at a
quiescent battle boundary. A checkpoint delta alone is insufficient. The
adapter must extract effective six-stat values, effective ordered typing,
PP Ups/override metadata, the active plus three passive ability slots, every
structural suppression flag, weather/terrain durations, and arena conditions.
Missing required data is `CANONICAL_STATE_UNOBSERVABLE`; it is never rebuilt
from max HP, species defaults, a checkpoint omission, or NONE.

M3 effective typing is exactly one primary and at most one secondary type.
Fixtures with a third/additional type, fusion/transform typing, or active Tera
typing fail capability closure. Scenario ability/passive overrides are captured
after application; unused passive slots must be explicit null and all selected
suppression flags must be false.

Legacy TypeScript Pokémon identities are provenance, not Rust IDs. Each fixture
allocates Rust `PokemonId` values starting at one in ascending player party
index followed by ascending enemy party index. The fixture records a complete
mapping `(side, party index, legacy PID) -> PokemonId`; all field and command
references use that mapping. `BattleId` is one for each isolated fixture. The
selected fixture authority seat is one; command admission-source tags are
authority-relative and must not flip when the same material is viewed by the
guest endpoint.

Checkpoint/full-state deltas apply only to a known complete base image. Omitted
fields mean unchanged, never null/default/clear. For arena tags specifically,
an omitted list means unchanged and an explicit empty list clears all tags.
Initial/full captures must provide the list, including an explicit empty list.
Oracle side `0/1/2` maps exactly to `Both/Player/Enemy`; every tag is unique by
condition and scope, sorted by condition then scope, has `layers` in `1..=255`,
and has `turn_count` in `0..=65535`. Values outside the canonical shape reject
the fixture rather than clamp during export.

Observation must be side-effect free. The exporter compares canonical state,
global Phaser RNG state, battle RNG state, offsets, and sequencing fields
before and after every capture. Existing normalization that mutates live state
is a generation failure, not an accepted fixture transformation.

## Commands and raw input

The command section keeps three ordered evidence streams distinct:

- actual raw physical input events delivered to the input boundary;
- semantic scenario intent used to arrange the oracle run;
- semantic commands accepted by the game after commit.

Raw events include sequence, key/button, down/up/focus/blur kind, payload,
seat/control identity, and control before/after. A semantic helper call is not
raw-key evidence. The manifest globally excludes `RAW_PHYSICAL_INPUT` from the
semantic-oracle claim, so published semantic cases claim only scenario intent
and committed commands. Their canonical empty `commands.input_events`
projection carries no raw-input parity meaning and does not create a per-case
gap. Raw-key behavior remains mandatory in the M3 API and non-oracle hosted
tests; a raw-driver fixture may claim it only by recording the actual events.

## RNG audit

Every logical RNG call has one ordered audit entry with:

```text
sequence
stream
closed reason
public API and exact pinned callsite ID
minimum and range
result
consumed flag
before exact state
after exact state
```

Nested `BattleScene`, `Pokemon`, and `Battle` wrappers that delegate to one
draw correlate to one logical consuming entry. Direct Phaser seeded calls and
seed transitions are instrumented independently. `range <= 1` fast paths are
retained in the full audit with `consumed = false`; only consuming draws form
the resolver's expected draw sequence.

Reasons come from a closed, checked-in callsite map. Unknown reachable
callsites fail with `UNMAPPED_RNG_REASON`. Any Phaser or battle RNG state change
without a correlated draw or stream-transition entry fails with
`UNRECORDED_RNG_STATE_CHANGE`. Unseeded `Math.random` changing battle-affecting
state is always a generation failure.

Initial and final RNG records include exact Phaser state strings, battle seed,
turn, battle substream state, seed override/offset context, and next draw
sequence. Full-width integers and floating state use their contract-defined
decimal or exact bit-string representation, never a lossy JSON number.

## Actions, mutations, and presentation

The action list is captured at the real resolved ordering boundary before
execution changes state. It retains skipped/deferred action evidence and each
action's actor, field slot, command, target, priority/order facts, source, and
phase. It is never reconstructed from final state or message text.

The mutation ledger is ordered and causal. Each record identifies sequence,
action/phase/cause, stable state path, and typed before/after values. State is
compared around raw input, command commit, action, phase, and capture
boundaries. A changed canonical leaf without a corresponding mutation fails
with `UNRECORDED_STATE_CHANGE`; the exporter may not synthesize an
unknown-cause mutation to close the diff.

Presentation is captured from the ordered authority-recorded semantic event
stream and is never reconstructed from final state or intercepted message text.
The manifest globally excludes `RENDERER_COMPLETION_SETTLEMENT`; a published
semantic case therefore claims the event plan, not renderer completion,
settlement timing, intentional skips, or renderer failures. Those excluded
values do not produce a per-case gap. Missing or unordered semantic event-plan
evidence is the blocking `PRESENTATION_UNOBSERVABLE` failure.

`expected_next_control` is captured after all causal phases settle and before
the next driver input. Its required semantic frontier is the closed
`control_kind`, wave, turn, `phase_name`, ordered `queued_phases`, and ordered
`pending_command_owners`; `ui_mode`, handler, and cursor are included only when
the pinned oracle exposes them. The manifest globally excludes
`RUST_OWNED_CONTROL_IDENTITY_MENU_ALLOCATOR_HISTORY`, so this fixture projection
does not claim decision operation IDs, control/menu IDs, menu graphs, cancel
history, menu-instance IDs, or allocator high-water/history. Those values remain
mandatory under `m3-api.md` and `m3-ui-navigation.md` and are proved by
non-oracle M3 tests. A missing required semantic-frontier value fails with
`NEXT_CONTROL_UNOBSERVABLE`.

## Gaps and failure policy

Every gap contains a stable code, boundary sequence, required field or
callsite, exact pinned source citation, and blocking disposition. At minimum,
the exporter recognizes:

- `UNRECORDED_RNG_STATE_CHANGE`;
- `UNMAPPED_RNG_REASON`;
- `UNRECORDED_STATE_CHANGE`;
- `CAPTURE_MUTATED_STATE`;
- `PRESENTATION_UNOBSERVABLE`;
- `NEXT_CONTROL_UNOBSERVABLE`;
- `CONTENT_HASH_UNAVAILABLE`;
- `CANONICAL_STATE_UNOBSERVABLE`.

A gap on any claimed portion of an axis required by a case's entry in
`m3-coverage-map.json` blocks fixture publication. The manifest's exact global
unclaimed-subdimension list is the only exception; it never creates a case gap
and may not be extended per case. Unsupported and unobservable claimed evidence
is never encoded as `{}`, `[]`, `null`, a default value, or a successful no-op
unless that exact empty/null value is itself the observed oracle value and the
schema permits it.

On the first M3A-05 exporter commit, the checked-in oracle directory may be
absent but never partial. The hosted job still requires two clean-checkout
exports to be byte-identical and fully provenance/content validated, then
uploads the verified first output root as
`m3-oracle-generated-tree-<run>-<attempt>`. M3A-05 commits exactly that tree in
a later fixture-only commit. The next run must byte-compare it with both fresh
outputs. `ORACLE_EVIDENCE_PUBLISHED` is impossible until that exact 40-file
tree is checked in and the integration owner records all manifest entries.

## Manifest and differential gate

`m3-oracle-manifest.json` binds every fixture path and SHA-256 to its scenario,
coverage claims, oracle/exporter provenance, content hash, required axes,
globally unclaimed semantic-oracle subdimensions, and gap-free status for every
claimed value. Generated files not listed by the manifest are not parity
evidence; listed files with a mismatched hash are rejected.

The same manifest catalogs `content-pack-v1.json` and `rng-vectors-v1.json` as
supporting artifacts. At G6 their publication arrays are truthfully empty;
M3A-05 must generate each twice in fresh processes, then the integration owner
records its SHA-256/provenance. M3B cannot start until every case and both
supporting artifacts are published and gap-free on every claimed value.

The two supporting artifact envelopes are closed:

```text
content-pack-v1.json:
  artifact_id = "content-pack-v1"
  schema_version = 1
  provenance = the same required provenance object as every case
  content_pack = the exact ContentPack object from m3-api.md, including hash

rng-vectors-v1.json:
  artifact_id = "rng-vectors-v1"
  schema_version = 1
  provenance = the same required provenance object as every case
  vectors = a non-empty ordered array of the vectors in m3-js-number-rng.md
```

The hosted job removes `content_pack.hash`, reserializes the exact remaining
seven-field view through the frozen compact strict canonical algorithm, hashes
those bytes with independently installed `b3sum` version 1.8.6, and requires
both `content_pack.hash == "blake3-v1:" + raw_hash` and every provenance/
manifest `content_pack_hash == raw_hash`. It resolves the oracle tree and
exporter commit with Git and compares exporter/test blobs, rather than trusting
hex-shaped fixture strings.

`publication_state` has exactly two values. `CONTRACT_CATALOG_FROZEN` requires
both publication arrays to be empty. `ORACLE_EVIDENCE_PUBLISHED` requires all
38 `case_contracts` and both `supporting_artifact_contracts` to have one entry,
in catalog order, with no other file beneath `rust/fixtures/m3/oracle/`.

Every `published_fixtures` entry has exactly these fields:

```text
scenario_id
fixture_path
sha256
required_axes
gap_free
oracle_game_sha
oracle_tree_sha
exporter_commit_sha
content_pack_hash
```

Every `published_supporting_artifacts` entry has exactly these fields:

```text
artifact_id
fixture_path
sha256
gap_free
oracle_game_sha
oracle_tree_sha
exporter_commit_sha
content_pack_hash
```

The SHA-256 and BLAKE3 content-pack values are lowercase 64-hex strings; Git
commit/tree identities are lowercase 40-hex strings. `gap_free` is exactly
`true`, each case `required_axes` equals the manifest's ordered eight-axis
list, and the oracle game identity equals the pinned source lock. The hosted
publication job recomputes every file SHA-256, rejects missing or unlisted
files, compares two fresh output roots byte-for-byte, and compares the verified
tree with the checked-in oracle directory. A push whose ref starts with
`wrk/rk-m3b-` or `wrk/rk-m3c-` fails before implementation jobs unless the
state is `ORACLE_EVIDENCE_PUBLISHED` and all 40 entries pass these checks.

The Rust differential runner compares, in order:

1. initial canonical state and RNG;
2. admitted commands;
3. each consuming RNG draw and reason;
4. action order;
5. mutation ledger;
6. authority-recorded semantic presentation plan;
7. final canonical state and RNG;
8. observed semantic next-control frontier.

It reports the first divergent axis, sequence, typed path/callsite, expected and
actual values, and before/after fingerprints. A matching final state cannot
hide an earlier causal mismatch.
