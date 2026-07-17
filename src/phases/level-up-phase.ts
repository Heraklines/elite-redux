import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { isCoopAuthoritativeGuest } from "#data/elite-redux/coop/coop-runtime";
import { isErOmniformMon, omniformUnionLevelMoves } from "#data/elite-redux/omniform-movesets";
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
  /**
   * Frozen stat snapshots from a caller that already advanced the level AND
   * recalculated stats (Rare Candy - see PokemonLevelIncrementModifier). When
   * present, the phase displays these instead of snapshotting/recalculating live
   * stats, so several level-ups queued back-to-back each show their own correct
   * delta instead of one screen showing the whole gain and the rest showing +0.
   */
  protected preStats: number[] | undefined;
  protected postStats: number[] | undefined;

  constructor(partyMemberIndex: number, lastLevel: number, level: number, preStats?: number[], postStats?: number[]) {
    super(partyMemberIndex);

    this.lastLevel = lastLevel;
    this.level = level;
    this.preStats = preStats;
    this.postStats = postStats;
  }

  public override start() {
    super.start();

    if (this.level > globalScene.gameData.gameStats.highestLevel) {
      globalScene.gameData.gameStats.highestLevel = this.level;
    }

    globalScene.validateAchvs(LevelAchv, new NumberHolder(this.level));

    // If the caller already advanced the level + recalculated (Rare Candy), use
    // its frozen snapshots; otherwise snapshot + recalc live (the normal exp flow).
    const prevStats = this.preStats ?? this.pokemon.stats.slice(0);
    if (!this.preStats) {
      this.pokemon.calculateStats();
    }
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
            .promptLevelUpStats(this.partyMemberIndex, prevStats, false, this.postStats)
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
        .promptLevelUpStats(this.partyMemberIndex, prevStats, false, this.postStats)
        .then(() => this.end());
    }
  }

  public override end() {
    if (this.lastLevel < 100) {
      // this feels like an unnecessary optimization
      const pokemon = this.getPokemon();
      // ER Omniform (#partner-eevee): a partner mon switches between eeveelution forms
      // via Omniform and can be in ANY form when it levels up, so its level-up OFFER is
      // the pooled UNION of every family member's level-up learnset (each move at its
      // minimum level), NOT just the current form's kit — otherwise a move only one
      // eeveelution learns would be missed whenever the mon is in a different form. The
      // batch panel then expands each offered move per evolution. Co-op is out of scope
      // (the shared batch path is untouched). Gated on `isErOmniformMon`, so a normal
      // mon's candidate set is byte-identical to `getLevelMoves`.
      const candidateMoveIds =
        !globalScene.gameMode.isCoop && isErOmniformMon(pokemon)
          ? omniformUnionLevelMoves(pokemon)
              .filter(([lvl]) => lvl >= this.lastLevel + 1 && lvl <= pokemon.level)
              .map(([, moveId]) => moveId)
          : pokemon.getLevelMoves(this.lastLevel + 1).map(lm => lm[1]);
      if (candidateMoveIds.length > 0) {
        // ER QoL: ONE interactive Move Learn panel for the whole level-up instead of
        // the per-move text barrage. The panel is FAIL-SAFE - any error opening or
        // operating it falls back to the per-move LearnMovePhase flow, so it can never
        // softlock. TMs, the egg/Memory tutor, the relearner and evolution moves still
        // use LearnMovePhase directly.
        globalScene.phaseManager.unshiftNew("LearnMoveBatchPhase", this.partyMemberIndex, candidateMoveIds);
      }
    }
    // Co-op authoritative (#633 B6): the GUEST is a pure renderer; the HOST owns evolution. A
    // guest-side evolve would construct a per-client mon (its own RNG id / form path) and diverge -
    // the guest adopts the host's evolved species + moveset via the B5 exp deltas (same slot) / the
    // resync benchParty (the evolving slot's species heals there, gated by the exp-delta speciesId
    // guard until then). Skip on the authoritative guest ONLY; solo / host / lockstep are unchanged.
    // Co-op authoritative GUEST: SKIP the evolution gate (host owns evolution; guest adopts the
    // evolved species via B5 exp deltas / resync benchParty). Log on the guest only - solo / host /
    // lockstep never enter this branch (isCoopAuthoritativeGuest() is hard false there).
    if (isCoopAuthoritativeGuest()) {
      coopLog(
        "progression",
        `GUEST EvolutionPhase SKIP slot=${this.partyMemberIndex} mon=${this.pokemon.name} lv=${this.pokemon.level} (host owns evolution)`,
      );
    }
    if (!this.pokemon.pauseEvolutions && !isCoopAuthoritativeGuest()) {
      const evolutions = this.pokemon.getValidEvolutions();
      if (evolutions.length > 0 && globalScene.gameMode.isCoop) {
        // HOST in co-op drives the real evolve; log the candidate so the guest's adopted species
        // can be checked against it. Solo stays silent (the isCoop guard).
        coopLog(
          "progression",
          `HOST EvolutionPhase DRIVE slot=${this.partyMemberIndex} mon=${this.pokemon.name} -> evo=${evolutions[0].speciesId} candidates=${evolutions.length}`,
        );
      }
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
