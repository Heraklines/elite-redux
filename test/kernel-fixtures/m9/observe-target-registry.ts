import { allAbilities, allMoves } from "#data/data-lists";
import { ER_SHATTERED_PSYCHE_ABILITY_ID } from "#data/elite-redux/abilities/shattered-psyche";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { MoveFlags } from "#enums/move-flags";
import { MoveTarget } from "#enums/move-target";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

// Diagnostic only: actual initialized source registry, not a gameplay oracle.
// IDs are the complete ability/move union observed by the genuine Rust natural
// constructor in run 34373633488, plus NONE, SURF, RECOVER and STRUGGLE for
// explicitly identified later positive/negative targeting witnesses.
const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const SEED = "m9e-target-registry-source-v1";
const ABILITIES = [0, 18, 41, 43, 47, 49, 51, 62, 65, 66, 67, 75, 82, 94, 113, 172, 192, 257, 268, 5006, 5033, 5082, 5097, 5115];
const MOVES = [10, 33, 39, 40, 43, 45, 57, 61, 64, 78, 79, 98, 103, 105, 108, 110, 165, 230, 310, 331, 336, 448, 458, 497, 501, 541, 580];
let game: Phaser.Game | null = null;
let manager: GameManager | null = null;

afterAll(() => {
  manager?.promptHandler.clearPrompts();
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  game?.destroy(true);
});

test("observe actual initialized target capability registry", async () => {
  const output = process.env.M9_TARGET_REGISTRY_OUTPUT;
  if (output == null) throw new Error("M9_TARGET_REGISTRY_OUTPUT required");
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(PIN);
  game = new Phaser.Game({ type: Phaser.HEADLESS, seed: [SEED] });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  manager = new GameManager(game);
  manager.override.disableShinies = false;
  manager.override.normalizeIVs = false;
  manager.override.normalizeNatures = false;
  manager.override.shiny(null).enemyShiny(null).playerIVs(null).enemyIVs(null)
    .nature(null).enemyNature(null).battleStyle(BattleStyle.SET)
    .startingBiome(BiomeId.TOWN).startingWave(1).seed(SEED);
  await manager.classicMode.startBattle(SpeciesId.BULBASAUR);
  const abilities = ABILITIES.map(id => {
    const ability = allAbilities[id];
    expect(ability?.id).toBe(id);
    expect(vi.isMockFunction(ability.hasAttr)).toBe(false);
    expect(vi.isMockFunction(ability.getAttrs)).toBe(false);
    return {
      id, name: ability.name,
      attrs: ability.attrs.map(attr => attr.constructor.name),
      conditions: ability.conditions.length,
      meta_kinds: ability.attrs.flatMap(attr => "erMetaKind" in attr ? [attr.erMetaKind] : []),
      spread: ability.hasAttr("SpreadTargetByFlagAbAttr"),
      spread_flags: ability.getAttrs("SpreadTargetByFlagAbAttr").map(attr => attr.flag),
      redirect_types: ability.getAttrs("RedirectTypeMoveAbAttr").map(attr => attr.type),
      studio_capabilities: ability.attrs.flatMap(attr =>
        "abilityStudioCapability" in attr ? [attr.abilityStudioCapability] : []),
      studio_sources: ability.attrs.flatMap(attr =>
        "abilityStudioSourceAbilityId" in attr ? [attr.abilityStudioSourceAbilityId] : []),
      bypass_faint: ability.bypassFaint,
      suppressable: ability.suppressable,
      shattered_id: id === ER_SHATTERED_PSYCHE_ABILITY_ID,
    };
  });
  const moves = MOVES.map(id => {
    const move = allMoves[id];
    expect(move?.id).toBe(id);
    expect(vi.isMockFunction(move.hasAttr)).toBe(false);
    expect(vi.isMockFunction(move.hasFlag)).toBe(false);
    return {
      id, name: move.name, target: MoveTarget[move.moveTarget],
      attrs: move.attrs.map(attr => attr.constructor.name),
      variable: move.hasAttr("VariableTargetAttr"),
      multi_hit: move.hasAttr("MultiHitAttr"),
      pulse: move.hasFlag(MoveFlags.PULSE_MOVE),
    };
  });
  const raw = `${JSON.stringify({
    schema_version: 2, source_sha: PIN, seed: SEED,
    scope: "actual initialized registry diagnostic; no ability activation, target execution or neutrality claim",
    roster_source_sha: "f0a2b8c185a4e68dc88b4ea0b34128aeb8b28356",
    roster_run_id: "34373633488",
    roster_sha256: "52ed4b310f5f5fcb69a9ae17b1235d244a3719668fce7ef3c01a643be846e186",
    shattered_ability_id: ER_SHATTERED_PSYCHE_ABILITY_ID,
    abilities, moves,
  })}\n`;
  expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(32768);
  writeFileSync(output, raw, "utf8");
});
