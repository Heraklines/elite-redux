/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, devices } from "playwright";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const url = args.get("--url") ?? "https://elite-redux-staging.pages.dev/";
const deviceName = args.get("--device") ?? "Pixel 5";
const output = resolve(
  args.get("--output") ?? `temp/mobile-load-${deviceName.toLowerCase().replaceAll(" ", "-")}.json`,
);
const screenshot = output.replace(/\.json$/i, ".png");
const timeoutMs = Number(args.get("--timeout-ms") ?? 180_000);
const profile = devices[deviceName];

if (!profile) {
  throw new Error(`Unknown Playwright device: ${deviceName}`);
}

await mkdir(dirname(output), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...profile,
  serviceWorkers: "block",
});
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send("Performance.enable");

const startedAt = performance.now();
const failures = [];
const consoleErrors = [];
page.on("requestfailed", request => {
  failures.push({ url: request.url(), reason: request.failure()?.errorText ?? "unknown" });
});
page.on("console", message => {
  if (message.type() === "error") {
    consoleErrors.push(message.text());
  }
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
const domContentLoadedMs = Math.round(performance.now() - startedAt);

await page.waitForFunction(
  () => {
    try {
      const raw = localStorage.getItem("er-boot-milestones");
      const milestones = raw ? JSON.parse(raw).milestones : [];
      return Array.isArray(milestones) && milestones.some(entry => entry?.name === "loading-complete");
    } catch {
      return false;
    }
  },
  undefined,
  { timeout: timeoutMs },
);
const loadingCompleteMs = Math.round(performance.now() - startedAt);

await page.waitForTimeout(500);
await page.screenshot({ path: screenshot, fullPage: true });

const browserData = await page.evaluate(() => {
  const resources = performance.getEntriesByType("resource").map(entry => {
    const resource = entry;
    return {
      name: resource.name,
      initiatorType: resource.initiatorType,
      duration: Math.round(resource.duration),
      transferSize: resource.transferSize,
      encodedBodySize: resource.encodedBodySize,
      decodedBodySize: resource.decodedBodySize,
    };
  });
  const raw = localStorage.getItem("er-boot-milestones");
  return {
    navigation: performance.getEntriesByType("navigation")[0]?.toJSON() ?? null,
    paints: performance.getEntriesByType("paint").map(entry => entry.toJSON()),
    milestones: raw ? JSON.parse(raw).milestones : [],
    resources,
  };
});
const performanceMetrics = await client.send("Performance.getMetrics");

const byInitiator = {};
const byHost = {};
for (const resource of browserData.resources) {
  const initiator = resource.initiatorType || "other";
  const host = new URL(resource.name).host;
  byInitiator[initiator] ??= { requests: 0, transferSize: 0, decodedBodySize: 0 };
  byHost[host] ??= { requests: 0, transferSize: 0, decodedBodySize: 0 };
  for (const bucket of [byInitiator[initiator], byHost[host]]) {
    bucket.requests++;
    bucket.transferSize += resource.transferSize;
    bucket.decodedBodySize += resource.decodedBodySize;
  }
}

const slowestResources = [...browserData.resources].sort((left, right) => right.duration - left.duration).slice(0, 20);
const largestResources = [...browserData.resources]
  .sort((left, right) => right.transferSize - left.transferSize)
  .slice(0, 20);

const result = {
  url,
  deviceName,
  userAgent: profile.userAgent,
  domContentLoadedMs,
  loadingCompleteMs,
  milestones: browserData.milestones,
  paints: browserData.paints,
  navigation: browserData.navigation,
  requestCount: browserData.resources.length,
  byInitiator,
  byHost,
  slowestResources,
  largestResources,
  failures,
  consoleErrors: consoleErrors.slice(0, 50),
  performanceMetrics: Object.fromEntries(performanceMetrics.metrics.map(metric => [metric.name, metric.value])),
  screenshot,
};

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      output,
      screenshot,
      deviceName,
      domContentLoadedMs,
      loadingCompleteMs,
      requestCount: result.requestCount,
      failures: failures.length,
      byHost,
    },
    null,
    2,
  ),
);

await browser.close();
