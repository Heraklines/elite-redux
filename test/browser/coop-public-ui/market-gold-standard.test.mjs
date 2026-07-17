/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { assertMarketCoverage, assertMarketPurchaseConverged } from "./market-journey.mjs";

const root = resolve(import.meta.dirname, "../../..");

function observation({ localSeat, ownerSeat, marketOpen, stock, money, quantity, wave }) {
  return {
    version: 1,
    address: { epoch: 73, wave, turn: 4 },
    pinnedInteraction: wave === 10 ? 9 : 20,
    localRole: localSeat === 0 ? "host" : "guest",
    localSeat,
    ownerSeat,
    localOwner: localSeat === ownerSeat,
    marketOpen,
    uiMode: marketOpen ? "BIOME_SHOP" : "MESSAGE",
    phaseClass: "BiomeShopPhase",
    selectedIndex: marketOpen ? 1 : null,
    selectedItemId: marketOpen ? "WIDE_LENS" : null,
    money,
    stockModel: marketOpen ? "authoritative-visible" : "replica-apply-ledger",
    options: [
      { index: 0, id: "POKEBALL", name: "Poke Ball", cost: 200, stock: 6, targetModel: "direct" },
      { index: 1, id: "WIDE_LENS", name: "Wide Lens", cost: 1_200, stock, targetModel: "party" },
    ],
    party: [{ slot: 0, pokemonId: 9001, speciesId: 25 }],
    heldModifiers: quantity === 0 ? [] : [{ typeId: "WIDE_LENS", pokemonId: 9001, quantity }],
  };
}

function purchaseProof(ownerSeat, wave) {
  const labels = ["seat-0", "seat-1"];
  const before = Object.fromEntries(
    labels.map((label, localSeat) => [
      label,
      observation({
        localSeat,
        ownerSeat,
        marketOpen: localSeat === ownerSeat,
        stock: localSeat === ownerSeat ? 3 : 99,
        money: 5_000,
        quantity: 0,
        wave,
      }),
    ]),
  );
  const after = Object.fromEntries(
    labels.map((label, localSeat) => [
      label,
      observation({
        localSeat,
        ownerSeat,
        marketOpen: localSeat === ownerSeat,
        stock: localSeat === ownerSeat ? 2 : 98,
        money: 3_800,
        quantity: 1,
        wave,
      }),
    ]),
  );
  return assertMarketPurchaseConverged(before, after, {
    ownerLabel: `seat-${ownerSeat}`,
    targetId: "WIDE_LENS",
    partySlot: 0,
  });
}

test("Wide Lens projection is exact for both stable owner-seat orientations", () => {
  const guestOwned = purchaseProof(1, 10);
  const hostOwned = purchaseProof(0, 20);
  assert.equal(guestOwned.ownerSeat, 1);
  assert.equal(hostOwned.ownerSeat, 0);
  assert.equal(guestOwned.moneyBefore - guestOwned.moneyAfter, guestOwned.cost);
  assert.equal(hostOwned.moneyBefore - hostOwned.moneyAfter, hostOwned.cost);
});

test("gold-standard coverage requires both owner parities and a later command after each normal leave", () => {
  const guestOwned = purchaseProof(1, 10);
  const hostOwned = purchaseProof(0, 20);
  const visits = [
    {
      pinnedInteraction: guestOwned.pinnedInteraction,
      purchases: [guestOwned],
      leaveRequestedViaPublicConfirmation: true,
      continuation: { status: "command", wave: 11 },
    },
    {
      pinnedInteraction: hostOwned.pinnedInteraction,
      purchases: [hostOwned],
      leaveRequestedViaPublicConfirmation: true,
      continuation: { status: "command", wave: 21 },
    },
  ];
  assert.deepEqual(
    assertMarketCoverage(
      { visits, purchases: [guestOwned, hostOwned] },
      { targetId: "WIDE_LENS", requiredPurchases: 2, requireBothOwnerSeats: true },
    ),
    { targetId: "WIDE_LENS", purchaseCount: 2, ownerSeats: [0, 1], visitCount: 2 },
  );
  assert.throws(
    () =>
      assertMarketCoverage(
        { visits: [visits[0], visits[0]], purchases: [guestOwned, guestOwned] },
        { targetId: "WIDE_LENS", requiredPurchases: 2, requireBothOwnerSeats: true },
      ),
    /both interaction-owner seat parities/u,
  );
  assert.throws(
    () =>
      assertMarketCoverage(
        { visits: [{ ...visits[0], continuation: null }], purchases: [guestOwned] },
        { targetId: "WIDE_LENS", requiredPurchases: 1 },
      ),
    /did not prove a next public command/u,
  );
});

test("journey workflow enables the continuous two-parity contract and trace-off public lane", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8");
  assert.match(workflow, /COOP_UI_CAMPAIGN_WAVES: "20"/u);
  assert.match(
    workflow,
    /COOP_UI_MARKET_REQUIRED_PURCHASES: \$\{\{ inputs\.journey == 'market-wide-lens' && '2' \|\| '0' \}\}/u,
  );
  assert.match(
    workflow,
    /COOP_UI_MARKET_REQUIRE_BOTH_OWNER_SEATS: \$\{\{ inputs\.journey == 'market-wide-lens' && '1' \|\| '0' \}\}/u,
  );
  assert.match(workflow, /COOP_UI_MARKET_SECOND_PURCHASE: "1"/u);
  assert.match(workflow, /COOP_UI_CHROME_TRACE: \$\{\{ inputs\.chrome_trace && '1' \|\| '0' \}\}/u);
  assert.match(workflow, /node test\/browser\/coop-public-ui\/run-campaign\.mjs/u);
  assert.match(workflow, /node test\/browser\/coop-public-ui\/check-campaign-boundary\.mjs/u);
  assert.match(workflow, /node --test test\/browser\/coop-public-ui\/market-gold-standard\.test\.mjs/u);
});

test("private DataChannel fault injection stays out of the human-equivalent lane", async () => {
  const readme = await readFile(resolve(root, "test/browser/coop-public-ui/README.md"), "utf8");
  const marketJourney = await readFile(resolve(root, "test/browser/coop-public-ui/market-journey.mjs"), "utf8");
  assert.match(readme, /coop-duo-biome-market-continuation\.test\.ts/u);
  assert.match(readme, /coop-reward-authoritative-result\.test\.ts/u);
  assert.doesNotMatch(marketJourney, /RTCDataChannel|RTCPeerConnection|page\.evaluate\(/u);
});
