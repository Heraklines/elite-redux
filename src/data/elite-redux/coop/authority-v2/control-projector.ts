/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op authority-v2 Lane 3 - the CONCRETE control PROJECTOR.
//
// The audited P0 is "authoritative state, non-authoritative continuation": the
// guest RECONSTRUCTS its next control from its local Phaser phase queue, so a
// mechanically-converged session dies the moment that chain fails to produce the
// surface the host reached. This projector INVERTS that: the host STATES the
// successor (a CoopNextControl on the committed entry); the replica PROJECTS the
// exact stated surface into its own phase manager. It DECIDES NOTHING - the entry
// already did; projection is a total, deterministic map from a stated control to
// the local engine surface.
//
// ENGINE ACCESS THROUGH A THIN SEAM (contract ownership rules):
//   - The projector NEVER reads globalScene or getCoopRuntime; it takes every
//     capability from the passed CoopRuntimeContext, captured SYNCHRONOUSLY at
//     the top of project() (there is no await in this file, so there is no
//     post-await globalScene hazard to begin with).
//   - All engine touching is funneled through the narrow {@link ControlSurface}
//     seam. The projector's OWN logic - validate -> already-installed ->
//     engine-pacing -> project - is engine-free and reads like a pure function
//     over that seam.
//   - {@link sceneControlSurface} is the concrete BattleScene-backed adapter that
//     maps each seam verb onto the real phase manager by phase NAME (so no phase
//     class is imported here - the string-keyed unshiftNew is the only coupling).
//
// HOW THE SENTINEL SUITE DRIVES THIS (no engine vitest lives here - that suite is
// forbidden to run locally):
//   - Construct the projector with an INJECTED surface factory:
//       createCoopControlProjector(() => fakeSurface)
//     where `fakeSurface` is a hand-built {@link ControlSurface} recording which
//     install* verb fired with which arguments, and returning scripted values
//     from hasControl()/isEnginePacing()/fieldSlotOfPokemon()/isPlayerFieldSlot().
//   - Drive project(ctx, control) with a stub ctx ({ localSeatId, scene } are the
//     only fields this file reads; scene is only forwarded to the factory, so the
//     fake factory can ignore it). Assert the returned CoopControlInstallResult
//     kind + that exactly the expected seam verb fired. Every branch below
//     (installed / already-installed / deferred / rejected, owner vs non-owner
//     replacement, unmaterialized command actor) is reachable purely by scripting
//     the fake surface + ctx.localSeatId - no Phaser boot required.
//   - The real {@link sceneControlSurface} adapter is exercised only by the
//     engine-backed sentinel suite (two live BattleScenes), never here.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import type {
  CoopControlInstallResult,
  CoopControlProjector,
  CoopNextControl,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  commandControlTargetId,
  commandTargetsOwnedBySeat,
  controlIdOf,
  type ProjectableControl,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import { coopV2InteractionUiProofContract } from "#data/elite-redux/coop/coop-operation-surface-registry";
import { UiMode } from "#enums/ui-mode";

// ---------------------------------------------------------------------------
// The thin engine seam
// ---------------------------------------------------------------------------

/**
 * The NARROW slice of the engine the projector needs. A real session adapts a
 * {@linkcode BattleScene} into this via {@link sceneControlSurface}; the sentinel
 * suite passes a fake so every projection branch is drivable without Phaser.
 *
 * The install* verbs are called ONLY after the projector has decided the surface
 * is absent, projectable, and the engine is not pacing - so an adapter's install
 * may assume it is being asked to materialize a genuinely-new surface. It must
 * remain idempotent anyway (a redelivered entry re-projects), which the reference
 * adapter enforces with a phase-name presence check.
 */
export interface ControlSurface {
  /**
   * Whether a surface with EXACTLY this controlId is already installed/active.
   * This is the authoritative "already-installed detection via controlId". The
   * installed-control ledger is owned by the log/lifecycle lane, so the reference
   * adapter can only answer conservatively (see {@link sceneControlSurface}); the
   * sentinel suite injects a surface whose hasControl reflects that ledger.
   */
  hasControl(controlId: string): boolean;

  /**
   * Whether the engine is mid-transition and cannot accept a new control surface
   * this frame. A `true` here yields a "deferred" result - engine pacing, NEVER a
   * terminal - which the log's redelivery machinery re-projects.
   */
  isEnginePacing(): boolean;

  /** The player field slot currently hosting `pokemonId`, or -1 when not on field. */
  fieldSlotOfPokemon(pokemonId: number): number;

  /** Whether `fieldIndex` is a real player slot in the current battle geometry. */
  isPlayerFieldSlot(fieldIndex: number): boolean;

  /** Install the owner-seat COMMAND surface for the resolved field slot. */
  installCommand(fieldIndex: number, controlId: string): void;

  /** Prove the exact naturally-created faint replacement picker; never fabricate one from ambient state. */
  installReplacement(operationId: string, ownerSeatId: number, controlId: string): boolean;

  /** Prove/install one registered shared-input surface after its immutable result materialized. */
  installSharedInteraction(
    surfaceClass: Extract<ProjectableControl, { kind: "SHARED_INTERACTION" }>["surfaceClass"],
    operationKind: Extract<ProjectableControl, { kind: "SHARED_INTERACTION" }>["operationKind"],
    operationId: string,
    controlId: string,
  ): boolean;

  /** Park progression at an address-constrained wait for the next ordered authority entry. */
  installSuccessorWait(
    afterOperationId: string,
    allowedKinds: Extract<ProjectableControl, { kind: "AWAIT_SUCCESSOR" }>["allowedKinds"],
    expectedOperationId: string | null,
    controlId: string,
  ): void;

  /** Engage the shared terminal freeze for `terminalId`. */
  installTerminal(terminalId: string, controlId: string): void;
}

/** Builds the engine seam from a run's context. Overridable for the sentinel suite. */
export type ControlSurfaceFactory = (ctx: CoopRuntimeContext) => ControlSurface;

// ---------------------------------------------------------------------------
// The projector
// ---------------------------------------------------------------------------

/**
 * The concrete {@linkcode CoopControlProjector}. Pure decision-free projection
 * over a {@link ControlSurface}: it maps a stated control to its exact local
 * surface, classifying the outcome as installed / already-installed / deferred /
 * rejected per the contract's rules. Holds no module-global mutable state; the
 * only field is the (immutable) surface factory.
 */
export class DefaultCoopControlProjector implements CoopControlProjector {
  private readonly surfaceFactory: ControlSurfaceFactory;

  constructor(surfaceFactory: ControlSurfaceFactory = sceneControlSurface) {
    this.surfaceFactory = surfaceFactory;
  }

  public project(ctx: CoopRuntimeContext, control: NonNullable<CoopNextControl>): CoopControlInstallResult {
    // Capture every engine capability SYNCHRONOUSLY, before any branch. project()
    // has no await, so ctx is never re-read across an async boundary.
    const projectable = control as ProjectableControl;

    // 1. STRUCTURAL validation. A malformed address can never be projected -> a
    //    named "rejected" (structural impossibility), not a deferred retry loop.
    const validation = validateNextControl(projectable);
    if (!validation.ok) {
      return { kind: "rejected", reason: validation.reason };
    }

    const controlId = controlIdOf(projectable);
    const surface = this.surfaceFactory(ctx);

    // 2. IDEMPOTENCY. The exact stated surface is already here -> already-installed.
    if (surface.hasControl(controlId)) {
      return { kind: "already-installed", controlId };
    }

    // 3. ENGINE PACING. The engine is mid-transition and can't take a surface now.
    //    Deferred is engine pacing, re-projected by the log - NEVER a terminal.
    if (surface.isEnginePacing()) {
      return { kind: "deferred", reason: `engine mid-transition; ${controlId} re-projects next pace` };
    }

    // 4. PROJECT the exact stated surface.
    switch (projectable.kind) {
      case "COMMAND_FRONTIER": {
        // The entry states the WHOLE frontier; this authenticated replica installs its numeric-seat
        // partition. Authority retirement requires every required peer's receipt, so a doubles/triples/N-seat
        // frontier remains complete without making one renderer fabricate another seat's public input.
        // Resolve this seat's whole partition before installing any component: a seat controlling multiple
        // battlers may never emit a partial receipt.
        const localCommands = commandTargetsOwnedBySeat(projectable, ctx.localSeatId);
        const resolved = localCommands.map(command => ({
          command,
          fieldIndex: surface.fieldSlotOfPokemon(command.pokemonId),
        }));
        for (const { command, fieldIndex } of resolved) {
          if (fieldIndex < 0) {
            return {
              kind: "deferred",
              reason: `command actor pokemonId=${command.pokemonId} not yet on field`,
            };
          }
          if (fieldIndex !== command.fieldIndex) {
            return {
              kind: "deferred",
              reason:
                `command actor pokemonId=${command.pokemonId} expected fieldIndex=${command.fieldIndex}`
                + ` but is at ${fieldIndex}`,
            };
          }
          if (!surface.isPlayerFieldSlot(fieldIndex)) {
            return {
              kind: "rejected",
              reason: `COMMAND_FRONTIER fieldIndex=${fieldIndex} is outside the current battle geometry`,
            };
          }
        }
        for (const { command, fieldIndex } of resolved) {
          surface.installCommand(
            fieldIndex,
            commandControlTargetId(projectable.epoch, projectable.wave, projectable.turn, command),
          );
        }
        return { kind: "installed", controlId };
      }
      case "REPLACEMENT":
        return surface.installReplacement(projectable.operationId, projectable.ownerSeatId, controlId)
          ? { kind: "installed", controlId }
          : { kind: "deferred", reason: `awaiting exact replacement picker for ${controlId}` };
      case "SHARED_INTERACTION":
        return surface.installSharedInteraction(
          projectable.surfaceClass,
          projectable.operationKind,
          projectable.operationId,
          controlId,
        )
          ? { kind: "installed", controlId }
          : {
              kind: "deferred",
              reason: `awaiting registered public UI for ${controlId}`,
            };
      case "AWAIT_SUCCESSOR":
        surface.installSuccessorWait(
          projectable.afterOperationId,
          projectable.allowedKinds,
          projectable.expectedOperationId,
          controlId,
        );
        return { kind: "installed", controlId };
      case "TERMINAL":
        surface.installTerminal(projectable.terminalId, controlId);
        return { kind: "installed", controlId };
    }
  }
}

/** Construct a projector, optionally over an injected surface factory (sentinel suite). */
export function createCoopControlProjector(
  surfaceFactory: ControlSurfaceFactory = sceneControlSurface,
): CoopControlProjector {
  return new DefaultCoopControlProjector(surfaceFactory);
}

// ---------------------------------------------------------------------------
// The concrete BattleScene-backed adapter (the integration seam)
// ---------------------------------------------------------------------------

/**
 * Adapt a live {@linkcode BattleScene} into the {@link ControlSurface} the
 * projector consumes. This is the ONLY engine-coupled code in the file, and it
 * couples ONLY by phase NAME (string-keyed `unshiftNew`) - no phase class is
 * imported, so no engine module enters this file's runtime import graph.
 *
 * The reference mapping (host-stated kind -> local phase surface):
 *   COMMAND     -> "CommandPhase" for the owner's resolved field slot.
 *   REPLACEMENT -> owner: "SwitchPhase" (modal faint-switch picker);
 *                  non-owner: "CoopPartnerSyncPhase" (await the owner's pick).
 *   SHARED_INTERACTION -> prove the registered, address-exact public interaction surface.
 *   AWAIT_SUCCESSOR    -> park at the stated ordered-log boundary.
 *   TERMINAL    -> drain the local control queue (freeze; stop deriving successors).
 *
 * SEAM CAVEATS (driven precisely by the sentinel suite, conservative here):
 *   - hasControl(): the authoritative installed-control ledger belongs to the
 *     log/lifecycle lane, not this lane. Without it, this adapter cannot recover
 *     an arbitrary controlId from a generic phase, so it answers `false` and
 *     leans on each install verb's own phase-presence guard for idempotency at
 *     the engine level. The sentinel suite injects a surface whose hasControl
 *     reflects the real ledger to exercise the already-installed branch.
 *   - isEnginePacing(): a phase on standby (an overridePhase in flight) is the
 *     one uniform "mid-transition" signal available without engine coupling.
 */
export function sceneControlSurface(ctx: CoopRuntimeContext): ControlSurface {
  const scene: BattleScene = ctx.scene;
  const pm = scene.phaseManager;

  return {
    hasControl(_controlId: string): boolean {
      // Conservative: no controlId ledger is owned by this lane (see caveats). The
      // install verbs guard duplicate phases; the sentinel suite supplies the real
      // ledger-backed answer.
      return false;
    },
    isEnginePacing(): boolean {
      return pm.getStandbyPhase() != null;
    },
    fieldSlotOfPokemon(pokemonId: number): number {
      return scene.getPlayerField().findIndex(p => p?.id === pokemonId);
    },
    isPlayerFieldSlot(fieldIndex: number): boolean {
      const battlerCount = scene.currentBattle?.getBattlerCount() ?? 0;
      return fieldIndex >= 0 && fieldIndex < battlerCount;
    },
    installCommand(fieldIndex: number): void {
      // Name-only presence guard: CommandPhase.fieldIndex is protected, so the
      // reference adapter cannot slot-match here. Address-exact idempotency is the
      // ledger-backed hasControl()'s job (sentinel suite); this only prevents a
      // trivially-redundant re-unshift when a command surface is already queued.
      if (!pm.hasPhaseOfType("CommandPhase")) {
        pm.unshiftNew("CommandPhase", fieldIndex);
      }
    },
    installReplacement(operationId, ownerSeatId): boolean {
      if (ctx.localSeatId !== ownerSeatId) {
        return true;
      }
      const phase = pm.getCurrentPhase() as { phaseName?: string; coopV2ControlOperationId?: string } | undefined;
      return (
        (phase?.phaseName === "SwitchPhase"
          || phase?.phaseName === "CoopGuestFaintSwitchPhase"
          || phase?.phaseName === "ShowdownEnemyFaintSwitchPhase")
        && phase.coopV2ControlOperationId === operationId
        && scene.ui?.getHandler()?.active === true
        && scene.ui.getMode() === UiMode.PARTY
      );
    },
    installSharedInteraction(surfaceClass, operationKind): boolean {
      const contract = coopV2InteractionUiProofContract(surfaceClass, operationKind);
      const phaseName = pm.getCurrentPhase()?.phaseName;
      return (
        contract != null
        && scene.ui?.getHandler()?.active === true
        && typeof phaseName === "string"
        && (contract.phaseNames as readonly string[]).includes(phaseName)
        && (contract.uiModes as readonly number[]).includes(scene.ui.getMode())
      );
    },
    installSuccessorWait(): void {
      // Intentionally no phase: this address authorizes only the next ordered log entry.
    },
    installTerminal(): void {
      // The shared terminal freeze from THIS lane's reach: stop the local engine
      // from running any locally-queued successor. Owner/address-exact terminal
      // sealing belongs to the lifecycle lane; this is the minimal, idempotent
      // freeze the projector can install without crossing lane boundaries.
      pm.clearPhaseQueue();
    },
  };
}
