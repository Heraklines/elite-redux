import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:4182";
const assetOrigin = process.env.QA_ASSET_ORIGIN?.replace(/\/$/u, "");
const outputDir = "test-results/rich-notification";
const markdownSource = await readFile(new URL("../../docs/patch-notes/0.0.6.0.md", import.meta.url), "utf8");
const markdown = assetOrigin ? markdownSource.replaceAll("](/images/", `](${assetOrigin}/images/`) : markdownSource;
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function openViewer(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  // The app may perform one development-mode reload while initializing assets.
  await page.waitForTimeout(3_000);
  await page.evaluate(async markdown => {
    const { RichNotificationViewer } = await import("/src/ui/rich-notification-viewer.ts");
    window.__richNotificationQaClosed = 0;
    window.__richNotificationQaViewer = new RichNotificationViewer(
      {
        title: "PokeRogue Redux v0.0.6.0",
        markdown,
        actionLabel: "Join PokeRogue Redux Discord",
        actionUrl: "https://discord.gg/q8d2jq5dE",
      },
      () => {
        window.__richNotificationQaClosed += 1;
      },
    );
  }, markdown);
  const images = page.locator(".er-rich-notification-content img");
  await images.first().waitFor({ state: "visible" });
  for (let index = 0; index < (await images.count()); index++) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(element => {
      if (element.complete) {
        if (element.naturalWidth > 0) {
          return;
        }
        throw new Error(`Image failed to load: ${element.currentSrc || element.src}`);
      }
      return new Promise((resolve, reject) => {
        element.addEventListener("load", resolve, { once: true });
        element.addEventListener("error", reject, { once: true });
      });
    });
  }
  await page.locator(".er-rich-notification-content").evaluate(node => {
    node.scrollTop = 0;
  });
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
      images: content?.querySelectorAll("img").length ?? 0,
      imagesLoaded: [...(content?.querySelectorAll("img") ?? [])].filter(image => image.naturalWidth > 0).length,
      viewport: { height: innerHeight, width: innerWidth },
    };
  });
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openViewer(desktop);
  const desktopState = await inspect(desktop);
  assert.equal(desktopState.actionLabel, "Join PokeRogue Redux Discord");
  assert.ok(desktopState.headings >= 6, "Markdown headings did not render");
  assert.equal(desktopState.images, 6, "Not every patch-note image rendered");
  assert.equal(desktopState.imagesLoaded, 6, "Not every patch-note image loaded");
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
  await desktop
    .getByRole("img", { name: "The Showdown set editor with stage, ability, item, nature, and move controls" })
    .scrollIntoViewIfNeeded();
  await desktop.screenshot({ path: `${outputDir}/desktop-image.png` });
  await desktop.getByRole("button", { name: "Close patch notes" }).click();
  assert.equal(await desktop.locator(".er-rich-notification-backdrop").count(), 0);
  assert.equal(await desktop.evaluate(() => window.__richNotificationQaClosed), 1);

  const mobile = await browser.newPage({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  await openViewer(mobile);
  const mobileState = await inspect(mobile);
  assert.equal(mobileState.images, 6, "Not every mobile patch-note image rendered");
  assert.equal(mobileState.imagesLoaded, 6, "Not every mobile patch-note image loaded");
  assert.ok(mobileState.contentScrollHeight > mobileState.contentClientHeight, "Mobile notes are not scrollable");
  assert.ok(mobileState.contentWidthFits, "Mobile content overflows horizontally");
  assert.deepEqual(mobileState.viewport, { height: 844, width: 390 });
  assert.ok(mobileState.dialog.left >= 0 && mobileState.dialog.right <= mobileState.viewport.width);
  assert.ok(mobileState.dialog.top >= 0 && mobileState.dialog.bottom <= mobileState.viewport.height);
  await mobile.screenshot({ path: `${outputDir}/mobile.png` });
  await mobile.getByRole("img", { name: "A 64-player World Grand Prix tournament bracket" }).scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: `${outputDir}/mobile-image.png` });
  await mobile.keyboard.press("Escape");
  assert.equal(await mobile.locator(".er-rich-notification-backdrop").count(), 0);

  console.log(JSON.stringify({ desktop: desktopState, mobile: mobileState }, null, 2));
} finally {
  await browser.close();
}
