import { NullifyFirstNHitsAbAttr } from "#data/elite-redux/archetypes/nullify-first-n-hits";
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
import { SpeciesId } from "#enums/species-id";
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
 const moveIds=new Set<number>(),abilityIds=new Set<number>();const speciesRows:unknown[]=[];
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
  const evoOwn=Object.hasOwn(pokemonEvolutions,id),evolutions=evoOwn?pokemonEvolutions[id]:[];
  const preOwn=Object.hasOwn(pokemonPrevolutions,id),preValue=pokemonPrevolutions[id];
  const incoming:Array<[number,number]>=[];for(const key of Object.keys(pokemonEvolutions)){const parent=Number(key);for(const [index,e] of pokemonEvolutions[parent].entries())if(e.speciesId===id)incoming.push([parent,index]);}expect(incoming.length).toBeLessThanOrEqual(128);
  const preLevels=species.getPrevolutionLevels(true);expect(preLevels.length).toBeLessThanOrEqual(128);
  for(const e of evolutions)queue.push([e.speciesId,depth+1]);for(const row of preLevels)queue.push([row[0],depth+1]);if(preOwn){expect(Number.isSafeInteger(preValue)).toBe(true);queue.push([preValue,depth+1]);}
  for(const [parent] of incoming)queue.push([parent,depth+1]);
  const forms=species.forms.length?species.forms:[species];expect(forms.length,`species${id} forms`).toBeLessThanOrEqual(20);
  const formRows=forms.map((form,index)=>{
   expect([form.getLevelMoves,form.getAbility,form.getAbilityCount,form.getPassiveAbilities]).toEqual(originalRegistryMethods.slice(0,4));
   // PokemonForm registry method only: never Pokemon.getLevelMoves or simulated evolution chain.
   const allRows=form.getLevelMoves();expect(allRows.length).toBeLessThanOrEqual(512);for(const row of allRows){expect(Array.isArray(row)&&row.length===2&&Number.isSafeInteger(row[0])&&row[0]>=-2&&Number.isSafeInteger(row[1])&&row[1]>=0).toBe(true);}const levels=allRows.filter(row=>row[0]<=10);for(const row of levels)moveIds.add(row[1]);
   const active=Array.from({length:form.getAbilityCount()},(_,i)=>form.getAbility(i)),passives=[...form.getPassiveAbilities()];for(const ability of [...active,...passives])abilityIds.add(ability);
   const levelsId=internRow([levels,allRows.length,createHash("sha256").update(JSON.stringify(allRows)).digest("hex")],levelSets,levelIds);const formId=internRow([form.type1,form.type2,[...form.baseStats],active,passives,levelsId],formData,formIds);return [index,form.formKey??null,formId];
  });
  speciesRows.push([id,evoOwn,se.encode(evolutions),preOwn,se.encode(preValue),se.encode(preLevels),formRows,se.encode(FORCED_SIGNATURE_MOVES[id]),Object.hasOwn(FORCED_SIGNATURE_MOVES,id),incoming]);
 }
 expect(moveIds.size).toBeLessThanOrEqual(512);expect(abilityIds.size).toBeLessThanOrEqual(512);
 const moves=[...moveIds].map(id=>{const m=allMoves[id];if(!m)return [id,false];return [id,true,m.category,m.type,m.power,m.accuracy,m.name.endsWith(" (N)"),STAB_BLACKLIST.has(id),m.constructor.name,me.encode(m.attrs),me.encode(m.conditions),m.hasCondition(targetSleptOrComatoseCondition),m.hasCondition(userSleptOrComatoseCondition)];});
 const abilities=[...abilityIds].map(id=>{const a=allAbilities[id];expect(a).toBeDefined();return [id,ae.encode(a.attrs,0,new Set<object>(),"ability["+id+"].attrs")];});
 expect(Phaser.Math.RND.state()).toBe(before);
 return {species:{schema:2,source:PIN,roots,tiers,level_cap:10,wild_kind:EvoLevelThresholdKind.WILD,context:{wave:globalScene.currentBattle.waveIndex,biome:globalScene.arena.biomeId,difficulty:getErDifficulty(),time:Reflect.get(globalScene.arena,"lastTimeOfDay"),luck:getPartyLuckValue(globalScene.getPlayerParty()),forced:getDailyForcedWaveBiomePoolTier(globalScene.currentBattle.waveIndex),regional:getErBiomeRule(globalScene.arena.biomeId)?.regionalBoost??null},rows:speciesRows,form_data:formData,level_sets:levelSets,functions:se.functions,shapes:se.shapes},moves:{schema:2,source:PIN,rows:moves,functions:me.functions,shapes:me.shapes,tuning:[BASE_LEVEL_WEIGHT_OFFSET,BASE_WEIGHT_MULTIPLIER,EVOLUTION_MOVE_WEIGHT,RELEARN_MOVE_WEIGHT,EVO_MOVE_BP_THRESHOLD,MOVE_POWER_CEILING,FORCED_SIGNATURE_MOVE_CHANCE]},abilities:{schema:2,source:PIN,runtime_slots:[initialAbilityCount,usageMethodCalls],rows:abilities,functions:ae.functions,shapes:ae.shapes}};
}
test("observe complete initialized Town constructor closure",async()=>{
 const output=process.env.M9_TOWN_CONSTRUCTOR_OUTPUT,ordinal=process.env.M9_TOWN_CONSTRUCTOR_ORDINAL;expect(output).toBeTruthy();expect(["one","two"]).toContain(ordinal);
 expect(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(PIN);
 game=new Phaser.Game({type:Phaser.HEADLESS,seed:[SEED]});await new Promise<void>(resolve=>setTimeout(resolve,0));manager=new GameManager(game);
 manager.override.disableShinies=false;manager.override.normalizeIVs=false;manager.override.normalizeNatures=false;
 manager.override.shiny(null).enemyShiny(null).playerIVs(null).enemyIVs(null).nature(null).enemyNature(null).battleStyle(BattleStyle.SET).startingBiome(BiomeId.TOWN).startingWave(1).seed(SEED);
 await manager.classicMode.startBattle(SpeciesId.BULBASAUR);await observeTownAtActualEntry();expect(captured).toBeDefined();assertFreshNullifyRegistry();expect(usageMethodCalls,"No runtime-slot accesses through complete observation").toBe(0);
 for(const [name,cap] of [["species",32768],["moves",32768],["abilities",16384]] as const){const raw=Buffer.from(JSON.stringify(captured![name])+"\n");expect(raw.length).toBeLessThanOrEqual(cap);writeFileSync(join(output!,`${name}-${ordinal}.json`),raw,{flag:"wx"});}
});
