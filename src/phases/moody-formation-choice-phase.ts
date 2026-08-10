import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { MoodyFormationFinalDraftEnding } from "#data/elite-redux/moody/moody-runtime-formation";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { UiMode } from "#enums/ui-mode";
import type { MoodyChoicePanelModel } from "#ui/moody/moody-presentation";

const LABELS: Record<MoodyFormationFinalDraftEnding, string> = {
  climax: "Climax",
  precision: "Precision",
  revision: "Revision",
};

export function buildMoodyFinalDraftChoiceModel(
  options: readonly MoodyFormationFinalDraftEnding[],
  chooseCount: 1 | 2,
  selectedCount: number,
  rankTwo = false,
): MoodyChoicePanelModel {
  const consequence =
    chooseCount === 2 ? "Consequence: after both endings resolve, the move is unusable for this battle." : undefined;
  return {
    title: "FINAL DRAFT",
    prompt:
      chooseCount === 1
        ? "Choose the ending for this move's final PP."
        : `Choose ending ${selectedCount + 1} of ${chooseCount} for this move's final PP.`,
    queueLabel: `Decision ${selectedCount + 1} / ${chooseCount}`,
    cancellable: false,
    options: options.map(option => {
      switch (option) {
        case "climax":
          return {
            id: option,
            label: LABELS[option],
            description: `This use gains ${rankTwo ? "130" : "100"}% power.`,
            ...(consequence == null ? {} : { costLine: consequence }),
          };
        case "precision":
          return {
            id: option,
            label: LABELS[option],
            description: `Perfect accuracy and a guaranteed eligible secondary effect${rankTwo ? ", plus 20% power" : ""}.`,
            ...(consequence == null ? {} : { costLine: consequence }),
          };
        case "revision":
          return {
            id: option,
            label: LABELS[option],
            description: `Use the move normally, then restore ${rankTwo ? "3" : "2"} PP.`,
            costLine: `Cost: 15% maximum HP.${consequence == null ? "" : ` ${consequence}`}`,
          };
      }
    }),
  };
}

export class MoodyFormationChoicePhase extends Phase {
  public readonly phaseName = "MoodyFormationChoicePhase";
  private readonly selected: MoodyFormationFinalDraftEnding[] = [];
  private readonly options: readonly MoodyFormationFinalDraftEnding[];
  private readonly chooseCount: 1 | 2;
  private readonly resolve: (selected: readonly MoodyFormationFinalDraftEnding[]) => void;
  private resolved = false;

  constructor(
    options: readonly MoodyFormationFinalDraftEnding[],
    chooseCount: 1 | 2,
    resolve: (selected: readonly MoodyFormationFinalDraftEnding[]) => void,
  ) {
    super();
    this.options = options;
    this.chooseCount = chooseCount;
    this.resolve = resolve;
  }

  public override start(): void {
    super.start();
    this.showOptions();
  }

  private showOptions(): void {
    const remaining = this.options.filter(option => !this.selected.includes(option));
    const rankTwo = getMoodyModeState()?.boons.find(boon => boon.boonId === "final-draft")?.rank === 2;
    void globalScene.ui
      .requestMoodyChoice(buildMoodyFinalDraftChoiceModel(remaining, this.chooseCount, this.selected.length, rankTwo))
      .then(option => {
        if (option == null) {
          this.end();
          return;
        }
        this.choose(option as MoodyFormationFinalDraftEnding);
      });
  }

  private choose(option: MoodyFormationFinalDraftEnding): boolean {
    if (this.resolved) {
      return true;
    }
    this.selected.push(option);
    if (this.selected.length < this.chooseCount) {
      this.showOptions();
      return true;
    }
    this.resolved = true;
    this.resolve(this.selected);
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
    return true;
  }
}
