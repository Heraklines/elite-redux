/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  canonicalCombatCandidateId,
  ER_COMBAT_CONTRACT_VERSION,
  type ErCombatDecisionRecord,
  type ErCombatMoveCandidate,
  validateCombatDecisionRecord,
  withCanonicalCombatCandidateId,
} from "#data/elite-redux/ai/combat-contract";
import { describe, expect, it } from "vitest";

describe("ER combat AI contract", () => {
  it("uses semantic target identity rather than target order", () => {
    const base = {
      kind: "move" as const,
      actorSlot: 0,
      moveSlot: 2,
      moveId: 89,
      tera: false,
      targetMode: "resolved" as const,
      baseTypeMultiplier: 2,
      currentStab: true,
    };
    const a = canonicalCombatCandidateId({
      ...base,
      targets: [
        { side: "opponent", entityId: 20, activeSlot: 1 },
        { side: "opponent", entityId: 10, activeSlot: 0 },
      ],
    });
    const b = canonicalCombatCandidateId({
      ...base,
      targets: [
        { side: "opponent", entityId: 10, activeSlot: 0 },
        { side: "opponent", entityId: 20, activeSlot: 1 },
      ],
    });
    expect(a).toBe(b);
  });

  it("distinguishes Tera, target, switch mode, and shift destination", () => {
    const target = { side: "opponent" as const, entityId: 20, activeSlot: 0 };
    const normalInput: Omit<ErCombatMoveCandidate, "id"> = {
      kind: "move",
      actorSlot: 0,
      moveSlot: 0,
      moveId: 53,
      tera: false,
      targetMode: "resolved",
      targets: [target],
      baseTypeMultiplier: 1,
      currentStab: false,
    };
    const normal = withCanonicalCombatCandidateId(normalInput);
    const tera = withCanonicalCombatCandidateId({ ...normalInput, tera: true });
    const switchNormal = withCanonicalCombatCandidateId({
      kind: "switch",
      actorSlot: 0,
      partyIndex: 4,
      transfer: "normal",
    });
    const switchBaton = withCanonicalCombatCandidateId({
      kind: "switch",
      actorSlot: 0,
      partyIndex: 4,
      transfer: "baton",
    });
    const shift = withCanonicalCombatCandidateId({ kind: "shift", actorSlot: 0, targetActorSlot: 2 });
    expect(new Set([normal.id, tera.id, switchNormal.id, switchBaton.id, shift.id]).size).toBe(5);
  });

  it("fails a row unless its label maps to exactly one canonical candidate", () => {
    const candidate = withCanonicalCombatCandidateId({
      kind: "switch",
      actorSlot: 0,
      partyIndex: 2,
      transfer: "normal",
    });
    const record = {
      kind: "combat_decision",
      schemaVersion: ER_COMBAT_CONTRACT_VERSION,
      candidateScope: "combat-command",
      buildSha: "abc",
      dexHash: "dex",
      dictionaryHash: "dict",
      episodeId: "episode",
      jointActionId: "episode:1:1",
      decisionId: "episode:1:1:0",
      sourcePolicy: "scripted",
      actorSlot: 0,
      earlierCandidateIds: [],
      observation: {} as ErCombatDecisionRecord["observation"],
      candidates: [candidate],
      chosenCandidateId: candidate.id,
    } satisfies ErCombatDecisionRecord;
    expect(validateCombatDecisionRecord(record)).toEqual([]);
    expect(validateCombatDecisionRecord({ ...record, chosenCandidateId: "missing" })).toContain(
      "chosen candidate must map to exactly one legal candidate",
    );
  });
});
