/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// AUTHORITY-V2 proposal-wait spec for MYSTERY ME sub-prompts (campaign run 29912693840 mystery-gauntlet
// lane, guest-seat fail-closed terminal "Mystery party choice 8000001 unavailable after bounded wait").
//
// On a GUEST-OWNED ME under the interaction-V2 cutover the sole-engine authority (host) awaits the guest
// owner's relayed picks. The TOP-LEVEL option list awaits a `me` option pick; a SUB-prompt presentation
// (party target / secondary menu / catch-full replace) awaits a `meSub` sub-pick on the SAME ME pump seq.
// `coopV2AuthorityProposalWaitSpec` derives the accepted-kinds signature the authority's remote proposal
// wait must carry from the IMMUTABLE armed ME presentation. Before the fix it returned `["me"]` for EVERY
// ME_PRESENT, so the authority's `["meSub"]` party/secondary/catch-full wait was unaddressable and refused
// ("refused unaddressed remote proposal wait ... expected=[meSub]") -> the shared-session terminal above.
// The fix branches on the armed control + presentation `subPrompt`: a party/secondary presentation (op:me
// ME_PRESENT) and the catch-full replace picker (op:catchFull CATCH_FULL) resolve to `meSub`, the top-level
// option list stays `me`, and `quiz` (op:me QUIZ_ANSWER; it streams its own session on a distinct quiz seq)
// resolves NO pump-seq wait.
//
// This is a PURE, deterministic regression over the exact resolver the browser hit (engine-free: it
// projects immutable entry material, no GameManager / no two-engine boot).
// =============================================================================

import type { CoopAuthorityEntry, CoopFrameContextV2 } from "#data/elite-redux/coop/authority-v2/contract";
import { buildCoopV2InteractionEnvelopeEntry } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { projectionPlanOfCoopV2InteractionEntry } from "#data/elite-redux/coop/authority-v2/interaction-projection";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopLogicalPhase,
  CoopOperationKind,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import type { CoopOperationSurfaceClass } from "#data/elite-redux/coop/coop-operation-surface-registry";
import { coopV2AuthorityProposalWaitSpec } from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_ME_PICK_CHOICE_KINDS,
  COOP_ME_PUMP_SEQ_BASE,
  COOP_ME_SUB_CHOICE_KINDS,
} from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopAuthoritativeBattleStateV1, CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

const FRAME: CoopFrameContextV2 = {
  sessionId: "session",
  runId: "run",
  sessionEpoch: 1,
  seatMapId: "map",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 1,
  wave: 12,
  turn: 0,
  double: true,
  playerParty: [],
  enemyParty: [],
  field: [],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 1000,
  lockModifierTiers: false,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
  seed: "seed",
  waveSeed: "wave-seed",
};

/** The guest owns the ME (odd counter); the pinned pump ordinal the presentation was minted under. */
const ME_PINNED = 3;

type Presentation = Extract<CoopInteractionOutcome, { k: "mePresent" }>;

type MysteryPlan = Extract<NonNullable<ReturnType<typeof projectionPlanOfCoopV2InteractionEntry>>, { kind: "mystery" }>;

/** Build the SHARED_INTERACTION control + mystery projection plan for one armed ME presentation. */
function meControlAndPlan(presentation: Presentation): {
  control: Extract<NonNullable<CoopAuthorityEntry["nextControl"]>, { kind: "SHARED_INTERACTION" }>;
  plan: MysteryPlan;
} {
  const surfaceClass: CoopOperationSurfaceClass = "op:me";
  const kind: CoopOperationKind = "ME_PRESENT";
  const logicalPhase: CoopLogicalPhase = "MYSTERY_ENCOUNTER";
  const owner = 1; // guest-owned ME (odd seat)
  const pinnedSeq = (COOP_ME_PUMP_SEQ_BASE + ME_PINNED) * 8000;
  const envelope: CoopAuthoritativeEnvelopeV1 = {
    version: 1,
    sessionEpoch: 1,
    revision: 1,
    wave: STATE.wave,
    turn: STATE.turn,
    logicalPhase,
    pendingOperation: {
      id: makeCoopOperationId(1, owner, pinnedSeq, kind),
      kind,
      owner,
      status: "applied",
      payload: { present: true, presentation },
    },
    authoritativeState: STATE,
  };
  const built = buildCoopV2InteractionEnvelopeEntry({ context: FRAME, surfaceClass, envelope });
  expect(built, "ME presentation entry built from immutable material").not.toBeNull();
  const entry: CoopAuthorityEntry = { ...built!, revision: 1 };
  const control = entry.nextControl;
  expect(control?.kind, "the ME presentation arms a SHARED_INTERACTION control").toBe("SHARED_INTERACTION");
  if (control?.kind !== "SHARED_INTERACTION") {
    throw new Error("expected SHARED_INTERACTION control");
  }
  const plan = projectionPlanOfCoopV2InteractionEntry(entry);
  expect(plan?.kind, "the entry projects to a mystery interaction plan").toBe("mystery");
  if (plan == null || plan.kind !== "mystery") {
    throw new Error("expected a mystery projection plan");
  }
  return { control, plan };
}

function topLevel(): Presentation {
  return { k: "mePresent", tokens: {}, meetsReqs: [true, true], labels: ["A", "B"] };
}

function withSubPrompt(subPrompt: NonNullable<Presentation["subPrompt"]>): Presentation {
  return { k: "mePresent", tokens: {}, meetsReqs: [], labels: [], subPrompt };
}

describe("Authority-V2 ME sub-prompt proposal-wait spec (campaign 29912693840 party-choice terminal)", () => {
  it("a party sub-prompt presentation awaits the guest owner's meSub sub-pick (NOT the me option pick)", () => {
    const { control, plan } = meControlAndPlan(withSubPrompt({ kind: "party" }));
    const spec = coopV2AuthorityProposalWaitSpec(control, plan);
    expect(spec, "the authority resolves an addressable proposal wait for the party sub-pick").not.toBeNull();
    expect(
      spec?.acceptedKinds,
      "the party sub-prompt awaits meSub - without this the authority refuses an unaddressed wait and terminals",
    ).toEqual(COOP_ME_SUB_CHOICE_KINDS);
    expect(spec?.relaySequence, "the sub-pick awaits on the ME pump seq for this pinned ordinal").toBe(
      COOP_ME_PUMP_SEQ_BASE + plan.pinned,
    );
  });

  it("a secondary sub-prompt presentation also awaits meSub", () => {
    const { control, plan } = meControlAndPlan(withSubPrompt({ kind: "secondary", labels: ["Yes", "No"] }));
    expect(coopV2AuthorityProposalWaitSpec(control, plan)?.acceptedKinds).toEqual(COOP_ME_SUB_CHOICE_KINDS);
  });

  it("a catch-full replace sub-prompt presentation also awaits meSub", () => {
    const { control, plan } = meControlAndPlan(withSubPrompt({ kind: "catchFull", pokemonName: "Pikachu" }));
    expect(coopV2AuthorityProposalWaitSpec(control, plan)?.acceptedKinds).toEqual(COOP_ME_SUB_CHOICE_KINDS);
  });

  it("the top-level option list (no sub-prompt) still awaits the me option pick", () => {
    const { control, plan } = meControlAndPlan(topLevel());
    expect(coopV2AuthorityProposalWaitSpec(control, plan)?.acceptedKinds).toEqual(COOP_ME_PICK_CHOICE_KINDS);
  });

  it("a quiz sub-prompt does NOT resolve a pump-seq proposal wait (it streams its own quiz seq)", () => {
    const { control, plan } = meControlAndPlan(withSubPrompt({ kind: "quiz", questions: [], stopOnWrong: false }));
    // The quiz sub-prompt arms an op:me / QUIZ_ANSWER control; the guest owner drives the session on the
    // distinct quiz seq, so the pump-seq resolver resolves NO wait for it (it is never a meSub sub-pick).
    expect(coopV2AuthorityProposalWaitSpec(control, plan)).toBeNull();
  });
});
