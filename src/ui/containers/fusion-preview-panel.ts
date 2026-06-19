import { globalScene } from "#app/global-scene";
import { CustomPokemonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { getStatKey, PERMANENT_STATS } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import type { PlayerPokemon } from "#field/pokemon";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import { toTitleCase } from "#utils/strings";
import i18next from "i18next";

// --- Panel geometry (logical px; the container is right-aligned on the party
// screen). All tunable - eyeball on staging. The UI container origin is
// BOTTOM-left (positive y = down / off-screen), so the panel container is
// shifted UP by ~canvas height and children use positive offsets (the same
// trick LearnMoveBatchUiHandler uses). ---
const PANEL_W = 156;
const PANEL_H = 176;
const RIGHT_MARGIN = 2;
const TOP_MARGIN = 3;

const SPRITE_X = 42;
const SPRITE_Y = 54;
const SPRITE_SCALE = 0.55;

const INFO_X = 80; // name/types column, right of the sprite
const NAME_Y = 30;
const TYPES_Y = 44;

const STATS_X0 = 10; // HP / Atk / Def column
const STATS_X1 = 84; // SpA / SpD / Spe column
const STATS_Y = 84;
const STATS_ROW_H = 11;
const STATS_VALUE_DX = 64;

const ABIL_LABEL_Y = 122;
const ABIL_Y = 132;
const ABIL_ROW_H = 10;

const HINT_Y = PANEL_H - 8;

/** A cached blended-sprite render for one partner (keyed by partner id). */
interface SpriteCacheEntry {
  spriteKey: string;
  spriteColors: number[][];
  fusionSpriteColors: number[][];
}

/**
 * Live preview panel for the DNA Splicers fusion flow (#558/#559). Sits on the
 * right of the party screen during {@linkcode PartyUiMode.SPLICE} and, given a
 * LOCKED base mon + the currently-hovered partner, shows what their fusion would
 * be - the blended two-tone sprite, the fused base stats, and the four fused
 * abilities - WITHOUT committing the fusion.
 *
 * Faithfulness: a throwaway clone of the base mon (built once when the base is
 * locked, re-fused as the partner changes) supplies the abilities/types/name via
 * the real getters; the base stats are the raw `ceil((A+B)/2)` average (no
 * held-item contamination); the blended sprite is produced by `loadAssets` ->
 * `updateFusionPalette` on the clone and copied here. Nothing mutates the real
 * party mons, and the clone never calls `fuse()`.
 */
export class FusionPreviewPanel {
  private container: Phaser.GameObjects.Container;
  private titleText: Phaser.GameObjects.Text;
  private switchHint: Phaser.GameObjects.Text;
  private sprite: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private typesText: Phaser.GameObjects.Text;
  private statLabels: Phaser.GameObjects.Text[] = [];
  private statValues: Phaser.GameObjects.Text[] = [];
  private abilityLabel: Phaser.GameObjects.Text;
  private abilityTexts: Phaser.GameObjects.Text[] = [];
  private placeholderText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;

  /** The clone of the locked base mon (re-fused per partner). */
  private clone: PlayerPokemon | null = null;
  private baseId = -1;
  /** Per-partner blended-sprite cache so re-hovering a partner is instant. */
  private spriteCache = new Map<number, SpriteCacheEntry>();
  /** Bumped on every render so a stale async sprite load never overwrites. */
  private renderToken = 0;
  private built = false;

  setup(): void {
    const sc = globalScene.scaledCanvas;
    const winX = sc.width - PANEL_W - RIGHT_MARGIN;
    const winY = TOP_MARGIN - sc.height;
    this.container = globalScene.add.container(winX, winY);
    this.container.setVisible(false);
    globalScene.ui.add(this.container);

    this.container.add(addWindow(0, 0, PANEL_W, PANEL_H));

    this.titleText = addTextObject(6, 4, i18next.t("partyUiHandler:fusionPreviewTitle"), TextStyle.WINDOW_ALT);
    this.switchHint = addTextObject(PANEL_W - 6, 4, i18next.t("partyUiHandler:fusionPreviewSwitch"), TextStyle.WINDOW);
    this.switchHint.setOrigin(1, 0);
    this.container.add([this.titleText, this.switchHint]);

    this.sprite = globalScene.initPokemonSprite(
      globalScene.add.sprite(SPRITE_X, SPRITE_Y, "pkmn__sub"),
      undefined,
      false,
      true,
    );
    this.sprite.setScale(SPRITE_SCALE);
    this.container.add(this.sprite);

    this.nameText = addTextObject(INFO_X, NAME_Y, "", TextStyle.WINDOW, {
      wordWrap: { width: (PANEL_W - INFO_X - 4) * 6 },
    });
    this.typesText = addTextObject(INFO_X, TYPES_Y, "", TextStyle.WINDOW_ALT);
    this.container.add([this.nameText, this.typesText]);

    // Six base-stat cells (2 cols x 3 rows), mirroring the summary stats page.
    PERMANENT_STATS.forEach((stat, s) => {
      const col = Math.floor(s / 3);
      const row = s % 3;
      const colX = col === 0 ? STATS_X0 : STATS_X1;
      const y = STATS_Y + row * STATS_ROW_H;
      const label = addTextObject(colX, y, i18next.t(getStatKey(stat)), TextStyle.SUMMARY_STATS).setOrigin(0, 0);
      const value = addTextObject(colX + STATS_VALUE_DX, y, "0", TextStyle.WINDOW_ALT).setOrigin(1, 0);
      this.statLabels.push(label);
      this.statValues.push(value);
      this.container.add([label, value]);
    });

    this.abilityLabel = addTextObject(
      STATS_X0,
      ABIL_LABEL_Y,
      i18next.t("partyUiHandler:fusionPreviewAbilities"),
      TextStyle.SUMMARY_GOLD,
    );
    this.container.add(this.abilityLabel);
    // Four ability rows: [base active, absorbed innate, base innate, absorbed innate].
    for (let i = 0; i < 4; i++) {
      const t = addTextObject(STATS_X0, ABIL_Y + i * ABIL_ROW_H, "", TextStyle.WINDOW);
      this.abilityTexts.push(t);
      this.container.add(t);
    }

    this.hintText = addTextObject(
      PANEL_W / 2,
      HINT_Y,
      i18next.t("partyUiHandler:fusionPreviewHint"),
      TextStyle.WINDOW_ALT,
    );
    this.hintText.setOrigin(0.5, 0);
    this.container.add(this.hintText);

    // Shown when the cursor is not on a valid partner (the base itself / cancel).
    this.placeholderText = addTextObject(
      PANEL_W / 2,
      PANEL_H / 2,
      i18next.t("partyUiHandler:fusionPreviewPick"),
      TextStyle.WINDOW,
      { wordWrap: { width: (PANEL_W - 16) * 6 } },
    );
    this.placeholderText.setOrigin(0.5, 0.5);
    this.placeholderText.setVisible(false);
    this.container.add(this.placeholderText);

    this.built = true;
  }

  isBuilt(): boolean {
    return this.built;
  }

  /** Lock a new base mon - (re)builds the throwaway clone and clears caches. */
  setBase(base: PlayerPokemon): void {
    if (this.baseId === base.id && this.clone) {
      return;
    }
    this.destroyClone();
    // Clone the base mon (dataSource = base) WITHOUT a PokemonData round-trip,
    // which would pull a cyclic import (noImportCycles). This standalone mon is
    // never added to the party; it's re-fused per partner and destroyed on teardown.
    this.clone = globalScene.addPlayerPokemon(
      base.species,
      base.level,
      base.abilityIndex,
      base.formIndex,
      base.gender,
      base.shiny,
      base.variant,
      base.ivs,
      base.nature,
      base,
    );
    this.baseId = base.id;
    this.spriteCache.clear();
  }

  /**
   * Render the panel for `base` fused with `partner`. Text (name/types/stats/
   * abilities) updates synchronously; the blended sprite loads async and is
   * race-guarded + cached.
   */
  show(base: PlayerPokemon, partner: PlayerPokemon): void {
    this.setBase(base);
    const clone = this.clone;
    if (!clone) {
      return;
    }
    this.container.setVisible(true);
    this.placeholderText.setVisible(false);
    this.setRowsVisible(true);

    // Re-fuse the clone onto this partner (mirrors PlayerPokemon.fuse's field
    // writes, WITHOUT any of its side effects - no party splice, no destroy).
    clone.fusionSpecies = partner.species;
    clone.fusionFormIndex = partner.formIndex;
    clone.fusionAbilityIndex = partner.abilityIndex;
    clone.fusionShiny = partner.shiny;
    clone.fusionVariant = partner.variant;
    clone.fusionGender = partner.gender;
    clone.fusionLuck = partner.luck;
    clone.fusionCustomPokemonData = new CustomPokemonData(partner.customPokemonData);
    clone.generateName();

    this.nameText.setText(clone.getNameToRender({ useIllusion: false }));
    this.renderTypes(clone);
    this.renderStats(base, partner);
    this.renderAbilities(clone);
    this.renderSprite(partner);
  }

  /** Cursor is not on a fusible partner: keep the frame, show a prompt. */
  showPlaceholder(): void {
    this.container.setVisible(true);
    this.setRowsVisible(false);
    this.placeholderText.setVisible(true);
    this.renderToken++; // cancel any in-flight sprite load
  }

  hide(): void {
    if (!this.built) {
      return;
    }
    this.container.setVisible(false);
    this.renderToken++;
  }

  /** Full teardown - destroy the clone + caches (call on leaving SPLICE). */
  teardown(): void {
    this.hide();
    this.destroyClone();
    this.baseId = -1;
    this.spriteCache.clear();
  }

  private setRowsVisible(visible: boolean): void {
    this.sprite.setVisible(visible);
    this.nameText.setVisible(visible);
    this.typesText.setVisible(visible);
    this.abilityLabel.setVisible(visible);
    for (const t of [...this.statLabels, ...this.statValues, ...this.abilityTexts]) {
      t.setVisible(visible);
    }
  }

  private renderTypes(clone: PlayerPokemon): void {
    const types = clone.getTypes(false, false, true);
    const names = types.filter(t => t !== PokemonType.UNKNOWN).map(t => toTitleCase(PokemonType[t]));
    // Drop a duplicated single type (mono-type fusions list one).
    const unique = names.filter((n, i) => names.indexOf(n) === i);
    this.typesText.setText(unique.join(" / "));
  }

  /** Raw fused base stats: ceil((baseA + baseB) / 2) per stat (no item mods). */
  private renderStats(base: PlayerPokemon, partner: PlayerPokemon): void {
    const a = base.getSpeciesForm(true).baseStats;
    const b = partner.getSpeciesForm(true).baseStats;
    PERMANENT_STATS.forEach((stat, i) => {
      const fused = Math.ceil((a[stat] + b[stat]) / 2);
      this.statValues[i].setText(fused.toString());
    });
  }

  /**
   * The four fused abilities in display order: slot 1 = base's active ability,
   * slot 2 = absorbed's first innate, slot 3 = base's second innate, slot 4 =
   * absorbed's third innate (matches `resolveDerivedPassiveIds`). Read off the
   * clone so per-slot overrides are honored.
   */
  private renderAbilities(clone: PlayerPokemon): void {
    const rows: (string | null)[] = [];
    rows.push(clone.getAbility(true).name);
    const passives = clone.getPassiveAbilities();
    for (let i = 0; i < 3; i++) {
      const ab = passives[i];
      rows.push(ab && ab.id !== AbilityId.NONE ? ab.name : null);
    }
    this.abilityTexts.forEach((t, i) => {
      const name = rows[i];
      t.setText(name ? `${i + 1}. ${name}` : `${i + 1}. -`);
    });
  }

  private renderSprite(partner: PlayerPokemon): void {
    const token = ++this.renderToken;
    const cached = this.spriteCache.get(partner.id);
    if (cached) {
      this.applySprite(cached);
      return;
    }
    const clone = this.clone;
    if (!clone) {
      return;
    }
    clone
      .loadAssets()
      .then(() => {
        if (token !== this.renderToken || this.clone !== clone) {
          return; // partner changed / torn down mid-load
        }
        const source = clone.getSprite();
        const entry: SpriteCacheEntry = {
          spriteKey: clone.getSpriteKey(true),
          spriteColors: source?.pipelineData["spriteColors"],
          fusionSpriteColors: source?.pipelineData["fusionSpriteColors"],
        };
        this.spriteCache.set(partner.id, entry);
        this.applySprite(entry);
      })
      .catch(e => console.error("[fusion-preview] sprite load failed", e));
  }

  private applySprite(entry: SpriteCacheEntry): void {
    if (globalScene.textures.exists(entry.spriteKey)) {
      this.sprite.setTexture(entry.spriteKey);
    }
    try {
      this.sprite.play(entry.spriteKey);
    } catch (e) {
      console.error(`[fusion-preview] failed to play ${entry.spriteKey}`, e);
    }
    this.sprite.setPipelineData("spriteKey", entry.spriteKey).setPipelineData("ignoreTimeTint", true);
    this.sprite.pipelineData["spriteColors"] = entry.spriteColors;
    this.sprite.pipelineData["fusionSpriteColors"] = entry.fusionSpriteColors;
  }

  private destroyClone(): void {
    if (this.clone) {
      this.clone.destroy();
      this.clone = null;
    }
  }
}
