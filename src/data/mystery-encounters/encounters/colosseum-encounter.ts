/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - a press-your-luck trainer gauntlet mystery encounter.
//
// You enter a dojo/arena and fight a 15-round gauntlet ROLLED from the active
// run's own difficulty pools (see colosseum-gauntlet.ts): normal trainers ->
// real player GHOST teams -> boss trainers -> gym leaders -> strong/deadliest
// ghosts -> a Champion. After EACH win you choose CONTINUE (risk it for a higher
// reward GRADE) or CASH OUT (bank the current grade and leave). The grade ramps
// one rung per round across D..EX; clearing all 15 auto-awards EX. Survivors are
// patched to half HP between rounds (statuses are NOT cured); lose and the prize
// is gone. Injected teams fight at FULL power (BST cap bypassed) re-levelled to
// your strongest party member. Built on the Winstrate consecutive-battle pattern
// (doContinueEncounter); the choice surfaces through the bespoke ColosseumUiHandler.
// =============================================================================

import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { setErColosseumBattleActive } from "#data/elite-redux/er-trainer-runtime-hook";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { TextStyle } from "#enums/text-style";
import { TrainerVariant } from "#enums/trainer-variant";
import { getBiomeKey } from "#field/arena";
import {
  buildColosseumGauntlet,
  type ColosseumChallenger,
  colosseumRoundConfig,
  MAX_ROUNDS,
} from "#mystery-encounters/colosseum-gauntlet";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { colosseumHeadSprite } from "#ui/colosseum-ui-handler";
import { addTextObject } from "#ui/text";
import i18next from "i18next";

/** The i18n namespace for the encounter. */
const namespace = "mysteryEncounters/colosseum";

export { MAX_ROUNDS };

/**
 * Display tier ladder, lowest first - one rung per round, with "+" gradations and
 * SS/SSS prestige steps near the top. The banked tier after N wins is LADDER[N-1].
 */
export const TIER_LADDER = ["D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+", "SS", "SS+", "SSS", "SSS+", "EX"];

/**
 * Each display rung maps to an engine ModifierTier for the reward SHOP. The
 * engine only has COMMON..MASTER, so rarity ramps COMMON -> MASTER over the first
 * nine rungs and then SATURATES at MASTER; the SS/SSS/EX rungs keep escalating
 * the shop SIZE instead (see colosseumShopSize).
 */
const TIER_TO_MODIFIER: ModifierTier[] = [
  ModifierTier.COMMON, // D
  ModifierTier.COMMON, // D+
  ModifierTier.GREAT, // C
  ModifierTier.GREAT, // C+
  ModifierTier.ULTRA, // B
  ModifierTier.ULTRA, // B+
  ModifierTier.ROGUE, // A
  ModifierTier.ROGUE, // A+
  ModifierTier.MASTER, // S
  ModifierTier.MASTER, // S+
  ModifierTier.MASTER, // SS
  ModifierTier.MASTER, // SS+
  ModifierTier.MASTER, // SSS
  ModifierTier.MASTER, // SSS+
  ModifierTier.MASTER, // EX
];

/** Cash-out reward-shop size for a display-tier index (0..14): 3 -> 8 slots. */
function colosseumShopSize(tierIndex: number): number {
  return Math.min(3 + Math.floor(tierIndex / 2), 8);
}

/** The rolled gauntlet for the current encounter (stored on encounter.misc). */
function getGauntlet(): ColosseumChallenger[] {
  return (globalScene.currentBattle.mysteryEncounter?.misc?.gauntlet as ColosseumChallenger[]) ?? [];
}

/**
 * Make every gauntlet battle take place in the DOJO arena - a real, correctly
 * aligned PokeRogue battle background + bases, so the fights read as a tournament
 * venue. Pure visual swap (all biome arena assets are preloaded).
 */
function applyColosseumArena(): void {
  const biome = BiomeId.DOJO;
  globalScene.arenaBg.setTexture(`${getBiomeKey(biome)}_bg`);
  globalScene.arenaPlayer.setBiome(biome);
  globalScene.arenaEnemy.setBiome(biome);
  globalScene.arenaNextEnemy.setBiome(biome);
}

/** Load a challenger's trainer-class atlas so its portrait/sprite can render. */
async function ensureTrainerSprite(challenger: ColosseumChallenger): Promise<void> {
  try {
    await trainerConfigs[challenger.trainerType]?.loadAssets(TrainerVariant.DEFAULT);
  } catch {
    /* portrait falls back to a silhouette if the atlas can't load */
  }
}

/**
 * BW2 PWT-style "VS" splash before each battle: the gold crest, "CHALLENGER N /
 * 15", a big VS, and the upcoming foe's class portrait + name. Self-contained
 * overlay that fades in, holds ~1.3s, fades out, and resolves.
 */
function showColosseumVs(round: number, challenger: ColosseumChallenger): Promise<void> {
  return new Promise(resolve => {
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const c = globalScene.add.container(0, 0);
    c.add(globalScene.add.rectangle(0, 0, w, h, 0x0a0e18, 1).setOrigin(0));

    if (globalScene.textures.exists("er_pwt_crest")) {
      const crest = globalScene.add.image(w / 2, 6, "er_pwt_crest");
      crest.setOrigin(0.5, 0);
      crest.setScale(30 / 123);
      crest.setAlpha(0.9);
      c.add(crest);
    }

    const top = addTextObject(w / 2, 40, `CHALLENGER ${round} / ${MAX_ROUNDS}`, TextStyle.WINDOW, { fontSize: "50px" });
    top.setOrigin(0.5, 0);
    top.setTint(0xf8d030);
    c.add(top);

    const vs = addTextObject(w / 2, h / 2 - 46, "VS", TextStyle.WINDOW, { fontSize: "96px" });
    vs.setOrigin(0.5, 0.5);
    vs.setTint(0xf85040);
    c.add(vs);

    // The upcoming challenger's class figure, large + centred (origin top-centre).
    const face = colosseumHeadSprite(challenger.spriteKey, 54);
    if (face) {
      face.setPosition(w / 2, h / 2 - 26);
      c.add(face);
    }

    const foe = addTextObject(w / 2, h / 2 + 36, challenger.name, TextStyle.WINDOW, { fontSize: "64px" });
    foe.setOrigin(0.5, 0);
    c.add(foe);

    globalScene.ui.add(c);
    c.setAlpha(0);
    globalScene.tweens.add({ targets: c, alpha: 1, duration: 220 });
    globalScene.time.delayedCall(1300, () => {
      globalScene.tweens.add({
        targets: c,
        alpha: 0,
        duration: 220,
        onComplete: () => {
          c.destroy(true);
          resolve();
        },
      });
    });
  });
}

/**
 * Start one gauntlet battle: preload the challenger's sprite, show the VS splash,
 * then init the battle with the BST cap bypassed (so curated boss/gym/champion/
 * ghost teams fight at full power). The bypass flag is set ONLY around enemy
 * construction (which happens synchronously inside initBattleWithEnemyConfig).
 */
async function startColosseumBattle(round: number): Promise<void> {
  const challenger = getGauntlet()[round - 1];
  if (!challenger) {
    return;
  }
  await ensureTrainerSprite(challenger);
  await showColosseumVs(round, challenger);
  setErColosseumBattleActive(true);
  try {
    await initBattleWithEnemyConfig(colosseumRoundConfig(challenger));
  } finally {
    setErColosseumBattleActive(false);
  }
}

export const ColosseumEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.COLOSSEUM,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(40, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[1])
  .withScenePartySizeRequirement(2, 6)
  .withMaxAllowedEncounters(1)
  .withIntroSpriteConfigs([
    {
      spriteKey: "black_belt_m",
      fileRoot: "trainer",
      hasShadow: true,
      x: 0,
      y: 0,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
  .withAutoHideIntroVisuals(false)
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.misc = { wins: 0, gauntlet: [] };
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.1.selected`,
        },
      ],
    },
    async () => {
      // Enter the gauntlet. Roll the per-mode lineup, then use the Winstrate
      // pattern: doContinueEncounter fires after every won battle so the encounter
      // never ends until we clear the hook. The CONTINUE / CASH OUT choice MUST be
      // a real phase (not a setMode opened from inside this callback) - doing UI
      // transitions from within the awaited rewards-phase callback raced the fade
      // system and softlocked the next trainer's intro dialogue (#439).
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      const gauntlet = await buildColosseumGauntlet();
      encounter.misc = { wins: 0, gauntlet };
      encounter.doContinueEncounter = async () => {
        const enc = globalScene.currentBattle.mysteryEncounter!;
        enc.misc.wins += 1;
        halfHealSurvivors();
        if (enc.misc.wins >= MAX_ROUNDS) {
          await endColosseum(enc.misc.wins);
        } else {
          globalScene.phaseManager.unshiftNew("ColosseumChoicePhase", enc.misc.wins);
        }
      };
      await transitionMysteryEncounterIntroVisuals(true, false);
      applyColosseumArena();
      await startColosseumBattle(1);
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    },
    async () => {
      // Decline - leave with nothing.
      leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
    },
  )
  .build();

/**
 * Reset per-battle/arena state and start the next gauntlet battle. Mirrors the
 * Winstrate between-battle reset so carried-over weather/tags/tera don't corrupt
 * the next fight. `round` is the upcoming (1-indexed) battle number. Called by
 * ColosseumChoicePhase when the player picks CONTINUE.
 */
export async function startNextColosseumBattle(round: number): Promise<void> {
  const playerField = globalScene.getPlayerField();
  for (const pokemon of playerField) {
    pokemon.lapseTag(BattlerTagType.COMMANDED);
  }
  playerField.forEach((_, p) => globalScene.phaseManager.unshiftNew("ReturnPhase", p));

  globalScene.arena.resetArenaEffects();
  for (const pokemon of globalScene.getPlayerParty()) {
    pokemon.resetBattleAndWaveData();
    applyAbAttrs("PostBattleInitAbAttr", { pokemon });
  }

  globalScene.phaseManager.unshiftNew("ShowTrainerPhase");
  applyColosseumArena();
  await startColosseumBattle(round);
}

/**
 * Heal each STILL-STANDING party member up to at least half HP (no status cure).
 * Fainted members stay down - that's the gauntlet's risk.
 */
function halfHealSurvivors(): void {
  for (const pokemon of globalScene.getPlayerParty()) {
    if (pokemon.hp <= 0) {
      continue;
    }
    const half = Math.floor(pokemon.getMaxHp() / 2);
    if (pokemon.hp < half) {
      pokemon.hp = half;
      pokemon.updateInfo();
    }
  }
}

/**
 * End the gauntlet: clear the continue hook, pay out the money for the reached
 * tier, and open an ESCALATING GUARANTEED-RARITY reward shop - every slot locked
 * to the banked tier's engine rarity (D = a full shop of commons, ramping to a
 * full shop of MASTER-tier items by S/SS/SSS/EX), with the slot count also
 * growing the deeper you went. Then leave the encounter.
 */
export async function endColosseum(reachedRound: number): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.doContinueEncounter = undefined;
  setErColosseumBattleActive(false);

  const tierIdx = Math.min(reachedRound, MAX_ROUNDS) - 1;
  const tierLabel = TIER_LADDER[tierIdx];
  const shopTier = TIER_TO_MODIFIER[tierIdx];
  const shopSize = colosseumShopSize(tierIdx);

  const money = globalScene.getWaveMoneyAmount(1 + reachedRound);
  globalScene.addMoney(money);

  await showEncounterText(i18next.t(`${namespace}:reward`, { tier: tierLabel, money }));

  setEncounterRewards({
    guaranteedModifierTiers: new Array(shopSize).fill(shopTier),
    fillRemaining: false,
  });
  leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
}
