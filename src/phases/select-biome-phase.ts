import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import {
  erBiomeRoutingActive,
  getErPendingNodes,
  getErPrevBiome,
  rollErNextBiomeNodes,
} from "#data/elite-redux/er-biome-routing";
import { consumeMapTravelTarget } from "#data/elite-redux/er-map-nodes";
import { BiomeId } from "#enums/biome-id";
import { ChallengeType } from "#enums/challenge-type";
import { UiMode } from "#enums/ui-mode";
import { MapModifier, MoneyInterestModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, getBiomeName, randSeedInt, randSeedItem } from "#utils/common";
import { enumValueToKey } from "#utils/enums";

export class SelectBiomePhase extends BattlePhase {
  public readonly phaseName = "SelectBiomePhase";

  start() {
    super.start();

    globalScene.resetSeed();

    const gameMode = globalScene.gameMode;
    const currentBiome = globalScene.arena.biomeId;
    const currentWaveIndex = globalScene.currentBattle.waveIndex;
    const nextWaveIndex = currentWaveIndex + 1;

    if (
      (gameMode.isClassic && gameMode.isWaveFinal(nextWaveIndex + 9))
      || (gameMode.isDaily && gameMode.isWaveFinal(nextWaveIndex))
      || (gameMode.hasShortBiomes && !(nextWaveIndex % 50))
    ) {
      this.setNextBiomeAndEnd(BiomeId.END);
      return;
    }

    // ER (#486): a travel event (The Storm / Ultra Wormhole / Echo Chamber) may
    // have set a destination from a revealed map node. Honor it for this single
    // transition, ahead of the normal biome links - but never over the run finale
    // (handled above, which returns before we consume the target).
    const travelTarget = consumeMapTravelTarget();
    if (travelTarget != null) {
      this.setNextBiomeAndEnd(travelTarget);
      return;
    }

    // ER (#486): the branching World Map graph. Build the next-biome node set
    // (base links + 50%-rolled unexpected adjacents, minus the biome we came
    // from, with reveal gated by Map Upgrade tier) and let the player choose.
    if (erBiomeRoutingActive()) {
      // Reuse the nodes rolled + shown on the map when this biome was entered, so
      // the chooser matches the overlay. Fall back to a fresh roll (e.g. run start).
      const pending = getErPendingNodes();
      const nodes = pending.length > 0 ? pending : rollErNextBiomeNodes(currentBiome, getErPrevBiome());
      const revealed = nodes.filter(n => n.revealed);
      if (revealed.length > 1) {
        // Present the choice as the branching World Map node picker (#486). Only the
        // REVEALED nodes are offered - the extra (green) "upgrade" node appears ONLY
        // when a Map Upgrade item actually reveals it; we no longer surface locked
        // "???" placeholders, so a player with no Map Upgrade never sees an
        // upgrade slot (the #542 fix for "I get the map-upgrade node regardless").
        // Use the full World Map screen (journey chain + biome thumbnails) as the
        // route chooser, in pick mode - the same view the J hotkey shows, but here
        // the onward tiles are selectable (#486: "let me pick from the world map").
        globalScene.ui.setMode(UiMode.ER_MAP, {
          nodes: revealed,
          origin: currentBiome,
          onSelect: (biome: BiomeId) => this.setNextBiomeAndEnd(biome),
        });
      } else {
        this.setNextBiomeAndEnd(revealed[0].biome);
      }
      return;
    }

    if (gameMode.hasRandomBiomes) {
      this.setNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
      return;
    }

    const { biomeLinks } = allBiomes.get(currentBiome);
    if (biomeLinks.length > 1) {
      const biomes: BiomeId[] = biomeLinks
        .filter(b => !Array.isArray(b) || !randSeedInt(b[1]))
        .map(b => (Array.isArray(b) ? b[0] : b));

      if (biomes.length > 1 && globalScene.findModifier(m => m instanceof MapModifier)) {
        const biomeSelectItems = biomes.map(b => {
          return {
            label: getBiomeName(b),
            handler: () => {
              globalScene.ui.setMode(UiMode.MESSAGE);
              this.setNextBiomeAndEnd(b);
              return true;
            },
          } satisfies OptionSelectItem as OptionSelectItem;
        });
        globalScene.ui.setMode(UiMode.OPTION_SELECT, {
          options: biomeSelectItems,
          delay: 1000,
        });
      } else {
        this.setNextBiomeAndEnd(randSeedItem(biomes));
      }
      return;
    }

    if (biomeLinks.length === 1) {
      if (Array.isArray(biomeLinks[0])) {
        console.warn(
          "Biomes with a link to a single other biome should not have a weight assigned to the link.\n",
          "Biome:",
          enumValueToKey(BiomeId, allBiomes.get(currentBiome).biomeId),
          "| Links:",
          biomeLinks,
        );
        // @ts-expect-error: failsafe for invalid biome links structure
        biomeLinks[0] = biomeLinks[0][0];
      }
      this.setNextBiomeAndEnd(biomeLinks[0] as BiomeId);
      return;
    }

    this.setNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
  }

  private generateNextBiome(waveIndex: number): BiomeId {
    return waveIndex % 50 === 0 ? BiomeId.END : globalScene.generateRandomBiome(waveIndex);
  }

  private setNextBiomeAndEnd(nextBiome: BiomeId): void {
    const gameMode = globalScene.gameMode;
    const currentWaveIndex = globalScene.currentBattle.waveIndex;
    const nextWaveIndex = currentWaveIndex + 1;

    // ER (#486): with variable biome length the biome start is no longer at
    // %10+1. But SelectBiomePhase only runs at a REAL biome transition (it is
    // pushed when isNewBiome() is true), so under the gate the heal/interest
    // always fires here - exactly once per biome start. Vanilla keeps the %10
    // check for daily / endless / random which share this phase.
    if (erBiomeRoutingActive() || nextWaveIndex % 10 === 1) {
      globalScene.applyModifiers(MoneyInterestModifier, true);
      const healStatus = new BooleanHolder(true);
      applyChallenges(ChallengeType.PARTY_HEAL, healStatus);
      if (healStatus.value) {
        globalScene.phaseManager.unshiftNew("PartyHealPhase", false);
      } else {
        globalScene.phaseManager.unshiftNew(
          "SelectModifierPhase",
          undefined,
          undefined,
          gameMode.isFixedBattle(currentWaveIndex)
            ? gameMode.getFixedBattle(currentWaveIndex)?.customModifierRewardSettings
            : undefined,
        );
      }
    }
    globalScene.phaseManager.unshiftNew("SwitchBiomePhase", nextBiome);
    this.end();
  }
}
