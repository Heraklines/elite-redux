import type { ErRewardRateBreakdown } from "#data/elite-redux/er-reward-rates";

/**
 * Visualizing tier for an Elite Redux reward-rate row. Every rung carries a
 * shape signal in addition to a colour so colour is never the only indicator.
 */
export interface ErRewardRateGrade {
  /** 0-based rung index; also drives frame treatments in the panel. */
  level: number;
  /** Human-readable tier used by tooltips and accessibility text. */
  name: string;
  /** Base grade colour; the value text renders near-bright regardless. */
  color: number;
}

export type ErRewardRateKind = "shiny" | "candy" | "voucher";

export const ER_REWARD_RATE_ROWS: readonly ErRewardRateKind[] = Object.freeze(["shiny", "candy", "voucher"]);

/** Semantic hue per row (degrees). Shared with the aura shader. */
export const ER_REWARD_RATE_HUES: Readonly<Record<ErRewardRateKind, number>> = Object.freeze({
  shiny: 48,
  candy: 145,
  voucher: 286,
});

// Shape → colour ladder; see REWARD-RATE PANEL SPEC. `level` doubles as the
// flag driver for frame passes: level >= 6 (rate 10+) starts corner accents,
// level >= 9 (rate 30+) upgrades them, level 10 (40+) adds the outer rim,
// level 11 (50) swaps the core to the void finish. Colour is never the only
// signal — each rung also carries its own glyph silhouette via the level.
const ER_REWARD_RATE_GRADES: readonly (ErRewardRateGrade & { min: number })[] = Object.freeze([
  { min: 0, level: 0, name: "Dormant", color: 0x5a6068 }, // graphite — flat baseline
  { min: 1, level: 1, name: "Silver", color: 0xc8ccd4 }, // silver — single pip
  { min: 2, level: 2, name: "Sprout", color: 0x7dd87d }, // green — rising pip
  { min: 3, level: 3, name: "Azure", color: 0x6ba8f0 }, // blue — triangle notch
  { min: 4, level: 4, name: "Amethyst", color: 0xb478f0 }, // purple, rerun through x5
  { min: 6, level: 5, name: "Gilded", color: 0xf0c040 }, // gold chevron, rerun through x9
  { min: 10, level: 6, name: "Ember", color: 0xf08838 }, // orange — corner accents begin
  { min: 15, level: 7, name: "Crimson", color: 0xe85050 }, // red
  { min: 20, level: 8, name: "Prismatic+", color: 0xe060c8 }, // magenta
  { min: 30, level: 9, name: "Luminous", color: 0xffffff }, // prismatic cycling + sparks
  { min: 40, level: 10, name: "Stellar", color: 0xa8e8ff }, // stellar double rim
]);

const ECLIPSE_GRADE: ErRewardRateGrade = Object.freeze({ level: 11, name: "Eclipse", color: 0x7468f8 });

/** Resolves the visual grade rung for a rate total (x50 capped at Eclipse). */
export function getErRewardRateGrade(total: number): ErRewardRateGrade {
  const rate = Math.max(0, Math.floor(total));
  if (rate >= 50) {
    return ECLIPSE_GRADE;
  }
  for (let i = ER_REWARD_RATE_GRADES.length - 1; i >= 0; i--) {
    if (rate >= ER_REWARD_RATE_GRADES[i].min) {
      return ER_REWARD_RATE_GRADES[i];
    }
  }
  return ER_REWARD_RATE_GRADES[0];
}

/** Formats a rate total for the fixed value column; zero renders as a dash. */
export function formatErRewardRate(total: number): string {
  const rate = Math.max(0, Math.floor(total));
  return rate === 0 ? "—" : `×${rate}`;
}

const ROW_LABELS: Readonly<Record<ErRewardRateKind, string>> = Object.freeze({
  shiny: "Shiny",
  candy: "Candy",
  voucher: "Voucher",
});

const DIFFICULTY_LABELS: Readonly<Record<ErRewardRateBreakdown["difficulty"], string>> = Object.freeze({
  youngster: "Youngster",
  ace: "Ace",
  elite: "Elite",
  hell: "Hell",
  mystery: "Hell",
});

/**
 * Builds the tooltip for one reward-rate row from the authoritative
 * {@linkcode ErRewardRateBreakdown}. Challenge Favour applies to shiny and
 * candy rates only; the voucher row states that Favour does not apply.
 */
export function getErRewardRateRowTooltip(
  kind: ErRewardRateKind,
  rates: ErRewardRateBreakdown,
): { title: string; content: string } {
  const base = kind === "shiny" ? rates.baseShiny : kind === "candy" ? rates.baseCandy : rates.baseVoucher;
  const total = kind === "shiny" ? rates.totalShiny : kind === "candy" ? rates.totalCandy : rates.totalVoucher;
  const appliesFavour = kind !== "voucher";

  const title = `${ROW_LABELS[kind]} ${formatErRewardRate(total)}`;
  const lines = [
    `${DIFFICULTY_LABELS[rates.difficulty]} depth rate: ×${base}`,
    appliesFavour ? `Favour: ×${rates.favourMultiplier}` : "Favour: not applied",
    `Endless: +${rates.endlessBonus}`,
    `Total: ${formatErRewardRate(total)}`,
  ];
  return { title, content: lines.join("\n") };
}
