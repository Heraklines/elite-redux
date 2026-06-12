import type { ObjectValues } from "#types/type-helpers";

export const GachaType = Object.freeze({
  MOVE: 0,
  LEGENDARY: 1,
  SHINY: 2,
  /** Elite Redux (#409): the "Redux Up" machine - boosted odds for ER customs. */
  REDUX: 3,
});

export type GachaType = ObjectValues<typeof GachaType>;
