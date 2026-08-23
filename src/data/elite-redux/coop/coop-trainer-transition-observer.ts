/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export interface CoopPlayerTrainerTransitionPokemonObservation {
  readonly pokemonId: number;
  readonly onField: boolean;
  readonly pokemonVisible: boolean;
  readonly spriteVisible: boolean;
  readonly infoVisible: boolean;
}

export interface CoopPlayerTrainerTransitionObservation {
  readonly wave: number;
  readonly trainerVisible: boolean;
  readonly trainerAlpha: number;
  readonly trainerPresented: boolean;
  readonly playerField: readonly CoopPlayerTrainerTransitionPokemonObservation[];
}

type CoopPlayerTrainerTransitionObserver = (observation: CoopPlayerTrainerTransitionObservation) => void;

let observer: CoopPlayerTrainerTransitionObserver | null = null;

/** CI-only read observer registration. Staging/production never installs one. */
export function setCoopPlayerTrainerTransitionObserver(next: CoopPlayerTrainerTransitionObserver | null): void {
  observer = next;
}

/**
 * Publish already-applied presentation values without making telemetry a progression dependency.
 * The exact browser build validates the observation; normal gameplay remains independent from it.
 */
export function observeCoopPlayerTrainerTransition(observation: CoopPlayerTrainerTransitionObservation): void {
  try {
    observer?.(observation);
  } catch {
    // Read-only diagnostics must never own gameplay progression.
  }
}
