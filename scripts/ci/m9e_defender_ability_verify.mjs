import assert from "node:assert/strict";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const [one, two, output] = process.argv.slice(2);
assert.equal(process.argv.length, 5);
function read(path) {
  assert.ok(statSync(path).isFile() && statSync(path).size > 0 && statSync(path).size <= 32768);
  return readFileSync(path);
}
const first = read(one), second = read(two);
assert.deepEqual(first, second);
const data = JSON.parse(first);
const integer = value => Number.isSafeInteger(value) && value >= 0;
function environment(value) {
  assert.equal(value.classic, true);
  for (const key of ["moody_absent", "set_collector_absent", "endless_absent", "endless_battle_absent"]) assert.equal(value[key], true);
  assert.equal(value.actor_heal_multiplier, 1);
  assert.equal(value.holder_heal_multiplier, 1);
  assert.equal(value.holder_heal_block, false);
  assert.equal(value.holder_bleed, false);
  assert.equal(typeof value.ability_flyouts, "boolean");
}
function validate(value) {
  assert.equal(value.schema_version, 1);
  assert.equal(value.source_sha, PIN);
  assert.equal(value.seed, "m9e-defender-source-v1");
  assert.equal(value.metadata.ability.id, 5082);
  assert.equal(value.metadata.ability.heal_fraction, 0.25);
  assert.deepEqual(value.metadata.ability.attrs, ["RedirectTypeMoveAbAttr", "TypeAbsorbHealAbAttr", "PassiveRecoveryAbAttr"]);
  assert.equal(value.metadata.move.id, 40);
  assert.equal(value.metadata.move.type, 3);
  assert.ok(Array.isArray(value.metadata.move.attrs) && value.metadata.move.attrs.length > 0);
  assert.equal(value.metadata.controlled_inputs.length, 5);
  environment(value.bootstrap.environment);
  assert.equal(value.bootstrap.actor.species, 1);
  assert.deepEqual(value.cases.map(row => row.id), ["wounded", "full"]);
  for (const row of value.cases) {
    environment(row.before.environment);
    environment(row.after.environment);
    assert.equal(row.simulated, 0);
    assert.ok(integer(row.before.max_hp) && row.before.max_hp > 1 && integer(row.before.hp) && row.before.hp > 0);
    assert.ok(row.before.hp <= row.before.max_hp && integer(row.after.hp));
    assert.ok(Array.isArray(row.phases) && row.phases.length <= 128 && row.phases.includes("MoveEffectPhase"));
    assert.ok(Array.isArray(row.journal) && row.journal.length > 0 && row.journal.length <= 160);
    for (const [i, event] of row.journal.entries()) {
      assert.equal(event.ordinal, i);
      assert.equal(typeof event.phase, "string");
      assert.equal(typeof event.kind, "string");
    }
    const select = kind => row.journal.filter(event => event.kind === kind);
    const hit = select("hit_check_after").filter(event => event.holder_target);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].effectiveness, 0);
    assert.equal(hit[0].result, row.id === "wounded" ? 3 : 2);
    assert.equal(select("actor_rng").filter(event => event.phase === "MoveEffectPhase").length, 0);
    assert.equal(select("critical_call").length, 0);
    const show = select("ability_display").filter(event => event.show && event.ability === 5082);
    const hide = select("ability_display").filter(event => !event.show && event.ability === 5082);
    assert.equal(show.length, 1);
    assert.equal(hide.length, 1);
    assert.equal(show[0].passive, false);
    assert.ok(show[0].ordinal < hide[0].ordinal && hide[0].ordinal < hit[0].ordinal);
    for (const key of ["wave", "summon"]) assert.ok(row.after.ledger[key].includes(5082));
    const heal = select("heal_after"), queued = select("queue_heal"), before = select("heal_before");
    if (row.id === "wounded") {
      assert.ok(row.before.hp < row.before.max_hp);
      const requested = Math.max(Math.floor(row.before.max_hp / 4), 1);
      const actual = Math.min(requested, row.before.max_hp - row.before.hp);
      assert.equal(queued.length, 1); assert.equal(before.length, 1); assert.equal(heal.length, 1);
      assert.equal(queued[0].requested, requested);
      assert.equal(queued[0].message_null, true);
      assert.equal(queued[0].show_full_hp, true);
      assert.equal(before[0].requested, requested);
      assert.equal(before[0].hp, row.before.hp);
      assert.equal(heal[0].actual, actual);
      assert.equal(heal[0].hp, row.before.hp + actual);
      assert.equal(row.after.hp, row.before.hp + actual);
      assert.ok(show[0].ordinal < queued[0].ordinal && queued[0].ordinal < hide[0].ordinal);
      assert.ok(hit[0].ordinal < before[0].ordinal && before[0].ordinal < heal[0].ordinal);
      assert.ok(row.phases.includes("PokemonHealPhase"));
    } else {
      assert.equal(row.before.hp, row.before.max_hp);
      assert.equal(row.after.hp, row.before.hp);
      assert.equal(queued.length, 0); assert.equal(before.length, 0); assert.equal(heal.length, 0);
    }
  }
}
validate(data);
let rejected = 0;
for (const mutate of [
  value => { value.source_sha = "0".repeat(40); },
  value => { value.metadata.ability.heal_fraction = 0.5; },
  value => { value.cases.pop(); },
  value => { value.cases[0].id = "renamed"; },
  value => { value.bootstrap.environment.moody_absent = false; },
  value => { value.cases[0].after.hp -= 1; },
  value => { value.cases[0].journal.find(event => event.kind === "heal_after").actual = 0; },
  value => { value.cases[1].simulated = 1; },
]) {
  const changed = structuredClone(data); mutate(changed);
  assert.throws(() => validate(changed)); rejected++;
}
const summary = { schema_version: 1, status: "passed", source_sha: PIN,
  scope: "two byte-identical actual source PhaseTree diagnostic observations; no Rust qualification",
  source_cases: 2, fresh_processes: 2, negative_mutations_rejected: rejected,
  export_bytes: first.length, export_sha256: createHash("sha256").update(first).digest("hex") };
const raw = `${JSON.stringify(summary)}\n`;
assert.ok(Buffer.byteLength(raw) <= 32768);
writeFileSync(output, raw, { encoding: "utf8", flag: "wx" });
