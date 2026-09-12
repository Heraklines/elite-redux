import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [one, two, output] = process.argv.slice(2);
assert.equal(process.argv.length, 5);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 32768);
  const bytes = readFileSync(path);
  return { bytes, data: JSON.parse(bytes), fact: { bytes: bytes.length, sha256: hash(bytes) } };
};
const a = read(one), b = read(two);
assert.deepEqual(a.bytes, b.bytes, 'two fresh actual observations must be byte-identical');
const keys = ['LV_100', 'LV_250', 'LV_1000', 'REALISTIC_FLASH_IS_BORING', 'MAX_FRIENDSHIP'];
const expectedNames = ['level-99', 'level-100', 'level-250', 'level-1000', 'level-1000',
  'flash-first', 'flash-repeat', 'max-first-at-zero', 'max-repeat-after-zero'];
const integer = value => Number.isSafeInteger(value);
function verify(data) {
  assert.deepEqual(data.fresh_egg_selection,{unlock_pity:[0,0,0,0],same_species_counters:{}});
  assert(Array.isArray(data.rare_pool) && data.rare_pool.length > 0);
  let total = 0, previousSpecies = 0;
  const boundaries = data.rare_pool.map(row => {
    assert.deepEqual(Object.keys(row).sort(),['species','cost','divisor','caught'].sort());
    assert(integer(row.species) && row.species > previousSpecies && row.species !== 489 && row.species !== 490);
    previousSpecies = row.species;
    assert(Number.isFinite(row.cost) && row.cost > 0 && Number.isFinite(row.divisor) && row.divisor >= 1);
    assert.equal(typeof row.caught,'boolean');
    const clamped = Math.min(5, Math.max(4, row.cost));
    let weight = Math.floor((((5-clamped)/2)*1.5+1)*100);
    if(row.species === 201) weight=Math.max(1,Math.floor(weight*0.1));
    weight=Math.max(1,Math.floor(weight/row.divisor));
    total+=weight;
    return {species:row.species,upper:total,caught:row.caught};
  });
  assert(integer(total) && total > 0 && integer(data.rare_move_rate) && data.rare_move_rate > 0);
  const egg=data.fresh_egg_account;
  assert.deepEqual(Object.keys(egg).sort(),['eggs','settings','vouchers','maximum','plan','rng_unchanged'].sort());
  assert.deepEqual(egg.eggs,[]);
  assert.deepEqual(egg.settings,{enabled:false,targetCount:50,gachaType:1,perVoucher:{0:true,1:true,2:true,3:false}});
  assert.deepEqual(egg.vouchers,{0:0,1:0,2:0,3:0});
  assert.equal(egg.maximum,10000);
  assert.deepEqual(egg.plan,{purchases:[],eggsAfter:0});
  assert.equal(egg.rng_unchanged,true);
  assert.equal(data.schema_version, 1);
  assert.equal(data.source_sha, '399d5d368f0b5642ebf8f45bd8a5e73350fa4de7');
  assert.equal(data.scope, 'actual initialized validateAchv/validateAchvs and Egg/reward descendants; no battle win or hatching claim');
  const multiplier = { youngster: 1, ace: 1.5, elite: 2, hell: 3 }[data.difficulty];
  assert(multiplier != null);
  assert(Array.isArray(data.team) && data.team.length === 1);
  assert.deepEqual(data.team, [{ species: 1, root: 1 }]);
  assert.deepEqual(data.definitions.map(row => row.key), keys);
  const recipes = [10, 20, 30, null, 10];
  data.definitions.forEach((row, index) => {
    assert.equal(row.id, row.key);
    assert.equal(row.voucher, false);
    if (index === 3) assert.deepEqual(row.recipe, [
      { kind: 'eggs', tier: 1, count: 1 }, { kind: 'candyTeam', perMon: 10 },
    ]);
    else assert.deepEqual(row.recipe, { kind: 'candyTeam', perMon: recipes[index] });
    if (index !== 4) assert.deepEqual(row.effects, []);
  });
  assert.deepEqual(data.cases.map(row => row.name), expectedNames);
  let previous;
  for (let index = 0; index < data.cases.length; index++) {
    const row = data.cases[index];
    if (previous) assert.deepEqual(row.before, previous);
    previous = row.after;
    assert.equal(row.battle_rng_unchanged, true);
    assert.deepEqual(row.after.same_species_counters,row.before.same_species_counters);
    if(index !== 5) assert.deepEqual(row.after.unlock_pity,row.before.unlock_pity);
    assert.deepEqual(row.after.voucher_unlocks, row.before.voucher_unlocks);
    assert.deepEqual(row.after.voucher_counts, row.before.voucher_counts);
    assert(row.random_values.every(value => Number.isFinite(value) && value >= 0 && value < 1));
    assert(row.clock_values.every(value => integer(value) && Math.abs(value) <= 8640000000000000));
    assert(row.seeded_draws.every(draw => integer(draw.min) && integer(draw.max) && integer(draw.result)
      && draw.min <= draw.result && draw.result <= draw.max));
    const key = ({ 1: keys[0], 2: keys[1], 3: keys[2], 5: keys[3], 7: keys[4] })[index];
    if (!key) {
      assert.deepEqual(row.after, row.before, 'no reached/unlocked achievement means no account mutation');
      assert.deepEqual(row.grant_calls, []);
      assert.deepEqual(row.clock_values, []);
      assert.deepEqual(row.random_values, []);
      assert.deepEqual(row.seeded_draws, []);
      assert.deepEqual(row.seed_scopes, []);
      assert.deepEqual(row.toasts, []);
      if (index === 6 || index === 8) assert.equal(row.result, false);
      continue;
    }
    assert(!Object.hasOwn(row.before.unlocks, key));
    assert(row.clock_values.length >= 1);
    assert.deepEqual(row.after.unlocks, { ...row.before.unlocks, [key]: row.clock_values[0] });
    const perMon = ({ LV_100: 10, LV_250: 20, LV_1000: 30, REALISTIC_FLASH_IS_BORING: 10, MAX_FRIENDSHIP: 10 })[key];
    const amount = Math.round(perMon * multiplier);
    assert.deepEqual(row.after.candy, row.before.candy.map(account => ({
      ...account, count: Math.min(9999, account.count + amount),
    })));
    const candies = row.grant_calls.filter(call => call.kind === 'candy');
    assert.equal(candies.length, data.team.length);
    candies.forEach((call, i) => {
      assert.deepEqual(call.args, [data.team[i].species, amount, true]);
      assert.equal(call.result, true);
    });
    if (index === 5) {
      assert.equal(row.result, true);
      assert.deepEqual(row.grant_calls.map(call => call.kind), ['egg', 'candy']);
      assert.equal(row.after.eggs.length, row.before.eggs.length + 1);
      assert.deepEqual(row.after.eggs.slice(0, -1), row.before.eggs);
      const egg = row.after.eggs.at(-1);
      assert.equal(egg.tier, 1);
      assert.deepEqual(row.before.unlock_pity,[0,0,0,0]);
      assert.equal(row.seeded_draws[0].min,0);
      assert.equal(row.seeded_draws[0].max,total-1);
      const selected=boundaries.find(entry => row.seeded_draws[0].result < entry.upper);
      assert.equal(egg.species,selected.species);
      const pity=[...row.before.unlock_pity];
      pity[1]=selected.caught || row.before.eggs.some(prior => prior.species === selected.species) ? 1 : 0;
      assert.deepEqual(row.after.unlock_pity,pity);
      const rare=row.seeded_draws[1];
      assert.equal(rare.min,0);
      assert.equal(rare.max,data.rare_move_rate-1);
      if(rare.result === 0) {
        assert.equal(row.seeded_draws.length,2);
        assert.equal(egg.egg_move,3);
      } else {
        assert.equal(row.seeded_draws.length,3);
        assert.equal(row.seeded_draws[2].min,0);
        assert.equal(row.seeded_draws[2].max,2);
        assert.equal(egg.egg_move,row.seeded_draws[2].result);
      }
      assert.equal(egg.source, 4);
      assert.equal(egg.shiny, false);
      assert.equal(egg.variant, 0);
      assert.equal(egg.hidden_ability, false);
      assert(integer(egg.species) && egg.species > 0);
      assert(integer(egg.egg_move) && egg.egg_move >= 0 && egg.egg_move <= 3);
      assert(integer(egg.hatch_waves) && egg.hatch_waves > 0);
      assert(row.clock_values.slice(1).includes(egg.timestamp));
      assert(row.random_values.length >= 25);
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const seed = row.random_values.slice(0, 24).map(value => alphabet[Math.floor(value * 62)]).join('');
      assert.equal(row.seed_scopes[0].seed, seed);
      assert.equal(row.seed_scopes[0].offset, 0);
      assert.equal(egg.id, Math.floor(row.random_values[24] * 1073741824) + 1073741824);
      assert.deepEqual(row.grant_calls[0], { kind: 'egg', id: egg.id, timestamp: egg.timestamp });
    } else {
      assert.deepEqual(row.after.eggs, row.before.eggs);
      assert(row.grant_calls.every(call => call.kind === 'candy'));
    }
    if (index === 7) {
      assert.equal(row.result, true);
      assert.equal(row.after.unlocks.MAX_FRIENDSHIP, 0);
    }
  }
}
verify(a.data);
const mutations = [
  data => data.fresh_egg_selection.unlock_pity[1] = 9,
  data => data.rare_pool[0].divisor = 0,
  data => data.rare_pool.reverse(),
  data => data.rare_move_rate += 1,
  data => data.fresh_egg_account.settings.enabled = true,
  data => data.fresh_egg_account.eggs = [{}],
  data => data.fresh_egg_account.plan.eggsAfter = 1,
  data => data.cases[8].result = true,
  data => data.cases[8].after.unlocks.MAX_FRIENDSHIP = 1,
  data => data.cases[5].after.eggs = [],
  data => data.cases[5].after.eggs[0].source = 0,
  data => data.cases[5].random_values[0] = 1,
  data => data.cases[5].battle_rng_unchanged = false,
  data => data.cases[5].grant_calls.reverse(),
  data => data.definitions[1].recipe.perMon = 10,
  data => data.cases[1].after.candy[0].count++,
];
for (const mutate of mutations) {
  const changed = structuredClone(a.data);
  mutate(changed);
  assert.throws(() => verify(changed));
}
const result = { schema_version: 1, status: 'passed', source_sha: a.data.source_sha,
  exports: [a.fact, b.fact], identical_fresh_processes: 2, cases: expectedNames,
  negative_checks: mutations.length, zero_timestamp_repeat_is_noop: true,
  fresh_egg_account:a.data.fresh_egg_account,
  fresh_egg_selection:a.data.fresh_egg_selection, rare_pool_rows:a.data.rare_pool.length, rare_move_rate:a.data.rare_move_rate,
  flash: { egg: a.data.cases[5].after.eggs.at(-1), clock_values: a.data.cases[5].clock_values,
    random_values: a.data.cases[5].random_values, seeded_draws: a.data.cases[5].seeded_draws,
    seed_scopes: a.data.cases[5].seed_scopes, grant_calls: a.data.cases[5].grant_calls },
};
const bytes = Buffer.from(JSON.stringify(result) + '\n');
assert(bytes.length <= 8192);
writeFileSync(output, bytes, { flag: 'wx' });
