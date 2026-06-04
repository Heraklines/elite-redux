/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Fetch the non-combat asset categories from upstream Elite-Redux/eliteredux.
 *
 * Sparse-checkout policy: pull every `graphics/<category>/` whose contents could
 * plausibly be referenced by pokerogue's UI/audio/effects pipeline. Skip only
 * categories that are intrinsically tied to the GBA overworld engine (door
 * animations, world map tilesets, minigames pokerogue doesn't ship).
 *
 * Upstream surveyed categories (60 total) — categorization rationale:
 *
 *   PULL — UI / battle / sprite chrome pokerogue can render:
 *     pokemon, items, trainers, interface, battle_interface, types,
 *     pokemon_storage, pokedex, summary_screen, evolution_scene,
 *     battle_anims, battle_terrain, battle_transitions, berries, weather,
 *     field_effects, text_window, fonts, picture_frame, trainer_card,
 *     decorations, frontier_pass, naming_screen, tm_case, ui_menus,
 *     misc, contest, easy_chat, dexnav, mail, trade,
 *     intro, title_screen, unknown (defensive — some legitimate UI bits)
 *
 *   SKIP — overworld engine / GBA-specific / pokerogue ships its own:
 *     object_events       overworld NPC walking sprites; we ship icons instead
 *     door_anims          overworld door open/close (no overworld in pokerogue)
 *     pokenav             overworld navigation system
 *     rayquaza_scene      scripted intro sequence
 *     roulette            minigame, not in pokerogue
 *     slot_machine        minigame, not in pokerogue
 *     berry_blender       minigame
 *     berry_crush         minigame
 *     berry_fix           save-corruption-recovery screen
 *     dodrio_berry_picking minigame
 *     pokemon_jump        minigame
 *     cable_car           Mt Chimney cable car cutscene
 *     pokeblock           pokeblock making (not in pokerogue)
 *     wallclock           in-game clock setting
 *     reset_rtc_screen    GBA RTC reset
 *     union_room_chat     GBA Union Room
 *     wonder_transfers    Wonder Card transfer
 *     link                link-cable graphics
 *     birch_speech        Prof. Birch intro
 *     spinda_spots        empty dir upstream
 *     credits             single rolling-credits sprite
 *     rhh_copyright       rom-hacking-hideout watermark
 *     interface_fr        French-locale duplicate
 *     unused              prefixed "old_*" assets removed from upstream
 *
 *   Pokemon combat sprites (`graphics/pokemon/`) are mirrored by fetch-sprites.mjs
 *   into assets/images/pokemon/elite-redux/ — kept in the sparse-checkout pattern
 *   here so a single clone services both.
 *
 * The mirror is idempotent. Pass --force to re-sync.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const VENDOR = resolve(ROOT, "vendor/elite-redux/sprites");
const ASSET_ROOT = resolve(ROOT, "assets/images/elite-redux");
const MARKER = resolve(VENDOR, ".fetched-non-combat");

// Public sprite repo — same upstream we already use for combat sprites.
const SPRITE_REPO = "https://github.com/Elite-Redux/eliteredux.git";
const SPRITE_BRANCH = "master";

/**
 * Asset categories we mirror locally. Each entry maps a sparse-checkout pattern
 * onto a sub-dir of assets/images/elite-redux/.
 *
 * Order matches the rationale in the module header — pull the originally-vetted
 * 9 categories first, then the widened set.
 *
 * @type {ReadonlyArray<{ sparse: string, src: string, dst: string }>}
 */
const CATEGORIES = [
  // Original 9 (vetted in prior pass — keep at top for diff stability).
  { sparse: "graphics/items/", src: "graphics/items", dst: "items" },
  { sparse: "graphics/trainers/", src: "graphics/trainers", dst: "trainers" },
  { sparse: "graphics/interface/", src: "graphics/interface", dst: "interface" },
  { sparse: "graphics/battle_interface/", src: "graphics/battle_interface", dst: "battle_interface" },
  { sparse: "graphics/types/", src: "graphics/types", dst: "types" },
  { sparse: "graphics/pokemon_storage/", src: "graphics/pokemon_storage", dst: "pokemon_storage" },
  { sparse: "graphics/pokedex/", src: "graphics/pokedex", dst: "pokedex" },
  { sparse: "graphics/summary_screen/", src: "graphics/summary_screen", dst: "summary_screen" },
  { sparse: "graphics/evolution_scene/", src: "graphics/evolution_scene", dst: "evolution_scene" },

  // Widened pass — UI / battle chrome / effects.
  { sparse: "graphics/battle_anims/", src: "graphics/battle_anims", dst: "battle_anims" },
  { sparse: "graphics/battle_terrain/", src: "graphics/battle_terrain", dst: "battle_terrain" },
  { sparse: "graphics/battle_transitions/", src: "graphics/battle_transitions", dst: "battle_transitions" },
  { sparse: "graphics/berries/", src: "graphics/berries", dst: "berries" },
  { sparse: "graphics/weather/", src: "graphics/weather", dst: "weather" },
  { sparse: "graphics/field_effects/", src: "graphics/field_effects", dst: "field_effects" },
  { sparse: "graphics/text_window/", src: "graphics/text_window", dst: "text_window" },
  { sparse: "graphics/fonts/", src: "graphics/fonts", dst: "fonts" },
  { sparse: "graphics/picture_frame/", src: "graphics/picture_frame", dst: "picture_frame" },
  { sparse: "graphics/trainer_card/", src: "graphics/trainer_card", dst: "trainer_card" },
  { sparse: "graphics/decorations/", src: "graphics/decorations", dst: "decorations" },
  { sparse: "graphics/frontier_pass/", src: "graphics/frontier_pass", dst: "frontier_pass" },
  { sparse: "graphics/naming_screen/", src: "graphics/naming_screen", dst: "naming_screen" },
  { sparse: "graphics/tm_case/", src: "graphics/tm_case", dst: "tm_case" },
  { sparse: "graphics/ui_menus/", src: "graphics/ui_menus", dst: "ui_menus" },
  { sparse: "graphics/misc/", src: "graphics/misc", dst: "misc" },
  { sparse: "graphics/contest/", src: "graphics/contest", dst: "contest" },
  { sparse: "graphics/easy_chat/", src: "graphics/easy_chat", dst: "easy_chat" },
  { sparse: "graphics/dexnav/", src: "graphics/dexnav", dst: "dexnav" },
  { sparse: "graphics/mail/", src: "graphics/mail", dst: "mail" },
  { sparse: "graphics/trade/", src: "graphics/trade", dst: "trade" },
  { sparse: "graphics/intro/", src: "graphics/intro", dst: "intro" },
  { sparse: "graphics/title_screen/", src: "graphics/title_screen", dst: "title_screen" },
  { sparse: "graphics/unknown/", src: "graphics/unknown", dst: "unknown" },
];

// Existing pattern from fetch-sprites.mjs — keep it so the combat clone stays usable.
const POKEMON_SPARSE_PATH = "graphics/pokemon/";

/**
 * Run a command, inheriting stdio. Throws on non-zero exit.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 */
function run(cmd, args, options = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}

/**
 * Recursively mirror all .png files from src to dst, preserving directory structure.
 * @param {string} src
 * @param {string} dst
 */
async function mirrorPngs(src, dst) {
  let copiedCount = 0;
  let skippedCount = 0;
  /**
   * @param {string} s
   * @param {string} d
   */
  async function walk(s, d) {
    const entries = await readdir(s, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(s, entry.name);
      const dstPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await mkdir(dstPath, { recursive: true });
        await walk(srcPath, dstPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        await cp(srcPath, dstPath);
        copiedCount++;
      } else {
        skippedCount++;
      }
    }
  }
  await mkdir(dst, { recursive: true });
  await walk(src, dst);
  return { copiedCount, skippedCount };
}

/**
 * Ensure the vendor clone exists and has the sparse-checkout patterns we need.
 * Re-uses the clone produced by fetch-sprites.mjs if present.
 */
async function ensureCloneWithPatterns() {
  const sparseConfigPath = resolve(VENDOR, ".git/info/sparse-checkout");

  if (!existsSync(VENDOR) || !existsSync(resolve(VENDOR, ".git"))) {
    console.log(`[er:fetch-non-combat-assets] no existing clone — initializing ${VENDOR}`);
    await mkdir(VENDOR, { recursive: true });
    run("git", ["init"], { cwd: VENDOR });
    run("git", ["remote", "add", "origin", SPRITE_REPO], { cwd: VENDOR });
    run("git", ["config", "core.sparseCheckout", "true"], { cwd: VENDOR });
  }

  // If we previously toggled sparseCheckout off during audit, re-enable it.
  run("git", ["config", "core.sparseCheckout", "true"], { cwd: VENDOR });

  // Build the full sparse-checkout pattern set: combat sprites + non-combat categories.
  const patterns = [POKEMON_SPARSE_PATH, ...CATEGORIES.map(c => c.sparse)];
  await writeFile(sparseConfigPath, `${patterns.join("\n")}\n`);

  console.log(`[er:fetch-non-combat-assets] sparse-checkout patterns (${patterns.length} entries):`);
  for (const p of patterns) {
    console.log(`  - ${p}`);
  }

  // Pull. Fall back to "main" if "master" is gone (defensive — same as fetch-sprites).
  try {
    run("git", ["pull", "--depth=1", "origin", SPRITE_BRANCH], { cwd: VENDOR });
  } catch (err) {
    console.warn(
      `[er:fetch-non-combat-assets] branch "${SPRITE_BRANCH}" failed (${err instanceof Error ? err.message : String(err)}); trying "main"...`,
    );
    run("git", ["pull", "--depth=1", "origin", "main"], { cwd: VENDOR });
  }

  // Force git to re-apply the new sparse patterns to the working tree —
  // `git pull` only respects sparse-checkout on the initial checkout, not on
  // subsequent runs when the pattern set widens.
  run("git", ["read-tree", "-mu", "HEAD"], { cwd: VENDOR });
}

async function main() {
  const force = process.argv.includes("--force");

  if (existsSync(MARKER) && !force) {
    const since = await readFile(MARKER, "utf8");
    console.log(`[er:fetch-non-combat-assets] cache hit (fetched ${since.trim()}) — pass --force to re-sync`);
    return;
  }

  await ensureCloneWithPatterns();

  // Mirror each category's PNGs to its destination under assets/images/elite-redux/.
  /** @type {Array<{ category: string, copiedCount: number, skippedCount: number }>} */
  const summary = [];
  for (const cat of CATEGORIES) {
    const srcDir = resolve(VENDOR, cat.src);
    const dstDir = resolve(ASSET_ROOT, cat.dst);
    if (!existsSync(srcDir)) {
      console.warn(`[er:fetch-non-combat-assets] expected ${cat.src} in clone — not found, skipping ${cat.dst}`);
      summary.push({ category: cat.dst, copiedCount: 0, skippedCount: 0 });
      continue;
    }
    console.log(`[er:fetch-non-combat-assets] mirroring ${cat.src} → assets/images/elite-redux/${cat.dst}/...`);
    const result = await mirrorPngs(srcDir, dstDir);
    summary.push({ category: cat.dst, ...result });
    console.log(
      `[er:fetch-non-combat-assets]   ${result.copiedCount} PNGs copied (${result.skippedCount} non-PNG skipped)`,
    );
  }

  console.log("\n[er:fetch-non-combat-assets] summary:");
  for (const s of summary) {
    console.log(`  ${s.category.padEnd(20)} ${String(s.copiedCount).padStart(5)} PNGs`);
  }
  const totalCopied = summary.reduce((a, b) => a + b.copiedCount, 0);
  console.log(`  ${"TOTAL".padEnd(20)} ${String(totalCopied).padStart(5)} PNGs`);

  await writeFile(MARKER, new Date().toISOString());
  console.log("[er:fetch-non-combat-assets] done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
