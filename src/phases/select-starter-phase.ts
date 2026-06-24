import { consumePendingDevStarters } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { Phase } from "#app/phase";
import { allMoves, modifierTypes } from "#data/data-lists";
import { applyErBlackShinyKit } from "#data/elite-redux/er-black-shinies";
import { PokemonMove } from "#moves/pokemon-move";

/** Throwaway save slot used by dev test-scenarios so they don't clobber slot 0. */
const DEV_SCENARIO_SLOT = 4;

import type { CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import { getCoopController, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopRole, CoopSerializedStarter } from "#data/elite-redux/coop/coop-transport";
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
      //
      // The merge is keyed by ROLE (not local/partner) so BOTH clients produce the
      // SAME party (#633, LIVE-B): the host's machine and the guest's machine each
      // pass their own local picks + the partner's mirrored picks, and the builder
      // puts the host-role half first regardless of who is local. With the full
      // starter blobs over the wire, the two parties are byte-identical.
      const { starters: merged, owners } = buildCoopMergedStarters(
        hostStarters,
        controller.role,
        controller.partnerEntries(),
      );
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
      // Mirror the local team to the partner and lock in. The roster carries the
      // FULL starter blob (#633, LIVE-B) - not just speciesId+cost - so the partner
      // rebuilds our mons EXACTLY (same form / IVs / nature / ability / moves) and
      // both clients' merged launch parties are byte-identical (a prerequisite for
      // the shared-seed lockstep).
      controller.setLocalRoster(
        starters.map<CoopRosterEntry>(s => ({
          speciesId: s.speciesId,
          cost: globalScene.gameData.getSpeciesStarterValue(s.speciesId),
          starter: serializeCoopStarter(s),
        })),
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
 * Serialize an engine {@linkcode Starter} into the wire {@linkcode CoopSerializedStarter}
 * (#633, LIVE-B) so a partner can rebuild it EXACTLY. The shapes are nearly
 * identical; this pins the explicit field set + clones the array fields so the
 * struct that crosses the transport never aliases live engine state.
 */
function serializeCoopStarter(s: Starter): CoopSerializedStarter {
  return {
    speciesId: s.speciesId,
    shiny: s.shiny,
    variant: s.variant,
    formIndex: s.formIndex,
    female: s.female,
    abilityIndex: s.abilityIndex,
    passive: s.passive,
    nature: s.nature,
    moveset: s.moveset ? [...s.moveset] : undefined,
    pokerus: s.pokerus,
    nickname: s.nickname,
    teraType: s.teraType,
    ivs: [...s.ivs],
    erBlackShiny: s.erBlackShiny,
  };
}

/**
 * Rebuild an engine {@linkcode Starter} from a wire {@linkcode CoopSerializedStarter}
 * (#633, LIVE-B). The inverse of {@linkcode serializeCoopStarter}: produces the
 * EXACT same starter the partner picked, so both clients' merged parties match
 * byte-for-byte. `nature` / `teraType` are stored as plain numbers on the wire and
 * narrowed back to their engine enums here.
 */
function rebuildCoopStarter(blob: CoopSerializedStarter): Starter {
  return {
    speciesId: blob.speciesId,
    shiny: blob.shiny,
    variant: blob.variant as Starter["variant"],
    formIndex: blob.formIndex,
    female: blob.female,
    abilityIndex: blob.abilityIndex,
    passive: blob.passive,
    nature: blob.nature as Nature,
    moveset: blob.moveset ? ([...blob.moveset] as Starter["moveset"]) : undefined,
    pokerus: blob.pokerus,
    nickname: blob.nickname,
    teraType: blob.teraType as Starter["teraType"],
    ivs: [...blob.ivs],
    erBlackShiny: blob.erBlackShiny,
  };
}

/** Rebuild a partner roster entry into an engine {@linkcode Starter} (#633, LIVE-B):
 *  use the full blob when present, else fall back to sensible defaults (older
 *  client / mid-select snapshot) so the merge never breaks. */
function partnerEntryToStarter(e: CoopRosterEntry): Starter {
  if (e.starter) {
    return rebuildCoopStarter(e.starter);
  }
  // Back-compat fallback (no full blob): sensible defaults, level-up moveset
  // auto-populates in initBattle.
  return {
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
  };
}

/**
 * Build the merged co-op launch party (#633), INTERLEAVED: host0, guest0, host1,
 * guest1, ... so the two double leads (party[0]/party[1] = field slots 0/1) are
 * each player's FIRST mon - the host commands field 0, the guest field 1, from
 * turn 1.
 *
 * Keyed by ROLE, not by local/partner (#633, LIVE-B): `localStarters` are the
 * local client's own picks, `localRole` says which role that is, and
 * `partnerEntries` are the mirrored partner picks. The builder always lays the
 * HOST-role half into the interleave's first stream and the GUEST-role half into
 * the second - so the host's machine and the guest's machine produce the SAME
 * party order. With the full starter blobs carried over the wire (LIVE-B), each
 * partner mon is rebuilt EXACTLY (same form / IVs / nature / ability / moveset /
 * tera / black-shiny), making the two clients' 6-slot parties byte-identical - the
 * prerequisite for sharing a seed and staying in lockstep. Returns the interleaved
 * `starters` plus a parallel `owners` array so `initBattle` can tag each launch
 * mon's `coopOwner`.
 */
function buildCoopMergedStarters(
  localStarters: Starter[],
  localRole: CoopRole,
  partnerEntries: readonly CoopRosterEntry[],
): { starters: Starter[]; owners: CoopRole[] } {
  const partnerStarters = partnerEntries.map(partnerEntryToStarter);
  // Resolve each role's half from local vs partner so the result is identical on
  // both machines (host half first, guest half second).
  const hostHalf = localRole === "host" ? localStarters : partnerStarters;
  const guestHalf = localRole === "host" ? partnerStarters : localStarters;

  const starters: Starter[] = [];
  const owners: CoopRole[] = [];
  const max = Math.max(hostHalf.length, guestHalf.length);
  for (let i = 0; i < max; i++) {
    if (i < hostHalf.length) {
      starters.push(hostHalf[i]);
      owners.push("host");
    }
    if (i < guestHalf.length) {
      starters.push(guestHalf[i]);
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
