import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:4182";
const outputDir = "test-results/rich-notification";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function openViewer(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  // The app may perform one development-mode reload while initializing assets.
  await page.waitForTimeout(3_000);
  await page.evaluate(async () => {
    const { RichNotificationViewer } = await import("/src/ui/rich-notification-viewer.ts");
    const markdown = await fetch("/docs/patch-notes/0.0.6.0.md").then(response => response.text());
    window.__richNotificationQaClosed = 0;
    window.__richNotificationQaViewer = new RichNotificationViewer(
      {
        title: "PokeRogue Redux v0.0.6.0",
        markdown,
        actionLabel: "Join Discord",
        actionUrl: "https://discord.gg/q8d2jq5dE",
      },
      () => {
        window.__richNotificationQaClosed += 1;
      },
    );
  });
  await page.locator(".er-rich-notification-content img").waitFor({ state: "visible" });
}

async function inspect(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector(".er-rich-notification");
    const content = document.querySelector(".er-rich-notification-content");
    const image = content?.querySelector("img");
    const discord = content?.querySelector('a[href="https://discord.gg/q8d2jq5dE"]');
    const action = document.querySelector(".er-rich-notification-action");
    const rect = dialog?.getBoundingClientRect();
    return {
      actionLabel: action?.textContent,
      contentClientHeight: content?.clientHeight ?? 0,
      contentScrollHeight: content?.scrollHeight ?? 0,
      contentWidthFits: (content?.scrollWidth ?? 1) <= (content?.clientWidth ?? 0) + 1,
      dialog: rect ? { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top } : null,
      discordRel: discord?.getAttribute("rel"),
      discordTarget: discord?.getAttribute("target"),
      headings: content?.querySelectorAll("h1, h2, h3").length ?? 0,
      imageLoaded: (image?.naturalWidth ?? 0) > 0,
      viewport: { height: innerHeight, width: innerWidth },
    };
  });
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openViewer(desktop);
  const desktopState = await inspect(desktop);
  assert.equal(desktopState.actionLabel, "Join Discord");
  assert.ok(desktopState.headings >= 6, "Markdown headings did not render");
  assert.ok(desktopState.imageLoaded, "Patch-note image did not load");
  assert.ok(desktopState.contentScrollHeight > desktopState.contentClientHeight, "Long notes are not scrollable");
  assert.ok(desktopState.contentWidthFits, "Desktop content overflows horizontally");
  assert.equal(desktopState.discordTarget, "_blank");
  assert.equal(desktopState.discordRel, "noopener noreferrer");
  assert.ok(desktopState.dialog.left >= 0 && desktopState.dialog.right <= desktopState.viewport.width);
  assert.ok(desktopState.dialog.top >= 0 && desktopState.dialog.bottom <= desktopState.viewport.height);

  await desktop.locator(".er-rich-notification-content").hover();
  await desktop.mouse.wheel(0, 600);
  await desktop.waitForTimeout(200);
  assert.ok((await desktop.locator(".er-rich-notification-content").evaluate(node => node.scrollTop)) > 0);
  await desktop.screenshot({ path: `${outputDir}/desktop.png` });
  await desktop.getByRole("button", { name: "Close patch notes" }).click();
  assert.equal(await desktop.locator(".er-rich-notification-backdrop").count(), 0);
  assert.equal(await desktop.evaluate(() => window.__richNotificationQaClosed), 1);

  const mobile = await browser.newPage({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  await openViewer(mobile);
  const mobileState = await inspect(mobile);
  assert.ok(mobileState.contentScrollHeight > mobileState.contentClientHeight, "Mobile notes are not scrollable");
  assert.ok(mobileState.contentWidthFits, "Mobile content overflows horizontally");
  assert.ok(mobileState.dialog.left >= 0 && mobileState.dialog.right <= mobileState.viewport.width);
  assert.ok(mobileState.dialog.top >= 0 && mobileState.dialog.bottom <= mobileState.viewport.height);
  await mobile.screenshot({ path: `${outputDir}/mobile.png` });
  await mobile.keyboard.press("Escape");
  assert.equal(await mobile.locator(".er-rich-notification-backdrop").count(), 0);

  console.log(JSON.stringify({ desktop: desktopState, mobile: mobileState }, null, 2));
} finally {
  await browser.close();
}
