/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - iOS device detection + iOS-only boot-mitigation constants
// (#ios-stability).
//
// The measured investigation (docs/ios-stability-investigation.md) traced the
// "crashes a lot on load / very unstable on iOS" reports to boot-time memory +
// request pressure specific to iOS/WKWebView (the Discord in-app browser). Every
// mitigation is GATED on isIOSDevice() so non-iOS platforms behave byte-identically
// to before - `isIOSDevice()` returns false in the headless test harness (no
// `navigator`), so the existing test suite exercises the unchanged desktop path.
// =============================================================================

/** Memoized verdict: `null` = not yet computed, else the cached device check. */
let cachedIsIOS: boolean | null = null;

/**
 * Raw (un-memoized) iOS check. Everything is feature-detected and try/caught: headless
 * (vitest) has no `navigator`, and some embedded webviews expose only a partial one, so
 * any access failure resolves to `false` (the desktop / non-iOS path).
 */
function detectIOSDevice(): boolean {
  try {
    if (typeof navigator === "undefined") {
      return false;
    }
    const ua = typeof navigator.userAgent === "string" ? navigator.userAgent : "";
    // Classic iOS UA - iPhone / iPad / iPod (Safari AND the Discord WKWebView carry it).
    if (/iPad|iPhone|iPod/.test(ua)) {
      return true;
    }
    // iPadOS 13+ masquerades as desktop Safari (platform "MacIntel"). Distinguish a real
    // Mac (no touchscreen) from an iPad (multi-touch) via maxTouchPoints.
    const platform = typeof navigator.platform === "string" ? navigator.platform : "";
    const maxTouchPoints = typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
    if (platform === "MacIntel" && maxTouchPoints > 1) {
      return true;
    }
    return false;
  } catch {
    // A partial/hostile navigator that throws on property access -> treat as non-iOS.
    return false;
  }
}

/**
 * True on iPhone / iPad / iPod (including iPadOS-masquerading-as-Mac and the Discord
 * in-app WKWebView). Memoized after the first call so gated call sites are cheap; returns
 * `false` in headless / vitest (no `navigator`), keeping every existing test on the
 * unchanged non-iOS path.
 */
export function isIOSDevice(): boolean {
  if (cachedIsIOS === null) {
    cachedIsIOS = detectIOSDevice();
  }
  return cachedIsIOS;
}

/**
 * Reset the memoized verdict. Test-only hook so the unit test can exercise a UA/platform
 * matrix against one module instance; production code never calls this.
 */
export function resetIOSDeviceCacheForTest(): void {
  cachedIsIOS = null;
}

/**
 * BGM tracks pulled OUT of the iOS boot preload (mitigation P1: ~146 MB of decoded PCM,
 * the #1 suspected WKWebView jetsam trigger). Keyed by the Phaser cache KEY -> its
 * `loadBgm` filename (relative to `audio/bgm/`).
 *
 * The filename matters: these tracks live only under `bw/`, so the default on-demand
 * `loadBgm(key)` -> `audio/bgm/${key}.mp3` path would 404. The on-demand players
 * ({@linkcode BattleScene.playBgm} / {@linkcode BattleScene.playSoundWithoutBgm}) look the
 * correct filename up here so a first play load-then-plays SEAMLESSLY instead of failing
 * silently. Desktop preloads all of these eagerly, so this map is never consulted there.
 */
export const ER_IOS_DEFERRED_BGM_FILES: ReadonlyMap<string, string> = new Map<string, string>([
  ["victory_trainer", "bw/victory_trainer.mp3"],
  ["victory_team_plasma", "bw/victory_team_plasma.mp3"],
  ["victory_gym", "bw/victory_gym.mp3"],
  ["victory_champion", "bw/victory_champion.mp3"],
  ["evolution", "bw/evolution.mp3"],
]);
