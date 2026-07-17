/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Unit tests for the iOS device gate (#ios-stability). Every iOS boot mitigation is behind
// isIOSDevice(), so this matrix guards the gate itself: iPhone/iPad/iPod UAs, the
// iPadOS-masquerading-as-Mac case (MacIntel + multi-touch), real desktops, and the headless
// (no-navigator) case that must resolve to false so the existing test suite stays on the
// unchanged non-iOS path.

import { isIOSDevice, resetIOSDeviceCacheForTest } from "#data/elite-redux/er-ios";
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeNavigator {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

function withNavigator(nav: FakeNavigator | undefined): boolean {
  vi.stubGlobal("navigator", nav);
  resetIOSDeviceCacheForTest();
  return isIOSDevice();
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
const IPOD_UA =
  "Mozilla/5.0 (iPod touch; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/16A366";
const DISCORD_IOS_UA = `${IPHONE_UA} Discord/1.0`;
const MAC_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

describe("isIOSDevice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetIOSDeviceCacheForTest();
  });

  it.each([
    ["iPhone Safari", IPHONE_UA],
    ["iPad (classic UA)", IPAD_UA],
    ["iPod touch", IPOD_UA],
    ["Discord in-app WKWebView (iPhone)", DISCORD_IOS_UA],
  ])("detects iOS from the %s user agent", (_label, ua) => {
    expect(withNavigator({ userAgent: ua, platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
  });

  it("detects iPadOS masquerading as Mac (MacIntel + multi-touch)", () => {
    expect(withNavigator({ userAgent: MAC_SAFARI_UA, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });

  it("does NOT flag a real Mac (MacIntel with no touchscreen)", () => {
    expect(withNavigator({ userAgent: MAC_SAFARI_UA, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });

  it("does NOT flag a MacIntel with a single (mouse-emulated) touch point", () => {
    expect(withNavigator({ userAgent: MAC_SAFARI_UA, platform: "MacIntel", maxTouchPoints: 1 })).toBe(false);
  });

  it.each([
    ["Windows Chrome", WINDOWS_CHROME_UA, "Win32"],
    ["Android Chrome", ANDROID_UA, "Linux armv8l"],
  ])("does NOT flag %s", (_label, ua, platform) => {
    expect(withNavigator({ userAgent: ua, platform, maxTouchPoints: 0 })).toBe(false);
  });

  it("returns false when navigator is undefined (headless / vitest)", () => {
    expect(withNavigator(undefined)).toBe(false);
  });

  it("returns false when navigator fields are missing entirely", () => {
    expect(withNavigator({})).toBe(false);
  });

  it("memoizes the verdict (later navigator changes do not re-flip a cached result)", () => {
    // First call with an iPhone caches `true`.
    expect(withNavigator({ userAgent: IPHONE_UA, platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    // Swap to a desktop navigator WITHOUT resetting the cache: the memoized value must stand.
    vi.stubGlobal("navigator", { userAgent: WINDOWS_CHROME_UA, platform: "Win32", maxTouchPoints: 0 });
    expect(isIOSDevice()).toBe(true);
    // After an explicit reset it re-evaluates against the current navigator.
    resetIOSDeviceCacheForTest();
    expect(isIOSDevice()).toBe(false);
  });
});
