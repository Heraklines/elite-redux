import type { Challenge } from "#data/challenge";
import { copyChallenge } from "#data/challenge";

export class ChallengeData {
  public id: number;
  public value: number;
  public severity: number;
  /** ER (#384): UsageTier's grandfathered opening-party line roots, if any. */
  public startingRoots?: number[];

  constructor(source: Challenge | any) {
    this.id = source.id;
    this.value = source.value;
    this.severity = source.severity;
    this.startingRoots = source.startingRoots;
  }

  toChallenge(): Challenge {
    return copyChallenge(this);
  }
}
