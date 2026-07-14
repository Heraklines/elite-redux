/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { clearCoopRuntime, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { resolveGhostDialogue } from "#data/elite-redux/er-ghost-profile";
import { buildGhostDialogueCtx } from "#data/elite-redux/er-ghost-teams";
import { erRecordShowdownResult } from "#data/elite-redux/er-social-achievement-tracker";
import {
  endShowdownBattle,
  getShowdownMatchId,
  getShowdownOpponentProfile,
  getShowdownRankedContext,
} from "#data/elite-redux/showdown/showdown-battle-state";
import {
  reportShowdownResult,
  reportShowdownVoid,
  syncShowdownPendingSettlements,
} from "#data/elite-redux/showdown/showdown-escrow-client";
import {
  type ShowdownResultReason,
  type ShowdownVoidReason,
  selectShowdownResultLine,
  winnerFromLocalResult,
} from "#data/elite-redux/showdown/showdown-outcome";
import { reportShowdownRankResult } from "#data/elite-redux/showdown/showdown-rank-client";
import { sealShowdownTelemetry } from "#data/elite-redux/showdown/showdown-telemetry";
import { reportTournamentResult } from "#data/elite-redux/showdown/tournament-client";
import {
  clearTournamentMatchContext,
  getTournamentMatchContext,
} from "#data/elite-redux/showdown/tournament-match-context";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";

/**
 * Showdown 1v1 PvP (C3/C6): the terminal phase of a versus match. Shows a short result line
 * and returns cleanly to the title - the match is EPHEMERAL and is NEVER persisted (no
 * saveAll / no session write, unlike GameOverPhase). Both a KO-sweep victory/defeat
 * (routed from VictoryPhase / GameOverPhase) and a void (checksum give-up / illegal team /
 * disconnect) land here.
 *
 * C6 emits the `showdownResult` / `showdownVoid` wire message to the peer from here (both
 * clients then show the same outcome); C3's bootstrap routes the HOST's local win/loss so the
 * duel ends without touching the shop / next-wave / save path.
 */
export class ShowdownResultPhase extends BattlePhase {
  public readonly phaseName = "ShowdownResultPhase";

  /** True when the LOCAL player won the duel. */
  private readonly localWon: boolean;
  /** Why the match ended (a decisive reason, or a void reason). */
  private readonly reason: ShowdownResultReason | ShowdownVoidReason;
  /** True when the match VOIDED (no winner) - overrides the win/loss line. */
  private readonly voided: boolean;
  /** True when this phase was routed FROM a received peer message - it must NOT re-emit (no ping-pong). */
  private readonly silent: boolean;

  constructor(
    localWon: boolean,
    reason: ShowdownResultReason | ShowdownVoidReason = "victory",
    voided = false,
    silent = false,
  ) {
    super();
    this.localWon = localWon;
    this.reason = reason;
    this.voided = voided;
    this.silent = silent;
  }

  start(): void {
    super.start();

    // #900: unlock the Versus achievements for this match BEFORE endShowdownBattle() (below)
    // drops the match id + team manifests this reads. Pure local observer - it validates
    // achievements on this client only and emits nothing over the wire, so it can't affect
    // the escrow report / peer result message. Fired on both clients (each runs this phase).
    erRecordShowdownResult(this.localWon, this.voided);

    // Task C7: the opponent's win/lose dialogue line, resolved BEFORE endShowdownBattle drops the
    // stashed profile. Ghost semantics: the WINNER hears the opponent's `defeated` line, the LOSER
    // hears the opponent's `defeatPlayer` line; a void shows none. Tokens resolve against our own
    // live end-of-battle state (the encountering player). Skipped silently when there's no line.
    const rawLine = selectShowdownResultLine(getShowdownOpponentProfile(), this.localWon, this.voided);
    const opponentLine = rawLine ? resolveGhostDialogue(rawLine, buildGhostDialogueCtx()) : null;

    // The escrow match id (null for a FRIENDLY match). Read BEFORE endShowdownBattle drops it.
    const matchId = getShowdownMatchId();
    // Ranked reporting context (null when either player declined ranked). Read BEFORE endShowdownBattle.
    const ranked = getShowdownRankedContext();
    const localRole = getCoopRuntime()?.controller.role ?? "host";

    // Emit the outcome to the peer so both clients show the same result (matchId carried verbatim:
    // real id for a staked match, null for a friendly). Best-effort + guarded so a send can never
    // strand the return to title. Skipped when this phase was itself ROUTED from a received peer
    // result/void (silent) - otherwise the two clients ping-pong.
    try {
      const transport = this.silent ? null : getCoopRuntime()?.localTransport;
      if (transport != null) {
        if (this.voided) {
          transport.send({ t: "showdownVoid", matchId, reason: this.reason as ShowdownVoidReason });
        } else {
          // The winner as an absolute role: our own role when we won, else the other (pure, tested).
          transport.send({
            t: "showdownResult",
            matchId,
            winner: winnerFromLocalResult(localRole, this.localWon),
            reason: this.reason as ShowdownResultReason,
          });
        }
      }
    } catch {
      /* a result/void send failure must never block the return to title */
    }

    // STAKED match (D1/D2): report the decisive outcome to the escrow server via dual attestation,
    // then self-apply any settlement it produced. Fire-and-forget + fully guarded — the escrow round
    // trip must NEVER block or strand the return to title, and an offline/unreachable escrow simply
    // leaves the settlement for the next login sync. A VOID has no winner to attest, so it isn't
    // reported here (a conflict/silence-timeout resolves the ledger server-side; see D1).
    if (matchId != null && !this.voided) {
      const winner = winnerFromLocalResult(localRole, this.localWon);
      void reportShowdownResult(matchId, winner, this.reason as ShowdownResultReason)
        .then(() => syncShowdownPendingSettlements(globalScene.gameData))
        .catch(() => {});
    } else if (matchId != null && this.voided) {
      // I4: a VOIDED staked match releases both escrow holds server-side (no winner to attest).
      void reportShowdownVoid(matchId).catch(() => {});
    }

    // TOURNAMENT match (prize-only, escrow matchId always null): report the decisive outcome to the
    // tournament worker via dual attestation so it advances the bracket server-side. BOTH clients
    // report (the winner USERNAME); a void never advances a bracket. Fire-and-forget + fully guarded —
    // the round trip must never block or strand the return to title. Context is cleared afterward so it
    // can't leak into the next plain match.
    const tournamentCtx = getTournamentMatchContext();
    if (tournamentCtx != null && !this.silent) {
      if (!this.voided) {
        const localName = getCoopRuntime()?.controller.localName() ?? "";
        const partnerName = getCoopRuntime()?.controller.partnerName ?? "";
        const winnerName = this.localWon ? localName : partnerName;
        if (winnerName) {
          void reportTournamentResult(tournamentCtx.tournamentId, tournamentCtx.matchId, winnerName).catch(() => {});
        }
      }
      clearTournamentMatchContext();
    }

    // RANKED (dual attestation): report the decisive outcome to /showdown/rank/result so the server
    // applies the ladder progression to BOTH players once both clients agree. A VOID never counts (no
    // winner to attest). Fire-and-forget + fully guarded - a ranked round trip must NEVER block or
    // strand the return to title; an unreachable server simply leaves the match uncounted (casual-safe).
    if (ranked != null && !this.voided) {
      const winner = winnerFromLocalResult(localRole, this.localWon);
      void reportShowdownRankResult({
        matchId: ranked.rankedMatchId,
        hostUid: ranked.hostUid,
        guestUid: ranked.guestUid,
        winner,
      }).catch(() => {});
    }

    // D5: seal + fire-and-forget the HOST's battle telemetry (no-op for the guest / no active record).
    // Records ALL matches (friendly + staked) for balance analytics; a send failure only logs.
    sealShowdownTelemetry({
      winner: this.voided ? null : winnerFromLocalResult(localRole, this.localWon),
      reason: this.reason,
      voided: this.voided,
    });

    // Ephemeral match: drop the showdown + co-op runtime state. NEVER persisted (no saveAll).
    endShowdownBattle();
    clearCoopRuntime();

    const message = this.voided
      ? `The Showdown was voided (${this.reason}).`
      : this.localWon
        ? "You won the Showdown!"
        : "You lost the Showdown.";

    // The ghost OPPONENT trainer is a Phaser container parented to `globalScene.field` (built by
    // buildShowdownTrainer, added via `field.add`). `globalScene.reset()` destroys the party pokemon
    // and nulls `currentBattle` but NEVER removes this trainer container, so it is orphaned on the field
    // and lingers over the incoming title (the reported "trainer stays on top of the titlescreen").
    // Captured HERE, before reset() drops the `currentBattle` reference, and destroyed in the teardown
    // below. Deterministic for every outcome (win / loss / void) and every entry mode.
    const enemyTrainer = globalScene.currentBattle?.trainer ?? null;

    const showResult = () => {
      globalScene.ui.showText(
        message,
        null,
        () => {
          // Return to the title WITHOUT saving - a showdown run never writes a session.
          // Mirror the game-over title-return recipe (staging fix 2026-07-07): hide + fade the
          // battle scene and CLEAR the phase queue BEFORE resetting, or the stale battle
          // field/menu stays rendered underneath the incoming title menu (the reported
          // "title menu on top of the frozen battle" after a forfeit).
          globalScene.fadeOutBgm(500, true);
          const activeBattlers = globalScene.getField().filter(p => p?.isActive(true));
          for (const battler of activeBattlers) {
            battler.hideInfo();
          }
          void globalScene.ui.fadeOut(500).then(() => {
            for (const battler of activeBattlers) {
              battler.setVisible(false);
            }
            // Hide + REMOVE + DESTROY the orphaned ghost opponent trainer (reset() would leave it on the
            // field). Mirrors reset()'s own ME-introVisuals teardown (`field.remove(child, true)`): the
            // explicit remove splices it out of the field's display list AND destroys it (sprites +
            // ghost-aura FX), so it can never draw over the title. setVisible(false) first guarantees it
            // is hidden even if the destroy is a no-op on a stale handle. Guarded so a teardown failure
            // can never strand the return to title.
            try {
              if (enemyTrainer != null) {
                enemyTrainer.setVisible(false);
                globalScene.field.remove(enemyTrainer, true);
              }
            } catch {
              /* a trainer teardown failure must never block the return to title */
            }
            globalScene.setFieldScale(1, true);
            globalScene.phaseManager.clearPhaseQueue();
            globalScene.ui.clearText();
            globalScene.reset();
            globalScene.phaseManager.unshiftNew("TitlePhase");
            this.end();
          });
        },
        null,
        true,
      );
    };

    // Play the opponent's authored win/lose line FIRST (when present), then the result banner.
    const runResultText = () => {
      if (opponentLine == null) {
        showResult();
      } else {
        globalScene.ui.showText(opponentLine, null, showResult, null, true);
      }
    };
    // This phase can be routed from ANY prior UI mode: a mid-battle victory/forfeit already sits on the
    // MESSAGE handler, but a PRE-BATTLE abandon (a drop during the wager window) enters with the WAGER
    // screen still up. Ensure the MESSAGE handler is active first, or the result text can't render/advance
    // and the return to title strands. When already on MESSAGE we keep the exact synchronous path.
    if (globalScene.ui.getMode() === UiMode.MESSAGE) {
      runResultText();
    } else {
      void globalScene.ui.setMode(UiMode.MESSAGE).then(runResultText);
    }
  }
}
