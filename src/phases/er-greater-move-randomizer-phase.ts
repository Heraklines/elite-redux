import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  getMoveRandomizerCandidates,
  MOVE_RANDOMIZER_CATEGORIES,
  type MoveRandomizerCategory,
  randomizePokemonMove,
} from "#data/elite-redux/er-move-randomizer";
import { MoveCategory } from "#enums/move-category";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import i18next from "i18next";

const CATEGORY_KEYS: Record<MoveRandomizerCategory, string> = {
  [MoveCategory.PHYSICAL]: "physical",
  [MoveCategory.SPECIAL]: "special",
  [MoveCategory.STATUS]: "status",
};

export class ErGreaterMoveRandomizerPhase extends Phase {
  public readonly phaseName = "ErGreaterMoveRandomizerPhase";
  public readonly partyIndex: number;
  public readonly moveIndex: number;
  private baseMode = UiMode.MESSAGE;

  constructor(partyIndex: number, moveIndex: number) {
    super();
    this.partyIndex = partyIndex;
    this.moveIndex = moveIndex;
  }

  start(): void {
    super.start();
    this.baseMode = globalScene.ui.getMode();
    const pokemon = globalScene.getPlayerParty()[this.partyIndex];
    if (pokemon == null || pokemon.getMoveset()[this.moveIndex] == null) {
      this.end();
      return;
    }
    this.openCategoryPicker(pokemon);
  }

  private openCategoryPicker(pokemon: PlayerPokemon): void {
    const categories = MOVE_RANDOMIZER_CATEGORIES.filter(
      category => getMoveRandomizerCandidates(pokemon, category).length > 0,
    );
    if (categories.length === 0) {
      this.restoreAndEnd();
      return;
    }

    const options: OptionSelectItem[] = categories.map(category => {
      const key = CATEGORY_KEYS[category];
      return {
        label: i18next.t(`modifierType:erGreaterMoveRandomizer.categories.${key}`),
        handler: () => {
          globalScene.ui.setMode(this.baseMode).then(() => {
            if (randomizePokemonMove(pokemon, this.moveIndex, category)) {
              globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
              this.end();
            } else {
              this.openCategoryPicker(pokemon);
            }
          });
          return true;
        },
      };
    });
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        this.restoreAndEnd();
        return true;
      },
    });

    globalScene.ui.setMode(UiMode.OPTION_SELECT, { options });
  }

  private restoreAndEnd(): void {
    globalScene.ui.setMode(this.baseMode).then(() => this.end());
  }
}
