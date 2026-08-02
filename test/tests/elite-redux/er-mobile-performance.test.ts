/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resetIOSDeviceCacheForTest } from "#data/elite-redux/er-ios";
import {
  resetMobileBootMitigationsCacheForTest,
  shouldUseMobileBootMitigations,
} from "#data/elite-redux/er-mobile-performance";
import { afterEach, describe, expect, it, vi } from "vitest";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";

function detect(userAgent: string, platform: string): boolean {
  vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints: 0 });
  resetIOSDeviceCacheForTest();
  resetMobileBootMitigationsCacheForTest();
  return shouldUseMobileBootMitigations();
}

describe("mobile boot performance gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetIOSDeviceCacheForTest();
    resetMobileBootMitigationsCacheForTest();
  });

  it("uses the deferred boot path on iOS", () => {
    expect(detect(IPHONE_UA, "iPhone")).toBe(true);
  });

  it.each([
    ["phone", ANDROID_PHONE_UA],
    ["tablet", ANDROID_TABLET_UA],
  ])("uses the deferred boot path on an Android %s", (_label, userAgent) => {
    expect(detect(userAgent, "Linux armv8l")).toBe(true);
  });

  it("keeps desktop on the eager path", () => {
    expect(detect(WINDOWS_UA, "Win32")).toBe(false);
  });

  it("keeps headless tests on the eager path", () => {
    vi.stubGlobal("navigator", undefined);
    resetIOSDeviceCacheForTest();
    resetMobileBootMitigationsCacheForTest();
    expect(shouldUseMobileBootMitigations()).toBe(false);
  });
});
