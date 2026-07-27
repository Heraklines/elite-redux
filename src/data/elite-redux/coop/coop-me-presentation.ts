/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import type {
  CoopMeIntroSpritePresentation,
  CoopMeIntroVisualPresentation,
} from "#data/elite-redux/coop/coop-operation-envelope";

const MAX_COOP_ME_INTRO_SPRITES = 24;
const visualPresentationByEncounter = new WeakMap<object, CoopMeIntroVisualPresentation>();

/**
 * Capture the authority's resolved Mystery intro without executing any renderer-side encounter callback.
 * `MysteryEncounterIntroVisuals.spriteConfigs` is used instead of the template configs because onInit may
 * have selected a species/form/shiny/variant procedurally before the visual container was constructed.
 */
export function captureCoopMeIntroVisualPresentation(): CoopMeIntroVisualPresentation | null {
  const encounter = globalScene.currentBattle?.mysteryEncounter;
  const introVisuals = encounter?.introVisuals;
  if (encounter == null) {
    return null;
  }
  if (introVisuals == null) {
    const retained = visualPresentationByEncounter.get(encounter);
    return retained == null ? null : structuredClone(retained);
  }
  if (introVisuals.spriteConfigs.length > MAX_COOP_ME_INTRO_SPRITES) {
    return null;
  }
  // `species` is an authority-side generation hint. The constructed container has already resolved it
  // into spriteKey/form/shiny/variant, so carrying the hint would let the renderer resolve mechanics data
  // a second time instead of rendering the exact committed result.
  const spriteConfigs = introVisuals.spriteConfigs.map(config => {
    const { species: _species, ...resolved } = config;
    return JSON.parse(JSON.stringify(resolved)) as CoopMeIntroSpritePresentation;
  });
  const presentation = {
    spriteConfigs,
    enterFromRight: introVisuals.enterFromRight,
    x: introVisuals.x,
    y: introVisuals.y,
    alpha: introVisuals.alpha,
    visible: introVisuals.visible,
  };
  visualPresentationByEncounter.set(encounter, presentation);
  return structuredClone(presentation);
}

function optionalFinite(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

/** Strict decoder shared by V2 commit, wire admission, DATA apply, and projection. */
export function isCoopMeIntroVisualPresentation(value: unknown): value is CoopMeIntroVisualPresentation {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const visual = value as Record<string, unknown>;
  if (
    typeof visual.enterFromRight !== "boolean"
    || typeof visual.x !== "number"
    || !Number.isFinite(visual.x)
    || typeof visual.y !== "number"
    || !Number.isFinite(visual.y)
    || typeof visual.alpha !== "number"
    || !Number.isFinite(visual.alpha)
    || typeof visual.visible !== "boolean"
    || !Array.isArray(visual.spriteConfigs)
    || visual.spriteConfigs.length > MAX_COOP_ME_INTRO_SPRITES
  ) {
    return false;
  }
  return visual.spriteConfigs.every(candidate => {
    if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false;
    }
    const config = candidate as Record<string, unknown>;
    return (
      typeof config.spriteKey === "string"
      && config.spriteKey.length <= 160
      && typeof config.fileRoot === "string"
      && config.fileRoot.length <= 160
      && optionalFinite(config.formIndex)
      && optionalBoolean(config.hasShadow)
      && optionalBoolean(config.disableAnimation)
      && optionalBoolean(config.repeat)
      && optionalFinite(config.startFrame)
      && optionalBoolean(config.hidden)
      && optionalFinite(config.tint)
      && optionalFinite(config.x)
      && optionalFinite(config.y)
      && optionalFinite(config.yShadow)
      && optionalFinite(config.scale)
      && optionalBoolean(config.isPokemon)
      && optionalBoolean(config.isShiny)
      && optionalFinite(config.variant)
      && optionalBoolean(config.isItem)
      && optionalFinite(config.alpha)
    );
  });
}
