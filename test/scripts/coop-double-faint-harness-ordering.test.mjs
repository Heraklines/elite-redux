/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("../tests/elite-redux/coop/coop-duo-double-faint.test.ts", import.meta.url),
  "utf8",
).replace(/\r\n/gu, "\n");

test("host-first double faint drives the real replica successor before awaiting the authority crossing", () => {
  const hostFirst = source.indexOf("if (order.firstOwnerSeatId === 0)");
  const guestQueue = source.indexOf("driveClientPhaseQueueTo(", hostFirst);
  const guestPicker = source.indexOf("picker.start()", guestQueue);
  const hostPump = source.indexOf("withClient(rig.hostCtx, () => drainLoopback())", guestPicker);
  const hostSettle = source.indexOf(
    'settleDuoPromise(rig, hostAdvance!, "double-KO replacement host crossing")',
    hostPump,
  );

  assert.ok(hostFirst >= 0, "the mirrored host-first row must have an explicit scheduling branch");
  assert.ok(
    guestQueue > hostFirst && guestPicker > guestQueue && hostPump > guestPicker && hostSettle > hostPump,
    "the fixture must drive the exact guest queue and picker while the host SwitchPhase is waiting",
  );
  assert.match(
    source.slice(hostFirst, hostSettle),
    /matches: phase => phase\.phaseName === "CoopGuestFaintSwitchPhase"/u,
    "the harness may stop only at the typed replacement successor, never a guessed phase",
  );
});
