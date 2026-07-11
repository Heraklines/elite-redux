import { globalScene } from "#app/global-scene";
import {
  erBiomeRoutingActive,
  erRecordBiomeEntry,
  getErPrevBiome,
  rollErNextBiomeNodes,
  setErPendingNodes,
} from "#data/elite-redux/er-biome-routing";
import { erRollBiomeLength } from "#data/elite-redux/er-biome-structure";
import { clearErBiomeNodes, revealMapNodes } from "#data/elite-redux/er-map-nodes";
import type { BiomeId } from "#enums/biome-id";
import { getBiomeKey } from "#field/arena";
import { BattlePhase } from "#phases/battle-phase";
import { getBiomeName } from "#utils/common";

export class SwitchBiomePhase extends BattlePhase {
  public readonly phaseName = "SwitchBiomePhase";
  private nextBiome: BiomeId;

  constructor(nextBiome: BiomeId) {
    super();

    this.nextBiome = nextBiome;
  }

  start() {
    super.start();

    if (this.nextBiome === undefined) {
      return this.end();
    }

    // ER (#486): record the biome we're leaving as the "previous" biome, so the
    // World Map routing graph can exclude it from the NEXT transition's options.
    // Only fires on real transitions (not run start / save load).
    erRecordBiomeEntry(globalScene.arena?.biomeId ?? null);

    // Roll the NEW biome's onward routes now and stash them, so (a) the map
    // overlay shows the player's routes while in this biome and (b) the leave
    // transition reuses the same set instead of re-rolling. Reveal only the
    // visible (Map-Upgrade-gated) nodes; clear the prior biome's stale routes.
    if (erBiomeRoutingActive()) {
      const nodes = rollErNextBiomeNodes(this.nextBiome, getErPrevBiome());
      setErPendingNodes(nodes);
      clearErBiomeNodes();
      revealMapNodes(
        nodes
          .filter(n => n.revealed)
          .map(n => ({ biome: n.biome, label: getBiomeName(n.biome), kind: "biome" as const })),
      );

      // ER (#486): roll THIS biome's variable length + record its start wave. The
      // new biome's first battle is the wave AFTER the boundary we just cleared.
      erRollBiomeLength(this.nextBiome, (globalScene.currentBattle?.waveIndex ?? 0) + 1, globalScene.seed);
    }

    // Before switching biomes, make sure to set the last encounter for other phases that need it too.
    globalScene.lastEnemyTrainer = globalScene.currentBattle?.trainer ?? null;
    globalScene.lastMysteryEncounter = globalScene.currentBattle?.mysteryEncounter;

    globalScene.tweens.add({
      targets: [globalScene.arenaEnemy, globalScene.lastEnemyTrainer],
      x: "+=300",
      duration: 2000,
      onComplete: () => {
        globalScene.arenaEnemy.setX(globalScene.arenaEnemy.x - 600);

        globalScene.newArena(this.nextBiome);

        const biomeKey = getBiomeKey(this.nextBiome);
        const bgTexture = `${biomeKey}_bg`;
        globalScene.arenaBgTransition.setTexture(bgTexture);
        globalScene.arenaBgTransition.setAlpha(0);
        globalScene.arenaBgTransition.setVisible(true);
        globalScene.arenaPlayerTransition.setBiome(this.nextBiome);
        globalScene.arenaPlayerTransition.setAlpha(0);
        globalScene.arenaPlayerTransition.setVisible(true);

        globalScene.tweens.add({
          targets: [globalScene.arenaPlayer, globalScene.arenaBgTransition, globalScene.arenaPlayerTransition],
          duration: 1000,
          delay: 1000,
          ease: "Sine.easeInOut",
          alpha: (target: any) => (target === globalScene.arenaPlayer ? 0 : 1),
          onComplete: () => {
            globalScene.arenaBg.setTexture(bgTexture);
            globalScene.arenaPlayer.setBiome(this.nextBiome);
            globalScene.arenaPlayer.setAlpha(1);
            globalScene.arenaEnemy.setBiome(this.nextBiome);
            globalScene.arenaEnemy.setAlpha(1);
            globalScene.arenaNextEnemy.setBiome(this.nextBiome);
            globalScene.arenaBgTransition.setVisible(false);
            globalScene.arenaPlayerTransition.setVisible(false);
            if (globalScene.lastEnemyTrainer) {
              globalScene.lastEnemyTrainer.destroy();
            }

            this.end();
          },
        });
      },
    });
  }
}
