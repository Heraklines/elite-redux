/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op INTERACTION primitive (#633 M3 step 1). Pure-logic test (no game engine): proves the
// owner-drives -> authority-applies -> replicate lifecycle across EVERY role combination. The core
// invariant M3 exists for: ONLY the authority mutates (applyOutcome); non-owners apply NOTHING and
// converge via the replicated state. See docs/plans/2026-07-02-coop-authoritative-replication-redesign.md.

import {
  type CoopInteraction,
  type CoopInteractionContext,
  runCoopInteraction,
} from "#data/elite-redux/coop/coop-interaction";
import { describe, expect, it, vi } from "vitest";

type Outcome = { pick: number };

/** An interaction owned by `ownerId` whose owner-drive resolves `{ pick: 42 }`. */
function makeInteraction(ownerId: number) {
  const driveLocally = vi.fn(async (): Promise<Outcome> => ({ pick: 42 }));
  const showSpectatorView = vi.fn();
  const interaction: CoopInteraction<Outcome> = { id: 7, ownerId, driveLocally, showSpectatorView };
  return { interaction, driveLocally, showSpectatorView };
}

/** A mock context with spyable seams; `awaitOutcome` returns `{ pick: 99 }` (the relayed owner choice). */
function makeCtx(overrides: Partial<CoopInteractionContext<Outcome>> = {}) {
  const spies = {
    sendOutcome: vi.fn(),
    awaitOutcome: vi.fn(async (): Promise<Outcome | null> => ({ pick: 99 })),
    applyOutcome: vi.fn(),
    replicateState: vi.fn(),
    signalAdvance: vi.fn(),
    awaitAdvance: vi.fn(async () => {}),
    defaultOutcome: vi.fn((): Outcome | null => ({ pick: 0 })),
  };
  const ctx: CoopInteractionContext<Outcome> = { localId: 0, authorityId: 0, ...spies, ...overrides };
  return { ctx, ...spies };
}

describe("co-op interaction primitive (#633 M3)", () => {
  it("host owns (local is BOTH owner and authority): drives + applies directly, never relays", async () => {
    const { interaction, driveLocally, showSpectatorView } = makeInteraction(0);
    const { ctx, sendOutcome, awaitOutcome, applyOutcome, replicateState, signalAdvance } = makeCtx({
      localId: 0,
      authorityId: 0,
    });

    const result = await runCoopInteraction(interaction, ctx);

    expect(result).toEqual({ pick: 42 });
    expect(driveLocally).toHaveBeenCalledOnce();
    expect(showSpectatorView).not.toHaveBeenCalled();
    expect(sendOutcome).not.toHaveBeenCalled(); // owner IS the authority -> no relay
    expect(awaitOutcome).not.toHaveBeenCalled();
    expect(applyOutcome).toHaveBeenCalledExactlyOnceWith(7, { pick: 42 });
    expect(replicateState).toHaveBeenCalledExactlyOnceWith(7);
    expect(signalAdvance).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("authority but NOT owner (remote owner): spectates, awaits the owner's outcome, applies it", async () => {
    const { interaction, driveLocally, showSpectatorView } = makeInteraction(1);
    const { ctx, sendOutcome, awaitOutcome, applyOutcome, replicateState } = makeCtx({ localId: 0, authorityId: 0 });

    const result = await runCoopInteraction(interaction, ctx);

    expect(result).toEqual({ pick: 99 });
    expect(driveLocally).not.toHaveBeenCalled(); // we do not own it
    expect(showSpectatorView).toHaveBeenCalledOnce();
    expect(sendOutcome).not.toHaveBeenCalled();
    expect(awaitOutcome).toHaveBeenCalledOnce();
    expect(applyOutcome).toHaveBeenCalledExactlyOnceWith(7, { pick: 99 });
    expect(replicateState).toHaveBeenCalledOnce();
  });

  it("owner but NOT authority: drives, relays, applies NOTHING, waits the advance", async () => {
    const { interaction, driveLocally } = makeInteraction(1);
    const { ctx, sendOutcome, applyOutcome, replicateState, awaitAdvance } = makeCtx({ localId: 1, authorityId: 0 });

    const result = await runCoopInteraction(interaction, ctx);

    expect(result).toEqual({ pick: 42 });
    expect(driveLocally).toHaveBeenCalledOnce();
    expect(sendOutcome).toHaveBeenCalledExactlyOnceWith(7, { pick: 42 });
    expect(applyOutcome).not.toHaveBeenCalled(); // NON-authority mutates nothing
    expect(replicateState).not.toHaveBeenCalled();
    expect(awaitAdvance).toHaveBeenCalledOnce();
  });

  it("pure spectator (neither owner nor authority): spectates, applies NOTHING, waits the advance", async () => {
    const { interaction, driveLocally, showSpectatorView } = makeInteraction(1);
    const { ctx, sendOutcome, applyOutcome, awaitAdvance } = makeCtx({ localId: 2, authorityId: 0 });

    const result = await runCoopInteraction(interaction, ctx);

    expect(result).toBeNull();
    expect(driveLocally).not.toHaveBeenCalled();
    expect(showSpectatorView).toHaveBeenCalledOnce();
    expect(sendOutcome).not.toHaveBeenCalled();
    expect(applyOutcome).not.toHaveBeenCalled();
    expect(awaitAdvance).toHaveBeenCalledOnce();
  });

  it("authority, remote owner TIMES OUT: applies the safe default so the run never hangs", async () => {
    const { interaction } = makeInteraction(1);
    const { ctx, defaultOutcome, applyOutcome, signalAdvance } = makeCtx({
      localId: 0,
      authorityId: 0,
      awaitOutcome: vi.fn(async (): Promise<Outcome | null> => null), // owner gone
    });

    const result = await runCoopInteraction(interaction, ctx);

    expect(defaultOutcome).toHaveBeenCalledOnce();
    expect(applyOutcome).toHaveBeenCalledExactlyOnceWith(7, { pick: 0 });
    expect(signalAdvance).toHaveBeenCalledOnce();
    expect(result).toEqual({ pick: 0 });
  });

  it("authority, remote owner times out with NO default: applies nothing but STILL advances", async () => {
    const { interaction } = makeInteraction(1);
    const { ctx, applyOutcome, replicateState, signalAdvance } = makeCtx({
      localId: 0,
      authorityId: 0,
      awaitOutcome: vi.fn(async (): Promise<Outcome | null> => null),
    });
    delete ctx.defaultOutcome; // no safe default -> authority applies nothing but must still advance

    const result = await runCoopInteraction(interaction, ctx);

    expect(applyOutcome).not.toHaveBeenCalled();
    expect(replicateState).not.toHaveBeenCalled();
    expect(signalAdvance).toHaveBeenCalledOnce(); // never leave the interaction open
    expect(result).toBeNull();
  });
});
