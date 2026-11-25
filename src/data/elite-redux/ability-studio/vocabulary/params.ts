/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Typed parameter schemas shared by conditions, effects,
// guards and class declarations. The worker validates composition params against these.

export type ParamValue = string | number | boolean;

export type ParamControl = "number" | "slider" | "select" | "boolean" | "text";

export interface ParamDef {
  readonly id: string;
  readonly label: string;
  readonly control: ParamControl;
  readonly default: ParamValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Required for `select` controls. */
  readonly options?: readonly string[];
  /** Integer-only numbers (HP percentages, stages, counts). */
  readonly integer?: boolean;
  /** Select controls: the player-facing words of the choices that are not plain words already (PLAYER_OPTION_LABELS). */
  readonly optionLabels?: Readonly<Record<string, string>>;
}

/**
 * Player-facing words for the plain (lowercase) choice values that settings use, so a picker never shows a code word
 * such as "gte" or "holder-side" (spec 8.3). Enum constants (GROUND, HEAVY_RAIN) are renamed by playerName instead.
 * Only values with one clear meaning are listed here; a context-specific choice names its words in `optionLabels`.
 */
export const PLAYER_OPTION_LABELS: Readonly<Record<string, string>> = {
  holder: "The ability owner",
  other: "The other Pokemon",
  ally: "My ally",
  "any-foe": "Any foe",
  lt: "less than",
  lte: "at most",
  eq: "exactly",
  gte: "at least",
  gt: "more than",
  "holder-side": "My side of the field",
  "opposing-side": "The foes' side of the field",
  both: "Both sides of the field",
  self: "Myself",
  foe: "A foe",
  exact: "Exact HP (whole numbers)",
  "floor-half": "Rounded down to a whole HP",
  "rounded-ratio": "The game's two-decimal HP ratio",
  "damage-value": "Rounded down, never below 1 HP",
  entry: "Each time I enter",
  wave: "Each wave",
  battle: "Each battle",
  turn: "Each turn",
  switch: "Each switch-in",
  "switch-in": "Until I switch out",
  prefix: "Starts with this name",
  raised: "Went up",
  lowered: "Went down",
  single: "One target",
  "all-foes": "All foes",
  "all-others": "Everyone else",
  "user-or-ally": "The user or its ally",
  field: "The whole field",
  berry: "A berry",
};

export type ParamValues = Readonly<Record<string, ParamValue>>;

export function numberParam(
  id: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  integer = false,
): ParamDef {
  return { id, label, control: "number", default: def, min, max, step, integer };
}

export function sliderParam(
  id: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  integer = false,
): ParamDef {
  return { id, label, control: "slider", default: def, min, max, step, integer };
}

export function selectParam(
  id: string,
  label: string,
  options: readonly string[],
  def?: string,
  optionLabels?: Readonly<Record<string, string>>,
): ParamDef {
  const labels = Object.fromEntries(
    options.flatMap(option => {
      const words = optionLabels?.[option] ?? PLAYER_OPTION_LABELS[option];
      return words === undefined ? [] : [[option, words]];
    }),
  );
  return {
    id,
    label,
    control: "select",
    default: def ?? options[0],
    options,
    ...(Object.keys(labels).length > 0 ? { optionLabels: labels } : {}),
  };
}

export function booleanParam(id: string, label: string, def = false): ParamDef {
  return { id, label, control: "boolean", default: def };
}

export function textParam(id: string, label: string, def = ""): ParamDef {
  return { id, label, control: "text", default: def };
}

/** Fills in defaults for every param the caller did not give. Unknown keys are kept for validation. */
export function withParamDefaults(defs: readonly ParamDef[], values: ParamValues | undefined): ParamValues {
  const out: Record<string, ParamValue> = {};
  for (const def of defs) {
    out[def.id] = def.default;
  }
  return { ...out, ...(values ?? {}) };
}

/** Plain-language problems with `values` against `defs`; empty when valid. `owner` names the block. */
export function validateParamValues(
  owner: string,
  defs: readonly ParamDef[],
  values: ParamValues | undefined,
): string[] {
  const errors: string[] = [];
  const given = values ?? {};
  const known = new Set(defs.map(def => def.id));
  for (const key of Object.keys(given)) {
    if (!known.has(key)) {
      errors.push(`${owner} has no setting called "${key}"`);
    }
  }
  for (const def of defs) {
    const value = given[def.id];
    if (value === undefined) {
      continue;
    }
    switch (def.control) {
      case "number":
      case "slider": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`${owner}: "${def.label}" must be a number`);
          break;
        }
        if (def.integer === true && !Number.isInteger(value)) {
          errors.push(`${owner}: "${def.label}" must be a whole number`);
        }
        if (def.min !== undefined && value < def.min) {
          errors.push(`${owner}: "${def.label}" must be at least ${def.min}`);
        }
        if (def.max !== undefined && value > def.max) {
          errors.push(`${owner}: "${def.label}" must be at most ${def.max}`);
        }
        break;
      }
      case "select":
        if (typeof value !== "string" || !(def.options ?? []).includes(value)) {
          errors.push(`${owner}: "${def.label}" must be one of ${(def.options ?? []).join(", ")}`);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          errors.push(`${owner}: "${def.label}" must be yes or no`);
        }
        break;
      case "text":
        if (typeof value !== "string" || value.length > 120) {
          errors.push(`${owner}: "${def.label}" must be text of at most 120 characters`);
        }
        break;
    }
  }
  return errors;
}

/** Replaces `{param}` markers in a label template. Unknown markers are left as written. */
export function renderTemplate(template: string, values: ParamValues): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
