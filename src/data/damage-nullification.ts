import type { NumberHolder } from "#utils/common";

/**
 * Tracks deliberate full damage nullifications through the remaining damage pipeline.
 *
 * A weak set keeps the marker scoped to the per-hit holder; later minimum-damage
 * calculations must not turn an ability-negated hit back into 1 HP.
 */
const fullyNullifiedDamage = new WeakSet<NumberHolder>();

export function markDamageNullified(damage: NumberHolder): void {
  fullyNullifiedDamage.add(damage);
}

export function isDamageNullified(damage: NumberHolder): boolean {
  return fullyNullifiedDamage.has(damage);
}
