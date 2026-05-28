// =============================================================================
// Elite Redux — in-battle "Battle Info" overlay.
//
// A self-contained panel (no UI-mode switch) opened from the command menu.
// Left/Right cycle info panels; Up/Down cycle the inspected Pokémon (player
// party + active enemies). Implemented as a plain container at high depth so
// it never disturbs the battle command flow — any non-navigation button
// closes it.
//
// Panels:
//   STATS     — actual current stats + stat-stage arrows, types, item, nature
//   ABILITIES — main ability + innates (abbreviated ER descriptions)
//   MOVES     — each move: type, power, accuracy, category, PP, STAB
//   WEATHER   — current weather + turns remaining
//   SIDES     — player/enemy side conditions (screens, Aurora Veil, terrain…)
//
// Coordinate note: the `ui` container draws content at NEGATIVE y (origin
// bottom-left), so the panel anchors at y = -scaledCanvas.height + margin and
// lays children out downward in positive local y.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { getErAbilityDescription } from "#data/elite-redux/er-ability-descriptions";
import { getNatureName } from "#data/nature";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { Button } from "#enums/buttons";
import { Button as Btn } from "#enums/buttons";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { addTextObject, getTextColor } from "#ui/text";
import i18next from "i18next";

type PanelKind = "stats" | "abilities" | "moves" | "weather" | "sides";
const PANELS: PanelKind[] = ["stats", "abilities", "moves", "weather", "sides"];

const STAT_ROWS: { stat: Stat; label: string }[] = [
  { stat: Stat.HP, label: "HP" },
  { stat: Stat.ATK, label: "Atk" },
  { stat: Stat.DEF, label: "Def" },
  { stat: Stat.SPATK, label: "SpA" },
  { stat: Stat.SPDEF, label: "SpD" },
  { stat: Stat.SPD, label: "Spe" },
];

export class BattleInfoOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private panelIndex = 0;
  private targetIndex = 0;

  get isOpen(): boolean {
    return this.container != null;
  }

  /** Pokémon the user can page through: player field/party then enemy field. */
  private getTargets(): Pokemon[] {
    const players = globalScene.getPlayerParty().filter(p => !p.isFainted());
    const enemies = globalScene.getEnemyField().filter(p => p?.isActive());
    return [...players, ...enemies];
  }

  open(): void {
    if (this.container) {
      return;
    }
    this.panelIndex = 0;
    this.targetIndex = 0;
    this.render();
  }

  close(): void {
    if (this.container) {
      this.container.destroy();
      this.container = null;
    }
  }

  /**
   * Handle a button while open. Returns true if consumed. Navigation buttons
   * (Left/Right/Up/Down) page panels / targets; anything else closes.
   */
  handleInput(button: Button): boolean {
    if (!this.container) {
      return false;
    }
    switch (button) {
      case Btn.LEFT:
        this.panelIndex = (this.panelIndex - 1 + PANELS.length) % PANELS.length;
        this.render();
        return true;
      case Btn.RIGHT:
        this.panelIndex = (this.panelIndex + 1) % PANELS.length;
        this.render();
        return true;
      case Btn.UP:
      case Btn.DOWN: {
        const targets = this.getTargets();
        if (targets.length > 1) {
          const d = button === Btn.DOWN ? 1 : -1;
          this.targetIndex = (this.targetIndex + d + targets.length) % targets.length;
          this.render();
        }
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
    const W = 250;
    const c = globalScene.add.container(40, -H + 6).setDepth(1000);

    const scrim = globalScene.add.rectangle(0, 0, W, H - 12, 0x1a1a2e, 0.97).setOrigin(0, 0);
    c.add(scrim);

    const targets = this.getTargets();
    if (this.targetIndex >= targets.length) {
      this.targetIndex = 0;
    }
    const mon = targets[this.targetIndex];
    const panel = PANELS[this.panelIndex];

    // Header: panel title + nav hints.
    const title = addTextObject(6, 2, this.panelTitle(panel), TextStyle.SUMMARY_GOLD, { fontSize: "64px" });
    title.setOrigin(0, 0);
    c.add(title);
    const navHint = addTextObject(W - 4, 2, "◄ ► panel   ▲ ▼ mon   B close", TextStyle.SUMMARY, { fontSize: "40px" });
    navHint.setOrigin(1, 0);
    c.add(navHint);

    let y = 16;
    if (panel === "weather") {
      this.renderWeather(c, y);
    } else if (panel === "sides") {
      this.renderSides(c, y);
    } else if (mon) {
      // Per-Pokémon panels: show whose info this is.
      const who = addTextObject(
        6,
        y,
        `${mon.getNameToRender()}  Lv.${mon.level}${mon.isEnemy() ? "  (Foe)" : ""}`,
        TextStyle.SUMMARY,
        {
          fontSize: "56px",
        },
      );
      who.setOrigin(0, 0);
      c.add(who);
      y += 12;
      if (panel === "stats") {
        this.renderStats(c, y, mon);
      } else if (panel === "abilities") {
        this.renderAbilities(c, y, mon);
      } else if (panel === "moves") {
        this.renderMoves(c, y, mon);
      }
    }

    globalScene.ui.add(c);
    this.container = c;
  }

  private panelTitle(panel: PanelKind): string {
    switch (panel) {
      case "stats":
        return i18next.t("pokemonSummary:infoStats", { defaultValue: "Stats" });
      case "abilities":
        return i18next.t("pokemonSummary:abilities", { defaultValue: "Abilities" });
      case "moves":
        return i18next.t("pokemonSummary:infoMoves", { defaultValue: "Moves" });
      case "weather":
        return i18next.t("pokemonSummary:infoWeather", { defaultValue: "Weather" });
      case "sides":
        return i18next.t("pokemonSummary:infoSides", { defaultValue: "Field Effects" });
    }
  }

  private renderStats(c: Phaser.GameObjects.Container, y0: number, mon: Pokemon): void {
    // Types + held item + nature.
    const t1 = PokemonType[mon.getTypes()[0]];
    const t2 = mon.getTypes()[1] == null ? "" : `/${PokemonType[mon.getTypes()[1]]}`;
    const typeText = addTextObject(6, y0, `Type: ${t1}${t2}`, TextStyle.WINDOW_ALT, { fontSize: "48px" });
    typeText.setOrigin(0, 0);
    c.add(typeText);

    let y = y0 + 12;
    for (const row of STAT_ROWS) {
      const value = row.stat === Stat.HP ? `${mon.hp}/${mon.getMaxHp()}` : `${mon.getStat(row.stat)}`;
      const label = addTextObject(8, y, row.label, TextStyle.SUMMARY, { fontSize: "52px" });
      label.setOrigin(0, 0);
      c.add(label);
      const valText = addTextObject(70, y, value, TextStyle.WINDOW_ALT, { fontSize: "52px" });
      valText.setOrigin(0, 0);
      c.add(valText);
      // Stat-stage arrow (Atk/Def/SpA/SpD/Spe only).
      if (row.stat !== Stat.HP) {
        const stage = mon.getStatStage(row.stat as unknown as Parameters<typeof mon.getStatStage>[0]);
        if (stage !== 0) {
          const arrow = `${stage > 0 ? "▲" : "▼"}${Math.abs(stage)}`;
          const arrowText = addTextObject(150, y, arrow, TextStyle.SUMMARY, { fontSize: "52px" });
          arrowText.setOrigin(0, 0);
          arrowText.setColor(getTextColor(stage > 0 ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_RED));
          c.add(arrowText);
        }
      }
      y += 11;
    }

    const nature = addTextObject(
      8,
      y + 2,
      `Nature: ${getNatureName(mon.getNature(), true, false, true)}`,
      TextStyle.WINDOW_ALT,
      {
        fontSize: "44px",
      },
    );
    nature.setOrigin(0, 0);
    c.add(nature);
  }

  private renderAbilities(c: Phaser.GameObjects.Container, y0: number, mon: Pokemon): void {
    const rows: { label: string; abilityId: number }[] = [];
    const main = mon.getAbility(true);
    if (main) {
      rows.push({ label: i18next.t("pokemonSummary:abilityLabel"), abilityId: main.id });
    }
    const innateIds = mon.species.getPassiveAbilities(mon.formIndex);
    for (let slot = 0; slot < 3; slot++) {
      const id = innateIds[slot];
      if (id !== undefined && id !== AbilityId.NONE) {
        rows.push({ label: i18next.t("pokemonSummary:innateLabel"), abilityId: id });
      }
    }
    let y = y0;
    for (const r of rows) {
      const bar = globalScene.add.rectangle(2, y, 246, 11, 0x4a4a63, 1).setOrigin(0, 0);
      c.add(bar);
      const label = addTextObject(5, y, r.label, TextStyle.SUMMARY_GOLD, { fontSize: "52px" });
      label.setOrigin(0, 0);
      c.add(label);
      const name = addTextObject(56, y, allAbilities[r.abilityId]?.name ?? "", TextStyle.SUMMARY, { fontSize: "52px" });
      name.setOrigin(0, 0);
      c.add(name);
      const desc = getErAbilityDescription(r.abilityId) ?? allAbilities[r.abilityId]?.description ?? "";
      const descText = addTextObject(5, y + 11, desc, TextStyle.WINDOW_ALT, {
        fontSize: "44px",
        wordWrap: { width: 1400 },
      });
      descText.setOrigin(0, 0);
      c.add(descText);
      y += 11 + Math.max(11, descText.displayHeight) + 2;
    }
  }

  private renderMoves(c: Phaser.GameObjects.Container, y0: number, mon: Pokemon): void {
    const moves = mon.getMoveset();
    let y = y0;
    if (!moves || moves.length === 0) {
      const none = addTextObject(6, y, "—", TextStyle.WINDOW_ALT, { fontSize: "52px" });
      none.setOrigin(0, 0);
      c.add(none);
      return;
    }
    for (const pm of moves) {
      const m = pm?.getMove();
      if (!m) {
        continue;
      }
      const stab = mon.getTypes().includes(m.type);
      const bar = globalScene.add.rectangle(2, y, 246, 11, 0x3a5a3a, 1).setOrigin(0, 0);
      c.add(bar);
      const name = addTextObject(5, y, m.name, TextStyle.SUMMARY, { fontSize: "52px" });
      name.setOrigin(0, 0);
      c.add(name);
      const typeText = addTextObject(246, y, PokemonType[m.type], TextStyle.SUMMARY, { fontSize: "44px" });
      typeText.setOrigin(1, 0);
      c.add(typeText);
      const cat = MoveCategory[m.category];
      const detail = `Pow ${m.power < 0 ? "—" : m.power}  Acc ${m.accuracy < 0 ? "—" : m.accuracy}  ${cat}${stab ? "  STAB" : ""}`;
      const detailText = addTextObject(5, y + 10, detail, TextStyle.WINDOW_ALT, { fontSize: "42px" });
      detailText.setOrigin(0, 0);
      c.add(detailText);
      y += 22;
    }
  }

  private renderWeather(c: Phaser.GameObjects.Container, y0: number): void {
    const weather = globalScene.arena.weather;
    const wt = weather?.weatherType ?? WeatherType.NONE;
    const name = wt === WeatherType.NONE ? "Clear" : WeatherType[wt].replace(/_/g, " ");
    const head = addTextObject(6, y0, `Weather: ${name}`, TextStyle.SUMMARY, { fontSize: "56px" });
    head.setOrigin(0, 0);
    c.add(head);
    if (weather && wt !== WeatherType.NONE) {
      const turns = addTextObject(6, y0 + 12, `Turns left: ${weather.turnsLeft}`, TextStyle.WINDOW_ALT, {
        fontSize: "48px",
      });
      turns.setOrigin(0, 0);
      c.add(turns);
    }
  }

  private renderSides(c: Phaser.GameObjects.Container, y0: number): void {
    const tags = globalScene.arena.tags;
    let y = y0;
    for (const [sideLabel, side] of [
      ["Your side", ArenaTagSide.PLAYER],
      ["Foe side", ArenaTagSide.ENEMY],
      ["Field", ArenaTagSide.BOTH],
    ] as const) {
      const sideTags = tags.filter(t => t.side === side);
      const head = addTextObject(6, y, sideLabel, TextStyle.SUMMARY_GOLD, { fontSize: "52px" });
      head.setOrigin(0, 0);
      c.add(head);
      y += 11;
      if (sideTags.length === 0) {
        const none = addTextObject(12, y, "—", TextStyle.WINDOW_ALT, { fontSize: "44px" });
        none.setOrigin(0, 0);
        c.add(none);
        y += 10;
      } else {
        for (const t of sideTags) {
          const label = `${String(t.tagType).replace(/_/g, " ")}  (${t.turnCount} turns)`;
          const tagText = addTextObject(12, y, label, TextStyle.WINDOW_ALT, { fontSize: "44px" });
          tagText.setOrigin(0, 0);
          c.add(tagText);
          y += 10;
        }
      }
      y += 4;
    }
  }
}
