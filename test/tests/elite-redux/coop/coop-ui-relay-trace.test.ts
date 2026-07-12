/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  beginCoopUiRelayInput,
  endCoopUiRelayInput,
  getCoopUiRelayEdges,
  recordCoopUiRelayCarrier,
  resetCoopUiRelayTrace,
} from "#data/elite-redux/coop/coop-ui-relay-trace";
import { UiMode } from "#enums/ui-mode";
import { beforeEach, describe, expect, it } from "vitest";

describe("co-op UI-to-relay production-boundary trace", () => {
  beforeEach(() => resetCoopUiRelayTrace());

  it("refuses to count direct relay injection as UI coverage", () => {
    recordCoopUiRelayCarrier("interactionChoice", "direct test/harness injection");
    expect(getCoopUiRelayEdges()).toEqual([]);
  });

  it("attributes a production carrier to the public UI scope that caused it", () => {
    const inputId = beginCoopUiRelayInput(UiMode.TARGET_SELECT);
    recordCoopUiRelayCarrier("battleCommand", "field=0 turn=1");
    endCoopUiRelayInput(inputId);

    expect(getCoopUiRelayEdges()).toEqual([
      { inputId, mode: UiMode.TARGET_SELECT, carrier: "battleCommand", detail: "field=0 turn=1" },
    ]);
  });

  it("keeps nested/replayed input attribution scoped and restores the outer input", () => {
    const outer = beginCoopUiRelayInput(UiMode.MYSTERY_ENCOUNTER);
    const inner = beginCoopUiRelayInput(UiMode.ER_QUIZ);
    recordCoopUiRelayCarrier("interactionChoice", "quiz answer");
    endCoopUiRelayInput(inner);
    recordCoopUiRelayCarrier("operation", "ME terminal");
    endCoopUiRelayInput(outer);

    expect(getCoopUiRelayEdges().map(edge => [edge.inputId, edge.mode, edge.carrier])).toEqual([
      [inner, UiMode.ER_QUIZ, "interactionChoice"],
      [outer, UiMode.MYSTERY_ENCOUNTER, "operation"],
    ]);
  });
});
