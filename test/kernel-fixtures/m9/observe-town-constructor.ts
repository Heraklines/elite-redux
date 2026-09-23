import { NullifyFirstNHitsAbAttr } from "#data/elite-redux/archetypes/nullify-first-n-hits";
import { __INTERNAL_TEST_EXPORTS as movegen } from "#app/ai/ai-moveset-gen";
import { PokemonForm,PokemonSpecies } from "#data/pokemon-species";
import { allMoves,allAbilities } from "#data/data-lists";
import { pokemonEvolutions,pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { FORCED_SIGNATURE_MOVES } from "#balance/moves/signature-moves";
import { STAB_BLACKLIST,FORCED_SIGNATURE_MOVE_CHANCE,BASE_LEVEL_WEIGHT_OFFSET,BASE_WEIGHT_MULTIPLIER,EVOLUTION_MOVE_WEIGHT,RELEARN_MOVE_WEIGHT,EVO_MOVE_BP_THRESHOLD,MOVE_POWER_CEILING } from "#balance/moves/moveset-generation";
import { targetSleptOrComatoseCondition,userSleptOrComatoseCondition } from "#moves/move-condition";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { EvoLevelThresholdKind } from "#enums/evo-level-threshold-kind";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { getDailyForcedWaveBiomePoolTier } from "#data/daily-seed/daily-run";
import { getPartyLuckValue } from "#modifiers/modifier-type";
import { globalScene } from "#app/global-scene";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync } from "node:child_process";
import { writeFileSync,readFileSync,existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import Phaser from "phaser";
import { afterAll,expect,test,vi } from "vitest";
const PIN="399d5d368f0b5642ebf8f45bd8a5e73350fa4de7",SEED="m9e-reward-selection-source-v1";
const originalRegistryMethods=[PokemonForm.prototype.getLevelMoves,PokemonForm.prototype.getAbility,PokemonForm.prototype.getAbilityCount,PokemonForm.prototype.getPassiveAbilities,PokemonSpecies.prototype.getPrevolutionLevels];
const nullifyPrototype=NullifyFirstNHitsAbAttr.prototype;
const nullifyOriginals=["canApply","apply","currentUsage"].map(name=>{const descriptor=Object.getOwnPropertyDescriptor(nullifyPrototype,name);if(!descriptor||!Object.hasOwn(descriptor,"value")||typeof descriptor.value!=="function")throw new Error("Missing original Nullify source method "+name);return {name,descriptor};});
let initialAbilityCount:number|undefined,usageMethodCalls=0;const nullifyGuards:Array<[string,unknown]>=[];
function assertFreshNullifyRegistry(){expect(initialAbilityCount).toBe(0);expect(usageMethodCalls).toBe(0);for(const [name,guard] of nullifyGuards)expect(Object.getOwnPropertyDescriptor(nullifyPrototype,name)?.value).toBe(guard);expect(nullifyGuards.length).toBe(3);}
function guardFreshNullifyRegistry(){
 initialAbilityCount=allAbilities.length;expect(initialAbilityCount,"Ability registry must be empty before constructor provenance observation").toBe(0);
 for(const {name,descriptor} of nullifyOriginals){expect(Object.getOwnPropertyDescriptor(nullifyPrototype,name)?.value).toBe(descriptor.value);const guard=function(this:unknown,...args:unknown[]){usageMethodCalls++;return Reflect.apply(descriptor.value,this,args);};nullifyGuards.push([name,guard]);Object.defineProperty(nullifyPrototype,name,{...descriptor,value:guard});}
}
// Module evaluation precedes setup beforeAll -> initTests -> initializeGame.
guardFreshNullifyRegistry();
let game:Phaser.Game|undefined,manager:GameManager|undefined;
afterAll(()=>{for(const {name,descriptor} of nullifyOriginals)Object.defineProperty(nullifyPrototype,name,descriptor);vi.restoreAllMocks();manager?.promptHandler.clearPrompts();if(PromptHandler.runInterval!=null){clearInterval(PromptHandler.runInterval);PromptHandler.runInterval=undefined;}game?.destroy(true);});
async function observeTownAtActualEntry(){
 const scene=globalScene,pm=scene.phaseManager,prior=pm.getCurrentPhase();expect(prior.phaseName).toBe("CommandPhase");
 scene.newBattle();expect(scene.currentBattle.waveIndex).toBe(2);
 const selected:Array<import("#phases/next-encounter-phase").NextEncounterPhase>=[];expect(pm.tryRemovePhase("NextEncounterPhase",phase=>{selected.push(phase);return true;})).toBe(true);expect(selected.length).toBe(1);
 const actual=scene.randomSpecies;const spy=vi.spyOn(scene,"randomSpecies").mockImplementation(function(...args){
  expect(args[0]).toBe(2);expect(args[2]).toBe(true);expect(captured).toBeUndefined();expect(scene.arena.biomeId).toBe(BiomeId.TOWN);
  const prop=Object.getOwnPropertyDescriptor(scene.arena,"pokemonPool");expect(prop&&Object.hasOwn(prop,"value")).toBe(true);const pool=prop!.value as Record<string,number[]>;
  const tiers=Object.keys(pool).map(key=>{expect(/^[0-9]+$/.test(key)).toBe(true);expect(Array.isArray(pool[key])).toBe(true);return [Number(key),[...pool[key]]] as const;});
  captured=extractTown(tiers);return Reflect.apply(actual,scene,args);
 });
 try{expect(pm.overridePhase(selected[0])).toBe(true);pm.prepareCurrentPhaseForStart();selected[0].start();await vi.waitUntil(()=>pm.getCurrentPhase()===prior,{interval:10,timeout:10000});expect(captured).toBeDefined();}finally{spy.mockRestore();}
}
let captured:ReturnType<typeof extractTownStatic>|undefined;
function extractTown(tiers:readonly (readonly [number,readonly number[]])[]){
 const actual=globalScene.randBattleSeedInt;let calls=0;const spy=vi.spyOn(globalScene,"randBattleSeedInt").mockImplementation(function(...args){calls++;return Reflect.apply(actual,globalScene,args);});
 try{const result=extractTownStatic(tiers);expect(calls).toBe(0);return result;}finally{expect(calls).toBe(0);spy.mockRestore();}
}
function extractTownStatic(tiers:readonly (readonly [number,readonly number[]])[]){
 expect([PokemonForm.prototype.getLevelMoves,PokemonForm.prototype.getAbility,PokemonForm.prototype.getAbilityCount,PokemonForm.prototype.getPassiveAbilities,PokemonSpecies.prototype.getPrevolutionLevels]).toEqual(originalRegistryMethods);
 const before=Phaser.Math.RND.state();const roots=[...new Set(tiers.flatMap(r=>[...r[1]]))];expect(roots.length).toBe(54);
 const countQueue=roots.map(id=>[id,0] as const),countSeen=new Set<number>(),formCounts:Array<[number,number]>=[];
 for(let i=0;i<countQueue.length;i++){
  const [id,depth]=countQueue[i];if(countSeen.has(id))continue;expect(depth).toBeLessThanOrEqual(32);expect(countSeen.size).toBeLessThan(256);countSeen.add(id);
  const species=getPokemonSpecies(id);expect(species.getPrevolutionLevels).toBe(originalRegistryMethods[4]);formCounts.push([id,species.forms.length||1]);
  for(const e of pokemonEvolutions[id]??[])countQueue.push([e.speciesId,depth+1]);for(const row of species.getPrevolutionLevels(true))countQueue.push([row[0],depth+1]);
  if(Object.hasOwn(pokemonPrevolutions,id))countQueue.push([pokemonPrevolutions[id],depth+1]);
  for(const key of Object.keys(pokemonEvolutions))for(const e of pokemonEvolutions[Number(key)])if(e.speciesId===id)countQueue.push([Number(key),depth+1]);
 }
 const maxForms=Math.max(...formCounts.map(r=>r[1]));const countReceipt={source:PIN,scope:"complete visited Town evolution graph source form counts before payload extraction",roots:roots.length,visited:formCounts.length,max_forms:maxForms,counts:formCounts};
 const countRaw=Buffer.from(JSON.stringify(countReceipt)+"\n");expect(countRaw.length).toBeLessThanOrEqual(4096);expect(Phaser.Math.RND.state()).toBe(before);
 const countPath=process.env.M9_TOWN_CONSTRUCTOR_COUNTS;expect(countPath).toBeTruthy();if(existsSync(countPath!))expect(readFileSync(countPath!).equals(countRaw)).toBe(true);else writeFileSync(countPath!,countRaw,{flag:"wx"});
 expect(maxForms,`Source form bound20 disproved: max${maxForms}, species${formCounts.filter(r=>r[1]===maxForms).map(r=>r[0]).join(",")}; complete count receipt retained`).toBeLessThanOrEqual(20);
 const moveIds=new Set<number>(),abilityIds=new Set<number>();const speciesRows:unknown[]=[],genderRows:Array<[number,number|null]>=[],formFlags:Array<[number,number]>=[],abilitySlots:Array<[number,number[][]]>=[],formTypes:Array<[number,Array<[number,number|null,number[]]>]>=[],formStats:Array<[number,number[][]]>=[],levelTwoForms=new Map<number,number[][][]>();
 function encoder(){const functions:Array<[string,number]>=[],shapes:Array<[string|null,string[]]>=[];const intern=new Map<string,number>(),shapeIds=new Map<string,number>();
  function encode(value:unknown,depth=0,seen=new Set<object>(),path="root"):unknown{
   expect(depth).toBeLessThanOrEqual(12);
   if(value===undefined)return {u:1};if(value===null||typeof value==="boolean"||typeof value==="string"){if(typeof value==="string")expect(value.length).toBeLessThanOrEqual(1024);return value;}
   if(typeof value==="number"){if(!Number.isFinite(value))return {n:String(value)};return value;}
   if(typeof value==="function"){const text=Function.prototype.toString.call(value);expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);const hash=createHash("sha256").update(text).digest("hex");let index=intern.get(hash);if(index===undefined){index=functions.length;expect(index).toBeLessThan(512);intern.set(hash,index);functions.push([hash,Buffer.byteLength(text)]);}return {f:index};}
   expect(typeof value).toBe("object");const object=value as object;expect(seen.has(object)).toBe(false);seen.add(object);
   try{if(value instanceof Map){expect(Reflect.ownKeys(value).length).toBe(0);expect(value.size).toBeLessThanOrEqual(512);return {m:[...value].map(([k,v])=>[encode(k,depth+1,seen,path+".map-key"),encode(v,depth+1,seen,path+".map-value")])};}if(value instanceof Set){expect(Reflect.ownKeys(value).length).toBe(0);expect(value.size).toBeLessThanOrEqual(512);return {s:[...value].map(v=>encode(v,depth+1,seen,path+".set-value"))};}const exotic=value instanceof Date?"Date":value instanceof RegExp?"RegExp":value instanceof WeakMap?"WeakMap":value instanceof WeakSet?"WeakSet":ArrayBuffer.isView(value)?"ArrayBufferView":value instanceof ArrayBuffer?"ArrayBuffer":value instanceof Promise?"Promise":null;expect(exotic,`Unsupported registry internal state ${exotic} at ${path.slice(0,512)}`).toBe(null);if(Array.isArray(value)){expect(value.length).toBeLessThanOrEqual(512);expect(Reflect.ownKeys(value).length).toBe(value.length+1);return Array.from({length:value.length},(_,i)=>{const prop=Object.getOwnPropertyDescriptor(value,String(i));expect(prop&&Object.hasOwn(prop,"value")).toBe(true);return encode(prop!.value,depth+1,seen,path+"["+i+"]");});}
    const proto=Object.getPrototypeOf(object),ctor=proto===null?null:Object.getOwnPropertyDescriptor(proto,"constructor");expect(proto===null||ctor&&Object.hasOwn(ctor,"value")&&typeof ctor.value==="function").toBe(true);const keys=Reflect.ownKeys(object);expect(keys.length).toBeLessThanOrEqual(128);expect(keys.every(k=>typeof k==="string")).toBe(true);
    const shape=[ctor?.value.name??null,keys as string[]] as [string|null,string[]],shapeKey=JSON.stringify(shape);let shapeId=shapeIds.get(shapeKey);if(shapeId===undefined){shapeId=shapes.length;expect(shapeId).toBeLessThan(512);shapeIds.set(shapeKey,shapeId);shapes.push(shape);}const values=keys.map(k=>{const prop=Object.getOwnPropertyDescriptor(object,k)!;expect(Object.hasOwn(prop,"value")).toBe(true);if(proto===nullifyPrototype&&k==="usage"){assertFreshNullifyRegistry();expect(ctor?.value).toBe(NullifyFirstNHitsAbAttr);expect(initialAbilityCount).toBe(0);expect(usageMethodCalls,"Nullify usage must remain untouched since empty-registry bootstrap").toBe(0);expect(prop.value instanceof WeakMap).toBe(true);expect(Reflect.ownKeys(prop.value).length).toBe(0);return {w:0};}return encode(prop.value,depth+1,seen,path+"."+(ctor?.value.name??"null")+"."+String(k).slice(0,80));});return {o:[shapeId,values]};
   }finally{seen.delete(object);}
  }return {encode,functions,shapes};
 }
 const formData:unknown[][]=[],levelSets:unknown[][]=[];const formIds=new Map<string,number>(),levelIds=new Map<string,number>();
 function internRow(row:unknown[],rows:unknown[][],ids:Map<string,number>){const key=JSON.stringify(row);let id=ids.get(key);if(id===undefined){id=rows.length;expect(id).toBeLessThan(512);ids.set(key,id);rows.push(row);}return id;}
 const se=encoder(),me=encoder(),ae=encoder();const queue=roots.map(id=>[id,0] as const),visited=new Set<number>();
 for(let i=0;i<queue.length;i++){
  const [id,depth]=queue[i];if(visited.has(id))continue;expect(depth).toBeLessThanOrEqual(32);expect(visited.size).toBeLessThan(256);visited.add(id);
  const species=getPokemonSpecies(id);expect(species.speciesId).toBe(id);expect(species.getPrevolutionLevels).toBe(originalRegistryMethods[4]);
  expect(species.malePercent===null||(Number.isFinite(species.malePercent)&&species.malePercent>=0&&species.malePercent<=100)).toBe(true);
  genderRows.push([id,species.malePercent]);
  const evoOwn=Object.hasOwn(pokemonEvolutions,id),evolutions=evoOwn?pokemonEvolutions[id]:[];
  const preOwn=Object.hasOwn(pokemonPrevolutions,id),preValue=pokemonPrevolutions[id];
  const incoming:Array<[number,number]>=[];for(const key of Object.keys(pokemonEvolutions)){const parent=Number(key);for(const [index,e] of pokemonEvolutions[parent].entries())if(e.speciesId===id)incoming.push([parent,index]);}expect(incoming.length).toBeLessThanOrEqual(128);
  const preLevels=species.getPrevolutionLevels(true);expect(preLevels.length).toBeLessThanOrEqual(128);
  for(const e of evolutions)queue.push([e.speciesId,depth+1]);for(const row of preLevels)queue.push([row[0],depth+1]);if(preOwn){expect(Number.isSafeInteger(preValue)).toBe(true);queue.push([preValue,depth+1]);}
  for(const [parent] of incoming)queue.push([parent,depth+1]);
  const forms=species.forms.length?species.forms:[species];expect(forms.length,`species${id} forms`).toBeLessThanOrEqual(20);
  const unavailableMask=forms.reduce((mask,form,index)=>{expect(form.isUnobtainable===undefined||typeof form.isUnobtainable==="boolean").toBe(true);return mask+(form.isUnobtainable===true?2**index:0);},0);
  formFlags.push([id,unavailableMask]);
  const formActives:number[][]=[];const formTypeRows:Array<[number,number|null,number[]]>=[],formStatRows:number[][]=[],formLevelRows:number[][][]=[];const formRows=forms.map((form,index)=>{
   expect([form.getLevelMoves,form.getAbility,form.getAbilityCount,form.getPassiveAbilities]).toEqual(originalRegistryMethods.slice(0,4));
   // PokemonForm registry method only: never Pokemon.getLevelMoves or simulated evolution chain.
   const allRows=form.getLevelMoves();expect(allRows.length).toBeLessThanOrEqual(512);for(const row of allRows){expect(Array.isArray(row)&&row.length===2&&Number.isSafeInteger(row[0])&&row[0]>=-2&&Number.isSafeInteger(row[1])&&row[1]>=0).toBe(true);}const levels=allRows.filter(row=>row[0]<=10);for(const row of levels)moveIds.add(row[1]);
   formLevelRows.push(allRows.filter(row=>row[0]<=2).map(row=>[...row]));
   const active=Array.from({length:form.getAbilityCount()},(_,i)=>form.getAbility(i)),passives=[...form.getPassiveAbilities()];formActives.push(active);for(const ability of [...active,...passives])abilityIds.add(ability);
   expect(form.getExtraTypes).toBe(PokemonForm.prototype.getExtraTypes);const extra=[...form.getExtraTypes()];expect(extra.length).toBeLessThanOrEqual(6);formTypeRows.push([form.type1,form.type2,extra]);
   expect(form.baseStats.length).toBe(6);formStatRows.push([...form.baseStats]);
   const levelsId=internRow([levels,allRows.length,createHash("sha256").update(JSON.stringify(allRows)).digest("hex")],levelSets,levelIds);const formId=internRow([form.type1,form.type2,[...form.baseStats],active,passives,levelsId],formData,formIds);return [index,form.formKey??null,formId];
  });
  abilitySlots.push([id,formActives]);formTypes.push([id,formTypeRows]);formStats.push([id,formStatRows]);levelTwoForms.set(id,formLevelRows);speciesRows.push([id,evoOwn,se.encode(evolutions),preOwn,se.encode(preValue),se.encode(preLevels),formRows,se.encode(FORCED_SIGNATURE_MOVES[id]),Object.hasOwn(FORCED_SIGNATURE_MOVES,id),incoming]);
 }
 expect(moveIds.size).toBeLessThanOrEqual(512);expect(abilityIds.size).toBeLessThanOrEqual(512);
 const moves=[...moveIds].map(id=>{const m=allMoves[id];if(!m)return [id,false];return [id,true,m.category,m.type,m.power,m.accuracy,m.name.endsWith(" (N)"),STAB_BLACKLIST.has(id),m.constructor.name,me.encode(m.attrs),me.encode(m.conditions),m.hasCondition(targetSleptOrComatoseCondition),m.hasCondition(userSleptOrComatoseCondition)];});
 const abilities=[...abilityIds].map(id=>{const a=allAbilities[id];expect(a).toBeDefined();return [id,ae.encode(a.attrs,0,new Set<object>(),"ability["+id+"].attrs")];});
 expect(Phaser.Math.RND.state()).toBe(before);
 const effectiveRoots=[...new Set(roots.map(id=>id===266?265:id))];const levelTwoRows=effectiveRoots.map(id=>{const forms=levelTwoForms.get(id);expect(forms).toBeDefined();return [id,forms!] as [number,number[][][]];});
 const levelTwoMoveIds=[...new Set(levelTwoRows.flatMap(([,forms])=>forms.flatMap(rows=>rows.map(row=>row[1]))))];const levelTwoMeta=levelTwoMoveIds.map(id=>{const move=allMoves[id];expect(move).toBeDefined();return [id,move.category,move.type,move.power,move.accuracy,move.name.endsWith(" (N)"),STAB_BLACKLIST.has(id)];});
 const movegenFlags=["SacrificialAttrOnHit","DefAtkAttr","PhotonGeyserCategoryAttr","ShellSideArmCategoryAttr","TeraMoveCategoryAttr","VariableMoveTypeAttr","FixedDamageAttr"] as const;
 const levelTwoMovegen=levelTwoMoveIds.map(id=>{const move=allMoves[id];const power=move.calculateEffectivePower(undefined,false);expect(Number.isFinite(power)&&power>=0&&power<=10000).toBe(true);const mask=movegenFlags.reduce((bits,name,index)=>bits+(move.hasAttr(name)?2**index:0),0)+(move.isChargingMove()?128:0);return [id,power,mask];});
 const levelTwoAbilities=effectiveRoots.map(id=>{const species=getPokemonSpecies(id);const forms=species.forms.length?species.forms:[species];return [id,forms.map(form=>[Array.from({length:form.getAbilityCount()},(_,index)=>form.getAbility(index)),[...form.getPassiveAbilities()]])];});
 const movegenModifiers=[...abilityIds].filter(id=>allAbilities[id].attrs.some(attr=>attr.is("AiMovegenMoveStatsAbAttr")||attr.is("VariableMovePowerAbAttr")));
 const levelTwoSignatures=effectiveRoots.map(id=>[id,FORCED_SIGNATURE_MOVES[id]??null]);
 const specialUseless=new Set([MoveId.RAIN_DANCE,MoveId.SUNNY_DAY,MoveId.SNOWSCAPE,MoveId.HAIL,MoveId.SANDSTORM,MoveId.AURORA_VEIL]);
 const levelTwoUseless=levelTwoMoveIds.map(id=>{const move=allMoves[id],attr=move.getAttrs("StatStageChangeAttr")[0];const boost=move.is("SelfStatusMove")&&move.attrs.length===1&&attr?.stats.length===1?(attr.stats[0]===Stat.ATK?0:attr.stats[0]===Stat.SPATK?1:-1):-1;const other=move.hasAttr("WeatherChangeAttr")||move.hasCondition(targetSleptOrComatoseCondition)||move.hasCondition(userSleptOrComatoseCondition)||specialUseless.has(id);expect(other,`unmodeled low-level usefulness condition move${id}`).toBe(false);return [id,boost];});
 return {species:{schema:2,source:PIN,roots,tiers,level_cap:10,wild_kind:EvoLevelThresholdKind.WILD,context:{wave:globalScene.currentBattle.waveIndex,biome:globalScene.arena.biomeId,difficulty:getErDifficulty(),time:Reflect.get(globalScene.arena,"lastTimeOfDay"),luck:getPartyLuckValue(globalScene.getPlayerParty()),forced:getDailyForcedWaveBiomePoolTier(globalScene.currentBattle.waveIndex),regional:getErBiomeRule(globalScene.arena.biomeId)?.regionalBoost??null},rows:speciesRows,form_data:formData,level_sets:levelSets,functions:se.functions,shapes:se.shapes},moves:{schema:2,source:PIN,rows:moves,functions:me.functions,shapes:me.shapes,tuning:[BASE_LEVEL_WEIGHT_OFFSET,BASE_WEIGHT_MULTIPLIER,EVOLUTION_MOVE_WEIGHT,RELEARN_MOVE_WEIGHT,EVO_MOVE_BP_THRESHOLD,MOVE_POWER_CEILING,FORCED_SIGNATURE_MOVE_CHANCE]},abilities:{schema:2,source:PIN,runtime_slots:[initialAbilityCount,usageMethodCalls],rows:abilities,functions:ae.functions,shapes:ae.shapes},gender:{schema:1,source:PIN,rows:genderRows},form_flags:{schema:1,source:PIN,rows:formFlags},ability_slots:{schema:1,source:PIN,rows:abilitySlots},form_types:{schema:1,source:PIN,rows:formTypes},form_stats:{schema:1,source:PIN,rows:formStats},level_two_forms:{schema:1,source:PIN,rows:levelTwoRows},level_two_meta:{schema:1,source:PIN,rows:levelTwoMeta},level_two_movegen:{schema:1,source:PIN,rows:levelTwoMovegen},level_two_abilities:{schema:1,source:PIN,rows:levelTwoAbilities,movegen_modifiers:movegenModifiers},level_two_signatures:{schema:1,source:PIN,rows:levelTwoSignatures},level_two_useless:{schema:1,source:PIN,rows:levelTwoUseless}};
}
// Lossless column dictionaries; sparse columns retain every nondefault row position.
function packColumns(rows:unknown[][]){
 expect(rows.length).toBeGreaterThan(0);expect(rows.length).toBeLessThanOrEqual(512);const width=rows[0].length;expect(rows.every(row=>row.length===width)).toBe(true);
 const columns=Array.from({length:width},(_,column)=>{const values:unknown[]=[],ids=new Map<string,number>();const indices=rows.map(row=>{const key=JSON.stringify(row[column]);let id=ids.get(key);if(id===undefined){id=values.length;ids.set(key,id);values.push(row[column]);}return id;});
  const counts=values.map((_,id)=>indices.filter(value=>value===id).length);const most=counts.indexOf(Math.max(...counts));const dense=[values,indices],sparse=[values,most,indices.flatMap((id,row)=>id===most?[]:[[row,id]])];return JSON.stringify(sparse).length<JSON.stringify(dense).length?sparse:dense;});return [rows.length,columns];
}
function packSpecies(part:ReturnType<typeof extractTownStatic>["species"]){
 const levelRows:unknown[][]=[],levelIds=new Map<string,number>();const levels=part.level_sets.map(row=>{const rows=row[0] as unknown[][];const refs=rows.map(value=>{const key=JSON.stringify(value);let id=levelIds.get(key);if(id===undefined){id=levelRows.length;levelIds.set(key,id);levelRows.push(value);}return id;});const digest=row[2] as string;expect(/^[a-f0-9]{64}$/.test(digest)).toBe(true);return [refs,row[1],Buffer.from(digest,"hex").toString("base64url")];});
 expect(levelRows.length).toBeLessThanOrEqual(512*13);const rows=part.rows.map(raw=>{const row=[...(raw as unknown[])];row[6]=(row[6] as unknown[][]).map((binding,index)=>{expect(binding[0]).toBe(index);return binding.slice(1);});return row;});
 const {rows:unusedRows,form_data:unusedForms,level_sets:unusedLevels,functions,shapes,...metadata}=part;return {species:{...metadata,schema:4,rows_columns:packColumns(rows),level_columns:packColumns(levels),level_rows:levelRows},forms:{schema:1,source:PIN,form_columns:packColumns(part.form_data),functions,shapes}};
}
function pageAbilities(section:"rows"|"functions"|"shapes",values:unknown[]){
 const groups:unknown[][]=[[]];for(const value of values){let group=groups.at(-1)!;const candidate={schema:1,section,index:groups.length-1,items:[...group,value]};if(Buffer.byteLength(JSON.stringify(candidate)+"\n")>16384){expect(group.length).toBeGreaterThan(0);groups.push([value]);group=groups.at(-1)!;}else group.push(value);}
 expect(groups.length).toBeLessThanOrEqual(16);return groups.map((items,index)=>({name:`abilities-${section}-${String(index).padStart(2,"0")}`,value:{schema:1,section,index,items}}));
}
function observeConstructedMovePool(){
 const enemy=globalScene.currentBattle.enemyParty[0];expect(enemy).toBeDefined();
 expect(enemy.species.speciesId).toBe(263);expect(enemy.level).toBe(2);expect(enemy.hasTrainer()).toBe(false);expect(enemy.isBoss()).toBe(false);
 const before=Phaser.Math.RND.state(),moves=enemy.moveset.map(move=>move.moveId);
 const initial=movegen.getAndWeightLevelMoves(enemy),filtered=new Map(initial);movegen.filterMovePool(filtered,false,false,enemy);
 const adjusted=new Map(filtered);movegen.adjustDamageMoveWeights(adjusted,enemy,false);
 const weighted=[...adjusted].map(([id,weight])=>[id,Math.ceil(Math.pow(weight,BASE_WEIGHT_MULTIPLIER)*100)]);
 expect(Phaser.Math.RND.state()).toBe(before);expect(enemy.moveset.map(move=>move.moveId)).toEqual(moves);
 expect(initial.size).toBeLessThanOrEqual(512);expect(filtered.size).toBeLessThanOrEqual(initial.size);expect(adjusted.size).toBe(filtered.size);
 return {schema:1,source:PIN,entry:"direct queued NextEncounterPhase, Ace Town day wave two",species:enemy.species.speciesId,level:enemy.level,form:enemy.formIndex,ability:enemy.getAbility().id,stats:[...enemy.stats],types:[...enemy.getTypes()],initial:[...initial],filtered:[...filtered],adjusted:[...adjusted],weighted,moves};
}
function observeLevelTwoAbilityPowers(){
 const scene=globalScene,enemy=scene.currentBattle.enemyParty[0];expect(enemy).toBeDefined();expect(captured).toBeDefined();
 const before=Phaser.Math.RND.state(),oldFlag=scene.movesetGenInProgress;
 const old={species:enemy.species,form:enemy.formIndex,ability:enemy.abilityIndex,stats:[...enemy.stats],hp:enemy.hp,ivs:[...enemy.ivs],nature:enemy.nature};
 const rows:unknown[]=[];
 try{
  scene.movesetGenInProgress=true;
  for(const [id,forms] of captured!.level_two_forms.rows){
   enemy.species=getPokemonSpecies(id);const formRows:unknown[]=[];
   for(const [formIndex,levelRows] of forms.entries()){
    enemy.formIndex=formIndex;const form=enemy.getSpeciesForm();const moveIds=[...new Set(levelRows.map(row=>row[1]))];expect(moveIds.length).toBeGreaterThan(0);expect(moveIds.length).toBeLessThanOrEqual(32);
    const abilityRows:unknown[]=[];
    for(let abilityIndex=0;abilityIndex<form.getAbilityCount();abilityIndex++){
     enemy.abilityIndex=abilityIndex;enemy.calculateStats();enemy.hp=enemy.getMaxHp();const abilityId=enemy.getAbility().id;expect(abilityId).toBe(form.getAbility(abilityIndex));
     const powers=moveIds.map(moveId=>{const power=allMoves[moveId].calculateEffectivePower(enemy);expect(Number.isFinite(power)&&power>=0&&power<=10000).toBe(true);return [moveId,power] as [number,number];});
     abilityRows.push([abilityId,powers]);
    }
    formRows.push([formIndex,abilityRows]);
   }
   rows.push([id,formRows]);
  }
  expect(Phaser.Math.RND.state()).toBe(before);
 }finally{enemy.species=old.species;enemy.formIndex=old.form;enemy.abilityIndex=old.ability;enemy.stats=old.stats;enemy.hp=old.hp;enemy.ivs=old.ivs;enemy.nature=old.nature;scene.movesetGenInProgress=oldFlag;}
 expect(Phaser.Math.RND.state()).toBe(before);
 return {schema:1,source:PIN,context:"actual Town wave-two enemy shell at full HP with source moveset generation enabled",rows};
}
test("observe complete initialized Town constructor closure",async()=>{
 const output=process.env.M9_TOWN_CONSTRUCTOR_OUTPUT,ordinal=process.env.M9_TOWN_CONSTRUCTOR_ORDINAL;expect(output).toBeTruthy();expect(["one","two"]).toContain(ordinal);
 expect(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(PIN);
 game=new Phaser.Game({type:Phaser.HEADLESS,seed:[SEED]});await new Promise<void>(resolve=>setTimeout(resolve,0));manager=new GameManager(game);
 manager.override.disableShinies=false;manager.override.normalizeIVs=false;manager.override.normalizeNatures=false;
 manager.override.shiny(null).enemyShiny(null).playerIVs(null).enemyIVs(null).nature(null).enemyNature(null).battleStyle(BattleStyle.SET).startingBiome(BiomeId.TOWN).startingWave(1).seed(SEED);
 await manager.classicMode.startBattle(SpeciesId.BULBASAUR);await observeTownAtActualEntry();expect(captured).toBeDefined();assertFreshNullifyRegistry();expect(usageMethodCalls,"No runtime-slot accesses through complete observation").toBe(0);
 const movegenStage=observeConstructedMovePool();const abilityPowers=observeLevelTwoAbilityPowers();
 const packed=packSpecies(captured!.species);const outputs:Array<{name:string,value:unknown,cap:number}>=[{name:"species",value:packed.species,cap:32768},{name:"moves",value:captured!.moves,cap:32768},{name:"forms",value:packed.forms,cap:16384},{name:"abilities-meta",value:{schema:2,source:PIN,runtime_slots:captured!.abilities.runtime_slots},cap:16384},{name:"gender",value:captured!.gender,cap:4096},{name:"form-flags",value:captured!.form_flags,cap:4096},{name:"ability-slots",value:captured!.ability_slots,cap:8192},{name:"form-types",value:captured!.form_types,cap:8192},{name:"form-stats",value:captured!.form_stats,cap:16384},{name:"level-two-forms",value:captured!.level_two_forms,cap:8192},{name:"level-two-meta",value:captured!.level_two_meta,cap:8192},{name:"level-two-movegen",value:captured!.level_two_movegen,cap:8192},{name:"level-two-abilities",value:captured!.level_two_abilities,cap:8192},{name:"level-two-signatures",value:captured!.level_two_signatures,cap:4096},{name:"level-two-useless",value:captured!.level_two_useless,cap:4096},{name:"movegen-stage",value:movegenStage,cap:4096},{name:"level-two-ability-powers",value:abilityPowers,cap:32768}];
 for(const section of ["rows","functions","shapes"] as const)for(const page of pageAbilities(section,captured!.abilities[section]))outputs.push({...page,cap:16384});
 const proofs:Array<[string,number,string]>=[];
 for(const {name,value,cap} of outputs){const raw=Buffer.from(JSON.stringify(value)+"\n");const sizes=Object.entries(value as object).map(([key,part])=>[key,Buffer.byteLength(JSON.stringify(part)),Array.isArray(part)?part.length:null]);const rowColumns=name==="species"?Array.from({length:10},(_,i)=>[i,Buffer.byteLength(JSON.stringify(captured!.species.rows.map((row:unknown)=>Array.isArray(row)?row[i]:null)))]):[];const sizing=JSON.stringify({part:name,bytes:raw.length,fields:sizes,row_columns:rowColumns});expect(Buffer.byteLength(sizing)).toBeLessThanOrEqual(2048);expect(raw.length,`Complete payload byte bound: ${sizing}`).toBeLessThanOrEqual(cap);proofs.push([name,raw.length,createHash("sha256").update(raw).digest("hex")]);if(ordinal==="one")writeFileSync(join(output!,`${name}-one.json`),raw,{flag:"wx"});}
 if(ordinal==="two"){const raw=Buffer.from(JSON.stringify({schema:1,source:PIN,parts:proofs})+"\n");expect(raw.length).toBeLessThanOrEqual(4096);writeFileSync(join(output!,"digest-two.json"),raw,{flag:"wx"});}
});
