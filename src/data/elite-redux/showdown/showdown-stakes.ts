/**
 * Showdown stake valuation. Pure, engine-free.
 * Rule: shinies rank STRICTLY above every non-shiny.
 * Non-shiny tier = starter cost (1-10). Shiny tiers start at 100 + variant,
 * ER black shiny above all. Two offers may be wagered against each other
 * only when their tiers are EQUAL.
 */
/** DexAttr DEFAULT_VARIANT / VARIANT_2 / VARIANT_3 */
export type StakeVariant = 0 | 1 | 2;

export interface StakeOffer {
  speciesId: number;
  shiny: boolean;
  variant: StakeVariant;
  erBlackShiny: boolean;
  /** speciesStarterCosts value for the line (only meaningful when !shiny) */
  cost: number;
}

const SHINY_TIER_BASE = 100;
const BLACK_SHINY_TIER = SHINY_TIER_BASE + 10;

export function stakeTier(offer: StakeOffer): number {
  if (offer.erBlackShiny) {
    return BLACK_SHINY_TIER;
  }
  if (offer.shiny) {
    return SHINY_TIER_BASE + offer.variant;
  }
  return offer.cost;
}

export function stakesMatch(a: StakeOffer, b: StakeOffer): boolean {
  return stakeTier(a) === stakeTier(b);
}
