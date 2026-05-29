// =============================================================================
// Elite Redux — in-battle "Info" screen, rebuilt to match the ER ROM's
// gAbilitiesInfo menu pixel-faithfully.
//
// Visual structure (assets extracted from the v2.65.3b ROM —
// scripts/elite-redux/build_battle_info_backgrounds.py):
//   • A full 240x160 page background (the shared tile panel recoloured per page:
//     Player Side Info = red, Enemy Side Info = yellow, Field = green,
//     Pokémon Stats = blue, Abilities = red, Moves = green).
//   • A left column of 6 party slots (orange) drawn with each Pokémon's party
//     icon; the selected slot gets the red corner-bracket selector + green tile.
//   • A header bar with the page title + control hints
//     ("Ⓐ Scroll  ✛ Switch  ✛ Page").
//
// Controls (matching the ROM):
//   UP/DOWN  → switch the selected party Pokémon (left column).
//   LEFT/RIGHT → cycle pages.
//   anything else → close.
//
// Coordinate note: the `ui` container draws at NEGATIVE y (origin bottom-left),
// so the panel anchors at y = -canvasHeight + topMargin and lays out downward.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { getErAbilityDescription } from "#data/elite-redux/er-ability-descriptions";
import { getNatureName, getNatureStatMultiplier } from "#data/nature";
import { TerrainType as TerrainTypeEnum } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { Button } from "#enums/buttons";
import { Button as Btn } from "#enums/buttons";
import { PokemonType as PokemonTypeEnum } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { addTextObject } from "#ui/text";

/** Page identity → background texture key + accent palette colour. */
type Page = "side-player" | "side-enemy" | "field" | "stats" | "abilities" | "moves";
const PAGES: Page[] = ["stats", "abilities", "moves", "field", "side-player", "side-enemy"];

const BG_KEY: Record<Page, string> = {
  stats: "er_binfo_stats",
  abilities: "er_binfo_abilities",
  moves: "er_binfo_moves",
  field: "er_binfo_field",
  "side-player": "er_binfo_side_player",
  "side-enemy": "er_binfo_side_enemy",
};

const PAGE_TITLE: Record<Page, string> = {
  stats: "Pokémon Stats",
  abilities: "Abilities Info",
  moves: "Moves Info",
  field: "Field Info",
  "side-player": "Player Side Info",
  "side-enemy": "Enemy Side Info",
};

// Native GBA screen the backgrounds were authored for; centered in the UI.
const BG_W = 240;
const BG_H = 160;
// Left party column geometry (6 slots), measured from the ROM panel.
const COL_ICON_X = 26;
const COL_TOP = 6;
const COL_SLOT_H = 25;
const SLOT_COUNT = 6;
// Right content area.
const CONTENT_X = 60;

const STAT_GRID: { stat: Stat; label: string }[] = [
  { stat: Stat.ATK, label: "Atk" },
  { stat: Stat.DEF, label: "Def" },
  { stat: Stat.SPATK, label: "SpA" },
  { stat: Stat.SPDEF, label: "SpD" },
  { stat: Stat.SPD, label: "Spe" },
];

export class BattleInfoOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private pageIndex = 0;
  private slotIndex = 0;

  get isOpen(): boolean {
    return this.container != null;
  }

  private party(): Pokemon[] {
    return globalScene.getPlayerParty().slice(0, SLOT_COUNT);
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
      case Btn.LEFT:
        this.pageIndex = (this.pageIndex - 1 + PAGES.length) % PAGES.length;
        this.render();
        return true;
      case Btn.RIGHT:
        this.pageIndex = (this.pageIndex + 1) % PAGES.length;
        this.render();
        return true;
      case Btn.UP:
      case Btn.DOWN: {
        const n = Math.max(1, this.party().length);
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
    const page = PAGES[this.pageIndex];

    // Center the 240x160 ROM panel in the UI canvas.
    const offX = Math.floor((W - BG_W) / 2);
    const offY = Math.floor((H - BG_H) / 2);
    const c = globalScene.add.container(offX, -H + offY).setDepth(1000);

    // Dim the battle behind the panel.
    const scrim = globalScene.add.rectangle(-offX, -offY, W, H, 0x000000, 0.5).setOrigin(0, 0);
    c.add(scrim);

    // Page background (recoloured ROM tile panel).
    const bg = globalScene.add.image(0, 0, BG_KEY[page]).setOrigin(0, 0);
    c.add(bg);

    this.renderPartyColumn(c);
    this.renderHeader(c, page);

    const party = this.party();
    const mon = party[Math.min(this.slotIndex, party.length - 1)];
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
    }

    globalScene.ui.add(c);
    this.container = c;
  }

  /**
   * Left column: 6 party slots, drawn over the panel's own (4-battler, v2.65.3b)
   * column so it matches the newer 6-slot screenshots — orange rounded tiles
   * (green for the selected one) + each Pokémon's icon + the corner-bracket
   * selector.
   */
  private renderPartyColumn(c: Phaser.GameObjects.Container): void {
    const party = this.party();
    const sel = Math.min(this.slotIndex, Math.max(0, party.length - 1));
    const x0 = 3;
    const w = 46;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const top = COL_TOP + i * COL_SLOT_H;
      const cy = top + COL_SLOT_H / 2;
      const isSel = i === sel && party.length > 0;
      const g = globalScene.add.graphics();
      g.fillStyle(isSel ? 0x90c050 : 0xf0aa38, 1);
      g.fillRoundedRect(x0, top + 1, w, COL_SLOT_H - 2, 5);
      c.add(g);
      const mon = party[i];
      if (mon) {
        const icon = globalScene.addPokemonIcon(mon, COL_ICON_X, cy - 13, 0.5, 0.5);
        icon.setScale(0.62);
        c.add(icon);
      }
      if (isSel) {
        const brackets = globalScene.add.image(COL_ICON_X, cy, "er_binfo_selector").setOrigin(0.5, 0.5).setScale(0.62);
        c.add(brackets);
      }
    }
  }

  /** Header bar: page title (left) + control hints (right). */
  private renderHeader(c: Phaser.GameObjects.Container, page: Page): void {
    const title = addTextObject(CONTENT_X, 3, PAGE_TITLE[page], TextStyle.SUMMARY, { fontSize: "60px" });
    title.setOrigin(0, 0);
    c.add(title);
    const hint = addTextObject(BG_W - 3, 4, "Ⓐ Scroll  ✛ Switch  ✛ Page", TextStyle.SUMMARY, { fontSize: "40px" });
    hint.setOrigin(1, 0);
    c.add(hint);
  }

  // --- per-Pokémon: STATS (blue) -------------------------------------------
  // Box geometry measured from the assembled ROM panel (stats.png):
  //   name box     x64-191 y32-63   (name+Lv line, types line)
  //   dot-grid box x64-143 y72-143  (baked 5x6 dot grid; cols x91..131 step8,
  //                                  rows y75..107 step8 — overlay arrows)
  //   numbers box  x152-235 y72-119 (6 stat rows)
  //   nature box   x153-234 y128-143
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

    // Stat-stage labels + arrow overlays on the baked dot grid.
    const DOT_X0 = 91;
    const DOT_STEP = 8;
    const DOT_ROWS = [75, 83, 91, 99, 107];
    STAT_GRID.forEach((row, ri) => {
      const ry = DOT_ROWS[ri];
      const lbl = addTextObject(67, ry - 4, row.label, TextStyle.WINDOW_ALT, { fontSize: "44px" });
      lbl.setOrigin(0, 0);
      c.add(lbl);
      const stage = mon.getStatStage(row.stat); // -6..+6
      const up = stage >= 0;
      for (let d = 0; d < Math.min(6, Math.abs(stage)); d++) {
        const arrow = globalScene.add
          .image(DOT_X0 + d * DOT_STEP, ry, up ? "er_binfo_stat_up" : "er_binfo_stat_down")
          .setOrigin(0.5, 0.5);
        c.add(arrow);
      }
    });

    // Actual stat numbers (right box) — 6 rows, step 8.
    const numbers: [string, string][] = [
      ["HP", `${mon.hp}/${mon.getMaxHp()}`],
      ["Atk", `${mon.getStat(Stat.ATK)}`],
      ["Def", `${mon.getStat(Stat.DEF)}`],
      ["SpA", `${mon.getStat(Stat.SPATK)}`],
      ["SpD", `${mon.getStat(Stat.SPDEF)}`],
      ["Spe", `${mon.getStat(Stat.SPD)}`],
    ];
    let ny = 73;
    for (const [lbl, val] of numbers) {
      const l = addTextObject(156, ny, lbl, TextStyle.WINDOW_ALT, { fontSize: "44px" });
      l.setOrigin(0, 0);
      c.add(l);
      const v = addTextObject(234, ny, val, TextStyle.WINDOW_ALT, { fontSize: "44px" });
      v.setOrigin(1, 0);
      c.add(v);
      ny += 8;
    }

    // Nature (bottom-right box, one line).
    const nat = mon.getNature();
    const natText = addTextObject(156, 130, `${getNatureName(nat)} ${naturePlusMinus(nat)}`, TextStyle.WINDOW_ALT, {
      fontSize: "42px",
    });
    natText.setOrigin(0, 0);
    c.add(natText);
  }

  // --- per-Pokémon: ABILITIES (red) ----------------------------------------
  private renderAbilities(c: Phaser.GameObjects.Container, mon: Pokemon): void {
    const rows: { label: string; abilityId: number }[] = [];
    const main = mon.getAbility(true);
    if (main) {
      rows.push({ label: "Ability", abilityId: main.id });
    }
    const innates = mon.species.getPassiveAbilities(mon.formIndex);
    for (const id of innates) {
      if (id) {
        rows.push({ label: "Innate", abilityId: id });
      }
    }
    let y = 33;
    for (const r of rows.slice(0, 4)) {
      const ability = allAbilities[r.abilityId];
      const head = addTextObject(68, y, `${r.label}: ${ability?.name ?? ""}`, TextStyle.SUMMARY, {
        fontSize: "48px",
      });
      head.setOrigin(0, 0);
      c.add(head);
      const desc = getErAbilityDescription(r.abilityId) ?? ability?.description ?? "";
      const d = addTextObject(68, y + 9, desc, TextStyle.WINDOW_ALT, {
        fontSize: "40px",
        wordWrap: { width: 660 },
      });
      d.setOrigin(0, 0);
      c.add(d);
      y += 32;
    }
  }

  // --- per-Pokémon: MOVES (green) ------------------------------------------
  private renderMoves(c: Phaser.GameObjects.Container, mon: Pokemon): void {
    let y = 33;
    for (const mv of mon.getMoveset().slice(0, 4)) {
      if (!mv) {
        continue;
      }
      const move = mv.getMove();
      const head = addTextObject(68, y, move.name, TextStyle.SUMMARY, { fontSize: "48px" });
      head.setOrigin(0, 0);
      c.add(head);
      const meta = addTextObject(
        228,
        y + 10,
        `${i18nType(move.type)}  Pw ${move.power > 0 ? move.power : "—"}  PP ${mv.ppUsed}/${mv.getMovePp()}`,
        TextStyle.WINDOW_ALT,
        { fontSize: "40px" },
      );
      meta.setOrigin(1, 0);
      c.add(meta);
      y += 32;
    }
  }

  // --- FIELD (green): weather / terrain / room -----------------------------
  private renderField(c: Phaser.GameObjects.Container): void {
    const rows: [string, string][] = [];
    const weather = globalScene.arena.weather;
    if (weather && weather.weatherType !== WeatherType.NONE) {
      rows.push([WeatherType[weather.weatherType].replace(/_/g, " "), `Turns Left:${weather.turnsLeft}`]);
    }
    const terrain = globalScene.arena.terrain;
    if (terrain) {
      rows.push([`${terrainName(terrain.terrainType)} Terrain`, `Turns Left:${terrain.turnsLeft}`]);
    }
    this.renderPills(c, rows.length > 0 ? rows : [["No field effects", ""]]);
  }

  // --- SIDE (red/yellow): side conditions as pill rows ---------------------
  private renderSide(c: Phaser.GameObjects.Container, side: ArenaTagSide): void {
    const rows: [string, string][] = [];
    for (const tag of globalScene.arena.tags) {
      if (tag.side !== side && tag.side !== ArenaTagSide.BOTH) {
        continue;
      }
      const name = tagDisplayName(tag);
      const turns = tag.turnCount > 0 ? `Turns Left:${tag.turnCount}` : "";
      rows.push([name, turns]);
    }
    this.renderPills(c, rows.length > 0 ? rows : [["No side effects", ""]]);
  }

  /** Render up to 6 "pill" rows (name left, turns right, on the striped panel). */
  private renderPills(c: Phaser.GameObjects.Container, rows: [string, string][]): void {
    // 3 pill boxes (x64-235): tops y32, y72, y112.
    const tops = [38, 78, 118];
    rows.slice(0, 3).forEach(([name, turns], i) => {
      const y = tops[i];
      const n = addTextObject(70, y, name, TextStyle.SUMMARY, { fontSize: "50px" });
      n.setOrigin(0, 0);
      c.add(n);
      if (turns) {
        const t = addTextObject(70, y + 11, turns, TextStyle.WINDOW_ALT, { fontSize: "44px" });
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

function terrainName(t: number): string {
  return (TerrainTypeEnum as unknown as Record<number, string>)[t] ?? "";
}

function tagDisplayName(tag: { tagType: string }): string {
  return tag.tagType.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
}
