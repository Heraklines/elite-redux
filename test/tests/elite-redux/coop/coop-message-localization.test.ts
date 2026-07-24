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
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import { installLocalV2TurnReplicaFixture, negotiateLocalSpoofPeer } from "#test/tools/coop-local-peer";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function completeTurnCarrier(turn: number) {
  const carrier = coopEngine.captureCoopAuthoritativeCarrier(turn, "turnResolution");
  if (carrier == null) {
    throw new Error(`test could not capture a production turn carrier for turn ${turn}`);
  }
  const epoch = getCoopController()?.sessionEpoch;
  if (epoch == null || epoch <= 0) {
    throw new Error("test has no negotiated co-op session epoch");
  }
  return {
    epoch,
    wave: carrier.authoritativeState.wave,
    revision: carrier.authoritativeState.tick,
    ...carrier,
  };
}

/** Enter the renderer through the authenticated V2 material seam; raw turnResolution is cosmetic. */
function ingestV2Turn(message: Extract<CoopMessage, { t: "turnResolution" }>): void {
  const runtime = getCoopRuntime();
  if (runtime == null) {
    throw new Error("test has no live co-op runtime for Authority V2 turn ingestion");
  }
  const commands = globalScene
    .getPlayerField()
    .flatMap((mon, fieldIndex) =>
      mon.isFainted() ? [] : [{ ownerSeatId: mon.coopOwner === "guest" ? 1 : 0, pokemonId: mon.id, fieldIndex }],
    );
  runtime.battleStream.ingestAuthoritativeV2Turn(
    message,
    {
      kind: "COMMAND_FRONTIER",
      epoch: message.epoch,
      wave: message.wave,
      turn: message.turn + 1,
      commands,
    },
    1,
  );
}

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
    const runtime = startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    await negotiateLocalSpoofPeer(runtime);
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
    const runtime = getCoopRuntime()!;
    runtime.spoof?.dispose();
    getCoopController()!.role = "guest";
    // Protocol 33 keys retained/durable operation cursors by runtime role as well as controller
    // role. This legacy single-engine fixture changes seats after assembly, so move both
    // identities together just as the guest-renderer fixture does.
    (runtime.opState as { localRole: "host" | "guest" | null }).localRole = "guest";
    installLocalV2TurnReplicaFixture(runtime);
    return field;
  };

  const carrierWithKo = (turn: number, mon: Pokemon) => {
    const before = {
      hp: mon.hp,
      status: mon.status,
      summonData: mon.summonData,
      tempSummonData: mon.tempSummonData,
      switchOutStatus: mon.switchOutStatus,
      onField: mon.isOnField(),
    };
    try {
      mon.hp = 0;
      mon.doSetStatus(StatusEffect.FAINT);
      mon.resetSummonData();
      mon.switchOutStatus = true;
      globalScene.field.remove(mon);
      return completeTurnCarrier(turn);
    } finally {
      mon.summonData = before.summonData;
      mon.tempSummonData = before.tempSummonData;
      mon.switchOutStatus = before.switchOutStatus;
      if (before.onField) {
        globalScene.field.add(mon);
      }
      mon.hp = before.hp;
      mon.status = before.status;
    }
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
    // A browser reaches replay through the phase manager. Detached starts leave presentation children
    // behind an unrelated CommandPhase; starting again after shift creates two consumers for one commit.
    game.scene.phaseManager.clearPhaseQueue();
    game.scene.phaseManager.unshiftPhase(replay);
    game.scene.phaseManager.shiftPhase();
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

  // Host suppression and direct-KO narrate=true now run inside the exact two-engine public TURN_COMMIT
  // journey in coop-battle-control. Keeping a second spoof-driven host turn here would validate a carrier
  // that is intentionally non-authoritative after the V2 cutover.

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

    const queued: Array<{ message: string; prompt: boolean | null | undefined }> = [];
    const queueSpy = vi
      .spyOn(globalScene.phaseManager, "queueMessage")
      .mockImplementation((message: string, _callbackDelay, prompt) => {
        queued.push({ message, prompt });
      });

    // The host's stream carries the STRUCTURED events with NO host-language message line for them.
    const carrier = carrierWithKo(turn, enemy0);
    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        {
          k: "moveUsed",
          bi: BattlerIndex.PLAYER,
          moveId: MoveId.TACKLE,
          targets: [koBi],
          actor: { side: "player", pokemonId: field[COOP_HOST_FIELD_INDEX].id },
          targetActors: [{ side: "enemy", pokemonId: enemy0.id }],
        },
        {
          k: "hp",
          bi: koBi,
          hp: 0,
          maxHp: enemy0.getMaxHp(),
          actor: { side: "enemy", pokemonId: enemy0.id },
        },
        { k: "faint", bi: koBi, narrate: true, actor: { side: "enemy", pokemonId: enemy0.id } },
      ],
    });
    await new Promise(r => setTimeout(r, 0));

    await driveReplayTurn(turn);
    queueSpy.mockRestore();

    expect(
      queued.map(entry => entry.message),
      "the guest regenerated the useMove line in its own language",
    ).toContain(guestUseMove);
    const faintNarration = queued.find(entry => entry.message === guestFainted);
    expect(faintNarration, "the guest regenerated the fainted line in its own language").toBeDefined();
    expect(
      faintNarration?.prompt,
      "the non-authoritative faint narration auto-dismisses instead of requesting blocked guest input",
    ).toBe(false);
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

    const carrier = carrierWithKo(turn, enemy0);
    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        {
          k: "hp",
          bi: koBi,
          hp: 0,
          maxHp: enemy0.getMaxHp(),
          actor: { side: "enemy", pokemonId: enemy0.id },
        },
        { k: "faint", bi: koBi, narrate: false, actor: { side: "enemy", pokemonId: enemy0.id } },
      ],
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

  it("(d) a bad moveId / battler makes the complete frame fail closed", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const beforeHp = field.map(mon => mon.hp);
    let accepted = 0;
    const offCommit = getCoopRuntime()!.battleStream.onTurnCommit(() => accepted++);

    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...completeTurnCarrier(turn),
      events: [
        // A garbled move (unknown user + moveId) and a garbled faint (out-of-range bi, narrate=true): the
        // regeneration helpers must swallow both and never throw into the pump.
        { k: "moveUsed", bi: 99, moveId: -7, targets: [42] },
        { k: "faint", bi: 99, narrate: true },
      ] as never,
    });
    await new Promise(r => setTimeout(r, 0));
    offCommit();

    expect(accepted, "malformed presentation data never enters the replay transaction").toBe(0);
    expect(
      field.map(mon => mon.hp),
      "rejection leaves the live field untouched",
    ).toEqual(beforeHp);
  });

  it("(e) CONVERGENCE: after the guest regenerates the lines, the post-turn checksum matches the host's", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();

    // HOST authoritative checksum: model the host's end-of-turn state with enemy0 KOd. Mark it fainted so
    // getField(true) excludes it, capture the checksum + checkpoint, then RESTORE enemy0 alive so the
    // guest must animate + regenerate the line itself and re-converge.
    const carrier = carrierWithKo(turn, enemy0);
    const hostChecksum = carrier.checksum;
    const hostChecksumState = JSON.parse(carrier.preimage);
    expect(carrier.fullField, "production carrier captured the just-fainted mon").not.toBeNull();
    expect(enemy0.isOnField(), "enemy0 is alive on the guest's pre-turn field").toBe(true);

    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        {
          k: "moveUsed",
          bi: BattlerIndex.PLAYER,
          moveId: MoveId.TACKLE,
          targets: [koBi],
          actor: { side: "player", pokemonId: field[COOP_HOST_FIELD_INDEX].id },
          targetActors: [{ side: "enemy", pokemonId: enemy0.id }],
        },
        {
          k: "hp",
          bi: koBi,
          hp: 0,
          maxHp: enemy0.getMaxHp(),
          actor: { side: "enemy", pokemonId: enemy0.id },
        },
        { k: "faint", bi: koBi, narrate: true, actor: { side: "enemy", pokemonId: enemy0.id } },
      ],
    });
    await new Promise(r => setTimeout(r, 0));

    await driveReplayTurn(turn);

    // The regenerated lines are PURELY COSMETIC (text is not in the checksum), so the post-turn checksum
    // re-converges to the host's exactly - no desync.
    expect(coopEngine.captureCoopChecksumState(), "the post-turn checksum state converges to the host's").toEqual(
      hostChecksumState,
    );
    expect(coopEngine.captureCoopChecksum(), "the post-turn checksum converges to the host's").toBe(hostChecksum);
    expect(enemy0.isOnField(), "the KOd enemy left the field by turn end").toBe(false);
    expect(field[COOP_HOST_FIELD_INDEX].isOnField(), "the host's mon survives").toBe(true);
  });
});
