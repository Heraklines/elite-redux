import { TrainerType } from "../../../src/enums/trainer-type";

const VALID_TRAINER_CLASS_NAMES = new Set(Object.keys(TrainerType).filter(name => Number.isNaN(Number(name))));

/** Keep editor commits aligned with the runtime enum that resolves custom trainers. */
export function isValidTrainerClassName(value: unknown): value is string {
  return typeof value === "string" && VALID_TRAINER_CLASS_NAMES.has(value);
}
