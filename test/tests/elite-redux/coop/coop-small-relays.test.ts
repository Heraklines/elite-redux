/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op small unrelayed-choice relays (#633 Fix #4). The handful of interactive choices that
// crossed no wire and so desynced the shared run: Terastallize (a/applyWiredPartnerCommand),
// Baton Pass in the switch relay (g/the interaction relay carries it in data[0]). The risky
// ones (tera + the relayed flags) are verified here; evolution + level-up move-learn are
// deterministic co-op-skip / route-through-relay, exercised by their phase gates.

import { COOP_INTERACTION_LEAVE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { applyWiredPartnerCommand } from "#data/elite-redux/coop/coop-partner-ai";
import { COOP_STORMGLASS_SEQ } from "#data/elite-redux/coop/coop-seq-registry";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { STORMGLASS_WEATHER_CHOICES } from "#data/elite-redux/er-relics";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("co-op switch relay carries Baton Pass (#633 Fix #4g)", () => {
  // The switch relay rides the interaction-choice channel: choice=slot, data[0]=baton flag.
  // Without data[0] the watcher always applied a PLAIN switch, dropping the owner's Baton Pass.
  it("relays the baton flag in data[0] so the watcher can apply SwitchType.BATON_PASS", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // Owner makes a Baton Pass switch to party slot 3.
    owner.sendInteractionChoice(0, "switch", 3, [1]);
    const res = await watcher.awaitInteractionChoice(0);
    expect(res?.choice).toBe(3);
    expect(res?.data?.[0]).toBe(1); // baton flag -> watcher applies BATON_PASS

    // A plain switch relays data[0] = 0.
    owner.sendInteractionChoice(0, "switch", 4, [0]);
    const plain = await watcher.awaitInteractionChoice(0);
    expect(plain?.choice).toBe(4);
    expect(plain?.data?.[0]).toBe(0);
  });

  it("a leave sentinel still carries no data (unchanged)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);
    owner.sendInteractionChoice(0, "switch", COOP_INTERACTION_LEAVE);
    const res = await watcher.awaitInteractionChoice(0);
    expect(res?.choice).toBe(COOP_INTERACTION_LEAVE);
  });
});

describe("co-op Stormglass one-time weather-pick relay (#130 co-op wiring)", () => {
  // The ER Stormglass relic prompts ONCE per run to CHOOSE the battle weather - a run-affecting value
  // hashed into the battle checksum. Before wiring, ErStormglassPickerPhase opened UiMode.OPTION_SELECT
  // on BOTH clients at wave start, so each human picked independently -> divergent weather -> checksum
  // resync storm (the systematic #855 unmirrored-screen class). Now the HOST OWNS the pick and relays the
  // chosen weather INDEX on the fixed COOP_STORMGLASS_SEQ; the GUEST awaits it and adopts the identical
  // weather (never opening its own picker). This exercises that wire end-to-end.
  it("the host relays the chosen weather INDEX and the guest maps it back to the identical WeatherType", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // Owner (host) picks Sandstorm (index 2 in STORMGLASS_WEATHER_CHOICES).
    const sandstormIndex = STORMGLASS_WEATHER_CHOICES.findIndex(c => c.weather === WeatherType.SANDSTORM);
    expect(sandstormIndex).toBeGreaterThanOrEqual(0);
    owner.sendInteractionChoice(COOP_STORMGLASS_SEQ, "stormglass", sandstormIndex);

    const res = await watcher.awaitInteractionChoice(COOP_STORMGLASS_SEQ);
    expect(res?.choice).toBe(sandstormIndex);
    // The guest maps the relayed index back to the exact weather the host chose (the phase's adopt path).
    expect(STORMGLASS_WEATHER_CHOICES[res!.choice].weather).toBe(WeatherType.SANDSTORM);
  });

  it("a watcher that never receives the pick resolves null (heals via checkpoint, never hangs)", async () => {
    const { guest } = createLoopbackPair();
    const watcher = new CoopInteractionRelay(guest, {
      timeoutMs: 5,
      schedule: (cb, _ms) => {
        setTimeout(cb, 0);
        return () => {};
      },
    });
    const res = await watcher.awaitInteractionChoice(COOP_STORMGLASS_SEQ);
    expect(res).toBeNull(); // the guest leaves the weather unset; the per-turn checkpoint converges it
  });
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op Terastallize relay (#633 Fix #4a) - applyWiredPartnerCommand", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.moveset([MoveId.TACKLE, MoveId.SPLASH]).enemyMoveset(MoveId.SPLASH);
  });

  it("a relayed command with tera:true resolves to Command.TERA (the watcher teras the partner)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const partner = game.scene.getPlayerParty()[0];

    // A plain FIGHT command stays FIGHT.
    const plain = applyWiredPartnerCommand(partner, {
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.TACKLE,
      targets: [2],
      useMode: MoveUseMode.NORMAL,
    });
    expect(plain?.command).toBe(Command.FIGHT);

    // The same command with the relayed tera flag becomes TERA, so handleCommand's TERA case
    // sets the preTurnCommand and the partner Terastallizes - matching the owner's engine.
    const tera = applyWiredPartnerCommand(partner, {
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.TACKLE,
      targets: [2],
      useMode: MoveUseMode.NORMAL,
      tera: true,
    });
    expect(tera?.command).toBe(Command.TERA);
    // The chosen move is still resolved by id (not the wire cursor), unchanged by the tera flag.
    expect(tera?.turnMove.move).toBe(MoveId.TACKLE);
  });
});
