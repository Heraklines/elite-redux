# Rust-kernel test oracle

This is the Wave 0 static coverage map for PokéRogue Redux. “Elite Redux” is
retained only where it is part of an existing source, path, or protocol
identifier.

- Oracle game SHA: `3b534099919efae827019d4a3f3c4ab0ecd6d67b`
- Oracle branch: `ci/coop/v2-showdown-command-coordinate-20260720`
- Protocol version: `er-coop-47`
- JSON fixture: [`rust/fixtures/v1/test-coverage-map.json`](../../../rust/fixtures/v1/test-coverage-map.json)

## Scope and counts

The JSON is deterministic: source paths are sorted, and each section preserves
a stable source-file/source-line or declared category order for its records and
parameterized identities. Every record carries the required source, subject,
invariant, dependency, execution class, Rust target, parity-fixture need, and
status fields.

The pinned inventory contains:

- 29 `test/node/authority-v2-*.test.ts` files.
- 439 production Authority V2 node test identities.
- 17 reference-simulator test identities, kept in `simulator_scenarios` rather
  than mixed with production implementation tests.
- 76 input/menu test files with 591 statically discovered test identities.
- 65 combat scenario-runner identities, 8 UI-surface runner identities, and
  one CLI wrapper contract record.
- 87 harness-backed two-engine files with 316 statically discovered test
  identities.
- 23 browser public-UI contract files with 204 statically discovered test
  identities.

The 456 Authority V2 identities are represented by the union of
`authority_v2_contracts` and `simulator_scenarios`. The simulator test is
therefore not counted as a production implementation test, but its source file
and every test title remain covered.

## Execution policy

No co-op or Phaser Vitest file is run locally for this map. The JSON marks all
such records `external-only`, including node-pure Authority V2 tests. The
external classes are:

- Authority V2 node tests: isolated node-pure fast-contract runner.
- Co-op and Showdown engine tests: exact-SHA sharded co-op gate.
- Scenario and input/menu runners: isolated Phaser runner.
- Browser journeys: isolated Chrome/public-UI/WebRTC runner.

The `heavy_external_only` array is the concise policy index. Individual test
records retain the same class so a Rust fixture consumer cannot accidentally
interpret a static map as local execution evidence.

## Authority V2 production contracts

`authority_v2_contracts` contains one record per static `it(...)`/`test(...)`
identity in the 28 production Authority V2 files. The subject is assigned from
the filename and the invariant preserves the test title verbatim (or as a raw
template expression for a parameterized title). The source line is included in
`stable_identifier`, which makes identities stable without inventing runtime
parameter values.

The covered production surfaces are command-frontier ownership and coordinate
projection; control validation, ownership, and ordered receipts; frame codec and
context validation; turn, replacement, interaction, wave, terminal, and
recovery material; proposal admission/leases; lifecycle and scheduler clocks;
session identity; log/mutation barriers; cutover gates; wire delivery; and
shadow transport/parity telemetry.

The future Rust targets in the JSON are migration destinations, not claims that
the Rust implementation already exists at this SHA. Canonical entry/control/
receipt JSON fixtures are required for each production contract family.

## Reference simulator

`test/tools/coop-authority-v2-simulator.ts` is deliberately separate from the
production implementation. Its header states that it is engine-free, imports
the Authority V2 contract type-only, and owns its own reference implementations
of the authority log, projector, recovery transaction, scheduler, transport,
clock, and seeded PRNG.

The simulator models the six pinned decisions: one global revision order, one
retained frontier, one frame context, authority-stated next control, one atomic
recovery transaction, and explicit ACK-stage meanings. Its virtual clock keeps
mechanical active-time deadlines paused during endpoint suspension while the
absolute safety ceiling continues. Its queued message bus preserves asynchronous
delivery even for loopback, and its seeded fault plane covers drops, duplicates,
latency, reorder, disconnect/reconnect, suspension, and recovery.

`simulator_scenarios` contains both directed convergence/supersession cases and
sentinel checks for commit/delivery/apply/retire, duplicate protection, recovery,
exact controls, terminal freezing, and zero-leak teardown. The Rust equivalent
must compare the full deterministic trace and final converge/terminal state,
not merely a boolean pass result.

## Input, menu, and scenario coverage

The input/menu inventory was derived from tracked tests that reference
`#enums/buttons`, `#app/inputs-controller`, `#app/ui-inputs`, `#ui/handlers`,
`src/ui/handlers`, or the dedicated `test/tests/ui/inputs.test.ts` cadence
suite. It includes ordinary gameplay/phase button routing, co-op and Showdown
menus, real handler contracts, and touch/keyboard/gamepad hold timing.

`test/framework/game-manager.ts` is the common Phaser boundary. It creates and
owns a real `BattleScene`, uses `Button` and `UiMode`, queues public UI prompts,
and drives handler input through the same UI boundary used by gameplay. The
input/menu records therefore need deterministic button-event, cursor/menu-state,
and handler-outcome fixtures in Rust.

The scenario runner has two layers:

- `scripts/run-scenario.mjs` validates CLI arguments, maps them to `ER_RUN_*`
  environment variables, validates an optional policy JSON, and launches
  `test/tools/run-scenario.test.ts`.
- `test/tools/run-scenario.test.ts` runs real ScenarioSpec/share-code combat
  paths, including moves, switches, capture/flee, doubles, rewards, mystery
  encounters, multi-wave progress, and deterministic versus real seeded RNG.
- `test/tools/run-ui-scenario.test.ts` is a CLI-driven, non-pixel runner for
  real starter, Pokédex, egg-hatch, biome, bargain, and Mystery UI handlers.

The Rust target is a normalized scenario state transcript, not a replacement
for Phaser rendering.

## Two-engine campaigns

The 87 records in `two_engine_campaigns` are the tracked test files that import
`test/tools/coop-duo-harness.ts`. They include launch/handshake, command and
replacement, wave/reward/biome/Mystery continuations, Showdown, replay/resume,
fault/recovery, and long soak journeys. Their current execution class is the
external sharded two-engine Phaser runner.

The harness boots a real authoritative HOST `BattleScene` and a real GUEST
renderer in one Vitest process over an in-process `LoopbackTransport` using the
same framing boundary as the WebRTC path. This is intentionally different from
older single-engine fixtures that faked host turn messages.

The harness must swap a complete `ClientCtx` atomically before every client
pump. The source comments and implementation identify these process-global
dependencies:

- `globalScene` from `src/global-scene.ts`.
- The active co-op runtime (`setCoopRuntime`/`getCoopRuntime`).
- `Phaser.Math.RND.state()`, the process-global seeded RNG cursor.
- The ER ghost-team per-run cache and its role-gated hooks.
- Mystery-encounter pins: interaction start, battle counter, host
  presentation, active replay/control, and handoff state.
- Additional ER module-let substrates such as money streaks, biome overstay,
  relic lists, achievement-run state, and the world-map/biome transition
  one-shot permit.
- Account identity and scheduled inbound transport when the journey requires
  them.

`withClient` saves and restores those substrates so an async continuation cannot
resume against the other engine's `globalScene`. Destination-scene message
queues and deferred Authority V2 frames are pumped only while the receiving
client context is installed. Owner/watcher interaction drives are sequential
because a cross-context await continuation cannot safely run against the wrong
global scene. The active-time scheduler override is deterministic and must be
cleared during teardown.

These constraints are the primary Rust gap: Rust should make host/guest context,
RNG cursor, transport inbox, and ownership explicit instead of reproducing
process-global mutation. The parity fixture needs command traces, transport
events, scene snapshots, and convergence receipts from both clients.

## Browser journeys

`browser_journeys` covers the 23 `test/browser/coop-public-ui/*.test.mjs` files.
They provide static gate contracts plus public-UI lifecycle, launch, command,
replacement, reward/market, Mystery, save mutation, Showdown, game-over,
watchdog, semantic-surface, WebGL/pixel, and browser-artifact evidence.

These records remain browser-only. Semantic DOM/event and transport receipts can
feed Rust parity fixtures; Chromium lifecycle, WebRTC identity negotiation,
WebGL, and pixel evidence still require the external browser lane.

## Static verification

The JSON parser check is:

```powershell
node --input-type=module -e "import { readFileSync } from 'node:fs'; const d=JSON.parse(readFileSync('rust/fixtures/v1/test-coverage-map.json','utf8')); const keys=['schema_version','oracle_game_sha','protocol_version','source_files','authority_v2_contracts','simulator_scenarios','input_menu_tests','scenario_runner','two_engine_campaigns','browser_journeys','coverage_gaps','heavy_external_only']; if(d.schema_version!==1||keys.some(k=>!(k in d))) throw new Error('coverage-map contract failure'); console.log('coverage map JSON OK');"
```

The static Authority V2 inventory check strips comments, extracts direct
`it(...)`/`test(...)` calls from every tracked `test/node/authority-v2-*.test.ts`
file, and compares `file:line:kind` identities against the union of the two
Authority V2 JSON sections. It must report `files=29`, `tests=456`,
`missing=0`, `extra=0`, and `missingFiles=0`.

```powershell
@'
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const stripComments = (input) => {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1] ?? '';
    if (state === 'line') {
      if (ch === '\n') {
        out += '\n';
        state = 'code';
      } else {
        out += ' ';
      }
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 1;
        state = 'code';
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'quote') {
      out += ch;
      if (ch === '\\') {
        if (i + 1 < input.length) {
          out += input[i + 1];
          i += 1;
        }
      } else if (ch === quote) {
        state = 'code';
        quote = '';
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      out += '  ';
      i += 1;
      state = 'line';
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 1;
      state = 'block';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) {
      out += ch;
      quote = ch;
      state = 'quote';
      continue;
    }
    out += ch;
  }
  return out;
};

const d = JSON.parse(readFileSync('rust/fixtures/v1/test-coverage-map.json', 'utf8'));
const re = /(?<![\w$.])(it|test)\s*\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\x60](?:\\.|[^\x60\\])*[\x60])/gu;
const files = readdirSync('test/node')
  .filter((file) => /^authority-v2-.*\.test\.ts$/u.test(file))
  .sort();
const expected = [];
for (const file of files) {
  const source = stripComments(readFileSync(join('test/node', file), 'utf8'));
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length;
    expected.push('test/node/' + file + ':' + line + ':' + match[1]);
  }
}
const actual = d.authority_v2_contracts
  .concat(d.simulator_scenarios)
  .map((record) => record.stable_identifier);
const actualSet = new Set(actual);
const expectedSet = new Set(expected);
const missing = expected.filter((id) => !actualSet.has(id));
const extra = actual.filter((id) => !expectedSet.has(id));
const expectedFiles = new Set(files.map((file) => 'test/node/' + file));
const actualFiles = new Set(d.authority_v2_contracts
  .concat(d.simulator_scenarios)
  .map((record) => record.source_file));
const missingFiles = [...expectedFiles].filter((file) => !actualFiles.has(file));
if (missing.length || extra.length || missingFiles.length || actual.length !== expected.length) {
  throw new Error(JSON.stringify({
    missing,
    extra,
    missingFiles,
    expected: expected.length,
    actual: actual.length,
  }));
}
console.log(JSON.stringify({
  files: files.length,
  tests: expected.length,
  missing: missing.length,
  extra: extra.length,
  missingFiles: missingFiles.length,
}));
'@ | node --input-type=module
```

Finally run:

```powershell
git diff --check
```

No local co-op Vitest file or co-op gate is part of these checks.

## Known gaps

The JSON `coverage_gaps` array records the exact boundaries rather than
claiming parity that cannot be observed at this SHA:

- The Rust kernel scaffold and fixture schema are not present yet.
- Process-global Phaser/ER state must become explicit Rust client context.
- Browser rendering and WebRTC evidence remain external acceptance surfaces.
- Parameterized titles retain raw source expressions and stable source lines;
  the map does not invent runtime expansion values.
