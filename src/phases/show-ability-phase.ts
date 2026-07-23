import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { recordCoopEvent } from "#data/elite-redux/coop/coop-turn-recorder";
import type { BattlerIndex } from "#enums/battler-index";
import type { Pokemon } from "#field/pokemon";
import { PokemonPhase } from "#phases/pokemon-phase";

export class ShowAbilityPhase extends PokemonPhase {
  public readonly phaseName = "ShowAbilityPhase";
  private readonly passive: boolean;
  /**
   * Passive-source index for this display. Slots 0-2 are ER innates; later
   * indexes are shared GIFT sources. Ignored when {@linkcode passive} is false.
   */
  private readonly passiveSlot: number;
  private readonly pokemonName: string;
  private readonly abilityName: string;
  private readonly abilityId: number;
  private readonly pokemonId: number;
  private readonly partySlot: number;
  private readonly pokemonOnField: boolean;

  constructor(battlerIndex: BattlerIndex, passive = false, passiveSlot = 0) {
    super(battlerIndex);

    this.passive = passive;
    this.passiveSlot = passiveSlot;

    const pokemon = this.getPokemon();
    if (pokemon) {
      // Set these now as the pokemon object may change before the queued phase is run
      this.pokemonName = getPokemonNameWithAffix(pokemon);
      // ER 3-passive: resolve the ability via the slot-indexed array so the bar
      // displays the correct ability name when the trigger came from slot 1 or 2.
      // For slot 0 with a legacy single-passive species, getPassiveAbilities()[0]
      // mirrors getPassiveAbility() exactly (see Pokemon.getPassiveAbilities()).
      const ability = passive ? this.getPokemon().getPassiveAbilities()[passiveSlot] : this.getPokemon().getAbility();
      // If the slot is empty (null), there's nothing to display. We still mark
      // the pokemon as on-field so start() runs end() through the early-return.
      this.abilityName = ability?.name ?? "";
      this.abilityId = ability?.id ?? 0;
      this.pokemonId = pokemon.id;
      const party: readonly Pokemon[] = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
      this.partySlot = party.indexOf(pokemon);
      this.pokemonOnField = true;
    } else {
      this.pokemonName = "";
      this.abilityName = "";
      this.abilityId = 0;
      this.pokemonId = 0;
      this.partySlot = -1;
      this.pokemonOnField = false;
    }
  }

  /** Read-only exact presentation identity used by the sealed two-browser oracle. */
  public getCoopPresentationIdentity() {
    return {
      source: "ability" as const,
      pokemonId: this.pokemonId,
      partySlot: this.partySlot,
      abilityId: this.abilityId,
      passive: this.passive,
      passiveSlot: this.passiveSlot,
    };
  }

  start() {
    super.start();

    if (!this.pokemonOnField || !this.getPokemon()) {
      return this.end();
    }

    // ER 3-passive: an empty slot has no ability name to display — skip the bar.
    if (!this.abilityName) {
      return this.end();
    }

    // If the bar is already out, hide it before showing the new one
    if (globalScene.abilityBar.isVisible()) {
      globalScene.phaseManager.unshiftNew("HideAbilityPhase");
      globalScene.phaseManager.unshiftNew("ShowAbilityPhase", this.battlerIndex, this.passive, this.passiveSlot);
      return this.end();
    }

    const pokemon = this.getPokemon();
    // Record at the actual flyout boundary (after the visible-bar requeue guard) so one host display
    // produces exactly one ordered event. IDs plus side-local party order, never localized labels, let
    // every renderer identify the same switch-in before the following authoritative checkpoint.
    if (this.partySlot >= 0) {
      recordCoopEvent({
        k: "showAbility",
        bi: this.battlerIndex,
        pokemonId: this.pokemonId,
        actor: { side: pokemon.isPlayer() ? "player" : "enemy", pokemonId: this.pokemonId },
        partySlot: this.partySlot,
        abilityId: this.abilityId,
        passive: this.passive,
        passiveSlot: this.passiveSlot,
      });
    }

    if (pokemon.isPlayer()) {
      globalScene.currentBattle.lastPlayerInvolved = globalScene.currentBattle.arrangement.locate(
        pokemon.getBattlerIndex(),
      ).position;
    } else {
      /** If its an enemy pokemon, list it as last enemy to use ability or move */
      globalScene.currentBattle.lastEnemyInvolved = globalScene.currentBattle.arrangement.locate(
        pokemon.getBattlerIndex(),
      ).position;
    }

    globalScene.abilityBar.showAbility(this.pokemonName, this.abilityName, this.passive, this.player).then(() => {
      pokemon.revealAbility();

      this.end();
    });
  }
}
