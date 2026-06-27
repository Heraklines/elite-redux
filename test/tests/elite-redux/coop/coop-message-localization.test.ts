/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op host-language LEAK fix (#691). In authoritative co-op all battle narration is
// recorded at the host's queueMessage tap AFTER it is localized, so every line ("X used
// Y!", "X fainted!", ...) renders in the HOST'S language on the guest. This fix
// REGENERATES the two dominant lines BY VOLUME ("X used Y!" + "X fainted!") in the GUEST'S
// OWN language from the structured `moveUsed` / `faint` events the guest already receives,
// and the host SUPPRESSES streaming its host-language `message` duplicate for exactly those
// two lines (so no double-render). This verifies, end to end:
//   (a) HOST: after a real move + a real (non-ignored) faint in an open recording, the
//       recorded events carry moveUsed/faint but NO `message` event equal to the host's
//       useMove/fainted i18n output (the host suppressed streaming them);
//   (b) GUEST: a turnResolution with moveUsed + faint(narrate=true) and NO message issues a
//       queueMessage with the GUEST-localized useMove/fainted text (the guest's i18n locale);
//   (c) faint with narrate=false -> NO faint line regenerated (matches an ignoreFaintPhase KO);
//   (d) a bad moveId / bi never throws - the checkpoint still applies;
//   (e) the post-turn checksum still CONVERGES (the regenerated lines are cosmetic, no desync).
//
// Single-scene constraint (documented across the co-op suite): there is ONE globalScene;
// "the guest" is the same engine with the live role flipped to "guest" and the host's
// turnResolution injected over the loopback peer. Gated ER_SCENARIO=1.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import {
  clearCoopRuntime,
  getCoopController,
  getCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopBattleCheckpoint, CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op host-language leak: guest regenerates the dominant lines (#691)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  /** Start a co-op authoritative double as the HOST and tag field ownership. */
  const startCoopHost = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    return field;
  };

  /** Start a co-op authoritative double, then flip the LOCAL engine into the GUEST role. */
  const startCoopGuest = async () => {
    const field = await startCoopHost();
    getCoopController()!.role = "guest";
    return field;
  };

  /** Build a checkpoint that snaps every field mon to an exact, recognizable hp. */
  const checkpointFromField = (hp: number): CoopBattleCheckpoint => {
    const field = globalScene.getField(true).filter((m): m is Pokemon => m != null);
    return {
      field: field.map(m => ({
        bi: m.getBattlerIndex(),
        partyIndex: (m.isPlayer() ? globalScene.getPlayerParty() : (globalScene.getEnemyParty() as Pokemon[])).indexOf(
          m,
        ),
        speciesId: m.species.speciesId,
        hp,
        maxHp: m.getMaxHp(),
        status: 0,
        statStages: [0, 0, 0, 0, 0, 0, 0],
        fainted: false,
      })),
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
    };
  };

  /**
   * Build a checkpoint that marks `koBi` fainted (hp 0) and snaps every OTHER field mon to its CURRENT
   * live hp / stages (a no-op for them), so the host checksum captured with `koBi` fainted matches the
   * guest's post-finalize checksum exactly (the guest's faint phase leaveField's the same mon).
   */
  const checkpointKO = (koBi: number): CoopBattleCheckpoint => {
    const live = globalScene.getField(true).filter((m): m is Pokemon => m != null);
    return {
      field: live.map(m => {
        const bi = m.getBattlerIndex();
        const ko = bi === koBi;
        return {
          bi,
          partyIndex: (m.isPlayer()
            ? globalScene.getPlayerParty()
            : (globalScene.getEnemyParty() as Pokemon[])
          ).indexOf(m),
          speciesId: m.species.speciesId,
          hp: ko ? 0 : m.hp,
          maxHp: m.getMaxHp(),
          status: m.status?.effect ?? 0,
          statStages: [...m.getStatStages()],
          fainted: ko,
        };
      }),
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
    };
  };

  const REPLAY_DRAIN_PHASES = [
    "MessagePhase",
    "CoopMoveAnimReplayPhase",
    "CoopHpDrainReplayPhase",
    "CoopStatStageReplayPhase",
    "CoopStatusReplayPhase",
    "CoopFaintReplayPhase",
    "CoopFinalizeTurnPhase",
  ] as const;

  /**
   * Start a guest {@linkcode CoopReplayTurnPhase} for `turn` and drain the presentation phases it
   * unshifts PLUS the deferred {@linkcode CoopFinalizeTurnPhase}. Hardened to end() headlessly so it
   * never hangs. Stops once the finalize phase has run.
   */
  const driveReplayTurn = async (turn: number): Promise<void> => {
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < 32; i++) {
      const cur = game.scene.phaseManager.getCurrentPhase();
      if (cur == null || !REPLAY_DRAIN_PHASES.some(name => cur.is(name))) {
        break;
      }
      const wasFinalize = cur.is("CoopFinalizeTurnPhase");
      cur.start();
      await new Promise(r => setTimeout(r, 0));
      if (wasFinalize) {
        break;
      }
    }
  };

  // ===========================================================================
  // (a) HOST suppresses RECORDING its host-language useMove + fainted lines.
  // ===========================================================================

  it("(a) a real host turn records moveUsed + faint but NO host-language useMove / fainted message", async () => {
    await startCoopHost();
    expect(getCoopController()?.role).toBe("host");

    // Make one enemy frail (1 HP) so the host's TACKLE KOs it -> a real FaintPhase (narrate=true) runs.
    const enemy0 = globalScene.getEnemyField(false)[0];
    enemy0.hp = 1;

    // Capture every turnResolution the host streams to the partner (the guest).
    const partner = getCoopRuntime()!.partnerTransport!;
    const events: CoopBattleEvent[] = [];
    partner.onMessage(msg => {
      if (msg.t === "turnResolution") {
        events.push(...msg.events);
      }
    });

    // The exact host-language strings the host SHOWS locally - which it must NOT also stream.
    const player = globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
    const hostUseMove = i18next.t("battle:useMove", {
      pokemonNameWithAffix: getPokemonNameWithAffix(player),
      moveName: new PokemonMove(MoveId.TACKLE).getName(),
    });
    const hostFainted = i18next.t("battle:fainted", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy0) });

    game.move.select(MoveId.TACKLE, BattlerIndex.PLAYER, enemy0.getBattlerIndex());
    await game.phaseInterceptor.to("TurnEndPhase");
    await new Promise(r => setTimeout(r, 0));

    // The structured events are still recorded (the guest regenerates the lines from them).
    const kinds = new Set(events.map(e => e.k));
    expect(kinds.has("moveUsed"), "the host still records the structured moveUsed event").toBe(true);
    expect(kinds.has("faint"), "the host still records the structured faint event").toBe(true);

    // The KO ran a real FaintPhase, so its faint event carries narrate=true.
    const faint = events.find(e => e.k === "faint" && e.bi === enemy0.getBattlerIndex());
    expect(faint?.k === "faint" ? faint.narrate : undefined, "the narrated KO carries narrate=true").toBe(true);

    // The host-language lines were SUPPRESSED from the stream (no `message` event equals them).
    const messageTexts = events.filter(e => e.k === "message").map(e => (e.k === "message" ? e.text : ""));
    expect(messageTexts, "the host did NOT stream its host-language useMove line").not.toContain(hostUseMove);
    expect(messageTexts, "the host did NOT stream its host-language fainted line").not.toContain(hostFainted);
  });

  it("(a) a DIRECT move-hit KO records faint with narrate=true (the deferred FaintPhase still shows a message)", async () => {
    await startCoopHost();
    const enemy0 = globalScene.getEnemyField(false)[0];
    enemy0.hp = 1;

    // The dominant narrated case: a direct move hit. MoveEffectPhase calls damage(ignoreFaintPhase=true)
    // (the FaintPhase is DEFERRED to onFaintTarget) - so the "X fainted!" message IS shown. The recorded
    // faint event must carry narrate=true (the deviation from the spec's literal `!ignoreFaintPhase`, which
    // would have wrongly suppressed the guest's regenerated line for the most common KO type).
    const partner = getCoopRuntime()!.partnerTransport!;
    const events: CoopBattleEvent[] = [];
    partner.onMessage(msg => {
      if (msg.t === "turnResolution") {
        events.push(...msg.events);
      }
    });

    game.move.select(MoveId.TACKLE, BattlerIndex.PLAYER, enemy0.getBattlerIndex());
    await game.phaseInterceptor.to("TurnEndPhase");
    await new Promise(r => setTimeout(r, 0));

    const faint = events.find(e => e.k === "faint" && e.bi === enemy0.getBattlerIndex());
    expect(faint, "the move-hit KO records a faint event").toBeDefined();
    expect(
      faint?.k === "faint" ? faint.narrate : undefined,
      "a direct move-hit KO carries narrate=true (deferred FaintPhase still narrates)",
    ).toBe(true);
  });

  // ===========================================================================
  // (b)+(c) GUEST regenerates the lines in its OWN language, gated on narrate.
  // ===========================================================================

  it("(b) the guest issues queueMessage with the GUEST-localized useMove + fainted text", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();
    const player = field[COOP_HOST_FIELD_INDEX];

    // The GUEST's locale strings (what the guest should regenerate locally - no host text on the wire).
    const guestUseMove = i18next.t("battle:useMove", {
      pokemonNameWithAffix: getPokemonNameWithAffix(player),
      moveName: new PokemonMove(MoveId.TACKLE).getName(),
    });
    const guestFainted = i18next.t("battle:fainted", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy0) });

    const queued: string[] = [];
    const queueSpy = vi
      .spyOn(globalScene.phaseManager, "queueMessage")
      .mockImplementation((message: string) => queued.push(message));

    // The host's stream carries the STRUCTURED events with NO host-language message line for them.
    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        { k: "moveUsed", bi: BattlerIndex.PLAYER, moveId: MoveId.TACKLE, targets: [koBi] },
        { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
        { k: "faint", bi: koBi, narrate: true },
      ],
      checkpoint: checkpointKO(koBi),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    await driveReplayTurn(turn);
    queueSpy.mockRestore();

    expect(queued, "the guest regenerated the useMove line in its own language").toContain(guestUseMove);
    expect(queued, "the guest regenerated the fainted line in its own language").toContain(guestFainted);
  });

  it("(c) a faint with narrate=false regenerates NO fainted line", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();

    const guestFainted = i18next.t("battle:fainted", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy0) });

    const queued: string[] = [];
    const queueSpy = vi
      .spyOn(globalScene.phaseManager, "queueMessage")
      .mockImplementation((message: string) => queued.push(message));

    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
        { k: "faint", bi: koBi, narrate: false },
      ],
      checkpoint: checkpointKO(koBi),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    await driveReplayTurn(turn);
    queueSpy.mockRestore();

    // A narrate=false faint (an ignoreFaintPhase KO on the host) regenerates NO line - matches the host.
    expect(queued, "a narrate=false faint regenerates NO fainted line").not.toContain(guestFainted);
    expect(field[COOP_HOST_FIELD_INDEX].isOnField(), "the host's mon survives").toBe(true);
  });

  // ===========================================================================
  // (d) a bad moveId / bi never throws - the checkpoint still applies.
  // (e) the post-turn checksum still CONVERGES (the regenerated lines are cosmetic).
  // ===========================================================================

  it("(d) a bad moveId / bi never throws; the checkpoint still applies", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;

    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        // A garbled move (unknown user + moveId) and a garbled faint (out-of-range bi, narrate=true): the
        // regeneration helpers must swallow both and never throw into the pump.
        { k: "moveUsed", bi: 99, moveId: -7, targets: [42] },
        { k: "faint", bi: 99, narrate: true },
      ],
      checkpoint: checkpointFromField(8),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    await expect(driveReplayTurn(turn), "a bad moveId / bi never throws").resolves.not.toThrow();
    // The checkpoint still applied: every mon snaps to the host's hp (8) despite the garbage.
    for (const mon of field) {
      expect(mon.hp, "the checkpoint still corrects the field after a garbled stream").toBe(8);
    }
  });

  it("(e) CONVERGENCE: after the guest regenerates the lines, the post-turn checksum matches the host's", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();

    // HOST authoritative checksum: model the host's end-of-turn state with enemy0 KOd. Mark it fainted so
    // getField(true) excludes it, capture the checksum + checkpoint, then RESTORE enemy0 alive so the
    // guest must animate + regenerate the line itself and re-converge.
    const koOrigHp = enemy0.hp;
    enemy0.hp = 0;
    enemy0.doSetStatus(StatusEffect.FAINT);
    const hostChecksum = coopEngine.captureCoopChecksum();
    const hostCheckpoint = checkpointKO(koBi);
    enemy0.hp = koOrigHp;
    enemy0.status = null;
    expect(enemy0.isOnField(), "enemy0 is alive on the guest's pre-turn field").toBe(true);

    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        { k: "moveUsed", bi: BattlerIndex.PLAYER, moveId: MoveId.TACKLE, targets: [koBi] },
        { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
        { k: "faint", bi: koBi, narrate: true },
      ],
      checkpoint: hostCheckpoint,
      checksum: hostChecksum,
    });
    await new Promise(r => setTimeout(r, 0));

    await driveReplayTurn(turn);

    // The regenerated lines are PURELY COSMETIC (text is not in the checksum), so the post-turn checksum
    // re-converges to the host's exactly - no desync.
    expect(coopEngine.captureCoopChecksum(), "the post-turn checksum converges to the host's").toBe(hostChecksum);
    expect(enemy0.isOnField(), "the KOd enemy left the field by turn end").toBe(false);
    expect(field[COOP_HOST_FIELD_INDEX].isOnField(), "the host's mon survives").toBe(true);
  });
});
