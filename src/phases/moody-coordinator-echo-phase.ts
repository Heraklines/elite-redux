import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  clearMoodyCoordinatorSpectralPower,
  setMoodyCoordinatorSpectralPower,
} from "#data/elite-redux/moody/moody-coordinator-combat-state";
import type { BattlerIndex } from "#enums/battler-index";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";

export class MoodyCoordinatorEchoCleanupPhase extends Phase {
  public readonly phaseName = "MoodyCoordinatorEchoCleanupPhase";
  private readonly pokemonId: number;

  constructor(pokemonId: number) {
    super();
    this.pokemonId = pokemonId;
  }

  public override start(): void {
    super.start();
    clearMoodyCoordinatorSpectralPower(this.pokemonId);
    this.end();
  }
}

export class MoodyCoordinatorEchoPhase extends Phase {
  public readonly phaseName = "MoodyCoordinatorEchoPhase";
  private readonly pokemonId: number;
  private readonly moveId: MoveId;
  private readonly targetPokemonIds: readonly number[];
  private readonly power: number;

  constructor(pokemonId: number, moveId: MoveId, targetPokemonIds: readonly number[], power: number) {
    super();
    this.pokemonId = pokemonId;
    this.moveId = moveId;
    this.targetPokemonIds = targetPokemonIds;
    this.power = power;
  }

  public override start(): void {
    super.start();
    const pokemon = globalScene.getPokemonById(this.pokemonId);
    const move = pokemon?.getMoveset().find(candidate => candidate.moveId === this.moveId);
    const targets = this.targetPokemonIds
      .map(pokemonId => globalScene.getPokemonById(pokemonId)?.getBattlerIndex())
      .filter((target): target is BattlerIndex => target != null);
    if (pokemon == null || move == null || !pokemon.isActive(true) || targets.length === 0) {
      this.end();
      return;
    }
    setMoodyCoordinatorSpectralPower(pokemon.id, this.power);
    globalScene.phaseManager.unshiftPhase(new MoodyCoordinatorEchoCleanupPhase(pokemon.id));
    globalScene.phaseManager.unshiftNew("MovePhase", pokemon, targets, move, MoveUseMode.FOLLOW_UP);
    this.end();
  }
}
