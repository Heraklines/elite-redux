/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_STORMGLASS_SEQ } from "#data/elite-redux/coop/coop-seq-registry";
import { getCoopOperationJournalApplied } from "#data/elite-redux/coop/coop-operation-journal";
import {
  commitCoopStormglassDecision,
  resetCoopStormglassOperationFlag,
  setCoopStormglassOperationEnabled,
} from "#data/elite-redux/coop/coop-stormglass-operation";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { WeatherType } from "#enums/weather-type";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, describe, expect, it } from "vitest";

describe("co-op Stormglass operation migration", () => {
  afterEach(() => {
    resetCoopStormglassOperationFlag();
    clearCoopRuntime();
  });

  it("keeps the pure legacy weather-choice carrier working when the operation flag is off", async () => {
    setCoopStormglassOperationEnabled(false);
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    const awaited = guestRuntime.interactionRelay.awaitInteractionChoice(COOP_STORMGLASS_SEQ, 25, ["stormglass"]);

    commitCoopStormglassDecision(hostRuntime.interactionRelay, 2, WeatherType.SANDSTORM, {
      localRole: "host",
      wave: 8,
      turn: 0,
    });

    expect(await awaited).toMatchObject({ choice: 2, kind: "stormglass" });
  });

  it("DURABILITY: dropping the raw owner choice still materializes the committed weather", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 1, reorder: 0, delay: 0, faultable: msg => msg.t === "interactionChoice" && msg.kind === "stormglass" },
      { seed: 0x57026a55 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const awaited = guestRuntime.interactionRelay.awaitInteractionChoice(COOP_STORMGLASS_SEQ, 100, ["stormglass"]);

    commitCoopStormglassDecision(hostRuntime.interactionRelay, 2, WeatherType.SANDSTORM, {
      localRole: "host",
      wave: 8,
      turn: 0,
    });

    expect(pair.faultsInjected(), "the raw stormglass choice was actually dropped").toBe(1);
    expect(await awaited).toMatchObject({ choice: 2, kind: "stormglass" });
    expect(
      getCoopOperationJournalApplied().find(envelope => envelope.pendingOperation?.kind === "STORMGLASS")
        ?.pendingOperation?.payload,
      "the exact resolved index and weather are trace-replayable",
    ).toEqual({ weatherIndex: 2, weather: WeatherType.SANDSTORM });
  });

  it("EXACTLY ONCE: journal and raw carriers leave no phantom second weather choice", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const first = guestRuntime.interactionRelay.awaitInteractionChoice(COOP_STORMGLASS_SEQ, 100, ["stormglass"]);

    commitCoopStormglassDecision(hostRuntime.interactionRelay, 1, WeatherType.RAIN, {
      localRole: "host",
      wave: 8,
      turn: 0,
    });

    expect(await first).toMatchObject({ choice: 1, kind: "stormglass" });
    expect(
      await guestRuntime.interactionRelay.awaitInteractionChoice(COOP_STORMGLASS_SEQ, 5, ["stormglass"]),
      "the legacy echo was consumed rather than buffered as a second pick",
    ).toBeNull();
  });
});
