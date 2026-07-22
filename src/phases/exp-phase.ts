import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { ExpBoosterModifier } from "#modifiers/modifier";
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

export class ExpPhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "ExpPhase";
  private expValue: number;

  constructor(partyMemberIndex: number, expValue: number) {
    super(partyMemberIndex);

    this.expValue = expValue;
  }

  start() {
    super.start();

    const pokemon = this.getPokemon();
    const exp = new NumberHolder(this.expValue);
    globalScene.applyModifiers(ExpBoosterModifier, true, exp);
    exp.value = Math.floor(exp.value);
    // Co-op animations-off FAST-FORWARD (replay pacing): in a co-op run with move animations disabled,
    // collapse the EXP dwell - reveal the gain line INSTANTLY (delay 0, no typewriter) and fill the EXP
    // gauge instantly (`updateInfo(true)`) instead of the multi-second bar animation. The PROMPT and the
    // add-exp / level-up sequence are UNCHANGED (only the human-pace WAIT is removed), so the phase and
    // any LevelUpPhase it unshifts run identically. Solo (isCoop false) and animations-on are byte-identical.
    const fastForward = globalScene.gameMode.isCoop && !globalScene.moveAnimations;
    globalScene.ui.showText(
      i18next.t("battle:expGain", {
        pokemonName: getPokemonNameWithAffix(pokemon),
        exp: exp.value,
      }),
      fastForward ? 0 : null,
      () => {
        const lastLevel = pokemon.level;
        pokemon.addExp(exp.value);
        const newLevel = pokemon.level;
        if (newLevel > lastLevel) {
          globalScene.phaseManager.unshiftNew("LevelUpPhase", this.partyMemberIndex, lastLevel, newLevel);
        }
        pokemon.updateInfo(fastForward).then(() => this.end());
      },
      null,
      true,
    );
  }
}
