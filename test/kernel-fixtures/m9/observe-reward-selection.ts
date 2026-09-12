import { Battle } from "#app/battle";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { globalScene } from "#app/global-scene";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { SpeciesId } from "#enums/species-id";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { regenerateModifierPoolThresholds, ModifierTypeGenerator } from "#modifiers/modifier-type";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { serializeRewardOptions } from "#data/elite-redux/coop/coop-reward-options";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

const PIN="399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const SEED="m9e-reward-selection-source-v1";
let game:Phaser.Game|undefined;
let manager:GameManager|undefined;
afterAll(()=>{
  vi.restoreAllMocks();manager?.promptHandler.clearPrompts();
  if(PromptHandler.runInterval!=null){clearInterval(PromptHandler.runInterval);PromptHandler.runInterval=undefined;}
  game?.destroy(true);
});

function exactJsonArg(value:unknown,depth=0):void {
  expect(depth).toBeLessThanOrEqual(4);
  if(value===null||typeof value==="boolean")return;
  if(typeof value==="number"){expect(Number.isFinite(value)).toBe(true);return;}
  if(typeof value==="string"){expect(value.length).toBeLessThanOrEqual(256);return;}
  if(Array.isArray(value)){
    expect(value.length).toBeLessThanOrEqual(16);
    expect(Reflect.ownKeys(value).length).toBe(value.length+1);
    for(let index=0;index<value.length;index++){const descriptor=Object.getOwnPropertyDescriptor(value,index);expect(descriptor).toBeDefined();expect(descriptor!.enumerable).toBe(true);expect(Object.hasOwn(descriptor!,"value")).toBe(true);exactJsonArg(descriptor!.value,depth+1);}
    return;
  }
  expect(typeof value).toBe("object");
  const object=value as Record<string,unknown>;
  expect([Object.prototype,null].includes(Object.getPrototypeOf(object))).toBe(true);
  const keys=Reflect.ownKeys(object);expect(keys.length).toBeLessThanOrEqual(16);
  for(const key of keys){expect(typeof key).toBe("string");expect(String(key).length).toBeLessThanOrEqual(128);const descriptor=Object.getOwnPropertyDescriptor(object,key)!;expect(descriptor.enumerable).toBe(true);expect(Object.hasOwn(descriptor,"value")).toBe(true);exactJsonArg(descriptor.value,depth+1);}
}
test("observe actual initialized reward selection",async()=>{
  const output=process.env.M9_REWARD_SELECTION_OUTPUT;
  if(!output)throw new Error("M9_REWARD_SELECTION_OUTPUT required");
  expect(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(PIN);
  game=new Phaser.Game({type:Phaser.HEADLESS,seed:[SEED]});
  await new Promise<void>(resolve=>setTimeout(resolve,0));
  manager=new GameManager(game);
  manager.override.disableShinies=false;manager.override.normalizeIVs=false;manager.override.normalizeNatures=false;
  manager.override.shiny(null).enemyShiny(null).playerIVs(null).enemyIVs(null)
    .nature(null).enemyNature(null).battleStyle(BattleStyle.SET)
    .startingBiome(BiomeId.TOWN).startingWave(1).seed(SEED);
  const levelCalls:Array<{wave:number,battle_seed:string,entry:string,exit:string,level:number}>=[];
  const actualLevel=Battle.prototype.getLevelForWave;
  expect(vi.isMockFunction(actualLevel)).toBe(false);
  const levelSpy=vi.spyOn(Battle.prototype,"getLevelForWave").mockImplementation(function(this:Battle){
    const entry=Phaser.Math.RND.state();
    const level=actualLevel.call(this);
    expect(levelCalls.length).toBeLessThan(4);
    levelCalls.push({wave:this.waveIndex,battle_seed:this.battleSeed,entry,exit:Phaser.Math.RND.state(),level});
    return level;
  });
  try { await manager.classicMode.startBattle(SpeciesId.BULBASAUR); }
  finally { levelSpy.mockRestore(); }
  const scene=globalScene;
  expect(scene.gameMode.isClassic).toBe(true);expect(Boolean(scene.gameMode.isCoop)).toBe(false);
  expect(Boolean(scene.gameMode.isFun)).toBe(false);
  const party=scene.getPlayerParty();expect(party.length).toBe(1);
  const phase=new SelectModifierPhase();
  const countMethod=Reflect.get(phase,"getModifierCount") as ()=>number;
  const functions=[phase.updateSeed,phase.getModifierTypeOptions,countMethod,getModifierPoolForType,
    regenerateModifierPoolThresholds,serializeRewardOptions,scene.resetSeed];
  for(const fn of functions){expect(typeof fn).toBe("function");expect(vi.isMockFunction(fn)).toBe(false);}
  const originalRng=Phaser.Math.RND.state();
  const draws:Array<[number,number,number]>=[];
  const draw=Phaser.Math.RND.integerInRange.bind(Phaser.Math.RND);
  const spy=vi.spyOn(Phaser.Math.RND,"integerInRange").mockImplementation((min,max)=>{
    const value=draw(min,max);expect(draws.length).toBeLessThan(1024);draws.push([min,max,value]);return value;
  });
  const pool=getModifierPoolForType(ModifierPoolType.PLAYER);
  const generatorCalls:Array<{stage:string,tier:number,index:number,id:string,draws:Array<[number,number,number]>,result:null|{id:string,name:string,group:string|null,pregen_args:unknown[]|null}}>=[];
  const generatorSpies:Array<{mockRestore:()=>void}>=[];
  let generationStage="regeneration";
  for(const [tier,entries] of Object.entries(pool))for(const [index,entry] of entries.entries()){
    if(!(entry.modifierType instanceof ModifierTypeGenerator))continue;
    const generator=entry.modifierType;
    expect(vi.isMockFunction(generator.generateType)).toBe(false);
    const original=generator.generateType.bind(generator);
    generatorSpies.push(vi.spyOn(generator,"generateType").mockImplementation((...args)=>{
      const start=draws.length;
      const result=original(...args);
      const resultRng=Phaser.Math.RND.state();
      let pregen:unknown[]|null=null;
      if(result&&"getPregenArgs" in result&&typeof result.getPregenArgs==="function"){
        const raw=result.getPregenArgs();expect(Array.isArray(raw)).toBe(true);
        exactJsonArg(raw);
        pregen=JSON.parse(JSON.stringify(raw)) as unknown[];
        expect(pregen.length).toBeLessThanOrEqual(16);
      }
      expect(Phaser.Math.RND.state()).toBe(resultRng);
      expect(generatorCalls.length).toBeLessThan(128);
      generatorCalls.push({stage:generationStage,tier:Number(tier),index,id:generator.id,draws:draws.slice(start),
        result:result?{id:result.id,name:result.name,group:result.group??null,pregen_args:pregen}:null});
      return result;
    }));
  }
  try {
    const context={wave:scene.currentBattle.waveIndex,turn:scene.currentBattle.turn,biome:scene.arena.biomeId,
      constructor:{seed:scene.seed,wave_seed:scene.waveSeed,battle_seed:scene.currentBattle.battleSeed,enemy_levels:scene.currentBattle.enemyLevels,level_calls:levelCalls,
        tuning:{wave_slope:erBalanceNum("vanilla.level.waveSlope"),quad_divisor:erBalanceNum("vanilla.level.quadDivisor"),boss_mult:erBalanceNum("vanilla.level.bossMult")}},
      party:party.map(p=>({species:p.species.speciesId,form:p.formIndex,level:p.level,hp:p.hp,max_hp:p.getMaxHp(),
        ability:p.getAbility().id,passives:p.getPassiveAbilities().map(a=>a?.id??null),shiny:p.shiny,variant:p.variant})),
      modifiers:scene.modifiers.map(m=>({id:m.type.id,class_name:m.constructor.name,stack:m.stackCount}))};
    phase.updateSeed();
    const seedRng=Phaser.Math.RND.state();
    regenerateModifierPoolThresholds(party,phase.getPoolType(),0);
    const regeneratedRng=Phaser.Math.RND.state();
    const regenerationDraws=draws.splice(0);
    const count=countMethod.call(phase);expect(count).toBe(3);
    const freePicks=Reflect.get(phase,"freePicksRemaining");expect(freePicks).toBe(1);
    const countDraws=draws.splice(0);
    generationStage="selection";
    const options=phase.getModifierTypeOptions(count);
    expect(options.length).toBe(3);
    const generatedRng=Phaser.Math.RND.state();
    const optionDraws=draws.splice(0);
    const serialized=serializeRewardOptions(options);
    const identities=options.map(option=>({name:option.type.name,group:option.type.group??null}));
    expect(Phaser.Math.RND.state()).toBe(generatedRng);
    generationStage="catalog";
    // Direct source predicate values are an input-conditioned catalog, not a
    // substitute for regenerate's saturation/generator filtering algorithm.

    const catalog:Array<[number,number,string,string,boolean,boolean,number,boolean,number,string,string|null]>=[];
    for(const [tier,entries] of Object.entries(pool))for(const [index,entry] of entries.entries()){
      const dynamic=typeof entry.weight==="function";
      if(dynamic)expect(vi.isMockFunction(entry.weight)).toBe(false);
      const weight=dynamic?(entry.weight as (value:typeof party,reroll:number)=>number)(party,0):entry.weight as number;
      expect(Number.isFinite(weight)&&weight>=0).toBe(true);
      const maxDynamic=typeof entry.maxWeight==="function";
      if(maxDynamic)expect(vi.isMockFunction(entry.maxWeight)).toBe(false);
      const maxWeight=maxDynamic?(entry.maxWeight as (value:typeof party,reroll:number)=>number)(party,0):entry.maxWeight as number;
      expect(Number.isFinite(maxWeight)&&maxWeight>=0).toBe(true);
      catalog.push([Number(tier),index,entry.modifierType.id,entry.modifierType.constructor.name,
        entry.modifierType instanceof ModifierTypeGenerator,dynamic,weight,maxDynamic,maxWeight,entry.modifierType.name,entry.modifierType.group??null]);
    }
    expect(catalog.length).toBeGreaterThan(0);expect(catalog.length).toBeLessThanOrEqual(1024);
    const predicateDraws=draws.splice(0);
    const data={schema_version:1,source_sha:PIN,setup_seed:SEED,
      scope:"actual initialized pool predicates and direct SelectModifierPhase generation methods; not a post-victory state or applied reward",
      context,catalog,predicate_draws:predicateDraws,option_count:count,free_picks:freePicks,
      rng:{seed:seedRng,regenerated:regeneratedRng,generated:generatedRng},
      regeneration_draws:regenerationDraws,count_draws:countDraws,option_draws:optionDraws,options:serialized,identities,generator_calls:generatorCalls};
    const bytes=Buffer.from(JSON.stringify(data)+"\n");expect(bytes.length).toBeLessThanOrEqual(32768);
    writeFileSync(output,bytes,{flag:"wx"});
  } finally {for(const generatorSpy of generatorSpies)generatorSpy.mockRestore();spy.mockRestore();Phaser.Math.RND.state(originalRng);}
});
