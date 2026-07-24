/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TournamentView } from "#data/elite-redux/showdown/tournament-types";
import { tournamentRewardPreview } from "#ui/tournament-list-ui-handler";
import { describe, expect, it } from "vitest";

function tournament(rewardPool: NonNullable<TournamentView["rewardPool"]>): TournamentView {
  return {
    id: "preview-cup",
    name: "Preview Cup",
    organizer: "admin",
    state: "registration",
    roundWindowMs: 86_400_000,
    maxEntrants: 4,
    createdAt: 1,
    startedAt: null,
    champion: null,
    entrantCount: 0,
    entrants: [],
    rewardPool,
  };
}

describe("tournament reward list preview", () => {
  it("groups a chosen shiny and its Shiny Lab effects on one Pokemon preview", () => {
    const preview = tournamentRewardPreview(
      tournament([
        {
          place: "champion",
          mutations: [
            { kind: "grantShinyChosen", speciesId: 133, tier: 2 },
            { kind: "grantLabEffect", speciesId: 133, category: "palette", effectIndex: 3 },
            { kind: "grantLabEffect", speciesId: 133, category: "around", effectIndex: 1 },
          ],
        },
      ]),
    );

    expect(preview).toMatchObject({
      place: "champion",
      speciesId: 133,
      randomSpecies: false,
      shinyTier: 2,
      extraMutationCount: 0,
    });
    expect(preview?.labEffects).toHaveLength(2);
  });

  it("keeps unresolved random shiny prizes generic and preserves their tier", () => {
    const preview = tournamentRewardPreview(
      tournament([
        {
          place: "champion",
          mutations: [{ kind: "grantShinyRandom", tier: 4, unownedOnly: true, speciesPool: [] }],
        },
      ]),
    );

    expect(preview).toMatchObject({ randomSpecies: true, shinyTier: 4, extraMutationCount: 0 });
    expect(preview?.speciesId).toBeUndefined();
  });

  it("resolves a one-species random pool for the icon and renders candy amounts", () => {
    const random = tournamentRewardPreview(
      tournament([
        {
          place: "champion",
          mutations: [{ kind: "grantShinyRandom", tier: 1, unownedOnly: false, speciesPool: [151] }],
        },
      ]),
    );
    const candy = tournamentRewardPreview(
      tournament([{ place: "runnerUp", mutations: [{ kind: "grantCandy", speciesId: 25, candy: 50 }] }]),
    );

    expect(random).toMatchObject({ speciesId: 151, randomSpecies: false, shinyTier: 1 });
    expect(candy).toMatchObject({ place: "runnerUp", speciesId: 25, candy: 50 });
  });

  it("maps legacy black-shiny unlocks to the fourth-tier marker", () => {
    const preview = tournamentRewardPreview(
      tournament([
        {
          place: "champion",
          mutations: [{ kind: "grantUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: true, cost: 0 }],
        },
      ]),
    );

    expect(preview).toMatchObject({ speciesId: 6, shinyTier: 4 });
  });
});
