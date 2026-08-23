import { globalScene } from "#app/global-scene";
import { hasErEndlessRift } from "#data/elite-redux/er-endless-continuation";
import { clearAllErStatuses } from "#data/elite-redux/er-status-cure";
import { ChallengeType } from "#enums/challenge-type";
import { BattlePhase } from "#phases/battle-phase";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, fixedInt } from "#utils/common";

// Audio metadata is presentation input, never progression authority.  A decoded WebAudio
// object can exist while reporting a bogus/very large duration (seen in real Chromium), so
// never let that value retain the automatic biome-transition phase indefinitely.
const MAX_HEAL_PRESENTATION_MS = 12_000;

export class PartyHealPhase extends BattlePhase {
  public readonly phaseName = "PartyHealPhase";
  private resumeBgm: boolean;

  constructor(resumeBgm: boolean) {
    super();

    this.resumeBgm = resumeBgm;
  }

  start() {
    super.start();

    const bgmPlaying = globalScene.isBgmPlaying();
    if (bgmPlaying) {
      globalScene.fadeOutBgm(1000, false);
    }
    globalScene.ui.fadeOut(1000).then(() => {
      const preventRevive = new BooleanHolder(false);
      applyChallenges(ChallengeType.PREVENT_REVIVE, preventRevive);
      const restless = hasErEndlessRift("restless-checkpoints");
      for (const pokemon of globalScene.getPlayerParty()) {
        // Prevent reviving fainted pokemon during certain challenges
        if (pokemon.isFainted() && preventRevive.value) {
          continue;
        }

        if (restless) {
          pokemon.hp = pokemon.isFainted()
            ? Math.max(1, Math.floor(pokemon.getMaxHp() * 0.25))
            : pokemon.hp + Math.ceil((pokemon.getMaxHp() - pokemon.hp) * 0.5);
        } else {
          pokemon.hp = pokemon.getMaxHp();
        }
        pokemon.resetStatus(true, false, false, true);
        // The between-wave rest is a full restore, so it also clears ER custom statuses
        // (Bleed / Frostbite / Fear) which vanilla resetStatus does not touch.
        clearAllErStatuses(pokemon);
        for (const move of pokemon.moveset) {
          move.ppUsed = restless ? Math.floor(move.ppUsed * 0.5) : 0;
        }
        pokemon.updateInfo(true);
      }
      const finish = () => {
        if (this.resumeBgm && bgmPlaying) {
          globalScene.playBgm();
        }
        globalScene.ui.fadeIn(500).then(() => this.end());
      };
      const healSong = globalScene.playSoundWithoutBgm("heal", fixedInt(MAX_HEAL_PRESENTATION_MS));
      if (!healSong) {
        // Browsers can legitimately refuse or fail to construct a sound (muted/headless/autoplay policy).
        // The old branch left the screen black and retained PartyHealPhase forever in that case.
        finish();
        return;
      }
      const reportedDurationMs = healSong.totalDuration * 1000;
      const presentationDurationMs =
        Number.isFinite(reportedDurationMs) && reportedDurationMs > 0
          ? Math.min(reportedDurationMs, MAX_HEAL_PRESENTATION_MS)
          : 0;
      globalScene.time.delayedCall(fixedInt(presentationDurationMs), () => {
        healSong.destroy();
        finish();
      });
    });
    globalScene.arena.playerTerasUsed = 0;
  }
}
