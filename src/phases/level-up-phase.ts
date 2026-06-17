import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { ExpNotification } from "#enums/exp-notification";
import type { PlayerPokemon } from "#field/pokemon";
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import { LevelAchv } from "#system/achv";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

export class LevelUpPhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "LevelUpPhase";
  protected lastLevel: number;
  protected level: number;
  protected pokemon: PlayerPokemon = this.getPlayerPokemon();

  constructor(partyMemberIndex: number, lastLevel: number, level: number) {
    super(partyMemberIndex);

    this.lastLevel = lastLevel;
    this.level = level;
  }

  public override start() {
    super.start();

    if (this.level > globalScene.gameData.gameStats.highestLevel) {
      globalScene.gameData.gameStats.highestLevel = this.level;
    }

    globalScene.validateAchvs(LevelAchv, new NumberHolder(this.level));

    const prevStats = this.pokemon.stats.slice(0);
    this.pokemon.calculateStats();
    this.pokemon.updateInfo();
    if (globalScene.expParty === ExpNotification.DEFAULT) {
      globalScene.playSound("level_up_fanfare");
      globalScene.ui.showText(
        i18next.t("battle:levelUp", {
          pokemonName: getPokemonNameWithAffix(this.pokemon),
          level: this.level,
        }),
        null,
        () =>
          globalScene.ui
            .getMessageHandler()
            .promptLevelUpStats(this.partyMemberIndex, prevStats, false)
            .then(() => this.end()),
        null,
        true,
      );
    } else if (globalScene.expParty === ExpNotification.SKIP) {
      this.end();
    } else {
      // we still want to display the stats if activated
      globalScene.ui
        .getMessageHandler()
        .promptLevelUpStats(this.partyMemberIndex, prevStats, false)
        .then(() => this.end());
    }
  }

  public override end() {
    if (this.lastLevel < 100) {
      // this feels like an unnecessary optimization
      const levelMoves = this.getPokemon().getLevelMoves(this.lastLevel + 1);
      if (levelMoves.length > 0) {
        // ER QoL: ONE interactive Move Learn panel for the whole level-up instead
        // of the per-move text barrage. The panel filters out already-known/dupe
        // moves and skips itself when nothing new is offerable. TMs, the egg/Memory
        // tutor, the relearner and evolution moves still use LearnMovePhase.
        globalScene.phaseManager.unshiftNew(
          "LearnMoveBatchPhase",
          this.partyMemberIndex,
          levelMoves.map(lm => lm[1]),
        );
      }
    }
    if (!this.pokemon.pauseEvolutions) {
      const evolutions = this.pokemon.getValidEvolutions();
      if (evolutions.length > 0) {
        this.pokemon.breakIllusion();
        // Pass the full candidate set so the phase prompts for a path when the
        // line currently offers more than one valid evolution (branched evos).
        globalScene.phaseManager.unshiftNew(
          "EvolutionPhase",
          this.pokemon,
          evolutions[0],
          this.lastLevel,
          true,
          evolutions,
        );
      }
    }
    return super.end();
  }
}
