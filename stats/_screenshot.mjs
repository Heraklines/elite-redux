/*
 * Dev-only screenshot helper for the Pokédex & Usage SPA. Loads the locally
 * served page, waits for the grid + sprites, captures the full grid, then opens
 * the top row's detail drawer and captures that. NOT shipped/deployed.
 *   node stats/_screenshot.mjs
 */
import puppeteer from "puppeteer";

const URL = process.env.STATS_URL || "http://localhost:8137/";
const OUT_GRID = "stats/_preview-grid.png";
const OUT_DETAIL = "stats/_preview-detail.png";

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 });

  const brokenSprites = [];
  page.on("requestfailed", req => {
    const u = req.url();
    if (u.includes("/pokemon/elite-redux/")) {
      brokenSprites.push(u);
    }
  });

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Wait until the table has rendered real rows.
  await page.waitForFunction(() => document.querySelectorAll("#rows tr[data-key]").length > 50, { timeout: 30000 });
  const rowCount = await page.$$eval("#rows tr[data-key]", rs => rs.length);
  console.log(`rows rendered: ${rowCount}`);

  // Give lazy sprites in the viewport a moment to load + decode.
  await sleep(2500);

  await page.screenshot({ path: OUT_GRID });
  console.log(`wrote ${OUT_GRID}`);

  // Verify the measured sticky stack: --head-h / --thead-top should be set, and
  // when scrolled the column header must pin flush under the filter bar (no gap).
  const stick = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      headH: cs.getPropertyValue("--head-h").trim(),
      theadTop: cs.getPropertyValue("--thead-top").trim(),
    };
  });
  console.log(`sticky vars: ${JSON.stringify(stick)}`);
  await page.evaluate(() => window.scrollTo(0, 700));
  await sleep(400);
  const pinned = await page.evaluate(() => {
    const th = document.querySelector("table.dex thead th");
    const filters = document.querySelector(".filters");
    return {
      theadTop: th ? Math.round(th.getBoundingClientRect().top) : null,
      filtersBottom: filters ? Math.round(filters.getBoundingClientRect().bottom) : null,
    };
  });
  // gap should be ~0: the column header sits exactly at the bottom of the filter bar.
  console.log(`scrolled pin: ${JSON.stringify(pinned)} (gap=${pinned.theadTop - pinned.filtersBottom}px)`);
  await page.screenshot({ path: "stats/_preview-sticky.png", clip: { x: 0, y: 0, width: 1440, height: 340 } });
  console.log("wrote stats/_preview-sticky.png");
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);

  // Open the top row's drawer, wait for the slide-in transition, capture.
  await page.click("#rows tr[data-key]");
  await page.waitForSelector("#drawer.open", { timeout: 5000 });
  await sleep(900);
  await page.screenshot({ path: OUT_DETAIL });
  console.log(`wrote ${OUT_DETAIL}`);

  // Report sprite load health for the visible rows.
  const spriteStats = await page.$$eval("#rows img.spr", imgs => {
    let loaded = 0;
    let hidden = 0;
    for (const img of imgs) {
      if (img.style.visibility === "hidden") {
        hidden++;
      } else if (img.complete && img.naturalWidth > 0) {
        loaded++;
      }
    }
    return { total: imgs.length, loaded, hidden };
  });
  console.log(`sprites in table: ${JSON.stringify(spriteStats)}`);
  if (brokenSprites.length > 0) {
    console.log(`broken sprite requests: ${brokenSprites.length} (e.g. ${brokenSprites.slice(0, 3).join(", ")})`);
  } else {
    console.log("broken sprite requests: 0");
  }
} finally {
  await browser.close();
}
