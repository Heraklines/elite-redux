/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ER_IOS_DEFERRED_BGM_FILES, isIOSDevice } from "#data/elite-redux/er-ios";

/** Memoized verdict: `null` means the browser has not been inspected yet. */
let cachedMobileBootMitigations: boolean | null = null;

function detectAndroidDevice(): boolean {
  try {
    return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent ?? "");
  } catch {
    return false;
  }
}

/**
 * Whether boot should use the paced, low-request-pressure mobile path.
 *
 * The mitigations were originally introduced for iOS, but the expensive parts are
 * platform-independent: eager boot queued roughly 1,850 ER icon requests and decoded
 * five non-title BGM tracks before Android could reach the login/title screen. Android
 * now uses the same proven deferred path while desktop retains eager loading.
 */
export function shouldUseMobileBootMitigations(): boolean {
  if (cachedMobileBootMitigations === null) {
    cachedMobileBootMitigations = isIOSDevice() || detectAndroidDevice();
  }
  return cachedMobileBootMitigations;
}

/** Test-only reset for the memoized platform verdict. */
export function resetMobileBootMitigationsCacheForTest(): void {
  cachedMobileBootMitigations = null;
}

/** Heavy non-title music loaded on first use instead of during constrained mobile boot. */
export const ER_MOBILE_DEFERRED_BGM_FILES = ER_IOS_DEFERRED_BGM_FILES;
