# M3-00G oracle exporter design

Status: contract-extraction design only. This document does not implement the
exporter, alter production TypeScript, create Rust contracts, or generate
fixtures.

## Authority, evidence, and vocabulary

The integration base for this worktree is
`7357166c19bdb5cf0e32c84b0f74f22e79d80798`. The TypeScript oracle is the
immutable commit object
`3b534099919efae827019d4a3f3c4ab0ecd6d67b` (tree
`6d2811a1ab94f081dac58e03a30afd76cc072422`, parent
`ff89e17f15b8718e3ac641e833f78332d6eda825`), established from the exact git
object rather than a moving branch. The source citations below refer to blobs
at that oracle object; `oracle: path:Lx-Ly` means the literal repository path
and line range in that blob.

The two M3 specifications require a case projection containing initial state,
commands, ordered RNG draws, action order, mutations, presentation, final
state, and next control, plus oracle/source/content provenance
(`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:L911-L948`;
`C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:L969-L1019`).
The design below distinguishes:

- **Observed**: behavior or infrastructure present in the pinned oracle.
- **Proposed**: exporter behavior to be implemented later.
- **Gap**: an existing absence or an observation that must remain explicit;
  it is never represented as an invented empty parity record.

## Existing infrastructure at the pinned oracle

### Scenario construction

**Observed.** `scripts/run-scenario.mjs` is a headless wrapper around the real
scenario Vitest harness. It accepts ERS1/JSON/demo input and turn, move, wave,
miss/crit, and real-RNG flags, then spawns
`test/tools/run-scenario.test.ts` (`oracle: scripts/run-scenario.mjs:L4-L10`,
`oracle: scripts/run-scenario.mjs:L13-L30`,
`oracle: scripts/run-scenario.mjs:L91-L140`). This is useful construction
precedent, but it is not the M3 exporter: it launches a Vitest process and its
JSON output is not the required oracle envelope.

**Observed.** The harness constructs a real `GameManager`, phases, abilities,
moves, AI, and RNG in a headless scenario path; its declared environment
variables include the scenario, turn, move, wave, no-miss/no-crit, and real-RNG
options (`oracle: test/tools/run-scenario.test.ts:L6-L40`). The scenario spec is
plain JSON that maps to arbitrary run state, parties, enemy state, items, and
seeded setup; its documentation explicitly treats a pinned seed as the source
of repeatable RNG (`oracle: src/dev-tools/test-suite/scenario-spec.ts:L1-L17`).
The encoded `ERS1.` representation and validation are implemented in the
scenario-spec module (`oracle: src/dev-tools/test-suite/scenario-spec.ts:L287-L315`).

`ScenarioSpec` includes run/battle seed, wave, biome, weather, terrain,
difficulty, battle format, parties, enemy configuration, items, and selected
mid-battle state fields (`oracle: src/dev-tools/test-suite/scenario-spec.ts:L140-L237`).
`buildDevScenario` applies those overrides, stages a custom enemy party, and
returns lifecycle hooks that apply HP, stages, status, suppression, and related
setup to the live battle (`oracle: src/dev-tools/test-suite/scenario-spec.ts:L456-L617`,
`oracle: src/dev-tools/test-suite/scenario-spec.ts:L620-L711`). The
`DevScenario` interface is the construction/lifecycle boundary, with setup and
optional post-launch, party-ready, battle-start, and shop hooks
(`oracle: src/dev-tools/test-suite/scenarios.ts:L104-L129`).

**Proposed exporter boundary.** Reuse this scenario construction in the future
exporter, but record the decoded scenario bytes and normalized scenario ID as
inputs before launch. Capture the initial oracle boundary only after setup and
the battle-start hook have completed, and before the first driver command. The
current harness launches the game, runs setup, pushes the encounter/command
phases, and invokes the battle-start hook in that order
(`oracle: test/tools/run-scenario.test.ts:L1229-L1295`).

### Existing command, turn, and action evidence

**Observed.** The harness's `TurnAction` is semantic data: move/target/tera,
switch, ball, run, and enemy-move/target fields are represented directly
(`oracle: test/tools/run-scenario.test.ts:L152-L188`). `applyAction` then calls
game methods such as `doSwitchPokemon`, `doThrowPokeball`, `handleCommand`,
`move.select`, `selectWithTera`, or `move.use`
(`oracle: test/tools/run-scenario.test.ts:L590-L655`). Player slots are applied
in field order (`oracle: test/tools/run-scenario.test.ts:L657-L673`), while
enemy actions are forced through `forceEnemyMove`
(`oracle: test/tools/run-scenario.test.ts:L680-L704`). These are reliable
semantic-driver precedents, not raw keyboard evidence.

**Observed.** A committed single-player command is passively mapped to a
replay command after the command succeeds. The recorder filters the command
families and stores wave, turn, field slot, command kind, and resolved target
(`oracle: src/data/elite-redux/replay-single-recording.ts:L185-L223`). The
replay schema is an ordered semantic command/interaction trace and explicitly
does not contain raw key events (`oracle: src/data/elite-redux/replay-trace.ts:L7-L33`,
`oracle: src/data/elite-redux/replay-trace.ts:L77-L129`).

**Observed.** `TurnStartPhase` derives command order from player and enemy
field indices, placing non-FIGHT commands before FIGHT commands and preserving
the original index as the tie-breaker (`oracle: src/phases/turn-start-phase.ts:L49-L78`).
Its start path iterates field order, skips absent/skipped commands, defers
pursued switches, handles commands, queues deferred switches, and then queues
interlude/end phases (`oracle: src/phases/turn-start-phase.ts:L271-L338`). The
command dispatcher routes FIGHT, BALL, RUN, POKEMON, and SHIFT and records a
single-player command only after a command has committed
(`oracle: src/phases/command-phase.ts:L1820-L1898`).

**Observed claim boundary.** The existing scenario driver does not expose a raw
input event stream; it calls semantic game helpers and command handlers. The M3
specification requires raw `key_down`, `key_up`, `press`, hold, focus, and
related events to be recorded when a raw driver is used, and forbids treating
`select_move` or `submit_command` as raw input
(`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:L632-L660`).
The exporter therefore keeps two fields distinct:

1. `commands.input_events`: the actual raw driver events, including their
   order, payload, and target control; and
2. `commands.semantic_intent` plus `commands.committed`: the scenario intent
   and the command that the engine accepted.

For semantic-only cases, `input_events` is the canonical empty projection of
the manifest-level unclaimed `RAW_PHYSICAL_INPUT` subdimension. It creates no
per-case gap and makes no keyboard-parity claim. Raw-input behavior remains a
mandatory non-oracle M3 test surface.

### Existing state capture and canonicalization

**Observed.** The authoritative co-op state type already carries version, tick,
wave/turn, both parties, field seating, weather/terrain and their counters,
arena tags, money, locks, score, balls, modifiers, biome/seed data, and Elite
Redux state maps (`oracle: src/data/elite-redux/coop/coop-transport.ts:L1000-L1049`).
The engine's authoritative material capture reads both parties, sorts field
seats by battle index, and includes weather/terrain counters, arena tags,
economy, modifiers, seeds, and Elite Redux state before the public wrapper adds
the transport tick (`oracle: src/data/elite-redux/coop/coop-battle-engine.ts:L2781-L2847`).

**Observed.** The existing checksum view is a deterministic diagnostic view:
its rules sort object keys, preserve array order, omit undefined values, and
deliberately exclude turn/duration counters (`oracle: src/data/elite-redux/coop/coop-battle-checksum.ts:L20-L30`).
Its canonicalizer sorts object keys, preserves array order, normalizes numbers,
and emits a deterministic string (`oracle: src/data/elite-redux/coop/coop-battle-checksum.ts:L217-L245`).
The checksum adapter is a useful digest, but it is not sufficient as the M3
canonical state because the documented checksum shape intentionally omits
duration counters.

**Observed.** There are two important capture hazards. The compact checkpoint
normalizes impossible HP by writing `mon.hp = maxHp` before serialization
(`oracle: src/data/elite-redux/coop/coop-battle-engine.ts:L398-L417`). The
modern co-op carrier withholds the entire carrier when checkpoint, full field,
authoritative state, checksum, or preimage capture fails
(`oracle: src/data/elite-redux/coop/coop-battle-engine.ts:L4903-L4947`). An
observational capture precedent saves and restores the Phaser RNG state and
state-tick counters around authoritative capture
(`oracle: src/data/elite-redux/coop/coop-battle-engine.ts:L3639-L3662`).

**Proposed state projection.** `initial_state` and `expected_final_state` will
contain a read-only, recursively canonicalized copy of the full authoritative
material, with the transport-only `tick` excluded from parity. Alongside it,
store `checksum_state`, `checksum_preimage`, and `checksum` as diagnostics.
Preserve weather/terrain duration values in the full state even though the
checksum view excludes them. Capture must prove that the observation did not
change live state or RNG; if the existing checkpoint normalization changes a
value, fail with `CAPTURE_MUTATED_STATE` rather than accepting the normalized
state. A missing subcapture is a generation failure or an explicit gap, never a
fabricated `{}` or `[]`.

### Existing recording and presentation evidence

**Observed.** The co-op turn recorder begins at turn start, records ordered
visible events, seals an entry-presentation prefix, and streams the recording
at commit; its own comments identify the MVP as a presentation/message stream
and say richer events are follow-on work
(`oracle: src/data/elite-redux/coop/coop-turn-recorder.ts:L7-L44`,
`oracle: src/data/elite-redux/coop/coop-turn-recorder.ts:L165-L210`). Its event
recording stamps a per-turn sequence and tracks faint occurrences, but does not
record mechanical mutation or RNG data
(`oracle: src/data/elite-redux/coop/coop-turn-recorder.ts:L212-L311`).

The transport event union is presentation-oriented (`message`, `moveUsed`, HP,
faint, stage/status, ability, tera, weather, terrain, and switch), and a turn
resolution carries ordered events beside an authoritative post-turn state
(`oracle: src/data/elite-redux/coop/coop-transport.ts:L1088-L1153`,
`oracle: src/data/elite-redux/coop/coop-transport.ts:L1697-L1731`). The
presentation observer distinguishes authority-recorded, renderer-completed,
skipped, and failed stages, but is diagnostic rather than a mechanical source
of truth (`oracle: src/data/elite-redux/coop/coop-turn-recorder.ts:L76-L124`).

The headless scenario runner instead collects intercepted text and turn
outcomes/snapshots; its snapshot contains only a compact diagnostic view of
mon data and last move details (`oracle: test/tools/run-scenario.test.ts:L527-L564`,
`oracle: test/tools/run-scenario.test.ts:L1311-L1415`). Its JSON writer emits
outcome, waves, log, state, and timing, not canonical state, RNG calls,
mutations, action order, presentation events, or next control
(`oracle: test/tools/run-scenario.test.ts:L2517-L2544`).

**Gap and claim boundary.** No existing generic mutation ledger, complete RNG
audit, raw-input trace, or single-player next-control serializer was identified
in the pinned oracle. The replay recorder is passive and records resolved
semantic commands, not state writes or RNG
(`oracle: src/data/elite-redux/replay-recorder.ts:L7-L29`,
`oracle: src/data/elite-redux/replay-recorder.ts:L184-L246`). The exporter must
add test/exporter instrumentation rather than reinterpret the presentation
recorder as a mechanics log. Mutation and RNG evidence remain claimed and must
be instrumented. Raw physical input and Rust-owned control/menu identity or
allocator history are globally unclaimed semantic-oracle subdimensions, so
their absence is not a case gap and they may not be invented by the exporter.

## Proposed exporter envelope

The future exporter should write one case at a time, then project it into the
M3 fixture field names. The following is a contract shape, not an implemented
schema:

```json
{
  "schema_version": 1,
  "scenario_id": "...",
  "provenance": {
    "oracle_game_sha": "3b534099919efae827019d4a3f3c4ab0ecd6d67b",
    "oracle_tree_sha": "6d2811a1ab94f081dac58e03a30afd76cc072422",
    "oracle_content_hash": "...",
    "fixture_exporter_sha": "...",
    "node_version": "...",
    "phaser_version": "...",
    "platform": "...",
    "runner_class": "...",
    "locale": "...",
    "timezone": "..."
  },
  "initial_state": { "canonical": {}, "checksum_state": {}, "checksum_preimage": "", "checksum": "" },
  "initial_rng": { "phaser_state": {}, "battle_streams": [] },
  "commands": { "input_events": [], "semantic_intent": [], "committed": [] },
  "expected_rng_draws": [],
  "expected_action_order": [],
  "expected_mutations": [],
  "expected_presentation": [],
  "expected_final_state": { "canonical": {}, "checksum_state": {}, "checksum_preimage": "", "checksum": "" },
  "final_rng": { "phaser_state": {}, "battle_streams": [] },
  "expected_next_control": {
    "control_kind": "Command",
    "wave": 1,
    "turn": 2,
    "phase_name": "CommandPhase",
    "queued_phases": [],
    "pending_command_owners": [],
    "ui_mode": "COMMAND",
    "handler": "CommandUiHandler",
    "cursor": 0
  },
  "gaps": []
}
```

`expected_*` names intentionally match the M3 case projection required by the
specification (`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:L911-L927`).
The exporter may retain diagnostic fields in its raw output, but the fixture
projection must preserve the ordered claimed evidence rather than reduce the
case to a final-state comparison. The differential requirement explicitly
compares RNG sequence, action order, mutations, semantic presentation, final
state, and the observed next-control frontier
(`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:L1009-L1022`).

### Initial and final RNG snapshots

**Proposed.** Each endpoint records, without advancing the stream:

- `Phaser.Math.RND.state()`;
- the current battle seed, turn, and `Battle.battleSeedState`;
- `globalScene.rngSeedOverride` and `rngOffset` context; and
- the endpoint phase/control boundary.

This is necessary because `Battle.randSeedInt` saves the global Phaser state,
restores a battle substream or sows one from battle seed and turn, calls the
seeded utility, saves the battle substream, then restores the global state and
seed override (`oracle: src/battle.ts:L610-L633`). `BattleScene.randBattleSeedInt`
delegates to that battle method (`oracle: src/battle-scene.ts:L1490-L1502`),
while seed-offset execution also saves/restores global RNG state and offset
context (`oracle: src/battle-scene.ts:L2931-L2953`).

The endpoint capture must compare RNG state before and after capture. The
authoritative capture precedent is the required behavior: observation restores
RNG and sequencing state (`oracle: src/data/elite-redux/coop/coop-battle-engine.ts:L3639-L3662`).

### Semantic command evidence and action order

**Proposed.** The semantic scenario object and committed command are recorded
as separate ordered values; the latter is checked against the existing
post-commit recorder shape
(`oracle: src/data/elite-redux/replay-single-recording.ts:L185-L223`).
`commands.input_events` remains empty in these semantic fixtures because
`RAW_PHYSICAL_INPUT` is globally unclaimed. It is not a successful raw-input
trace. A separate raw-driver test that claims this subdimension must record
`{seq, kind, key/button, pressed, payload, control_before, control_after}` for
every delivered event, including focus/blur and held-input boundaries.

An action entry has `{seq, actor, field_index, command, target, order,
priority, source, phase}`. The exporter records the resolved list at the
TurnStartPhase ordering boundary, before execution mutates state, then records
phase-generated switch, capture, run, tera, and move actions. It must retain
skips and deferred actions so the resulting list is the actual ordered action
list, not a reconstruction from message text. The ordering rule and the
command-to-phase routing are observable in
`oracle: src/phases/turn-start-phase.ts:L49-L78`,
`oracle: src/phases/turn-start-phase.ts:L271-L363`, and
`oracle: src/phases/command-phase.ts:L1820-L1898`.

### Ordered RNG calls and closed reason mapping

**Proposed.** The exporter records one logical draw as:

```json
{
  "seq": 0,
  "stream": "battle",
  "api": "Battle.randSeedInt",
  "min": 0,
  "range": 16,
  "result": 7,
  "consumed": true,
  "reason": "DamageVariance",
  "source": { "path": "src/field/pokemon.ts", "line": 5550, "callsite_id": "..." },
  "before": { "phaser_state": {}, "battle_state": {} },
  "after": { "phaser_state": {}, "battle_state": {} }
}
```

`range <= 1` calls are retained as audit entries with `consumed: false`,
because both battle and global seeded helpers return `min` without drawing
(`oracle: src/battle.ts:L610-L619`, `oracle: src/utils/common.ts:L95-L106`).
The fixture's ordered draw list contains consuming entries; the raw audit can
retain fast-path calls to prove that the no-draw branch was observed.

Instrumentation has three layers:

1. Wrap `Battle.randSeedInt` to observe the battle substream draw, including
   pre/post global Phaser state, battle seed state, seed override, requested
   range/min, result, and whether a draw was consumed.
2. Wrap `BattleScene.randBattleSeedInt` to record the public scene seam and
   correlate its delegation with the already-recorded battle draw. It must not
   double-count the nested `Battle.randSeedInt`; the source explicitly documents
   that delegation (`oracle: src/battle-scene.ts:L1491-L1502`). The
   `Pokemon.randBattleSeedInt` delegation is treated the same way at its public
   seam (`oracle: src/field/pokemon.ts:L7995-L8017`).
3. Wrap direct Phaser seeded methods and seed transitions. The pinned oracle
   has direct `realInRange` use in battle level generation
   (`oracle: src/battle.ts:L240-L275`), direct shuffle use in egg and mystery
   encounter paths (`oracle: src/data/egg.ts:L778-L784`,
   `oracle: src/data/mystery-encounters/encounters/absolute-avarice-encounter.ts:L338-L350`,
   `oracle: src/data/mystery-encounters/utils/encounter-pokemon-utils.ts:L304-L309`),
   and seeded integer/float/item/shuffle helpers that call Phaser directly
   (`oracle: src/utils/common.ts:L101-L155`). These paths are each classified
   as a draw or a deterministic stream transition and cannot be silently
   omitted if they affect the scenario.

The closed `reason` is selected from a source-callsite map checked into the
future exporter/test contract. Stack traces may be retained as diagnostics but
must not supply the canonical reason. The first direct mappings to steward are
the random damage spread at `oracle: src/field/pokemon.ts:L5545-L5551` to
`DamageVariance` and the critical-hit roll at
`oracle: src/field/pokemon.ts:L5875-L5881` to `CriticalHit`; these names are
closed-contract examples, not inferred parity results. The sleep-duration call
site is visible at `oracle: src/field/pokemon.ts:L7277-L7290`, but its final
closed enum must be assigned before a fixture can be generated. An unknown or
unmapped reachable call fails with `UNMAPPED_RNG_REASON` and includes the exact
path/line diagnostic. Arbitrary reason strings are forbidden by the M3 RNG
requirement (`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:L425-L462`).

Seeded utility calls are not the same as unseeded battle randomness. The oracle
documents `randInt` as unseeded and explicitly says it must not be used for
battles (`oracle: src/utils/common.ts:L79-L93`). The exporter must fail if an
unseeded `Math.random` path changes battle-affecting state. Conversely, the
quantizer path temporarily replaces `Math.random` with `randSeedFloat` inside a
seed-offset scope (`oracle: src/field/pokemon.ts:L7848-L7863`); the adapter must
classify that seeded bridge or report it as an explicit non-mechanical/cosmetic
gap rather than guessing.

### Mutation ledger and unrecorded-state-change failure

**Proposed.** The exporter maintains a transaction ledger around each raw input,
committed command, resolved action, phase boundary, and endpoint capture. Each
mutation entry has `{seq, actor, action_seq, phase, path, before, after,
cause}`. State snapshots are compared at every boundary. A changed canonical
leaf without a mutation entry is a hard `UNRECORDED_STATE_CHANGE` failure;
the exporter must never append a synthetic mutation with an unknown cause just
to make a final-state diff pass.

The ledger must also audit capture itself. Existing checkpoint capture can write
HP during normalization (`oracle: src/data/elite-redux/coop/coop-battle-engine.ts:L398-L417`),
so the exporter should preflight and postflight the live state and reject any
capture-side write with `CAPTURE_MUTATED_STATE`. If a required state region
cannot be observed at the relevant boundary, write a gap containing its path,
cause, and oracle source, then fail the fixture's required parity gate. This is
consistent with the existing all-or-nothing carrier policy, which withholds a
frame when any required capture is unavailable
(`oracle: src/data/elite-redux/coop/coop-battle-engine.ts:L4917-L4947`).

RNG is audited by the same boundary rule. A change in any recorded Phaser or
battle-stream state without a corresponding logical draw/stream-transition
entry is a hard `UNRECORDED_RNG_STATE_CHANGE`. The M3 specification explicitly
requires generation failure when Phaser RNG state changes without a recorded
oracle draw (`C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:L988-L1000`).

### Presentation and next control

**Proposed.** `expected_presentation` records ordered authority semantic events
with `{seq, kind, payload, source, authority_stage}`. When the co-op event stream
is available, preserve its per-turn sequence and event kind rather than deriving
events from final state. The authority-recorded stage is the fixture claim
(`oracle: src/data/elite-redux/coop/coop-turn-recorder.ts:L76-L124`,
`oracle: src/data/elite-redux/coop/coop-turn-recorder.ts:L212-L260`). In the
headless runner, intercepted text is evidence of message output only; it is not
evidence that a renderer completed the presentation
(`oracle: test/tools/run-scenario.test.ts:L1311-L1415`). Renderer completion,
settlement timing, skips, and renderer failures are globally excluded by
`RENDERER_COMPLETION_SETTLEMENT`; their absence creates no case gap and no
empty-success claim. Missing or unordered authority semantic events remain the
blocking `PRESENTATION_UNOBSERVABLE` failure.

`expected_next_control` is captured after the final committed action and all
queued resolution phases settle, before the next driver event. Its required
fields are `control_kind`, wave, turn, `phase_name`, ordered `queued_phases`, and
ordered `pending_command_owners`; `ui_mode`, handler, and cursor are included
only when observed. Closed control kinds include `Command`, `MoveSelect`,
`TargetSelect`, `PartyReplacement`, `Reward`, and `Terminal`. The phase manager
exposes the current phase and queued phase names
as read-only diagnostics (`oracle: src/phase-manager.ts:L395-L410`) and defines
phase queue/start semantics (`oracle: src/phase-manager.ts:L578-L640`). UI mode
and handler cursor are separately observable through
`oracle: src/ui/ui.ts:L988-L993` and
`oracle: src/ui/handlers/ui-handler.ts:L40-L55`.

The co-op transport has a richer active-control snapshot with phase name,
interaction counter, awaited interactions, barriers, and pending commands
(`oracle: src/data/elite-redux/coop/coop-transport.ts:L910-L930`). That is a
useful shape precedent, not proof of Rust-owned single-player identities. The
manifest globally excludes decision operation IDs, control/menu IDs, menu
graphs, cancel history, menu-instance IDs, and allocator high-water/history.
Those remain mandatory in the full M3 API and non-oracle tests, but are not
semantic fixture fields. The exporter fails with `NEXT_CONTROL_UNOBSERVABLE` if
any required semantic-frontier field cannot be captured.

## Determinism, provenance, and gate

**Proposed.** The future test
`test/kernel-fixtures/m3/export-battle-oracle.test.ts` invokes the future
`scripts/export-kernel-m3-oracle.mjs` twice, each in an independent fresh Node
process, with the same scenario bytes and the same pinned oracle object. The
test does not run in this design task. Each process writes canonical UTF-8 JSON
with sorted object keys, preserved array order, normalized numbers, and one
final newline. No timestamp, duration, PID, log interleaving, or process-local
identifier may enter canonical output. The existing checksum canonicalizer
provides the required key/array/number determinism precedent
(`oracle: src/data/elite-redux/coop/coop-battle-checksum.ts:L217-L245`).

The gate compares the two output bytes and their SHA-256 hashes before any
oracle-vs-Rust comparison. A mismatch fails with the first byte offset and
decoded JSON path. If bytes match, the test separately validates that initial
and final state/RNG, semantic intent and committed commands, RNG draws/reasons,
actions, mutations, semantic presentation, and the observed next-control
frontier are present and ordered. This catches a
non-deterministic trace even when a final state happens to match, as required
by the differential comparison contract
(`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:L1009-L1022`).

Provenance is mandatory on every case: the pinned oracle commit and tree, a
content hash, exporter commit, Node/Phaser versions, OS/architecture and
runner class, locale, and timezone. The existing ER fingerprint is a
deterministic per-section fingerprint for move maps/tables, movesets, and
abilities, and explicitly avoids time/random inputs
(`oracle: src/data/elite-redux/coop/coop-data-fingerprint.ts:L7-L23`,
`oracle: src/data/elite-redux/coop/coop-data-fingerprint.ts:L174-L200`). It can
be included as a diagnostic component, but it is not evidence that the whole
game content pack is hashed. **Gap:** until a complete content manifest/hash
scope is defined, `oracle_content_hash` must be marked unavailable and fixture
generation must not claim content-lock parity.

The exporter should report failures using stable codes, at minimum:

- `UNRECORDED_RNG_STATE_CHANGE`;
- `UNMAPPED_RNG_REASON`;
- `UNRECORDED_STATE_CHANGE`;
- `CAPTURE_MUTATED_STATE`;
- `PRESENTATION_UNOBSERVABLE`; and
- `NEXT_CONTROL_UNOBSERVABLE`.

Each gap/failure record includes the required field or callsite, boundary
sequence, exact oracle path/line, and whether it blocks fixture generation.
Unsupported or unobservable mechanics are surfaced rather than silently
ignored, matching the specification's error policy
(`C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt:L942-L965`).
The three exact manifest-level unclaimed subdimensions are global scope
declarations, not case gaps; they cannot be extended or overridden per case.

## Owned future paths and proposed contract decisions

The implementation work that follows this design owns only these future paths:

- `scripts/export-kernel-m3-oracle.mjs`: fresh-process exporter and canonical
  serializer;
- `test/kernel-fixtures/m3/export-battle-oracle.test.ts`: two-process byte
  identity, instrumentation closure, and provenance gate.

Generated `rust/fixtures/m3` cases are downstream artifacts described by the
M3 specification and are not created by this task
(`C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt:L911-L948`).
No production TypeScript, Rust, shared contract, fixture, or workflow path is
owned here.

The proposed decisions for the contract steward are:

1. Full authoritative material is the canonical state; transport tick is
   excluded from parity, while checksum state/preimage/digest remain
   diagnostics.
2. Consuming RNG draws form the fixture list; `range <= 1` calls remain in the
   raw audit as `consumed: false`.
3. Nested `BattleScene`/`Pokemon`/`Battle` wrappers correlate to one logical
   draw; direct Phaser calls are independently instrumented and classified.
4. Reason values are closed and selected by an exact pinned-source callsite
   map. A reachable unmapped callsite hard-fails generation.
5. State and RNG capture is observational. Any capture-side normalization or
   state/RNG delta fails the exporter.
6. Semantic intent, committed commands, resolved actions, mutations, authority
   presentation, and the observed next-control frontier are separate ordered
   evidence; no claimed value is reconstructed from final state or message
   text. Raw physical input, renderer settlement, and Rust-owned control/menu
   identity or allocator history are globally unclaimed semantic-oracle
   subdimensions while remaining mandatory non-oracle M3 surfaces.
7. Canonical serialization is sorted-key, ordered-array, stable-number UTF-8
   JSON, and two independent fresh processes must emit byte-identical output.
8. Missing claimed mutation, RNG-reason, semantic presentation, content-hash,
   or semantic-frontier evidence is an explicit blocking gap, never fabricated
   parity data. Globally unclaimed subdimensions create no per-case gaps.
