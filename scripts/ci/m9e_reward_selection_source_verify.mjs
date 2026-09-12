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
function validate(d){
  shape(d,['schema_version','source_sha','seed','scope','context','catalog','predicate_draws','option_count','free_picks','rng','regeneration_draws','count_draws','option_draws','options']);
  assert.equal(d.schema_version,1);assert.equal(d.source_sha,'399d5d368f0b5642ebf8f45bd8a5e73350fa4de7');
  assert.equal(d.seed,'m9e-reward-selection-source-v1');
  assert.equal(d.scope,'actual initialized pool predicates and direct SelectModifierPhase generation methods; not a post-victory state or applied reward');
  assert.equal(d.context.wave,1);assert.equal(d.context.party.length,1);assert.equal(d.context.party[0].species,1);
  assert.equal(d.option_count,3);assert.equal(d.free_picks,1);
  assert(Array.isArray(d.catalog)&&d.catalog.length>0&&d.catalog.length<=1024);
  const seen=new Set(),last=new Map();
  for(const r of d.catalog){
    assert(Array.isArray(r)&&r.length===9);integer(r[0],0,4);integer(r[1],0,1023);
    assert.equal(r[1],(last.get(r[0])??-1)+1);last.set(r[0],r[1]);
    assert(!seen.has(`${r[0]}/${r[1]}`));seen.add(`${r[0]}/${r[1]}`);
    assert(typeof r[2]==='string'&&/^[A-Z0-9_]{1,128}$/.test(r[2]));
    assert(typeof r[3]==='string'&&/^(?:[A-Za-z_$][A-Za-z0-9_$]{0,127})?$/.test(r[3]));
    assert.equal(typeof r[4],'boolean');assert.equal(typeof r[5],'boolean');
    assert(Number.isFinite(r[6])&&r[6]>=0&&r[6]<=1000000000);
    assert.equal(typeof r[7],'boolean');
    assert(Number.isFinite(r[8])&&r[8]>=0&&r[8]<=1000000000);
  }
  for(const key of ['predicate_draws','regeneration_draws','count_draws','option_draws']){
    assert(Array.isArray(d[key])&&d[key].length<=1024);
    for(const r of d[key]){assert(Array.isArray(r)&&r.length===3);integer(r[0],-2147483648,2147483647);integer(r[1],r[0],2147483647);integer(r[2],r[0],r[1]);}
  }
  shape(d.rng,['seed','regenerated','generated']);for(const r of Object.values(d.rng))assert(typeof r==='string'&&r.length<=512&&r.length>0);
  assert.deepEqual(d.count_draws,[]);
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
 d=>d.options.pop(),d=>d.count_draws=[[0,1,1]],d=>d.source_sha='bad'];
for(const change of mutations){const m=structuredClone(data);change(m);assert.throws(()=>validate(m));}
const summary={schema_version:1,status:'passed',source_sha:data.source_sha,scope:data.scope,
 exports:raws.map(r=>({bytes:r.length,sha256:hash(r)})),identical_fresh_processes:2,negative_checks:mutations.length,
 catalog_rows:data.catalog.length,catalog_sha256:hash(Buffer.from(JSON.stringify(data.catalog))),
 context:data.context,option_count:data.option_count,free_picks:data.free_picks,options:data.options,
 draw_counts:Object.fromEntries(['predicate_draws','regeneration_draws','count_draws','option_draws'].map(k=>[k,data[k].length])),rng:data.rng};
const out=Buffer.from(JSON.stringify(summary)+'\n');assert(out.length<=8192);writeFileSync(process.argv[4],out,{flag:'wx'});
