import { globalScene } from "#app/global-scene";
import { fieldPositionForSlot } from "#data/battle-format";
import { BattlePhase } from "#phases/battle-phase";

/**
 * Multi-format (triple+) SHIFT: reposition two ACTIVE player Pokemon by swapping their field
 * slots. Unlike {@linkcode SwitchSummonPhase} this brings in NO benched mon - it is the SAME
 * two mons, just repositioned - so it triggers NO entry hazards, NO switch-in abilities, and
 * NO summon/return animation. The two party entries are swapped (so {@linkcode getPlayerField}
 * returns the new order) and BOTH mons' sprites + HP/info bars are moved to their new slots.
 *
 * Queued (like a switch) from {@linkcode TurnStartPhase} BEFORE any moves, so the shifter's
 * turn is consumed and the swapped-with ally still acts normally from its new position.
 */
export class ShiftSummonPhase extends BattlePhase {
  public readonly phaseName = "ShiftSummonPhase";
  private readonly fieldIndex: number;
  private readonly targetIndex: number;

  /**
   * @param fieldIndex - The field slot of the Pokemon issuing the shift (the shifter).
   * @param targetIndex - The field slot of the active ally to swap positions with.
   */
  constructor(fieldIndex: number, targetIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
    this.targetIndex = targetIndex;
  }

  start(): void {
    super.start();

    const party = globalScene.getPlayerParty();
    const shifter = party[this.fieldIndex];
    const ally = party[this.targetIndex];

    // Defensive: a malformed / stale shift (a mon fainted between command and resolution, or an
    // out-of-range slot) must never crash the turn. Bail cleanly if either side is missing.
    if (this.fieldIndex === this.targetIndex || !shifter?.isActive(true) || !ally?.isActive(true)) {
      this.end();
      return;
    }

    // Swap the two party entries so getPlayerField() reflects the new order (the same
    // `party[a] <-> party[b]` reorder a SwitchSummonPhase does, minus the summon pipeline).
    party[this.fieldIndex] = ally;
    party[this.targetIndex] = shifter;

    // Reposition BOTH mons' sprites + HP/info bars to the FieldPosition their new slot maps to.
    const capacity = globalScene.currentBattle.arrangement.playerCapacity;
    Promise.all([
      ally.setFieldPosition(fieldPositionForSlot(this.fieldIndex, capacity), 500),
      shifter.setFieldPosition(fieldPositionForSlot(this.targetIndex, capacity), 500),
    ]).then(() => this.end());
  }
}
