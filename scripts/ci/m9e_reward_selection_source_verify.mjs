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
function validateBinder(b){
  shape(b,['party','mode','unlocks','rare_candy_friendship']);assert(Number.isFinite(b.rare_candy_friendship)&&b.rare_candy_friendship>=0&&b.rare_candy_friendship<=255);assert(Array.isArray(b.party)&&b.party.length===1);
  shape(b.mode,['classic','daily','fun','coop','spliced_only','fresh_start','challenges','fun_mega']);
  for(const [key,value] of Object.entries(b.mode))if(key!=='challenges')assert.equal(typeof value,'boolean');
  assert.equal(b.mode.classic,true);for(const key of ['daily','fun','coop','spliced_only','fresh_start'])assert.equal(b.mode[key],false);
  assert(Array.isArray(b.mode.challenges)&&b.mode.challenges.length<=32);
  for(const c of b.mode.challenges){shape(c,['id','value']);integer(c.id,0,100000);integer(c.value,0,100000);}
  shape(b.unlocks,['eviolite','mini_black_hole']);for(const v of Object.values(b.unlocks))assert.equal(typeof v,'boolean');
  const functionFact=v=>{if(v===null)return;shape(v,['bytes','sha256']);integer(v.bytes,1,16384);assert(/^[0-9a-f]{64}$/.test(v.sha256));};
  for(const p of b.party){
    shape(p,['species','form','form_key','level_cap','level_rows','all_level_rows_count','all_level_rows_sha256','live_move_ids','move_closure','evolutions','forms','held','learnable_now','tm']);
    assert.equal(p.species,1);integer(p.form,0,255);assert(typeof p.form_key==='string'&&p.form_key.length<=128);assert.equal(p.level_cap,10);
    integer(p.all_level_rows_count,0,256);assert(/^[0-9a-f]{64}$/.test(p.all_level_rows_sha256));
    assert(Array.isArray(p.level_rows)&&p.level_rows.length<=64&&p.level_rows.length<=p.all_level_rows_count);
    for(const row of p.level_rows){assert(Array.isArray(row)&&row.length===2);integer(row[0],1,10);integer(row[1],1,100000);}
    for(const key of ['live_move_ids','learnable_now']){assert(Array.isArray(p[key])&&p[key].length<=(key==='live_move_ids'?4:256));for(const id of p[key])integer(id,1,100000);}
        shape(p.tm,['compatible','available','used','omniform','max_moves']);assert.equal(typeof p.tm.omniform,'boolean');integer(p.tm.max_moves,1,32);
    for(const k of ['compatible','available']){assert(Array.isArray(p.tm[k])&&p.tm[k].length<=512);for(const id of p.tm[k])integer(id,0,100000);}
    const expectedTm=[...new Set(p.tm.compatible.filter(id=>id!==0&&!p.live_move_ids.includes(id)))];assert.deepEqual(p.tm.available,expectedTm);
    shape(p.tm.used,['own','defined','value']);assert.equal(typeof p.tm.used.own,'boolean');assert.equal(typeof p.tm.used.defined,'boolean');
    if(!p.tm.used.defined)assert.equal(p.tm.used.value,null);
    if(p.tm.used.value!==null){assert(Array.isArray(p.tm.used.value)&&p.tm.used.value.length<=512);for(const id of p.tm.used.value)integer(id,1,100000);}
    assert(Buffer.byteLength(JSON.stringify(p.tm))<=4000);
    const expected=[...new Set([...p.live_move_ids,...p.level_rows.map(r=>r[1])])];
    assert(Array.isArray(p.move_closure)&&p.move_closure.length<=32);assert.deepEqual(p.move_closure.map(m=>m.id),expected);
    for(const m of p.move_closure){
      shape(m,['id','type','category','accuracy','pp','sound','attack','attrs','variable_types']);
      integer(m.id,1,100000);integer(m.type,0,18);integer(m.category,0,2);integer(m.accuracy,-1,100);integer(m.pp,1,100);
      assert.equal(typeof m.sound,'boolean');assert.equal(typeof m.attack,'boolean');assert(Array.isArray(m.attrs)&&m.attrs.length<=32);
      for(const a of m.attrs)assert(typeof a==='string'&&a.length<=128);
      assert(Array.isArray(m.variable_types)&&m.variable_types.length<=16);
      for(const a of m.variable_types){shape(a,['class_name','types']);assert(m.attrs.includes(a.class_name));assert(Array.isArray(a.types)&&a.types.length<=19);for(const type of a.types)integer(type,0,18);}
    }
    for(const key of ['evolutions','forms']){shape(p[key],['present','rows']);assert.equal(typeof p[key].present,'boolean');assert(Array.isArray(p[key].rows)&&p[key].rows.length<=16);if(!p[key].present)assert.equal(p[key].rows.length,0);}
    for(const e of p.evolutions.rows){
      shape(e,['species','pre_form','evo_form','level','item','conditions','level_threshold']);integer(e.species,1,100000);integer(e.level,0,10000);if(e.item!==null)integer(e.item,0,100000);
      for(const key of ['pre_form','evo_form'])assert(e[key]===null||(typeof e[key]==='string'&&e[key].length<=128));
      exactJsonArg(e.conditions);exactJsonArg(e.level_threshold);
    }
    for(const f of p.forms.rows){
      shape(f,['species','pre_form','form','root_trigger_class','item_trigger','conditions']);assert.equal(f.species,p.species);
      for(const key of ['pre_form','form','root_trigger_class'])assert(typeof f[key]==='string'&&f[key].length<=128);
      if(f.item_trigger!==null){shape(f.item_trigger,['identity','item','active']);integer(f.item_trigger.identity,0,255);integer(f.item_trigger.item,0,100000);assert.equal(typeof f.item_trigger.active,'boolean');}
      assert(Array.isArray(f.conditions)&&f.conditions.length<=16);for(const c of f.conditions){shape(c,['class_name','predicate','enforce']);assert(typeof c.class_name==='string'&&c.class_name.length<=128);functionFact(c.predicate);functionFact(c.enforce);}
    }
    assert(Array.isArray(p.held)&&p.held.length<=64);for(const h of p.held){shape(h,['id','class_name','stack']);assert(typeof h.id==='string'&&h.id.length<=128);assert(typeof h.class_name==='string'&&h.class_name.length<=128);integer(h.stack,1,100000);}
  }
}
function validateMoveInputs(e){
 const m=e.move_inputs;shape(m,['scope','battle_rng_calls','calls','tuning']);assert.equal(m.scope,'actual single wild enemy generator calls and complete returned level registry; no all-species or natural encounter closure');assert.equal(m.battle_rng_calls,0);
 assert(Array.isArray(m.tuning)&&m.tuning.length===6);for(const n of m.tuning)assert(Number.isFinite(n)&&n>0&&n<=1000);
 assert(Array.isArray(m.calls)&&m.calls.length===1);const c=m.calls[0];shape(c,['species','form','level','boss','trainer','rival','entry','exit','start','end','level_rows','registry','powers','stats','moves']);
 for(const k of ['species','form','level'])assert.equal(c[k],e.constructed[0][k]);for(const k of ['boss','trainer','rival'])assert.equal(c[k],false);
 for(const k of ['entry','exit'])assert(typeof c[k]==='string'&&c[k].startsWith('!rnd,')&&c[k].length<=256);
 const t=e.trace.find(t=>t.method==='addEnemyPokemon');integer(c.start,t.start,t.end);integer(c.end,c.start,t.end);
 assert(Array.isArray(c.level_rows)&&c.level_rows.length>0&&c.level_rows.length<=64);for(const r of c.level_rows){assert(Array.isArray(r)&&r.length===2);integer(r[0],-2,10000);integer(r[1],1,100000);}
 assert(Array.isArray(c.registry)&&c.registry.length<=64);assert.deepEqual(c.registry.map(r=>r[0]),[...new Set(c.level_rows.map(r=>r[1]))]);
 for(const r of c.registry){assert(Array.isArray(r)&&r.length===5);integer(r[1],0,2);assert(Number.isFinite(r[2])&&r[2]>=-1&&r[2]<=10000);assert.equal(typeof r[3],'boolean');integer(r[4],0,31);}
 for(const key of ['powers','stats']){assert(Array.isArray(c[key])&&c[key].length>0&&c[key].length<=64);for(const r of c[key]){assert(Array.isArray(r)&&r.length===2);assert(Number.isFinite(r[1])&&r[1]>=0&&r[1]<=10000000);if(key==='powers')assert(c.registry.some(m=>m[0]===r[0]));else integer(r[0],0,5);}}
 assert.deepEqual(c.moves,e.constructed[0].moves.map(m=>m.id));assert(c.moves.every(id=>c.registry.some(r=>r[0]===id)));
 assert(Buffer.byteLength(JSON.stringify(m))<=2400);
}
function validateTownPool(p,e){
 shape(p,['scope','wave','level','adjusted_wave','difficulty','vanilla','time_of_day','luck','forced_tier','regional_boost','tiers','rows']);
 assert.equal(p.scope,'complete effective Town rarity pools and pre-substitution weights/gates; no wild level-substitution or moveset closure');
 assert.equal(p.wave,2);assert.equal(p.level,e.constructed[0].level);integer(p.adjusted_wave,1,100000);
 assert(['youngster','ace','elite','hell','mystery'].includes(p.difficulty));assert.equal(p.vanilla,['youngster','ace'].includes(p.difficulty));
 integer(p.time_of_day,0,12);assert(Number.isFinite(p.luck)&&p.luck>=0&&p.luck<=100);if(p.forced_tier!==null)integer(p.forced_tier,0,12);if(p.regional_boost!==null)assert.equal(typeof p.regional_boost,'boolean');
 assert(Array.isArray(p.tiers)&&p.tiers.length>0&&p.tiers.length<=12);const ids=[];let previous=-1;
 for(const row of p.tiers){assert(Array.isArray(row)&&row.length===2);integer(row[0],0,12);assert(row[0]>previous);previous=row[0];assert(Array.isArray(row[1])&&row[1].length<=128);for(const id of row[1]){integer(id,1,100000);if(!ids.includes(id))ids.push(id);}}
 assert(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=128);assert.deepEqual(p.rows.map(r=>r[0]),ids);
 for(const row of p.rows){assert(Array.isArray(row)&&row.length===5);const [id,weight,bst,flags,gated]=row;assert(Number.isFinite(weight)&&weight>0);integer(bst,0,10000);integer(flags,0,15);assert.equal(typeof gated,'boolean');
 const expected=((p.vanilla||p.difficulty==='elite')&&p.adjusted_wave<55&&bst>=600)||(id===292&&p.adjusted_wave<55)||((flags&7)!==0&&p.adjusted_wave<Math.min(90,Math.max(55,Math.round(55+(bst-540)*0.25))));assert.equal(gated,expected);}
 assert(Buffer.byteLength(JSON.stringify(p))<=3000);
 assert(Array.isArray(e.unwrapped)&&e.unwrapped.length>0&&e.unwrapped.length<=16);previous=-1;
 for(const r of e.unwrapped){shape(r,['index','frames']);integer(r.index,0,e.draws.length-1);assert(r.index>previous);previous=r.index;assert(!e.trace.some(t=>r.index>=t.start&&r.index<t.end));assert(Array.isArray(r.frames)&&r.frames.length>0&&r.frames.length<=3);for(const f of r.frames)assert(typeof f==='string'&&f.length<=192&&/^src\/[^\r\n]*:\d+:\d+$/.test(f)&&!f.includes('..'));}
 for(let i=0;i<e.draws.length;i++)if(e.draws[i][0]==='integerInRange'&&!e.trace.some(t=>i>=t.start&&i<t.end))assert(e.unwrapped.some(r=>r.index===i));
 assert(Buffer.byteLength(JSON.stringify(e.unwrapped))<=1000);assert(Array.isArray(e.boss_calls)&&e.boss_calls.length>0&&e.boss_calls.length<=8);for(const r of e.boss_calls){assert(Array.isArray(r)&&r.length===3);assert.equal(r[0],p.wave);assert.equal(r[1],p.level);integer(r[2],0,100);}
}
function validateEncounter(e){
 shape(e,['move_inputs','pool','unwrapped','boss_calls','scope','wave','turn','prior','selected','restored_same_standby','before','after','draws','trace','constructed','prepared','modifiers','init_encounter_queued']);
 assert.equal(e.scope,'direct dispatch of exact queued NextEncounterPhase via overridePhase; original CommandPhase restored as standby; no natural victory or queued successor execution');
 assert.equal(e.wave,2);assert.equal(e.turn,1);assert.equal(e.prior,'CommandPhase');assert.equal(e.selected,'NextEncounterPhase');
 assert.equal(e.restored_same_standby,true);assert.equal(e.init_encounter_queued,true);
 for(const s of [e.before,e.after])assert(typeof s==='string'&&s.startsWith('!rnd,')&&s.length<=256);
 assert(Array.isArray(e.draws)&&e.draws.length>0&&e.draws.length<=256);
 for(const r of e.draws){assert(Array.isArray(r));if(r[0]==='frac'){assert.equal(r.length,2);assert(Number.isFinite(r[1])&&r[1]>=0&&r[1]<1);}else{assert.equal(r[0],'integerInRange');assert.equal(r.length,4);for(const n of r.slice(1))assert(Number.isSafeInteger(n));assert(r[1]<=r[3]&&r[3]<=r[2]);}}
 assert(Array.isArray(e.trace)&&e.trace.length<=16);
 for(const r of e.trace){shape(r,['method','start','end','entry','exit']);assert(['randomSpecies','addEnemyPokemon','generateEnemyModifiers','resetSeed'].includes(r.method));integer(r.start,0,e.draws.length);integer(r.end,r.start,e.draws.length);for(const s of [r.entry,r.exit])assert(typeof s==='string'&&s.startsWith('!rnd,')&&s.length<=256);}
 assert.equal(e.trace.filter(r=>r.method==='randomSpecies').length,1);assert.equal(e.trace.filter(r=>r.method==='addEnemyPokemon').length,1);assert.equal(e.trace.filter(r=>r.method==='generateEnemyModifiers').length,1);
 for(const list of [e.constructed,e.prepared]){assert(Array.isArray(list)&&list.length===1);for(const p of list){
  shape(p,['id','species','form','level','nature','ability_index','ability','passives','passive_active','ivs','stats','hp','gender','shiny','variant','moves','boss','temp_turn_count','temp_wave_turn_count']);
  integer(p.temp_turn_count,0,100000);integer(p.temp_wave_turn_count,0,100000);integer(p.id,0,4294967295);integer(p.species,1,100000);integer(p.form,0,255);integer(p.level,1,10000);integer(p.nature,0,24);integer(p.ability_index,0,255);integer(p.ability,0,100000);
  assert(Array.isArray(p.passives)&&p.passives.length<=3);for(const a of p.passives)if(a!==null)integer(a,0,100000);
  for(const k of ['passive_active','shiny','boss'])assert.equal(typeof p[k],'boolean');integer(p.gender,0,2);integer(p.variant,0,2);
  assert(Array.isArray(p.ivs)&&p.ivs.length===6);for(const n of p.ivs)integer(n,0,31);assert(Array.isArray(p.stats)&&p.stats.length===6);for(const n of p.stats)integer(n,1,10000000);integer(p.hp,0,p.stats[0]);
  assert(Array.isArray(p.moves)&&p.moves.length>0&&p.moves.length<=5);for(const m of p.moves){shape(m,['id','pp_used']);integer(m.id,1,100000);integer(m.pp_used,0,100);}
 }}
 assert.equal(e.constructed[0].id,e.prepared[0].id);assert.equal(e.constructed[0].species,e.prepared[0].species);
 assert(Array.isArray(e.modifiers)&&e.modifiers.length<=32);for(const m of e.modifiers){shape(m,['id','class_name','stack']);for(const k of ['id','class_name'])assert(typeof m[k]==='string'&&m[k].length<=128);integer(m.stack,1,10000);}
 assert(Buffer.byteLength(JSON.stringify(e))<=7500);
}
function validate(d){
  validateBinder(d.binder);validateEncounter(d.direct_queued_encounter);validateTownPool(d.direct_queued_encounter.pool,d.direct_queued_encounter);validateMoveInputs(d.direct_queued_encounter);
  assert.equal(d.direct_queued_encounter.before,d.direct_next_battle.post.rng);
  assert.deepEqual(d.direct_queued_encounter.constructed.map(p=>p.level),d.direct_next_battle.post.enemy_levels);
  shape(d,['schema_version','source_sha','setup_seed','scope','binder','context','catalog','predicate_draws','option_count','free_picks','rng','regeneration_draws','count_draws','option_draws','options','identities','generator_calls','direct_next_battle','direct_queued_encounter']);
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
    const format=state.format;
    shape(format,['id','sides','localPlayerSide','adjacency']);assert(typeof format.id==='string'&&format.id.length<=128);
    assert(Array.isArray(format.sides)&&format.sides.length>0&&format.sides.length<=4);
    integer(format.localPlayerSide,0,format.sides.length-1);
    const slots=[];
    for(const side of format.sides){shape(side,['baseIndex','capacity','kind','mirrored']);integer(side.baseIndex,0,255);integer(side.capacity,1,6);integer(side.kind,0,8);assert.equal(typeof side.mirrored,'boolean');for(let offset=0;offset<side.capacity;offset++)slots.push(side.baseIndex+offset);}
    assert(slots.length<=16&&new Set(slots).size===slots.length);
    shape(format.adjacency,['slots','rows']);assert.deepEqual(format.adjacency.slots,slots);
    assert.equal(format.adjacency.rows.length,slots.length*slots.length);
    let rowIndex=0;
    for(const from of slots)for(const to of slots){const row=format.adjacency.rows[rowIndex++];assert(Array.isArray(row)&&row.length===3);assert.equal(row[0],from);assert.equal(row[1],to);assert.equal(typeof row[2],'boolean');}
    assert.equal(state.party.length,1);
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
const mutations=[d=>d.direct_queued_encounter.move_inputs.battle_rng_calls=1,d=>d.direct_queued_encounter.move_inputs.calls[0].registry.pop(),d=>d.direct_queued_encounter.move_inputs.calls[0].species+=1,d=>d.direct_queued_encounter.move_inputs.calls[0].moves=[],d=>d.direct_queued_encounter.move_inputs.calls[0].trainer=true,d=>d.direct_queued_encounter.pool.rows.pop(),d=>d.direct_queued_encounter.pool.rows[0][4]=!d.direct_queued_encounter.pool.rows[0][4],d=>d.direct_queued_encounter.pool.rows[0][1]=0,d=>d.direct_queued_encounter.pool.difficulty="unknown",d=>d.direct_queued_encounter.unwrapped=[],d=>d.direct_queued_encounter.unwrapped[0].frames=["C:/secret.ts:1:1"],d=>d.binder.party[0].tm.max_moves=0,d=>d.binder.party[0].tm.omniform="false",d=>d.binder.party[0].tm.available.push(0),d=>d.binder.rare_candy_friendship=-1,d=>d.direct_queued_encounter.before="!rnd,wrong",d=>d.direct_queued_encounter.constructed[0].level+=1,d=>d.direct_queued_encounter.restored_same_standby=false,d=>d.direct_queued_encounter.constructed=[],d=>d.direct_queued_encounter.turn=2,d=>d.binder.party[0].evolutions.rows[0].item=-1,d=>d.binder.party[0].evolutions.rows[0].item="0",d=>d.binder.party[0].level_cap=11,d=>d.binder.party[0].move_closure.pop(),d=>d.option_count=2,d=>d.free_picks=2,d=>d.catalog[0][1]=99,d=>d.catalog[0][6]=-1,
 d=>d.options.pop(),d=>d.count_draws=[[0,1,1]],d=>d.source_sha='bad',
 d=>d.direct_next_battle.post.wave=3,d=>d.direct_next_battle.trace=[],d=>d.direct_next_battle.queued=[],d=>d.direct_next_battle.level_calls[0].battle_seed='wrong',
 d=>d.direct_next_battle.post.format.adjacency={},d=>d.direct_next_battle.pre.format.adjacency.rows.pop(),
 d=>d.direct_next_battle.post.format.adjacency.rows[0][0]=255];
for(const change of mutations){const m=structuredClone(data);change(m);assert.throws(()=>validate(m));}
const summary={schema_version:1,status:'passed',source_sha:data.source_sha,scope:data.scope,
 exports:raws.map(r=>({bytes:r.length,sha256:hash(r)})),identical_fresh_processes:2,negative_checks:mutations.length,
 binder:{sha256:hash(Buffer.from(JSON.stringify(data.binder))),party:data.binder.party.map(p=>({species:p.species,form:p.form,level_cap:p.level_cap,moves:p.move_closure.length,evolutions:p.evolutions.rows.length,forms:p.forms.rows.length})),unlocks:data.binder.unlocks},
 catalog_rows:data.catalog.length,catalog_sha256:hash(Buffer.from(JSON.stringify(data.catalog))),
 constructor_observation_passed:true,setup_seed:data.setup_seed,context:data.context,option_count:data.option_count,free_picks:data.free_picks,options:data.options,identities:data.identities,generator_observation:{calls:data.generator_calls.length,sha256:hash(Buffer.from(JSON.stringify(data.generator_calls))),by_stage:Object.fromEntries(['regeneration','selection','catalog'].map(stage=>[stage,data.generator_calls.filter(call=>call.stage===stage).length]))},
 draw_counts:Object.fromEntries(['predicate_draws','regeneration_draws','count_draws','option_draws'].map(k=>[k,data[k].length])),rng:data.rng};
summary.direct_next_battle={scope:data.direct_next_battle.scope,pre:data.direct_next_battle.pre,post:data.direct_next_battle.post,
 trace_methods:data.direct_next_battle.trace.map(row=>row.method),trace_sha256:hash(Buffer.from(JSON.stringify(data.direct_next_battle.trace))),
 draw_count:data.direct_next_battle.draws.length,draw_sha256:hash(Buffer.from(JSON.stringify(data.direct_next_battle.draws))),
 queued:data.direct_next_battle.queued,level_calls:data.direct_next_battle.level_calls};
summary.direct_queued_encounter={sha256:hash(Buffer.from(JSON.stringify(data.direct_queued_encounter))),wave:data.direct_queued_encounter.wave,turn:data.direct_queued_encounter.turn,draws:data.direct_queued_encounter.draws.length,methods:data.direct_queued_encounter.trace.map(r=>r.method),species:data.direct_queued_encounter.prepared.map(p=>p.species),restored_same_standby:true,init_encounter_queued:true};
summary.town_pool={sha256:hash(Buffer.from(JSON.stringify(data.direct_queued_encounter.pool))),rows:data.direct_queued_encounter.pool.rows.length,difficulty:data.direct_queued_encounter.pool.difficulty,callers_sha256:hash(Buffer.from(JSON.stringify(data.direct_queued_encounter.unwrapped)))};
summary.move_inputs={sha256:hash(Buffer.from(JSON.stringify(data.direct_queued_encounter.move_inputs))),registry:data.direct_queued_encounter.move_inputs.calls[0].registry.length,battle_rng_calls:0};
const out=Buffer.from(JSON.stringify(summary)+'\n');assert(out.length<=8192);writeFileSync(process.argv[4],out,{flag:'wx'});
