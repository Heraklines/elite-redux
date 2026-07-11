/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  COOP_FAINT_SWITCH_SEQ_BASE,
  sendCoopFaintSwitchChoice,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { assembleCoopRuntime, clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, describe, expect, it } from "vitest";

describe("co-op faint-switch operation migration", () => {
  afterEach(() => clearCoopRuntime());

  it("INTENT RECOVERY: dropping the guest's replacement pick still delivers that exact pick to host authority", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "switch",
      },
      { seed: 0xfa1717 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    const seq = COOP_FAINT_SWITCH_SEQ_BASE + COOP_GUEST_FIELD_INDEX;
    const exactPick = { partySlot: 3, data: [0, 6] };
    pair.armNextDrop("interactionChoice", "guest");
    const hostAwait = hostRuntime.interactionRelay.awaitInteractionChoice(seq, 25);

    sendCoopFaintSwitchChoice(
      guestRuntime.interactionRelay,
      COOP_GUEST_FIELD_INDEX,
      exactPick.partySlot,
      exactPick.data,
    );

    expect(pair.faultsInjected(), "the one-shot guest replacement intent was actually dropped").toBe(1);
    expect(await hostAwait, "the host must receive the human's exact replacement, never silently auto-pick").toMatchObject({
      choice: exactPick.partySlot,
      data: exactPick.data,
      kind: "switch",
    });
  });
});
