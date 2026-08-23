import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { allMoves } from "#data/data-lists";
import type { MoodyRuntimeCommand } from "#data/elite-redux/moody/moody-runtime-field";
import type { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { MoodyChoicePanelModel } from "#ui/moody/moody-presentation";

function choiceLabel(command: MoodyRuntimeCommand, option: string): string {
  if (command.kind === "request-temporary-move-choice") {
    return allMoves[Number(option) as MoveId]?.name ?? option;
  }
  if (option === "none") {
    return "Clear";
  }
  return option.replace(/[_-]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function prompt(command: MoodyRuntimeCommand, subjectName?: string): string {
  if (command.kind === "request-weather-choice") {
    return `Choose the weather Microclimate creates${subjectName == null ? "" : ` for ${subjectName}`}.`;
  }
  if (command.kind === "request-terrain-choice") {
    return `Choose the terrain Terrain Weaver creates${subjectName == null ? "" : ` for ${subjectName}`}.`;
  }
  return `Choose the move ${subjectName == null ? "" : `${subjectName} `}inherits through Last Rites.`;
}

function queueLabel(command: MoodyRuntimeCommand): string {
  const queueIndex = command.data?.queueIndex;
  const queueTotal = command.data?.queueTotal;
  if (typeof queueIndex === "number" && typeof queueTotal === "number" && queueTotal > 0) {
    return `Decision ${Math.max(1, Math.floor(queueIndex))} / ${Math.floor(queueTotal)}`;
  }
  return "Decision 1 / 1";
}

export function buildMoodyRuntimeChoiceModel(
  command: MoodyRuntimeCommand,
  subjectName?: string,
): MoodyChoicePanelModel {
  const duration = Math.max(1, Math.floor(command.durationTurns ?? 1));
  const grantCount = Math.max(1, Math.floor(command.amount ?? 1));
  const options = (command.options ?? []).map(option => {
    const label = choiceLabel(command, option);
    if (command.kind === "request-weather-choice") {
      return {
        id: option,
        label,
        description: `Create ${label} weather for ${duration} turn${duration === 1 ? "" : "s"}.`,
        costLine: "Consequence: replaces the current weather.",
      };
    }
    if (command.kind === "request-terrain-choice") {
      return {
        id: option,
        label,
        description: `Create ${label} terrain for ${duration} turn${duration === 1 ? "" : "s"}.`,
        costLine: "Consequence: replaces the current terrain.",
      };
    }
    return {
      id: option,
      label,
      description: `Add ${label} as a temporary move with ${grantCount} use${grantCount === 1 ? "" : "s"}.`,
      costLine: "Consequence: the borrowed move expires after this battle.",
    };
  });
  return {
    title:
      command.kind === "request-weather-choice"
        ? "MICROCLIMATE"
        : command.kind === "request-terrain-choice"
          ? "TERRAIN WEAVER"
          : "LAST RITES",
    prompt: prompt(command, subjectName),
    queueLabel: queueLabel(command),
    cancellable: false,
    options,
  };
}

export class MoodyRuntimeChoicePhase extends Phase {
  public readonly phaseName = "MoodyRuntimeChoicePhase";
  private resolved = false;

  constructor(
    private readonly command: MoodyRuntimeCommand,
    private readonly select: (option: string) => void,
  ) {
    super();
  }

  public override start(): void {
    super.start();
    const options = this.command.options ?? [];
    if (options.length === 0) {
      this.end();
      return;
    }
    const subject = this.command.subjectId == null ? undefined : globalScene.getPokemonById(this.command.subjectId);
    void globalScene.ui
      .requestMoodyChoice(buildMoodyRuntimeChoiceModel(this.command, subject?.getNameToRender()))
      .then(option => {
        if (option == null) {
          this.end();
          return;
        }
        this.choose(option);
      });
  }

  private choose(option: string): boolean {
    if (this.resolved) {
      return true;
    }
    this.resolved = true;
    this.select(option);
    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
    return true;
  }
}
