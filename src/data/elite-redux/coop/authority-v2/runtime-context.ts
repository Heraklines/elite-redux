/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 1 (explicit runtime ownership): the concrete
// CoopRuntimeContext factory (frozen contract
// src/data/elite-redux/coop/authority-v2/contract.ts).
//
// The context is the by-construction cure for the ambient-runtime bleed the
// co-op netcode suffered (timers/continuations resuming under the WRONG engine):
// every v2 transaction CARRIES its immutable identity + capabilities instead of
// reading getCoopRuntime()/globalScene after an async boundary. This factory
// assembles ONE such context - constructor-injected scene/transport/scheduler +
// identity fields, plus an AbortController-backed `cancellation` signal - and
// returns it beside an exported disposer that aborts the signal.
//
// OWNERSHIP (contract rules): no module-global mutable state lives here; each
// call builds a fresh, frozen context with its OWN AbortController. Engine-free:
// BattleScene and CoopTransport are TYPE-ONLY imports (erased at runtime).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import type { CoopRuntimeContext, CoopScheduler } from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** Constructor-injected inputs for one {@link CoopRuntimeContext}. */
export interface CreateCoopRuntimeContextInput {
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly localSeatId: number;
  readonly authoritySeatId: number;
  readonly membershipRevision: number;

  readonly scene: BattleScene;
  readonly transport: CoopTransport;
  readonly scheduler: CoopScheduler;
}

/**
 * An assembled context paired with its exported disposer. `dispose(reason)`
 * aborts the context's `cancellation` signal exactly once, cancelling every wait
 * that owns it (contract: "every wait owns an AbortSignal"). Idempotent.
 */
export interface CoopRuntimeContextHandle {
  readonly context: CoopRuntimeContext;
  /** Abort the context's cancellation signal (idempotent). */
  dispose(reason?: string): void;
  /** Whether the context's cancellation signal has already been aborted. */
  readonly disposed: boolean;
}

/**
 * Assemble one immutable {@link CoopRuntimeContext}. The returned context is
 * frozen (every field is `readonly` in the contract, so freezing enforces it at
 * runtime too) and carries a private AbortController whose signal is exposed as
 * `context.cancellation`; the handle's `dispose` is the only way to abort it.
 */
export function createCoopRuntimeContext(input: CreateCoopRuntimeContextInput): CoopRuntimeContextHandle {
  const controller = new AbortController();

  const context: CoopRuntimeContext = Object.freeze({
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    runId: input.runId,
    epoch: input.epoch,
    localSeatId: input.localSeatId,
    authoritySeatId: input.authoritySeatId,
    membershipRevision: input.membershipRevision,

    scene: input.scene,
    transport: input.transport,
    scheduler: input.scheduler,
    cancellation: controller.signal,
  });

  const dispose = (reason?: string): void => {
    if (!controller.signal.aborted) {
      controller.abort(reason ?? `coop-runtime-context-disposed:${input.runtimeId}`);
    }
  };

  return {
    context,
    dispose,
    get disposed(): boolean {
      return controller.signal.aborted;
    },
  };
}
