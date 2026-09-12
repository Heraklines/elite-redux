import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(process.argv.length,5);
const hash=b=>createHash('sha256').update(b).digest('hex');
const raws=process.argv.slice(2,4).map(p=>{const s=lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink()&&s.size<=32768);return readFileSync(p);});
assert(raws[0].equals(raws[1]));
const data=JSON.parse(raws[0]);
const integer=(n,min,max)=>assert(Number.isSafeInteger(n)&&n>=min&&n<=max);
const shape=(v,k)=>assert.deepEqual(Object.keys(v).sort(),[...k].sort());
function exactJsonArg(value,depth=0){
  assert(depth<=4);
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){assert(Number.isFinite(value));return;}
  if(typeof value==='string'){assert(value.length<=256);return;}
  if(Array.isArray(value)){assert(value.length<=16);for(let i=0;i<value.length;i++){assert(Object.hasOwn(value,i));exactJsonArg(value[i],depth+1);}return;}
  assert(typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  const keys=Reflect.ownKeys(value);assert(keys.length<=16);
  for(const key of keys){assert(typeof key==='string'&&key.length<=128);exactJsonArg(value[key],depth+1);}
}
function validate(d){
  shape(d,['schema_version','source_sha','setup_seed','scope','context','catalog','predicate_draws','option_count','free_picks','rng','regeneration_draws','count_draws','option_draws','options','identities','generator_calls','direct_next_battle']);
  const next=d.direct_next_battle;
  shape(next,['scope','pre','post','trace','draws','queued','level_calls']);
  assert.equal(next.scope,'direct actual scene.newBattle after initialized wave1; no victory or reward application and no queued phase execution');
  for(const [state,wave] of [[next.pre,1],[next.post,2]]){
    shape(state,['wave','turn','seed','wave_seed','battle_seed','format','enemy_levels','rng','party']);
    assert.equal(state.wave,wave);integer(state.turn,1,10000);assert.equal(state.seed,d.context.constructor.seed);
    assert(typeof state.wave_seed==='string'&&state.wave_seed.length<=128);
    assert(typeof state.battle_seed==='string'&&state.battle_seed.length===16);
    assert(typeof state.rng==='string'&&state.rng.startsWith('!rnd,')&&state.rng.length<=512);
    assert(state.enemy_levels.length>=1&&state.enemy_levels.length<=3);state.enemy_levels.forEach(n=>integer(n,1,10000));
    exactJsonArg(state.format);assert.equal(state.party.length,1);
    for(const p of state.party){assert.equal(p.species,1);integer(p.id,0,Number.MAX_SAFE_INTEGER);integer(p.level,1,10000);integer(p.hp,0,p.max_hp);assert(p.moves.length<=4);for(const m of p.moves){integer(m.id,1,100000);integer(m.pp_used,0,10000);}assert(p.battle_data_keys.length<=128&&p.summon_data_keys.length<=128);}
  }
  assert(next.trace.length>0&&next.trace.length<=48);
  for(const row of next.trace){shape(row,['method','entry','exit','wave_before','wave_after','draw_start','draw_end']);assert(typeof row.method==='string'&&row.method.length<=128);for(const s of [row.entry,row.exit])assert(typeof s==='string'&&s.startsWith('!rnd,')&&s.length<=512);integer(row.wave_before,1,2);integer(row.wave_after,1,2);integer(row.draw_start,0,next.draws.length);integer(row.draw_end,row.draw_start,next.draws.length);}
  for(const method of ['newBattle','getNewBattleProps','resetSeed','checkIsDouble','resolveBattleFormat','doPostBattleCleanup','getLevelForWave'])assert(next.trace.some(row=>row.method===method));
  assert.equal(next.trace[0].method,'newBattle');assert.equal(next.trace[0].entry,next.pre.rng);assert.equal(next.trace[0].exit,next.post.rng);
  assert(next.draws.length>0&&next.draws.length<=128);
  for(const [kind,min,max,result] of next.draws){if(kind==='frac'){assert.equal(min,null);assert.equal(max,null);assert(Number.isFinite(result)&&result>=0&&result<1);}else{assert.equal(kind,'integerInRange');integer(min,-2147483648,2147483647);integer(max,min,2147483647);integer(result,min,max);}}
  assert(next.queued.length>0&&next.queued.length<=16);assert(next.queued.some(q=>q.name==='NextEncounterPhase'));
  for(const q of next.queued){shape(q,['method','name','args']);assert(['pushNew','unshiftNew'].includes(q.method));assert(typeof q.name==='string'&&q.name.length<=128);exactJsonArg(q.args);}
  assert.equal(next.level_calls.length,next.post.enemy_levels.length);
  for(const call of next.level_calls){shape(call,['wave','level','battle_seed']);assert.equal(call.wave,2);assert.equal(call.battle_seed,next.post.battle_seed);assert(next.post.enemy_levels.includes(call.level));}
  assert.equal(d.schema_version,1);assert.equal(d.source_sha,'399d5d368f0b5642ebf8f45bd8a5e73350fa4de7');
  assert.equal(d.setup_seed,'m9e-reward-selection-source-v1');
  assert.equal(d.scope,'actual initialized pool predicates and direct SelectModifierPhase generation methods; not a post-victory state or applied reward');
  assert.equal(d.context.wave,1);assert.equal(d.context.party.length,1);assert.equal(d.context.party[0].species,1);
  shape(d.context.balls,["counts","maximum_per_type"]);
  assert.equal(d.context.balls.maximum_per_type,99);
  assert.deepEqual(d.context.balls.counts,{0:5,1:0,2:0,3:0,4:0});
  shape(d.context.constructor,['seed','wave_seed','battle_seed','enemy_levels','level_calls','tuning']);
  shape(d.context.constructor.tuning,['wave_slope','quad_divisor','boss_mult']);
  for(const value of Object.values(d.context.constructor.tuning))assert(Number.isFinite(value)&&value>0&&value<=1000000);
  // Actual getTestRunStarters setup in test/utils/game-manager-utils.ts owns this run seed.
  assert.equal(d.context.constructor.seed,'test');
  assert(typeof d.context.constructor.wave_seed==='string'&&d.context.constructor.wave_seed.length<=128);
  assert(typeof d.context.constructor.battle_seed==='string'&&d.context.constructor.battle_seed.length===16);
  assert(Array.isArray(d.context.constructor.enemy_levels)&&d.context.constructor.enemy_levels.length===1);
  for(const level of d.context.constructor.enemy_levels)integer(level,1,10000);
  assert(Array.isArray(d.context.constructor.level_calls)&&d.context.constructor.level_calls.length>0&&d.context.constructor.level_calls.length<=4);
  for(const call of d.context.constructor.level_calls){
    shape(call,['wave','battle_seed','entry','exit','level']);assert.equal(call.wave,d.context.wave);
    assert.equal(call.battle_seed,d.context.constructor.battle_seed);integer(call.level,1,10000);
    assert(d.context.constructor.enemy_levels.includes(call.level));
    for(const state of [call.entry,call.exit])assert(typeof state==='string'&&state.startsWith('!rnd,')&&state.length<=512);
  }
  assert(Array.isArray(d.identities)&&d.identities.length===3);
  for(const identity of d.identities){shape(identity,['name','group']);assert(typeof identity.name==='string'&&identity.name.length<=256);assert(identity.group===null||(typeof identity.group==='string'&&identity.group.length<=128));}
  assert.equal(d.option_count,3);assert.equal(d.free_picks,1);
  assert(Array.isArray(d.catalog)&&d.catalog.length>0&&d.catalog.length<=1024);
  const seen=new Set(),last=new Map();
  for(const r of d.catalog){
    assert(Array.isArray(r)&&r.length===11);integer(r[0],0,4);integer(r[1],0,1023);
    assert.equal(r[1],(last.get(r[0])??-1)+1);last.set(r[0],r[1]);
    assert(!seen.has(`${r[0]}/${r[1]}`));seen.add(`${r[0]}/${r[1]}`);
    assert(typeof r[2]==='string'&&/^[A-Z0-9_]{1,128}$/.test(r[2]));
    assert(typeof r[3]==='string'&&/^(?:[A-Za-z_$][A-Za-z0-9_$]{0,127})?$/.test(r[3]));
    assert.equal(typeof r[4],'boolean');assert.equal(typeof r[5],'boolean');
    assert(Number.isFinite(r[6])&&r[6]>=0&&r[6]<=1000000000);
    assert.equal(typeof r[7],'boolean');
    assert(Number.isFinite(r[8])&&r[8]>=0&&r[8]<=1000000000);
    assert(typeof r[9]==='string'&&r[9].length<=256);
    assert(r[10]===null||(typeof r[10]==='string'&&r[10].length<=128));
  }
  for(const key of ['predicate_draws','regeneration_draws','count_draws','option_draws']){
    assert(Array.isArray(d[key])&&d[key].length<=1024);
    for(const r of d[key]){assert(Array.isArray(r)&&r.length===3);integer(r[0],-2147483648,2147483647);integer(r[1],r[0],2147483647);integer(r[2],r[0],r[1]);}
  }
  shape(d.rng,['seed','regenerated','generated']);for(const r of Object.values(d.rng))assert(typeof r==='string'&&r.length<=512&&r.length>0);
  assert.deepEqual(d.count_draws,[]);
  assert(Array.isArray(d.generator_calls)&&d.generator_calls.length>0&&d.generator_calls.length<=128);
  for(const call of d.generator_calls){
    shape(call,['stage','tier','index','id','draws','result']);
    assert(['regeneration','selection','catalog'].includes(call.stage));integer(call.tier,0,4);integer(call.index,0,1023);
    const source=d.catalog.find(row=>row[0]===call.tier&&row[1]===call.index);
    assert(source&&source[4]&&source[2]===call.id);
    assert(Array.isArray(call.draws)&&call.draws.length<=1024);
    for(const draw of call.draws){assert(Array.isArray(draw)&&draw.length===3);integer(draw[0],-2147483648,2147483647);integer(draw[1],draw[0],2147483647);integer(draw[2],draw[0],draw[1]);}
    if(call.result!==null){
      shape(call.result,['id','name','group','pregen_args']);assert.equal(call.result.id,call.id);
      assert(typeof call.result.name==='string'&&call.result.name.length<=256);
      assert(call.result.group===null||(typeof call.result.group==='string'&&call.result.group.length<=128));
      if(call.result.pregen_args!==null){assert(Array.isArray(call.result.pregen_args)&&call.result.pregen_args.length<=16);exactJsonArg(call.result.pregen_args);}
    }
  }
  const regenerated=d.generator_calls.filter(call=>call.stage==='regeneration');
  assert.equal(regenerated.length,d.catalog.filter(row=>row[4]).length);
  assert.equal(new Set(regenerated.map(call=>`${call.tier}/${call.index}`)).size,regenerated.length);
  assert(Array.isArray(d.options)&&d.options.length===3);
  for(const o of d.options){
    const required=['id','tier','upgradeCount','cost'];shape(o,o.pregenArgs===undefined?required:[...required,'pregenArgs']);
    assert(typeof o.id==='string'&&o.id.length>0&&o.id.length<=128);integer(o.tier,0,4);integer(o.upgradeCount,0,10);
    assert(Number.isFinite(o.cost)&&o.cost>=0&&o.cost<=1000000000);
    if(o.pregenArgs!==undefined){assert(Array.isArray(o.pregenArgs)&&o.pregenArgs.length<=16);for(const n of o.pregenArgs)assert(Number.isFinite(n));}
  }
}
validate(data);
const mutations=[d=>d.option_count=2,d=>d.free_picks=2,d=>d.catalog[0][1]=99,d=>d.catalog[0][6]=-1,
 d=>d.options.pop(),d=>d.count_draws=[[0,1,1]],d=>d.source_sha='bad',
 d=>d.direct_next_battle.post.wave=3,d=>d.direct_next_battle.trace=[],d=>d.direct_next_battle.queued=[],d=>d.direct_next_battle.level_calls[0].battle_seed='wrong'];
for(const change of mutations){const m=structuredClone(data);change(m);assert.throws(()=>validate(m));}
const summary={schema_version:1,status:'passed',source_sha:data.source_sha,scope:data.scope,
 exports:raws.map(r=>({bytes:r.length,sha256:hash(r)})),identical_fresh_processes:2,negative_checks:mutations.length,
 catalog_rows:data.catalog.length,catalog_sha256:hash(Buffer.from(JSON.stringify(data.catalog))),
 constructor_observation_passed:true,setup_seed:data.setup_seed,context:data.context,option_count:data.option_count,free_picks:data.free_picks,options:data.options,identities:data.identities,generator_observation:{calls:data.generator_calls.length,sha256:hash(Buffer.from(JSON.stringify(data.generator_calls))),by_stage:Object.fromEntries(['regeneration','selection','catalog'].map(stage=>[stage,data.generator_calls.filter(call=>call.stage===stage).length]))},
 draw_counts:Object.fromEntries(['predicate_draws','regeneration_draws','count_draws','option_draws'].map(k=>[k,data[k].length])),rng:data.rng};
summary.direct_next_battle={scope:data.direct_next_battle.scope,pre:data.direct_next_battle.pre,post:data.direct_next_battle.post,
 trace_methods:data.direct_next_battle.trace.map(row=>row.method),trace_sha256:hash(Buffer.from(JSON.stringify(data.direct_next_battle.trace))),
 draw_count:data.direct_next_battle.draws.length,draw_sha256:hash(Buffer.from(JSON.stringify(data.direct_next_battle.draws))),
 queued:data.direct_next_battle.queued,level_calls:data.direct_next_battle.level_calls};
const out=Buffer.from(JSON.stringify(summary)+'\n');assert(out.length<=8192);writeFileSync(process.argv[4],out,{flag:'wx'});
