import { globalScene } from "#app/global-scene";
import { starterColors } from "#app/global-vars/starter-colors";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { allMoves } from "#data/data-lists";
import { getEggTierForSpecies } from "#data/egg";
import type { EggHatchData } from "#data/egg-hatch-data";
import { ensureErSpriteAnim, playErPokemonSpriteAnim } from "#data/elite-redux/er-form-sprite-redirect";
import { Gender } from "#data/gender";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import type { PlayerPokemon } from "#field/pokemon";
import {
  ErShinyLabSpriteFxOverlay,
  type ErShinyLabSpriteSourceRef,
  getErShinyLabPokemonSpriteSource,
  getErShinyLabSpriteFxLookForPokemon,
  getErShinyLabSpriteFxTime,
  hasErShinyLabAnySpriteFx,
  hasErShinyLabExactSpriteFx,
} from "#sprites/er-shiny-lab-sprite-fx";
import { addTextObject, updateCandyCountTextStyle } from "#ui/text";
import { argbFromRgba, rgbHexToRgba } from "#utils/color-utils";
import { padInt } from "#utils/common";
import { getDexNumber } from "#utils/pokemon-utils";
import { PokemonInfoContainer } from "./pokemon-info-container";

/**
 * Class for the hatch info summary of each pokemon
 * Holds an info container as well as an additional egg sprite, name, egg moves and main sprite
 */
export class PokemonHatchInfoContainer extends PokemonInfoContainer {
  private currentPokemonSprite: Phaser.GameObjects.Sprite;
  /** Bumped on every displayPokemon() so out-of-order async loads can't apply a stale sprite. */
  private displayToken = 0;
  /** The Pokemon currently shown, so the Shiny Lab FX timer can re-render its look. */
  private currentPokemon: PlayerPokemon | null = null;
  private shinyLabFxOverlay: ErShinyLabSpriteFxOverlay | null = null;
  private shinyLabFxTimer: Phaser.Time.TimerEvent | null = null;
  private shinyLabSpriteLoadKey: string | null = null;
  private pokemonNumberText: Phaser.GameObjects.Text;
  private pokemonNameText: Phaser.GameObjects.Text;
  private pokemonEggMovesContainer: Phaser.GameObjects.Container;
  private pokemonEggMoveContainers: Phaser.GameObjects.Container[];
  private pokemonEggMoveBgs: Phaser.GameObjects.NineSlice[];
  private pokemonEggMoveLabels: Phaser.GameObjects.Text[];
  private pokemonHatchedIcon: Phaser.GameObjects.Sprite;
  private pokemonListContainer: Phaser.GameObjects.Container;
  private pokemonCandyIcon: Phaser.GameObjects.Sprite;
  private pokemonCandyOverlayIcon: Phaser.GameObjects.Sprite;
  private pokemonCandyCountText: Phaser.GameObjects.Text;

  constructor(listContainer: Phaser.GameObjects.Container, x = 115, y = 9) {
    super(x, y);
    this.pokemonListContainer = listContainer;
  }

  setup(): this {
    super.setup();
    super.changeToEggSummaryLayout();

    this.currentPokemonSprite = globalScene.add
      .sprite(54, 80, "pkmn__sub")
      .setScale(0.8)
      .setPipeline(globalScene.spritePipeline, {
        tone: [0.0, 0.0, 0.0, 0.0],
        ignoreTimeTint: true,
      });

    // setup name and number
    this.pokemonNumberText = addTextObject(84, 107, "0000", TextStyle.EGG_SUMMARY_DEX, { fontSize: 78 }) //
      .setOrigin(0);
    this.pokemonNameText = addTextObject(7, 109, "", TextStyle.EGG_SUMMARY_NAME, { fontSize: 64 }) //
      .setOrigin(0);

    // setup egg icon and candy count
    this.pokemonHatchedIcon = globalScene.add //
      .sprite(-5, 90, "egg_icons")
      .setOrigin(0, 0.2)
      .setScale(0.8);
    this.pokemonCandyIcon = globalScene.add //
      .sprite(4.5, 40, "candy")
      .setScale(0.5)
      .setOrigin(0);
    this.pokemonCandyOverlayIcon = globalScene.add //
      .sprite(4.5, 40, "candy_overlay")
      .setScale(0.5)
      .setOrigin(0);
    this.pokemonCandyCountText = addTextObject(14, 40, "x0", TextStyle.SUMMARY, { fontSize: "56px" }) //
      .setOrigin(0);

    // Shiny Lab equipped-look overlay: a second sprite layered over the card sprite
    // that carries the palette / surface / around FX (the egg-hatch summary card was
    // the one surface where the equipped look never rendered).
    this.shinyLabFxOverlay = new ErShinyLabSpriteFxOverlay(this.currentPokemonSprite, "egg-hatch-shiny-lab-fx");
    this.shinyLabFxOverlay.getSprite().setVisible(false);

    this.pokemonListContainer.add([
      this.currentPokemonSprite,
      this.shinyLabFxOverlay.getSprite(),
      this.pokemonNumberText,
      this.pokemonNameText,
      this.pokemonHatchedIcon,
      this.pokemonCandyIcon,
      this.pokemonCandyOverlayIcon,
      this.pokemonCandyCountText,
    ]);

    // setup egg moves
    this.pokemonEggMoveContainers = [];
    this.pokemonEggMoveBgs = [];
    this.pokemonEggMoveLabels = [];
    this.pokemonEggMovesContainer = globalScene.add //
      .container(0, 200)
      .setVisible(false)
      .setScale(0.5);

    for (let m = 0; m < 4; m++) {
      const eggMoveContainer = globalScene.add.container(0, 0 + 6 * m);

      const eggMoveBg = globalScene.add //
        .nineslice(70, 0, "type_bgs", "unknown", 92, 14, 2, 2, 2, 2)
        .setOrigin(1, 0);

      const eggMoveLabel = addTextObject(70 - eggMoveBg.width / 2, 0, "???", TextStyle.MOVE_LABEL) //
        .setOrigin(0.5, 0);

      this.pokemonEggMoveBgs.push(eggMoveBg);
      this.pokemonEggMoveLabels.push(eggMoveLabel);

      eggMoveContainer
        .add([eggMoveBg, eggMoveLabel]) //
        .setScale(0.44);

      this.pokemonEggMoveContainers.push(eggMoveContainer);

      this.pokemonEggMovesContainer.add(eggMoveContainer);
    }

    super.add(this.pokemonEggMoveContainers);

    return this;
  }

  /**
   * Disable the sprite (and replace with substitute)
   */
  hideDisplayPokemon() {
    this.currentPokemonSprite.setVisible(false);
    this.currentPokemon = null;
    this.stopShinyLabFxTimer();
    this.shinyLabFxOverlay?.hide(false);
  }

  /**
   * Display a given pokemon sprite with animations
   * assumes the specific pokemon sprite has already been loaded
   */
  displayPokemon(pokemon: PlayerPokemon) {
    const species = pokemon.species;
    const female = pokemon.gender === Gender.FEMALE;
    const formIndex = pokemon.formIndex;
    const shiny = pokemon.shiny;
    const variant = pokemon.variant;
    this.currentPokemon = pokemon;
    this.currentPokemonSprite.setVisible(false);
    this.shinyLabFxOverlay?.hide(false);
    this.stopShinyLabFxTimer();
    // Guard against the rapid-cycling race: when the player flips between
    // hatched Pokémon quickly, an earlier (slower) loadAssets can resolve AFTER
    // a later one and play the wrong sprite, leaving it stuck on a previous
    // Pokémon. Only the latest displayPokemon() call may apply its sprite.
    const token = ++this.displayToken;
    const spriteKey = species.getSpriteKey(female, formIndex, shiny, variant);
    // spriteOnly: load just the sprite (no cry audio) so the display is fast
    // during rapid cycling — the pile-up of .m4a cries otherwise saturates the
    // loader and lags sprites for seconds. The cry is loaded separately below.
    species.loadAssets(female, formIndex, shiny, variant, true, false, true).then(() => {
      if (token !== this.displayToken) {
        return;
      }
      // Pin frame 0001 + gap-fill the anim so a multi-frame packed ER atlas never
      // renders as its raw whole-sheet __BASE frame on the egg-summary card.
      playErPokemonSpriteAnim(this.currentPokemonSprite, spriteKey);
      this.currentPokemonSprite.setPipelineData("shiny", shiny);
      this.currentPokemonSprite.setPipelineData("variant", variant);
      this.currentPokemonSprite.setPipelineData("spriteKey", spriteKey);
      this.currentPokemonSprite.setVisible(true);
      this.refreshShinyLabFx();
    });
    // Note: the per-entry cry is intentionally not played here. It would require
    // loading the .m4a (re-introducing the loader backlog that lags sprites) and
    // is cacophonous during rapid cycling; the cry already plays in the hatch
    // animation itself.
  }

  /**
   * Render (or hide) the equipped Shiny Lab look over the current card sprite. Mirrors the
   * summary-page surface: an owned palette/surface/around look composites onto a second sprite
   * layered over the base one, and animated looks (surface / around) tick via a 100ms timer.
   */
  private refreshShinyLabFx(): void {
    const pokemon = this.currentPokemon;
    if (!pokemon || !this.shinyLabFxOverlay) {
      return;
    }
    const look = getErShinyLabSpriteFxLookForPokemon(pokemon);
    if (!hasErShinyLabAnySpriteFx(look)) {
      this.shinyLabFxOverlay.hide();
      this.stopShinyLabFxTimer();
      return;
    }
    const baseSource = getErShinyLabPokemonSpriteSource(pokemon, true, look);
    // A palette look renders from the BASE sprite, which may not be loaded yet (only the
    // shiny card sprite was played) - fetch it, then re-refresh from the completion handler.
    if (!globalScene.textures.exists(baseSource.key)) {
      this.ensureShinyLabHatchSpriteLoaded(baseSource);
      return;
    }
    const frame =
      this.currentPokemonSprite.texture.key === baseSource.key ? this.currentPokemonSprite.frame?.name : null;
    const source = frame == null ? baseSource : { ...baseSource, frame };
    if (this.shinyLabFxOverlay.refresh(look, source, getErShinyLabSpriteFxTime())) {
      this.currentPokemonSprite.setVisible(false);
      if (hasErShinyLabExactSpriteFx(look)) {
        this.startShinyLabFxTimer();
      } else {
        this.stopShinyLabFxTimer();
      }
    } else {
      this.shinyLabFxOverlay.hide();
      this.stopShinyLabFxTimer();
    }
  }

  /** Load the base sprite atlas a palette look renders from, then re-refresh the FX. */
  private ensureShinyLabHatchSpriteLoaded(source: ErShinyLabSpriteSourceRef): void {
    if (globalScene.textures.exists(source.key)) {
      ensureErSpriteAnim(source.key);
      this.refreshShinyLabFx();
      return;
    }
    if (!source.atlasPath || this.shinyLabSpriteLoadKey === source.key) {
      return;
    }
    this.shinyLabSpriteLoadKey = source.key;
    const completeEvent = `filecomplete-atlasjson-${source.key}`;
    const cleanup = (): void => {
      globalScene.load.off(completeEvent, onComplete);
      globalScene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      if (this.shinyLabSpriteLoadKey === source.key) {
        this.shinyLabSpriteLoadKey = null;
      }
    };
    const onComplete = (): void => {
      cleanup();
      if (this.currentPokemon) {
        ensureErSpriteAnim(source.key);
        this.refreshShinyLabFx();
      }
    };
    const onError = (file: Phaser.Loader.File): void => {
      if (file.key !== source.key) {
        return;
      }
      cleanup();
    };
    globalScene.load.on(completeEvent, onComplete);
    globalScene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    globalScene.loadPokemonAtlas(source.key, source.atlasPath);
    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }
    // The atlas may already have landed between the initial check and listener registration.
    if (globalScene.textures.exists(source.key)) {
      cleanup();
      ensureErSpriteAnim(source.key);
      this.refreshShinyLabFx();
    }
  }

  private startShinyLabFxTimer(): void {
    if (this.shinyLabFxTimer) {
      return;
    }
    this.shinyLabFxTimer = globalScene.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        if (!this.currentPokemon) {
          return;
        }
        this.refreshShinyLabFx();
      },
    });
  }

  private stopShinyLabFxTimer(): void {
    this.shinyLabFxTimer?.remove();
    this.shinyLabFxTimer = null;
  }

  /**
   * Updates the info container with the appropriate dex data and starter entry from the hatchInfo
   * Also updates the displayed name, number, egg moves and main animated sprite for the pokemon
   * @param hatchInfo The EggHatchData of the pokemon / new hatch to show
   */
  showHatchInfo(hatchInfo: EggHatchData) {
    this.pokemonEggMovesContainer.setVisible(true);

    const pokemon = hatchInfo.pokemon;
    const species = pokemon.species;
    this.displayPokemon(pokemon);

    super.show(pokemon, false, 1, hatchInfo.getDex(), hatchInfo.getStarterEntry(), true);
    // ER custom species (id >= 10000) aren't pre-populated in starterColors;
    // default to white so the candy icon tint doesn't crash on undefined.
    if (!starterColors[species.speciesId]) {
      starterColors[species.speciesId] = ["ffffff", "ffffff"];
    }
    const colorScheme = starterColors[species.speciesId];

    this.pokemonCandyIcon.setTint(argbFromRgba(rgbHexToRgba(colorScheme[0])));
    this.pokemonCandyIcon.setVisible(true);
    this.pokemonCandyOverlayIcon.setTint(argbFromRgba(rgbHexToRgba(colorScheme[1])));
    this.pokemonCandyOverlayIcon.setVisible(true);
    this.pokemonCandyCountText.setText(`×${globalScene.gameData.starterData[species.speciesId].candyCount}`);
    updateCandyCountTextStyle(
      this.pokemonCandyCountText,
      globalScene.gameData.starterData[species.speciesId].candyCount,
      TextStyle.SUMMARY,
      TextStyle.SUMMARY,
    );
    this.pokemonCandyCountText.setVisible(true);
    this.pokemonNumberText.setText(padInt(getDexNumber(species.speciesId), 4));
    this.pokemonNameText.setText(species.name);

    const hasEggMoves = species && Object.hasOwn(speciesEggMoves, species.speciesId);

    for (let em = 0; em < 4; em++) {
      const eggMove = hasEggMoves ? allMoves[speciesEggMoves[species.speciesId][em]] : null;
      const eggMoveUnlocked = eggMove && globalScene.gameData.starterData[species.speciesId].eggMoves & Math.pow(2, em);
      this.pokemonEggMoveBgs[em].setFrame(
        PokemonType[eggMove ? eggMove.type : PokemonType.UNKNOWN].toString().toLowerCase(),
      );

      this.pokemonEggMoveLabels[em].setText(eggMove && eggMoveUnlocked ? eggMove.name : "???");
      if (!(eggMove && hatchInfo.starterDataEntryBeforeUpdate.eggMoves & Math.pow(2, em)) && eggMoveUnlocked) {
        this.pokemonEggMoveLabels[em].setText("(+) " + eggMove.name);
      }
    }

    // will always have at least one egg move
    this.pokemonEggMovesContainer.setVisible(true);

    if (species.speciesId === SpeciesId.MANAPHY || species.speciesId === SpeciesId.PHIONE) {
      this.pokemonHatchedIcon.setFrame("manaphy");
    } else {
      this.pokemonHatchedIcon.setFrame(getEggTierForSpecies(species));
    }
  }
}
