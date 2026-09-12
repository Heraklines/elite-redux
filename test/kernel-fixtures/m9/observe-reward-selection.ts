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
  await manager.classicMode.startBattle(SpeciesId.BULBASAUR);
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
  try {
    const context={wave:scene.currentBattle.waveIndex,turn:scene.currentBattle.turn,biome:scene.arena.biomeId,
      constructor:{seed:scene.seed,wave_seed:scene.waveSeed,battle_seed:scene.currentBattle.battleSeed,enemy_levels:scene.currentBattle.enemyLevels,
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
    const options=phase.getModifierTypeOptions(count);
    expect(options.length).toBe(3);
    const generatedRng=Phaser.Math.RND.state();
    const optionDraws=draws.splice(0);
    const serialized=serializeRewardOptions(options);
    const identities=options.map(option=>({name:option.type.name,group:option.type.group??null}));
    expect(Phaser.Math.RND.state()).toBe(generatedRng);
    // Direct source predicate values are an input-conditioned catalog, not a
    // substitute for regenerate's saturation/generator filtering algorithm.
    const pool=getModifierPoolForType(ModifierPoolType.PLAYER);
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
    const data={schema_version:1,source_sha:PIN,seed:SEED,
      scope:"actual initialized pool predicates and direct SelectModifierPhase generation methods; not a post-victory state or applied reward",
      context,catalog,predicate_draws:predicateDraws,option_count:count,free_picks:freePicks,
      rng:{seed:seedRng,regenerated:regeneratedRng,generated:generatedRng},
      regeneration_draws:regenerationDraws,count_draws:countDraws,option_draws:optionDraws,options:serialized,identities};
    const bytes=Buffer.from(JSON.stringify(data)+"\n");expect(bytes.length).toBeLessThanOrEqual(32768);
    writeFileSync(output,bytes,{flag:"wx"});
  } finally {spy.mockRestore();Phaser.Math.RND.state(originalRng);}
});
