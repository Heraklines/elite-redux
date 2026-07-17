import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";
import { getErGhostSnapshot, markTrainerAsGhost } from "#data/elite-redux/er-ghost-teams";
import type { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";

export class TrainerData {
  public trainerType: TrainerType;
  public variant: TrainerVariant;
  public partyTemplateIndex: number;
  public nameKey: string;
  public partnerNameKey: string | undefined;
  /**
   * ER (#ghost-identity): the cross-player GHOST snapshot backing this trainer, when it
   * is a fielded ghost. The ghost's name/BGM/authored presentation live ONLY in an
   * in-memory WeakMap (`GHOST_BY_TRAINER`) that a save/reload wipes, so a mid ghost-battle
   * reload kept the party but reverted to a plain NPC name, music, and dialogue. Persisting
   * the snapshot here (it is already a JSON-safe network payload) and re-applying it in
   * {@linkcode toTrainer} restores the full ghost presentation. Absent for ordinary trainers.
   */
  public ghost: GhostTeamSnapshot | undefined;

  constructor(source: Trainer | any) {
    const sourceTrainer = source instanceof Trainer ? (source as Trainer) : null;
    this.trainerType = sourceTrainer ? sourceTrainer.config.trainerType : source.trainerType;
    this.variant = Object.hasOwn(source, "variant")
      ? source.variant
      : source.female
        ? TrainerVariant.FEMALE
        : TrainerVariant.DEFAULT;
    this.partyTemplateIndex = source.partyMemberTemplateIndex;
    this.nameKey = source.nameKey;
    this.partnerNameKey = source.partnerNameKey;
    // Live Trainer -> read the snapshot out of the WeakMap; deserialised save data ->
    // carry the persisted snapshot verbatim (re-sanitised on apply in toTrainer).
    this.ghost = sourceTrainer ? (getErGhostSnapshot(sourceTrainer) ?? undefined) : source.ghost;
  }

  toTrainer(): Trainer {
    const trainer = new Trainer(
      this.trainerType,
      this.variant,
      this.partyTemplateIndex,
      this.nameKey,
      this.partnerNameKey,
    );
    // ER (#ghost-identity): re-apply the persisted ghost snapshot so a reloaded ghost
    // battle keeps its name, piano BGM, and authored presentation. markTrainerAsGhost
    // re-registers the WeakMap entry and re-sanitises the (untrusted-peer) presentation.
    if (this.ghost) {
      markTrainerAsGhost(trainer, this.ghost);
    }
    return trainer;
  }
}
