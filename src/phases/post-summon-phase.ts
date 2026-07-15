import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { EntryHazardTag } from "#data/arena-tag";
import { MysteryEncounterPostSummonTag } from "#data/battler-tags";
import { erBadSpliceOnOpponentSummon } from "#data/elite-redux/abilities/bad-splice";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { erApplyCursedIdol } from "#data/elite-redux/er-relics";
import { erApplyTerrainSeeds } from "#data/elite-redux/er-terrain-seeds";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { AttackTypeBoosterModifier } from "#modifiers/modifier";
import { PokemonPhase } from "#phases/pokemon-phase";

export class PostSummonPhase extends PokemonPhase {
  public readonly phaseName = "PostSummonPhase";

  start() {
    super.start();

    // SHOWDOWN versus GUEST (2026-07-08 turn-1/switch-in summon desync): the pure-renderer versus guest
    // boots from the host's launch snapshot and runs its OWN summon chain, so it would DERIVE each lead's
    // on-entry effects here (entry hazards, ER biome Spd-drop / entry-status - the latter RNG-driven via
    // randBattleSeedInt, terrain seeds, cursed idol). None of that is authoritative on the guest; it renders
    // the host's streamed post-summon + adopts the authoritative checkpoint instead. Skip the derivation
    // entirely (the mon is already placed on field by SummonPhase; only effects live here). Versus-guest
    // ONLY (isShowdownGuestFlip), so CO-OP / solo / host are byte-for-byte unaffected.
    if (isShowdownGuestFlipGated()) {
      this.end();
      return;
    }

    const pokemon = this.getPokemon();
    console.log("Ran PSP for:", pokemon.name);
    if (pokemon.status?.effect === StatusEffect.TOXIC) {
      pokemon.status.toxicTurnCount = 0;
    }

    globalScene.arena.applyTags(ArenaTagType.PENDING_HEAL, false, pokemon);

    globalScene.arena.applyTags(EntryHazardTag, false, pokemon);

    // If this is mystery encounter and has post summon phase tag, apply post summon effects
    if (
      globalScene.currentBattle.isBattleMysteryEncounter()
      && pokemon.findTags(t => t instanceof MysteryEncounterPostSummonTag).length > 0
    ) {
      pokemon.lapseTag(BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON);
    }
    for (const p of pokemon.getAlliesGenerator()) {
      applyAbAttrs("CommanderAbAttr", { pokemon: p });
    }

    this.applyErBiomeSwitchIn(pokemon);
    erApplyTerrainSeeds(pokemon);
    erApplyCursedIdol(pokemon);
    // ER Bad Splice (5932): if an opposing active holder carries Bad Splice,
    // splice this just-summoned foe from its own party.
    erBadSpliceOnOpponentSummon(pokemon);

    this.end();
  }

  /**
   * ER biome identity (#439 §3 Groups C/D): on switch-in, some biomes drop Spd
   * (Sea non-swimmers, Space grounded) or risk an entry status (Volcano burn,
   * Ice Cave frostbite). Universal world flavor - applies to BOTH sides.
   */
  private applyErBiomeSwitchIn(pokemon: Pokemon): void {
    const rule = getErBiomeRule(globalScene.arena.biomeId);
    if (!rule) {
      return;
    }

    // Group C - entry Spd drop. "Swimmers" = Water/Flying type or Levitate.
    const isSwimmer =
      pokemon.isOfType(PokemonType.WATER)
      || pokemon.isOfType(PokemonType.FLYING)
      || pokemon.hasAbility(AbilityId.LEVITATE);
    if ((rule.swimmerSpdDrop && !isSwimmer) || (rule.groundedSpdDrop && pokemon.isGrounded())) {
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, [Stat.SPD], -1);
    }

    // Group D - entry status risk: grounded, not the immune type, no warm item
    // (a Fire-type-boosting held item like Charcoal wards off both).
    if (rule.entryStatus && pokemon.isGrounded()) {
      const { kind, chance } = rule.entryStatus;
      const immuneType = kind === "burn" ? PokemonType.FIRE : PokemonType.ICE;
      const holdsWarmItem = pokemon
        .getHeldItems()
        .some(m => m instanceof AttackTypeBoosterModifier && m.moveType === PokemonType.FIRE);
      if (!pokemon.isOfType(immuneType) && !holdsWarmItem && globalScene.randBattleSeedInt(100) < chance) {
        // burn -> BURN; frostbite -> FREEZE (ER reroutes FREEZE to the frostbite tag).
        pokemon.trySetStatus(
          kind === "burn" ? StatusEffect.BURN : StatusEffect.FREEZE,
          undefined,
          undefined,
          null,
          undefined,
          false,
        );
      }
    }
  }

  public getPriority() {
    return 0;
  }
}
