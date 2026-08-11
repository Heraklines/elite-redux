import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { getMoodyBoonsForPokemon, MOODY_BOON_BY_ID } from "#data/elite-redux/moody/moody-state";
import { UiMode } from "#enums/ui-mode";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { MoodyOperationModel, MoodyOperationResult } from "#ui/moody/moody-operation";

export type MoodyHunterChoice = "damageBonus" | "resistanceBonus" | "captureBonus";

const HUNTER_LABELS: Readonly<Record<MoodyHunterChoice, string>> = {
  damageBonus: "+15% damage against marked types",
  resistanceBonus: "+15% resistance to marked-type attacks",
  captureBonus: "+15% capture effectiveness for marked types",
};

export class MoodyCoordinatorChoicePhase extends Phase {
  public readonly phaseName = "MoodyCoordinatorChoicePhase";
  private resolved = false;
  private readonly choices: readonly MoodyHunterChoice[];
  private readonly resolve: (choice: MoodyHunterChoice) => void;

  constructor(choices: readonly MoodyHunterChoice[], resolve: (choice: MoodyHunterChoice) => void) {
    super();
    this.choices = choices;
    this.resolve = resolve;
  }

  public override start(): void {
    super.start();
    if (this.choices.length === 0) {
      this.end();
      return;
    }
    globalScene.ui.showText("Choose Hunter's Mark's permanent reward.", null, () => {
      const options: OptionSelectItem[] = this.choices.map(choice => ({
        label: HUNTER_LABELS[choice],
        handler: () => this.choose(choice),
      }));
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options }).catch(() => this.end());
    });
  }

  private choose(choice: MoodyHunterChoice): boolean {
    if (this.resolved) {
      return true;
    }
    this.resolved = true;
    this.resolve(choice);
    globalScene.ui.setMode(UiMode.MESSAGE).then(
      () => this.end(),
      () => this.end(),
    );
    return true;
  }
}

export class MoodyCoordinatorConfirmPhase extends Phase {
  public readonly phaseName = "MoodyCoordinatorConfirmPhase";
  private resolved = false;
  private readonly prompt: string;
  private readonly accept: () => void;
  private readonly decline: () => void;

  constructor(prompt: string, accept: () => void, decline: () => void) {
    super();
    this.prompt = prompt;
    this.accept = accept;
    this.decline = decline;
  }

  public override start(): void {
    super.start();
    globalScene.ui.showText(this.prompt, null, () => {
      const options: OptionSelectItem[] = [
        { label: "Yes", handler: () => this.choose(true) },
        { label: "No", handler: () => this.choose(false) },
      ];
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options }).catch(() => this.end());
    });
  }

  private choose(accepted: boolean): boolean {
    if (this.resolved) {
      return true;
    }
    this.resolved = true;
    (accepted ? this.accept : this.decline)();
    globalScene.ui.setMode(UiMode.MESSAGE).then(
      () => this.end(),
      () => this.end(),
    );
    return true;
  }
}

export class MoodyCoordinatorStringChoicePhase extends Phase {
  public readonly phaseName = "MoodyCoordinatorChoicePhase";
  private resolved = false;

  constructor(
    private readonly prompt: string,
    private readonly choices: readonly { readonly id: string; readonly label: string }[],
    private readonly resolve: (choiceId: string) => void,
  ) {
    super();
  }

  public override start(): void {
    super.start();
    if (this.choices.length === 0) {
      this.end();
      return;
    }
    globalScene.ui.showText(this.prompt, null, () => {
      const options: OptionSelectItem[] = this.choices.map(choice => ({
        label: choice.label,
        handler: () => this.choose(choice.id),
      }));
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options }).catch(() => this.end());
    });
  }

  private choose(choiceId: string): boolean {
    if (this.resolved) {
      return true;
    }
    this.resolved = true;
    this.resolve(choiceId);
    globalScene.ui.setMode(UiMode.MESSAGE).then(
      () => this.end(),
      () => this.end(),
    );
    return true;
  }
}

export class MoodyCoordinatorPokemonChoicePhase extends Phase {
  public readonly phaseName = "MoodyCoordinatorPokemonChoicePhase";
  private resolved = false;

  constructor(
    private readonly title: string,
    private readonly preview: string,
    private readonly resolve: (pokemonId: number, partySlot: number) => void,
  ) {
    super();
  }

  public override start(): void {
    super.start();
    const party = globalScene.getPlayerParty();
    if (party.length === 0) {
      this.end();
      return;
    }
    void globalScene.ui
      .requestMoodyTarget({
        title: this.title,
        hint: "Choose one party Pokemon.",
        allowCancel: false,
        options: party.map((pokemon, partySlot) => ({
          id: pokemon.id,
          label: pokemon.getNameToRender(),
          detail: `Lv${pokemon.level}`,
          eligible: true,
          attachments: getMoodyBoonsForPokemon(pokemon.id, partySlot).map(
            boon => MOODY_BOON_BY_ID.get(boon.boonId)?.name ?? boon.boonId,
          ),
          preview: this.preview,
        })),
      })
      .then(pokemonId => {
        if (typeof pokemonId !== "number" || this.resolved) {
          this.end();
          return;
        }
        const partySlot = party.findIndex(pokemon => pokemon.id === pokemonId);
        if (partySlot < 0) {
          this.end();
          return;
        }
        this.resolved = true;
        this.resolve(pokemonId, partySlot);
        this.end();
      })
      .catch(() => this.end());
  }
}

export class MoodyCoordinatorOperationPhase extends Phase {
  public readonly phaseName = "MoodyCoordinatorOperationPhase";
  private resolved = false;

  constructor(
    private readonly model: MoodyOperationModel,
    private readonly resolve: (result: MoodyOperationResult) => void | Promise<void>,
  ) {
    super();
  }

  public override start(): void {
    super.start();
    void globalScene.ui
      .requestMoodyOperation(this.model)
      .then(async result => {
        if (this.resolved) {
          return;
        }
        this.resolved = true;
        await this.resolve(result);
        this.end();
      })
      .catch(() => this.end());
  }
}
