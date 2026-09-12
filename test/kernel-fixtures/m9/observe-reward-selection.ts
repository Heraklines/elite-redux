import { createHash } from "node:crypto";
import { createArrangement } from "#data/battle-format";
import { allMoves } from "#data/data-lists";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { getFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { Unlockables } from "#enums/unlockables";
import { MoveFlags } from "#enums/move-flags";
// Read-only complete current-party binder closure. No null-generator lookup.
function binderFacts(scene:typeof globalScene){
  const before=Phaser.Math.RND.state();
  const triggerIds=new Map<object,number>();
  const sourceFunction=(f:unknown)=>{
    if(f==null)return null;
    expect(typeof f).toBe("function");
    const source=Function.prototype.toString.call(f);expect(source.length).toBeLessThanOrEqual(4096);
    return {bytes:Buffer.byteLength(source),sha256:createHash("sha256").update(source).digest("hex")};
  };
  const facts=scene.getPlayerParty().map(p=>{
    const species=p.species.speciesId;
    const evolutionPresent=Object.hasOwn(pokemonEvolutions,species);
    const evolutions=evolutionPresent?pokemonEvolutions[species]:[];
    const formPresent=Object.hasOwn(pokemonFormChanges,species);
    const forms=formPresent?pokemonFormChanges[species]:[];
    expect(evolutions.length).toBeLessThanOrEqual(16);expect(forms.length).toBeLessThanOrEqual(16);
    const allLevelRows=p.getSpeciesForm(true).getLevelMoves();
    expect(allLevelRows.length).toBeLessThanOrEqual(256);
    const levelRows=allLevelRows.filter(row=>row[0]>0&&row[0]<=10);
    expect(levelRows.length).toBeLessThanOrEqual(64);
    const moveIds=[...new Set([...p.getMoveset().map(pm=>pm.getMove().id),...levelRows.map(row=>row[1])])];
    expect(moveIds.length).toBeLessThanOrEqual(32);
    const moveFact=(id:number)=>{
      const move=allMoves[id];const variables=move.getAttrs("VariableMoveTypeAttr");
      expect(move.attrs.length).toBeLessThanOrEqual(32);expect(variables.length).toBeLessThanOrEqual(16);
      return {id:move.id,type:move.type,category:move.category,accuracy:move.accuracy,pp:move.pp,sound:move.hasFlag(MoveFlags.SOUND_BASED),
        attack:move.is("AttackMove"),attrs:move.attrs.map(a=>a.constructor.name),
        variable_types:variables.map(a=>({class_name:a.constructor.name,types:a.getTypesForItemSpawn(p,move)}))};
    };
    return {species,form:p.formIndex,form_key:p.getFormKey(),level_cap:10,level_rows:levelRows,
      all_level_rows_count:allLevelRows.length,all_level_rows_sha256:createHash("sha256").update(JSON.stringify(allLevelRows)).digest("hex"),
      live_move_ids:p.getMoveset().map(pm=>pm.getMove().id),move_closure:moveIds.map(moveFact),
      evolutions:{present:evolutionPresent,rows:evolutions.map(e=>{
        const conditions=e.condition?.data??null;exactJsonArg(conditions);
        return {species:e.speciesId,pre_form:e.preFormKey,evo_form:e.evoFormKey,level:e.level,
          item:e.item,conditions,level_threshold:e.evoLevelThreshold??null};
      })},
      forms:{present:formPresent,rows:forms.map(f=>{
        const trigger=f.findTrigger(SpeciesFormChangeItemTrigger);
        if(trigger&&!triggerIds.has(trigger))triggerIds.set(trigger,triggerIds.size);
        expect(f.conditions.length).toBeLessThanOrEqual(16);
        return {species:f.speciesId,pre_form:f.preFormKey,form:f.formKey,
          root_trigger_class:f.trigger.constructor.name,
          item_trigger:trigger?{identity:triggerIds.get(trigger),item:trigger.item,active:trigger.active}:null,
          conditions:f.conditions.map(c=>({class_name:c.constructor.name,
            predicate:sourceFunction(c.predicate),enforce:sourceFunction(c.enforceFunc)}))};
      })},
      held:p.getHeldItems().map(m=>({id:m.type.id,class_name:m.constructor.name,stack:m.stackCount})),
      learnable_now:p.getLearnableLevelMoves()};
  });
  const result={party:facts,mode:{classic:Boolean(scene.gameMode.isClassic),daily:Boolean(scene.gameMode.isDaily),
    fun:Boolean(scene.gameMode.isFun),coop:Boolean(scene.gameMode.isCoop),spliced_only:Boolean(scene.gameMode.isSplicedOnly),
    fresh_start:scene.gameMode.isFreshStartChallenge(),challenges:scene.gameMode.challenges.map(c=>({id:c.id,value:c.value})),
    fun_mega:getFunModeConfig().megaMode},
    unlocks:{eviolite:scene.gameData.isUnlocked(Unlockables.EVIOLITE),mini_black_hole:scene.gameData.isUnlocked(Unlockables.MINI_BLACK_HOLE)}};
  expect(result.mode.challenges.length).toBeLessThanOrEqual(32);
  expect(Phaser.Math.RND.state()).toBe(before);
  return result;
}
import { MAX_PER_TYPE_POKEBALLS } from "#data/pokeball";
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

// An explicit direct-method probe after the existing observations. This is not
// a victory, applied reward, queued phase execution, or natural wave journey.
function observeBattleFormat(format:Battle["format"]){
  const before=Phaser.Math.RND.state();
  expect(format.sides.length).toBeGreaterThan(0);expect(format.sides.length).toBeLessThanOrEqual(4);
  const sides=format.sides.map(side=>({baseIndex:side.baseIndex,capacity:side.capacity,kind:side.kind,mirrored:side.mirrored}));
  const slots:number[]=[];
  for(const side of sides){
    expect(Number.isSafeInteger(side.baseIndex)&&side.baseIndex>=0).toBe(true);
    expect(Number.isSafeInteger(side.capacity)&&side.capacity>0&&side.capacity<=6).toBe(true);
    for(let offset=0;offset<side.capacity;offset++)slots.push(side.baseIndex+offset);
  }
  expect(slots.length).toBeLessThanOrEqual(16);expect(new Set(slots).size).toBe(slots.length);
  expect(typeof format.adjacency.reaches).toBe("function");expect(vi.isMockFunction(format.adjacency.reaches)).toBe(false);
  const arrangement=createArrangement(format);
  const rows:Array<[number,number,boolean]>=[];
  for(const from of slots)for(const to of slots){
    const fromId=arrangement.locate(from);const toId=arrangement.locate(to);
    expect(arrangement.indexOf(fromId)).toBe(from);expect(arrangement.indexOf(toId)).toBe(to);
    const reachable=format.adjacency.reaches(fromId,toId);expect(typeof reachable).toBe("boolean");
    expect(Phaser.Math.RND.state()).toBe(before);rows.push([from,to,reachable]);
  }
  return {id:format.id,sides,localPlayerSide:format.localPlayerSide,adjacency:{slots,rows}};
}

function observeDirectNextBattle(){
  const scene=globalScene;
  expect(scene.currentBattle.waveIndex).toBe(1);
  const cleanups:Array<()=>void>=[];
  const trace:Array<{method:string,entry:string,exit:string,wave_before:number,wave_after:number,draw_start:number,draw_end:number}>=[];
  const draws:Array<[string,number|null,number|null,number]>=[];
  const queued:Array<{method:string,name:string,args:unknown[]}>=[];
  const metadata=()=>scene.getPlayerParty().map(p=>({id:p.id,species:p.species.speciesId,form:p.formIndex,
    level:p.level,hp:p.hp,max_hp:p.getMaxHp(),friendship:p.friendship,pokerus:p.pokerus,
    battle_data_keys:Object.keys(p.battleData).sort(),summon_data_keys:Object.keys(p.summonData).sort(),
    moves:p.getMoveset().map(m=>({id:m.moveId,pp_used:m.ppUsed}))}));
  const pre={wave:scene.currentBattle.waveIndex,turn:scene.currentBattle.turn,seed:scene.seed,wave_seed:scene.waveSeed,
    battle_seed:scene.currentBattle.battleSeed,format:observeBattleFormat(scene.currentBattle.format),enemy_levels:[...scene.currentBattle.enemyLevels],
    rng:Phaser.Math.RND.state(),party:metadata()};
  function wrap(target:object,key:string,after?:(args:unknown[],result:unknown,receiver:unknown)=>void){
    const original:unknown=Reflect.get(target,key);
    expect(typeof original).toBe("function");expect(vi.isMockFunction(original)).toBe(false);
    const fn=original as (...args:unknown[])=>unknown;
    const replacement=function(this:unknown,...args:unknown[]){
      const row={method:key,entry:Phaser.Math.RND.state(),exit:"",wave_before:scene.currentBattle.waveIndex,wave_after:0,draw_start:draws.length,draw_end:0};
      expect(trace.length).toBeLessThan(48);trace.push(row);
      const result=Reflect.apply(fn,this,args);
      row.exit=Phaser.Math.RND.state();row.wave_after=scene.currentBattle.waveIndex;row.draw_end=draws.length;
      after?.(args,result,this);return result;
    };
    expect(Reflect.set(target,key,replacement)).toBe(true);
    cleanups.push(()=>{expect(Reflect.set(target,key,original)).toBe(true);});
  }
  for(const key of ["newBattle","getNewBattleProps","resetSeed","handleNonFixedBattle","checkIsDouble",
    "resolveBattleFormat","executeWithSeedOffset","doPostBattleCleanup","trySpreadPokerus","triggerPokemonFormChange"]){wrap(scene,key);}
  const levelCalls:Array<{wave:number,level:number,battle_seed:string}>=[];
  wrap(Battle.prototype,"getLevelForWave",(_,level,receiver)=>{
    expect(typeof level).toBe("number");expect(receiver).toBeInstanceOf(Battle);
    const battle=receiver as Battle;
    levelCalls.push({wave:battle.waveIndex,level:level as number,battle_seed:battle.battleSeed});
  });
  for(const key of ["pushNew","unshiftNew"]){
    const original:unknown=Reflect.get(scene.phaseManager,key);
    expect(typeof original).toBe("function");expect(vi.isMockFunction(original)).toBe(false);
    const fn=original as (...args:unknown[])=>unknown;
    expect(Reflect.set(scene.phaseManager,key,function(this:unknown,...args:unknown[]){
      expect(queued.length).toBeLessThan(16);expect(typeof args[0]).toBe("string");
      const captured=args.slice(1);exactJsonArg(captured);
      queued.push({method:key,name:args[0] as string,args:captured});return Reflect.apply(fn,this,args);
    })).toBe(true);
    cleanups.push(()=>{expect(Reflect.set(scene.phaseManager,key,original)).toBe(true);});
  }
  for(const key of ["frac","integerInRange"] as const){
    const original=Phaser.Math.RND[key];expect(vi.isMockFunction(original)).toBe(false);
    const fn=original as (...args:number[])=>number;
    const spy=vi.spyOn(Phaser.Math.RND,key).mockImplementation((...args:number[])=>{
      const result=Reflect.apply(fn,Phaser.Math.RND,args);expect(draws.length).toBeLessThan(128);
      draws.push([key,args[0]??null,args[1]??null,result]);return result;
    });cleanups.push(()=>spy.mockRestore());
  }
  try{
    const battle=scene.newBattle();
    const post={wave:battle.waveIndex,turn:battle.turn,seed:scene.seed,wave_seed:scene.waveSeed,
      battle_seed:battle.battleSeed,format:observeBattleFormat(battle.format),enemy_levels:[...battle.enemyLevels],rng:Phaser.Math.RND.state(),party:metadata()};
    expect(post.wave).toBe(2);expect(trace.some(row=>row.method==="doPostBattleCleanup")).toBe(true);
    expect(queued.some(row=>row.name==="NextEncounterPhase")).toBe(true);
    return {scope:"direct actual scene.newBattle after initialized wave1; no victory or reward application and no queued phase execution",pre,post,trace,draws,queued,level_calls:levelCalls};
  }finally{for(const cleanup of cleanups.reverse())cleanup();}
}
async function observeDirectQueuedEncounter(){
  const scene=globalScene,pm=scene.phaseManager;
  const prior=pm.getCurrentPhase(),before=Phaser.Math.RND.state();
  expect(prior.phaseName).toBe("CommandPhase");expect(scene.currentBattle.waveIndex).toBe(2);
  expect(scene.currentBattle.enemyParty.length).toBe(0);
  const selected:Array<import("#phases/next-encounter-phase").NextEncounterPhase>=[];
  expect(pm.tryRemovePhase("NextEncounterPhase",phase=>{selected.push(phase);return true;})).toBe(true);
  expect(selected.length).toBe(1);const phase=selected[0];
  expect(pm.hasPhaseOfType("NextEncounterPhase")).toBe(false);
  const draws:Array<[string,...number[]]>=[],trace:Array<{method:string,start:number,end:number,entry:string,exit:string}>=[];
  const constructed:Array<ReturnType<typeof pokemonFact>>=[];
  function pokemonFact(p:ReturnType<typeof scene.addEnemyPokemon>){
    const rng=Phaser.Math.RND.state();
    const fact={id:p.id,species:p.species.speciesId,form:p.formIndex,level:p.level,nature:p.nature,
      ability_index:p.abilityIndex,ability:p.getAbility().id,passives:p.getPassiveAbilities().map(a=>a?.id??null),passive_active:p.hasPassive(),
      ivs:[...p.ivs],stats:[...p.stats],hp:p.hp,gender:p.gender,shiny:p.shiny,variant:p.variant,
      temp_turn_count:p.tempSummonData.turnCount,temp_wave_turn_count:p.tempSummonData.waveTurnCount,
      moves:p.getMoveset().map(move=>({id:move.moveId,pp_used:move.ppUsed})),boss:p.isBoss()};
    expect(Phaser.Math.RND.state()).toBe(rng);return fact;
  }
  const frac=Phaser.Math.RND.frac,integer=Phaser.Math.RND.integerInRange;
  expect(vi.isMockFunction(frac)).toBe(false);expect(vi.isMockFunction(integer)).toBe(false);
  const fracSpy=vi.spyOn(Phaser.Math.RND,"frac").mockImplementation(function(){const value=frac.call(this);expect(draws.length).toBeLessThan(256);draws.push(["frac",value]);return value;});
  const intSpy=vi.spyOn(Phaser.Math.RND,"integerInRange").mockImplementation(function(min,max){const value=integer.call(this,min,max);expect(draws.length).toBeLessThan(256);draws.push(["integerInRange",min,max,value]);return value;});
  const cleanups:Array<()=>void>=[()=>fracSpy.mockRestore(),()=>intSpy.mockRestore()];
  function wrap<K extends "randomSpecies"|"addEnemyPokemon"|"generateEnemyModifiers"|"resetSeed">(key:K){
    const actual=scene[key];expect(vi.isMockFunction(actual)).toBe(false);
    const spy=vi.spyOn(scene,key).mockImplementation(function(...args:Parameters<typeof actual>){
      expect(trace.length).toBeLessThan(16);const row={method:key,start:draws.length,end:0,entry:Phaser.Math.RND.state(),exit:""};trace.push(row);
      const value=Reflect.apply(actual,scene,args);row.end=draws.length;row.exit=Phaser.Math.RND.state();
      if(key==="addEnemyPokemon")constructed.push(pokemonFact(value));return value;
    });cleanups.push(()=>spy.mockRestore());
  }
  for(const key of ["randomSpecies","addEnemyPokemon","generateEnemyModifiers","resetSeed"] as const)wrap(key);
  try{
    expect(pm.overridePhase(phase)).toBe(true);expect(pm.getCurrentPhase()).toBe(phase);
    // Use the actual manager mutation boundary and exact queued phase.start.
    // The interceptor's run waits for startCurrentPhase, whereas standby restore
    // deliberately does not restart the old CommandPhase, so await its identity.
    pm.prepareCurrentPhaseForStart();expect(vi.isMockFunction(phase.start)).toBe(false);phase.start();
    await vi.waitUntil(()=>pm.getCurrentPhase()===prior,{interval:10,timeout:10000});
    expect(pm.getCurrentPhase()).toBe(prior);expect(scene.currentBattle.turn).toBe(1);
    expect(constructed.length).toBe(1);expect(pm.hasPhaseOfType("InitEncounterPhase")).toBe(true);
    const result={scope:"direct dispatch of exact queued NextEncounterPhase via overridePhase; original CommandPhase restored as standby; no natural victory or queued successor execution",
      wave:scene.currentBattle.waveIndex,turn:scene.currentBattle.turn,prior:prior.phaseName,selected:phase.phaseName,restored_same_standby:true,
      before,after:Phaser.Math.RND.state(),draws,trace,constructed,prepared:scene.getEnemyParty().map(pokemonFact),
      modifiers:scene.enemyModifiers.map(m=>({id:m.type.id,class_name:m.constructor.name,stack:m.stackCount})),init_encounter_queued:true};
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(7500);return result;
  }finally{for(const cleanup of cleanups.reverse())cleanup();}
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
    const binder=binderFacts(scene);
    const context={wave:scene.currentBattle.waveIndex,turn:scene.currentBattle.turn,biome:scene.arena.biomeId,
      constructor:{seed:scene.seed,wave_seed:scene.waveSeed,battle_seed:scene.currentBattle.battleSeed,enemy_levels:scene.currentBattle.enemyLevels,level_calls:levelCalls,
        tuning:{wave_slope:erBalanceNum("vanilla.level.waveSlope"),quad_divisor:erBalanceNum("vanilla.level.quadDivisor"),boss_mult:erBalanceNum("vanilla.level.bossMult")}},
      balls:{counts:{...scene.pokeballCounts},maximum_per_type:MAX_PER_TYPE_POKEBALLS},
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
      binder,context,catalog,predicate_draws:predicateDraws,option_count:count,free_picks:freePicks,
      rng:{seed:seedRng,regenerated:regeneratedRng,generated:generatedRng},
      regeneration_draws:regenerationDraws,count_draws:countDraws,option_draws:optionDraws,options:serialized,identities,generator_calls:generatorCalls};
    for(const generatorSpy of generatorSpies)generatorSpy.mockRestore();spy.mockRestore();
    Phaser.Math.RND.state(originalRng);
    const nextBattle=observeDirectNextBattle();
    const encounter=await observeDirectQueuedEncounter();
    const bytes=Buffer.from(JSON.stringify({...data,direct_next_battle:nextBattle,direct_queued_encounter:encounter})+"\n");expect(bytes.length).toBeLessThanOrEqual(32768);
    writeFileSync(output,bytes,{flag:"wx"});
  } finally {for(const generatorSpy of generatorSpies)generatorSpy.mockRestore();spy.mockRestore();Phaser.Math.RND.state(originalRng);}
});
