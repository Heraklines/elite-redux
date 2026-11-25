/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Drives the REAL editor (editor/index.html) in a headless Chrome with Playwright and authors the four golden
// recipes through the UI the way staff would: search for a trigger, search for conditions and effects, set the
// typed controls. It prints one line, `RESULT:{...}`, holding what the editor would save (buildDelta) and what
// each step looked like. composition-builder.browser.test.ts compiles and battle-tests that JSON.
//
//   node test/tests/elite-redux/editor/author-golden-recipes.mjs [screenshot-dir]
//
// The editor folder is served by a tiny static server on a free port; every request to the outside world (the
// raw GitHub data, sprites, the workers) is answered locally so the run is deterministic and offline.
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const EDITOR_DIR = resolve(process.cwd(), "editor");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serve() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const file = join(EDITOR_DIR, path === "" ? "index.html" : path);
    if (!file.startsWith(EDITOR_DIR)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = readFileSync(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise(resolvePort => {
    server.listen(0, "127.0.0.1", () => resolvePort({ server, port: server.address().port }));
  });
}

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return await chromium.launch();
  }
}

const pick = (page, text) => page.locator(".cb-pick:not([disabled])", { hasText: text }).first().click();

async function search(page, query) {
  const box = page.locator("[data-cb-picker] [data-cb-search]");
  await box.waitFor();
  await box.fill(query);
}

async function setRange(locator, value) {
  await locator.evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function newAbility(page, name) {
  await page.click("[data-as-action='new-ability']");
  await page.fill("[data-as-field='name']", name);
  await page.locator(".cb-section").waitFor();
}

async function startRule(page, ruleName, whenQuery, whenLabel) {
  await page.click("[data-cb-action='add-rule']");
  await search(page, whenQuery);
  await pick(page, whenLabel);
  await page.fill(".cb-rule[data-cb-rule='0'] [data-cb-field='key']", ruleName);
}

async function addEffect(page, query, label) {
  // after choosing a trigger the DO picker is already open; otherwise open it
  if ((await page.locator("[data-cb-picker]").count()) === 0) {
    await page.click(".cb-do [data-cb-action='open-picker']");
  }
  await search(page, query);
  await pick(page, label);
}

async function addCondition(page, query, label, scope = ".cb-if") {
  await page
    .locator(
      `${scope} > .cb-adders [data-cb-action='open-picker'], ${scope} > .cb-group-body > .cb-adders [data-cb-action='open-picker']`,
    )
    .first()
    .click();
  await search(page, query);
  await pick(page, label);
}

const delta = page => page.evaluate(() => window.erAbilityStudio.buildDelta());
const sentence = page => page.locator(".cb-sentence").first().innerText();

async function main() {
  const shots = process.argv[2];
  if (shots) {
    mkdirSync(shots, { recursive: true });
  }
  const { server, port } = await serve();
  const browser = await launch();
  const steps = [];
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
    page.on("console", message => {
      if (message.type() === "error" && !/ERR_FAILED|Failed to load resource/.test(message.text())) {
        problems.push(`console: ${message.text()}`);
      }
    });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route =>
      /\.json/.test(route.request().url())
        ? route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
        : route.abort(),
    );
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.erAbilityStudio?.compositionAvailable?.());
    await page.click("[data-tab='abilities']");
    await page.click("[data-ability-mode='studio']");
    const shot = async name => {
      if (shots) {
        await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false });
      }
    };

    // 1. "switch out below 35% HP"
    await newAbility(page, "Switch At 35");
    await startRule(page, "switch-below-35", "taking damage", "When I take any damage");
    await addEffect(page, "switch out", "Switch out");
    await addCondition(page, "dropped below", "just dropped below");
    await setRange(page.locator("[data-cb-param='ratio']"), 0.35);
    steps.push({ recipe: "switch-out-below-35", sentence: await sentence(page) });
    await shot("1-switch-out-below-35");

    // 2. "immune to Ground"
    await newAbility(page, "Ground Proof");
    await startRule(page, "ground-immunity", "can hit me", "While the game checks whether a move can hit me");
    await addEffect(page, "immune", "Be immune to");
    await page.selectOption("[data-cb-param='type']", "GROUND");
    steps.push({ recipe: "immune-to-ground", sentence: await sentence(page) });
    await shot("2-immune-to-ground");

    // 3. "half damage at full HP"
    await newAbility(page, "Half At Full");
    await startRule(page, "half-at-full-hp", "damage I take", "While the game calculates damage I take");
    await addEffect(page, "half damage", "Multiply damage I take");
    await page.fill("[data-cb-param='multiplier']", "0.5");
    await addCondition(page, "full hp", "is at full HP");
    steps.push({ recipe: "half-damage-at-full-hp", sentence: await sentence(page) });
    await shot("3-half-damage-at-full-hp");

    // 4. "50 BP Steam Eruption after a Fire or Water move"
    await newAbility(page, "Steam Follow Up");
    await startRule(page, "steam-follow-up", "after my attack", "When my attack lands");
    await addEffect(page, "steam eruption", "Use");
    await page.fill("[data-cb-param='moveId']", "STEAM_ERUPTION");
    await page.fill("[data-cb-param='power']", "50");
    await page.click(".cb-if > .cb-adders [data-cb-action='add-group'][data-cb-group='any']");
    await addCondition(page, "move type", "The move is", ".cb-group");
    await page.selectOption(".cb-group [data-cb-param='type']", "FIRE");
    await addCondition(page, "move type", "The move is", ".cb-group");
    await page.selectOption("[data-cb-node='0.1'] [data-cb-param='type']", "WATER");
    steps.push({ recipe: "steam-eruption-after-fire-or-water", sentence: await sentence(page) });
    await shot("4-steam-eruption");

    const result = await delta(page);
    process.stdout.write(`RESULT:${JSON.stringify({ ...result, steps, problems })}\n`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
