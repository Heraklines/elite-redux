import { consumePendingDevStarters } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { Phase } from "#app/phase";
import { allMoves, modifierTypes } from "#data/data-lists";
import { applyErBlackShinyKit } from "#data/elite-redux/er-black-shinies";
import { PokemonMove } from "#moves/pokemon-move";

/** Throwaway save slot used by dev test-scenarios so they don't clobber slot 0. */
const DEV_SCENARIO_SLOT = 4;

import { getCoopController, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import { ChallengeType } from "#enums/challenge-type";
import { Nature } from "#enums/nature";
import { UiMode } from "#enums/ui-mode";
import { overrideHeldItems, overrideModifiers } from "#modifiers/modifier";
import type { Starter } from "#types/save-data";
import { SaveSlotUiMode } from "#ui/handlers/save-slot-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import SoundFade from "phaser3-rex-plugins/plugins/soundfade";

export class SelectStarterPhase extends Phase {
  public readonly phaseName = "SelectStarterPhase";
  start() {
    super.start();

    // Local-only dev tools: a test scenario may have staged a party so we can
    // drop straight into the battle, skipping starter-select. consumePending…
    // returns null in production / on a clean checkout, so this is inert there.
    const devStarters = consumePendingDevStarters();
    if (devStarters && devStarters.length > 0) {
      globalScene.sessionSlotId = DEV_SCENARIO_SLOT;
      // The normal starter-select confirm path sets starting money; the dev
      // path skips that screen, so set it here too. Otherwise money stays at the
      // 0 default and STARTING_MONEY_OVERRIDE (and the 1000 classic default) are
      // both ignored - e.g. the Guessing Booth scenario showed P0 (#439).
      globalScene.money = globalScene.gameMode.getStartingMoney();
      // Dev scenarios hand-pick movesets for TESTING (e.g. Thunder Wave on a
      // Blastoise) — skip the starter-legality validation that silently
      // rejected them and left scenario mons with NO moves.
      this.initBattle(devStarters, true);
      return;
    }

    globalScene.playBgm("menu");

    // Co-op (#633): each player picks their OWN team on their OWN screen; we wait
    // for both to lock in, then the host launches the merged party.
    if (globalScene.gameMode.isCoop && getCoopController()) {
      this.startCoopSelect();
      return;
    }

    globalScene.ui.setMode(UiMode.STARTER_SELECT, (starters: Starter[]) => {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.SAVE_SLOT, SaveSlotUiMode.SAVE, (slotId: number) => {
        // If clicking cancel, back out to title screen
        if (slotId === -1) {
          globalScene.phaseManager.toTitleScreen();
          this.end();
          return;
        }
        globalScene.sessionSlotId = slotId;
        this.initBattle(starters);
      });
    });
  }

  /**
   * Co-op selection flow (#633). The local player picks on their own
   * starter-select (capped at 5 points / 3 mons by the handler); their roster is
   * mirrored to the partner over the transport. A spoofed partner (local dev)
   * auto-picks + locks in; a real partner takes as long as they take. Once BOTH
   * sides are ready, the host assembles the merged 6-slot party (its own picks +
   * the partner's) and launches the run.
   */
  private startCoopSelect(): void {
    const controller = getCoopController()!;
    // Stand-in player 2 (local dev): join, pick, lock in. No-op for a real peer.
    getCoopRuntime()?.spoof?.autoComplete();

    let hostStarters: Starter[] = [];
    let launched = false;
    const proceedIfReady = () => {
      if (launched || hostStarters.length === 0 || !controller.bothReady()) {
        return;
      }
      launched = true;
      // Build the merged launch party INTERLEAVED (host0, guest0, host1, ...) so
      // the two double leads (party[0]/party[1] = field slots 0/1) are the host's
      // and the guest's FIRST mon respectively - each player gets an active mon to
      // control from turn 1 (#633, P2). `owners` tags each launch mon's coopOwner.
      const { starters: merged, owners } = buildCoopMergedStarters(hostStarters, controller.partnerEntries());
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.SAVE_SLOT, SaveSlotUiMode.SAVE, (slotId: number) => {
        if (slotId === -1) {
          globalScene.phaseManager.toTitleScreen();
          this.end();
          return;
        }
        globalScene.sessionSlotId = slotId;
        this.initBattle(merged, false, owners);
      });
    };
    // Re-check readiness whenever the partner's state changes (real-peer path).
    controller.onChange(() => proceedIfReady());

    globalScene.ui.setMode(UiMode.STARTER_SELECT, (starters: Starter[]) => {
      hostStarters = starters;
      // Mirror the local team to the partner and lock in.
      controller.setLocalRoster(
        starters.map(s => ({ speciesId: s.speciesId, cost: globalScene.gameData.getSpeciesStarterValue(s.speciesId) })),
      );
      controller.setLocalReady(true);
      proceedIfReady();
    });
  }

  /**
   * Initialize starters before starting the first battle
   * @param starters - Array of {@linkcode Starter}s with which to start the battle
   * @param ignoreMovesetValidation - Skip starter-legality moveset validation (dev scenarios)
   * @param coopOwners - Co-op only (#633, P2): per-launch-mon owner tag, parallel to `starters`.
   *   The merged party is interleaved (host0, guest0, host1, ...), so `coopOwners[i]` is the
   *   owner of `starters[i]`. Omitted / `undefined` for solo and all other modes.
   */
  initBattle(starters: Starter[], ignoreMovesetValidation = false, coopOwners?: CoopRole[]) {
    const party = globalScene.getPlayerParty();
    const loadPokemonAssets: Promise<void>[] = [];
    starters.forEach((starter: Starter, i: number) => {
      if (!i && Overrides.STARTER_SPECIES_OVERRIDE) {
        starter.speciesId = Overrides.STARTER_SPECIES_OVERRIDE;
      }
      const species = getPokemonSpecies(starter.speciesId);
      let starterFormIndex = starter.formIndex;
      if (
        starter.speciesId in Overrides.STARTER_FORM_OVERRIDES
        && Overrides.STARTER_FORM_OVERRIDES[starter.speciesId] != null
        && species.forms[Overrides.STARTER_FORM_OVERRIDES[starter.speciesId]!]
      ) {
        starterFormIndex = Overrides.STARTER_FORM_OVERRIDES[starter.speciesId]!;
      }

      let starterGender =
        species.malePercent === null ? Gender.GENDERLESS : starter.female ? Gender.FEMALE : Gender.MALE;
      if (Overrides.GENDER_OVERRIDE !== null) {
        starterGender = Overrides.GENDER_OVERRIDE;
      }
      const starterPokemon = globalScene.addPlayerPokemon(
        species,
        globalScene.gameMode.getStartingLevel(),
        starter.abilityIndex,
        starterFormIndex,
        starterGender,
        starter.shiny,
        starter.variant,
        starter.ivs,
        starter.nature,
      );
      if (starter.moveset) {
        starterPokemon.tryPopulateMoveset(starter.moveset, ignoreMovesetValidation);
      }
      // ER (community report 2026-06-11): some lines' EARLY learnset is all
      // status moves (Krabby Redux opens Kinesis/Showtime/Meditate/...), so a
      // starter could begin the run with NO damaging move at all. Guarantee
      // one: swap the last slot for the line's earliest damaging level-up
      // move (skipped for dev scenarios, whose movesets are intentional).
      if (!ignoreMovesetValidation) {
        ensureStarterHasDamagingMove(starterPokemon);
      }
      // ER Black Shinies (#349): a starter chosen at the BLACK tier enters the
      // run as a full t4 (epic base + gift kit). One per team is implicit:
      // only one starter can be black since the unlock is per-line and the
      // roll guard caps player teams at one anyway.
      if (starter.erBlackShiny) {
        starterPokemon.shiny = true;
        starterPokemon.variant = 2;
        applyErBlackShinyKit(starterPokemon);
      }
      if (starter.passive) {
        starterPokemon.passive = true;
      }
      starterPokemon.luck = globalScene.gameData.getDexAttrLuck(
        globalScene.gameData.dexData[species.speciesId].caughtAttr,
      );
      if (starter.pokerus) {
        starterPokemon.pokerus = true;
      }

      if (starter.nickname) {
        starterPokemon.nickname = starter.nickname;
      }

      if (starter.teraType == null) {
        starterPokemon.teraType = starterPokemon.species.type1;
      } else {
        starterPokemon.teraType = starter.teraType;
      }

      if (globalScene.gameMode.isSplicedOnly || Overrides.STARTER_FUSION_OVERRIDE) {
        starterPokemon.generateFusionSpecies(true);
      }
      starterPokemon.setVisible(false);
      // Co-op (#633, P2): tag each launch mon's owner from the parallel owners
      // array (the merged party is interleaved, so the tag - not the slot index -
      // is the source of truth). Only in co-op (coopOwners undefined otherwise),
      // so solo modes are untouched.
      if (coopOwners !== undefined && globalScene.gameMode.isCoop) {
        starterPokemon.coopOwner = coopOwners[i];
      }
      const chalApplied = applyChallenges(ChallengeType.STARTER_MODIFY, starterPokemon);
      party.push(starterPokemon);
      if (chalApplied) {
        // If any challenges modified the starter, it should update
        loadPokemonAssets.push(starterPokemon.updateInfo());
      }
      loadPokemonAssets.push(starterPokemon.loadAssets());
    });
    overrideModifiers();
    overrideHeldItems(party[0]);
    Promise.all(loadPokemonAssets).then(() => {
      // Guard: the menu BGM may not exist (e.g. the AudioContext never started
      // because the browser blocked autoplay). Fading out a null sound throws,
      // which would reject this promise and leave the run stuck on a blank field.
      const menuBgm = globalScene.sound.get("menu");
      if (menuBgm) {
        SoundFade.fadeOut(globalScene, menuBgm, 500, true);
      }
      globalScene.time.delayedCall(500, () => globalScene.playBgm());
      if (globalScene.gameMode.isClassic) {
        globalScene.gameData.gameStats.classicSessionsPlayed++;
      } else {
        globalScene.gameData.gameStats.endlessSessionsPlayed++;
      }
      globalScene.newBattle();
      // ER #439: the biome Map is a DEFAULT item on every run, all difficulties -
      // players can always choose their next biome from the start (daily runs
      // already grant it in TitlePhase; this covers classic/endless/challenge +
      // the ER difficulty modes + dev scenarios, which all route through here).
      globalScene.addModifier(modifierTypes.MAP().withIdFromFunc(modifierTypes.MAP).newModifier(), true);
      globalScene.arena.init();
      globalScene.sessionPlayTime = 0;
      globalScene.lastSavePlayTime = 0;
      // Ensures Keldeo (or any future Pokemon that have this type of form change) starts in the correct form
      globalScene.getPlayerParty().forEach(p => {
        globalScene.triggerPokemonFormChange(p, SpeciesFormChangeMoveLearnedTrigger);
      });
      this.end();
    });
  }
}

/**
 * Build the merged co-op launch party (#633), INTERLEAVED: host0, guest0, host1,
 * guest1, ... so the two double leads (party[0]/party[1] = field slots 0/1) are
 * each player's FIRST mon - the host commands field 0, the guest field 1, from
 * turn 1. The partner's roster crosses the transport as just `{speciesId, cost}`
 * in phase P1, so its mons are rebuilt with sensible defaults here (base form,
 * neutral nature, perfect IVs, default ability; the level-up moveset
 * auto-populates). Full per-mon partner data lands when the real transport carries
 * the whole Starter struct (P6). Returns the interleaved `starters` plus a parallel
 * `owners` array so `initBattle` can tag each launch mon's `coopOwner`.
 */
function buildCoopMergedStarters(
  hostStarters: Starter[],
  partnerEntries: readonly { speciesId: number; cost: number }[],
): { starters: Starter[]; owners: CoopRole[] } {
  const partnerStarters: Starter[] = partnerEntries.map(e => ({
    speciesId: e.speciesId,
    shiny: false,
    variant: 0,
    formIndex: 0,
    female: false,
    abilityIndex: 0,
    passive: false,
    nature: Nature.HARDY,
    pokerus: false,
    ivs: [31, 31, 31, 31, 31, 31],
  }));
  const starters: Starter[] = [];
  const owners: CoopRole[] = [];
  const max = Math.max(hostStarters.length, partnerStarters.length);
  for (let i = 0; i < max; i++) {
    if (i < hostStarters.length) {
      starters.push(hostStarters[i]);
      owners.push("host");
    }
    if (i < partnerStarters.length) {
      starters.push(partnerStarters[i]);
      owners.push("guest");
    }
  }
  return { starters, owners };
}

/**
 * ER: guarantee a freshly created starter has at least ONE damaging move.
 * Some ER learnsets open with nothing but status moves (Krabby Redux), which
 * left the run unwinnable from turn 1. Replaces the last moveset slot (or
 * fills an empty one) with the line's earliest damaging level-up move.
 */
function ensureStarterHasDamagingMove(pokemon: ReturnType<typeof globalScene.addPlayerPokemon>): void {
  const moveset = pokemon.getMoveset();
  if (moveset.some(m => (m?.getMove()?.power ?? 0) > 0)) {
    return;
  }
  const firstDamaging = pokemon
    .getLevelMoves(1, true, false, true)
    .map(lm => lm[1])
    .find(moveId => (allMoves[moveId]?.power ?? 0) > 0);
  if (firstDamaging === undefined) {
    return;
  }
  if (moveset.length < 4) {
    pokemon.moveset.push(new PokemonMove(firstDamaging));
  } else {
    pokemon.moveset[3] = new PokemonMove(firstDamaging);
  }
}
