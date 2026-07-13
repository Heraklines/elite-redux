#!/usr/bin/env node
/* CI-only focused probe; the integration handoff does not include this file. */

import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { assertStableDeployedSurface, captureDeployedSurface } from "./deployed-surface.mjs";

const config = {
  root: resolve(import.meta.dirname, "../../.."),
  baseUrl: process.env.COOP_UI_BASE_URL ?? "https://elite-redux-staging.pages.dev",
};
const before = await captureDeployedSurface(config);
let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const contexts = await Promise.all([browser.createBrowserContext(), browser.createBrowserContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  await Promise.all(
    pages.map(async page => {
      await page.setCacheEnabled(false);
      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForSelector("#app canvas", { timeout: 120_000 });
    }),
  );
  const after = await captureDeployedSurface(config);
  assertStableDeployedSurface(before, after);
  console.log(
    `[coop-public-ui] PASS two isolated staging canvases; stable html=${after.htmlSha256} `
      + `manifest=${after.manifestSha256} assets=${after.assetSha} redirects=${after.redirects.length}`,
  );
} finally {
  await browser?.close().catch(() => {});
}
