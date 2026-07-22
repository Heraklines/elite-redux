// =============================================================================
// Elite Redux — in-battle "Info" screen (opened with the Stats key from the
// command menu), modelled on the ER ROM's gAbilitiesInfo menu.
//
// Robustness: the panel is drawn with Phaser graphics primitives (an accent-
// coloured panel + cream "pill" boxes) so it ALWAYS renders, even before the
// ROM-extracted background textures have streamed in. When those textures are
// present we overlay the authentic ROM panel on top; if they are missing we
// kick off a one-shot lazy load and re-render when it completes.
//
// Left column: only the Pokémon CURRENTLY ON THE FIELD — player side first,
// then enemy side (2 icons in singles, 4 in doubles). Up/Down switches which
// on-field Pokémon is inspected; Left/Right cycles pages; anything else closes.
//
// Coordinate note: the `ui` container draws at NEGATIVE y (origin bottom-left),
// so the panel anchors at y = -canvasHeight + topMargin and lays out downward.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { getErAbilityDescription } from "#data/elite-redux/er-ability-descriptions";
import {
  cycleErGiftAbility,
  getErActiveGiftAbilityId,
  getErSharedGiftAbilityIdsFor,
  isErGiftCycleAllowed,
} from "#data/elite-redux/er-black-shinies";
import { getErDamagePreview } from "#data/elite-redux/er-damage-preview";
import { erYoungsterFreeInnateSlots } from "#data/elite-redux/er-run-difficulty";
import { getNatureName, getNatureStatMultiplier } from "#data/nature";
import { TerrainType as TerrainTypeEnum } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import type { Button } from "#enums/buttons";
import { Button as Btn } from "#enums/buttons";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType as PokemonTypeEnum } from "#enums/pokemon-type";
import { type EffectiveStat, Stat } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { DamageCalculatorModifier } from "#modifiers/modifier";
import { addTextObject, getTextColor } from "#ui/text";
import { isSlotEnabled, isSlotUnlocked, type PassiveSlot } from "#utils/passive-utils";

/** Page identity → background texture key + accent palette colour. */
type Page = "side-player" | "side-enemy" | "field" | "stats" | "abilities" | "moves" | "damage-calc" | "speed-order";
/** Always-available pages. Damage-calc / speed-order are appended when unlocked. */
const PAGES: Page[] = ["stats", "abilities", "moves", "field", "side-player", "side-enemy"];

const BG_KEY: Record<Page, string> = {
  stats: "er_binfo_stats",
  abilities: "er_binfo_abilities",
  moves: "er_binfo_moves",
  field: "er_binfo_field",
  "side-player": "er_binfo_side_player",
  "side-enemy": "er_binfo_side_enemy",
  // ER-custom pages have no ROM background; they always use the graphics fallback.
  "damage-calc": "er_binfo_damage_calc",
  "speed-order": "er_binfo_speed_order",
};

const PAGE_TITLE: Record<Page, string> = {
  stats: "Pokémon Stats",
  abilities: "Abilities Info",
  moves: "Moves Info",
  field: "Field Info",
  "side-player": "Player Side Info",
  "side-enemy": "Enemy Side Info",
  "damage-calc": "Damage Calculator",
  "speed-order": "Speed Order",
};

/** Accent colour per page (matches the ROM tab palette). */
const PAGE_ACCENT: Record<Page, number> = {
  stats: 0x4a8ad6,
  abilities: 0xd65a52,
  moves: 0x5bb05b,
  field: 0x5bb05b,
  "side-player": 0xd65a52,
  "side-enemy": 0xd7af2e,
  "damage-calc": 0xb05bb0,
  "speed-order": 0x4a8ad6,
};

// Native GBA panel the layout is authored for; centered in the UI canvas.
const BG_W = 240;
const BG_H = 160;
// Cream "pill" box fills.
const CREAM = 0xf7f7c8;
const CREAM_EDGE = 0xfdfde8;
// Left on-field icon column.
const COL_X = 3;
const COL_W = 48;
const PANEL_X = 60;

/** A cream content box {x,y,w,h}. */
type Box = [number, number, number, number];

const STAT_GRID: { stat: Stat; label: string }[] = [
  { stat: Stat.ATK, label: "Atk" },
  { stat: Stat.DEF, label: "Def" },
  { stat: Stat.SPATK, label: "SpA" },
  { stat: Stat.SPDEF, label: "SpD" },
  { stat: Stat.SPD, label: "Spe" },
];

/**
 * The left arrow-grid rows for the Pokémon Stats page, in ROM-panel order: the 5
 * main battle stats, then (after the panel's separator gap) Accuracy, Evasion and
 * Crit. `stage` is the value the up/down arrow chips visualise (-6..+6 for the stat
 * stages, 0..+ for Crit which only ever rises).
 *
 * Crit has no Stat-enum stage — it reads {@linkcode Pokemon.getCritStage}, the true
 * source that folds Focus Energy / Dragon Cheer, Scope Lens / Razor Claw, Super Luck,
 * the ER Battle Aura, Pretentious KO-stacks and the Abyss biome bonus. Reusing it (not
 * re-deriving) is what makes the Crit row track every mid-battle change live (a Dragon
 * Cheer landing moves the arrows). A neutral reference move (Tackle, no HighCritAttr)
 * is used so ONLY the persistent crit sources count, not a move's own high-crit ratio.
 */
export function computeBattleInfoStatRows(mon: Pokemon): { label: string; stage: number }[] {
  const neutralMove = allMoves[MoveId.TACKLE];
  return [
    { label: "Atk", stage: mon.getStatStage(Stat.ATK) },
    { label: "Def", stage: mon.getStatStage(Stat.DEF) },
    { label: "SpA", stage: mon.getStatStage(Stat.SPATK) },
    { label: "SpD", stage: mon.getStatStage(Stat.SPDEF) },
    { label: "Spe", stage: mon.getStatStage(Stat.SPD) },
    { label: "Acc", stage: mon.getStatStage(Stat.ACC) },
    { label: "Eva", stage: mon.getStatStage(Stat.EVA) },
    { label: "Crit", stage: mon.getCritStage(mon, neutralMove) },
  ];
}

// Cream-box layouts per page (drawn as the fallback panel; content placed inside).
const STATS_BOXES: Box[] = [
  [64, 32, 128, 32], // name + type
  [64, 72, 80, 71], // stat-stage grid
  [152, 72, 84, 48], // stat numbers
  [152, 128, 84, 15], // nature
];
const ROW4_BOXES: Box[] = [
  [64, 32, 172, 24],
  [64, 64, 172, 24],
  [64, 96, 172, 24],
  [64, 128, 172, 24],
];
const PILL_BOXES: Box[] = [
  [64, 32, 172, 24],
  [64, 72, 172, 24],
  [64, 112, 172, 24],
];

// Row layout for the move-list panels (Moves + Damage Calculator). Up to 4 moves
// use the canonical ROW4 positions; a 5th move (the ER rogue-tier extra slot)
// compresses all five rows into the same vertical band so the last one isn't cut
// off the panel.
const MOVE_ROW5_BOXES: Box[] = [
  [64, 28, 172, 22],
  [64, 54, 172, 22],
  [64, 80, 172, 22],
  [64, 106, 172, 22],
  [64, 132, 172, 22],
];
// ER (#380): the finale boss runs the FULL 7-move Angel's Wrath kit, so the
// moves panel needs an extra-compressed band (16px pitch) for 6-8 rows.
const MOVE_ROW8_BOXES: Box[] = [
  [64, 26, 172, 14],
  [64, 42, 172, 14],
  [64, 58, 172, 14],
  [64, 74, 172, 14],
  [64, 90, 172, 14],
  [64, 106, 172, 14],
  [64, 122, 172, 14],
  [64, 138, 172, 14],
];
function moveRowBoxes(count: number): Box[] {
  if (count <= 4) {
    return ROW4_BOXES.slice(0, count);
  }
  if (count <= 5) {
    return MOVE_ROW5_BOXES.slice(0, count);
  }
  return MOVE_ROW8_BOXES.slice(0, count);
}

export class BattleInfoOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private pageIndex = 0;
  private slotIndex = 0;
  private assetsRequested = false;

  get isOpen(): boolean {
    return this.container != null;
  }

  /** On-field Pokémon: player side first, then enemy side (2 singles / 4 doubles). */
  private onField(): Pokemon[] {
    return [...globalScene.getPlayerField(true), ...globalScene.getEnemyField(true)];
  }

  /**
   * The cyclable pages: the always-available set plus the item-gated Damage
   * Calculator (Rogue-tier unlock) and Speed Order (Ultra-tier unlock) pages,
   * each shown only when the player owns the corresponding unlock.
   */
  private getPages(): Page[] {
    const pages: Page[] = [...PAGES];
    if (globalScene.findModifier(m => m instanceof DamageCalculatorModifier)) {
      pages.push("damage-calc");
    }
    // ER: the Speed Order page is ALWAYS available now (the Speed Order unlock item was
    // removed - it is a free in-battle info aid, no longer gated behind owning the item).
    pages.push("speed-order");
    return pages;
  }

  open(): void {
    if (this.container) {
      return;
    }
    this.pageIndex = 0;
    this.slotIndex = 0;
    this.render();
  }

  close(): void {
    if (this.container) {
      this.container.destroy();
      this.container = null;
    }
  }

  handleInput(button: Button): boolean {
    if (!this.container) {
      return false;
    }
    switch (button) {
      case Btn.LEFT: {
        const n = this.getPages().length;
        this.pageIndex = (this.pageIndex - 1 + n) % n;
        this.render();
        return true;
      }
      case Btn.RIGHT: {
        const n = this.getPages().length;
        this.pageIndex = (this.pageIndex + 1) % n;
        this.render();
        return true;
      }
      case Btn.CYCLE_SHINY: {
        // ER Black Shinies (#349): on the Abilities page, R would cycle the
        // inspected PLAYER black shiny's GIFT - but this overlay is the IN-BATTLE
        // inspector, and the gift is LOCKED mid-combat (isErGiftCycleAllowed is
        // always false here), so the cycle never fires and R just closes the
        // overlay. The gift is switched out of combat on the summary instead.
        const mon = this.onField()[this.slotIndex];
        if (
          this.getPages()[this.pageIndex] === "abilities"
          && mon?.isPlayer()
          && getErActiveGiftAbilityId(mon) !== null
          && isErGiftCycleAllowed()
        ) {
          cycleErGiftAbility(mon);
          this.render();
          return true;
        }
        this.close();
        return true;
      }
      case Btn.UP:
      case Btn.DOWN: {
        const n = Math.max(1, this.onField().length);
        const d = button === Btn.DOWN ? 1 : -1;
        this.slotIndex = (this.slotIndex + d + n) % n;
        this.render();
        return true;
      }
      default:
        this.close();
        return true;
    }
  }

  private render(): void {
    this.close();
    const H = globalScene.scaledCanvas.height;
    const W = globalScene.scaledCanvas.width;
    const pages = this.getPages();
    this.pageIndex = Math.min(this.pageIndex, pages.length - 1);
    const page = pages[this.pageIndex];

    const offX = Math.floor((W - BG_W) / 2);
    const offY = Math.floor((H - BG_H) / 2);
    const c = globalScene.add.container(offX, -H + offY).setDepth(1000);

    // Dim the battle behind the panel (full screen, regardless of centering).
    const scrim = globalScene.add.rectangle(-offX, -offY, W, H, 0x000000, 0.62).setOrigin(0, 0);
    c.add(scrim);

    // Panel: authentic ROM background if streamed in, else a graphics fallback.
    if (globalScene.textures.exists(BG_KEY[page])) {
      c.add(globalScene.add.image(0, 0, BG_KEY[page]).setOrigin(0, 0));
    } else {
      this.drawPanel(c, page);
      this.ensureAssets();
    }

    this.renderIconColumn(c);
    this.renderHeader(c, page);

    const field = this.onField();
    const mon = field[Math.min(this.slotIndex, field.length - 1)];
    switch (page) {
      case "stats":
        if (mon) {
          this.renderStats(c, mon);
        }
        break;
      case "abilities":
        if (mon) {
          this.renderAbilities(c, mon);
        }
        break;
      case "moves":
        if (mon) {
          this.renderMoves(c, mon);
        }
        break;
      case "field":
        this.renderField(c);
        break;
      case "side-player":
        this.renderSide(c, ArenaTagSide.PLAYER);
        break;
      case "side-enemy":
        this.renderSide(c, ArenaTagSide.ENEMY);
        break;
      case "damage-calc":
        if (mon) {
          this.renderDamageCalc(c, mon);
        }
        break;
      case "speed-order":
        this.renderSpeedOrder(c);
        break;
    }

    globalScene.ui.add(c);
    this.container = c;
  }

  /** Graphics fallback panel: accent backing + cream pill boxes for this page. */
  private drawPanel(c: Phaser.GameObjects.Container, page: Page): void {
    const g = globalScene.add.graphics();
    // Accent backing across the content area (left column kept clear).
    g.fillStyle(PAGE_ACCENT[page], 1);
    g.fillRoundedRect(54, 14, BG_W - 56, BG_H - 16, 6);
    // Subtle ROM-like horizontal striping.
    g.fillStyle(0xffffff, 0.07);
    for (let y = 18; y < BG_H - 4; y += 4) {
      g.fillRect(56, y, BG_W - 60, 1);
    }
    // Cream content boxes.
    const boxes =
      page === "stats"
        ? STATS_BOXES
        : page === "abilities" || page === "moves" || page === "damage-calc" || page === "speed-order"
          ? ROW4_BOXES
          : PILL_BOXES;
    for (const [x, y, w, h] of boxes) {
      g.fillStyle(CREAM_EDGE, 1);
      g.fillRoundedRect(x - 1, y - 1, w + 2, h + 2, 5);
      g.fillStyle(CREAM, 1);
      g.fillRoundedRect(x, y, w, h, 4);
    }
    c.add(g);
  }

  /** Lazy-load the ROM panel/overlay textures, re-render when ready. */
  private ensureAssets(): void {
    if (this.assetsRequested) {
      return;
    }
    this.assetsRequested = true;
    const files: [string, string][] = [
      ["er_binfo_stats", "stats.png"],
      ["er_binfo_abilities", "abilities.png"],
      ["er_binfo_moves", "moves.png"],
      ["er_binfo_field", "field.png"],
      ["er_binfo_side_player", "side-player.png"],
      ["er_binfo_side_enemy", "side-enemy.png"],
    ];
    let queued = 0;
    for (const [key, file] of files) {
      if (!globalScene.textures.exists(key)) {
        globalScene.loadImage(key, "elite-redux/battle-info", file);
        queued++;
      }
    }
    if (queued === 0) {
      return;
    }
    globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.container) {
        this.render();
      }
    });
    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }
  }

  /**
   * Left column: only the Pokémon currently on the field (player side, then
   * enemy side). Each slot is a rounded tile + party icon + name; the inspected
   * one is highlighted and bracketed.
   */
  private renderIconColumn(c: Phaser.GameObjects.Container): void {
    const field = this.onField();
    const n = Math.max(1, field.length);
    const sel = Math.min(this.slotIndex, n - 1);
    // Triple has 6 on-field mons (3+3): 6 tiles at the binary height overflow the 160px
    // column, so shrink the tiles (and their icon/label) to fit. Binary (<=4 on-field,
    // singles/doubles) keeps its exact previous layout.
    const isTriple = n > 4;
    const slotH = isTriple ? 22 : n <= 2 ? 44 : 30;
    const gap = isTriple ? 3 : 4;
    const iconScale = isTriple ? 0.55 : 0.7;
    const iconDy = isTriple ? -3 : -4;
    const tagDy = isTriple ? 7 : 8;
    const tagFont = isTriple ? "32px" : "38px";
    const total = field.length * slotH + (field.length - 1) * gap;
    let top = Math.max(6, Math.floor((BG_H - total) / 2));
    for (let i = 0; i < field.length; i++) {
      const mon = field[i];
      const isSel = i === sel;
      const isEnemy = mon.isEnemy();
      const cy = top + slotH / 2;
      const g = globalScene.add.graphics();
      g.fillStyle(isSel ? 0xf5d23a : isEnemy ? 0xc06868 : 0x68a0c0, 1);
      g.fillRoundedRect(COL_X, top, COL_W, slotH, 6);
      if (isSel) {
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRoundedRect(COL_X, top, COL_W, slotH, 6);
      }
      c.add(g);
      const icon = globalScene.addPokemonIcon(mon, COL_X + COL_W / 2, cy + iconDy, 0.5, 0.5);
      icon.setScale(iconScale);
      c.add(icon);
      const tag = addTextObject(
        COL_X + COL_W / 2,
        top + slotH - tagDy,
        isEnemy ? "Foe" : "Ally",
        TextStyle.WINDOW_ALT,
        {
          fontSize: tagFont,
        },
      );
      tag.setOrigin(0.5, 0);
      c.add(tag);
      top += slotH + gap;
    }
  }

  /** Header bar: page title (left) + control hints (right). */
  private renderHeader(c: Phaser.GameObjects.Container, page: Page): void {
    const title = addTextObject(PANEL_X, 2, PAGE_TITLE[page], TextStyle.SUMMARY, { fontSize: "60px" });
    title.setOrigin(0, 0);
    c.add(title);
    const hint = addTextObject(BG_W - 3, 4, "Ⓐ Scroll  ✛ Switch  ✛ Page", TextStyle.SUMMARY, { fontSize: "38px" });
    hint.setOrigin(1, 0);
    c.add(hint);
  }

  // --- per-Pokémon: STATS --------------------------------------------------
  private renderStats(c: Phaser.GameObjects.Container, mon: Pokemon): void {
    const gender = mon.gender === 0 ? " ♂" : mon.gender === 1 ? " ♀" : "";
    const name = addTextObject(68, 34, `${mon.getNameToRender()}${gender} Lv${mon.level}`, TextStyle.WINDOW_ALT, {
      fontSize: "54px",
    });
    name.setOrigin(0, 0);
    c.add(name);
    const types = mon
      .getTypes()
      .map(t => i18nType(t))
      .join(" / ");
    const typeText = addTextObject(68, 49, `Type: ${types}`, TextStyle.WINDOW_ALT, { fontSize: "50px" });
    typeText.setOrigin(0, 0);
    c.add(typeText);

    // Stat-stage rows (label + up/down arrow chips), aligned to the ROM panel's dot
    // grid: the 5 main battle stats at 8px pitch, the panel's separator gap, then
    // Acc / Eva / Crit (labels + live arrows). The Crit row reads the true crit stage
    // (getCritStage) so a Focus Energy / Dragon Cheer / Scope Lens bump moves the
    // arrows. The arrow columns sit on the ROM art's pre-printed dots.
    const rows = computeBattleInfoStatRows(mon);
    const ROW_Y = [76, 84, 92, 100, 108, 124, 132, 140];
    rows.forEach((row, ri) => {
      const ry = ROW_Y[ri];
      const lbl = addTextObject(66, ry - 5, row.label, TextStyle.WINDOW_ALT, { fontSize: "46px" });
      lbl.setOrigin(0, 0);
      c.add(lbl);
      const stage = row.stage; // -6..+6 for stat stages; 0..+ for Crit
      const g = globalScene.add.graphics();
      for (let d = 0; d < 6; d++) {
        const on = d < Math.abs(stage);
        const cx = 91 + d * 8;
        if (on) {
          g.fillStyle(stage >= 0 ? 0x3aa83a : 0xd64a4a, 1);
          if (stage >= 0) {
            g.fillTriangle(cx - 3, ry + 2, cx + 3, ry + 2, cx, ry - 3);
          } else {
            g.fillTriangle(cx - 3, ry - 2, cx + 3, ry - 2, cx, ry + 3);
          }
        } else {
          g.fillStyle(0x000000, 0.18);
          g.fillCircle(cx, ry, 1.4);
        }
      }
      c.add(g);
    });

    // Stat numbers (right box), 6 rows. For the 5 battle stats we show the value
    // after the in-battle STAT-STAGE multiplier next to the base when a stage is
    // active — e.g. a +1 Atk reads "147(220)", coloured green for a boost / red for
    // a drop. We deliberately apply ONLY stat stages (the visible up/down arrows),
    // NOT held-item/ability passives like Eviolite — those have no stage arrow, so
    // folding them in (via getEffectiveStat) made stats "look changed" with nothing
    // to explain it. The base already folds in vitamins, EVs, IVs and nature
    // (getStat). HP has no stat stages → current/max.
    const numbers: { lbl: string; stat: EffectiveStat | null }[] = [
      { lbl: "HP", stat: null },
      { lbl: "Atk", stat: Stat.ATK },
      { lbl: "Def", stat: Stat.DEF },
      { lbl: "SpA", stat: Stat.SPATK },
      { lbl: "SpD", stat: Stat.SPDEF },
      { lbl: "Spe", stat: Stat.SPD },
    ];
    let ny = 74;
    for (const { lbl, stat } of numbers) {
      const l = addTextObject(156, ny, lbl, TextStyle.WINDOW_ALT, { fontSize: "44px" });
      l.setOrigin(0, 0);
      c.add(l);

      let text: string;
      let dir = 0; // -1 net drop, 0 unchanged, +1 net boost
      if (stat === null) {
        text = `${mon.hp}/${mon.getMaxHp()}`;
      } else {
        const base = mon.getStat(stat);
        const stage = mon.getStatStage(stat); // -6..+6
        if (stage === 0) {
          text = `${base}`;
        } else {
          // Canonical battle-stat stage multiplier: max(2,2+s)/max(2,2-s).
          const eff = Math.floor((base * Math.max(2, 2 + stage)) / Math.max(2, 2 - stage));
          text = `${base}(${eff})`;
          dir = stage > 0 ? 1 : -1;
        }
      }
      const v = addTextObject(232, ny, text, TextStyle.WINDOW_ALT, { fontSize: "44px" });
      v.setOrigin(1, 0);
      if (dir > 0) {
        v.setColor("#3aa83a").setShadowColor("#1f5e1f");
      } else if (dir < 0) {
        v.setColor("#d64a4a").setShadowColor("#7a2a2a");
      }
      c.add(v);
      ny += 7.5;
    }

    // Nature (bottom-right box).
    const nat = mon.getNature();
    const natText = addTextObject(156, 130, `${getNatureName(nat)} ${naturePlusMinus(nat)}`, TextStyle.WINDOW_ALT, {
      fontSize: "40px",
    });
    natText.setOrigin(0, 0);
    c.add(natText);
  }

  // --- per-Pokémon: ABILITIES ----------------------------------------------
  private renderAbilities(c: Phaser.GameObjects.Container, mon: Pokemon): void {
    try {
      this.renderAbilitiesInner(c, mon);
    } catch (err) {
      // #443: certain mons (reported on a freshly-evolved Gholdengo and on
      // Bloodmoon Ursaluna) could throw while resolving their ability/innate
      // data here, hard-crashing the whole Pokémon Info overlay. A blank-ish
      // ability panel is far better than a dead game, and the logged error
      // keeps the real culprit diagnosable from a Send Logs capture.
      console.error("[battle-info] renderAbilities failed for", mon?.species?.name, err);
    }
  }

  private renderAbilitiesInner(c: Phaser.GameObjects.Container, mon: Pokemon): void {
    const rows: { label: string; abilityId: number; locked: boolean; gift?: boolean }[] = [];
    // ER Giratina's Bargain - Curiosity (#544): slots the player sealed for this run.
    // The ER slot index is 0 (active ability) or `innateSlot + 1` (innate), matching
    // Pokemon.getAbilitySlots / canApplyAbility. Player-only, like the battle gate.
    const isPlayerMon = mon.isPlayer?.() === true;
    const runLocked = (abilitySlot: number): boolean =>
      isPlayerMon && mon.customPokemonData?.erLockedAbilitySlots?.includes(abilitySlot) === true;
    const main = mon.getAbility(true);
    if (main) {
      const lockedByRun = runLocked(0);
      rows.push({ label: lockedByRun ? "Ability (Locked)" : "Ability", abilityId: main.id, locked: lockedByRun });
    }

    // Innate slots are NOT all active just because they exist: for the player
    // each slot is gated behind its candy unlock (+ enable) in `passiveAttr`;
    // enemies gate slot 2 @ Lv15 and slot 3 @ Lv24. Show every slot (so the
    // player can read descriptions and plan), but mark the ones that aren't
    // actually in effect as Locked/Disabled instead of pretending they're live.
    const isEnemy = mon.isEnemy?.() === true;
    const enemyLevelForSlot = [0, 15, 24];
    // ER Youngster mode (#368): innate slots temp-unlock by level, no candies.
    const youngsterFree = erYoungsterFreeInnateSlots(mon.level);

    // Use the POKEMON-level passive resolver (not the species-level one): it
    // honors per-Pokémon overrides written by the Ability Randomizer
    // (`customPokemonData.passive/passive2/passive3`) and transform overrides,
    // so the panel reflects runtime ability changes rather than static species data.
    // ER Black Shinies (#349): getPassiveAbilities also appends GIFT slots
    // (index >= 3) — those are handled separately below, NEVER through the
    // innate gating (PASSIVE_SLOTS[3] does not exist and threw, closing the
    // whole overlay for any mon with an active or shared gift).
    const innates = mon.getPassiveAbilities();
    for (let slot = 0; slot < Math.min(innates.length, 3); slot++) {
      const ability = innates[slot];
      if (!ability || !ability.id) {
        continue;
      }
      const passiveSlot = slot as PassiveSlot;
      let label = "Innate";
      let locked = false;
      if (runLocked(slot + 1)) {
        // Sealed by the Curiosity bargain - dead this run regardless of candy/level.
        locked = true;
        label = "Innate (Locked)";
      } else if (isEnemy) {
        const levelReq = enemyLevelForSlot[passiveSlot] ?? 0;
        if (mon.level < levelReq) {
          locked = true;
          label = `Innate (Locked Lv${levelReq})`;
        }
      } else if (
        slot < youngsterFree
        || globalScene.gameMode?.isDaily === true
        || mon.customPokemonData?.erInnateShrineUnlocked === true // ER Innate Shrine (#514): shrine-attuned mon's slots are unlocked for the run.
        || ability.id === AbilityId.TRUANT // ER (#381): a TRUANT innate is always live for free (it is a nerf).
      ) {
        // live for free this run — fall through unlocked
      } else {
        // #611: a fusion's slots 0/2 are owned by the FUSION species, so read this
        // slot's unlock from the species that owns it (mirrors the battle-time gate in
        // Pokemon.canApplyAbility) - otherwise a fusion-owned innate that IS live in
        // battle would still render here as "Locked".
        const slotPassiveAttr = mon.innateSlotPassiveAttr(passiveSlot);
        if (!isSlotUnlocked(slotPassiveAttr, passiveSlot)) {
          locked = true;
          label = "Innate (Locked)";
        } else if (!isSlotEnabled(slotPassiveAttr, passiveSlot)) {
          locked = true;
          label = "Innate (Disabled)";
        }
      }
      rows.push({ label, abilityId: ability.id, locked });
    }

    // ER Black Shinies (#349): the GIFT — the black shiny's own active choice
    // and/or the gift shared by an on-field black ALLY. Always live.
    const ownGift = getErActiveGiftAbilityId(mon);
    for (const giftId of getErSharedGiftAbilityIdsFor(mon)) {
      const label =
        giftId === ownGift
          ? `Gift ${(mon.customPokemonData?.erGiftIndex ?? 0) + 1}/${mon.customPokemonData?.erGiftAbilities?.length ?? 3}${mon.isPlayer() ? " (R)" : ""}`
          : "Gift (Ally)";
      rows.push({ label, abilityId: giftId, locked: false, gift: true });
    }

    const boxes = rows.length <= 4 ? ROW4_BOXES : MOVE_ROW5_BOXES;
    boxes.slice(0, rows.length).forEach(([, by], i) => {
      const r = rows[i];
      const ability = allAbilities[r.abilityId];
      const head = addTextObject(68, by + 1, `${r.label}: ${ability?.name ?? ""}`, TextStyle.SUMMARY, {
        fontSize: "46px",
      });
      head.setOrigin(0, 0);
      // Gray out locked/disabled innates so it's clear at a glance which are live.
      if (r.locked) {
        head.setColor(getTextColor(TextStyle.SUMMARY_GRAY));
      }
      if (r.gift) {
        // Same styling as the summary screen's gift row.
        head.setFontStyle("bold italic");
        head.setColor("#e8d8ff");
      }
      c.add(head);
      const desc = getErAbilityDescription(r.abilityId) ?? ability?.description ?? "";
      const d = addTextObject(68, by + 10, desc, TextStyle.WINDOW_ALT, { fontSize: "38px", wordWrap: { width: 670 } });
      d.setOrigin(0, 0);
      if (r.locked) {
        d.setColor(getTextColor(TextStyle.SUMMARY_GRAY));
      }
      c.add(d);
    });
  }

  // --- per-Pokémon: MOVES --------------------------------------------------
  private renderMoves(c: Phaser.GameObjects.Container, mon: Pokemon): void {
    // ER (#380): up to 8 rows - the finale boss fields the full 7-move
    // Angel's Wrath kit, rendered in the compressed band.
    const moves = mon.getMoveset().filter(Boolean).slice(0, 8);
    const compact = moves.length > 5;
    moveRowBoxes(moves.length).forEach(([, by], i) => {
      const mv = moves[i];
      const move = mv.getMove();
      const head = addTextObject(68, by + (compact ? 1 : 3), move.name, TextStyle.SUMMARY, {
        fontSize: compact ? "40px" : "48px",
      });
      head.setOrigin(0, 0);
      c.add(head);
      const meta = addTextObject(
        230,
        by + (compact ? 3 : 11),
        `${i18nType(move.type)}  Pw ${move.power > 0 ? move.power : "—"}  PP ${mv.ppUsed}/${mv.getMovePp()}`,
        TextStyle.WINDOW_ALT,
        { fontSize: compact ? "34px" : "38px" },
      );
      meta.setOrigin(1, 0);
      c.add(meta);
    });
  }

  // --- DAMAGE CALCULATOR (Rogue-tier unlock) -------------------------------
  // Shows the inspected Pokémon's moves and the damage each would deal to the
  // primary opposing target (single rolled estimate, % of the target's max HP).
  private renderDamageCalc(c: Phaser.GameObjects.Container, mon: Pokemon): void {
    const target = mon.getOpponents()[0];
    const moves = mon.getMoveset().filter(Boolean).slice(0, 8);
    if (!target) {
      const t = addTextObject(68, ROW4_BOXES[0][1] + 6, "No target on the field.", TextStyle.WINDOW_ALT, {
        fontSize: "44px",
      });
      t.setOrigin(0, 0);
      c.add(t);
      return;
    }
    // Sub-header: who we're calculating against.
    const sub = addTextObject(PANEL_X, 14, `vs ${target.getNameToRender()}`, TextStyle.WINDOW_ALT, {
      fontSize: "42px",
    });
    sub.setOrigin(0, 0);
    c.add(sub);

    moveRowBoxes(Math.max(1, moves.length)).forEach(([, by], i) => {
      const mv = moves[i];
      if (!mv) {
        return;
      }
      const move = mv.getMove();
      const head = addTextObject(68, by + 3, move.name, TextStyle.SUMMARY, { fontSize: "46px" });
      head.setOrigin(0, 0);
      c.add(head);

      let info: string;
      if (move.category === MoveCategory.STATUS || move.power <= 0) {
        info = "—  (status)";
      } else {
        // Shared preview: real per-hit damage scaled for multi-hit (MultiHitAttr
        // moves + ER Multi-Headed) so multi-strike moves aren't undercounted here.
        // Same layout as before, just the corrected total (the fight-menu DMG CALC
        // panel carries the hit-count + crit breakdown).
        const { max } = getErDamagePreview(mon, target, move);
        const pct = Math.max(0, Math.round((max / Math.max(1, target.getMaxHp())) * 100));
        const ko = max >= target.hp ? "  KO!" : "";
        info = `${max} dmg (${pct}%)${ko}`;
      }
      const meta = addTextObject(230, by + 11, info, TextStyle.WINDOW_ALT, { fontSize: "40px" });
      meta.setOrigin(1, 0);
      c.add(meta);
    });
  }

  // --- SPEED ORDER (Ultra-tier unlock) -------------------------------------
  // Lists every on-field Pokémon ordered by effective Speed (accounting for
  // Trick Room), so the player can read the turn order at a glance.
  private renderSpeedOrder(c: Phaser.GameObjects.Container): void {
    const field = this.onField();
    const trickRoom = !!globalScene.arena.getTag(ArenaTagType.TRICK_ROOM);
    const ranked = field
      .map(p => ({ p, spd: p.getEffectiveStat(Stat.SPD) }))
      .sort((a, b) => (trickRoom ? a.spd - b.spd : b.spd - a.spd));

    if (trickRoom) {
      const tr = addTextObject(PANEL_X, 14, "Trick Room active (slowest first)", TextStyle.WINDOW_ALT, {
        fontSize: "40px",
      });
      tr.setOrigin(0, 0);
      c.add(tr);
    }

    ranked.slice(0, ROW4_BOXES.length).forEach(({ p, spd }, i) => {
      const [, by] = ROW4_BOXES[i];
      const side = p.isEnemy() ? "Foe" : "Ally";
      const head = addTextObject(68, by + 6, `${i + 1}.  ${p.getNameToRender()} (${side})`, TextStyle.SUMMARY, {
        fontSize: "46px",
      });
      head.setOrigin(0, 0);
      c.add(head);
      const v = addTextObject(230, by + 8, `Spe ${spd}`, TextStyle.WINDOW_ALT, { fontSize: "44px" });
      v.setOrigin(1, 0);
      c.add(v);
    });
  }

  // --- FIELD: weather / terrain --------------------------------------------
  private renderField(c: Phaser.GameObjects.Container): void {
    const rows: [string, string][] = [];
    const weather = globalScene.arena.weather;
    if (weather && weather.weatherType !== WeatherType.NONE) {
      rows.push([WeatherType[weather.weatherType].replace(/_/g, " "), `Turns Left: ${weather.turnsLeft}`]);
    }
    const terrain = globalScene.arena.terrain;
    if (terrain) {
      rows.push([`${terrainName(terrain.terrainType)} Terrain`, `Turns Left: ${terrain.turnsLeft}`]);
    }
    this.renderPills(c, rows.length > 0 ? rows : [["No field effects", ""]]);
  }

  // --- SIDE: side conditions as pill rows ----------------------------------
  private renderSide(c: Phaser.GameObjects.Container, side: ArenaTagSide): void {
    const rows: [string, string][] = [];
    for (const tag of globalScene.arena.tags) {
      if (tag.side !== side && tag.side !== ArenaTagSide.BOTH) {
        continue;
      }
      const turns = tag.turnCount > 0 ? `Turns Left: ${tag.turnCount}` : "";
      rows.push([tagDisplayName(tag), turns]);
    }
    this.renderPills(c, rows.length > 0 ? rows : [["No side effects", ""]]);
  }

  /** Up to 3 pill rows (name + turns) in the 3 pill boxes. */
  private renderPills(c: Phaser.GameObjects.Container, rows: [string, string][]): void {
    PILL_BOXES.slice(0, Math.min(3, rows.length)).forEach(([, by], i) => {
      const [name, turns] = rows[i];
      const n = addTextObject(70, by + 2, name, TextStyle.SUMMARY, { fontSize: "48px" });
      n.setOrigin(0, 0);
      c.add(n);
      if (turns) {
        const t = addTextObject(70, by + 12, turns, TextStyle.WINDOW_ALT, { fontSize: "40px" });
        t.setOrigin(0, 0);
        c.add(t);
      }
    });
  }
}

// --- helpers ----------------------------------------------------------------
/** "Fire", "Water"… from the numeric PokemonType. */
function i18nType(type: number): string {
  const name = (PokemonTypeEnum as unknown as Record<number, string>)[type] ?? "";
  return name.charAt(0) + name.slice(1).toLowerCase();
}

function naturePlusMinus(nature: number): string {
  let plus = "";
  let minus = "";
  for (const s of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
    const m = getNatureStatMultiplier(nature, s);
    if (m > 1) {
      plus = STAT_GRID.find(g => g.stat === s)?.label ?? "";
    } else if (m < 1) {
      minus = STAT_GRID.find(g => g.stat === s)?.label ?? "";
    }
  }
  return plus && minus ? `(+${plus}, -${minus})` : "(neutral)";
}

function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function terrainName(t: number): string {
  return titleCase((TerrainTypeEnum as unknown as Record<number, string>)[t] ?? "");
}

/** ArenaTagType is a string enum (e.g. "STEALTH_ROCK") → "Stealth Rock". */
function tagDisplayName(tag: { tagType: string }): string {
  return titleCase(tag.tagType);
}
