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

The inventory is extracted from lexical call sites, not from runtime execution:
comments, strings, templates, and regular-expression literals are skipped;
balanced calls recognize direct `it`/`test`, `it.each`, `it.skipIf`, and
`it.todo` (including generic type arguments). The first title expression is
recorded once per source call. Parameterized data tables are never expanded;
`%s`/`$name` placeholders remain in string titles, and template literals retain
their raw `template-expression:` form.

The pinned inventory contains 236 source-file records:

- 29 `test/node/authority-v2-*.test.ts` files.
- 444 production Authority V2 node test identities.
- 17 reference-simulator test identities, kept in `simulator_scenarios` rather
  than mixed with production implementation tests.
- 76 input/menu test files with 592 statically discovered test identities.
- 72 combat scenario-runner identities, 8 UI-surface runner identities, and
  one CLI wrapper contract record.
- 87 harness-backed two-engine files with 312 statically discovered test
  identities.
- 23 browser public-UI contract files with 204 statically discovered test
  identities.

The 461 Authority V2 identities are represented by the union of
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

The static Authority V2 inventory check uses the same deterministic lexical
balanced-call extractor described above. It skips comments, quoted strings,
template literals, and regular-expression literals; recognizes direct
it/test calls, it.each, it.skipIf, and it.todo; accepts generic type
arguments; and records the first title expression once per source call.
String titles retain parameter placeholders, while template titles retain
their raw template-expression form. It compares source-line identity and
canonical title against both Authority V2 JSON sections. It must report
files=29, production=444, simulator=17, tests=461, missing=0, extra=0,
duplicates=0, missingFiles=0, and titleMismatches=0.

```powershell
@'
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const templateQuote = String.fromCharCode(96);
const pair = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);
const closing = new Set([...pair.values()]);
const identifierStart = (value) => /[A-Za-z_$]/u.test(value);
const identifierPart = (value) => /[A-Za-z0-9_$]/u.test(value);
const regexAfterWord = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof',
  'new', 'of', 'return', 'throw', 'typeof', 'void', 'yield',
]);
const regexAfterPunctuation = new Set([
  '(', '[', '{', ',', ';', ':', '=', '!', '?', '&&', '||',
  '??', '=>', '+', '-', '*', '/', '%', '&', '|', '^', '~',
  '<', '>',
]);

function lex(source) {
  const tokens = [];
  let index = 0;
  let regexAllowed = true;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1] ?? '';
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (character === '"' || character === "'") {
      const start = index;
      const quote = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
        } else if (source[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      tokens.push({ kind: 'string', value: source.slice(start, index), start, end: index });
      regexAllowed = false;
      continue;
    }
    if (character === templateQuote) {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
        } else if (source[index] === templateQuote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      tokens.push({ kind: 'template', value: source.slice(start, index), start, end: index });
      regexAllowed = false;
      continue;
    }
    if (identifierStart(character)) {
      const start = index;
      index += 1;
      while (index < source.length && identifierPart(source[index])) index += 1;
      const value = source.slice(start, index);
      tokens.push({ kind: 'identifier', value, start, end: index });
      regexAllowed = regexAfterWord.has(value);
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_.]/u.test(source[index])) index += 1;
      tokens.push({ kind: 'number', value: source.slice(start, index), start, end: index });
      regexAllowed = false;
      continue;
    }
    if (character === '/' && regexAllowed) {
      const start = index;
      let inClass = false;
      let escaped = false;
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (escaped) {
          escaped = false;
        } else if (current === '\\') {
          escaped = true;
        } else if (current === '[') {
          inClass = true;
        } else if (current === ']') {
          inClass = false;
        } else if (current === '/' && !inClass) {
          index += 1;
          while (index < source.length && /[A-Za-z]/u.test(source[index])) index += 1;
          break;
        } else if (current === '\n') {
          break;
        }
        index += 1;
      }
      tokens.push({ kind: 'regex', value: source.slice(start, index), start, end: index });
      regexAllowed = false;
      continue;
    }
    const start = index;
    const two = source.slice(index, index + 2);
    const value = new Set([
      '?.', '=>', '==', '!=', '<=', '>=', '&&', '||', '??',
      '++', '--', '**', '+=', '-=', '*=', '/=', '...',
    ]).has(two) ? two : character;
    index += value.length;
    tokens.push({ kind: 'punctuation', value, start, end: index });
    regexAllowed = regexAfterPunctuation.has(value);
  }
  return tokens;
}

function matching(tokens, openIndex) {
  const expectedClose = pair.get(tokens[openIndex]?.value);
  if (!expectedClose) return -1;
  const stack = [];
  for (let index = openIndex; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (pair.has(value)) {
      stack.push(pair.get(value));
    } else if (closing.has(value)) {
      if (stack.pop() !== value) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function angleClose(tokens, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === '<') depth += 1;
    if (tokens[index].value === '>' && --depth === 0) return index;
  }
  return -1;
}

function callOpenAfter(tokens, index) {
  let cursor = index;
  if (tokens[cursor]?.value === '<') {
    const close = angleClose(tokens, cursor);
    if (close < 0) return -1;
    cursor = close + 1;
  }
  return tokens[cursor]?.value === '(' ? cursor : -1;
}

function firstArgument(tokens, openIndex, closeIndex) {
  if (openIndex < 0 || closeIndex <= openIndex + 1) return null;
  let depth = 0;
  for (let index = openIndex + 1; index < closeIndex; index += 1) {
    const value = tokens[index].value;
    if (pair.has(value)) {
      depth += 1;
    } else if (closing.has(value)) {
      depth -= 1;
    } else if (value === ',' && depth === 0) {
      const first = tokens[openIndex + 1];
      const last = tokens[index - 1];
      return first && last ? { start: first.start, end: last.end } : null;
    }
  }
  const first = tokens[openIndex + 1];
  const last = tokens[closeIndex - 1];
  return first && last ? { start: first.start, end: last.end } : null;
}

function titleOf(source, argument) {
  const raw = source.slice(argument.start, argument.end).trim();
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through to the deterministic escape decoder.
    }
  }
  if (raw.startsWith("'")) {
    const escapes = {
      '0': '\0', b: '\b', f: '\f', n: '\n', r: '\r',
      t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"',
    };
    return raw.slice(1, -1).replace(/\\(.)/gu, (whole, value) => escapes[value] ?? value);
  }
  if (raw.startsWith(templateQuote)) return 'template-expression:' + raw;
  return 'expression:' + raw;
}

function titleCall(tokens, rootIndex) {
  let cursor = rootIndex + 1;
  let method = null;
  let openIndex;
  if (tokens[cursor]?.value === '(') {
    openIndex = cursor;
  } else if (tokens[cursor]?.value === '.' || tokens[cursor]?.value === '?.') {
    method = tokens[cursor + 1]?.value;
    if (!method) return null;
    openIndex = callOpenAfter(tokens, cursor + 2);
    if (openIndex < 0) return null;
    if (method === 'each' || method === 'skipIf') {
      const guardClose = matching(tokens, openIndex);
      if (guardClose < 0 || tokens[guardClose + 1]?.value !== '(') return null;
      openIndex = guardClose + 1;
    } else if (!new Set(['todo', 'skip', 'only', 'concurrent']).has(method)) {
      return null;
    }
  } else {
    return null;
  }
  const closeIndex = matching(tokens, openIndex);
  const argument = firstArgument(tokens, openIndex, closeIndex);
  const firstToken = tokens[openIndex + 1];
  if (!argument || !firstToken || !new Set(['string', 'template']).has(firstToken.kind)) return null;
  return { openIndex, argument };
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function callSites(source, relativeFile) {
  const tokens = lex(source);
  const sites = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'identifier' || !new Set(['it', 'test']).has(token.value)) continue;
    const title = titleCall(tokens, index);
    if (!title) continue;
    sites.push({
      source_line: lineAt(source, token.start),
      stable_identifier: relativeFile + ':' + lineAt(source, token.start) + ':' + token.value,
      test_title: titleOf(source, title.argument),
    });
  }
  return sites;
}

const d = JSON.parse(readFileSync('rust/fixtures/v1/test-coverage-map.json', 'utf8'));
const files = readdirSync('test/node')
  .filter((file) => /^authority-v2-.*\.test\.ts$/u.test(file))
  .sort((left, right) => left.localeCompare(right));
const expected = files.flatMap((file) => callSites(
  readFileSync(join('test/node', file), 'utf8'),
  'test/node/' + file,
));
const production = d.authority_v2_contracts;
const simulator = d.simulator_scenarios;
const actualRecords = production.concat(simulator);
const expectedIds = new Set(expected.map((site) => site.stable_identifier));
const actualIds = new Set(actualRecords.map((record) => record.stable_identifier));
const idCounts = new Map();
for (const record of actualRecords) {
  idCounts.set(record.stable_identifier, (idCounts.get(record.stable_identifier) ?? 0) + 1);
}
const duplicates = [...idCounts].filter(([, count]) => count > 1).map(([id]) => id);
const missing = expected.filter((site) => !actualIds.has(site.stable_identifier));
const extra = actualRecords
  .filter((record) => !expectedIds.has(record.stable_identifier))
  .map((record) => record.stable_identifier);
const expectedFiles = new Set(files.map((file) => 'test/node/' + file));
const actualFiles = new Set(actualRecords.map((record) => record.source_file));
const missingFiles = [...expectedFiles].filter((file) => !actualFiles.has(file));
const extraFiles = [...actualFiles].filter((file) => !expectedFiles.has(file));
const actualById = new Map(actualRecords.map((record) => [record.stable_identifier, record]));
const titleMismatches = expected
  .filter((site) => actualById.get(site.stable_identifier)?.test_title !== site.test_title)
  .map((site) => site.stable_identifier);
if (
  d.source_files.length !== 236 ||
  files.length !== 29 ||
  production.length !== 444 ||
  simulator.length !== 17 ||
  expected.length !== 461 ||
  production.some((record) => record.implementation_kind === 'reference-simulator') ||
  simulator.some((record) => record.implementation_kind !== 'reference-simulator') ||
  missing.length ||
  extra.length ||
  duplicates.length ||
  missingFiles.length ||
  extraFiles.length ||
  titleMismatches.length
) {
  throw new Error(JSON.stringify({
    source_files: d.source_files.length,
    files: files.length,
    production: production.length,
    simulator: simulator.length,
    expected: expected.length,
    missing,
    extra,
    duplicates,
    missingFiles,
    extraFiles,
    titleMismatches,
  }));
}
console.log(JSON.stringify({
  files: files.length,
  production: production.length,
  simulator: simulator.length,
  tests: expected.length,
  missing: missing.length,
  extra: extra.length,
  duplicates: duplicates.length,
  missingFiles: missingFiles.length,
  titleMismatches: titleMismatches.length,
}));
'@ | node --input-type=module
```

The map-only count/order/identity check is:

```powershell
@'
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('rust/fixtures/v1/test-coverage-map.json', 'utf8'));
const countTitles = (records) => records.reduce(
  (count, record) => count + (Array.isArray(record.test_titles) ? record.test_titles.length : 1),
  0,
);
const expected = {
  source_files: 236,
  authority_production: 444,
  simulator: 17,
  authority_total: 461,
  input_files: 76,
  input_tests: 592,
  scenario_records: 74,
  scenario_combat: 72,
  scenario_ui: 8,
  scenario_cli: 1,
  two_engine_files: 87,
  two_engine_tests: 312,
  browser_files: 23,
  browser_tests: 204,
};
const actual = {
  source_files: d.source_files.length,
  authority_production: d.authority_v2_contracts.length,
  simulator: d.simulator_scenarios.length,
  authority_total: d.authority_v2_contracts.length + d.simulator_scenarios.length,
  input_files: d.input_menu_tests.length,
  input_tests: countTitles(d.input_menu_tests),
  scenario_records: d.scenario_runner.length,
  scenario_combat: d.scenario_runner.filter((record) => record.source_file.endsWith('run-scenario.test.ts')).length,
  scenario_ui: countTitles(d.scenario_runner.filter((record) => record.source_file.endsWith('run-ui-scenario.test.ts'))),
  scenario_cli: d.scenario_runner.filter((record) => record.stable_identifier === 'scripts/run-scenario.mjs::cli-flags').length,
  two_engine_files: d.two_engine_campaigns.length,
  two_engine_tests: countTitles(d.two_engine_campaigns),
  browser_files: d.browser_journeys.length,
  browser_tests: countTitles(d.browser_journeys),
};
const identitySections = [
  'authority_v2_contracts',
  'simulator_scenarios',
  'input_menu_tests',
  'scenario_runner',
  'two_engine_campaigns',
  'browser_journeys',
];
const duplicateIdentities = [];
for (const section of identitySections) {
  const seen = new Set();
  for (const record of d[section]) {
    if (seen.has(record.stable_identifier)) duplicateIdentities.push(section + ':' + record.stable_identifier);
    seen.add(record.stable_identifier);
  }
}
const orderFailures = [];
const sorted = (values) => values.every((value, index) => index === 0 || values[index - 1] <= value);
const sourceKey = (record) => record.source_file + '\u0000' + String(record.source_line ?? 0).padStart(8, '0');
const assertSourceOrder = (section, records) => {
  const keys = records.map(sourceKey);
  if (!sorted(keys)) orderFailures.push(section);
};
assertSourceOrder('authority_v2_contracts', d.authority_v2_contracts);
assertSourceOrder('simulator_scenarios', d.simulator_scenarios);
const scenarioSourceRecords = d.scenario_runner.filter((record) => record.stable_identifier.endsWith(':it'));
assertSourceOrder('scenario_runner_source_calls', scenarioSourceRecords);
if (d.scenario_runner.at(-1)?.stable_identifier !== 'scripts/run-scenario.mjs::cli-flags') {
  orderFailures.push('scenario_runner_cli_last');
}
for (const section of ['input_menu_tests', 'two_engine_campaigns', 'browser_journeys']) {
  const keys = d[section].map((record) => record.source_file);
  if (!sorted(keys)) orderFailures.push(section + '_files');
  for (const record of d[section]) {
    if (!Array.isArray(record.test_lines) || !sorted(record.test_lines)) {
      orderFailures.push(section + ':' + record.stable_identifier + ':test_lines');
    }
  }
}
const sourcePaths = d.source_files.map((record) => record.path);
if (!sorted(sourcePaths) || new Set(sourcePaths).size !== sourcePaths.length) {
  orderFailures.push('source_files');
}
if (JSON.stringify(actual) !== JSON.stringify(expected) || duplicateIdentities.length || orderFailures.length) {
  throw new Error(JSON.stringify({ actual, expected, duplicateIdentities, orderFailures }));
}
console.log(JSON.stringify({
  ...actual,
  unique_identity_duplicates: duplicateIdentities.length,
  canonical_order_failures: orderFailures.length,
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
