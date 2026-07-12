/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopMembershipController } from "#data/elite-redux/coop/coop-membership";
import { describe, expect, it } from "vitest";

describe("co-op revisioned membership control", () => {
  it("disconnect -> same-seat higher-generation rejoin is explicit and monotonic", () => {
    const membership = new CoopMembershipController(() => "host");
    const initial = membership.snapshot();
    expect(initial).toMatchObject({ revision: 1, connectionGeneration: 0, state: "active" });

    const recovering = membership.peerDisconnected();
    expect(recovering).toMatchObject({ revision: 2, state: "recovering" });
    expect(recovering.members[1]).toMatchObject({ seatId: 1, role: "guest", present: false });

    const active = membership.reconnected(7);
    expect(active).toMatchObject({ revision: 3, connectionGeneration: 7, state: "active" });
    expect(active.members.every(member => member.present)).toBe(true);
  });

  it("rejects stale generations, stale revisions, and malformed authority seating", () => {
    const guest = new CoopMembershipController(() => "guest");
    guest.peerDisconnected();
    guest.reconnected(4);

    const stale = guest.snapshot();
    expect(guest.adopt({ ...stale, revision: stale.revision - 1 })).toBe(false);
    expect(guest.adopt({ ...stale, connectionGeneration: 3 })).toBe(false);
    expect(
      guest.adopt({
        ...stale,
        members: [
          { seatId: 0, role: "guest", present: true },
          { seatId: 1, role: "host", present: true },
        ],
      }),
    ).toBe(false);
  });

  it("terminal loss is a revisioned end state, never implicit solo continuation", () => {
    const membership = new CoopMembershipController(() => "host");
    membership.peerDisconnected();
    const terminated = membership.terminate();
    expect(terminated).toMatchObject({ revision: 3, state: "terminated" });
    expect(membership.terminate()).toEqual(terminated);
  });
});
