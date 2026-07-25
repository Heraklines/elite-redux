/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Return the latest move-animation value the real browser attested through its public Settings UI. */
export function latestMoveAnimationsAttestation(events) {
  let attestation = null;
  for (const event of events) {
    if (event.kind === "browser-render-profile" && typeof event.observation?.moveAnimations === "boolean") {
      attestation = event.observation.moveAnimations;
    }
  }
  return attestation;
}

/**
 * Accept only a completed renderer receipt, except when both real browsers proved that move animations
 * were deliberately disabled. That profile may use the production renderer's one typed skip outcome;
 * failures, unknown reasons, wrong roles, and animation-on skips always remain hard failures.
 */
export function isAcceptedRendererPresentationReceipt(entry, allowAnimationsDisabledSkip) {
  if (entry?.role !== "guest") {
    return false;
  }
  if (entry.stage === "renderer-completed") {
    return true;
  }
  return (
    allowAnimationsDisabledSkip === true && entry.stage === "renderer-skipped" && entry.reason === "animations-disabled"
  );
}
