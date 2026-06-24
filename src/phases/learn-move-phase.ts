import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import Overrides from "#app/overrides";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { allMoves } from "#data/data-lists";
import { getCoopController, getCoopInteractionRelay, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import i18next from "i18next";

// Co-op (#633): the move-replace ("which move to forget") menu is an OWNED, shared screen.
// Only the player whose mon is learning the move drives it; the partner watches and mirrors
// the result so both clients transition together. All relayed on one dedicated seq (FIFO,
// distinct from the small interaction-turn seqs the reward shop uses).
const COOP_LEARN_MOVE_SEQ = 9_000_001;
/** How long the watcher waits for the owner's move-replace decision before giving up. */
const COOP_LEARN_MOVE_WAIT_MS = 300_000;

export class LearnMovePhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "LearnMovePhase";
  private moveId: MoveId;
  private messageMode: UiMode;
  private learnMoveType: LearnMoveType;
  private cost: number;

  constructor(
    partyMemberIndex: number,
    moveId: MoveId,
    learnMoveType: LearnMoveType = LearnMoveType.LEARN_MOVE,
    cost = -1,
  ) {
    super(partyMemberIndex);
    this.moveId = moveId;
    this.learnMoveType = learnMoveType;
    this.cost = cost;
  }

  start() {
    super.start();

    const pokemon = this.getPokemon();
    const move = allMoves[this.moveId];
    // Use the REAL moveset (ignoreOverride=true), not the MOVESET_OVERRIDE view:
    // a stale dev/scenario override makes getMoveset() return moves the mon
    // doesn't actually have, so the "already knows it" check below never matched
    // the just-learned level-up move -> LevelUpPhase re-queued it forever (the
    // run-blocking infinite move-learn loop, e.g. Latios past lv 37).
    const currentMoveset = pokemon.getMoveset(true);

    // The game first checks if the Pokemon already has the move and ends the phase if it does.
    const hasMoveAlready = currentMoveset.some(m => m.moveId === move.id) && this.moveId !== MoveId.SKETCH;
    if (hasMoveAlready) {
      return this.end();
    }

    this.messageMode =
      globalScene.ui.getHandler() instanceof EvolutionSceneUiHandler ? UiMode.EVOLUTION_SCENE : UiMode.MESSAGE;
    globalScene.ui.setMode(this.messageMode);
    // If the Pokemon has an empty move slot, the new move is added to the largest empty moveset index.
    // Otherwise the phase checks if the player wants to replace a move. The cap is normally 4 but ER's
    // "5th move slot" consumable can raise it (see Pokemon.getMaxMoveCount).
    if (currentMoveset.length < pokemon.getMaxMoveCount()) {
      // Empty slot: the move auto-learns identically on both clients (deterministic), so
      // co-op needs no relay here.
      this.learnMove(currentMoveset.length, move, pokemon);
    } else if (this.coopLearnMoveRole(pokemon) === "watcher") {
      // Co-op (#633): the move-replace menu is OWNED by this mon's player. The PARTNER
      // watches: it shows a non-interactive notice and mirrors the owner's relayed result
      // (which move was forgotten, or none), so both transition together and only the
      // owner picks. The owner / solo / hotseat(spoof) path opens the real menu below.
      void this.coopWatchLearnMove(move, pokemon);
    } else {
      this.replaceMoveCheck(move, pokemon);
    }
  }

  /**
   * Co-op (#633): who controls THIS mon's move-replace menu. Returns "watcher" when the
   * local player does NOT own the learning mon (they mirror the result), "owner" when they
   * do (they drive it). Returns null outside a live co-op run; the hotseat (SpoofGuest)
   * path has no partner screen, so the local human always owns it.
   */
  private coopLearnMoveRole(pokemon: Pokemon): "owner" | "watcher" | null {
    if (!globalScene.gameMode.isCoop) {
      return null;
    }
    const controller = getCoopController();
    if (controller == null) {
      return null;
    }
    if (getCoopRuntime()?.spoof != null) {
      return "owner";
    }
    const owner = (pokemon as { coopOwner?: CoopRole }).coopOwner ?? "host";
    return owner === controller.role ? "owner" : "watcher";
  }

  /**
   * Co-op (#633) OWNER: relay the move-replace decision to the partner. `moveIndex` is the
   * forgotten move's slot, or `getMaxMoveCount()` to signal "did not learn". No-op in solo
   * and on the partner (only the mon-owner relays).
   */
  private coopRelayLearnResult(moveIndex: number): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    if (controller == null) {
      return;
    }
    const owner = (this.getPokemon() as { coopOwner?: CoopRole }).coopOwner ?? "host";
    if (owner !== controller.role) {
      return;
    }
    getCoopInteractionRelay()?.sendInteractionChoice(COOP_LEARN_MOVE_SEQ, "learnMove", moveIndex);
  }

  /**
   * Co-op (#633) WATCHER: show a non-interactive notice while the owner picks, then apply
   * the relayed result against this client's identical mon - the same slot is replaced (or
   * nothing) - and end, so both clients leave the screen together.
   */
  private async coopWatchLearnMove(move: Move, pokemon: Pokemon): Promise<void> {
    globalScene.ui.setMode(this.messageMode);
    await globalScene.ui.showTextPromise(
      i18next.t("battle:coopPartnerChoosingMove", {
        defaultValue: "Your partner is choosing a move for {{pokemonName}}...",
        pokemonName: getPokemonNameWithAffix(pokemon),
      }),
      undefined,
      true,
    );
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      return this.end();
    }
    const res = await relay.awaitInteractionChoice(COOP_LEARN_MOVE_SEQ, COOP_LEARN_MOVE_WAIT_MS);
    // A null result (partner gone / timeout) means "did not learn" so the run never hangs.
    const moveIndex = res?.choice ?? pokemon.getMaxMoveCount();
    if (moveIndex >= 0 && moveIndex < pokemon.getMaxMoveCount()) {
      this.learnMove(moveIndex, move, pokemon);
    } else {
      await globalScene.ui.showTextPromise(
        i18next.t("battle:learnMoveNotLearned", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          moveName: move.name,
        }),
        undefined,
        true,
      );
      this.end();
    }
  }

  /**
   * This displays a chain of messages (listed below) and asks if the user wishes to forget a move.
   *
   * > [Pokemon] wants to learn the move [MoveName]
   * > However, [Pokemon] already knows four moves.
   * > Should a move be forgotten and replaced with [MoveName]? --> `Mode.CONFIRM` -> Yes: Go to `this.forgetMoveProcess()`, No: Go to `this.rejectMoveAndEnd()`
   * @param move The Move to be learned
   * @param Pokemon The Pokemon learning the move
   */
  async replaceMoveCheck(move: Move, pokemon: Pokemon) {
    const learnMovePrompt = i18next.t("battle:learnMovePrompt", {
      pokemonName: getPokemonNameWithAffix(pokemon),
      moveName: move.name,
    });
    const moveLimitReached = i18next.t("battle:learnMoveLimitReached", {
      pokemonName: getPokemonNameWithAffix(pokemon),
    });
    const shouldReplaceQ = i18next.t("battle:learnMoveReplaceQuestion", {
      moveName: move.name,
    });
    const preQText = [learnMovePrompt, moveLimitReached].join("$");
    await globalScene.ui.showTextPromise(preQText);
    await globalScene.ui.showTextPromise(shouldReplaceQ, undefined, false);
    await globalScene.ui.setModeWithoutClear(
      UiMode.CONFIRM,
      () => this.forgetMoveProcess(move, pokemon), // Yes
      () => {
        // No
        globalScene.ui.setMode(this.messageMode);
        this.rejectMoveAndEnd(move, pokemon);
      },
    );
  }

  /**
   * This facilitates the process in which an old move is chosen to be forgotten.
   *
   * > Which move should be forgotten?
   *
   * The game then goes `Mode.SUMMARY` to select a move to be forgotten.
   * If a player does not select a move or chooses the new move (`moveIndex === 4`), the game goes to `this.rejectMoveAndEnd()`.
   * If an old move is selected, the function then passes the `moveIndex` to `this.learnMove()`
   * @param move The Move to be learned
   * @param Pokemon The Pokemon learning the move
   */
  async forgetMoveProcess(move: Move, pokemon: Pokemon) {
    globalScene.ui.setMode(this.messageMode);
    await globalScene.ui.showTextPromise(i18next.t("battle:learnMoveForgetQuestion"), undefined, true);
    await globalScene.ui.setModeWithoutClear(
      UiMode.SUMMARY,
      pokemon,
      SummaryUiMode.LEARN_MOVE,
      move,
      (moveIndex: number) => {
        // The summary returns the "new move" row index to signal rejection. That
        // row sits below the existing moves, so it equals the move cap (4, or 5
        // with ER's extra slot).
        if (moveIndex === pokemon.getMaxMoveCount()) {
          globalScene.ui.setMode(this.messageMode).then(() => this.rejectMoveAndEnd(move, pokemon));
          return;
        }
        const forgetSuccessText = i18next.t("battle:learnMoveForgetSuccess", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          moveName: pokemon.moveset[moveIndex]!.getName(),
        });
        const fullText = [i18next.t("battle:countdownPoof"), forgetSuccessText, i18next.t("battle:learnMoveAnd")].join(
          "$",
        );
        // Co-op (#633): relay the owner's chosen forget-slot so the partner mirrors it.
        this.coopRelayLearnResult(moveIndex);
        globalScene.ui.setMode(this.messageMode).then(() => this.learnMove(moveIndex, move, pokemon, fullText));
      },
    );
  }

  /**
   * This asks the player if they wish to end the current move learning process.
   *
   * > Stop trying to teach [MoveName]? --> `Mode.CONFIRM` --> Yes: > [Pokemon] did not learn the move [MoveName], No: `this.replaceMoveCheck()`
   *
   * If the player wishes to not teach the Pokemon the move, it displays a message and ends the phase.
   * If the player reconsiders, it repeats the process for a Pokemon with a full moveset once again.
   * @param move The Move to be learned
   * @param Pokemon The Pokemon learning the move
   */
  async rejectMoveAndEnd(move: Move, pokemon: Pokemon) {
    await globalScene.ui.showTextPromise(
      i18next.t("battle:learnMoveStopTeaching", { moveName: move.name }),
      undefined,
      false,
    );
    globalScene.ui.setModeWithoutClear(
      UiMode.CONFIRM,
      () => {
        globalScene.ui.setMode(this.messageMode);
        // Co-op (#633): relay "did not learn" (sentinel = the move cap) so the partner
        // mirrors the no-op and both leave the screen together.
        this.coopRelayLearnResult(pokemon.getMaxMoveCount());
        globalScene.ui
          .showTextPromise(
            i18next.t("battle:learnMoveNotLearned", {
              pokemonName: getPokemonNameWithAffix(pokemon),
              moveName: move.name,
            }),
            undefined,
            true,
          )
          .then(() => this.end());
      },
      () => {
        globalScene.ui.setMode(this.messageMode);
        this.replaceMoveCheck(move, pokemon);
      },
    );
  }

  /**
   * This teaches the Pokemon the new move and ends the phase.
   * When a Pokemon forgets a move and learns a new one, its 'Learn Move' message is significantly longer.
   *
   * Pokemon with a `moveset.length < 4`
   * > [Pokemon] learned [MoveName]
   *
   * Pokemon with a `moveset.length > 4`
   * > 1... 2... and 3... and Poof!
   * > [Pokemon] forgot how to use [MoveName]
   * > And...
   * > [Pokemon] learned [MoveName]!
   * @param move The Move to be learned
   * @param Pokemon The Pokemon learning the move
   */
  async learnMove(index: number, move: Move, pokemon: Pokemon, textMessage?: string) {
    if (this.learnMoveType === LearnMoveType.TM) {
      if (!pokemon.usedTMs) {
        pokemon.usedTMs = [];
      }
      pokemon.usedTMs.push(this.moveId);
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    } else if (this.learnMoveType === LearnMoveType.MEMORY) {
      if (this.cost === -1) {
        globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
      } else {
        if (!Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
          globalScene.money -= this.cost;
          globalScene.updateMoneyText();
          globalScene.animateMoneyChanged(false);
        }
        globalScene.playSound("se/buy");
      }
    }
    pokemon.setMove(index, this.moveId);
    initMoveAnim(this.moveId).then(() => {
      loadMoveAnimAssets([this.moveId], true);
    });
    globalScene.ui.setMode(this.messageMode);
    const learnMoveText = i18next.t("battle:learnMove", {
      pokemonName: getPokemonNameWithAffix(pokemon),
      moveName: move.name,
    });
    if (textMessage) {
      await globalScene.ui.showTextPromise(textMessage);
    }
    globalScene.playSound("level_up_fanfare"); // Sound loaded into game as is
    globalScene.ui.showText(
      learnMoveText,
      null,
      () => {
        globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeMoveLearnedTrigger, true);
        this.end();
      },
      this.messageMode === UiMode.EVOLUTION_SCENE ? 1000 : undefined,
      true,
    );
  }
}
