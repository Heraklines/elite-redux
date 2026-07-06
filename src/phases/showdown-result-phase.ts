/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { clearCoopRuntime, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownResultReason, ShowdownVoidReason } from "#data/elite-redux/showdown/showdown-outcome";
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

    // Emit the outcome to the peer so both clients show the same result (friendly -> matchId null).
    // Best-effort + guarded so a send can never strand the return to title. Skipped when this phase
    // was itself ROUTED from a received peer result/void (silent) - otherwise the two clients ping-pong.
    try {
      const transport = this.silent ? null : getCoopRuntime()?.localTransport;
      if (transport != null) {
        if (this.voided) {
          transport.send({ t: "showdownVoid", matchId: null, reason: this.reason as ShowdownVoidReason });
        } else {
          transport.send({
            t: "showdownResult",
            matchId: null,
            // The winner from the LOCAL client's viewpoint (its own role when it won).
            winner:
              getCoopRuntime()?.controller.role === "guest"
                ? this.localWon
                  ? "guest"
                  : "host"
                : this.localWon
                  ? "host"
                  : "guest",
            reason: this.reason as ShowdownResultReason,
          });
        }
      }
    } catch {
      /* a result/void send failure must never block the return to title */
    }

    // Ephemeral match: drop the showdown + co-op runtime state. NEVER persisted (no saveAll).
    endShowdownBattle();
    clearCoopRuntime();

    const message = this.voided
      ? `The Showdown was voided (${this.reason}).`
      : this.localWon
        ? "You won the Showdown!"
        : "You lost the Showdown.";

    globalScene.ui.showText(
      message,
      null,
      () => {
        // Return to the title WITHOUT saving - a showdown run never writes a session.
        globalScene.reset();
        globalScene.phaseManager.unshiftNew("TitlePhase");
        this.end();
      },
      null,
      true,
    );
  }
}
