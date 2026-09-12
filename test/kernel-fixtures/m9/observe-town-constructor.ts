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
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import Phaser from "phaser";
import { afterAll,expect,test,vi } from "vitest";
const PIN="399d5d368f0b5642ebf8f45bd8a5e73350fa4de7",SEED="m9e-reward-selection-source-v1";
const originalRegistryMethods=[PokemonForm.prototype.getLevelMoves,PokemonForm.prototype.getAbility,PokemonForm.prototype.getAbilityCount,PokemonForm.prototype.getPassiveAbilities,PokemonSpecies.prototype.getPrevolutionLevels];
let game:Phaser.Game|undefined,manager:GameManager|undefined;
afterAll(()=>{vi.restoreAllMocks();manager?.promptHandler.clearPrompts();if(PromptHandler.runInterval!=null){clearInterval(PromptHandler.runInterval);PromptHandler.runInterval=undefined;}game?.destroy(true);});
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
 try{const result=extractTownStatic(tiers);expect(calls).toBe(0);return result;}finally{spy.mockRestore();}
}
function extractTownStatic(tiers:readonly (readonly [number,readonly number[]])[]){
 expect([PokemonForm.prototype.getLevelMoves,PokemonForm.prototype.getAbility,PokemonForm.prototype.getAbilityCount,PokemonForm.prototype.getPassiveAbilities,PokemonSpecies.prototype.getPrevolutionLevels]).toEqual(originalRegistryMethods);
 const before=Phaser.Math.RND.state();const roots=[...new Set(tiers.flatMap(r=>[...r[1]]))];expect(roots.length).toBe(54);
 const moveIds=new Set<number>(),abilityIds=new Set<number>();const speciesRows:unknown[]=[];
 function encoder(){const functions:Array<[string,number]>=[];const intern=new Map<string,number>();
  function encode(value:unknown,depth=0,seen=new Set<object>()):unknown{
   expect(depth).toBeLessThanOrEqual(12);
   if(value===undefined)return {u:1};if(value===null||typeof value==="boolean"||typeof value==="string"){if(typeof value==="string")expect(value.length).toBeLessThanOrEqual(1024);return value;}
   if(typeof value==="number"){if(!Number.isFinite(value))return {n:String(value)};return value;}
   if(typeof value==="function"){const text=Function.prototype.toString.call(value);expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);const hash=createHash("sha256").update(text).digest("hex");let index=intern.get(hash);if(index===undefined){index=functions.length;expect(index).toBeLessThan(512);intern.set(hash,index);functions.push([hash,Buffer.byteLength(text)]);}return {f:index};}
   expect(typeof value).toBe("object");const object=value as object;expect(seen.has(object)).toBe(false);seen.add(object);
   try{if(value instanceof Map){expect(Reflect.ownKeys(value).length).toBe(0);expect(value.size).toBeLessThanOrEqual(512);return {m:[...value].map(([k,v])=>[encode(k,depth+1,seen),encode(v,depth+1,seen)])};}if(value instanceof Set){expect(Reflect.ownKeys(value).length).toBe(0);expect(value.size).toBeLessThanOrEqual(512);return {s:[...value].map(v=>encode(v,depth+1,seen))};}expect(value instanceof Date||value instanceof RegExp||value instanceof WeakMap||value instanceof WeakSet||ArrayBuffer.isView(value)||value instanceof ArrayBuffer||value instanceof Promise).toBe(false);if(Array.isArray(value)){expect(value.length).toBeLessThanOrEqual(512);expect(Reflect.ownKeys(value).length).toBe(value.length+1);return Array.from({length:value.length},(_,i)=>{const prop=Object.getOwnPropertyDescriptor(value,String(i));expect(prop&&Object.hasOwn(prop,"value")).toBe(true);return encode(prop!.value,depth+1,seen);});}
    const proto=Object.getPrototypeOf(object),ctor=proto===null?null:Object.getOwnPropertyDescriptor(proto,"constructor");expect(proto===null||ctor&&Object.hasOwn(ctor,"value")&&typeof ctor.value==="function").toBe(true);const keys=Reflect.ownKeys(object);expect(keys.length).toBeLessThanOrEqual(128);expect(keys.every(k=>typeof k==="string")).toBe(true);
    const props=keys.map(k=>{const prop=Object.getOwnPropertyDescriptor(object,k)!;expect(Object.hasOwn(prop,"value")).toBe(true);return [k,encode(prop.value,depth+1,seen)];});return {c:ctor?.value.name??null,p:props};
   }finally{seen.delete(object);}
  }return {encode,functions};
 }
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
  const forms=species.forms.length?species.forms:[species];expect(forms.length).toBeLessThanOrEqual(16);
  const formRows=forms.map((form,index)=>{
   expect([form.getLevelMoves,form.getAbility,form.getAbilityCount,form.getPassiveAbilities]).toEqual(originalRegistryMethods.slice(0,4));
   // PokemonForm registry method only: never Pokemon.getLevelMoves or simulated evolution chain.
   const allRows=form.getLevelMoves();expect(allRows.length).toBeLessThanOrEqual(512);for(const row of allRows){expect(Array.isArray(row)&&row.length===2&&Number.isSafeInteger(row[0])&&row[0]>=-2&&Number.isSafeInteger(row[1])&&row[1]>=0).toBe(true);}const levels=allRows.filter(row=>row[0]<=10);for(const row of levels)moveIds.add(row[1]);
   const active=Array.from({length:form.getAbilityCount()},(_,i)=>form.getAbility(i)),passives=[...form.getPassiveAbilities()];for(const ability of [...active,...passives])abilityIds.add(ability);
   return [index,form.formKey??null,form.type1,form.type2,[...form.baseStats],active,passives,levels,allRows.length,createHash("sha256").update(JSON.stringify(allRows)).digest("hex")];
  });
  speciesRows.push([id,evoOwn,se.encode(evolutions),preOwn,se.encode(preValue),se.encode(preLevels),formRows,se.encode(FORCED_SIGNATURE_MOVES[id]),Object.hasOwn(FORCED_SIGNATURE_MOVES,id),incoming]);
 }
 expect(moveIds.size).toBeLessThanOrEqual(512);expect(abilityIds.size).toBeLessThanOrEqual(512);
 const moves=[...moveIds].map(id=>{const m=allMoves[id];if(!m)return [id,false];return [id,true,m.category,m.type,m.power,m.accuracy,m.name.endsWith(" (N)"),STAB_BLACKLIST.has(id),m.constructor.name,me.encode(m.attrs),me.encode(m.conditions),m.hasCondition(targetSleptOrComatoseCondition),m.hasCondition(userSleptOrComatoseCondition)];});
 const abilities=[...abilityIds].map(id=>{const a=allAbilities[id];expect(a).toBeDefined();return [id,ae.encode(a.attrs)];});
 expect(Phaser.Math.RND.state()).toBe(before);
 return {species:{schema:1,source:PIN,roots,tiers,level_cap:10,wild_kind:EvoLevelThresholdKind.WILD,context:{wave:globalScene.currentBattle.waveIndex,biome:globalScene.arena.biomeId,difficulty:getErDifficulty(),time:Reflect.get(globalScene.arena,"lastTimeOfDay"),luck:getPartyLuckValue(globalScene.getPlayerParty()),forced:getDailyForcedWaveBiomePoolTier(globalScene.currentBattle.waveIndex),regional:getErBiomeRule(globalScene.arena.biomeId)?.regionalBoost??null},rows:speciesRows,functions:se.functions},moves:{schema:1,source:PIN,rows:moves,functions:me.functions,tuning:[BASE_LEVEL_WEIGHT_OFFSET,BASE_WEIGHT_MULTIPLIER,EVOLUTION_MOVE_WEIGHT,RELEARN_MOVE_WEIGHT,EVO_MOVE_BP_THRESHOLD,MOVE_POWER_CEILING,FORCED_SIGNATURE_MOVE_CHANCE]},abilities:{schema:1,source:PIN,rows:abilities,functions:ae.functions}};
}
test("observe complete initialized Town constructor closure",async()=>{
 const output=process.env.M9_TOWN_CONSTRUCTOR_OUTPUT,ordinal=process.env.M9_TOWN_CONSTRUCTOR_ORDINAL;expect(output).toBeTruthy();expect(["one","two"]).toContain(ordinal);
 expect(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(PIN);
 game=new Phaser.Game({type:Phaser.HEADLESS,seed:[SEED]});await new Promise<void>(resolve=>setTimeout(resolve,0));manager=new GameManager(game);
 manager.override.disableShinies=false;manager.override.normalizeIVs=false;manager.override.normalizeNatures=false;
 manager.override.shiny(null).enemyShiny(null).playerIVs(null).enemyIVs(null).nature(null).enemyNature(null).battleStyle(BattleStyle.SET).startingBiome(BiomeId.TOWN).startingWave(1).seed(SEED);
 await manager.classicMode.startBattle(SpeciesId.BULBASAUR);await observeTownAtActualEntry();expect(captured).toBeDefined();
 for(const [name,cap] of [["species",32768],["moves",32768],["abilities",16384]] as const){const raw=Buffer.from(JSON.stringify(captured![name])+"\n");expect(raw.length).toBeLessThanOrEqual(cap);writeFileSync(join(output!,`${name}-${ordinal}.json`),raw,{flag:"wx"});}
});
