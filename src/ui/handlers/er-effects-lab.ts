/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - the EFFECTS LAB section of the Shiny Lab.
//
// A separate section reached by the "Effects" button above the shiny option area.
// Where the shiny section designs a mon's LOOK, the Effects Lab PREVIEWS the FX the
// maintainer introduces - move effects, transformation effects, ability effects -
// so a reworked effect can be eyeballed on demand before it ships.
//
// STRUCTURE = a data-driven list of CATEGORIES. Only "Transformation Effects" ships
// today, but the whole section is driven by {@linkcode ER_EFFECTS_LAB_CATEGORIES}:
// a category is just a descriptor `{ id, label, buildView }`. Adding an ability- or
// move-effect category later is ONE new entry with its own `buildView` - NO edit to
// the Shiny Lab handler's section/nav plumbing. That is the extension point: each
// future category can carry its own requirements + preview surface behind the shared
// `ErEffectsLabView` interface.
//
// The one shipping category, Transformation Effects, lets the player pick any
// (partner) Eeveelution and watch the per-type transform burst
// ({@linkcode playErTransformFx}) play on that evolution's FRONT and BACK sprite,
// replayable on demand. The evolution list is DERIVED FROM the live Omniform
// registration (never hardcoded), so every future partner evolution appears
// automatically.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { playErPokemonSpriteAnim } from "#data/elite-redux/er-form-sprite-redirect";
import { ER_PARTNER_FAMILY } from "#data/elite-redux/er-newcomer-species";
import type { PokemonSpecies, PokemonSpeciesForm } from "#data/pokemon-species";
import { Button } from "#enums/buttons";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { type ErFormTransformFx, playErTransformFx } from "#sprites/er-form-transform-fx";
import { OmniformEvolutionStrip } from "#ui/omniform-evolution-strip";
import type { OmniformEvolutionEntry } from "#ui/omniform-evolution-view";
import { addTextObject } from "#ui/text";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** The vanilla Eevee "partner" form key - the Omniform family HEAD is this form. */
const PARTNER_FORM_KEY = "partner";

const INK = "#e8ecf6";
const DIM = "#8b93a8";
const ACCENT = "#a6e9ff";

// -----------------------------------------------------------------------------
// Evolution-list derivation (registration-derived, never hardcoded).
// -----------------------------------------------------------------------------

/** The vanilla Eevee "partner" form index (-1 if the form is not registered). */
function partnerHeadFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === PARTNER_FORM_KEY);
}

/** Build a display entry for the strip from a resolved species + form. */
function makeEntry(
  species: PokemonSpecies,
  form: PokemonSpeciesForm,
  formIndex: number,
  nameOverride?: string,
): OmniformEvolutionEntry {
  const formName = species.forms?.[formIndex]?.formName;
  const base = species.getName();
  const name = nameOverride || (formName ? `${base} (${formName})` : base);
  return {
    speciesId: species.speciesId,
    formIndex,
    species,
    form,
    name,
    activeAbilityId: form.getAbility(0) ?? form.ability1,
    innateAbilityIds: form.getPassiveAbilities(formIndex),
    // The lab has no battle-active form, so nothing is marked "current".
    isCurrent: false,
  };
}

/**
 * The ordered Transformation-Effect evolution list, DERIVED FROM the partner /
 * Omniform REGISTRATION (never hardcoded): the Partner Eevee head (the vanilla Eevee
 * "partner" form) followed by every entry in {@linkcode ER_PARTNER_FAMILY} - the same
 * registration table that drives the Omniform mappings. Because that table GROWS as
 * partner evolutions are added, every future one appears here automatically with no
 * edit. Empty when the head form is not registered (registration has not run).
 *
 * Consolidation note: `omniform-evolution-view.ts` has an equivalent Pokemon-anchored
 * derivation (`getOmniformEvolutions`); this Pokemon-free variant exists because the
 * lab has no live mon. If that module later exports a Pokemon-free family accessor,
 * this can delegate to it.
 */
export function getErTransformEffectEvolutions(): OmniformEvolutionEntry[] {
  const headIdx = partnerHeadFormIndex();
  if (headIdx < 0) {
    return [];
  }
  const eevee = getPokemonSpecies(SpeciesId.EEVEE);
  const entries: OmniformEvolutionEntry[] = [makeEntry(eevee, eevee.forms[headIdx], headIdx)];
  for (const def of ER_PARTNER_FAMILY) {
    const species = getPokemonSpecies(def.partnerId as SpeciesId);
    if (!species) {
      continue;
    }
    const form = species.forms?.[0] ?? species;
    entries.push(makeEntry(species, form, 0, def.name));
  }
  return entries;
}

// -----------------------------------------------------------------------------
// Category registry (the data-driven extension point).
// -----------------------------------------------------------------------------

/** A live, interactive view for one Effects-Lab category. Built on demand by a category. */
export interface ErEffectsLabView {
  /** Handle a directional/action button; return true when consumed. */
  handleInput(button: Button): boolean;
  /** The context-hint line taught at the bottom while this view is active. */
  getHint(): string;
  /** Tear down every owned object + any live FX (idempotent, safe to call early). */
  destroy(): void;
}

/** Where/how a category view builds itself (parent container + the body rect it may draw in). */
export interface ErEffectsLabViewContext {
  /** Parent container (effects-section body space; children use its local logical coords). */
  readonly parent: Phaser.GameObjects.Container;
  /** The body rectangle the view may draw within, in logical px. */
  readonly bounds: { x: number; y: number; w: number; h: number };
}

/**
 * A CATEGORY of previewable effects. The Effects Lab renders the list of these and
 * builds the selected one's view. Adding a category later (ability effects, move
 * effects) is a new entry here with its own `buildView` - no handler surgery.
 */
export interface ErEffectsLabCategory {
  /** Stable id (for tests / persistence). */
  readonly id: string;
  /** Short player-facing label (no em dashes). */
  readonly label: string;
  /** Build the interactive view for this category into `ctx.parent`. */
  buildView(ctx: ErEffectsLabViewContext): ErEffectsLabView;
}

/**
 * THE registry. Only "Transformation Effects" ships today. To add a category, push
 * a new descriptor with its own `buildView`; the Shiny Lab's Effects section picks
 * it up with no further change (it iterates this list for the category column and
 * delegates all preview + input to the built view).
 */
export const ER_EFFECTS_LAB_CATEGORIES: readonly ErEffectsLabCategory[] = [
  {
    id: "transformation",
    label: "Transformation Effects",
    buildView: ctx => new TransformationEffectsView(ctx),
  },
];

// -----------------------------------------------------------------------------
// Transformation Effects view.
// -----------------------------------------------------------------------------

const SPRITE_MAX_H = 84;

/**
 * Preview the per-type transform burst on any (partner) Eeveelution's FRONT or BACK
 * sprite. Owns an evolution strip (the reusable {@linkcode OmniformEvolutionStrip}),
 * a preview sprite, and a live {@linkcode ErFormTransformFx} burst. Input:
 *   - Left/Right : previous / next evolution
 *   - Up/Down    : toggle FRONT / BACK sprite
 *   - A          : replay the burst
 * Every path that changes the selection/side re-plays the burst and destroys the
 * prior one first, so no burst tween/timer is ever left orphaned.
 */
class TransformationEffectsView implements ErEffectsLabView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly entries: OmniformEvolutionEntry[];
  private readonly strip: OmniformEvolutionStrip | null = null;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly sideText: Phaser.GameObjects.Text;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly emptyText: Phaser.GameObjects.Text;
  private readonly cx: number;
  private readonly cy: number;
  private back = false;
  private burst: ErFormTransformFx | null = null;
  private destroyed = false;
  private retryCount = 0;

  constructor(ctx: ErEffectsLabViewContext) {
    const { parent, bounds } = ctx;
    this.root = globalScene.add.container(0, 0);
    parent.add(this.root);
    this.entries = getErTransformEffectEvolutions();
    this.cx = bounds.x + bounds.w / 2;
    this.cy = bounds.y + 78;

    // Preview sprite (added first so the strip chrome stays legible above it).
    this.sprite = globalScene.add.sprite(this.cx, this.cy, "unknown");
    this.sprite.setOrigin(0.5, 0.5).setVisible(false);
    this.root.add(this.sprite);

    // FRONT/BACK indicator + selected-evolution name.
    this.sideText = addTextObject(bounds.x + 4, bounds.y + bounds.h - 26, "", TextStyle.WINDOW, { fontSize: "36px" });
    this.sideText.setOrigin(0, 0).setColor(ACCENT);
    this.root.add(this.sideText);
    this.nameText = addTextObject(bounds.x + bounds.w - 4, bounds.y + bounds.h - 26, "", TextStyle.WINDOW, {
      fontSize: "36px",
      align: "right",
    });
    this.nameText.setOrigin(1, 0).setColor(INK);
    this.root.add(this.nameText);

    // Empty-state fallback (registration not run / no family) so the view never blanks.
    this.emptyText = addTextObject(this.cx, this.cy, "No transform effects registered", TextStyle.WINDOW, {
      fontSize: "40px",
      align: "center",
    });
    this.emptyText
      .setOrigin(0.5, 0.5)
      .setColor(DIM)
      .setVisible(this.entries.length === 0);
    this.root.add(this.emptyText);

    if (this.entries.length > 0) {
      this.strip = new OmniformEvolutionStrip(this.root, this.entries, 0, {
        x: bounds.x + 4,
        y: bounds.y + 2,
        windowSize: 5,
        onChange: () => this.onSelectionChanged(),
      });
      this.showSprite();
    }
  }

  getHint(): string {
    if (this.entries.length === 0) {
      return "B Back";
    }
    return "L/R Evolution    U/D Front/Back    A Replay    B Back";
  }

  handleInput(button: Button): boolean {
    if (!this.strip) {
      return false;
    }
    switch (button) {
      case Button.LEFT:
        this.strip.cycle(-1);
        return true;
      case Button.RIGHT:
        this.strip.cycle(1);
        return true;
      case Button.UP:
      case Button.DOWN:
        this.toggleSide();
        return true;
      case Button.ACTION:
        this.replay();
        return true;
      default:
        return false;
    }
  }

  private selected(): OmniformEvolutionEntry | null {
    return this.strip?.getSelectedEntry() ?? null;
  }

  private onSelectionChanged(): void {
    globalScene.ui.playSelect();
    this.retryCount = 0;
    this.showSprite();
  }

  private toggleSide(): void {
    this.back = !this.back;
    globalScene.ui.playSelect();
    this.retryCount = 0;
    this.showSprite();
  }

  private replay(): void {
    const entry = this.selected();
    if (!entry) {
      return;
    }
    globalScene.ui.playSelect();
    this.playBurst(entry);
  }

  /** Resolve + show the selected evolution's front/back sprite, then play the burst. */
  private showSprite(): void {
    const entry = this.selected();
    if (!entry) {
      return;
    }
    const species = entry.species;
    const key = species.getSpriteKey(false, entry.formIndex, false, 0, this.back);
    this.refreshLabels(entry);

    const apply = () => {
      if (this.destroyed || this.selected() !== entry) {
        return;
      }
      if (!globalScene.textures.exists(key)) {
        if (this.retryCount++ < 10) {
          globalScene.time.delayedCall(50, apply);
        }
        return;
      }
      playErPokemonSpriteAnim(this.sprite, key);
      this.fitSprite();
      this.sprite.setVisible(true);
      this.playBurst(entry);
    };

    if (globalScene.textures.exists(key)) {
      apply();
    } else {
      this.sprite.setVisible(false);
    }
    species
      .loadAssets(false, entry.formIndex, false, 0, true, this.back, true)
      .then(apply)
      .catch(() => {});
  }

  private fitSprite(): void {
    this.sprite.setScale(1);
    const sh = this.sprite.height || 1;
    this.sprite.setScale(sh > SPRITE_MAX_H ? SPRITE_MAX_H / sh : 1);
  }

  private refreshLabels(entry: OmniformEvolutionEntry): void {
    this.sideText.setText(this.back ? "BACK" : "FRONT");
    const total = this.entries.length;
    const idx = this.strip?.getSelectedIndex() ?? 0;
    this.nameText.setText(`${entry.name}  (${idx + 1}/${total})`);
  }

  /** Play the type-tinted burst over the preview sprite, tearing down any prior burst. */
  private playBurst(entry: OmniformEvolutionEntry): void {
    this.burst?.destroy();
    this.burst = null;
    if (this.destroyed) {
      return;
    }
    const type1 = entry.form.type1 ?? entry.species.type1;
    this.burst = playErTransformFx({ x: this.cx, y: this.cy, getSprite: () => ({ x: 0, y: 0 }) }, type1, {
      parent: this.root,
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.burst?.destroy();
    this.burst = null;
    this.strip?.destroy();
    this.sprite.stop();
    this.root.destroy();
  }
}
