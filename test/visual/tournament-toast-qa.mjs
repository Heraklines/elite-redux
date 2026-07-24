import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.ER_QA_URL ?? "http://127.0.0.1:4189";
const outputDir = "test-results/tournament-toast";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height] of [
    ["desktop", 1280, 720],
    ["mobile", 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const notifications = await import("/src/data/elite-redux/showdown/tournament-notifications.ts");
      notifications.setTournamentGameplayOpener(() => true);
      notifications.showTournamentMatchToast({
        id: "tournament:cup:r0m0:match-online",
        type: "tournament",
        timestamp: Date.now(),
        read: false,
        data: {
          tournamentId: "cup",
          round: 0,
          slot: 0,
          kind: "match-online",
          tournamentName: "Staging Lockstep Test Cup",
          opponent: "VeryLongOpponentName",
          matchId: "r0m0",
        },
      });
    });

    const toast = page.locator(".er-tournament-match-toast");
    await toast.waitFor({ state: "visible" });
    const metrics = await toast.evaluate(element => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    assert.ok(metrics.left >= 0 && metrics.right <= width, `${name}: toast must fit horizontally`);
    assert.ok(metrics.top >= 0 && metrics.bottom <= height, `${name}: toast must fit vertically`);
    assert.equal(metrics.scrollWidth, metrics.clientWidth, `${name}: toast must not overflow`);
    await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });

    await page.locator(".er-tournament-match-toast-open").click();
    await toast.waitFor({ state: "detached" });
    assert.deepEqual(errors, [], `${name}: page errors`);
    await page.close();
  }
} finally {
  await browser.close();
}
