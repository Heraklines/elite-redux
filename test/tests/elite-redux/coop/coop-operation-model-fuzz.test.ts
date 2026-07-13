/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type CoopAuthoritativeEnvelopeV1, makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  registerCoopOperationLiveSink,
} from "#data/elite-redux/coop/coop-operation-journal";
import { CoopOperationGuest, CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 0,
  wave: 1,
  turn: 0,
  playerParty: [],
  enemyParty: [],
  field: [],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 0,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
};

function rngFor(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function committedRun(epoch: number, count: number): CoopAuthoritativeEnvelopeV1[] {
  const host = new CoopOperationHost({ epoch });
  const envelopes: CoopAuthoritativeEnvelopeV1[] = [];
  for (let i = 1; i <= count; i++) {
    const submitted = host.submit(
      {
        id: makeCoopOperationId(epoch, i % 2, i, "BIOME_PICK"),
        kind: "BIOME_PICK",
        owner: i % 2,
        status: "proposed",
        payload: { sourceBiomeId: (i + 34) % 35, biomeId: i % 35, nodeIndex: i % 3, nextWave: i + 1 },
      },
      { wave: i, turn: 0, logicalPhase: "BIOME_SELECT", authoritativeState: { ...STATE, wave: i } },
      () => ({ ok: true }),
    );
    if (submitted.kind !== "committed") {
      throw new Error(`fixture failed to commit revision ${i}`);
    }
    envelopes.push(submitted.envelope);
  }
  return envelopes;
}

function lossyDelivery(canonical: CoopAuthoritativeEnvelopeV1[], random: () => number): CoopAuthoritativeEnvelopeV1[] {
  const delivered: CoopAuthoritativeEnvelopeV1[] = [];
  for (const envelope of canonical) {
    if (random() < 0.22) {
      continue;
    }
    delivered.push(envelope);
    if (random() < 0.28) {
      delivered.push(envelope);
    }
  }
  for (let i = 0; i + 1 < delivered.length; i++) {
    if (random() < 0.2) {
      [delivered[i], delivered[i + 1]] = [delivered[i + 1], delivered[i]];
      i++;
    }
  }
  return delivered;
}

function verifySeed(seed: number): void {
  const epoch = 10_000 + seed;
  const canonical = committedRun(epoch, 48);
  const random = rngFor(seed);
  const guest = new CoopOperationGuest({ epoch });
  const materialized = new Map<string, number>();
  registerCoopOperationLiveSink("op:biome", envelope => {
    const id = envelope.pendingOperation?.id ?? "missing";
    materialized.set(id, (materialized.get(id) ?? 0) + 1);
    return true;
  });

  for (const envelope of lossyDelivery(canonical, random)) {
    applyCoopOperationEnvelope(guest, "op:biome", envelope);
  }
  for (const envelope of canonical.slice(guest.getLastAppliedRevision())) {
    applyCoopOperationEnvelope(guest, "op:biome", envelope);
  }
  for (let i = 0; i < 20; i++) {
    applyCoopOperationEnvelope(guest, "op:biome", canonical[Math.floor(random() * canonical.length)]);
  }

  expect(guest.getLastAppliedRevision(), `seed ${seed} converged to the authoritative head`).toBe(canonical.length);
  expect(materialized.size, `seed ${seed} materialized every operation`).toBe(canonical.length);
  expect(
    [...materialized.values()].every(count => count === 1),
    `seed ${seed} never mutated twice`,
  ).toBe(true);

  const stale = { ...canonical[0], sessionEpoch: epoch - 1, revision: canonical.length + 1 };
  expect(applyCoopOperationEnvelope(guest, "op:biome", stale)).toBe("rejected");
  expect(materialized.size, `seed ${seed} rejected cross-epoch mutation before its sink`).toBe(canonical.length);
}

afterEach(() => registerCoopOperationLiveSink("op:biome", null));

describe("authoritative operation model fuzz", () => {
  it("converges exactly once after randomized drops, duplicates, reordering, and canonical tail replay", () => {
    for (let seed = 1; seed <= 64; seed++) {
      verifySeed(seed);
    }
  });
});
