/*
 * Elite Redux — in-game dev TEST SUITE scenarios.  *** TRACKED — ships to STAGING ***
 *
 * This file IS committed and built into the staging bundle (VITE_DEV_TOOLS=1) so
 * the test team can verify fixes themselves. It NEVER activates in production
 * (the registry gate is false there). See CLAUDE.md → "STANDING RULE".
 *
 * Each scenario has:
 *   - label       → SHORT name shown in the picker list (keep it tight)
 *   - description → the context screen shown before launch: which bug, what to
 *                   DO, and what to EXPECT. Other testers read this, so be clear.
 *   - setup()     → applies pre-battle Overrides and returns the player party
 *   - onBattleStart? → optional; runs ONCE on the first turn (mid-combat state
 *                   the Overrides can't express, e.g. pre-boosted stat stages)
 *
 * Selecting a scenario drops you into a configured CLASSIC/CHALLENGE battle on a
 * throwaway save slot (4) — your real save (slot 0) is untouched.
 *
 * To add one: copy a block. Party via makeStarter(); pre-battle via setOverrides
 * (weather/status/ability/moveset/enemy); mid-combat via onBattleStart +
 * boostPlayer()/boostEnemy(). resetDevOverrides() runs first so each starts clean.
 */

import { loggedInUser } from "#app/account";
import { TerrainType } from "#app/data/terrain";
import {
  setClearMeOverrideAfterFirst,
  setPendingDevCustomTrainerForce,
  setPendingDevEnemyParty,
} from "#app/dev-tools/registry";
import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { modifierTypes } from "#data/data-lists";
import { getCoopController, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { coopOwnedCount } from "#data/elite-redux/coop/coop-session";
import { erRunUnlockAbilitySlot, erRunUnlockableInnateSlots } from "#data/elite-redux/er-ability-capsule";
import type { ErCommunityItemKind } from "#data/elite-redux/er-community-items";
import { setCommunityAllowedSpecies } from "#data/elite-redux/er-community-run-state";
import {
  applyErCustomTrainerFusion,
  type ErCustomTrainerResolved,
  erCustomTrainerHeldModifierConfigs,
  resolveErCustomTrainerMoveIds,
} from "#data/elite-redux/er-custom-trainers";
import { setErAiExperimentalMode, setErSmartAiTestForced } from "#data/elite-redux/er-enemy-ai";
import { type GhostMember, type GhostTeamSnapshot, seedDevGhostGrave } from "#data/elite-redux/er-ghost-teams";
import { addTreasureFragments, resetErMapNodes, revealMapNodes } from "#data/elite-redux/er-map-nodes";
import { advanceErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { erResistBerryModifierType } from "#data/elite-redux/er-resist-berries";
import {
  type ErDifficulty,
  setErDifficulty,
  setErDifficulty as setErDifficultyForScenario,
} from "#data/elite-redux/er-run-difficulty";
import {
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  encodeErShinyLabLoadout,
  normalizeErShinyLabSavedLook,
  sanitizeErShinyLabPresetName,
  setErShinyLabOwnedBit,
} from "#data/elite-redux/er-shiny-lab-effects";
import { erWardStoneModifierType } from "#data/elite-redux/er-ward-stones";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import type { Challenges } from "#enums/challenges";
import { ErAbilityId } from "#enums/er-ability-id";
import { ErMoveId } from "#enums/er-move-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TimeOfDay } from "#enums/time-of-day";
import { WeatherType } from "#enums/weather-type";
import type { PlayerPokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierOverride } from "#modifiers/modifier-type";
import { erCommunityItemModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import type { Variant } from "#sprites/variant";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { Starter, StarterMoveset } from "#types/save-data";
import { openErMapOverlay } from "#ui/er-map-ui-handler";
import { isSlotUnlocked, PASSIVE_SLOTS, unlockSlot } from "#utils/passive-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { type ErCustomTrainerLaunchPlan, planErCustomTrainerLaunch } from "./custom-trainer-picker";

export interface DevScenario {
  /** Short name for the picker list. */
  label: string;
  /** Context shown before launch: the bug, what to do, what to expect. */
  description: string;
  /** Apply Overrides and return the player party. */
  setup: () => Starter[];
  /** Optional per-slot levels applied while the staged party is constructed. */
  startingLevels?: readonly number[];
  /** Run mode to create. Defaults to CLASSIC. */
  gameMode?: GameModes;
  /** Optional setup that needs the freshly-created gameMode. */
  postLaunch?: () => void;
  /** Optional: runs once after staged starters become the player party. */
  onPartyReady?: () => void;
  /** Optional: runs ONCE on the first turn, after both sides are summoned. */
  onBattleStart?: () => void;
  /**
   * Optional: guarantee these reward options in the FIRST shop after the opening
   * battle ("start in the store, test a specific item"). Each is a
   * `ModifierTypeFunc` from `modifierTypes` (e.g. `modifierTypes.RARE_CANDY`, or
   * `modifierTypes.FORM_CHANGE_ITEM` which — with a single-mon party — resolves to
   * that mon's mega stone). Win the opening battle to reach the shop.
   */
  shopItems?: ModifierTypeFunc[];
}

// --- helpers ----------------------------------------------------------------

interface StarterOpts {
  formIndex?: number;
  abilityIndex?: number;
  moveset?: MoveId[];
  female?: boolean;
  shiny?: boolean;
  variant?: Variant;
  nature?: Nature;
}

function makeStarter(speciesId: SpeciesId, opts: StarterOpts = {}): Starter {
  return {
    speciesId,
    shiny: opts.shiny ?? false,
    variant: opts.variant ?? 0,
    formIndex: opts.formIndex ?? 0,
    female: opts.female,
    abilityIndex: opts.abilityIndex ?? 0,
    passive: false,
    nature: opts.nature ?? Nature.HARDY,
    moveset: (opts.moveset?.length ?? 0) > 0 ? (opts.moveset?.slice(0, 4) as StarterMoveset) : undefined,
    pokerus: false,
    ivs: new Array(6).fill(31),
  };
}

function seedShinyLabVisualLook(speciesId: SpeciesId): void {
  const palette = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette.find(e => e.id === "duoneon");
  const surface = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.surface.find(e => e.id === "starmap");
  const around = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.around.find(e => e.id === "staticfield");
  if (!palette || !surface || !around) {
    return;
  }
  const starter = globalScene.gameData.getStarterDataEntry(speciesId);
  starter.erShinyLab ??= {};
  setErShinyLabOwnedBit(starter.erShinyLab, "palette", palette.index);
  setErShinyLabOwnedBit(starter.erShinyLab, "surface", surface.index);
  setErShinyLabOwnedBit(starter.erShinyLab, "around", around.index);
  starter.erShinyLab.l = encodeErShinyLabLoadout({
    palette: palette.id,
    surface: surface.id,
    around: around.id,
  });
}

/** Resolve the form index whose `formKey` matches (e.g. "redux"); 0 if absent. */
function formIndexByKey(speciesId: SpeciesId, formKey: string): number {
  const idx = getPokemonSpecies(speciesId).forms.findIndex(f => f.formKey === formKey);
  return idx < 0 ? 0 : idx;
}

/** Resolve the first form index whose `formKey` CONTAINS `needle`; 0 if absent. */
function formIndexContaining(speciesId: SpeciesId, needle: string): number {
  const idx = getPokemonSpecies(speciesId).forms.findIndex(f => f.formKey.includes(needle));
  return idx < 0 ? 0 : idx;
}

/** Cast an ER ability id into the extended AbilityId space (for ABILITY_OVERRIDE). */
const erAbility = (id: number): AbilityId => id as unknown as AbilityId;

/** Cast an ER custom move id (≥5000) into the MoveId space (for MOVESET_OVERRIDE). */
const erMove = (id: number): MoveId => id as unknown as MoveId;

/** Cast an ER custom species id (≥10000) into the SpeciesId space (for starters/overrides). */
const erSpecies = (id: number): SpeciesId => id as unknown as SpeciesId;

// The Overrides singleton fields are `readonly` at compile time but mutable at
// runtime — this is exactly how the dev override workflow is meant to be driven.
type MutableOverrides = { -readonly [K in keyof typeof Overrides]: (typeof Overrides)[K] };
const O = Overrides as unknown as MutableOverrides;

/** Keys this harness sets, with their default ("off") values. */
const DEV_OVERRIDE_DEFAULTS = {
  STARTING_LEVEL_OVERRIDE: 0,
  STARTING_WAVE_OVERRIDE: null,
  // #563: a level-up scenario set these to force a big XP jump; they were NOT in
  // this reset list, so they leaked into every later scenario (and into normal
  // runs from the title), levelling everything to the cap. Reset to engine defaults.
  XP_MULTIPLIER_OVERRIDE: null,
  LEVEL_CAP_OVERRIDE: 0,
  STARTING_MONEY_OVERRIDE: 0,
  BATTLE_STYLE_OVERRIDE: null,
  STARTING_BIOME_OVERRIDE: null,
  STARTER_FORM_OVERRIDES: {},
  STARTER_FUSION_OVERRIDE: false,
  STARTER_FUSION_SPECIES_OVERRIDE: null,
  ABILITY_OVERRIDE: AbilityId.NONE,
  PASSIVE_ABILITY_OVERRIDE: AbilityId.NONE,
  MOVESET_OVERRIDE: [],
  STARTING_HELD_ITEMS_OVERRIDE: [],
  STARTING_MODIFIER_OVERRIDE: [],
  WEATHER_OVERRIDE: WeatherType.NONE,
  // BG-art scenarios force a time of day to show a specific day/dusk/night variant;
  // reset it so the forced time never leaks into the next scenario or a normal run.
  TIME_OF_DAY_OVERRIDE: null,
  STATUS_OVERRIDE: StatusEffect.NONE,
  STARTING_TERRAIN_OVERRIDE: TerrainType.NONE,
  SHINY_OVERRIDE: null,
  VARIANT_OVERRIDE: null,
  ENEMY_STATUS_OVERRIDE: StatusEffect.NONE,
  ENEMY_SPECIES_OVERRIDE: null,
  ENEMY_LEVEL_OVERRIDE: 0,
  ENEMY_ABILITY_OVERRIDE: AbilityId.NONE,
  ENEMY_SHINY_OVERRIDE: null,
  ENEMY_VARIANT_OVERRIDE: null,
  ENEMY_MOVESET_OVERRIDE: [],
  ENEMY_FORM_OVERRIDES: {},
  ER_BLACK_SHINY_PLAYER_OVERRIDE: null,
  ER_BLACK_SHINY_ENEMY_OVERRIDE: null,
  // ER Colosseum (#439): scrub the ME overrides so a scenario that forces an
  // encounter doesn't leak into the next run/scenario.
  MYSTERY_ENCOUNTER_OVERRIDE: null,
  MYSTERY_ENCOUNTER_RATE_OVERRIDE: null,
  // ER: a forced ME only replaces a WILD wave (a trainer wave skips it). ME
  // scenarios set this true so the wave is guaranteed wild; reset here so it
  // never leaks into a normal run (which would have NO trainers).
  DISABLE_STANDARD_TRAINERS_OVERRIDE: false,
  // ER (#135): the Hell trainer-boss-buff scenario forces a TRAINER wave; reset
  // both so a forced battle type / trainer doesn't leak into the next run.
  BATTLE_TYPE_OVERRIDE: null,
  RANDOM_TRAINER_OVERRIDE: null,
  // ER #486: clear the Treasure-Map fragment seed so it never leaks between runs.
  ER_TREASURE_FRAGMENTS_OVERRIDE: 0,
} as const;

/**
 * Reset every dev-managed override so scenarios don't bleed into each other.
 * Also called from index.ts whenever the player is back at the TITLE screen:
 * without that, a scenario's overrides (pinned enemy species/level, starting
 * wave, movesets) leaked into the next NORMAL run started from the title.
 */
export function resetDevOverrides(): void {
  Object.assign(O, structuredClone(DEV_OVERRIDE_DEFAULTS));
  // The smarter AI is master-OFF in real play; clear any per-scenario force so
  // only the AI scenarios (which re-enable it below) ever exercise it.
  setErSmartAiTestForced(false);
  setErAiExperimentalMode("off");
}

function setOverrides(partial: Partial<MutableOverrides>): void {
  Object.assign(O, partial);
  // When a scenario FORCES a mystery encounter, arm the one-shot clear so it
  // fires once instead of re-spawning every wave (the rate override otherwise
  // bypasses the "no ME within 3 waves" rule and loops forever).
  if (partial.MYSTERY_ENCOUNTER_OVERRIDE != null) {
    setClearMeOverrideAfterFirst();
    // A forced ME only replaces a WILD wave - if the starting wave happens to
    // roll a trainer (isWaveTrainer is seeded per run), the override is skipped
    // and you get a normal battle instead. Guarantee a wild wave so the ME
    // triggers on EVERY launch, not just the lucky seeds.
    O.DISABLE_STANDARD_TRAINERS_OVERRIDE = true;
  }
}

/** Everything chosen before a custom trainer fight starts. Restart reuses it. */
export interface PreparedErCustomTrainerFight {
  plan: ErCustomTrainerLaunchPlan;
  ghost: GhostTeamSnapshot;
  candidateCount: number;
}

/** Apply historical challenge tuples, ignoring ids removed since capture. */
export function applyPreparedGhostChallenges(
  gameMode: { setChallengeValue(id: Challenges, value: number): void },
  challenges: readonly [number, number][],
): void {
  for (const [id, value] of challenges) {
    try {
      gameMode.setChallengeValue(id as Challenges, value);
    } catch {
      // Old/removed challenge ids in historical snapshots are ignored.
    }
  }
}

/** Clamp untrusted snapshot IV data to the legal six-value range. */
function ghostIvs(member: GhostMember): number[] {
  if (!Array.isArray(member.ivs) || member.ivs.length !== 6) {
    return new Array(6).fill(0);
  }
  return member.ivs.map(iv => Math.max(0, Math.min(31, Math.floor(iv) || 0)));
}

/** Convert one stored ghost member into the dev starter handoff shape. */
function ghostMemberStarter(member: GhostMember): Starter | null {
  const species = getPokemonSpecies(member.speciesId);
  if (!species) {
    return null;
  }
  const formIndex =
    Number.isInteger(member.formIndex) && member.formIndex >= 0 && member.formIndex < (species.forms?.length ?? 0)
      ? member.formIndex
      : 0;
  const moves = Array.isArray(member.moves)
    ? member.moves.filter(id => Number.isInteger(id) && id > 0).slice(0, 4)
    : [];
  const starter: Starter = {
    speciesId: member.speciesId as SpeciesId,
    shiny: !!member.shiny,
    variant: (Number.isInteger(member.variant) ? Math.max(0, Math.min(2, member.variant)) : 0) as Variant,
    formIndex,
    female: member.gender === Gender.FEMALE,
    abilityIndex: Number.isInteger(member.abilityIndex) ? Math.max(0, member.abilityIndex) : 0,
    passive: !!member.passive,
    nature: member.nature as Nature,
    moveset: moves.length > 0 ? (moves as StarterMoveset) : undefined,
    pokerus: false,
    ivs: ghostIvs(member),
  };
  if (starter.shiny && member.erShinyLab) {
    starter.erShinyLab = normalizeErShinyLabSavedLook(member.erShinyLab);
    starter.erShinyLabName = sanitizeErShinyLabPresetName(member.erShinyLabName) || undefined;
  }
  return starter;
}

/** Valid source members, capped at the normal six-mon player party. */
function usableGhostMembers(ghost: GhostTeamSnapshot): GhostMember[] {
  return ghost.party.filter(member => !!getPokemonSpecies(member.speciesId)).slice(0, 6);
}

/** Scale a ghost roster to a new top level without flattening its saved level gaps. */
export function translatePreparedGhostLevels(
  members: readonly Pick<GhostMember, "level">[],
  targetTopLevel: number,
): number[] {
  const sourceTopLevel = Math.max(1, ...members.map(member => Math.max(1, Math.floor(member.level) || 1)));
  return members.map(member => {
    const sourceLevel = Math.max(1, Math.floor(member.level) || 1);
    return Math.max(1, targetTopLevel - (sourceTopLevel - sourceLevel));
  });
}

/** Restore every resolvable held item stored on a sampled ghost roster. */
export function applyPreparedGhostHeldItems(party: readonly PlayerPokemon[], members: readonly GhostMember[]): number {
  const registry = modifierTypes as Record<string, ModifierTypeFunc | undefined>;
  let applied = 0;
  party.forEach((mon, index) => {
    for (const [typeId, rawCount] of members[index]?.heldItems ?? []) {
      const factory = registry[typeId];
      if (typeof factory !== "function") {
        continue;
      }
      try {
        const type = factory();
        if (!(type instanceof PokemonHeldItemModifierType)) {
          continue;
        }
        const modifier = type.withIdFromFunc(factory).newModifier(mon) as PokemonHeldItemModifier;
        modifier.pokemonId = mon.id;
        modifier.stackCount = Math.max(1, Math.floor(Number(rawCount) || 1));
        globalScene.addModifier(modifier, true, false, false, true);
        applied++;
      } catch {
        // Legacy snapshots can reference removed or generated item variants.
        // Skip only that entry and keep the rest of the sampled team usable.
      }
    }
  });
  globalScene.updateModifiers(true);
  return applied;
}

/**
 * Build a one-off {@linkcode DevScenario} that force-fields ONE staff-authored
 * custom trainer (er-custom-trainers.json) so the test team can battle-test it
 * from the in-game Dev Scenarios picker. Reuses the round-7 dev force seam
 * ({@linkcode setErCustomTrainerDevForce}): the picked trainer installs at the
 * launched wave with the FULL feature set (sprite + gender, aura, battle music,
 * intro/victory/defeat lines, weighted-slot rolls, slot-fill, RLA/RLNA tokens,
 * shiny-lab looks, per-member Insanity ability overrides, BST bypass) exactly
 * as a real run would field it.
 *
 * Wave eligibility is handled by {@linkcode planErCustomTrainerLaunch}: the run
 * difficulty is force-adjusted to one the trainer allows and the starting wave is
 * chosen inside its range (skipping boss `% 10` + fixed-battle waves the install
 * seam rejects). When no wave can field it, an `error` string is returned so the
 * caller shows a readable message instead of dropping into a silent wild battle.
 * The force is a one-shot: it clears itself after the install, so the rest of the
 * run fields normal battles.
 */
export function buildErCustomTrainerDevScenario(
  trainer: ErCustomTrainerResolved,
  prepared: PreparedErCustomTrainerFight,
): { scenario: DevScenario } | { error: string } {
  const { difficulty, wave } = prepared.plan;
  const members = usableGhostMembers(prepared.ghost);
  if (members.length === 0) {
    return { error: `ghost run ${prepared.ghost.id} has no resolvable party members` };
  }
  const challenges = (prepared.ghost.challenges ?? []).filter(
    tuple => Array.isArray(tuple) && Number.isInteger(tuple[0]) && Number.isFinite(tuple[1]) && tuple[1] !== 0,
  );
  const gameMode =
    prepared.ghost.mode === "challenge" || challenges.length > 0 ? GameModes.CHALLENGE : GameModes.CLASSIC;
  const targetLevel = getGameMode(gameMode).getMaxExpLevelForWave(wave);
  const startingLevels = translatePreparedGhostLevels(members, targetLevel);
  const challengeText =
    challenges.length > 0 ? `${challenges.length} stored challenge setting(s)` : "no stored challenges";
  const scenario: DevScenario = {
    label: `Custom: ${trainer.name}`,
    description:
      `CUSTOM TRAINER #${trainer.id} "${trainer.name}"\n`
      + `Random wave ${wave} (difficulty ${difficulty}); player team from ${prepared.ghost.trainerName}\n`
      + `(run ended at wave ${prepared.ghost.waveReached}, ${members.length} mons, ${challengeText}, `
      + `${prepared.candidateCount} eligible ghost(s)).\n`
      + "DO: fight it. EXPECT the authored party, sprite + gender, aura, battle\n"
      + "music, title/name order, dialogue, weighted slots + slot-fill, RLA /\n"
      + "RLNA move rolls, shiny-lab looks and Insanity ability/innate overrides,\n"
      + `with the ghost's relative levels scaled to a Lv${targetLevel} top, plus held items.\n`
      + "Reset repeats this exact trainer, wave and team.",
    gameMode,
    startingLevels,
    setup: () => {
      resetDevOverrides();
      // Keep the force pending until immediately before newBattle(). Title-screen
      // cleanup during Reset cannot clear it before the trainer is installed.
      setPendingDevCustomTrainerForce(trainer.key);
      setErDifficulty(difficulty);
      setOverrides({
        STARTING_WAVE_OVERRIDE: wave,
        // Construct the roster at the real player cap from the outset. A late
        // turn-init rewrite leaves the UI and EXP progression out of sync.
        STARTING_LEVEL_OVERRIDE: targetLevel,
        // A random starting wave can legally roll an ME. The custom trainer
        // installer intentionally never hijacks MEs, so disable that roll for
        // this prepared fight or Restart can become an unrelated event.
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 0,
      });
      return members.map(ghostMemberStarter).filter((starter): starter is Starter => starter !== null);
    },
    postLaunch: () => {
      applyPreparedGhostChallenges(globalScene.gameMode, challenges);
    },
    onPartyReady: () => {
      applyPreparedGhostHeldItems(globalScene.getPlayerParty(), members);
    },
  };
  return { scenario };
}

/**
 * Build a {@linkcode DevScenario} that hands the PLAYER a copy of a custom
 * trainer's authored team (the "Use as my team" picker action) - a fast way to
 * drop into a battle with a ready team instead of hand-picking starters. The
 * opposing side is a normal wave-appropriate battle (no dev force armed).
 *
 * The player copy uses the REPRESENTATIVE members (variant 0 of every slot, ALL
 * slots, slot-fill ignored). Faithful fields: species / form, ability slot,
 * resolved moveset (incl. seeded RLA / RLNA tokens), shiny-lab looks (carried onto
 * the starter -> customPokemonData at launch), fusions and held items (applied on
 * battle start). KNOWN GAPS honestly noted: the Starter shape carries no per-mon
 * LEVEL (one STARTING_LEVEL for all - we use the max authored level or 60) and
 * fusion is stamped on battle start rather than at generation (stats fold in, but
 * the pre-battle summary sprite may not show the fusion until refreshed).
 */
export function buildErCustomTrainerTeamScenario(trainer: ErCustomTrainerResolved): DevScenario {
  const members = trainer.members;
  const difficulty: ErDifficulty = (trainer.difficulties[0] as ErDifficulty | undefined) ?? "ace";
  const mode = getGameMode(GameModes.CLASSIC);
  const plan = planErCustomTrainerLaunch(trainer, w => mode.isFixedBattle(w));
  const wave = plan.ok ? plan.plan.wave : Math.min(50, Math.max(1, trainer.minWave));
  const authoredLevels = members.map(m => m.level).filter((l): l is number => typeof l === "number");
  const level = authoredLevels.length > 0 ? Math.max(...authoredLevels) : 60;
  // A stable salt for the RLA / RLNA player-copy rolls (seed may be unset pre-launch).
  const seed = "custom-trainer-team";
  return {
    label: `Team: ${trainer.name}`,
    description:
      `USE AS MY TEAM - the authored party of #${trainer.id} "${trainer.name}"\n`
      + `is fielded as YOUR team (wave ${wave}, level ${level}, difficulty ${difficulty}).\n`
      + "A quick way into a battle with a ready team; the opposing side is a\n"
      + "normal wave. Species / form / ability / moves + shiny-lab / fusion /\n"
      + "held items carry; per-mon levels do not (one level for the whole team).",
    setup: () => {
      resetDevOverrides();
      setErDifficulty(difficulty);
      setOverrides({
        STARTING_WAVE_OVERRIDE: wave,
        STARTING_LEVEL_OVERRIDE: level,
      });
      return members.slice(0, 6).map((member, i) => {
        const moveIds = resolveErCustomTrainerMoveIds(seed, trainer.key, i, member);
        const starter = makeStarter(member.speciesId as SpeciesId, {
          formIndex: member.formIndex,
          abilityIndex: member.abilitySlot,
          moveset: moveIds.slice(0, 4) as MoveId[],
        });
        // Shiny-lab look: carried on the Starter -> customPokemonData at launch
        // (the same #785 representation player/ghost/co-op mons already use).
        if (member.shinyLook) {
          starter.shiny = true;
          starter.variant = 0;
          starter.erShinyLab = member.shinyLook;
          if (member.shinyName) {
            starter.erShinyLabName = member.shinyName;
          }
        }
        return starter;
      });
    },
    onBattleStart: () => {
      // Fusions + held items can't ride the Starter shape, so apply them onto the
      // built player party once both sides are summoned.
      const party = globalScene.getPlayerParty();
      party.forEach((mon, i) => {
        const member = members[i];
        if (!member) {
          return;
        }
        if (member.fusion) {
          applyErCustomTrainerFusion(mon, member.fusion);
          mon.calculateStats();
          mon.generateName();
        }
        for (const cfg of erCustomTrainerHeldModifierConfigs(member)) {
          let modifier: PokemonHeldItemModifier;
          if (cfg.modifier instanceof PokemonHeldItemModifierType) {
            modifier = cfg.modifier.newModifier(mon) as PokemonHeldItemModifier;
          } else {
            modifier = cfg.modifier;
            modifier.pokemonId = mon.id;
          }
          modifier.stackCount = cfg.stackCount ?? 1;
          globalScene.addModifier(modifier, true);
        }
      });
      globalScene.updateModifiers(true);
    },
  };
}

/**
 * The ONLY account whose save the Innate-Shrine scenario is allowed to edit. The
 * scenario force-locks an innate so the unlock is observable, which mutates +
 * persists starterData - we must NEVER do that to a tester's own save. Gated to
 * the maintainer's account; everyone else's save is left completely untouched.
 */
const INNATE_SHRINE_SAVE_EDIT_ACCOUNT = "Heraklines1";

/**
 * Dev-only (#514 Innate Shrine): guarantee the given starter species has at least
 * ONE innate slot still LOCKED, so the shrine's unlock is actually observable. If
 * every slot is already unlocked, LOCK the first one (clear its unlocked+enabled
 * bits) and persist.
 *
 * SAFETY: this WRITES + persists the save, so it runs ONLY on the maintainer's
 * account. On any other account it is a complete no-op - we never touch another
 * player's save. (The shrine itself still works for everyone; only this test
 * convenience-setup is account-gated.)
 */
function ensureLockedInnate(speciesId: SpeciesId): void {
  if (loggedInUser?.username !== INNATE_SHRINE_SAVE_EDIT_ACCOUNT) {
    return; // never modify anyone else's save
  }
  const rootId = getPokemonSpecies(speciesId).getRootSpeciesId();
  const data = globalScene.gameData?.starterData?.[rootId];
  if (!data) {
    return; // no starter data for this species -> all slots already locked
  }
  for (const slot of [0, 1, 2] as const) {
    if (isSlotUnlocked(data.passiveAttr, slot)) {
      data.passiveAttr &= ~(PASSIVE_SLOTS[slot].unlocked | PASSIVE_SLOTS[slot].enabled);
      void globalScene.gameData.saveSystem();
      return;
    }
  }
  // No unlocked slot found -> the species already has only locked innates. Good.
}

const MEGA_BRACELET: ModifierOverride = { name: "MEGA_BRACELET" };

/** Shared strong trio for the ER Colosseum gauntlet scenarios (#439). */
function colosseumTestParty(): Starter[] {
  return [
    makeStarter(SpeciesId.GARCHOMP, {
      moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
    }),
    makeStarter(SpeciesId.GARDEVOIR, {
      moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.CALM_MIND],
    }),
    makeStarter(SpeciesId.METAGROSS, {
      moveset: [MoveId.METEOR_MASH, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH, MoveId.EARTHQUAKE],
    }),
  ];
}

// --- mid-combat helpers (use inside onBattleStart) --------------------------

/** Set absolute stat stages on the active player Pokémon (e.g. [[Stat.ATK, 4]]). */
function boostPlayer(stages: [BattleStat, number][]): void {
  const p = globalScene.getPlayerPokemon();
  if (!p) {
    return;
  }
  for (const [stat, value] of stages) {
    p.setStatStage(stat, value);
  }
  p.updateInfo();
}

/** Set absolute stat stages on the active enemy Pokémon. */
function boostEnemy(stages: [BattleStat, number][]): void {
  const e = globalScene.getEnemyPokemon();
  if (!e) {
    return;
  }
  for (const [stat, value] of stages) {
    e.setStatStage(stat, value);
  }
  e.updateInfo();
}

/** Convenience: +n to every offensive/defensive/speed stage (not ACC/EVA). */
const ALL_MAIN_STATS: BattleStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];
const allStages = (n: number): [BattleStat, number][] => ALL_MAIN_STATS.map(s => [s, n]);

/**
 * Greater-Ability-Capsule repro: RUN-unlock every one of the lead's locked innates,
 * simulating the state where they are already FREE for the run (Youngster mode, or a
 * prior Ability Capsule). After this `canApplyAbility` is true for them, so the OLD
 * Greater Capsule (which keyed off the run-unlockable set) wrongly said "no effect".
 */
function runUnlockAllLeadInnates(): void {
  const p = globalScene.getPlayerPokemon();
  if (!p) {
    return;
  }
  for (const { slot } of erRunUnlockableInnateSlots(p)) {
    erRunUnlockAbilitySlot(p, slot);
  }
}

/** #387: hand the active player Pokemon community items (kind, stacks). */
function givePlayerCommunityItems(items: [ErCommunityItemKind, number][]): void {
  const player = globalScene.getPlayerPokemon();
  if (!player) {
    return;
  }
  for (const [kind, stacks] of items) {
    const mod = erCommunityItemModifierType(kind).newModifier(player) as PokemonHeldItemModifier | null;
    if (mod) {
      mod.stackCount = stacks;
      globalScene.addModifier(mod, true);
    }
  }
  globalScene.updateModifiers(true);
}

// --- scenarios --------------------------------------------------------------

// --- Battle-background art check (staging) ----------------------------------
// Hand-painted day/dusk/night backgrounds for volcano / ruins / wasteland /
// graveyard. Each scenario force-locks the biome + time of day so a tester sees
// the exact variant instantly; the enemy is a free-win Magikarp and the party is
// level 100, so you can also blow through waves and confirm the art persists.

/** Strong free-win party so a BG check is a relaxed look-around, not a fight. */
const bgCheckParty = (): Starter[] => [
  makeStarter(SpeciesId.RAYQUAZA, {
    moveset: [MoveId.DRAGON_ASCENT, MoveId.EXTREME_SPEED, MoveId.EARTHQUAKE, MoveId.SURF],
  }),
];

function bgCheckScenario(
  biomeName: string,
  biomeId: BiomeId,
  time: Exclude<TimeOfDay, TimeOfDay.ALL>,
  timeLabel: string,
  expect: string,
): DevScenario {
  return {
    label: `BG ${biomeName} · ${timeLabel}`,
    description:
      `Battle-background art check — ${biomeName} (${timeLabel}).\n`
      + "DO: just look at the background (free-win Magikarp; advance waves if you like).\n"
      + `EXPECT: ${expect}\n`
      + "The art must stay crisp, have NO battle-platform oval painted into the floor,\n"
      + "and NOT be double-darkened. Day / dusk / night each have their own image.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_BIOME_OVERRIDE: biomeId,
        STARTING_WAVE_OVERRIDE: 12,
        TIME_OF_DAY_OVERRIDE: time,
        STARTING_LEVEL_OVERRIDE: 100,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return bgCheckParty();
    },
  };
}

const BG_CHECK_SCENARIOS: DevScenario[] = [
  bgCheckScenario(
    "Volcano",
    BiomeId.VOLCANO,
    TimeOfDay.DAY,
    "day",
    "amber daytime sky, erupting volcano, glowing lava rivers.",
  ),
  bgCheckScenario("Volcano", BiomeId.VOLCANO, TimeOfDay.DUSK, "dusk", "purple-red dusk sky over the erupting volcano."),
  bgCheckScenario("Volcano", BiomeId.VOLCANO, TimeOfDay.NIGHT, "night", "dark night sky, the lava and embers glowing."),
  bgCheckScenario(
    "Power Plant",
    BiomeId.POWER_PLANT,
    TimeOfDay.DAY,
    "day",
    "overcast daytime sky over transformers, pylons and pipes.",
  ),
  bgCheckScenario(
    "Power Plant",
    BiomeId.POWER_PLANT,
    TimeOfDay.DUSK,
    "dusk",
    "orange-red sunset behind the power-plant machinery.",
  ),
  bgCheckScenario(
    "Power Plant",
    BiomeId.POWER_PLANT,
    TimeOfDay.NIGHT,
    "night",
    "starry night, the transformers and panels glowing blue.",
  ),
  bgCheckScenario(
    "Wasteland",
    BiomeId.WASTELAND,
    TimeOfDay.DAY,
    "day",
    "blue daytime sky over cracked dry earth and mesas.",
  ),
  bgCheckScenario(
    "Wasteland",
    BiomeId.WASTELAND,
    TimeOfDay.DUSK,
    "dusk",
    "orange/purple sunset over the cracked wasteland.",
  ),
  bgCheckScenario(
    "Wasteland",
    BiomeId.WASTELAND,
    TimeOfDay.NIGHT,
    "night",
    "starry night sky over the dark cracked wasteland.",
  ),
  bgCheckScenario("Graveyard", BiomeId.GRAVEYARD, TimeOfDay.DAY, "day", "the daytime graveyard art."),
  bgCheckScenario("Graveyard", BiomeId.GRAVEYARD, TimeOfDay.DUSK, "dusk", "the dusk graveyard art."),
  bgCheckScenario("Graveyard", BiomeId.GRAVEYARD, TimeOfDay.NIGHT, "night", "the night graveyard art."),
];

// --- One best-pick background per biome (staging eval) -----------------------
// A single hand-picked image now backs each of these biomes ({biome}_bg on
// er-assets). One scenario each drops you into the biome at daytime (so the art
// shows untinted) with a free-win Magikarp, just to eyeball how it looks.
function bgBiomeScenario(biomeName: string, biomeId: BiomeId, expect: string): DevScenario {
  return {
    label: `BG ${biomeName}`,
    description:
      `New best-pick battle background for ${biomeName}.\n`
      + "DO: just look at the background (free-win Magikarp; forced to daytime).\n"
      + `EXPECT: ${expect}`,
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_BIOME_OVERRIDE: biomeId,
        STARTING_WAVE_OVERRIDE: 12,
        TIME_OF_DAY_OVERRIDE: TimeOfDay.DAY,
        STARTING_LEVEL_OVERRIDE: 100,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return bgCheckParty();
    },
  };
}

const BG_BIOME_SCENARIOS: DevScenario[] = [
  bgBiomeScenario("Town", BiomeId.TOWN, "lush green field with a big shade tree."),
  bgBiomeScenario("Plains", BiomeId.PLAINS, "bright open rolling green hills."),
  bgBiomeScenario("Grass", BiomeId.GRASS, "lush green grass with trees and bushes."),
  bgBiomeScenario("Tall Grass", BiomeId.TALL_GRASS, "dense tall-grass undergrowth."),
  bgBiomeScenario("Forest", BiomeId.FOREST, "tree trunks and a leaf-litter forest path."),
  bgBiomeScenario("Sea", BiomeId.SEA, "bright open blue ocean."),
  bgBiomeScenario("Beach", BiomeId.BEACH, "sandy shore meeting blue sea under clouds."),
  bgBiomeScenario("Lake", BiomeId.LAKE, "calm tree-ringed lake with lily pads."),
  bgBiomeScenario("Mountain", BiomeId.MOUNTAIN, "brown rocky slopes dotted with pines."),
  bgBiomeScenario("Badlands", BiomeId.BADLANDS, "red rock canyon walls."),
  bgBiomeScenario("Cave", BiomeId.CAVE, "dark blue cavern with twin tunnels."),
  bgBiomeScenario("Desert", BiomeId.DESERT, "orange rolling sand dunes."),
  bgBiomeScenario("Ice Cave", BiomeId.ICE_CAVE, "icy snow-covered cave mouth."),
  bgBiomeScenario("Meadow", BiomeId.MEADOW, "flowery meadow with a big shade tree."),
  bgBiomeScenario("Dojo", BiomeId.DOJO, "stone arena floor with red banners."),
  bgBiomeScenario(
    "Abyss",
    BiomeId.ABYSS,
    "dark crystal cavern with glowing magma cracks (the night slice, shown at all times in Abyss).",
  ),
  bgBiomeScenario("Jungle", BiomeId.JUNGLE, "tropical waterfall over mossy rocks."),
  bgBiomeScenario("Temple", BiomeId.TEMPLE, "torchlit ancient stone interior."),
  bgBiomeScenario("Ruins", BiomeId.RUINS, "torchlit ancient stone interior (using the dungeon-torch art for now)."),
  bgBiomeScenario("Snowy Forest", BiomeId.SNOWY_FOREST, "snow-laden pines on a white slope."),
  bgBiomeScenario("Island", BiomeId.ISLAND, "sunny sandy shore and sea."),
];

export const DEV_SCENARIOS: DevScenario[] = [
  ...BG_CHECK_SCENARIOS,
  ...BG_BIOME_SCENARIOS,
  // ===========================================================================
  // Ability - Discipline lets you switch out WHILE rampaging (Outrage/Thrash)
  // ===========================================================================
  {
    label: "Ability: Discipline switches mid-rampage",
    description:
      "Discipline (2.65 dex): 'Can switch while rampaging. Can't be confused or\n"
      + "intimidated.' A rampage move (Outrage/Thrash/Petal Dance) normally locks you\n"
      + "in - the command menu never opens and you're forced to keep attacking. With\n"
      + "Discipline you keep the choice to switch out.\n"
      + "DO: turn 1, use Outrage on the foe. Turn 2 (still rampaging), open the command\n"
      + "menu, choose Pokemon, and switch to Magikarp.\n"
      + "EXPECT: the command menu OPENS on turn 2 and the switch goes through ('Come\n"
      + "back, Snorlax! Go! Magikarp!'). Before the fix you were locked into Outrage and\n"
      + "could not switch. (A mon WITHOUT Discipline stays locked - that's still correct.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5125), // Discipline
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY, // tanky, won't KO you mid-test
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.OUTRAGE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.MAGIKARP, {
          moveset: [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability - Radiance is immune to Dark moves, incl. moves made Dark at runtime
  // ===========================================================================
  {
    label: "Ability: Radiance blocks Dark moves",
    description:
      "Radiance (2.65 dex): '+20% accuracy; Dark moves fail when user is present.' The\n"
      + "field-wide 'Dark moves fail' half already worked for moves that are Dark by\n"
      + "default, but a move that becomes Dark at RUNTIME (here the foe's Deviate turns\n"
      + "its Normal Tackle into a Dark move) slipped past it and still damaged you - the\n"
      + "reported bug. The fix also makes the Radiance holder itself immune to Dark by\n"
      + "the move's real runtime type.\n"
      + "DO: let the foe (Gengar with Deviate) hit you with Tackle - Deviate makes it a\n"
      + "Dark move. Attack back with Body Slam over a couple of turns.\n"
      + "EXPECT: the foe's Dark-ified Tackle does NOTHING to your Snorlax (no damage /\n"
      + "'it doesn't affect Snorlax'). Before the fix it dealt full damage.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5173), // Radiance
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: erAbility(5501), // Deviate - Normal moves become Dark
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Tangling Husk (2.65 dex 955) — Fire-exempt protect
  // ===========================================================================
  {
    label: "Move: Tangling Husk lets Fire through",
    description:
      "Tangling Husk (2.65 dex 955): 'Protects against non-Fire-type moves. Slows\n"
      + "attackers on contact.' i.e. a Silk-Trap-style protect (blocks + drops a CONTACT\n"
      + "attacker's Speed -1) EXCEPT Fire-type moves bypass it and hit normally. It was\n"
      + "wired as a plain Silk Trap, which wrongly blocked Fire too.\n"
      + "The foe (Snorlax) uses Tangling Husk every turn (it announces 'protected itself'\n"
      + "when the husk goes up — that's the shield forming, not a block).\n"
      + "DO, over three turns, hit the foe with: (1) Flamethrower (Fire), (2) Surf\n"
      + "(non-Fire, non-contact), (3) Tackle (non-Fire, CONTACT).\n"
      + "EXPECT: (1) Flamethrower HITS — the foe takes damage despite the husk being up.\n"
      + "(2) Surf is BLOCKED — no damage. (3) Tackle is BLOCKED — no damage — AND your\n"
      + "Snorlax's Speed falls -1 (the slow-on-contact clause still fires on the moves it\n"
      + "does block). Vanilla Silk Trap is unchanged (it still blocks Fire).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        // Neutral enemy ability + passive so no ER innate adds a second protect.
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_PASSIVE_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [erMove(ErMoveId.TANGLING_HUSK)],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.FLAMETHROWER, MoveId.SURF, MoveId.TACKLE, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Dev tool — in-battle "Reset wave" command (dev/staging only)
  // ===========================================================================
  {
    label: "Dev: Reset wave command (reload like a lose-retry)",
    description:
      "Dev/staging-only command: the in-battle command box (Fight/Ball/Pokemon/Run)\n"
      + "now has a 3rd-row RESET that reloads the current wave, exactly like the retry\n"
      + "you get after a loss.\n"
      + "DO: in this wave-5 battle, deal some damage to the foe (and let it chip your\n"
      + "lead) over a turn or two. Then open the command menu, press DOWN past\n"
      + "Pokemon/Run to highlight RESET, and press the action button.\n"
      + "EXPECT: the screen fades, the wave reloads from its start - the foe is back at\n"
      + "FULL HP, your party HP/PP/status are restored to how they were when the wave\n"
      + "began, and you get a fresh command menu. No softlock, no black screen. The\n"
      + "RESET row must be reachable with Down/Up and the cursor lands on it cleanly.\n"
      + "(In production this 3rd row does not exist; the box stays its normal size.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BODY_SLAM],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.NUZZLE, MoveId.IRON_TAIL, MoveId.SURF],
        }),
      ];
    },
  },
  // ===========================================================================
  // Community challenge — allowedSpecies gates mid-run catches (not just starters)
  // ===========================================================================
  {
    label: "Community: off-list catch is blocked from the team",
    description:
      "Custom community challenges restrict the run to a whitelist of eligible Pokemon.\n"
      + "That whitelist must gate not just starter-select but also mid-run CATCHES - an\n"
      + "off-list mon should be caught (and dex-registered) but NOT added to your team,\n"
      + "exactly like a usage-tier (NU/PU) run. This scenario arms a whitelist that does\n"
      + "NOT include the wild Magikarp.\n"
      + "DO: throw Poke Balls at the wild Magikarp until it is caught (chip it first if a\n"
      + "ball fails; Magikarp catches easily).\n"
      + "EXPECT: the message reads 'Magikarp was caught, but was not added to your party\n"
      + "due to a challenge!' and Magikarp does NOT appear in your party (open Check Team\n"
      + "to confirm). It still counts in the Pokedex. Catching an ON-list mon would be added\n"
      + "normally. (Before the fix the off-list mon joined the team.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.NUZZLE, MoveId.IRON_TAIL, MoveId.QUICK_ATTACK],
        }),
      ];
    },
    onBattleStart: () => {
      // Arm a community whitelist that does NOT include Magikarp (root 129). Off-list
      // catches must be blocked from the party (caught + dex-registered only). Bulbasaur
      // stands in for "an eligible species"; the point is simply that Magikarp is absent.
      setCommunityAllowedSpecies([SpeciesId.BULBASAUR]);
    },
  },
  // ===========================================================================
  // Ability - Clear Body blocks SELF stat drops (Draco Meteor / Overheat)
  // ===========================================================================
  {
    label: "Ability: Clear Body blocks self stat drops (Draco Meteor)",
    description:
      "ER 2.65 dex: Clear Body (and Full Metal Body) give 'immunity to all stat\n"
      + "reductions from moves and abilities. Includes self stat drops from moves like\n"
      + "Overheat.' This is an ER divergence from mainline, where Clear Body does NOT\n"
      + "stop the user's own Draco Meteor / Overheat drop. Reported: a Flygon Redux with\n"
      + "Clear Body used Draco Meteor and still lost Sp. Atk. This Flygon has Clear Body\n"
      + "forced as its active ability.\n"
      + "DO: use Draco Meteor (then Overheat) on the Snorlax (it is bulky and survives).\n"
      + "EXPECT: Sp. Atk does NOT fall - Clear Body prevents the self-drop (a 'stats were\n"
      + "not lowered' style message). Open the summary / move again to confirm Sp. Atk is\n"
      + "still unboosted-but-not-negative. (Before the fix each use dropped Sp. Atk by 2.)\n"
      + "Incoming drops are unaffected: Clear Body still blocks an enemy Growl/Intimidate.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.CLEAR_BODY,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.FLYGON, {
          moveset: [MoveId.DRACO_METEOR, MoveId.OVERHEAT, MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW],
        }),
      ];
    },
  },
  {
    label: "(note) Pure Power boosts SP.ATK (special), not ATK",
    description:
      "ER 2.65 dex: Pure Power 'Doubles own Sp.Atk stat' (mainline doubles Atk). This\n"
      + "Medicham has Pure Power forced active + a same-type (Fighting) special and physical\n"
      + "move of similar power vs a Regigigas with equal Def/Sp.Def (110/110), so damage only\n"
      + "differs by which offensive stat is doubled.\n"
      + "DO: hit the Regigigas with AURA SPHERE (special), then BRICK BREAK (physical).\n"
      + "EXPECT: AURA SPHERE hits clearly HARDER - the boost is on Sp.Atk, not Atk (mainline\n"
      + "would be the reverse). A Pure Power mon is a SPECIAL attacker in ER.\n"
      + "AI-side (behind the scenes, not shown in this battle): the AI now builds SPECIAL-\n"
      + "leaning movesets for Pure Power mons instead of physical. Unit-tested in\n"
      + "test/tests/elite-redux/er-rebalance-attr-patches.test.ts ('Pure Power doubles SP.ATK').",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.PURE_POWER,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.REGIGIGAS,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MEDICHAM, {
          moveset: [MoveId.AURA_SPHERE, MoveId.BRICK_BREAK, MoveId.PSYCHIC, MoveId.ZEN_HEADBUTT],
        }),
      ];
    },
  },
  // ===========================================================================
  // UI — reward shop soft-lock
  // ===========================================================================
  {
    label: "Shop: no freeze with 'Shop' cursor + empty shop row (#853)",
    description:
      "#853 ('Page freezes completely after shop' / 'Evil Nugget corrupts game'). When\n"
      + "your Shop-cursor-target setting is 'Shop', the reward screen auto-moves the cursor\n"
      + "onto the shop row as it opens. On a wave with NO shop row (a x10 boss wave, or the\n"
      + "WASTELAND biome whose rule removes the heal row) the old code threw while placing the\n"
      + "cursor; the crash landed inside a promise so it left NO console error, the screen\n"
      + "never accepted input, and the game silently soft-locked right after the shop options\n"
      + "were rolled. This scenario starts in the Wasteland (empty shop row) on a normal wave.\n"
      + "SETUP (do this FIRST): Options > 'Shop cursor target' = 'Shop'.\n"
      + "DO: win the opening battle to reach the reward screen.\n"
      + "EXPECT: the reward screen opens and is INTERACTIVE - the cursor sits on the rewards\n"
      + "row (there is no shop row to land on) and you can pick/skip normally. Before the fix\n"
      + "the screen appeared but froze (no input, no error). Set the setting back to 'Rewards'\n"
      + "afterwards if you prefer. Regression: test/tests/elite-redux/er-shop-cursor-empty-row.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_BIOME_OVERRIDE: BiomeId.WASTELAND,
        STARTING_WAVE_OVERRIDE: 7,
        STARTING_LEVEL_OVERRIDE: 100,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.VOLTORB,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MEOWTH, {
          moveset: [MoveId.SLASH, MoveId.FAKE_OUT, MoveId.BITE, MoveId.FURY_SWIPES],
        }),
        makeStarter(SpeciesId.PERSIAN, {
          moveset: [MoveId.SLASH, MoveId.FAKE_OUT, MoveId.BITE, MoveId.FURY_SWIPES],
        }),
      ];
    },
  },
  // ===========================================================================
  // QoL — out-of-battle party reorder
  // ===========================================================================
  {
    label: "QoL: reorder party (Move in team check)",
    description:
      "ER party reorder: between waves you can SWAP party positions. DO: win the\n"
      + "opening battle to reach the rewards, open the party screen (Check Team), select\n"
      + "a mon and choose the new 'Move' option, then select a SECOND mon and choose\n"
      + "'Swap here'. Press B mid-move to cancel.\n"
      + "EXPECT: the two mons trade slots; everyone else stays put. The new order should\n"
      + "persist across Save & Quit + reload. The 'Move' option must NOT appear during a\n"
      + "battle's switch menu, and is hidden with a 1-mon party.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST] }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.NUZZLE, MoveId.IRON_TAIL, MoveId.SURF],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Forest ambush KO must force a switch (never command a fainted mon)
  // ===========================================================================
  {
    label: "Forest ambush: KO'd lead forces a switch (#629)",
    description:
      "#629 - 'H-Zoroark one-tapped me and now I can still attack with the fainted\n"
      + "mon.' In FOREST / SNOWY_FOREST a wild foe has a ~20% chance to SNATCH a free\n"
      + "turn-1 move when your lead is slower. Here a fast L100 foe one-shots your frail\n"
      + "L5 Magikarp lead.\n"
      + "DO: enter the battle and watch turn 1. The foe (faster) ambushes before you act.\n"
      + "EXPECT: when the ambush KOs Magikarp you are FORCED to switch in your benched\n"
      + "Pikachu BEFORE you get a command. You must NEVER be offered the Fight menu for\n"
      + "the fainted Magikarp. (Before the fix the command menu opened on the fainted\n"
      + "lead.) If the foe does NOT ambush (it loses the ~20% roll and just attacks on its\n"
      + "normal turn), reset and re-pick this scenario until the ambush fires.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 5, // frail, slow lead the foe outspeeds + one-shots
        STARTING_BIOME_OVERRIDE: BiomeId.FOREST,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.MAGIKARP, {
          moveset: [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.NUZZLE, MoveId.IRON_TAIL, MoveId.SURF],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Coil Up spends its boost on the first biting move USED (even if it
  // misses / is immune)
  // ===========================================================================
  {
    label: "Coil Up: boost spent on first biting move USED (#632)",
    description:
      "#632 - Coil Up gives your FIRST biting move +1 priority on entry, and that\n"
      + "boost is spent the first time you USE a biting move - even one that misses or\n"
      + "has no effect. Your slow Snorlax has Coil Up; the foe Excadrill is a Ground type\n"
      + "(immune to Electric).\n"
      + "DO: turn 1 use THUNDER FANG (a biting Electric move). It does NOTHING to the\n"
      + "Ground foe, but USING it still spends the Coil Up boost. Turn 2 use CRUNCH (also\n"
      + "biting).\n"
      + "EXPECT: on turn 2 the FASTER Excadrill moves first (your Crunch has no priority\n"
      + "left). Before the fix the boost wrongly persisted and Crunch went first on turn\n"
      + "2. (Tip: open Battle Info -> Speed Order, or just watch who attacks first.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145, // past the #419 BST cap
        STARTING_LEVEL_OVERRIDE: 50,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.COIL_UP),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.EXCADRILL, // Ground -> immune to Thunder Fang; faster than Snorlax
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.THUNDER_FANG, MoveId.CRUNCH, MoveId.BODY_SLAM, MoveId.REST],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Throat Chop blocks sound moves (incl. same-turn cancel)
  // ===========================================================================
  {
    label: "Throat Chop stops sound moves (same-turn cancel)",
    description:
      "Throat Chop fix: a throat-chopped Pokemon cannot use SOUND moves for 2 turns,\n"
      + "and a sound move already locked in THAT turn is CANCELLED (not just blocked at\n"
      + "selection). DO: turn 1, use Throat Chop on the enemy Exploud (your Weavile\n"
      + "outspeeds it). EXPECT: Exploud's Boomburst is cancelled that turn (it does not\n"
      + "fire), and on later turns Exploud cannot use Boomburst at all (it Struggles, as\n"
      + "that is its only move). Before the fix the same-turn Boomburst still went off.\n"
      + "(Festivities' dance<->sound interchange is covered by the er-festivities unit\n"
      + "tests; this scenario covers the Throat Chop sound-restriction itself.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the ER #419 elite BST-cap ladder (caps end at w100), so
        // the real Exploud (BST 600) spawns instead of being swapped down to a
        // frail Loudred. The bulky Exploud also survives Throat Chop, so the
        // same-turn Boomburst cancel is actually observable (it was one-shot before).
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.EXPLOUD,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BOOMBURST],
      });
      return [
        makeStarter(SpeciesId.WEAVILE, {
          moveset: [MoveId.THROAT_CHOP, MoveId.ICE_SHARD, MoveId.NIGHT_SLASH, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Display — Day/Night Tint toggle (force night so the effect is visible)
  // ===========================================================================
  {
    label: "Day/Night Tint toggle (forced night)",
    description:
      "Day/Night Tint setting. This battle is forced to NIGHT so the effect is\n"
      + "visible. DO: open Settings > Display > Day/Night Tint and flip it. EXPECT:\n"
      + "ON = the field is dark (night); OFF = the field snaps to daytime brightness\n"
      + "and stays bright, and the time-of-day icon appears (open the arena/weather\n"
      + "flyout to see it). The toggle should take effect immediately, no reload.\n"
      + "(Real time of day is unchanged - only the screen tint.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        TIME_OF_DAY_OVERRIDE: TimeOfDay.NIGHT,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.SURF],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Deadeye cannon/arrow moves never miss (even as an innate)
  // ===========================================================================
  {
    label: "Deadeye: Zap Cannon never misses (innate)",
    description:
      "Deadeye fix: arrow + cannon moves never miss, even when Deadeye is an INNATE\n"
      + "rather than the primary ability. The enemy Porygon-Z has Deadeye as an innate\n"
      + "and only knows Zap Cannon (a cannon move, 50% base accuracy). DO: stall with\n"
      + "Soft-Boiled and let it attack many turns. EXPECT: Zap Cannon NEVER misses.\n"
      + "Before the fix the innate (slot 2) was ignored, so it missed ~half the time.\n"
      + "(Enemies always have innates active, so no unlock is needed.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the ER #419 elite BST-cap ladder (caps end at w100). At
        // wave 5 the cap (420) swapped Porygon-Z (535) down to plain Porygon, which
        // has NO Deadeye innate, so Zap Cannon missed regardless of the fix. The
        // real Porygon-Z spawns at a late wave and keeps its Deadeye innate.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.PORYGON_Z,
        ENEMY_LEVEL_OVERRIDE: 40,
        ENEMY_MOVESET_OVERRIDE: [MoveId.ZAP_CANNON],
      });
      return [
        makeStarter(SpeciesId.BLISSEY, {
          moveset: [MoveId.SOFT_BOILED, MoveId.SEISMIC_TOSS, MoveId.THUNDER_WAVE, MoveId.TOXIC],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — High Tide follow-up Surf hits all foes (double battle)
  // ===========================================================================
  {
    label: "High Tide: follow-up Surf hits BOTH foes",
    description:
      "High Tide fix: after a Water move, the 50 BP Surf follow-up must hit ALL foes,\n"
      + "not just one. Double battle; both your mons have High Tide. DO: use Water Pulse\n"
      + "(single target) on one foe. EXPECT: the triggered follow-up Surf then hits BOTH\n"
      + "opposing Pokemon (before the fix it only hit one). Same fix covers Glacial\n"
      + "Rage's Blizzard follow-up.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145 + bulky Blissey foes (BST 540, past the #419 cap): the weak
        // Magikarp used to be one-shot by Water Pulse, and a fainted trigger-target
        // previously suppressed the follow-up entirely ("High Tide doesn't activate").
        // Tanky foes survive the Water Pulse so the spread Surf visibly hits BOTH.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 55,
        BATTLE_STYLE_OVERRIDE: "double",
        ABILITY_OVERRIDE: erAbility(ErAbilityId.HIGH_TIDE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GRENINJA, {
          moveset: [MoveId.WATER_PULSE, MoveId.SURF, MoveId.ICE_BEAM, MoveId.DARK_PULSE],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.WATER_PULSE, MoveId.IRON_TAIL],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — DRENCH makes the target move last in its bracket (2 turns)
  // ===========================================================================
  {
    label: "Drench: Water moves make a fast foe move last",
    description:
      "ER DRENCH status. Water moves have a chance to DRENCH the target (Hydro Pump\n"
      + "30%, Surf 20%, Water Gun 10%). A drenched Pokemon moves LAST within its\n"
      + "priority bracket for 2 turns, even if it is faster. The enemy Jolteon (130\n"
      + "Speed) far out-speeds your Blastoise (78) and normally acts first each turn.\n"
      + "DO: attack with Hydro Pump / Surf until the log shows 'Foe Jolteon became\n"
      + "drenched!'. EXPECT: for the next 2 turns the Jolteon moves AFTER your\n"
      + "Blastoise (same-priority moves), despite its higher Speed; then it goes\n"
      + "first again. Its Defenses are maxed so it survives to show the order flip.\n"
      + "(Amphibious / Old Mariner mons are immune and never get the message.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.JOLTEON,
        ENEMY_LEVEL_OVERRIDE: 60,
        // Growl keeps the foe acting each turn so the move-order flip is visible
        // in the log. (In ER Growl is a weak damaging move, but bulky Blastoise
        // shrugs it off, and its Atk drop is irrelevant to your Special attacks.)
        ENEMY_MOVESET_OVERRIDE: [MoveId.GROWL],
      });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.HYDRO_PUMP, MoveId.SURF, MoveId.WATER_GUN, MoveId.WHIRLPOOL],
        }),
      ];
    },
    // Max the fast foe's Defenses so it survives many Water hits and the 2-turn
    // move-order flip is observable across several turns.
    onBattleStart: () => {
      boostEnemy([
        [Stat.DEF, 6],
        [Stat.SPDEF, 6],
      ]);
    },
  },
  // ===========================================================================
  // Combat — Hydrate turns Normal moves into Water (+ Water STAB / drench)
  // ===========================================================================
  {
    label: "Hydrate: Normal moves become Water-type",
    description:
      "ER Hydrate ability (id 315): 'Changes the user's Normal-type moves to Water-\n"
      + "type. If the user is Water-type its Water-type moves have a 10% chance to\n"
      + "drench, otherwise it gains Water STAB.' Your Snorlax has Hydrate forced\n"
      + "active and is NOT Water-type, so it takes the Water-STAB branch. DO: use\n"
      + "Body Slam (a Normal move) on the Fire-type Arcanine. EXPECT: 'It's super\n"
      + "effective!' - Normal is neutral vs Fire, but Hydrate retyped Body Slam to\n"
      + "Water, so it hits for x2 AND gets Water STAB. (A Water-type Hydrate user\n"
      + "would instead have a 10% chance to drench with its Water moves.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        // Snorlax is Normal (not Water) -> the STAB branch, and its innates don't
        // matter because we force Hydrate as the ACTIVE ability.
        ABILITY_OVERRIDE: erAbility(ErAbilityId.HYDRATE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ARCANINE, // pure Fire -> Water is super effective
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.HYPER_BEAM, MoveId.SURF, MoveId.REST],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — ENRAGE makes the foe take 33% recoil on its attacks (until switch)
  // ===========================================================================
  {
    label: "Enrage: Swagger makes the foe hurt itself with recoil",
    description:
      "ER ENRAGE status. Swagger (and Flatter/Incite, Berserk DNA) ENRAGE the\n"
      + "target instead of confusing it: an enraged Pokemon takes 33% of the damage\n"
      + "it deals with its moves as RECOIL, is affected by Reckless (+20% power),\n"
      + "and stays enraged until it switches out. DO: use Swagger on the foe (it may\n"
      + "miss - retry until it lands), then let the foe attack you. EXPECT: 'Foe\n"
      + "Ursaring became enraged!' and its Attack sharply rises; then each time it\n"
      + "attacks you see 'is hurt by its rage!' as it takes 33% recoil. Your Snorlax\n"
      + "is bulky enough to tank the boosted hits. (Rock Head / Steel Barrel / Brute\n"
      + "Force foes are immune to the enrage recoil.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.URSARING, // strong physical attacker -> visible recoil
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BODY_SLAM],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SWAGGER, MoveId.REST, MoveId.BODY_SLAM, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // Multi-format — TRIPLE leads keep their slots across a wave (no vanishing lead)
  // ===========================================================================
  {
    label: "(triple) Leads keep their slots after a wave (no vanishing sprite)",
    description:
      "Multi-format TRIPLE. Reported: after a battle a lead's sprite briefly vanishes while the\n"
      + "other two remain, inconsistently. Cause: the wave-start reposition only fixed the LEFT\n"
      + "slot, so once a lead had fainted the RIGHT lead could stay stuck on CENTER, hidden behind\n"
      + "the middle mon (read as 'a sprite disappeared'). Now every on-field lead is repositioned\n"
      + "to its own slot at wave start.\n"
      + "DO: this is a 3-lead battle. Let ONE lead faint (let it take hits), send in your 4th mon,\n"
      + "WIN the wave, then continue to the NEXT wave.\n"
      + "EXPECT: at the next wave all three on-field leads sit on their OWN distinct spots\n"
      + "(left / center / right) - none stacked on or hidden behind another. (Unit-tested in\n"
      + "test/tests/elite-redux/er-triple-wave-transition.test.ts.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "triple",
        ENEMY_LEVEL_OVERRIDE: 5,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.SURF, MoveId.IRON_TAIL],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DESTINY_BOND],
        }),
      ];
    },
  },
  // ===========================================================================
  // Multi-format — a TRIPLE collapsing to a narrower next wave recalls ALL leads
  // ===========================================================================
  {
    label: "(note) Triple -> narrower next wave recalls the 2nd + 3rd leads",
    description:
      "Multi-format cleanup - verify in a TRIPLES-ONLY RUN, not this forced scenario (the 'triple'\n"
      + "override forces EVERY wave to a triple, so it can't show the transition itself; this just\n"
      + "drops you into a triple to inspect the layout). Reported: after a TRIPLE trainer battle,\n"
      + "when the NEXT wave is a narrower format (a single/double edge - finale, endless boss, or a\n"
      + "mystery-encounter battle), the player's 2nd and 3rd back sprites AND their HP bars stayed on\n"
      + "screen, overlapping the next intro ('the UI doesn't change, doesn't move away'). Cause: the\n"
      + "between-wave recall counted `1 + double` (= 1 for a triple, which carries double=false), so\n"
      + "only the LEFT lead was recalled. Now every lead the previous wave had on the field is\n"
      + "recalled, and any leftover on-field slot the new (narrower) format can't hold is returned at\n"
      + "the new wave's start.\n"
      + "DO: in a TRIPLES-ONLY run, WIN a TRIPLE trainer battle, then reach a SINGLE-format wave (a\n"
      + "boss / finale / mystery-encounter battle) immediately after.\n"
      + "EXPECT: the next battle shows ONLY the leads the new format holds (one back sprite + one HP\n"
      + "bar for a single) - no leftover 2nd/3rd player sprites or bars overlapping the intro.\n"
      + "(Unit-tested in test/tools/repro-triple-battle-bugs.test.ts '#2 player' cases; the render is\n"
      + "test/tools/render-ui-page.test.ts 'battle-field-triples-postwin'.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "triple",
        ENEMY_LEVEL_OVERRIDE: 20,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.SURF, MoveId.IRON_TAIL],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Status — BLEED is curable through any healing + any normal status cure
  // ===========================================================================
  {
    label: "Bleed is curable: any heal or any status cure removes it",
    description:
      "Bleed cure fix ('someone in prod cannot heal bleed through any means'). Bleed used to be\n"
      + "removable ONLY by a healing MOVE; per the new spec ALL ER statuses (bleed/frostbite/fear)\n"
      + "are curable through normal means (Full Heal/Restore, Lum, Heal Bell, cure abilities), and\n"
      + "bleed is ADDITIONALLY cured by ANY healing: any heal-over-time or healing move consumes\n"
      + "the heal to cure it (restores 0 HP that tick), and any Potion-family item cures it while\n"
      + "healing normally.\n"
      + "DO: the foe has Blood Stain (spreads bleed on contact) - hit it with a CONTACT move\n"
      + "(Body Slam/Crunch) so your mon starts bleeding. Then try each cure on separate runs:\n"
      + "(a) Recover, (b) Rest, (c) win and use the guaranteed shop Potion or Full Heal on the\n"
      + "bled mon.\n"
      + "EXPECT: every one of those removes the bleeding ('...was healed!'). Nothing leaves you\n"
      + "stuck bleeding.\n"
      + "(Regression: test/tests/elite-redux/er-bleed-persist-heal-cure.test.ts +\n"
      + "er-status-cure-generalization.test.ts.)",
    shopItems: [modifierTypes.POTION, modifierTypes.FULL_HEAL],
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_ABILITY_OVERRIDE: erAbility(ErAbilityId.BLOOD_STAIN),
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.RECOVER, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.SURF, MoveId.IRON_TAIL],
        }),
      ];
    },
  },
  // ===========================================================================
  // Multi-format — TRIPLE: lone-vs-lone survivors can still target each other
  // ===========================================================================
  {
    label: "(triple) Lone survivor vs lone foe: you can still hit it",
    description:
      "Triple targeting fix. Reported: 'you defeat all the enemy pokemon, sometimes there's one\n"
      + "pokemon left and you can't hit it' - with one player mon vs one foe in OPPOSITE wings,\n"
      + "neither could target the other (a stalemate). Cause: the faint recenter was VISUAL only;\n"
      + "targeting adjacency still used the original slot. Now a lone survivor counts as CENTER\n"
      + "for targeting on both sides.\n"
      + "DO: this is a 3v3 wild triple; your two side mons know Memento - self-faint BOTH (leaving\n"
      + "only your LEFT Snorlax), then KO the two foes you can reach (left + middle).\n"
      + "EXPECT: your lone mon slides to the middle and CAN target + hit the last remaining foe\n"
      + "(and it can hit you back). No unhittable staring contest.\n"
      + "(Unit-tested in test/tools/repro-triple-battle-bugs-3.test.ts '#6'.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "triple",
        ENEMY_LEVEL_OVERRIDE: 5,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.TACKLE, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.MEMENTO, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.MEMENTO, MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  // ===========================================================================
  // Multi-format — TRIPLE: Helping Hand works (was failing in every 3v3)
  // ===========================================================================
  {
    label: "(triple) Helping Hand works in a 3v3",
    description:
      "Triple move fix. Reported: 'Helping hand also doesn't work in 3v3' - it (and every other\n"
      + "multi-battle-only move: Follow Me, Ally Switch, Coaching, ...) printed 'But it failed!'\n"
      + "in a triple. Cause: their shared condition read `battle.double`, which is FALSE in a\n"
      + "triple. Now it checks the battler count.\n"
      + "DO: in this 3v3, use the LEFT mon's Helping Hand on your MIDDLE mon, then attack with the\n"
      + "middle mon. Also try the MIDDLE mon's Helping Hand (it can pick either wing).\n"
      + "EXPECT: 'X is ready to help Y!' - no 'But it failed!' - and the helped mon's attack hits\n"
      + "noticeably harder (1.5x). (Unit-tested in test/tools/repro-triple-battle-bugs-3.test.ts '#7'.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "triple",
        ENEMY_LEVEL_OVERRIDE: 20,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.HELPING_HAND, MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.HELPING_HAND, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.SURF],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.HELPING_HAND, MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Multi-format — TRIPLE: B-backout re-prompts ALL your mons (3rd not skipped)
  // ===========================================================================
  {
    label: "(triple) Backing out (B) doesn't skip your 3rd mon's move",
    description:
      "Triple command-menu fix. Reported: 'pick your first and second mons moves then change your\n"
      + "mind and press B to back up to the first mon again - it skips your third mons move\n"
      + "entirely'. Cause: the backout re-queued only slots 1+2 (a doubles leftover), dropping the\n"
      + "third slot's prompt; its command stayed empty and the turn ran without it.\n"
      + "DO: pick a move for mon 1 and mon 2, then on mon 3's menu press B twice to back up to\n"
      + "mon 1. Re-pick moves for ALL of them.\n"
      + "EXPECT: after re-picking mon 1 and mon 2, mon 3 IS prompted again, and all three mons act\n"
      + "this turn. (Unit-tested in test/tools/repro-triple-battle-bugs-3.test.ts '#8'.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "triple",
        ENEMY_LEVEL_OVERRIDE: 20,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.SURF, MoveId.IRON_TAIL],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Multi-format — TRIPLE: trainer reserves refill fainted slots (no 2v3)
  // ===========================================================================
  {
    label: "(triple) Trainer reserves refill fainted slots (no lasting 2v3)",
    description:
      "Triple trainer-battle guard. Reported: 'if the trainer has 4 pokemon, it will sometimes\n"
      + "fail to send out a new pokemon and will resume it as a 2v3'. The remaining live repro was\n"
      + "a CENTRE foe fainting while the trainer still had reserves, especially on a turn where a\n"
      + "different foe switched. Turn-end formation shifting moved a healthy wing into the queued\n"
      + "replacement slot, so the replacement benched that survivor and left the KO in the wing.\n"
      + "DO: fight triple TRAINER battles and KO the CENTRE foe while reserves remain. Also try it\n"
      + "on a turn where another foe voluntarily switches; use Earthquake/Surf for repeat attempts.\n"
      + "EXPECT: every KO'd slot is refilled while reserves remain - the enemy side never stays\n"
      + "short-handed. The two survivors shift inward only when there is NO legal reserve.\n"
      + "(Headless regression: repro-triple-battle-bugs-3 '#5e'.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "triple",
        ENEMY_LEVEL_OVERRIDE: 20,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.SURF, MoveId.IRON_TAIL],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Cotton Down lowers FOES' Speed only, not the ally (double battle)
  // ===========================================================================
  {
    label: "Cotton Down slows FOES only, not your ally",
    description:
      "Cotton Down fix. The ER 2.65 dex says 'Lowers the Speed of all FOES by one stage\n"
      + "when hit' - opponents only - but it was also slowing the holder's own ally.\n"
      + "DOUBLE battle; your side has Cotton Down, the bulky foes use a contact move.\n"
      + "DO: let the foes attack your mons for a turn or two, then open Battle Info ->\n"
      + "Speed Order (or read the stat-stage arrows).\n"
      + "EXPECT: every Cotton Down proc lowers ONLY the foes' Speed (-1 per hit). Your\n"
      + "partner's Speed must stay at 0. Before the fix your own ally was slowed too.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145 (past the #419 cap) + bulky Snorlax foes so they survive to show
        // the -1 Speed; bulky player mons survive the foe attacks across turns.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 55,
        BATTLE_STYLE_OVERRIDE: "double",
        ABILITY_OVERRIDE: AbilityId.COTTON_DOWN,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE], // contact move -> triggers Cotton Down "when hit"
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.EARTHQUAKE],
        }),
        makeStarter(SpeciesId.BLISSEY, {
          moveset: [MoveId.SOFT_BOILED, MoveId.SEISMIC_TOSS, MoveId.THUNDERBOLT, MoveId.ICE_BEAM],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Draco Missile hits both foes (double battle)
  // ===========================================================================
  {
    label: "Draco Missile: hits BOTH foes (doubles)",
    description:
      "Draco Missile fix. Its dex entry is half-done (short desc 'Not done yet.', target\n"
      + "field 0 = single target), but the authoritative longDescription says 'Hits both\n"
      + "foes on the field', so it must be a spread move. DOUBLE battle; your Salamence\n"
      + "knows Draco Missile. DO: select DRACO MISSILE. EXPECT: it hits BOTH enemy Pokemon\n"
      + "at once (before the fix it only hit one).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SALAMENCE, {
          moveset: [erMove(ErMoveId.DRAKE_MISSILE), MoveId.DRAGON_CLAW, MoveId.PROTECT, MoveId.ROOST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.PROTECT, MoveId.IRON_TAIL],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Hubris credits the holder's OWN KO, not a teammate's (#628)
  // ===========================================================================
  {
    label: "Hubris: only the holder's own KO boosts (#628)",
    description:
      "#628 - 'Hubris activates if your teammate pokemon dies; even if the pokemon\n"
      + "with it didn't kill the pokemon.' The on-KO boost (Hubris, Chilling Neigh,\n"
      + "Adrenaline Rush, ...) used to fire whenever ANY Pokemon fainted on the field.\n"
      + "DOUBLE battle vs two frail foes; your LEAD Bisharp has Hubris (+1 Sp.Atk on a\n"
      + "KO). DO: in the SAME turn, KO foe A with your LEAD and KO foe B with your ALLY.\n"
      + "EXPECT: the LEAD's Special Attack rises by exactly ONE stage - from its own KO\n"
      + "only. Before the fix it rose by TWO (it also counted the ally's KO). It must\n"
      + "NOT rise at all on a turn where only the ally / only the foe scores a faint.\n"
      + "(Forsaken Heart is the lone exception that SHOULD boost on any faint.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "double",
        // Both party mons get Hubris (override is party-wide); watch the LEAD.
        ABILITY_OVERRIDE: erAbility(ErAbilityId.HUBRIS),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5, // frail - any lead attack OHKOs it
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BISHARP, {
          moveset: [MoveId.IRON_HEAD, MoveId.SUCKER_PUNCH, MoveId.BRICK_BREAK, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Mega Vanilluxe Multi-headed strikes 3 times
  // ===========================================================================
  {
    label: "Mega Vanilluxe Multi-headed hits 3x",
    description:
      "Multi-headed fix: a mega that GAINS a 3rd head (Vanilluxe, Mawile, Shuckle)\n"
      + "should strike 3 times (~100% / 20% / 15%), not 2 (100% / 25%). Your Vanilluxe is\n"
      + "its MEGA form with Multi-headed forced ON, facing a bulky Blissey that tanks the\n"
      + "volley. DO: attack with ICE BEAM (a single-target move). EXPECT: it strikes\n"
      + "THREE times per use (watch the hit/damage count), not twice. Before the fix the\n"
      + "mega head-count lookup missed and it only hit twice.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the ER #419 elite BST-cap ladder (caps end at w100) so the
        // bulky Blissey (BST 540) spawns intact to soak all 3 strikes - a frail mon
        // would faint on the first hit and hide the extra heads.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 60,
        // Mega Vanilluxe carries Multi-headed as an INNATE, not an active ability (its
        // actives are Snow Cloak / Glacial Rage / Mirror Armor), and player innates are
        // not unlocked in a dev scenario - so the mega alone strikes ONCE. Force
        // Multi-headed active to exercise the mega head-count fix. Verified headless:
        // mega form + this override -> Ice Beam hits 3x (~100/20/15%); without it, 1x.
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MULTI_HEADED),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        // Spawn directly in the Mega form (formIndex "mega") - megas are permanent in
        // this fork (evolution-like), so the form sticks at summon. The mega form is
        // what carries the 3-head count; the ABILITY_OVERRIDE above turns Multi-headed
        // on so that count is actually exercised.
        makeStarter(SpeciesId.VANILLUXE, {
          formIndex: formIndexContaining(SpeciesId.VANILLUXE, "mega"),
          moveset: [MoveId.ICE_BEAM, MoveId.FLASH_CANNON, MoveId.FREEZE_DRY, MoveId.MIRROR_COAT],
        }),
      ];
    },
  },
  // ===========================================================================
  // Presentation — construction-time vanilla mega (Mega Garchomp) sprite + cry
  // ===========================================================================
  {
    label: "Mega Garchomp: sprite + cry at battle build",
    description:
      "Construction-time vanilla mega presentation (showdown teambuilder path). A\n"
      + "vanilla-species mega picked as the FIELDED stage is built straight into its\n"
      + "mega form at battle build (not a mid-run form change). The mega SPRITE lives\n"
      + "under ER slug art but the CRY still uses the vanilla scheme (cry/445-mega),\n"
      + "which the sprite redirect wrongly skipped - so Mega Garchomp came out MUTE and\n"
      + "logged 'cry/445-mega not found'.\n"
      + "\n"
      + "DO: just start the battle and watch your lead get sent out (free-win Magikarp).\n"
      + "EXPECT: the send-out says 'Go! Mega Garchomp!', the field sprite is the MEGA\n"
      + "Garchomp (bulkier, red arm-blades), and its CRY PLAYS on entry - no silent\n"
      + "send-out, no 'cry/445-mega not found' in the console. (The HP-bar panel showing\n"
      + "'Garchomp' without the 'Mega' prefix is intended - the battle-info panel omits\n"
      + "the form name for every form.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 100,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        // Spawn directly in the Mega form (formIndex "mega") - megas are permanent in
        // this fork, so the form sticks at summon with no stone / manual evolve. This is
        // the same construction-time path the showdown teambuilder fields a mega stage.
        makeStarter(SpeciesId.GARCHOMP, {
          formIndex: formIndexContaining(SpeciesId.GARCHOMP, "mega"),
          moveset: [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Terapagos Terastallizes into its PERMANENT Primal form
  // ===========================================================================
  {
    label: "Terapagos: Terastallize -> permanent Primal",
    description:
      "Terapagos 'Primal permanent' model. Terapagos used to do NOTHING on Tera\n"
      + "(ER replaced its ability kit, so the vanilla Tera Shift -> Terastal/Stellar\n"
      + "chain was dead). Now Terastallizing it morphs it PERMANENTLY into Terapagos\n"
      + "PRIMAL, exactly like a mega/primal - it does NOT revert when Tera ends.\n"
      + "\n"
      + "DO: your Terapagos starts in its base Normal form. Pick the TERA command\n"
      + "(the Tera Orb is provided) and attack with any move to Terastallize it.\n"
      + "EXPECT: it transforms into Terapagos Primal (new sprite + name + stats/\n"
      + "abilities). Win the battle (or check the next wave): it STAYS Primal - it\n"
      + "never reverts to Normal. It also can't Tera again (it is now a Primal form).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        // Grant the Tera Orb (TerastallizeAccessModifier) so the TERA command is
        // available in-battle - that is the player action that triggers the
        // permanent base "" -> "primal" form change (TeraPhase -> tera trigger).
        STARTING_MODIFIER_OVERRIDE: [{ name: "TERA_ORB" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        // Spawn in the BASE Normal form (formIndex 0). The Primal form is reached
        // ONLY by Terastallizing in battle - not at summon (unlike spawn-in megas).
        makeStarter(SpeciesId.TERAPAGOS, {
          moveset: [MoveId.TERA_STARSTORM, MoveId.EARTH_POWER, MoveId.TRI_ATTACK, MoveId.CALM_MIND],
        }),
      ];
    },
  },
  // ===========================================================================
  // UI — Redux Litwick line renders its own sprite (not Pansear)
  // ===========================================================================
  {
    label: "Redux Litwick shows its own sprite (not Pansear)",
    description:
      "Sprite fix: the Redux Litwick line rendered the Redux Pansear line's art in the\n"
      + "Pokedex / starter / party UI (the species-level sprite bridge only covered mega\n"
      + "forms, not redux forms). DO: from this battle open the menu > Check Team and\n"
      + "view the Redux Litwick's summary/sprite (also check it in the Pokedex). EXPECT:\n"
      + "the Litwick redux art, NOT a Pansear/Simisear monkey. The battle field was\n"
      + "already correct; this verifies the UI screens.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.LITWICK, {
          formIndex: formIndexByKey(SpeciesId.LITWICK, "redux"),
          moveset: [MoveId.FIRE_BLAST, MoveId.SHADOW_BALL, MoveId.ENERGY_BALL, MoveId.FLAME_BURST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.SURF],
        }),
      ];
    },
  },
  // ===========================================================================
  // Relics — Cursed Idol -50% HP must NOT re-apply on reload
  // ===========================================================================
  {
    label: "Cursed Idol: -50% does NOT re-apply on reload",
    description:
      "Cursed Idol persistence fix. DO: win the opening battle and TAKE the Cursed\n"
      + "Idol relic from the shop. In the NEXT battle your lead (Snorlax) gets a free\n"
      + "Substitute; SWITCH to your 2nd mon (Blissey) - it arrives at HALF HP (note the\n"
      + "exact HP). Now open the menu, SAVE & QUIT, RELOAD the page and CONTINUE.\n"
      + "EXPECT: after Continue, Blissey's HP is UNCHANGED - it is NOT halved a second\n"
      + "time, and no new Substitute appears (before the fix, rejoining re-applied the\n"
      + "-50%). The per-battle relic state now persists across the reload.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST] }),
        makeStarter(SpeciesId.BLISSEY, {
          moveset: [MoveId.SEISMIC_TOSS, MoveId.SOFT_BOILED, MoveId.THUNDER_WAVE, MoveId.TOXIC],
        }),
      ];
    },
    shopItems: [modifierTypes.ER_RELIC_CURSED_IDOL],
  },
  {
    label: "Cursed Idol doubles: left lead gets the Substitute (#609)",
    description:
      "#609 - in a DOUBLE battle the Cursed Idol must give the free Substitute to\n"
      + "your LEFT lead (slot 0, the first you sent out) and HALVE the RIGHT lead's\n"
      + "HP (slot 1). EXPECT: Snorlax (left) is shrouded in a free Substitute; Blissey\n"
      + "(right) enters at half HP. Before the fix the FASTER lead got the Substitute\n"
      + "and the player's actual lead was the one drained.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_CURSED_IDOL" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.PROTECT, MoveId.REST] }),
        makeStarter(SpeciesId.BLISSEY, {
          moveset: [MoveId.SEISMIC_TOSS, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.TOXIC],
        }),
      ];
    },
  },
  // ===========================================================================
  // Pokemon - Mega Shedinja always has exactly 1 HP (its whole identity)
  // ===========================================================================
  {
    label: "Mega Shedinja has 1 HP (not 95)",
    description:
      "Shedinja (every form, including Mega Shedinja) always has exactly 1 HP - that is\n"
      + "its whole identity. Reported bug: a Mega Shedinja had 95 HP at level 64. Its kit\n"
      + "(Cheating Death / Magic Guard) replaces Wonder Guard, so the 1-HP rule was skipped.\n"
      + "This party is a level-64 Mega Shedinja.\n"
      + "DO: look at your Mega Shedinja's HP bar, or open Check Team / the summary.\n"
      + "EXPECT: its max HP is 1 (a single sliver). Before the fix it read ~95.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 64,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SHEDINJA, {
          formIndex: formIndexContaining(SpeciesId.SHEDINJA, "mega"),
          moveset: [MoveId.SHADOW_SNEAK, MoveId.X_SCISSOR, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // Relic - Stormglass re-applies its weather EVERY battle (not just the first)
  // ===========================================================================
  {
    label: "Relic: Stormglass weather refreshes every battle",
    description:
      "Stormglass forces your chosen weather for 5 turns at the START of every battle.\n"
      + "Reported bug: it only worked the FIRST battle and never again (the weather carried\n"
      + "over from the prior battle, so the re-apply was a no-op that never refreshed it).\n"
      + "You are holding Stormglass from the start.\n"
      + "DO: on the first battle you are prompted to pick a weather - pick one and note it is\n"
      + "active. One-shot the Magikarp (Earthquake), advance, and start the NEXT battle.\n"
      + "EXPECT: the SAME weather is active again at the start of battle 2 (and every battle\n"
      + "after), each time for 5 turns. Before the fix the weather was gone from battle 2 on.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 100,
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_STORMGLASS" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Abilities — Multi-Headed strikes per head on a SINGLE-turn charge move (#617)
  // ===========================================================================
  {
    label: "Multi-Headed + instant charge move strikes per head (#617)",
    description:
      "#617 - a Multi-Headed mon's charge move that resolves in a SINGLE turn must still\n"
      + "strike once per head. Dodrio is 3-headed and holds a Power Herb (Accelerate skips\n"
      + "the charge the same way). DO: use Dive - the Power Herb skips the charge turn so it\n"
      + "fires instantly. EXPECT: Dive strikes THREE times (3 heads; 2nd/3rd at reduced\n"
      + "power), KO-ing or chunking the Snorlax. Before the fix the charge move was treated\n"
      + "as a two-turn move, so Multi-Headed added NO extra strikes (Dive hit once).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the #419 elite BST-cap ladder so the bulky Snorlax spawns and
        // survives 3 hits (instead of devolving to a frail Munchlax at a low wave).
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 60,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MULTI_HEADED),
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "ER_POWER_HERB" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.DODRIO, { moveset: [MoveId.DIVE, MoveId.DRILL_PECK, MoveId.FLY, MoveId.QUICK_ATTACK] }),
      ];
    },
  },
  // ===========================================================================
  // Abilities — Frisk reveals items + locks only the FIRST item
  // ===========================================================================
  {
    label: "Frisk: reveals items, locks only the FIRST item",
    description:
      "ER Frisk fix. Your lead has Frisk; the enemy Snorlax holds Leftovers (first)\n"
      + "AND a Sitrus Berry. DO: start the battle, read the entry message, then chip\n"
      + "the enemy. EXPECT: Frisk reveals the enemy's HELD ITEMS (not its ability), and\n"
      + "only the FIRST item (Leftovers) is locked for ~2 turns - the enemy gets NO\n"
      + "Leftovers recovery for those turns, then it heals again; its Sitrus Berry still\n"
      + "works. Before the fix Frisk revealed the ABILITY and locked ALL items.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the ER #419 elite BST-cap ladder (caps end at w100) so the
        // bulky Snorlax (BST 540) spawns instead of devolving to a frailer Munchlax.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 50,
        ABILITY_OVERRIDE: AbilityId.FRISK,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }, { name: "BERRY", type: BerryType.SITRUS }],
      });
      return [
        makeStarter(SpeciesId.GRENINJA, {
          moveset: [MoveId.WATER_SHURIKEN, MoveId.ICE_BEAM, MoveId.DARK_PULSE, MoveId.U_TURN],
        }),
      ];
    },
  },
  // ===========================================================================
  // Abilities — Corrosion makes the holder's Poison moves SE vs Steel
  // ===========================================================================
  {
    label: "Corrosion: Poison moves are super effective vs Steel",
    description:
      "ER Corrosion fix (dex 212: 'Poison is super effective vs Steel. Can poison any\n"
      + "type.'). Your Roselia has Corrosion and Acid Spray; the enemy is Skarmory\n"
      + "(Steel/Flying). DO: use ACID SPRAY on the Skarmory. EXPECT: it's SUPER EFFECTIVE\n"
      + "(big damage, 'It's super effective!'), NOT 'It doesn't affect Skarmory'. Before\n"
      + "the fix only the status half was wired, so Poison damaging moves still did 0 to\n"
      + "Steel even with Corrosion. (Your Sludge Bomb is SE too; Tackle stays resisted.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the ER #419 elite BST-cap ladder (caps end at w100). At
        // wave 5 the cap (420) swapped Skarmory (465, no prevolution) for a random
        // under-cap species, so the Steel-type target the test needs vanished.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 60,
        ABILITY_OVERRIDE: AbilityId.CORROSION,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SKARMORY,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ROSELIA, {
          moveset: [MoveId.ACID_SPRAY, MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN, MoveId.TACKLE],
        }),
      ];
    },
  },
  {
    label: "Liquid Voice: only NORMAL-type sound moves become Water",
    description:
      "ER Liquid Voice fix (dex: 'Sound moves get a 1.2x boost and become Water if\n"
      + "Normal'). Your Exploud has Liquid Voice; the enemy is Camerupt (Fire/Ground).\n"
      + "DO: use HYPER VOICE, then BUG BUZZ. EXPECT: Hyper Voice (a Normal sound move) is\n"
      + "now WATER and hits for 4x super effective; Bug Buzz (a NON-Normal sound move)\n"
      + "stays BUG and is weak (0.5x) - it must NOT turn Water. Both hit ~1.2x harder than\n"
      + "normal. Before the fix EVERY sound move turned Water, so Bug Buzz also hit 4x.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the ER #419 elite BST-cap ladder (caps end at w100) so the
        // Fire/Ground Camerupt (BST 460) spawns intact (the 4x super-effective Water
        // read the test relies on), instead of devolving to Numel.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 60,
        ABILITY_OVERRIDE: AbilityId.LIQUID_VOICE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CAMERUPT,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.EXPLOUD, {
          moveset: [MoveId.HYPER_VOICE, MoveId.BUG_BUZZ, MoveId.SNARL, MoveId.BOOMBURST],
        }),
      ];
    },
  },
  {
    label: "Wispywaspy School: Hivemind form (Locust Swarm) + trainer fix",
    description:
      "Wispywaspy School (Locust Swarm). Per the dex 'Changes into Hivemind form until\n"
      + "1/4 HP or less': it is the strong HIVEMIND form while ABOVE 1/4 HP and reverts to\n"
      + "the base form at/below 1/4. DO: at high HP take a hit (Blissey's weak Water Gun)\n"
      + "and watch it school to HIVEMIND; then drop it below 1/4 HP and watch it REVERT.\n"
      + "Trainer fix (the reported bug): gym leaders used to field the Hivemind DUMP\n"
      + "species directly - no moves, only Struggle. They now spawn base Wispywaspy with a\n"
      + "real moveset, which schools, so a gym Wispywaspy fights normally.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the ER #419 elite BST-cap ladder (caps end at w100) so the
        // bulky Blissey (BST 540) spawns to soak hits while you watch the player's
        // Wispywaspy school, instead of devolving down to Happiny.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 60,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.LOCUST_SWARM),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_MOVESET_OVERRIDE: [MoveId.WATER_GUN],
      });
      return [
        makeStarter(erSpecies(ErSpeciesId.WISPYWASPY), {
          moveset: [MoveId.LICK, MoveId.BUG_BITE, MoveId.PROTECT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Decorate: buffs the WHOLE user side (doubles)",
    description:
      "ER Decorate (dex #705: 'Damages foes. Raises ALLIES' Attack, Special Attack, and\n"
      + "Crit by 2 stages'). DOUBLE battle; your lead is Gardevoir, your ally is KECLEON.\n"
      + "DO: have Gardevoir use DECORATE on a foe. EXPECT: it damages the foe AND BOTH your\n"
      + "mons (Gardevoir AND Kecleon) get +2 Atk, +2 SpAtk and a crit boost (open Summary\n"
      + "to confirm Kecleon's stages). Before the fix only the user was boosted, not the ally.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.DECORATE, MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.KECLEON, {
          moveset: [MoveId.SHADOW_SNEAK, MoveId.POWER_GEM, MoveId.PROTECT, MoveId.RECOVER],
        }),
      ];
    },
  },
  {
    label: "Retribution Blow: auto Hyper Beam, NO recharge",
    description:
      "ER Retribution Blow (ability 407): when a foe boosts its stats you auto-fire a\n"
      + "150 BP Hyper Beam that has NO recharge. Your Snorlax has Retribution Blow; the\n"
      + "enemy Scizor only uses SWORDS DANCE. DO: let Scizor boost (the auto Hyper Beam\n"
      + "fires at it), then on YOUR next turn pick a move. EXPECT: you act NORMALLY - you\n"
      + "are NOT stuck 'must recharge'. Before the fix the triggered Hyper Beam locked you.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 145: past the ER #419 elite BST-cap ladder (caps end at w100) so
        // Scizor (BST 500) spawns intact instead of being devolved/swapped.
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 60,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.RETRIBUTION_BLOW),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SCIZOR,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SWORDS_DANCE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // ===========================================================================
  // ER ability fixes — Flammable Coat / Parasitic Spores / Old Mariner / Loose Thorns
  // ===========================================================================
  {
    label: "Flammable Coat: Lumbering Sloth -> Engulfed on fire",
    description:
      "ER Flammable Coat (669): 'Transforms Lumbering Sloth into its Engulfed form when\n"
      + "hit by Fire-type moves or when using Fire-type moves.' Your Lumbering Sloth has\n"
      + "Flammable Coat + Ember; the enemy Snorlax uses Ember.\n"
      + "DO: turn 1 use EMBER (or just let Snorlax's Ember hit you). EXPECT: Lumbering Sloth\n"
      + "transforms into its ENGULFED form (sprite + stats change) and STAYS engulfed - it\n"
      + "is a one-way change. Using a non-Fire move never transforms it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 50,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FLAMMABLE_COAT),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.EMBER],
      });
      return [
        makeStarter(erSpecies(ErSpeciesId.LUMBERING_SLOTH), {
          moveset: [MoveId.EMBER, MoveId.TACKLE, MoveId.PROTECT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Parasitic Spores: spread on contact + 1/8 chip",
    description:
      "ER Parasitic Spores (609, Parasect): 'Each turn, affected Pokemon lose 1/8 max HP\n"
      + "(Ghost immune). When using contact moves, spread spores to the target. Spores\n"
      + "persist until switch-out.' Your Parasect has Parasitic Spores + Tackle (contact).\n"
      + "DO: TACKLE the Snorlax. EXPECT: Snorlax is now infected and loses 1/8 HP EACH turn\n"
      + "(on top of the field aura) and keeps bleeding HP even if you stop attacking. A\n"
      + "Ghost-type target (swap the enemy) is IMMUNE and never gets the spores.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 50,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.PARASITIC_SPORES),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PARASECT, {
          moveset: [MoveId.TACKLE, MoveId.SCRATCH, MoveId.PROTECT, MoveId.SPORE],
        }),
      ];
    },
  },
  {
    label: "Loose Thorns: Creeping Thorns hazard on contact",
    description:
      "ER Loose Thorns (909): 'Sets Creeping Thorns when hit by contact.' Creeping Thorns\n"
      + "is an entry hazard that BOTH damages a grounded switch-in AND makes it BLEED. Your\n"
      + "Snorlax has Loose Thorns; the enemy is a trainer whose lead uses TACKLE (contact).\n"
      + "DO: let the foe TACKLE you (Creeping Thorns deploys on the FOE's side), KO the lead\n"
      + "so the trainer's next mon switches in. EXPECT: the incoming foe takes hazard damage\n"
      + "AND starts bleeding (ER_BLEED chip each turn). A Rock/Ghost switch-in does not bleed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.LOOSE_THORNS),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MIGHTYENA,
        ENEMY_LEVEL_OVERRIDE: 15,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Old Mariner: Water STAB (drench immunity is a marker)",
    description:
      "ER Old Mariner (620, Dreadnaut): Seaweed (half Fire dmg + 2x vs Fire with Grass\n"
      + "moves while Grass-type) + Water STAB regardless of typing + 'immunity to being\n"
      + "drenched'. Your Dreadnaut has Old Mariner + Surf. DO: use SURF. EXPECT: Surf gets\n"
      + "the 1.5x STAB boost even though Dreadnaut is not Water-type.\n"
      + "NOTE: DRENCH is not yet implemented engine-wide (no move applies it), so the drench\n"
      + "immunity is a correct-by-construction MARKER - nothing to observe in-battle yet.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 60,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.OLD_MARINER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(erSpecies(ErSpeciesId.DREADNAUT), {
          moveset: [MoveId.SURF, MoveId.LEAF_BLADE, MoveId.FLAMETHROWER, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // QoL — level-up Move Learn panel
  // ===========================================================================
  {
    label: "QoL: level-up Move Learn panel (mass evolve to 17)",
    description:
      "ER QoL - the level-up Move Learn panel (LEARNABLE | CURRENT) replaces the\n"
      + "per-move text barrage. A 6-mon team of starters at LEVEL 16 (all evolve at 16).\n"
      + "KO the Magikarp, then in the FIRST shop take RARER CANDY - it levels the WHOLE\n"
      + "team +1, so everyone hits 17 at once.\n"
      + "EXPECT: for each mon that learns a move at 17 the panel opens - pick a move\n"
      + "(free slot learns silently; a full set asks which CURRENT move to overwrite),\n"
      + "the list thins down, the highlighted move's type/BP/PP/desc show, and Cancel\n"
      + "asks to confirm. Then all six EVOLVE. No softlock, no text barrage.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 16,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
      });
      const base = (a: MoveId, b: MoveId): MoveId[] => [a, b, MoveId.TACKLE, MoveId.GROWL];
      return [
        makeStarter(SpeciesId.BULBASAUR, { moveset: base(MoveId.VINE_WHIP, MoveId.ABSORB) }),
        makeStarter(SpeciesId.CHARMANDER, { moveset: base(MoveId.EMBER, MoveId.SCRATCH) }),
        makeStarter(SpeciesId.SQUIRTLE, { moveset: base(MoveId.WATER_GUN, MoveId.BUBBLE) }),
        makeStarter(SpeciesId.TREECKO, { moveset: base(MoveId.ABSORB, MoveId.SCRATCH) }),
        makeStarter(SpeciesId.MUDKIP, { moveset: base(MoveId.WATER_GUN, MoveId.MUD_SLAP) }),
        makeStarter(SpeciesId.TORCHIC, { moveset: base(MoveId.EMBER, MoveId.PECK) }),
      ];
    },
    shopItems: [modifierTypes.RARER_CANDY, modifierTypes.RARER_CANDY],
  },
  {
    label: "(note) Showdown Set Editor: navigation + mega stats + shiny (verify in versus teambuilder)",
    description:
      "UI/FLOW fix - this is a NON-battle screen, so verify it in the SHOWDOWN (versus) TEAMBUILDER, not\n"
      + "here: Title -> Showdown -> pick/confirm a mon to open the full-screen Set Editor. CHECK:\n"
      + "1) SIDE BUTTONS (Left/Right) always cycle the STAGE/form now - they are no longer hijacked by the\n"
      + "   focused row. The 4 hotkeys work: F=Stage, R=Shiny, E=Ability, N=Nature.\n"
      + "2) ESCAPE leaves the editor back to the grid from ANY state (a field OR an open move/item search).\n"
      + "   Previously Escape was dead here and a follow-up press hit the grid's Start -> an EMPTY versus\n"
      + "   battle (softlock). It must NEVER start a battle on the way out.\n"
      + "3) MEGA STATS: cycle to a mega stage (e.g. Mega Venusaur / Mega Garchomp) - the BASE STATS panel\n"
      + "   must show the MEGA form's spread, DIFFERENT from the base form (previously every mega showed the\n"
      + "   base stats). Sprite + innates + the auto-locked Mega Stone item follow the mega form too.\n"
      + "4) SHINY: a SINGLE colour-coded shiny star sits in the sprite's corner (R cycles off -> owned\n"
      + "   tiers, default = your highest owned rarity), like starter select.\n"
      + "Rendered + asserted headlessly: test/tools/render-ui-page.test.ts (showdown-editor* incl.\n"
      + "showdown-editor-mega) + test/tests/elite-redux/showdown/showdown-editor-input.test.ts (Escape-leave\n"
      + "+ ability cycling).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.OUTRAGE, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "(note) Showdown Team Menu + Set Editor: G-V cycling / grid-exit / rename Backspace / rank chip",
    description:
      "UI/FLOW fixes - NON-battle screens, so verify at Title -> Showdown (the TEAM MENU) and inside a mon's\n"
      + "SET EDITOR, not here. Live fixes:\n"
      + "1) RENAME BACKSPACE (Team Menu): hover a saved team, press R to rename, then press BACKSPACE. It must\n"
      + "   DELETE one character and stay in the rename box. Previously Backspace yanked you out of the whole\n"
      + "   menu to the TITLE screen. Enter saves; Esc closes just the rename box (never the title).\n"
      + "2) EDITOR TEAM-MON CYCLING (Set Editor): with >1 team mon, G = previous mon, V = next mon (shoulder\n"
      + "   buttons too). Pressing them must ACTUALLY switch which team mon you are editing - the sprite,\n"
      + "   abilities, moves and stats reload onto the sibling. Previously it did NOTHING: the editor re-open\n"
      + "   was skipped (same-mode overlay no-op), so it kept showing the first mon. Cycle from ANY field\n"
      + "   while browsing; to SEARCH a move/item press A (Space) to open the dropdown, THEN type (Esc closes\n"
      + "   it and the hotkeys are live again).\n"
      + "3) GETTING OUT OF THE BUILD (grid -> Team Menu): from the offline Create/Edit grid press Cancel (B),\n"
      + "   confirm Yes. It must return to the TEAM MENU with the grid fully GONE (no frozen / stuck starter\n"
      + "   select left painted underneath). Previously the grid stayed visible/stranded under the menu.\n"
      + "4) RANK CHIP (Team Menu): the ranked-ladder badge is a COMPACT one-line chip in the header (next to\n"
      + "   the team count), not the big card that used to cover the preview's MOVESET; the full preview must\n"
      + "   be unobstructed. If the rank server route isn't deployed the chip just shows Unranked (no repeated\n"
      + "   console 404 on every menu open now).\n"
      + "Rendered + asserted headlessly: test/tools/render-ui-page.test.ts (showdown-team-menu* incl. the two\n"
      + "rank-chip pages) + showdown-team-menu-realpath.test.ts (REAL-PATH: G/V reloads the sibling mon;\n"
      + "grid-exit hides the grid + shows the menu) + showdown-team-menu-input.test.ts (rename Backspace never\n"
      + "exits) + showdown-editor-input.test.ts (capture lifecycle + G/V dispatch).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.OUTRAGE, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: level-up Move Learn panel is the SHARED synced path (#848)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): a level-up move-learn on a FULL\n"
      + "moveset used to route each learn through the per-move screen, and the OWNER's picker could\n"
      + "get STUCK (the partner saw the 'unlearning' but the owner's screen never closed - the live\n"
      + "wave-6 P0). #848 makes the ER batch Move Learn panel the SHARED co-op level-up path instead:\n"
      + "the mon's OWNER drives the real panel, the WATCHER opens the SAME panel and mirrors the live\n"
      + "cursor, and BOTH close together on the relayed final selection (the host applies it\n"
      + "authoritatively). DO (2 clients): level a FULL-moveset mon owned by EITHER player past a\n"
      + "level-up-move (e.g. KO wave enemies for EXP). EXPECT: one Move Learn panel opens on BOTH\n"
      + "screens; only the OWNER can move the cursor / pick; the WATCHER sees it move live; when the\n"
      + "owner finishes (pick a slot to overwrite, or Cancel), BOTH screens close together and the\n"
      + "moveset is IDENTICAL on both clients. The owner's screen must NEVER hang. Any panel error\n"
      + "falls back to the per-move flow (still no softlock). Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-learn-move.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
      ];
    },
  },
  {
    label: "(note) Co-op: an ME that GRANTS a mon with a FULL party no longer freezes both clients (#855)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): a mystery event that GRANTS a mon (e.g.\n"
      + "The Pokemon Salesman's buy option, Regional Emissary) used to FREEZE the whole session when the\n"
      + "party was full - the replace-or-skip picker opened but NEITHER co-op player could drive it (the\n"
      + "live P0). #855 wires it like the other ME sub-prompts: on a GUEST-OWNED ME the mon's RECIPIENT\n"
      + "(the ME owner) drives the REAL replace-or-skip picker locally and relays only the chosen slot;\n"
      + "the sole-engine host applies the release+add authoritatively (a decline / cancel / disconnect\n"
      + "just skips the grant, never hangs). DO (2 clients): fill BOTH players' halves of the party (3\n"
      + "each = 6 total), then have the PARTNER (guest) trigger + choose an ME option that GRANTS a mon.\n"
      + "EXPECT: the 'party is full' replace-or-skip picker opens and is DRIVABLE by the player who owns\n"
      + "the event (pick a slot to replace, or Cancel to skip); the mon is added to the picked slot (or\n"
      + "skipped) on BOTH clients; neither screen freezes. A HOST-owned ME grant is unchanged. Handshake\n"
      + "tested headlessly in test/tests/elite-redux/coop/coop-me-catch-full-subprompt.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 20 });
      // A FULL 6-mon party so a co-op run splits into two full 3-mon halves - the condition that opens
      // the replace-or-skip picker on the next ME mon grant.
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.HYPNOSIS, MoveId.DARK_PULSE],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.NUZZLE],
        }),
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.DRAGON_PULSE, MoveId.ROOST],
        }),
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.FLASH_CANNON, MoveId.RAPID_SPIN],
        }),
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.GIGA_DRAIN, MoveId.SLUDGE_BOMB, MoveId.SYNTHESIS, MoveId.LEECH_SEED],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: every reward-shop party sub-picker syncs to both clients (wiring audit)",
    description:
      "CO-OP behavior - verify with TWO clients (not a solo battle): every party-target reward whose\n"
      + "pick opens a sub-picker - DNA Splicer (fuse two mons), a held item / vitamin / Rare Candy\n"
      + "(PARTY/MODIFIER), Ether (PARTY/MOVE_MODIFIER), a TM, Memory Mushroom, Learner's Shroom, TM Case\n"
      + "(the teach-a-move pickers) - is driven by the reward OWNER and MIRRORED on the WATCHER. DO (2\n"
      + "clients): on an alternating reward interaction, the OWNER picks one of these and chooses a mon\n"
      + "(+ a move for the teach pickers). EXPECT: the outcome is IDENTICAL on BOTH clients (same fusion\n"
      + "/ held item / restored PP / taught move) and the alternating-interaction counter advances in\n"
      + "lockstep; a teach-a-move reward learns the move on both and NEVER orphans/hangs the shop. Duo-\n"
      + "tested headlessly in test/tests/elite-redux/coop/coop-duo-reward-subpickers.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.HYPNOSIS, MoveId.DARK_PULSE],
        }),
      ];
    },
    shopItems: [modifierTypes.DNA_SPLICERS, modifierTypes.ETHER, modifierTypes.MEMORY_MUSHROOM],
  },
  {
    label: "(note) Co-op: the Dex Nav species picker opens only for the item USER (wiring audit)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): the ER Dex Nav consumable registers\n"
      + "species in the PER-ACCOUNT pokedex via a species picker. In the alternating reward shop the\n"
      + "WATCHER applies the SAME consumable to keep the shop in lockstep, so pre-fix BOTH clients opened\n"
      + "the (drivable) picker - an unexpected screen on the partner PLUS free dex entries from the\n"
      + "owner's item. Now it is owner-gated. DO (2 clients): the reward OWNER picks a Dex Nav. EXPECT:\n"
      + "the 'choose a Pokemon to register' picker opens ONLY on the OWNER (the item user); the WATCHER\n"
      + "sees NO picker and gets NO dex entries from it. Each player's dex is their own. Gated headlessly\n"
      + "in test/tests/elite-redux/coop/coop-dexnav-owner-gate.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
      ];
    },
    shopItems: [modifierTypes.ER_DEX_NAV],
  },
  {
    label: "(note) Co-op: an ME TRAINER (event) battle is a DOUBLE - trainer-sprite crash now FIXED (#802/#818)",
    description:
      "CO-OP behavior - verify with TWO clients (a doubles run): a mystery event that spawns a TRAINER\n"
      + "battle (e.g. Mysterious Challengers) is forced to a DOUBLE so both players field a mon (#818,\n"
      + "closing #802's 'trainer event ran as singles in a doubles run'). DO: trigger an ME trainer battle\n"
      + "in co-op. EXPECT: a DOUBLE trainer battle (2 enemy slots), never a single.\n"
      + "FIXED (was a crash-at-summon): #818 forces the DOUBLE variant on WHATEVER trainer the ME rolls,\n"
      + "but most trainer configs have hasDouble=false, so the Trainer builds a SINGLE sprite pair while\n"
      + "its variant stays DOUBLE. The sprite accessors used to index a partner sprite that was never\n"
      + "added and threw at the trainer SUMMON; the Trainer sprite path now gates the partner sprite on\n"
      + "hasPartnerSprite() (matching the ctor), so the summon shows ONE trainer sprite and never crashes.\n"
      + "EXPECT: the trainer appears (single sprite) and the double battle plays out - no black-screen\n"
      + "crash. Verified headlessly in test/tests/elite-redux/trainer-forced-double-sprite.test.ts and\n"
      + "test/tests/elite-redux/coop/coop-me-trainer-battle-double.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
      ];
    },
  },
  {
    label: "(note) Co-op: the World-Map biome CHOICE + crossroads are owner-alternated + mirrored (#848)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): the ER World Map biome pick and the\n"
      + "every-5-waves Stay/Leave crossroads used to be AMPUTATED in co-op - both clients silently\n"
      + "auto-rolled the next biome off the shared seed with NO prompt, so the core 'choose your route'\n"
      + "mechanic was gone for co-op players. #848 restores it as an OWNER-ALTERNATED, MIRRORED\n"
      + "interaction (the SAME alternation as the reward shop / ME / bargain - the shared interaction\n"
      + "counter parity): one player OWNS the decision, drives the real crossroads + World Map screen,\n"
      + "and the PARTNER sees the SAME screens with the owner's cursor moving live, then both apply the\n"
      + "owner's choice. DO (2 clients): play ~5 waves into a biome to reach the CROSSROADS. EXPECT: the\n"
      + "Stay/Leave prompt opens on BOTH screens but only ONE player (the current interaction owner) can\n"
      + "move the cursor / pick; the partner watches it live. On LEAVE the World Map route picker opens\n"
      + "on BOTH screens (same owner drives); when the owner picks a node, BOTH clients travel to the\n"
      + "SAME chosen biome (NOT a random roll) and land with the same biome length. The WHOLE Stay/Leave\n"
      + "-> map decision is ONE interaction: the picker owner FLIPS to the other player at the NEXT\n"
      + "crossroads. If the owner disconnects, both clients fall back to the same deterministic roll (no\n"
      + "hang, no split run). Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-biome-choice.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
      ];
    },
  },
  {
    label: "(note) Co-op: the wave-10 biome SHOP -> crossroads/map boundary no longer desyncs the biome (#858)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): at an every-10-waves boundary the biome\n"
      + "SHOP and the #848 crossroads / World-Map biome pick fall on the SAME wave. They are two separate\n"
      + "owner-alternated interactions and had NO barrier between them, so the faster player (the shop\n"
      + "WATCHER, who becomes the crossroads OWNER) could finish the shop and race the whole crossroads +\n"
      + "biome pick while the shop OWNER still had the market open. When the shopper finally left, its own\n"
      + "shop-terminal counter advance FOLDED past the crossroads counter, so it pinned the wrong one,\n"
      + "timed out the relay, and fired the Stay/Leave fallback ONE-SIDED: live wave-10 desync - the map\n"
      + "opened on the non-shopping player, then JUMPED screens when the shop closed (freezing the\n"
      + "shopper's input), and the other player advanced to wave 11 with NO biome change (a split run).\n"
      + "Fixed with a reciprocal RENDEZVOUS barrier at the crossroads / biome-pick ENTRY: BOTH clients must\n"
      + "have LEFT the shop before either pins the boundary interaction + splits owner/watcher, so neither\n"
      + "can race ahead and the anti-hang fallback can only fire when the owner is TRULY gone (both fall\n"
      + "back identically, never one-sided). DO (2 clients): reach a wave-10 x0 boundary where the biome\n"
      + "shop opens AND a crossroads / map pick follows; have DIFFERENT players drive the shop vs the map,\n"
      + "and try both orders (shopper leaves first / picker acts first). EXPECT: the shop closes on BOTH\n"
      + "before the crossroads/map opens; exactly ONE player drives the map while the other watches (no\n"
      + "frozen input, no screen jump); BOTH land in the SAME biome (or both Stay) and advance to the same\n"
      + "next wave - never a one-sided biome change. Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-biome-boundary.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
      ];
    },
  },
  {
    label: "(note) Co-op: the biome-pick WATCHER never gets stuck in the map screen + phantom-ME visuals clear (#863)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle). TWO residual softlocks after #858:\n"
      + "(a) MAP-DISMISS: at a biome-end World-Map pick the interaction WATCHER opens the mirrored map and\n"
      + "waits for the OWNER's relayed biome. If the owner picked + moved on but its pick relay was lost/raced\n"
      + "at the wave boundary, the watcher had NO one-sided rescue (the generic orphan-rescue can't see the\n"
      + "offset biome/crossroads seq band, there is no between-wave resync to fire it, and the stall watchdog\n"
      + "only recovers a MUTUAL stall) - so the watcher FROZE on the map for 20 minutes, input-blocked by the\n"
      + "open cursor mirror ('partner chose map but I am stuck in the map screen', live wave-10 build\n"
      + "mrbdf344). Fixed: the watcher now also dismisses the moment it sees the OWNER advance PAST the\n"
      + "interaction (committed + moved on), tearing down the map + closing the mirror and applying the\n"
      + "deterministic fallback biome (self-heals via the host-authoritative wave sync). A genuinely relayed\n"
      + "pick still wins, so the correct biome is preferred. Same backstop covers the every-5-waves crossroads.\n"
      + "(b) PHANTOM-ME VISUALS: when the guest self-rolls an ME the host does NOT have (Delibird gift while\n"
      + "the partner fights a normal battle, build mrbfz16x), the run drops the phantom ME back to a WILD\n"
      + "battle - but the ME's intro sprite (the Delibird) LINGERED over the recovered battle. Fixed: the drop\n"
      + "reuses the normal leave path's intro-visual teardown, guarded so it can never crash/hang the recovery.\n"
      + "DO (2 clients): reach a biome-end World-Map pick; have ONE player drive it while the other watches\n"
      + "(and separately, play until one client gets an ME the other does not). EXPECT: the watcher's map ALWAYS\n"
      + "dismisses and the run proceeds (never a 20-minute stuck map screen); a dropped phantom ME leaves NO\n"
      + "leftover event sprite over the battle. Duo/regression-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-biome-choice.test.ts (ORPHAN scenario) and\n"
      + "test/tests/elite-redux/coop/coop-me-phantom-drop.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
      ];
    },
  },
  {
    label: "(note) Co-op: the biome-pick OWNER always relays its biome, even on a non-picker travel (#864)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle). Live wave-boundary P0: the biome-pick OWNER\n"
      + "changed biome WITHOUT ever emitting the biomePick relay ('the map changed without letting me choose'\n"
      + "on one client), so the WATCHER, parked on the mirrored map awaiting the owner's pick, adopted a\n"
      + "DIFFERENT deterministic fallback biome ('Desynced waves', stuck at the old wave). Root cause: #848\n"
      + "relay-wired ONLY the World-Map picker's on-select callback, so any OTHER biome-pick TERMINAL - a\n"
      + "single revealed onward node (only one place to go), a travel-event target (Storm / Ultra Wormhole /\n"
      + "Echo Chamber), or a chained crossroads-Leave that resolves deterministically - travelled ONE-SIDED\n"
      + "and SILENT: no biomePick relay, so the two clients could land in different biomes. Fixed: the owner\n"
      + "now relays the biome it travels to through a SINGLE terminal funnel (setNextBiomeAndEnd), so EVERY\n"
      + "owner biome-travel - the picker pick, a deterministic single-node / travel-target resolution, or a\n"
      + "fallback - emits the biomePick relay AND advances the interaction counter (so the #863 orphan\n"
      + "backstop can rescue the watcher). The watcher adopts the owner's biome verbatim - never its own\n"
      + "divergent fallback. DO (2 clients): reach a biome-end at a boundary where the onward map has a\n"
      + "SINGLE route, or use a travel event (Storm / Wormhole) to set a destination, and cross the boundary.\n"
      + "EXPECT: BOTH clients land in the SAME next biome and advance to the same wave - never one client on a\n"
      + "new biome while the other is stuck 'desynced'. Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-biome-choice.test.ts (SCENARIO 6 + the real-handler PROBE).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
      ];
    },
  },
  {
    label: "(note) Co-op: the wave WILD-vs-TRAINER type is host-authoritative - the partner adopts it (#867)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle). Live/soak data-tier P0: the PARTNER (the pure\n"
      + "renderer) re-DERIVED each wave's WILD-vs-TRAINER type from its OWN isWaveTrainer roll (an\n"
      + "arena-trainerChance / biome-overstay / seeded roll). Once its arena/overstay state drifts from the\n"
      + "host that roll DIVERGES: at a TRAINER wave the host had battleType=TRAINER while the partner\n"
      + "self-derived WILD (god-leg soak seed 20260709 wave 43). The saveDataDigest hashes\n"
      + "currentBattle.battleType, so the two clients' per-turn checksum SPLIT - a MISMATCH every turn healed\n"
      + "by an expensive full-state resync - and a 'wild'-thinking partner mishandled the trainer's mid-battle\n"
      + "send-outs (the empty-enemy-slot symptom class). Root cause: the guest ROLLED the wave type instead of\n"
      + "ADOPTING it, exactly the #862 (ME verdict) class one step over. Fixed: the host's wave-start\n"
      + "enemyPartySync now ALSO states its authoritative battleType, and the guest ADOPTS it in newBattle\n"
      + "(never rolling isWaveTrainer when the verdict is present). DO (2 clients): play a run across several\n"
      + "waves that MIX wild and trainer battles (e.g. into the mid-game where trainer density climbs).\n"
      + "EXPECT: both clients agree on every wave's type (no client showing a 'wild' encounter while the other\n"
      + "fights a trainer), no per-turn resync churn on trainer waves. Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-guest-battletype-adopt.test.ts + coop-wave-battletype-verdict.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.SNORE] }),
      ];
    },
  },
  {
    label: "(note) Co-op: a faint replacement must not instantly re-KO on the chooser (#807)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): when the GUEST's active mon FAINTS and\n"
      + "the guest PICKS a living bench mon, the host summons it correctly - but on the guest's screen the\n"
      + "replacement used to INSTANTLY DIE and re-open the 'choose a Pokemon' picker in a LOOP, while the\n"
      + "host recorded the choice fine (live seed EW0gvphu5Ps8dmWDaUKqgr8x, wave 8). Root cause: the host\n"
      + "sends a post-faint checkpoint (slot fainted) and, after the summon, an out-of-band REPLACEMENT\n"
      + "checkpoint (slot ALIVE) with a newer #807 tick; the guest applied the replacement, then the PARKED\n"
      + "stale resolution's companion field-snapshot re-applied the pre-summon FAINTED hp=0 and re-KO'd the\n"
      + "fresh replacement (then a forced resync). Fixed: the stale checkpoint's field-snapshot + checksum\n"
      + "are now SKIPPED when the #807 guard rejects it, so a newer replacement can never be clobbered. DO\n"
      + "(2 clients): let the GUEST's active mon faint with a living bench, then pick a bench mon. EXPECT:\n"
      + "the chosen mon comes out and STAYS alive on BOTH screens; the picker does NOT re-open; no desync\n"
      + "flash. Duo-tested headlessly in test/tests/elite-redux/coop/coop-duo-guest-faint-party-desync.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: a player out of Pokemon closes the faint picker (no stuck menu)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): when a player's ENTIRE half is fainted\n"
      + "(no legal same-owner replacement) and that player's active mon faints, the forced 'choose a\n"
      + "Pokemon' picker used to open with NO selectable option - every non-fainted party mon is either\n"
      + "fainted or the PARTNER's (both blocked) - and the modal could not be cancelled, so that player was\n"
      + "STUCK FOREVER in the choose menu and the turn never advanced ('when your partner runs out of\n"
      + "pokemon the game waits forever', live seed 5ncYiLOw1a4JQZ0MAzWA1izj wave 3). Fixed: the picker now\n"
      + "detects no-legal-same-owner replacement and CLOSES (that player is OUT), leaving the slot empty so\n"
      + "the run continues with the surviving partner (asymmetric field); if BOTH halves are wiped it ends\n"
      + "cleanly (game over). DO (2 clients): let ONE player lose its whole half (faint every mon it owns),\n"
      + "then faint its active mon. EXPECT: no stuck choose menu; the picker closes; the partner keeps\n"
      + "playing solo on the field; a both-halves-wiped case reaches a normal game over - never a hang.\n"
      + "Duo-tested headlessly in test/tests/elite-redux/coop/coop-duo-half-wiped.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.EARTHQUAKE, MoveId.CRUNCH] }),
      ];
    },
  },
  {
    label: "(note) Co-op: an IDLE connection no longer flaps disconnect/reconnect (#857)",
    description:
      "CO-OP P0 fix - verify with TWO REAL clients on staging (a live WebRTC path, NOT a solo battle or the\n"
      + "loopback): two players used to connect fine, then flap disconnect/reconnect endlessly from\n"
      + "starter-select onward (live 2026-07-07 jari/anon capture: gen=0 dies at ~31s with the peer seeing\n"
      + "'User-Initiated Abort, reason=Close called', then #805 hot-rejoin re-dials forever). Root cause: an\n"
      + "IDLE data channel (both humans parked at the pre-battle / resume barrier sending no game traffic)\n"
      + "loses ICE consent freshness / its NAT-or-TURN binding at ~30s and the browser tears it down. Fixed:\n"
      + "the transport now sends a tiny keepalive ping every 5s so an idle channel stays warm. DO (2 clients):\n"
      + "pair up, both reach SELECT STARTER, then WAIT 60-90s WITHOUT touching anything. EXPECT: the\n"
      + "connection stays up - NO 'Connection lost...' banner, no reconnect churn - and you can still pick +\n"
      + "start normally. Also: a genuine drop now shows the REASON in the banner, and a version mismatch shows\n"
      + "a persistent 'update your client (Ctrl+F5)' message instead of redial-looping. This is a browser/\n"
      + "prod-only phenomenon (the ICE consent timeout can't reproduce headlessly), so it is unit-tested\n"
      + "instead in test/tests/elite-redux/coop/coop-webrtc-transport.test.ts (the '#857 keepalive' block).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.EARTHQUAKE, MoveId.CRUNCH] }),
      ];
    },
  },
  {
    label: "(note) Co-op: gift-type mystery event no longer desyncs the WAVES (#859)",
    description:
      "CO-OP P0 fix - verify with TWO REAL clients on staging. A NON-battle mystery event (e.g. the\n"
      + "Delibird gift) used to strand the WATCHER: after the owner picked and left, the watcher's client\n"
      + "silently entered a phantom battle turn for the EVENT wave (a battle that does not exist) and froze\n"
      + "there forever, while the owner advanced to the next wave alone and timed out waiting at the command\n"
      + "barrier (live 2026-07-07 capture: host at wave 14, guest stuck at wave 13, wait climbing past 170s).\n"
      + "Fixed: the event's end signal now dissolves the phantom turn so the watcher follows into the next\n"
      + "wave. DO (2 clients): play co-op until a gift/narration-style mystery event (no fight) with a reward\n"
      + "screen; the owner picks and continues. EXPECT: BOTH clients land in the SAME next wave together and\n"
      + "both can command their mons - no one stuck on a frozen screen while the other plays. Regression\n"
      + "coverage: test/tests/elite-redux/coop/coop-me-phantom-turn-abort.test.ts (4 cases incl. the parked\n"
      + "phase dissolving with no finalize).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.EARTHQUAKE, MoveId.CRUNCH] }),
      ];
    },
  },
  {
    label: "(note) Co-op: lone-survivor faint replacement seats in your OWN slot (#799)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): with a HEAVILY-fainted party (both sides\n"
      + "down to ~2 live mons) when only ONE legal replacement remains, the SOLO 'collapse the seat to slot\n"
      + "0 in a double where 2/3 legal members fainted at once' behavior fired - which is NOT co-op-aware.\n"
      + "Each player owns a FIXED field slot (host = left, guest = right); collapsing a guest replacement to\n"
      + "the LEFT slot (or the two clients resolving the collapse differently off their own party views)\n"
      + "seated the pick in the WRONG slot: the host seated it while the guest left that slot ABSENT, so the\n"
      + "guest re-detected an empty slot and re-opened the picker in a loop ('switches in, instantly faints,\n"
      + "endless loop', live seed 5ncYiLOw1a4JQZ0MAzWA1izj wave 3). Fixed: in co-op a replacement ALWAYS\n"
      + "seats in the OWNER's own fixed slot, never collapsed to 0. DO (2 clients): get both parties down to\n"
      + "~2 mons, faint the guest's active mon, and pick its LAST living bench mon. EXPECT: the pick comes\n"
      + "out in the GUEST's own slot on BOTH screens (same species, same slot), stays alive, no re-open loop,\n"
      + "no desync flash. Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-heavy-faint-seating.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.DRAGON_PULSE, MoveId.ROOST],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: a Revive in the shop syncs to BOTH clients (#719)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): a Revive / Max Revive is a party-target\n"
      + "reward - the OWNER picks WHICH fainted mon to revive (restores HP + clears the fainted flag) and\n"
      + "BOTH clients must apply it. The reported desync: the owner saw the mon revived, the partner never\n"
      + "did, so the revived bench mon stayed fainted on the partner's client (live seed\n"
      + "5ncYiLOw1a4JQZ0MAzWA1izj). Because a revive changes no LEVEL, the per-turn checksum (which hashes\n"
      + "party species + levels, not bench HP) could not even detect it. Verified in the two-engine harness:\n"
      + "the party-target REVIVE relay applies on the WATCHER too, zero forced resyncs. DO (2 clients):\n"
      + "faint a bench mon, take a Revive in the reward shop, and pick that fainted mon. EXPECT: the mon is\n"
      + "ALIVE (HP > 0) on BOTH screens, same HP, no desync. Regression-guarded headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-revive-sync.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.FLASH_CANNON, MoveId.RAPID_SPIN],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: the reward-shop WATCHER no longer CRASHES on a long item description (#852)",
    description:
      "CO-OP P0 fix - the crash needs TWO clients (a solo shop can't reproduce the WATCHER path). When the\n"
      + "reward shop opens, the interaction OWNER drives the real menu and the PARTNER opens the SAME shop as\n"
      + "a read-only WATCHER whose cursor mirrors the owner's live. The auto-scrolling item-description box\n"
      + "(#557) reads the description text's displayHeight; on the WATCHER that pane could be reached before\n"
      + "it was built, so the read hit an undefined object -> uncaught TypeError 'Cannot read properties of\n"
      + "undefined (reading displayHeight)' ~190ms after the mirror opened. The guest DIED and the host waited\n"
      + "at the shop forever (live build mr9oh5r8-kjr, wave 7). Fixed on two layers: (1) the description pane\n"
      + "now builds ON DEMAND (ensureItemDescText) so the reader never touches an unbuilt object, and (2) the\n"
      + "watcher cursor-mirror render is wrapped so ANY replay error is swallowed loudly and the session stays\n"
      + "ALIVE (the shop is cosmetic on the watcher; the authoritative pick still commits). DO (2 clients):\n"
      + "reach a reward shop and let ONE player hover the reward items while the OTHER just watches; the\n"
      + "watcher's cursor mirrors onto the items and their (often long) descriptions. EXPECT: neither client\n"
      + "crashes to black, the description box shows/scrolls on the owner, and the watcher stays in the shop\n"
      + "until the pick is made (no dead client, no host hang). SOLO smoke (this scenario): win the opening\n"
      + "battle, then in the shop hover the seeded item below and confirm its description renders + scrolls\n"
      + "without error. Regression-guarded headlessly in coop-ui-mirror.test.ts (throwing-render survives) +\n"
      + "test/tests/elite-redux/coop/coop-watcher-reward-desc-crash.test.ts (unbuilt pane rebuilt, no crash).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.EARTHQUAKE],
        }),
      ];
    },
    shopItems: [modifierTypes.ER_RELIC_CURSED_IDOL, modifierTypes.RARE_CANDY],
  },
  {
    label: "(note) Co-op: the post-ME reward-shop WATCHER survives a stale out-of-range relayed pick (#854)",
    description:
      "CO-OP P0 fix - needs TWO clients on a Town-Raffle-class ME (a solo shop can't reproduce the WATCHER\n"
      + "path). After the ME, its embedded reward shop opens: the interaction OWNER drives the real menu and\n"
      + "the PARTNER opens the SAME shop as a read-only WATCHER that replays the owner's relayed picks against\n"
      + "its adopted option pool. In the live capture (build mr9sx2n9-96kr, ER_TOWN_RAFFLE wave 9) a STALE\n"
      + "reward pick with an OUT-OF-RANGE cursor (choice=4 while the adopted pool held 2 options) sat buffered\n"
      + "on the reward seq; the watcher fed that cursor to selectRewardModifierOption, which read\n"
      + "typeOptions[cursor].type of undefined -> uncaught TypeError. The guest DIED mid-watch: (a) its\n"
      + "reward-cursor mirror never closed, so the ME/shop screen OVERLAID the continuing game ('the screen\n"
      + "never dismisses'), and (b) it never consumed the owner's real LEAVE, so it STRANDED a wave behind\n"
      + "while the host moved on ('stuck after a mystery event'). Fixed: the WATCHER now IGNORES an\n"
      + "out-of-range relayed reward/shop cursor (the cosmetic pick can't crash it) and keeps waiting for the\n"
      + "authoritative terminal, and the guest's ME terminal force-closes any lingering reward mirror. DO (2\n"
      + "clients): play through a Town Raffle (or any ME with a reward shop), let ONE player drive the post-ME\n"
      + "shop and LEAVE while the OTHER watches. EXPECT: neither client crashes to black, the watcher's ME/shop\n"
      + "screen dismisses, and BOTH advance to the next wave in lockstep (no stuck-a-wave-behind). Reproduced\n"
      + "+ regression-guarded headlessly over two real engines in\n"
      + "test/tests/elite-redux/coop/coop-duo-me-reward-oob.test.ts (fails-before: the exact TypeError +\n"
      + "watcher hang; passes-after: skip + LEAVE + lockstep + mirror closed).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.EARTHQUAKE],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: your party ORDER stays synced when a lead faints + is replaced (#836)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): when a player's FIELD lead faints and a\n"
      + "BENCH mon is sent out to replace it, the game swaps the party ARRAY so the replacement takes the\n"
      + "field slot and the fainted lead moves to the bench slot it vacated. The HOST does this immediately;\n"
      + "the partner (the pure renderer) used to mirror the host's OWN faint only on the NEXT turn - so if the\n"
      + "wave ENDED first (or the replacement leveled up), the partner kept the OLD order and the two clients'\n"
      + "party lists TRANSPOSED (live seed lzvAD3J749mCz1eNGVBSKWXW, Youngster Wes, wave 5). That one desync\n"
      + "caused TWO reports: (1) 'my mon is a level behind my partner's' - the replacement's level-up landed\n"
      + "on the wrong (transposed) slot on the partner and was dropped; (2) 'a mon switched in invisible then\n"
      + "fainted for no reason' - the wrong mon sat at a field slot. Fixed: a host-owned faint-replacement now\n"
      + "syncs the swap to the partner IMMEDIATELY (same as a partner-owned faint), the party-order heal no\n"
      + "longer freezes a mis-slotted on-field mon, and the exp/level delivery falls back to mon IDENTITY so a\n"
      + "level-up is never lost. DO (2 clients): faint your FIELD lead and send out a bench mon, then win the\n"
      + "wave (ideally the replacement gets a KO + levels up). EXPECT: your party list is in the SAME order on\n"
      + "BOTH screens, the replacement's level matches on both, no bench mon shows the wrong HP/fainted state,\n"
      + "no re-summon flash or resync. Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-party-transposition.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.CHIKORITA, {
          moveset: [MoveId.RAZOR_LEAF, MoveId.BODY_SLAM, MoveId.SYNTHESIS, MoveId.REFLECT],
        }),
        makeStarter(SpeciesId.FENNEKIN, {
          moveset: [MoveId.EMBER, MoveId.PSYBEAM, MoveId.QUICK_ATTACK, MoveId.HOWL],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: the trainer's next mon RENDERS on the partner after a foe faints (#845)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle): in a DOUBLE trainer battle, KO one of the\n"
      + "trainer's on-field mons so the trainer sends its NEXT reserve. The HOST runs a real summon and shows\n"
      + "2v2. The PARTNER (the pure renderer) receives the new foe through the host's authoritative full-state\n"
      + "apply, which for a NEW Pokemon id took the reconstruct path and seated the mon as DATA ONLY - it built\n"
      + "the foe but placed its sprite with a RELATIVE position nudge from the ctor-default base, so once the\n"
      + "live enemy platform had moved (field scale / a fusion / the biome layout) the sprite landed OFF the\n"
      + "platform: the partner saw an EMPTY enemy slot (1v2) while the host saw 2v2, and the battle kept\n"
      + "working because the data was correct (live wave-12 trainer, seed pjQuKHgYao8WW2QCPLtKIhcP). Fixed:\n"
      + "when the authoritative field seats an id with no live rendered occupant at that slot, the partner now\n"
      + "runs the REAL field-summon presentation (the same helper the checkpoint reconcile uses) - it removes\n"
      + "the fainted predecessor FIRST, derives the ABSOLUTE platform base from the surviving ally, seats the\n"
      + "sprite + HP bar (+ boss shields), and never re-summons an already-rendered mon (no flicker). DO\n"
      + "(2 clients): in a double trainer fight, KO ONE of the two foes and let the trainer send its next.\n"
      + "EXPECT: the replacement APPEARS on BOTH screens in the correct slot (2v2), with its HP bar, no empty\n"
      + "slot on either client, and no re-summon flash / forced resync. Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-enemy-switch-render.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.CHIKORITA, {
          moveset: [MoveId.RAZOR_LEAF, MoveId.BODY_SLAM, MoveId.SYNTHESIS, MoveId.REFLECT],
        }),
        makeStarter(SpeciesId.FENNEKIN, {
          moveset: [MoveId.EMBER, MoveId.PSYBEAM, MoveId.QUICK_ATTACK, MoveId.HOWL],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: the partner's on-field visuals refresh every turn (bars, status, boss, items) (#838)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle). Phase-3 RENDER DIFFER. The PARTNER is a pure\n"
      + "renderer: it applies the host's authoritative full-state each turn but used to update on-field visuals\n"
      + "AD-HOC, so a field that the apply forgot to redraw showed STALE on the partner while the data was\n"
      + "correct - the class the #845 positioning fix + the hp-bar fixes chipped at one at a time. The clearest\n"
      + "live instance (maintainer report, build mr9oh5r8-kjr @wave 7): 'enemy items don't seem synced' - the\n"
      + "checksums (incl. the held-item digest) MATCHED, so the DATA was in sync; the ENEMY held-item bar on the\n"
      + "partner simply never REDREW, because the modifier reconcile only redraws when it detects a change.\n"
      + "Fixed: after every authoritative apply the partner now runs a systematic differ over every on-field\n"
      + "mon - a CHEAP refresh runs UNCONDITIONALLY (battle-info bars: HP / status badge incl. bleed/frostbite/\n"
      + "fear / name / gender / level / stat text; boss segment dividers; BOTH held-item bars), and the\n"
      + "EXPENSIVE re-summon (reload the sprite atlas) fires ONLY when the sprite-key inputs change (species /\n"
      + "form / shiny / variant / fusion / gender), i.e. a form change or Transform. So a missed field degrades\n"
      + "to a harmless extra refresh, never a stale visual. DO (2 clients): fight a wave where the ENEMY holds a\n"
      + "visible item (e.g. Leftovers) and takes damage / a status; on the OTHER client watch the enemy HP bar,\n"
      + "status badge and held-item indicator. EXPECT: the partner's enemy item bar, HP bar, status badge and\n"
      + "boss shields track the host EVERY turn (no stale bar), with NO sprite re-summon flash on a routine turn;\n"
      + "a real form change / Transform DOES re-summon the sprite, on both clients. Duo-tested headlessly in\n"
      + "test/tests/elite-redux/coop/coop-duo-render-differ.test.ts (+ the #845 render seam in\n"
      + "coop-duo-enemy-switch-render.test.ts).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.CHIKORITA, {
          moveset: [MoveId.RAZOR_LEAF, MoveId.BODY_SLAM, MoveId.SYNTHESIS, MoveId.REFLECT],
        }),
        makeStarter(SpeciesId.FENNEKIN, {
          moveset: [MoveId.EMBER, MoveId.PSYBEAM, MoveId.QUICK_ATTACK, MoveId.HOWL],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: trainer faint recovery keeps mechanics and visuals in one transaction",
    description:
      "CO-OP regression - verify with TWO clients from a FRESH run and again after RESUME. Reach a DOUBLE\n"
      + "trainer battle, let the guest-owned active Pokemon faint, and choose a bench replacement while the\n"
      + "opponent also switches or sends a reserve. This reproduced the July 12 live failure: the host sent\n"
      + "a mid-switch state snapshot containing a trainer-held vitamin with no registry id, the guest held\n"
      + "inside recovery, and the newer completed replacement waited behind it. The same transition also\n"
      + "left Pokemon sprites/bars missing and the trainer sprite covering the field. EXPECT on BOTH clients:\n"
      + "the selected replacement appears in the correct owned slot exactly once; the battle remains the\n"
      + "declared double format (never 3v2 or collapsed single); all active Pokemon sprites and HP bars agree;\n"
      + "both trainer sprites are gone before command input; both players can select the next turn; no repeated\n"
      + "resync, AI substitution, checksum mismatch, or 'player choosing a move' after both submitted. Also use\n"
      + "Send Logs at the command boundary so the paired causal/control trace is captured.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.CHIKORITA, {
          moveset: [MoveId.RAZOR_LEAF, MoveId.BODY_SLAM, MoveId.SYNTHESIS, MoveId.REFLECT],
        }),
        makeStarter(SpeciesId.FENNEKIN, {
          moveset: [MoveId.EMBER, MoveId.PSYBEAM, MoveId.QUICK_ATTACK, MoveId.HOWL],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op/Showdown: later-wave field projection runs no local summon or recenter",
    description:
      "AUTHORITATIVE RENDERER regression - verify with TWO co-op clients across at least THREE waves, then\n"
      + "start one fresh Showdown match as the guest. The partner previously entered the ordinary encounter\n"
      + "tail on waves 2+, queued ToggleDoublePositionPhase locally, and relied on the renderer gate to turn it\n"
      + "into a no-op; the fresh Showdown guest similarly queued a blocked SummonPhase for its own lead. EXPECT:\n"
      + "both player Pokemon and their HP bars are visible in the correct slots before command input on every\n"
      + "co-op wave; the Showdown guest sees its own lead on the player side; neither mode flashes/re-summons,\n"
      + "re-runs an on-summon ability, collapses format, or logs a renderer-denied Summon/Return/Toggle phase.\n"
      + "Use Send Logs at the first command boundary of wave 1, wave 2, and the Showdown match.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.CHIKORITA, {
          moveset: [MoveId.RAZOR_LEAF, MoveId.BODY_SLAM, MoveId.SYNTHESIS, MoveId.REFLECT],
        }),
        makeStarter(SpeciesId.FENNEKIN, {
          moveset: [MoveId.EMBER, MoveId.PSYBEAM, MoveId.QUICK_ATTACK, MoveId.HOWL],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: reciprocal pacing barriers + no counter drift (#839/#837)",
    description:
      "CO-OP fix - verify with TWO clients (not a solo battle). Two related pacing/sync fixes:\n"
      + "\n"
      + "(1) RECIPROCAL BARRIERS (#839): the co-op advancement guards used to be one-directional - a slow\n"
      + "watcher waited for the owner, but the FASTER player (incl. the interaction owner) could race\n"
      + "arbitrarily ahead. Two live manifestations: (a) the reward-pick owner finished the fight + entered\n"
      + "the NEXT fight while the partner was still finishing the PREVIOUS fight's animations; (b) a player\n"
      + "reached its next move-choice while the partner's faint-replacement was not yet on the field - if the\n"
      + "partner had already started a move it LOCKED the other player (the wave-12 'sync issue', seed\n"
      + "xxAV2DTz2dWXK9Nzl0EGTONH). Fixed with an explicit two-sided RENDEZVOUS at two sync points: the reward\n"
      + "PICK does not commit until BOTH reached the shop (shop:<wave>:<counter>), and the next CommandPhase\n"
      + "UI does not open until BOTH are at the command point with their mons on the field (cmd:<wave>:<turn>).\n"
      + "A dead/stuck partner can't strand the run - each barrier proceeds after a generous timeout with a\n"
      + "LOUD 'RENDEZVOUS TIMEOUT' warning instead of hanging.\n"
      + "\n"
      + "(2) NO COUNTER DRIFT (#837): applying a continuation shop item (TM / Ability Capsule / Learner's\n"
      + "Shroom) no longer bumps the shared interaction counter on the APPLIER only ('after browsing the\n"
      + "market i suddenly cannot choose a move', seed lCSO1cfpilUUG07bQvwnROJJ wave 11). The back-out shop\n"
      + "copy now stays pinned to the same interaction, and an unpinned advance is refused.\n"
      + "\n"
      + "DO (2 clients): play several waves. Have the reward-pick owner rush ahead (finish the fight fast)\n"
      + "while the partner lingers; use a continuation item (a TM/Capsule) in the shop; faint a mon and pick a\n"
      + "replacement while the partner is mid-turn. On one next-wave intro, close one peer while the arena is\n"
      + "sliding to the next encounter. EXPECT: neither client ever locks the other out of picking\n"
      + "a move; the reward pick waits for both at the shop; the interaction stays in step (no 'partner lock'\n"
      + "wedging the next battle). A failed shared session exits coherently without a stale next-encounter\n"
      + "callback crashing the surviving page. Duo-tested headlessly in coop-duo-pacing-barriers.test.ts,\n"
      + "coop-duo-interaction-counter.test.ts, coop-guest-renderer.test.ts, and the coop-rendezvous.test.ts\n"
      + "primitive suite.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: RESUME a saved run with the same partner on reconnect (#810)",
    description:
      "CO-OP LOBBY fix - verify with TWO logged-in clients (not a solo battle). This is a lobby/flow fix,\n"
      + "so it is NOT reproducible in a single dropped-into-battle scenario - follow the DO/EXPECT below.\n"
      + "\n"
      + "WHAT WAS BROKEN LIVE: reconnecting in the lobby with a partner you had a saved co-op run with always\n"
      + "started a NEW game - the Resume offer never appeared. The resume memory (marker) was recorded and\n"
      + "read HOST-ONLY, but the lobby re-assigns host/guest every connect (whoever ACCEPTS the join request\n"
      + "becomes host). When the previous guest accepted and became host, it looked up a marker it never wrote\n"
      + "-> no offer -> new game. FIX: BOTH clients now record the marker, keyed on the exact player-account\n"
      + "PAIR (both usernames), and BOTH read it on connect - so whichever client is host this session finds\n"
      + "its own local save + offers Resume. A BARRIER holds the guest at a 'Waiting for <host>...' state until\n"
      + "the host's Resume/New Game choice is relayed (no more racing into a new run); an anti-hang timeout\n"
      + "falls back to New Game with a loud warn.\n"
      + "\n"
      + "DO (2 logged-in clients A + B): play a co-op run a few waves in so it auto-saves. Both leave to Title.\n"
      + "Re-enter the co-op lobby on both, ask/accept to pair the SAME two accounts. EXPECT on ACCEPT: the HOST\n"
      + "sees 'Found a saved co-op run with <partner> (wave N). Resume it?' - pick Resume; the guest sees\n"
      + "'<host> wants to resume... Accept?' - accept; the run RESUMES at wave N on BOTH (converged), instead\n"
      + "of starting a new game. Repeat but have the OTHER account accept (roles swapped) - the offer must\n"
      + "STILL appear (the live bug). Pick NEW GAME instead -> both start a fresh co-op cleanly. Pair with a\n"
      + "DIFFERENT partner C -> NO offer (identity-gated; a save is never offered to the wrong partner).\n"
      + "Duo-tested headlessly in coop-duo-resume.test.ts (offer->accept->converge, New Game release, identity\n"
      + "gate) and the offer/reply/start-new protocol + marker gate in coop-webrtc-transport.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: a saved run cannot be loaded solo from Continue",
    description:
      "CO-OP title/load safety - verify with a co-op save but WITHOUT its saved partner connected.\n"
      + "\n"
      + "DO: select Continue or the co-op slot from Load Game while no compatible live co-op lobby session\n"
      + "exists. EXPECT: the game explains that co-op resume requires New Game > Co-op plus the exact saved\n"
      + "partner, then returns to safe title options after confirmation. It must NOT start a run, queue an\n"
      + "encounter, install an undefined game mode, crash, or alter the co-op save. Reconnect through Co-op\n"
      + "with the exact partner and confirm the normal Resume offer still works. Regression-covered in\n"
      + "coop-title-save-refusal.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: biome-boundary heal + same-biome travel (#841)",
    description:
      "CO-OP internal (verify with TWO clients across a biome BOUNDARY, ~every 10 waves) - two audit #841\n"
      + "follow-ups on the world-map/biome layer. This is a DATA/sync note (nothing new to click), checkable\n"
      + "headlessly:\n"
      + "\n"
      + "(1) SAME-BIOME TRAVEL (verified, no change): the interactive biome / World-Map node picker + the\n"
      + "Stay/Leave Crossroads prompt are BYPASSED in co-op - both clients auto-resolve the next biome\n"
      + "DETERMINISTICALLY from the shared, just-reset wave seed (select-biome-phase.ts / er-crossroads-phase.ts,\n"
      + "#633), so two players can NEVER travel to different biomes. There is no owner/watcher pick here because\n"
      + "there is no prompt to mirror.\n"
      + "\n"
      + "(2) BIOME-STRUCTURE HEAL (fixed): the rolled biome LENGTH + start wave (erRollBiomeLength, run by the\n"
      + "host's SwitchBiomePhase) ride the saveDataDigest via erMapState, so a host-vs-guest drift is DETECTED -\n"
      + "but before this fix no per-turn/resync heal carried them, so a divergence loop-detected with no heal\n"
      + "path. The full-state resync now carries erBiomeStructure and heals it through restoreErBiomeStructure\n"
      + "(alongside the money-streak / overstay / relic substrates). DO (2 clients): cross a biome boundary and\n"
      + "keep playing. EXPECT: both clients stay in the SAME biome and neither wedges in a resync loop at the\n"
      + "boundary. Duo-tested headlessly in test/tests/elite-redux/coop/coop-savedata-digest.test.ts\n"
      + "('DIVERGE + HEAL (#841 item 5)').",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: game-over tears the runtime down + no stale ME pins next run (#842)",
    description:
      "CO-OP structural fix - verify with TWO clients (not a solo battle), and primarily a CODE/TEST\n"
      + "note (the leak is cross-RUN state, not a single-battle behavior).\n"
      + "\n"
      + "BUG: a game-over that landed WHILE a mystery encounter was in progress left the co-op runtime\n"
      + "alive with its ME pins still set (coopMeInteractionStart / coopMeBattleInteractionCounter / the\n"
      + "adopted host presentation) - those clear only at an ME TERMINAL, which a mid-ME game-over never\n"
      + "reaches. GameOverPhase broadcast 'gameOver' to the partner but never tore the runtime down, so\n"
      + "the stale pins leaked into the NEXT co-op run's first encounter (ME ownership / presentation\n"
      + "desync on the fresh run).\n"
      + "\n"
      + "FIX: GameOverPhase now calls clearCoopRuntime() at its terminal step on BOTH clients (deferred\n"
      + "past the gameOver broadcast so it flushes first), which also zeroes the full ME pin family.\n"
      + "\n"
      + "DO (2 clients): drive a run to a GAME-OVER while a mystery encounter is on screen (or right after\n"
      + "entering one), then BOTH start a FRESH co-op run and reach the first mystery encounter. EXPECT:\n"
      + "the fresh run's first ME has correct ownership/alternation (no 'both drive it' / 'neither drives\n"
      + "it' desync) and its presentation is clean. Duo-tested headlessly in coop-game-over-teardown.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  {
    label: "(note) Co-op: a forged cross-owner switch pick is dropped (malicious-peer hardening #829)",
    description:
      "CO-OP hardening - this is a CODE/TEST note: it defends against a MALICIOUS or buggy partner\n"
      + "client and is NOT reproducible by normal play (a well-behaved client never sends a forged\n"
      + "message).\n"
      + "\n"
      + "BUG: the interaction relay applied a partner's faint-replacement switch pick (which mon to send\n"
      + "in) WITHOUT validating the partner actually owns the field slot the pick addresses. A crafted\n"
      + "client could relay a switch for a slot it does not command.\n"
      + "\n"
      + "FIX: the relay now validates ownership on the faint-switch channel (the one channel where slot\n"
      + "ownership is well-defined via the fixed 2-player seat map): a pick whose slot resolves to the\n"
      + "RECEIVER's own seat can only be a forgery, so it is dropped with a loud [coop:security] console\n"
      + "warning and never applied. Legitimate same-owner picks are untouched.\n"
      + "\n"
      + "VERIFY (code/test): normal 2-client faint-replacement still works (the guest picks its own\n"
      + "replacement, the host summons it). A forged cross-owner pick is dropped + warned. Unit-tested in\n"
      + "coop-malicious-peer-switch.test.ts; the legitimate path is guarded by coop-duo-faint-switch.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  {
    label: "(note) Showdown 1v1: after YOU KO the opponent's mon, its replacement is on-field BEFORE your next move",
    description:
      "SHOWDOWN VERSUS fix - verify with TWO clients in a live 1v1 versus match (not a solo battle). Live\n"
      + "report (build mrbqqcbr): the GUEST KO'd the HOST's mon; the host picked + summoned its own\n"
      + "replacement; but the guest's NEXT move menu opened with an EMPTY enemy platform - 'when I fainted\n"
      + "your mon I had to choose a move to SEE your new pokemon, so I had to blindly choose'. Root cause: a\n"
      + "host-owned faint rides the vanilla SwitchPhase, which summons the replacement AFTER the turn's\n"
      + "resolution is streamed, as a SEPARATE out-of-band replacement checkpoint the guest only consumes in\n"
      + "the NEXT turn's replay pump - but the guest's own TurnInitPhase opened its command menu BEFORE that\n"
      + "pump, so the enemy platform still showed the fainted mon (empty). The guest-OWN-faint direction never\n"
      + "hit this because its own fainted slot already defers the command into the pump. FIX\n"
      + "(turn-init-phase.ts): on the versus guest, when there is no active enemy on the field (a host\n"
      + "replacement is pending), DEFER opening its command - the replay pump opens it AFTER rendering the\n"
      + "replacement, mirroring the own-faint path (deterministic wait on the specific replacement\n"
      + "checkpoint, host-stall-bounded, no spin/timeout). DO (2 clients): as the GUEST, KO the HOST's active\n"
      + "mon while the host has a bench; the host picks a replacement. EXPECT: your next move menu opens with\n"
      + "the host's REPLACEMENT already drawn on the enemy platform (its correct species, full HP) - never an\n"
      + "empty platform you must guess against. Duo-tested headlessly in\n"
      + "test/tests/elite-redux/showdown/showdown-versus-host-faint.test.ts (case i, with a revert red-proof).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  {
    label: "(note) Showdown/co-op: closing Settings never destroys the live match",
    description:
      "NETWORK SETTINGS regression - verify with TWO clients in either a live Showdown duel or co-op run.\n"
      + "Live report: opening Settings, changing a reload-required option, then backing out reset the whole\n"
      + "scene. Showdown is ephemeral and cannot resume; in co-op the unilateral reset strands the peer.\n"
      + "DO: during a live match open Settings, change an option marked as requiring reload, then Back.\n"
      + "EXPECT: the battle remains on the same turn and both peers stay connected. The preference is saved\n"
      + "and takes effect on the next ordinary page reload. Solo play retains its immediate settings reload.\n"
      + "Unit policy: showdown-settings-reload-policy.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          formIndex: 1,
          moveset: [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "QoL: reward-shop long-desc auto-scroll (#557)",
    description:
      "#557 - long ER item descriptions auto-scroll in the REWARD screen instead of\n"
      + "being clipped (they used the shared message box, which wraps but never scrolls).\n"
      + "KO the Magikarp (one Body Slam), then on the FIRST reward screen move the cursor\n"
      + "across the options. The three guaranteed picks have LONG descriptions; the\n"
      + "normally-rolled options (Potion etc.) have SHORT ones.\n"
      + "EXPECT: focusing CURSED IDOL / LEARNER'S SHROOM / OMNI GEM shows the FULL text in\n"
      + "the description box, which slowly scrolls up and loops so the clipped tail becomes\n"
      + "readable; focusing a short item shows static text with no scroll. The box must\n"
      + "look IDENTICAL to the normal message box (same position/font) - only long text\n"
      + "moves. Cursed Idol's line is the longest, so its scroll is the clearest.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
    shopItems: [modifierTypes.ER_RELIC_CURSED_IDOL, modifierTypes.ER_LEARNERS_SHROOM, modifierTypes.ER_OMNI_GEM],
  },
  {
    label: "Reward slots must NOT grow on item-use + back-out (#145)",
    description:
      "#145 - using a reward that opens a sub-menu (TM CASE / Memory / Ability Capsule)\n"
      + "and then BACKING OUT re-shows the reward screen via a phase COPY. The copy was\n"
      + "double-counting the earned Golden Ball slots, so the reward grid GREW by the\n"
      + "Golden Ball count every time you used an item and returned (here +3 per cycle).\n"
      + "You start with 3 GOLDEN BALLS, so the first reward screen has extra item slots.\n"
      + "DO: KO the Magikarp (one Body Slam). On the reward screen COUNT the item slots in\n"
      + "the top row. Pick the TM CASE, then in the move-learn screen press B / Cancel to\n"
      + "back OUT without learning a move - you return to the reward screen. COUNT again.\n"
      + "Repeat (pick TM CASE, back out) a few times. Any item that opens a sub-menu and is\n"
      + "cancelled (a TM, Memory Mushroom, Ability Capsule) reproduces it the same way.\n"
      + "EXPECT: the slot count stays the SAME every time. Before the fix it grew by 3\n"
      + "(your Golden Ball count) on every item-use + back-out, eventually flooding the grid.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [{ name: "GOLDEN_POKEBALL", count: 3 }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
    shopItems: [modifierTypes.TM_CASE],
  },
  {
    label: "Usage-tier NU redesign (performance-based) + grandfather (#384)",
    description:
      "#384 - the Usage Tier challenge no longer collapses. NU used to be 'usage < 0.25%',\n"
      + "which shrank to ~1 eligible mon once the playerbase grew. It is now PERFORMANCE-\n"
      + "based: each common-egg line is ranked by a skill-adjusted win + wave-distance score\n"
      + "(judged vs the PICKING player's own average, so beginners' starters aren't unfairly\n"
      + "sunk), with a popularity cap and a raw-win floor - a stable ~100-mon NU pool of\n"
      + "genuinely weak / off-meta lines.\n"
      + "DO (verify the pool): start a NEW GAME, Challenge -> Usage Tier -> NU, open the\n"
      + "starter grid: ~100+ mons are selectable (Magikarp, Geodude, Togepi, Tangela...), NOT\n"
      + "a handful. UU/RU/PU are likewise repopulated.\n"
      + "HOTFIX CHECK: Cyndaquil must NOT be NU when its raw win rate is above the global\n"
      + "average; the prod usage-tier feed must match the stats-site-sized run sample, not\n"
      + "a staging-worker sample.\n"
      + "GRANDFATHER (note): a line you STARTED a usage-tier run with stays legal for THAT\n"
      + "run even if the nightly re-tier later moves it, so a multi-day run never benches your\n"
      + "openers mid-stream. Only observable across a real overnight tier change; the tier\n"
      + "math + grandfather are unit-tested in test/tests/elite-redux/er-usage-tiers.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Fusion ability slot ownership",
    description:
      "Bulbasaur is fused with Charmander. Open SUMMARY and inspect Abilities.\n"
      + "EXPECT this exact order: STURDY, DRIZZLE, MOXIE, SAND STREAM.\n"
      + "These represent base slot 1, absorbed slot 2, base slot 3, absorbed slot 4.\n"
      + "KO Magikarp to receive four Ability Randomizers. Reroll each slot once.\n"
      + "EXPECT only the selected final slot changes and all four changes persist.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 20,
        STARTER_FUSION_OVERRIDE: true,
        STARTER_FUSION_SPECIES_OVERRIDE: SpeciesId.CHARMANDER,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.BULBASAUR, { moveset: [MoveId.TACKLE, MoveId.GROWL] })];
    },
    onBattleStart: () => {
      const player = globalScene.getPlayerPokemon();
      if (!player) {
        return;
      }
      player.setAbilityOverrideForSlot(0, AbilityId.STURDY);
      player.setAbilityOverrideForSlot(1, AbilityId.DRIZZLE);
      player.setAbilityOverrideForSlot(2, AbilityId.MOXIE);
      player.setAbilityOverrideForSlot(3, AbilityId.SAND_STREAM);
      player.updateInfo();
    },
    shopItems: [
      modifierTypes.ABILITY_RANDOMIZER,
      modifierTypes.ABILITY_RANDOMIZER,
      modifierTypes.ABILITY_RANDOMIZER,
      modifierTypes.ABILITY_RANDOMIZER,
    ],
  },
  {
    label: "Fusion 3rd innate unlocks from the fusion species (#611)",
    description:
      "#611 - a fused mon's 3rd innate (passive3) is OWNED by the fusion species, so\n"
      + "its candy unlock must be read from THAT species, not the base. Bulbasaur is\n"
      + "fused with Charmander; only Charmander's 3rd innate slot is unlocked here.\n"
      + "DO: open the in-battle Info -> Abilities panel (R, then Abilities) or SUMMARY.\n"
      + "EXPECT: the 3rd Innate row (MOXIE) shows as a LIVE Innate, while the 1st/2nd\n"
      + "Innate rows read 'Innate (Locked)'. Before the fix the 3rd innate also read\n"
      + "'Locked' - its unlock was looked up on Bulbasaur (base) instead of Charmander.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTER_FUSION_OVERRIDE: true,
        STARTER_FUSION_SPECIES_OVERRIDE: SpeciesId.CHARMANDER,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BULBASAUR, {
          moveset: [MoveId.TACKLE, MoveId.GROWL, MoveId.VINE_WHIP, MoveId.GROWTH],
        }),
      ];
    },
    onBattleStart: () => {
      const player = globalScene.getPlayerPokemon();
      if (!player?.fusionSpecies) {
        return;
      }
      // Force a recognizable ability into each of the 3 innate slots so the panel
      // shows all three rows (slot 0 = STURDY, slot 1 = DRIZZLE, slot 2 = MOXIE).
      player.setAbilityOverrideForSlot(1, AbilityId.STURDY);
      player.setAbilityOverrideForSlot(2, AbilityId.DRIZZLE);
      player.setAbilityOverrideForSlot(3, AbilityId.MOXIE);
      // Candy unlocks (staging-only test save): base (Bulbasaur) unlocks NOTHING; the
      // fusion species (Charmander) unlocks ONLY its 3rd innate slot. Innate slots 0 & 2
      // are fusion-owned and slot 1 base-owned, so this lights up the fused mon's 3rd
      // innate (MOXIE) and leaves the first two Locked - exactly the ownership read #611
      // fixes (classic mode, so no Youngster free-innate slots interfere).
      const sd = globalScene.gameData.starterData;
      const baseRoot = player.species.getRootSpeciesId();
      const fusionRoot = player.fusionSpecies.getRootSpeciesId();
      if (sd[baseRoot]) {
        sd[baseRoot].passiveAttr = 0;
      }
      if (sd[fusionRoot]) {
        sd[fusionRoot].passiveAttr = unlockSlot(0, 2);
      }
      player.updateInfo();
    },
  },
  {
    label: "Fusion Preview (DNA Splicers) (#560)",
    description:
      "#560 - the live fusion PREVIEW. KO the Magikarp, then in the FIRST shop take DNA\n"
      + "SPLICERS. Pick a Pokemon's APPLY to lock it as the base; a preview panel appears\n"
      + "on the RIGHT and updates as you move the cursor over each other party member -\n"
      + "the fused sprite, the fused base stats, and the 4 abilities.\n"
      + "EXPECT: R (Switch) flips which mon is the base (so you can preview both orders);\n"
      + "A fuses the SHOWN combo (not the one first clicked); B backs out. Ability order\n"
      + "= base's active, partner's, base's, partner's. Base stats = the average of both.\n"
      + "Navigating every combo must never softlock; leaving must close the panel.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.DRAGON_PULSE, MoveId.ROOST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DARK_PULSE],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.ICE_FANG, MoveId.DRAGON_DANCE],
        }),
      ];
    },
    shopItems: [modifierTypes.DNA_SPLICERS],
  },
  {
    label: "Move Learn menu: scroll + icon/stats panel (#563)",
    description:
      "#563 - the level-up Move Learn panel. Uses NO global XP / level-cap override\n"
      + "(those leaked into other scenarios, so they were removed). Garchomp starts\n"
      + "under-levelled (L5) so it still has moves to learn, and is given 8 move slots.\n"
      + "DO: KO the Magikarp (it only Splashes) - the level-up opens ONE Move Learn panel\n"
      + "(not a message barrage). To see more, take the RARE CANDIES in the shop and use\n"
      + "them on Garchomp; the panel reopens whenever a level teaches new moves.\n"
      + "EXPECT: a small panel to the LEFT shows Garchomp's icon + its 6 base stats. Hold\n"
      + "UP/DOWN in each column: the CURRENT list (right, 8 slots) SCROLLS with up/down\n"
      + "arrows so nothing overflows the window; the LEARNABLE list scrolls the same way\n"
      + "when a level teaches enough moves. Learning fills an empty slot silently (or asks\n"
      + "which to overwrite when full); the list thins down. B / Cancel leaves with no\n"
      + "softlock.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.TACKLE, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.BODY_SLAM],
        }),
      ];
    },
    onBattleStart: () => {
      // Future-proof the CURRENT column: give the mon 8 move slots (MAX_BONUS_SLOTS
      // is normally 1) so its CURRENT list is long enough to actually scroll, the
      // way it will once mons routinely run 8 moves. Scoped to this mon - no leak.
      const player = globalScene.getPlayerPokemon();
      if (player) {
        player.customPokemonData.bonusMoveSlots = 4;
      }
    },
    // Rare Candies bypass the level cap (level += 1 directly), so the tester can
    // keep levelling Garchomp to reopen the panel - no global XP override needed.
    shopItems: [modifierTypes.RARE_CANDY, modifierTypes.RARE_CANDY, modifierTypes.RARE_CANDY],
  },
  // ===========================================================================
  // FEATURES — this session
  // ===========================================================================
  {
    label: "ER Relics: Coin Purse + Mystery Charm (#439)",
    description:
      "#439 relics batch. You start holding COIN PURSE (gold amulet) + MYSTERY CHARM\n"
      + "(purple charm) - both visible in the item bar.\n"
      + "EXPECT: Coin Purse = +20% money from all sources (KO the Magikarp and watch the\n"
      + "money reward); Mystery Charm = mystery encounters spawn more often (raises the\n"
      + "natural ME weight - relic + description confirm it).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_COIN_PURSE" }, { name: "ER_RELIC_MYSTERY_CHARM" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST] }),
      ];
    },
  },
  {
    label: "ER Relic persistence: survives Save & Quit (#439)",
    description:
      "Relics granted from a REWARD/Bargain (not the starting bar) used to VANISH on\n"
      + "reload: the relic's modifier type was built with an empty id, so the save\n"
      + "recorded a blank type and the load dropped it.\n"
      + "DO: KO the Magikarp, then in the shop TAKE both relic rewards (CURSED IDOL +\n"
      + "COVENANT). Confirm they appear in the item bar. Now open the menu, SAVE & QUIT,\n"
      + "then RELOAD the page and CONTINUE this run.\n"
      + "EXPECT: after Continue, BOTH relics are STILL in the item bar (before the fix\n"
      + "they were gone). The other ER items in the offer (Omni Gem) must also persist.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST] }),
      ];
    },
    shopItems: [modifierTypes.ER_RELIC_CURSED_IDOL, modifierTypes.ER_RELIC_COVENANT, modifierTypes.ER_OMNI_GEM],
  },
  {
    label: "Item persistence: community + recreated items survive reload (#85)",
    description:
      "ER community items (Power Herb / Omni Gem) and the recreated trainer items (Life\n"
      + "Orb / Assault Vest / Rocky Helmet) used to VANISH on reload: their modifier type\n"
      + "was built with an empty id, so the save recorded a blank type and the load\n"
      + "dropped them. Your lead holds POWER HERB + OMNI GEM; the enemy holds LIFE ORB,\n"
      + "ASSAULT VEST and ROCKY HELMET.\n"
      + "DO: hover your lead AND the enemy to confirm all 5 items (note the Power Herb /\n"
      + "Omni Gem charge counts). The enemy only Splashes, so DON'T attack - just open the\n"
      + "menu, SAVE & QUIT, RELOAD the page and CONTINUE this run.\n"
      + "EXPECT: after Continue, all 5 items are STILL there (yours AND the enemy's), with\n"
      + "the SAME charge counts. Before the fix they were gone after reload.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "ER_POWER_HERB" }, { name: "ER_OMNI_GEM" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "ER_LIFE_ORB" }, { name: "ER_ASSAULT_VEST" }, { name: "ER_ROCKY_HELMET" }],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Relic: Field Medic (reserves) (#439)",
    description:
      "#439 - Field Medic heals the BENCHED reserves (slots 2 and 3), NOT the active\n"
      + "mon. You hold FIELD MEDIC; slots 2-3 (Pidgey, Rattata) start at ~40% HP, the\n"
      + "active Snorlax is full.\n"
      + "DO: stall with PROTECT/REST for ~6 turns to watch two heal procs, then BODY\n"
      + "SLAM the Magikarp to end the battle (the enemy just Splashes, so take your time).\n"
      + "EXPECT: every 3rd turn-end, ONLY the slot-2 and slot-3 reserves heal ~1/12 of\n"
      + "max HP (a message names them). The active Snorlax is NEVER healed by it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_FIELD_MEDIC" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST, MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.GUST, MoveId.QUICK_ATTACK] }),
        makeStarter(SpeciesId.RATTATA, { moveset: [MoveId.TACKLE, MoveId.QUICK_ATTACK] }),
      ];
    },
    onBattleStart: () => {
      const party = globalScene.getPlayerParty();
      for (const i of [1, 2]) {
        const p = party[i];
        if (p) {
          p.hp = Math.max(1, Math.floor(p.getMaxHp() * 0.4));
          p.updateInfo();
        }
      }
    },
  },
  {
    label: "ER Relic: Weathervane (#439)",
    description:
      "#439 relic - Weathervane: your team ignores hostile ambient-weather chip\n"
      + "damage. A SANDSTORM is active and you hold WEATHERVANE. Use SPLASH and watch\n"
      + "end-of-turn weather damage.\n"
      + "EXPECT: your Normal-type Snorlax takes NO sandstorm residual; the enemy\n"
      + "Magikarp DOES chip each turn (it has no relic). Stall a few turns to confirm,\n"
      + "then Body Slam to finish.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        WEATHER_OVERRIDE: WeatherType.SANDSTORM,
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_WEATHERVANE" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Relics: Banner/Link/Magnet (#439)",
    description:
      "#439 relics. You hold MORALE BANNER (+15% team dmg while no mon has fainted\n"
      + "this biome), TWIN LINK (+15% to the type SHARED by party slots 2 and 3 -\n"
      + "here both WATER, so Water moves get it), and SCRAP MAGNET.\n"
      + "DO: hit the Magikarp with Snorlax's WATER PULSE (gets BOTH damage boosts);\n"
      + "note the number. Let a mon faint in a later wave -> Morale Banner BREAKS for\n"
      + "the rest of the biome (Water Pulse dmg drops by Morale's 15%; Twin Link stays).\n"
      + "SCRAP MAGNET (note): on a TRAINER win, ~25% chance of one EXTRA reward option.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [
          { name: "ER_RELIC_MORALE_BANNER" },
          { name: "ER_RELIC_TWIN_LINK" },
          { name: "ER_RELIC_SCRAP_MAGNET" },
        ],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.WATER_PULSE, MoveId.TACKLE] }),
        makeStarter(SpeciesId.SQUIRTLE, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PSYDUCK, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Relics: Second Wind + Anchor (#439)",
    description:
      "#439 relics (survival). You hold SECOND WIND (once per biome, the first mon\n"
      + "that would faint survives at 1 HP) and ANCHOR (your slot-6 mon full-heals\n"
      + "once when it becomes your last mon standing).\n"
      + "DO: your active Snorlax starts at ~15% HP vs a strong Magikarp using TACKLE.\n"
      + "EXPECT: the hit that would KO it instead leaves it at 1 HP (Second Wind),\n"
      + "ONCE this biome. (Anchor: harder to stage - faint everyone but the slot-6\n"
      + "mon and it full-heals once as the last standing.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_SECOND_WIND" }, { name: "ER_RELIC_ANCHOR" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST, MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.GUST, MoveId.QUICK_ATTACK] }),
        makeStarter(SpeciesId.RATTATA, { moveset: [MoveId.TACKLE, MoveId.QUICK_ATTACK] }),
        makeStarter(SpeciesId.CATERPIE, { moveset: [MoveId.TACKLE, MoveId.BUG_BITE] }),
        makeStarter(SpeciesId.WEEDLE, { moveset: [MoveId.POISON_STING, MoveId.BUG_BITE] }),
        makeStarter(SpeciesId.MAGIKARP, { moveset: [MoveId.TACKLE, MoveId.SPLASH] }),
      ];
    },
    onBattleStart: () => {
      const p = globalScene.getPlayerPokemon();
      if (p) {
        p.hp = Math.max(1, Math.floor(p.getMaxHp() * 0.15));
        p.updateInfo();
      }
    },
  },
  {
    label: "ER Relic: Bonded Charm (#439)",
    description:
      "#439 relic - Bonded Charm (soft baton pass): a VOLUNTARY switch carries the\n"
      + "outgoing mon's POSITIVE stat boosts to the incoming mon.\n"
      + "DO: your lead Snorlax starts at +2 to all stats. SWITCH to Pidgey on turn 1\n"
      + "(open the party menu, pick Pidgey).\n"
      + "EXPECT: Pidgey enters KEEPING the +2 boosts. A faint replacement or a forced\n"
      + "switch would NOT carry them (and negatives never carry).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_BONDED_CHARM" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
    onBattleStart: () => boostPlayer(allStages(2)),
  },
  {
    label: "ER Relics: Lookout/Quartermaster/Collector (#439)",
    description:
      "#439 formation relics. You hold LOOKOUT, QUARTERMASTER, and COLLECTOR'S ALBUM.\n"
      + "LOOKOUT (observe now): before the fight, a scout line names the lead enemy\n"
      + "(Gengar) and its TYPES.\n"
      + "QUARTERMASTER (note): every 10th wave, the slot-5 mon copies one transferable\n"
      + "held item from slot 4 or 6 - give slot 4/6 an item (e.g. Leftovers) in a shop,\n"
      + "then reach a wave divisible by 10.\n"
      + "COLLECTOR'S ALBUM (note): every 3rd NEW species you CATCH grants +3 candy to\n"
      + "that species - catch 3 different wild mons and watch the 3rd.\n"
      + "ACHIEVEMENT REWARDS (note): unlocking any achievement now grants a reward (candy/\n"
      + "eggs/Pokemon/shiny) shown via the native achievement pop-up and saved - one-time,\n"
      + "never retroactive. The achievements menu shows the new ER entries with icons;\n"
      + "Inferno (Hell + NU + Doubles Only + Ghost Trainers) is the ONLY black-shiny source.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [
          { name: "ER_RELIC_LOOKOUT" },
          { name: "ER_RELIC_QUARTERMASTER" },
          { name: "ER_RELIC_COLLECTORS_ALBUM" },
        ],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.RATTATA, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.SPEAROW, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.EKANS, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.SANDSHREW, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Town: Guessing Booth (#439)",
    description:
      "#439 - Town Guessing Booth mystery encounter (rides the Quiz engine).\n"
      + "DO: on wave 12 the booth spawns. Choose 'Play (pay the fee)'. A small card\n"
      + "shows a black battle-sprite SILHOUETTE + 4 names; UP/DOWN + ACTION to answer.\n"
      + "EXPECT: 4-question press-your-luck (one wrong answer ends it). Reward scales\n"
      + "with consecutive correct: 4/4 -> Damage Calculator unlock; 3 -> choose 1 of 3\n"
      + "ULTRA-tier rewards; 2 -> choose 1 of 3 GREAT-tier; 1 -> choose 1 of 3 COMMON;\n"
      + "0 -> a heal. 'Walk on by' just leaves.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_MONEY_OVERRIDE: 50000,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GUESSING_BOOTH,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Town: Scrambled Pokedex (#439)",
    description:
      "#439 - Professor's Scrambled Pokedex (rides the Quiz engine). The Professor\n"
      + "shows four jumbled dex entries.\n"
      + "DO: on wave 12, choose 'Help the Professor'. A card shows a Pokedex blurb +\n"
      + "4 names; answer all 4 (no stop-on-wrong).\n"
      + "EXPECT: 4/4 -> +5 research Candy for EACH team member (notification) + choose\n"
      + "1 of 3 ROGUE-tier rewards; 3 -> choose 1 of 3 ULTRA; 2 -> GREAT; 1 -> COMMON;\n"
      + "0 -> a heal. Verify the answer's name is NOT shown in its own blurb\n"
      + "(redacted to '[this Pokemon]').",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SCRAMBLED_POKEDEX,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER City: Fortune Teller (#500)",
    description:
      "#500 - The Fortune Teller (Metropolis / Slum settlement seer). Forces\n"
      + "ER_FORTUNE_TELLER. She PREVIEWS the next mystery encounter and, if you let\n"
      + "her, forces it to actually spawn.\n"
      + "DO: on wave 12, read the description + 'Hear the prophecy' tooltip. Note the\n"
      + "named encounter + biome she foresees, then choose 'Hear the prophecy'.\n"
      + "EXPECT: her line names that SAME encounter + biome (no raw ER_ enum text,\n"
      + "no missing-locale keys). It charts that biome onto the World Map (blue node).\n"
      + "Then keep playing to the NEXT mystery wave: the foreseen encounter should be\n"
      + "the one that appears (the prophecy comes true), and only once. 'Decline'\n"
      + "leaves with no queue. (note) The forced-spawn is verifiable only by playing\n"
      + "on to the next ME wave.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FORTUNE_TELLER,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Desert: The Mirage (#511)",
    description:
      "#511 - The Mirage (Desert read-the-tell). Forces ER_THE_MIRAGE. A mon with an\n"
      + "acuity ability (Frisk, Compound Eyes, Keen Eye, Anticipation, Forewarn) sees\n"
      + "through the haze to a hidden cache.\n"
      + "DO: on wave 12 read the description - it should NAME your sharp-eyed mon (this\n"
      + "party has Vespiquen w/ no acuity by default, so swap in one or rely on the\n"
      + "blind path). Choose 'Search the mirage'.\n"
      + "EXPECT: with an acuity mon -> an Ultra + Great reward pick; without one -> a\n"
      + "single Great pick. No raw enum text / missing locale keys.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_THE_MIRAGE,
        ABILITY_OVERRIDE: AbilityId.COMPOUND_EYES,
      });
      return [
        makeStarter(SpeciesId.BUTTERFREE, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Temple: Cleansing Font (#515)",
    description:
      "#515 - The Cleansing Font (Temple shrine). Forces ER_CLEANSING_FONT.\n"
      + "Your party starts BURNED (STATUS_OVERRIDE), the lead is knocked to ~1/3 HP, AND\n"
      + "the lead carries a Bog Witch CURSE (its Attack sapped 10% - check its summary).\n"
      + "DO: win the opening battle, then on wave 12 choose 'Drink from the font'.\n"
      + "EXPECT: because the party is cursed, the font LIFTS the curse (the 'cleansed'\n"
      + "line; the lead's Attack returns to normal on its summary) AND PartyHealPhase\n"
      + "fully restores HP + cures the burn. With no curse it would show 'restored'\n"
      + "instead. 'Leave it untouched' just moves on, still cursed + burned.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STATUS_OVERRIDE: StatusEffect.BURN,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_CLEANSING_FONT,
      });
      return [
        makeStarter(SpeciesId.LUMINEON, { moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.PROTECT, MoveId.U_TURN] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
    onBattleStart: () => {
      const lead = globalScene.getPlayerPokemon();
      if (lead) {
        lead.hp = Math.max(1, Math.floor(lead.getMaxHp() / 3));
        // Seed a Bog Witch curse (Attack sapped 10%) so the font's cure branch is
        // testable: Stat.ATK = 1.
        lead.customPokemonData.erCursedStat = 1;
        lead.calculateStats();
        lead.updateInfo();
      }
    },
  },
  {
    label: "ER Fairy Cave: Wishing Crystal (#521)",
    description:
      "#521 - The Wishing Crystal (Fairy Cave blessing). Forces ER_WISHING_CRYSTAL\n"
      + "in FAIRY_CAVE.\n"
      + "DO: read the description - it names the rolled tier (mostly Great, rarely\n"
      + "Ultra/Rogue). Pick a blessing: power, fortune, or protection.\n"
      + "EXPECT: a reward screen of picks at the ROLLED tier (1 for Great, 2 Ultra, 3\n"
      + "Rogue); on an Ultra+ roll the matching relic is included (power=Morale Banner,\n"
      + "fortune=Coin Purse, protection=Field Medic). No battle.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FAIRY_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_WISHING_CRYSTAL,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Ice Cave: Frozen in Time - with Fire (#518)",
    description:
      "#518 - Frozen in Time (Ice Cave preservation). Forces ER_FROZEN_IN_TIME in\n"
      + "ICE_CAVE. Party HAS a Fire source (Arcanine) -> the gentle-thaw branch.\n"
      + "DO: 'Thaw it free' -> the ancient mon wakes DROWSY and DOCILE (asleep), an\n"
      + "easy catch (throw a Ball). OR 'Chip out the item' for the preserved loot.\n"
      + "EXPECT: thaw -> a catchable wild battle vs a frozen ancient mon (Arctozolt/\n"
      + "Arctovish/Aurorus/Amaura), already asleep. Chip -> a reward (usually a\n"
      + "Never-Melt Ice, sometimes a heal item), no fight.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ICE_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FROZEN_IN_TIME,
      });
      return [
        makeStarter(SpeciesId.ARCANINE, {
          moveset: [MoveId.FLAMETHROWER, MoveId.EXTREME_SPEED, MoveId.CRUNCH, MoveId.WILL_O_WISP],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Ice Cave: Frozen in Time - no Fire (#518)",
    description:
      "#518 - Frozen in Time (Ice Cave preservation). Forces ER_FROZEN_IN_TIME in\n"
      + "ICE_CAVE. Party has NO Fire source -> the careless-thaw branch.\n"
      + "DO: 'Thaw it free' -> with no flame you crack the ice the hard way and the\n"
      + "ancient mon wakes HOSTILE.\n"
      + "EXPECT: thaw -> a boss-tier wild battle vs the frozen ancient mon (still\n"
      + "catchable once weakened, +levels). Chip out the item = same no-fight reward as\n"
      + "the with-Fire scenario.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ICE_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FROZEN_IN_TIME,
      });
      return [
        makeStarter(SpeciesId.LAPRAS, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.THUNDERBOLT, MoveId.BODY_SLAM],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Factory: The Fabricator (#525)",
    description:
      "#525 - The Fabricator (Factory crafting, rework of Salvage Yard). Forces\n"
      + "ER_FABRICATOR in FACTORY. Party carries a 5-stack of Sitrus + Leftovers + Soul\n"
      + "Dew to feed.\n"
      + "DO: 'Use the Smelter' (melt a whole stack -> higher-rarity item, more/finer =\n"
      + "better) or 'Use the Fabricator' (one item -> a production relic), then pick the\n"
      + "item, or 'Walk away'.\n"
      + "EXPECT: smelt -> a reward one-to-three tiers above the fed item (feeding the\n"
      + "5-stack Sitrus pushes it toward Rogue); the whole stack is consumed. Fabricate\n"
      + "-> a Scrap Magnet / Quartermaster / Collector's Album relic (one item consumed).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FACTORY,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FABRICATOR,
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "BERRY", type: BerryType.SITRUS, count: 5 },
          { name: "LEFTOVERS" },
          { name: "SOUL_DEW" },
        ],
      });
      return [
        makeStarter(SpeciesId.METAGROSS, {
          moveset: [MoveId.METEOR_MASH, MoveId.EARTHQUAKE, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Temple: The Innate Shrine (#514)",
    description:
      "#514 - The Innate Shrine (Temple trial). Forces ER_INNATE_SHRINE in TEMPLE.\n"
      + "SETUP: TYRANITAR is forced to have at least one LOCKED innate (so the unlock\n"
      + "is visible) - on the maintainer account this edits the save; on any other\n"
      + "account nothing is touched (pick a mon that already has a locked innate).\n"
      + "DO: open Abilities on TYRANITAR FIRST and note a LOCKED innate. Then 'Take the\n"
      + "trial', attune TYRANITAR, and beat the guardian (Bronzong, omni-boosted boss).\n"
      + "EXPECT on WIN: all of that mon's innates are active FOR THE RUN, AND one\n"
      + "previously-locked innate is PERMANENTLY unlocked - confirm it stays unlocked\n"
      + "after the run / in Starter Select. Leave -> no fight, no boon.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.TEMPLE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_INNATE_SHRINE,
      });
      // Maintainer-account-only: make sure TYRANITAR has a locked innate to unlock.
      ensureLockedInnate(SpeciesId.TYRANITAR);
      return [
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.CONKELDURR, {
          moveset: [MoveId.DRAIN_PUNCH, MoveId.MACH_PUNCH, MoveId.KNOCK_OFF, MoveId.BULK_UP],
        }),
      ];
    },
  },
  {
    label: "ER Volcano: The Great Forge (#513)",
    description:
      "#513 - The Great Forge (Volcano crafting). Forces ER_GREAT_FORGE in VOLCANO.\n"
      + "Party carries held items of different rarities (Leftovers/Soul Dew/Sitrus) to\n"
      + "feed.\n"
      + "DO: 'Temper gently' (+1 tier, low crack) or 'Stoke white-hot' (+2 tiers, high\n"
      + "crack), then pick a held item to feed, or 'Leave the forge'.\n"
      + "EXPECT: success -> a reward screen one/two rarity tiers above the fed item\n"
      + "(a Master-tier feed -> a relic); crack -> the item is consumed and you get a\n"
      + "little slag money, no item. The fed item is consumed either way. Crack chance\n"
      + "rises with heat AND the fed item's rarity.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.VOLCANO,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GREAT_FORGE,
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "LEFTOVERS" },
          { name: "SOUL_DEW" },
          { name: "BERRY", type: BerryType.SITRUS },
        ],
      });
      return [
        makeStarter(SpeciesId.TYPHLOSION, {
          moveset: [MoveId.ERUPTION, MoveId.FLAMETHROWER, MoveId.FOCUS_BLAST, MoveId.SOLAR_BEAM],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Ruins: The Dormant Guardian (#520)",
    description:
      "#520 - The Dormant Guardian (Ruins Braille puzzle -> boss). Forces\n"
      + "ER_DORMANT_GUARDIAN in RUINS.\n"
      + "DO: 'Read the seal' and decode the BRAILLE (raised dot-cells); the A-Z Braille\n"
      + "KEY now shows on a panel to the RIGHT of the card so you can decode it (#542).\n"
      + "Pick the matching word. The LAST question is a longer two-word PHRASE.\n"
      + "Or 'Leave it sealed'.\n"
      + "EXPECT: correct -> attune, a reward screen with a relic + a Rogue pick, no\n"
      + "fight. Wrong -> the construct (Golurk/Regirock/Registeel/Golem) wakes as a 5-6\n"
      + "bar omni-boosted boss (+5 levels, all stats +1 on entry); win for the same\n"
      + "relic + Rogue reward. Leave -> no battle, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.RUINS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_DORMANT_GUARDIAN,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.METEOR_MASH, MoveId.AURA_SPHERE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Island: The Regional Emissary (#526)",
    description:
      "#526 - The Regional Emissary (Island exhibition, rework of Import Bazaar).\n"
      + "Forces ER_REGIONAL_EMISSARY in ISLAND.\n"
      + "DO: 'Battle for Alolan Ninetales' or 'Battle for Hisuian Zoroark' to fight the\n"
      + "regional exhibition team (Alolan Ninetales / Galarian Weezing / Hisuian\n"
      + "Zoroark), or 'Decline'.\n"
      + "EXPECT: a trainer battle vs the regional team; on WIN the star you chose joins\n"
      + "your party (a catch/obtain message). Decline -> no battle, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ISLAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_REGIONAL_EMISSARY,
      });
      return [
        makeStarter(SpeciesId.METAGROSS, {
          moveset: [MoveId.METEOR_MASH, MoveId.EARTHQUAKE, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH],
        }),
        makeStarter(SpeciesId.SALAMENCE, {
          moveset: [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.FIRE_FANG, MoveId.DRAGON_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Wasteland: The Scavenger's Pact (#523)",
    description:
      "#523 - The Scavenger's Pact (Wasteland character test). Forces\n"
      + "ER_SCAVENGERS_PACT in WASTELAND.\n"
      + "DO: 'Split it fairly' (no fight), 'Take it all' (betray + fight the rival\n"
      + "scavenger), or 'Walk away'.\n"
      + "EXPECT: split -> a reward screen (Ultra+Great), no battle; betray -> a trainer\n"
      + "fight vs a ROUGHNECK scavenger fielding Krookodile/Mightyena/Flygon, win for\n"
      + "Rogue+Ultra; walk away -> no battle, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 55,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.WASTELAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SCAVENGERS_PACT,
      });
      return [
        makeStarter(SpeciesId.DRAGONITE, {
          moveset: [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.FIRE_PUNCH, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.SLOWBRO, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.PSYCHIC, MoveId.SLACK_OFF],
        }),
      ];
    },
  },
  {
    label: "ER Slum: The Fight Club (#524)",
    description:
      "#524 - The Fight Club (Slum bet/brawl). Forces ER_FIGHT_CLUB in SLUM.\n"
      + "DO: 'Step into the ring' (small ante) or 'Up the ante' (big ante) to brawl, or\n"
      + "'Back out'. Run it a few times to confirm the fighters VARY each run.\n"
      + "EXPECT: ante deducted up front; the crew is sampled fresh from a brawler pool\n"
      + "(2 mons small / 3 big) so it differs run to run, TRAPS you in (no switching),\n"
      + "and the lead SWAGGERS in with a clear message that the HANDLER injected it with\n"
      + "a black-market serum (announced all-stats power-up). They pull dirty tricks\n"
      + "(Fake Out, Sand Attack, Toxic, Knock Off, Quick Claw/Focus Band/King's Rock).\n"
      + "Win -> the loot payout. Back out = no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SLUM,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FIGHT_CLUB,
        STARTING_MONEY_OVERRIDE: 50000,
      });
      return [
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.METEOR_MASH, MoveId.EXTREME_SPEED, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Swamp: The Bog Witch's Bargain (#508)",
    description:
      "#508 - The Bog Witch's Bargain (Swamp DEAL). Forces ER_BOG_WITCH in SWAMP.\n"
      + "The witch wants an offering at or above a HIDDEN rarity (Great/Ultra/Rogue),\n"
      + "which she never names. (Tier is now inferred reliably, so a cheap item really\n"
      + "reads as cheap.)\n"
      + "DO: 'Leave an offering', pick a held item. Party carries a cheap item\n"
      + "(Leftovers) and a Rogue-tier item (Soul Dew) to test both outcomes.\n"
      + "EXPECT: offer >= her hidden bar -> purges all party status + a Weathervane RELIC\n"
      + "that NOW SHOWS in the reward screen (Master Ball). Offer below it -> a permanent\n"
      + "CURSE: one random party mon has one stat sapped 10% (message names the mon +\n"
      + "stat), visible on its summary, lasting until lifted at a Cleansing Font. The\n"
      + "offered item is consumed either way. 'Refuse' = no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SWAMP,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_BOG_WITCH,
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "LEFTOVERS" },
          { name: "SOUL_DEW" },
          { name: "BERRY", type: BerryType.SITRUS },
        ],
      });
      return [
        makeStarter(SpeciesId.GRIMER, {
          moveset: [MoveId.SLUDGE_BOMB, MoveId.TOXIC, MoveId.MINIMIZE, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Abyss: Seven Sins / The Bargain (#544)",
    description:
      "#544 - The Bargain (Abyss Seven Sins). WIN this wave-10 Abyss battle: Giratina's\n"
      + "Bargain then fires in the Abyss every-10-waves SHOP SLOT (a dialogue EVENT - not a\n"
      + "mystery encounter, not the vanilla Dark Deal). Giratina Origin (six-winged) and his\n"
      + "portrait appear, offering 3 random Sins of 6 active, plus Leave. All sins are\n"
      + "save-safe; the party never exceeds 6 (7th-slot parked).\n"
      + "DO: win the fight, read the dialogue + see the portrait, then take each Sin.\n"
      + "EXPECT per Sin:\n"
      + " - Greed: empty a mon's candy -> money + a Greater Golden Ball (+2 reward picks).\n"
      + " - Gluttony: give up 1 mon for the run -> a Legendary Egg in your egg list.\n"
      + " - Pride: pick the SHINY Garchomp -> it loses its shine + Luck -> +30% to a stat\n"
      + "   you choose (visible on its summary).\n"
      + " - Wrath: curse a random stat on one mon (-10%) -> +20% to another mon's best stat.\n"
      + " - Envy: strip all items off Garchomp (holds 3) -> choose a relic. CURSED IDOL =\n"
      + "   first mon out each battle gets a FREE Substitute, the next entrant arrives at\n"
      + "   half HP (verify in the next fight).\n"
      + " - Sloth: 2 chosen mons drop to Lv 1 + lose candy -> COVENANT OF REST relic (full\n"
      + "   team heal every 7th wave).\n"
      + " - Lust (appears ONLY if a party mon's species has 100+ candy banked): that mon\n"
      + "   surrenders its levels (-> Lv 1), ALL its IVs (zeroed), and its whole candy hoard\n"
      + "   -> it becomes a PERMANENT tier-1 shiny (a NORMAL shiny, never a black shiny).\n"
      + "   On a fresh dev mon with no candy it will NOT be offered; bring a 100+ candy mon.\n"
      + "Leave = Giratina's parting line, no cost. Party: shiny Garchomp + 3-item holder,\n"
      + "all Lv 30 so every offerable Sin can come up (6 active sins; 3 shown per visit).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        // Start ON a x0 wave in the Abyss: win this battle and the Abyss shop slot
        // fires Giratina's Bargain (TheBargainPhase) post-victory.
        STARTING_WAVE_OVERRIDE: 10,
        STARTING_BIOME_OVERRIDE: BiomeId.ABYSS,
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "LEFTOVERS" },
          { name: "SOUL_DEW" },
          { name: "BERRY", type: BerryType.SITRUS },
        ],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          shiny: true,
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.SLEEP_TALK],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.SURF, MoveId.NUZZLE, MoveId.QUICK_ATTACK],
        }),
        makeStarter(SpeciesId.EEVEE, {
          moveset: [MoveId.SWIFT, MoveId.BITE, MoveId.QUICK_ATTACK, MoveId.HELPING_HAND],
        }),
      ];
    },
  },
  {
    label: "ER Swamp: The Sinking Mire (#509)",
    description:
      "#509 - The Sinking Mire (Swamp read-the-typing). Forces ER_SINKING_MIRE in\n"
      + "SWAMP. A random party mon starts sinking.\n"
      + "DO: 'Haul it out' and pick a rescuer. A Flying/Levitate/light/strong-Attack mon\n"
      + "succeeds; a heavy weakling flounders. (Party: Crobat = Flying rescuer that\n"
      + "always works; Munchlax = heavy weakling that flounders.) Or 'Leave it'.\n"
      + "EXPECT: good rescuer -> the sinker's status cleared + a dredged cache reward,\n"
      + "now 60% ULTRA-tier / 40% ROGUE-tier rarity (re-run to see it vary); bad rescuer\n"
      + "-> the sinking mon takes ~1/4 HP mire damage + loses a held item. Leave -> the\n"
      + "bog takes one of the sinker's held items (or chips it), no reward.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SWAMP,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SINKING_MIRE,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
      });
      return [
        makeStarter(SpeciesId.CROBAT, {
          moveset: [MoveId.CROSS_POISON, MoveId.AIR_SLASH, MoveId.ROOST, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.MUNCHLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Graveyard: Unfinished Business (#517)",
    description:
      "#517 - Unfinished Business (Graveyard score-settling). Forces\n"
      + "ER_UNFINISHED_BUSINESS in GRAVEYARD. With an empty ghost pool it uses the\n"
      + "synthetic legacy grave: killer team = Garchomp / Spiritomb / Milotic.\n"
      + "DO: read the epitaph (challenger name / difficulty / wave / killer), then\n"
      + "'Finish their fight' to battle the killer team, or 'Walk on'.\n"
      + "EXPECT: finish -> a spectral TRAINER (named after the killer) fielding the\n"
      + "exact killer team, level-scaled; win -> a reward screen with one random RELIC\n"
      + "that NOW SHOWS (Master Ball). Walk on -> no battle, no cost. Online, the option\n"
      + "AWAITS a live ghost sample, so you fight the real team that ended a real\n"
      + "player's run (only falls back to the legacy trio if the pool is truly empty).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.GRAVEYARD,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_UNFINISHED_BUSINESS,
      });
      return [
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.ICE_BEAM, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Badlands: High Noon (#516)",
    description:
      "#516 - High Noon (Badlands single-strike duel). Forces ER_HIGH_NOON in\n"
      + "BADLANDS.\n"
      + "DO: 'Take the duel' and pick a Pokemon. The stake is now HALF your money, and the\n"
      + "outlaw's draw speed is HIDDEN (no number shown - the duel is hint-only).\n"
      + "EXPECT: half your money is staked (money drops by ~50%); pick the fast Ninjask ->\n"
      + "it out-draws the outlaw and you end with ~1.5x your money (stake back + the pot);\n"
      + "pick the slow Munchlax -> out-drawn, you keep only the other half. No battle.\n"
      + "'Walk away' = no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.BADLANDS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_HIGH_NOON,
      });
      return [
        makeStarter(SpeciesId.NINJASK, {
          moveset: [MoveId.X_SCISSOR, MoveId.AERIAL_ACE, MoveId.SWORDS_DANCE, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.MUNCHLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Mountain: The Mountain Sage (#522)",
    description:
      "#522 - The Mountain Sage (Mountain training event). Forces ER_MOUNTAIN_SAGE\n"
      + "in MOUNTAIN.\n"
      + "DO: on wave 12 choose 'Train the body', 'Train the technique', or bow out.\n"
      + "EXPECT: body -> a reward screen with 2 vitamins + a Rare Candy; technique ->\n"
      + "a Learner's Shroom (teach any move); bow -> move on, no reward. No battle.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.MOUNTAIN,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_MOUNTAIN_SAGE,
      });
      return [
        makeStarter(SpeciesId.MEDICHAM, {
          moveset: [MoveId.HIGH_JUMP_KICK, MoveId.ZEN_HEADBUTT, MoveId.ICE_PUNCH, MoveId.BULK_UP],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Power Plant: Reactor Meltdown (#519)",
    description:
      "#519 - Reactor Meltdown (Power Plant pick-the-right-mon). Forces\n"
      + "ER_REACTOR_MELTDOWN in POWER_PLANT. REWORKED: instead of reading gauges, you\n"
      + "now pick the right POKEMON for the job. Each run rolls one crucial stat + 3\n"
      + "candidate species whose value in it is close (within 5, never equal, all < 100).\n"
      + "DO: read the hazard line in the description (it HINTS the stat - force a door =\n"
      + "Atk, sprint to the button = Spd, etc.) and send the candidate with the highest\n"
      + "value in that stat. Re-run to confirm the stat + the 3 mons VARY.\n"
      + "EXPECT: correct (highest in the stat) -> core stabilises -> Capacitor relic\n"
      + "(it shows in the reward screen now). WRONG -> the blowout BURNS your whole party,\n"
      + "no reward. (Distinct from Overcharge the Core's stat surge.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.POWER_PLANT,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_REACTOR_MELTDOWN,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.SPLASH] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Desert: The Buried City (#510)",
    description:
      "#510 - The Buried City (Desert press-your-luck delve). Forces ER_BURIED_CITY\n"
      + "in DESERT.\n"
      + "DO: 'Dig into the city', then 'Dig deeper' past guardian stirs; keep pushing\n"
      + "until the warden RUNERIGUS rises, beat it, then 'Climb out'.\n"
      + "EXPECT: money/nuggets per dig; stirs = Ground guardians (BST climbs). The warden\n"
      + "no longer rises at a FIXED count - it is a CHANCE that climbs the deeper you go,\n"
      + "so it can come early or late. When it does it is much stronger: +10 levels over\n"
      + "your best, 3-4 bars, a maxed PRIME Ward Stone + a resist berry per weakness.\n"
      + "Banking AFTER beating Runerigus grants the Pharaoh's Ankh relic (shows now) +\n"
      + "Ultra picks; banking WITHOUT beating it = NO Ankh.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.DESERT,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_BURIED_CITY,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.CRUNCH, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "ER Volcano: Into the Caldera (#512)",
    description:
      "#512 - Into the Caldera (Volcano press-your-luck delve). Forces\n"
      + "ER_INTO_THE_CALDERA in VOLCANO.\n"
      + "DO: 'Descend the tube', then 'Descend deeper' a few times; 'Rise to the rim'\n"
      + "to bank.\n"
      + "EXPECT: a paying descent (~65%) now nets a BIG sum - at least ~10% of your\n"
      + "current money - plus a climbing chance to FIND a held item handed straight to\n"
      + "the lead (Flame Orb / Quick Claw / King's Rock) with a notification. Each\n"
      + "descent still scorches NON-Fire mons ~1/16 max HP (Magcargo lead spared; Pidgey\n"
      + "takes heat, never below 1). Pushing raises the eruption chance -> a Fire guardian\n"
      + "(BST climbs, boss 3-4 bars). A DEEP bank can offer Molten Core / Greater Golden\n"
      + "Ball / a party-line Mega Stone + high-tier picks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.VOLCANO,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_INTO_THE_CALDERA,
      });
      return [
        makeStarter(SpeciesId.MAGCARGO, {
          moveset: [MoveId.LAVA_PLUME, MoveId.ROCK_SLIDE, MoveId.RECOVER, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Graveyard: Graves of the Fallen (#439)",
    description:
      "#439 Graveyard ME (rides the ghost-team substrate). Forces\n"
      + "ER_GRAVES_OF_THE_FALLEN in the GRAVEYARD biome. This scenario PLANTS a real\n"
      + "named grave (Veteran Lance, hell, fell at wave 147, beaten by Champion\n"
      + "Cynthia) so the epitaph + mementos always render even on an empty pool.\n"
      + "EXPECT: the epitaph shows that NAME / difficulty / wave / killer. PAY\n"
      + "RESPECTS -> a memento (their held item) and leave. DISTURB -> they rise as a\n"
      + "NAMED GHOST TRAINER (Lance's team, ghost theme); win -> the player gets TWO\n"
      + "reward-selection screens IN A ROW over the memento pool (the fallen team's held\n"
      + "items + solid fallbacks), so they CHOOSE two items (was a silent direct-grant -\n"
      + "reported as 'no item selection'). Online, the option AWAITS a live ghost sample,\n"
      + "so it uses a REAL fallen player's team when the pool has one. WALK AWAY -> no\n"
      + "cost. Never softlocks.",
    setup: () => {
      resetDevOverrides();
      // Plant a real named grave so the epitaph (name/wave/mode/killer) and the
      // held-item mementos render regardless of the live ghost pool's contents.
      seedDevGhostGrave();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.GRAVEYARD,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GRAVES_OF_THE_FALLEN,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.CRUNCH],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Forest: Woodland Forager (#439)",
    description:
      "#439 Forest press-your-luck FORAGE loop (Phase A3 substrate + first event).\n"
      + "Forces ER_WOODLAND_FORAGER in the FOREST biome.\n"
      + "DO: pick 'Forage the grove', then 'Forage on' repeatedly (common -> rare\n"
      + "berries, a Rogue ingredient deep in) while the BUST chance climbs; or 'Pack\n"
      + "up and leave' to stop.\n"
      + "EXPECT: each forage hands a berry to your party RIGHT AWAY (check held items).\n"
      + "Pushing into an interrupt spawns an escalating 2-mon Bug swarm - WIN and\n"
      + "foraging RESUMES (it does NOT end). Each interrupt pulls a tougher lead and\n"
      + "more levels; after 3 the lead is the chain BOSS (2-3 health bars, >= 5 levels\n"
      + "over your strongest mon). Berries already held are never lost. Pack up = leave\n"
      + "with everything (+ Rogue pick on a jackpot). Round-0 leave = nothing. A party\n"
      + "wipe ends the run; never softlocks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FOREST,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_WOODLAND_FORAGER,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.FIRE_FANG],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Glittering Vein (#439)",
    description:
      "#439 Cave press-your-luck MINING (reuses the press-luck substrate). Forces\n"
      + "ER_GLITTERING_VEIN in the CAVE biome.\n"
      + "DO: 'Work the vein', then keep digging or pack up. Each round rolls money:\n"
      + "usually a jittered payout, sometimes a NUGGET (big), sometimes NOTHING (dud).\n"
      + "Item finds are HELD only: Eviolite / Mystical Rock (uncommon, deep), a King's\n"
      + "Rock (rare, ~mega-rare), or a party-line Mega Stone. BUST chance climbs.\n"
      + "EXPECT: money is paid per strike and kept on a bust (nothing scatters). bank =\n"
      + "item shop if any found. A bust spawns an escalating wild Rock/Ground mon\n"
      + "(Onix->Gigalith); after 3 it is the chain BOSS (2-3 bars, >= 5 levels over your\n"
      + "strongest). Win and mining RESUMES. Round-0 leave = nothing. Never softlocks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GLITTERING_VEIN,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.WATERFALL, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Overgrown Temple (#439)",
    description:
      "#439 Jungle press-your-luck DELVE (reuses the press-luck substrate). Forces\n"
      + "ER_OVERGROWN_TEMPLE in the JUNGLE biome.\n"
      + "DO: 'Delve into the temple', then press deeper or climb out. Each chamber rolls\n"
      + "money: usually jittered, sometimes a NUGGET (big), sometimes NOTHING (dud). Item\n"
      + "finds are HELD only: Eviolite / Mystical Rock (uncommon, deep), a King's Rock\n"
      + "(rare, ~mega-rare), or a party-line Mega Stone. WAKE chance climbs each step.\n"
      + "EXPECT: money is paid per chamber and kept on a wake (nothing scatters). climb\n"
      + "out = item shop if any found. A wake spawns an escalating wild Grass/Rock\n"
      + "guardian (Sudowoodo->Tangrowth); after 3 it is the chain BOSS - BURMY ETERNA\n"
      + "('Eternaburm', 2-3 bars, >= 5 levels over your strongest). Win and delving\n"
      + "RESUMES. Chamber-0 leave = nothing. Never softlocks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.JUNGLE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_OVERGROWN_TEMPLE,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.FIRE_FANG, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Tide Pools (#439)",
    description:
      "#439 Beach press-your-luck COMB (reuses the press-luck substrate). Forces\n"
      + "ER_TIDE_POOLS in the BEACH biome.\n"
      + "DO: 'Comb the pools', then keep combing or pack up. Each comb rolls money:\n"
      + "usually jittered, sometimes a PEARL (big), sometimes NOTHING (dud). Item finds\n"
      + "are HELD only: Eviolite / Mystical Rock (uncommon, deep), a King's Rock (rare),\n"
      + "or a party-line Mega Stone. BUST chance climbs.\n"
      + "EXPECT: money paid per comb and kept on a bust. pack up = item shop if any.\n"
      + "A bust spawns an escalating wild Water mon (Corsola->Gyarados); after 3 it is\n"
      + "the chain BOSS (2-3 bars, >= 5 levels over your strongest). Win and combing\n"
      + "RESUMES. Round-0 leave = nothing. Never softlocks.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.BEACH,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_TIDE_POOLS,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Abyssal Vent (#439)",
    description:
      "#439 Seabed press-your-luck DELVE (reuses the press-luck substrate). Forces\n"
      + "ER_ABYSSAL_VENT in the SEABED biome.\n"
      + "DO: 'Dive the trench', then dive deeper or rise up. Each descent rolls money:\n"
      + "usually jittered, sometimes a NUGGET (big), sometimes NOTHING (dud). Item finds\n"
      + "are HELD only: Eviolite / Mystical Rock (uncommon, deep), a King's Rock (rare),\n"
      + "or a party-line Mega Stone. STIR chance climbs each level.\n"
      + "EXPECT: money paid per descent and kept on a stir. rise = item shop if any.\n"
      + "A stir spawns an escalating wild deep-sea mon (Lanturn->Dhelmise); after 3 it\n"
      + "is the chain BOSS (2-3 bars, >= 5 levels over your strongest). Win and diving\n"
      + "RESUMES. Level-0 rise = nothing. Never softlocks.\n"
      + "#492 REGRESSION: keep diving until the trench STIRS - the guardian (often an\n"
      + "ER custom) must spawn and its enemy HP/info bar must render with NO crash. The\n"
      + "crash was unguarded dex/starter lookups in enemy-battle-info for not-in-dex\n"
      + "enemies; ER custom guardians are intended and now render fine.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEABED,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_ABYSSAL_VENT,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Hot Spring (#439)",
    description:
      "#439 Mountain REST, redesigned: guardian Pokemon (a Slowking sprite) watch the\n"
      + "spring and accept BERRIES as tribute, not money. Party seeded with 5 Sitrus\n"
      + "Berries so the toll is affordable.\n"
      + "DO: 'Offer Berries (3)' or 'Move on' for free.\n"
      + "EXPECT: the intro shows a Slowking guardian (not a chest); Offer spends 3\n"
      + "berries (check held items: 5 -> 2) and fully restores the WHOLE party via\n"
      + "PartyHealPhase with a 'fully restored' message. The Offer option greys out if\n"
      + "the party holds fewer than 3 berries. The whole party starts at ~1/3 HP, so\n"
      + "the heal is clearly VISIBLE (HP bars jump back to full).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.MOUNTAIN,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS, count: 5 }],
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_HOT_SPRING,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEOT, { moveset: [MoveId.AIR_SLASH, MoveId.HURRICANE, MoveId.ROOST, MoveId.U_TURN] }),
      ];
    },
    onBattleStart: () => {
      // Hurt the whole party to ~1/3 HP so the spring's full-restore is visible.
      for (const mon of globalScene.getPlayerParty()) {
        mon.hp = Math.max(1, Math.floor(mon.getMaxHp() / 3));
        mon.updateInfo();
      }
    },
  },
  {
    label: "ER Fairy's Boon (#542)",
    description:
      "#542 Fairy Cave TEMPORARY LUCK blessing (reworked from a free relic).\n"
      + "Forces ER_FAIRYS_BOON in the FAIRY_CAVE biome.\n"
      + "DO: 'Accept the blessing' or 'Decline politely'.\n"
      + "EXPECT: Accept shows a 'Fortune smiles' message (+6 luck for 12 waves) and\n"
      + "leaves with NO reward screen. Check the in-battle LUCK value jumps by 6 for\n"
      + "the next ~12 waves, then fades back. Decline = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FAIRY_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FAIRYS_BOON,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SYLVEON, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYSHOCK, MoveId.SHADOW_BALL, MoveId.WISH],
        }),
      ];
    },
  },
  {
    label: "ER The Picnic (#439)",
    description:
      "#439 Meadow social REST. Forces ER_PICNIC in the MEADOW biome.\n"
      + "DO: 'Lay out a spread' or 'Move on'.\n"
      + "EXPECT: the spread grants +5 Candy to EACH party member's species (check candy\n"
      + "on the starter screen) and adds affection to the whole party, with a message.\n"
      + "Move on = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.MEADOW,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_PICNIC,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Exotic Trader (#439)",
    description:
      "#439 Sea premium MARKET. Forces ER_EXOTIC_TRADER in the SEA biome (with money).\n"
      + "DO: 'Board and browse' (steep wave-scaled fee) or 'Sail on' for free.\n"
      + "EXPECT: Board deducts the fee and opens a no-battle reward of 3 GUARANTEED\n"
      + "high-tier picks (1 Rogue + 2 Ultra). The board option greys out if you cannot\n"
      + "afford it. Sail on = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_MONEY_OVERRIDE: 200000,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEA,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_EXOTIC_TRADER,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Totem Trial (#503)",
    description:
      "#503 ISLAND Trial (moved off Temple). Forces ER_TOTEM_TRIAL in the ISLAND\n"
      + "biome. DO: 'Face the totem' or 'Leave it at rest'.\n"
      + "EXPECT: Face = a DOUBLE battle - a multi-bar totem boss (Golurk / Regirock /\n"
      + "Runerigus) that SUMMONS an ally (Sableye / Bronzong / Carbink), the totem\n"
      + ">= 5 levels above your strongest mon. WIN and the reward fires: a guaranteed\n"
      + "POWER GEM (its TM) + one ROGUE pick (no relic - that was Temple's Innate\n"
      + "Shrine). Leave = nothing, no cost. A wipe ends the run (never softlocks).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ISLAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_TOTEM_TRIAL,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Black Market (#439)",
    description:
      "#439 Slum bargain MARKET. Forces ER_BLACK_MARKET in the SLUM biome.\n"
      + "DO: 'Browse the stalls' or 'Walk away'.\n"
      + "EXPECT: Browse opens a no-battle reward of 3 mixed-tier picks (2 Great + 1\n"
      + "Ultra). Walk away = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SLUM,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_BLACK_MARKET,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Lake Spirit (#439)",
    description:
      "#439 Lake knowledge TRIAL (reuses the ErQuiz dex engine). Forces ER_LAKE_SPIRIT\n"
      + "in the LAKE biome.\n"
      + "DO: 'Take the test' (3 Pokedex riddles) or 'Decline'.\n"
      + "EXPECT: the blessing scales with correct answers - 3/3 = +5 Candy each + a\n"
      + "blessing Relic + 2 Ultra picks; 2 = 3 Ultra picks; 1 = 3 Great picks; 0 = leave\n"
      + "with a heal. Decline = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.LAKE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_LAKE_SPIRIT,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Import Bazaar (#542)",
    description:
      "#542 Island MARKET, now a REAL paid SHOP (reworked from a free pick-one).\n"
      + "Forces ER_IMPORT_BAZAAR in the ISLAND biome. Start with plenty of money.\n"
      + "DO: 'Browse the bazaar' or 'Move on'.\n"
      + "EXPECT: Browse opens the full-screen 4x4 SHOP UI (like Black Market / Exotic\n"
      + "Trader) stocked with imported held items + supplies at fair prices - BUY with\n"
      + "money, assign held items to a mon, then leave. Move on = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ISLAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_IMPORT_BAZAAR,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Sealed Door / Unown Cipher (#506)",
    description:
      "#506 Ruins UNOWN CIPHER (no longer the silhouette game). Forces\n"
      + "ER_SEALED_DOOR in the RUINS biome.\n"
      + "DO: 'Read the glyphs' or 'Leave it sealed'. EXPECT: each of 3 questions shows\n"
      + "a WORD spelled out in UNOWN letter glyphs; pick the matching word from the 4\n"
      + "choices. The LAST question is a longer TWO-WORD phrase, shown as two stacked\n"
      + "glyph rows (#542). The vault tier scales with correct decodes - 3/3 = 3 Rogue\n"
      + "picks; 2 = 3 Ultra; 1 = 3 Great; 0 = leave with a heal. Leave it sealed =\n"
      + "nothing, no cost. CHECK the Unown glyphs render (distinct letter icons, not blank).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.RUINS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SEALED_DOOR,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Overcharge the Core (#439)",
    description:
      "#439 Power Plant PERMANENT STAT SURGE (reworked from the old boss fight).\n"
      + "Forces ER_OVERCHARGE_CORE in POWER_PLANT.\n"
      + "DO: 'Channel the core' -> pick a Pokemon. A press-your-luck loop opens: each\n"
      + "'Surge again' permanently raises that mon's Sp. Atk OR Speed (a vitamin, fixed\n"
      + "stat for the session); 'Stabilize' to keep them.\n"
      + "EXPECT: each surge bumps the stat for good (check Summary stats climb); pushing\n"
      + "raises the short-circuit chance - on a short-circuit the WHOLE session's surges\n"
      + "vanish and the mon is chipped (HP drops, never below 1). 'Pull the breaker' =\n"
      + "nothing, no cost. NO boss battle should appear.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.POWER_PLANT,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_OVERCHARGE_CORE,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Frozen Shapes (#439)",
    description:
      "#439 Ice Cave silhouette puzzle (reuses the ErQuiz engine). Forces\n"
      + "ER_FROZEN_SHAPES in the ICE_CAVE biome.\n"
      + "DO: 'Read the shapes' (3 silhouette questions) or 'Leave the ice'.\n"
      + "EXPECT: the cache tier scales with correct answers - 3/3 = 3 Rogue picks; 2 = 3\n"
      + "Ultra; 1 = 3 Great; 0 = leave with a heal. Leave = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.ICE_CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FROZEN_SHAPES,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Salvage Yard (#439)",
    description:
      "#439 Factory SCRAP-HEAP minigame (reuses the ErQuiz engine, 'item' kind).\n"
      + "Forces ER_SALVAGE_YARD in the FACTORY biome.\n"
      + "DO: 'Sort the scrap heap' (3 part SILHOUETTES, name each from 4 choices) or\n"
      + "'Leave it be'.\n"
      + "EXPECT: each part is a held-item icon shown as a black SILHOUETTE. Every part\n"
      + "you name correctly is reclaimed - a no-battle reward screen grants exactly\n"
      + "those held items (0-3 of them). Name none = leave empty-handed, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.FACTORY,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SALVAGE_YARD,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Foreman's Job (#439)",
    description:
      "#439 Construction Site boss TRIAL. Forces ER_FOREMANS_JOB in the\n"
      + "CONSTRUCTION_SITE biome.\n"
      + "DO: 'Take the job' or 'Clock out'.\n"
      + "EXPECT: Take = a BOSS battle vs a construction golem (Conkeldurr / Bronzong /\n"
      + "Coalossal), 2-3 bars and >= 5 levels above your strongest mon. WIN for 2 Rogue\n"
      + "picks + a Relic. Clock out = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.CONSTRUCTION_SITE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_FOREMANS_JOB,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER The Aurora (#439)",
    description:
      "#439 Snowy Forest blessing. Forces ER_AURORA in the SNOWY_FOREST biome.\n"
      + "DO: 'Stand under the lights' or 'Walk on'.\n"
      + "EXPECT: Stand opens a no-battle reward of 3 guaranteed Ultra picks. Walk on =\n"
      + "nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SNOWY_FOREST,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_AURORA,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER Tracks in the Snow (#498)",
    description:
      "#498 Snowy Forest footprint hunt. Forces ER_TRACKS_IN_THE_SNOW in SNOWY_FOREST.\n"
      + "DO: 'Read the tracks' -> a FOOTPRINT sprite shows; pick who made it from 3\n"
      + "names. (Species with no footprint art fall back to a black silhouette.)\n"
      + "EXPECT: Right = a no-battle reward of 3 Ultra picks; wrong = 2 Great picks\n"
      + "(never empty). 'Leave the trail' = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SNOWY_FOREST,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_TRACKS_IN_THE_SNOW,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
        makeStarter(SpeciesId.PIDGEY, {
          moveset: [MoveId.TACKLE, MoveId.GUST, MoveId.QUICK_ATTACK, MoveId.SAND_ATTACK],
        }),
      ];
    },
  },
  {
    label: "ER The Experiment (#439)",
    description:
      "#439 Laboratory GAMBLE. Forces ER_EXPERIMENT in the LABORATORY biome (money).\n"
      + "DO: 'Run the experiment' or 'Decline'.\n"
      + "EXPECT: ~80% success = a no-battle reward of 3 Ultra picks; ~20% backfire = no\n"
      + "reward + a wave-scaled cleanup fee deducted, with a backfire message. Decline =\n"
      + "nothing, no cost. (Outcome is RNG; re-roll the scenario to see both.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_MONEY_OVERRIDE: 50000,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.LABORATORY,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_EXPERIMENT,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Gentle Giant (#439)",
    description:
      "#439 Grass CATCH event. Forces ER_GENTLE_GIANT in the GRASS biome.\n"
      + "DO: 'Approach it' or 'Leave it be'.\n"
      + "EXPECT: Approach = a wild-boss battle vs a docile Grass titan (Torterra /\n"
      + "Tangrowth / Gogoat / Tsareena), asleep + multi-bar. Weaken it, then the Ball\n"
      + "command CATCHES it (catch is allowed; flee is not). Leave = nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.GRASS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_GENTLE_GIANT,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Rustling Grass (#439)",
    description:
      "#439 Tall Grass CATCH event. Forces ER_RUSTLING_GRASS in the TALL_GRASS biome.\n"
      + "DO: 'Flush it out' or 'Leave it hidden'.\n"
      + "EXPECT: Flush = a wild-boss battle vs a rare hidden mon (Ditto / Chansey /\n"
      + "Kangaskhan / Bouffalant). Weaken it, then the Ball command CATCHES it. Leave =\n"
      + "nothing, no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 45,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.TALL_GRASS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_RUSTLING_GRASS,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Dragon's Hoard (#439)",
    description:
      "#439 Wasteland CATCH + loot event. Forces ER_DRAGONS_HOARD in the WASTELAND\n"
      + "biome.\n"
      + "DO: 'Challenge it' or 'Back away'.\n"
      + "EXPECT: Challenge = a wild-boss battle vs a strong dragon (Hydreigon /\n"
      + "Dragonite / Salamence / Garchomp). WIN to collect the hoard (2 Rogue + 1 Ultra\n"
      + "picks), or throw a Ball to CATCH the dragon instead. Back away = nothing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.WASTELAND,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_DRAGONS_HOARD,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
      ];
    },
  },
  {
    label: "ER Still Waters (#439)",
    description:
      "#439 Lake MIRROR-match. Forces ER_STILL_WATERS in the LAKE biome.\n"
      + "DO: 'Face your reflection' or 'Step away'.\n"
      + "EXPECT: Face = a battle vs a MIRROR of your current party (same species,\n"
      + "levels, abilities, forms, movesets - held items are NOT copied). WIN for 2\n"
      + "Rogue picks. Step away = nothing, no cost. (Bring a real 2-3 mon team to see\n"
      + "the mirror; the enemy side should match your roster.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.LAKE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_STILL_WATERS,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.IRON_HEAD],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.YAWN] }),
      ];
    },
  },
  {
    label: "ER Mushroom Circle (#439)",
    description:
      "#439 Grass one-shot GAMBLE. Forces ER_MUSHROOM_CIRCLE (wave-only override,\n"
      + "matching the proven Booth scenario - the forced type does not depend on the\n"
      + "backdrop biome).\n"
      + "DO: 'Taste a mushroom' (a single 50/50 roll, no loop, no battle) or 'Leave the\n"
      + "ring be' for nothing.\n"
      + "EXPECT: WINDFALL = +3 Candy to each party member's species (check candy on the\n"
      + "starter screen) with a notification; or CURSE-LITE = a small money nip. Leave\n"
      + "= no cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_MONEY_OVERRIDE: 20000,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_MUSHROOM_CIRCLE,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "ER Town Raffle (#439)",
    description:
      "#439 Town RELIC gamble. Forces ER_TOWN_RAFFLE in the TOWN biome (you start\n"
      + "with money for the fee).\n"
      + "DO: 'Buy a ticket' (a small fee, Super-Potion sized) for a seeded draw, or\n"
      + "'Decline' for no cost.\n"
      + "EXPECT: a tiered reward shop - JACKPOT (~10%) = a Formation relic (Quartermaster\n"
      + "/ Lookout / Anchor / Twin Link); MID = pick 1 of 3 Great/Ultra; CONSOLATION = 2\n"
      + "Poke Balls. Always pays something. Buy repeatedly to see the jackpot.\n"
      + "#616: the JACKPOT must actually GRANT a relic - before the fix the relic list was\n"
      + "captured before the relic registry loaded, so a jackpot win came up with an EMPTY\n"
      + "reward row (paid the fee, got nothing). Buy until the 'grand prize' bell rings and\n"
      + "confirm a Formation relic is actually offered to take.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_MONEY_OVERRIDE: 50000,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.TOWN,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_TOWN_RAFFLE,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.TACKLE] }),
        makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "World Tournament - ACE (vanilla) (#439)",
    description:
      "#439 Colosseum - dynamic 15-round press-your-luck gauntlet, ACE mode.\n"
      + "DO: on wave 12 the Colosseum spawns. Enter, win, then CONTINUE / CASH OUT.\n"
      + "EXPECT (Ace = PURE VANILLA): challengers are rolled from VANILLA pools -\n"
      + "rounds 1-4 normal trainers, 5-8 GHOSTS (real player teams, shown by the\n"
      + "uploader's name; may be sparse so some fall back to gym trainers), 9-10\n"
      + "bosses (Elite Four), 11-12 gym leaders, 13-14 strong ghosts, 15 a Champion.\n"
      + "The standings board reveals only cleared + next challengers (portrait +\n"
      + "name); upcoming ones are SILHOUETTES tagged Ghost/Boss/Gym/Champion. NO ER\n"
      + "custom mons (pure vanilla). Grade D..EX; CASH OUT = money + grade-locked shop.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("ace");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.COLOSSEUM,
      });
      return colosseumTestParty();
    },
  },
  {
    label: "World Tournament - ELITE (#439)",
    description:
      "#439 Colosseum - dynamic gauntlet, ELITE mode (full ER).\n"
      + "DO: enter on wave 12, fight through, watch the escalation.\n"
      + "EXPECT: normal/boss/gym/champion rounds field REAL ER 'insane'-tier teams\n"
      + "(not weak vanilla mons), ghosts are real Elite player teams (uploader names),\n"
      + "round 14 is the 'deadliest' ghost when the kill-pool has one. Teams fight at\n"
      + "FULL power (BST cap bypassed) re-levelled to your strongest mon. Silhouette\n"
      + "board reveals only cleared + next. Champion (round 15) = a Champion sprite.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("elite");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 110,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.COLOSSEUM,
      });
      return colosseumTestParty();
    },
  },
  {
    label: "World Tournament - HELL (#439)",
    description:
      "#439 Colosseum - dynamic gauntlet, HELL mode (hardest pools).\n"
      + "DO: enter on wave 12, push as deep as you can.\n"
      + "EXPECT: ER 'hell'-tier rosters + Hell ghosts, brutal boss/gym/champion teams\n"
      + "at full power re-levelled to your strongest mon; round 14 the deadliest ghost.\n"
      + "Mystery silhouette board; grade climbs D..EX; CASH OUT banks the grade shop.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 130,
        STARTING_WAVE_OVERRIDE: 12,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.COLOSSEUM,
      });
      return colosseumTestParty();
    },
  },
  // ===========================================================================
  // Final boss — Primal Cascoon two-phase fight (Elite)
  // ===========================================================================
  {
    label: "Primal Cascoon: two-phase final boss (Elite)",
    description:
      "Final-boss test. On ELITE the classic finale is a two-phase Cascoon -> Primal\n"
      + "Cascoon fight (like Eternatus -> Eternamax). DO: break the FIRST health bar.\n"
      + "EXPECT: Cascoon TRANSFORMS into Primal Cascoon with a FRESH full health bar and\n"
      + "keeps fighting (Angel's Wrath kit) - it must NOT just drop to 0 / the victory\n"
      + "screen. Open the boss Summary/Abilities: its innate must read PRISMATIC FUR (not\n"
      + "Color Change) and it must actually act bulky from Prismatic Fur's pre-hit resist\n"
      + "swap + damage-halving kit. If phase 2 STILL dies instantly, hit Send Logs - that capture\n"
      + "pins the exact phase ordering so the death can be fixed.\n"
      + "ALSO check (either phase): open the Ball menu and try to throw a ball - even a\n"
      + "MASTER BALL must be REFUSED ('can't be caught'). The Primal Cascoon final boss is\n"
      + "NEVER catchable (reported: the Black Shiny Primal Cascoon could be Master-balled).",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("elite");
      setOverrides({
        STARTING_WAVE_OVERRIDE: 200,
        STARTING_LEVEL_OVERRIDE: 100,
      });
      return [
        ...colosseumTestParty(),
        makeStarter(SpeciesId.GHOLDENGO, {
          moveset: [MoveId.MAKE_IT_RAIN, MoveId.SHADOW_BALL, MoveId.THUNDERBOLT, MoveId.NASTY_PLOT],
        }),
        makeStarter(SpeciesId.DRAGONITE, {
          moveset: [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.EXTREME_SPEED, MoveId.ROOST],
        }),
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.STONE_EDGE, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Final boss — Primal Cascoon (Hell) with a REAL winning mono-Fire team
  // ===========================================================================
  {
    label: "Primal Cascoon (Hell): a real winning Fire team",
    description:
      "The Hell classic finale opens straight on the Primal Cascoon - a black-shiny\n"
      + "two-phase boss (Angel's Wrath kit + Prismatic Fur). This party is a REAL mono-Fire\n"
      + "team taken verbatim from an actual Hell VICTORY in the ghost pool; Fire is super\n"
      + "effective on the Bug-based boss, which is how it won.\n"
      + "DO: fight the Primal Cascoon and clear it. Open with a Fire STAB (Pyro Ball / Heat\n"
      + "Wave / Fiery Dance), set up on a safe turn (Swords Dance / Nasty Plot / Calm Mind),\n"
      + "and keep the pressure through BOTH health bars.\n"
      + "EXPECT: the team can win. NOTES: the original run's held items are NOT carried here\n"
      + "(play the matchups), each mon here has 4 moves (the winner's 5th came from the in-run\n"
      + "move expander), and the boss can NEVER be caught (even a Master Ball is refused).",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_WAVE_OVERRIDE: 200,
        STARTING_LEVEL_OVERRIDE: 200,
      });
      // Mono-Fire roster from a real Hell victory (D1 runs, outcome=victory difficulty=hell).
      // Species / form / ability / level are verbatim; movesets are the winner's 4 best (its
      // 5th slot came from the move expander item, which a starter can't carry). One swap:
      // Volcanion's stored G-Max Vine Lash -> its Steam Eruption STAB, which functions as a
      // normal move here.
      return [
        makeStarter(SpeciesId.CINDERACE, {
          formIndex: 2,
          abilityIndex: 0,
          moveset: [MoveId.PYRO_BALL, MoveId.SWORDS_DANCE, MoveId.TRIPLE_KICK, MoveId.TRIPLE_AXEL],
        }),
        makeStarter(SpeciesId.DELPHOX, {
          formIndex: 1,
          abilityIndex: 1,
          moveset: [MoveId.FIERY_DANCE, MoveId.EXPANDING_FORCE, MoveId.THUNDERBOLT, MoveId.SPARKLY_SWIRL],
        }),
        makeStarter(SpeciesId.VOLCANION, {
          abilityIndex: 1,
          moveset: [erMove(ErMoveId.SCORCHED_EARTH), MoveId.STEAM_ERUPTION, MoveId.STRANGE_STEAM, MoveId.CALM_MIND],
        }),
        makeStarter(SpeciesId.HOUNDOOM, {
          abilityIndex: 0,
          moveset: [MoveId.NASTY_PLOT, MoveId.FIRE_FANG, erMove(ErMoveId.RIP_AND_TEAR), MoveId.THUNDER_FANG],
        }),
        makeStarter(SpeciesId.NINETALES, {
          abilityIndex: 1,
          moveset: [MoveId.HEAT_WAVE, MoveId.DAZZLING_GLEAM, MoveId.SYNCHRONOISE, MoveId.SIMPLE_BEAM],
        }),
        makeStarter(SpeciesId.INFERNAPE, {
          formIndex: 1,
          abilityIndex: 0,
          moveset: [MoveId.FIRE_PUNCH, erMove(ErMoveId.ONE_INCH_PUNCH), MoveId.ICE_PUNCH, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // FIXES — this session
  // ===========================================================================
  {
    label: "Eerie Fog: boost decay",
    description:
      "#328 Eerie Fog — stat decay.\n"
      + "In fog, non-Ghost/Psychic mons lose 1 stage off EACH positive stat per turn.\n"
      + "DO: keep using Splash.  EXPECT: Mightyena's +ATK/+SpA/+SpD tick down to 0 over\n"
      + "a few turns; the -1 DEF is left alone. (Open Summary to watch the stages.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        WEATHER_OVERRIDE: WeatherType.FOG,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.MIGHTYENA, { moveset: [MoveId.SPLASH] })];
    },
    onBattleStart: () =>
      boostPlayer([
        [Stat.ATK, 4],
        [Stat.SPATK, 4],
        [Stat.SPD, 3],
        [Stat.DEF, -1],
      ]),
  },
  {
    label: "Eerie Fog: Ghost keeps",
    description:
      "#328 Eerie Fog — Ghost/Psychic are immune to the decay.\n"
      + "DO: keep using Splash in fog.  EXPECT: Gengar (Ghost) KEEPS all its +4 boosts\n"
      + "every turn — they do NOT tick down. (Contrast with the Mightyena scenario.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        WEATHER_OVERRIDE: WeatherType.FOG,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GENGAR, { moveset: [MoveId.SPLASH] })];
    },
    onBattleStart: () => boostPlayer(allStages(4)),
  },
  {
    label: "Eerie Fog: Ominous Wind",
    description:
      "#328 Eerie Fog - Ominous Wind deals 2x in fog (base 55 -> 110).\n"
      + "DO: use Ominous Wind on Wailord (bulky, survives). EXPECT: a big chunk,\n"
      + "roughly double what it would do without fog.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        WEATHER_OVERRIDE: WeatherType.FOG,
        MOVESET_OVERRIDE: [MoveId.OMINOUS_WIND, MoveId.SHADOW_BALL, MoveId.CONFUSE_RAY, MoveId.PROTECT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WAILORD,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GASTLY, {
          moveset: [MoveId.OMINOUS_WIND, MoveId.SHADOW_BALL, MoveId.CONFUSE_RAY, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Horn Drill: regular hit",
    description:
      "ER dex move fix - Horn Drill is a 95 BP / 100 accuracy regular attack, not an OHKO.\n"
      + "DO: use Horn Drill. EXPECT: Wobbuffet takes normal damage even though Rhydon is\n"
      + "lower level. It should NOT say 'But it failed!' and should NOT one-shot.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WOBBUFFET,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.RHYDON, {
          moveset: [MoveId.HORN_DRILL, MoveId.ROCK_SLIDE, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Dragon Breath burns",
    description:
      "ER dex move fix - Dragon Breath is 20 BP with a guaranteed burn.\n"
      + "DO: use Dragon Breath. EXPECT: Wobbuffet is burned after the hit, not paralyzed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WOBBUFFET,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.DRAGON_BREATH, MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Confusion: guaranteed",
    description:
      "ER dex move fix - Confusion's secondary effect is guaranteed.\n"
      + "DO: use Confusion. EXPECT: Wobbuffet becomes confused every time.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WOBBUFFET,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ABRA, {
          moveset: [MoveId.CONFUSION, MoveId.PSYBEAM, MoveId.LIGHT_SCREEN, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Ominous Wind spread",
    description:
      "ER dex move fix - Ominous Wind targets both opposing Pokemon in doubles.\n"
      + "DO: have Gengar use Ominous Wind and Snorlax use Splash. EXPECT: both\n"
      + "enemy Wobbuffet lose HP from the same Ominous Wind.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WOBBUFFET,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.OMINOUS_WIND, MoveId.SHADOW_BALL, MoveId.CONFUSE_RAY, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Triple Axel ramp",
    description:
      "#313 Triple Axel — 3 strikes with ramping power.\n"
      + "DO: use Triple Axel on Blissey (survives).  EXPECT: it hits 3 TIMES, each\n"
      + "stronger than the last (20 → 40 → 60 power).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.TRIPLE_AXEL],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SNEASEL, { moveset: [MoveId.TRIPLE_AXEL] })];
    },
  },
  {
    label: "Money streak ribbon",
    description:
      "#348 Money streak — +1% money per mon per 3 faint-free waves (cap 10%).\n"
      + "This scenario pre-charges your two mons to MAX streak.\n"
      + "DO: open each mon's SUMMARY.  EXPECT: a small gold ribbon next to the\n"
      + "gender symbol on the name bar reading P+10%. Win the battle: the money\n"
      + "reward is ~20% higher than normal. Let a mon faint and win again: its\n"
      + "ribbon disappears (streak reset), the other keeps its bonus.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.FLASH_CANNON, MoveId.SWORDS_DANCE, MoveId.EXTREME_SPEED],
        }),
      ];
    },
    onBattleStart: () => {
      // Pre-charge the party to max streak so the ribbon + payout are testable.
      for (let i = 0; i < 30; i++) {
        advanceErMoneyStreaks();
      }
    },
  },
  {
    label: "Struggle Bug + Antique",
    description:
      "#367 Struggle Bug (ER) + Antique innates.\n"
      + "Your Scyther starts at ~30% HP. DO: use Struggle Bug on the enemy\n"
      + "Sinistea (ANTIQUE form).\n"
      + "EXPECT: Struggle Bug shows 80 BP, CRITS EVERY TIME while you're below\n"
      + "half HP, and does NOT drop SpAtk. Open Battle Info (C) on the enemy:\n"
      + "the Antique Sinistea must show its INNATES (was: none).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.STRUGGLE_BUG, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SINISTEA,
        ENEMY_FORM_OVERRIDES: { [SpeciesId.SINISTEA]: 1 },
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SCYTHER, { moveset: [MoveId.STRUGGLE_BUG, MoveId.SPLASH] })];
    },
    onBattleStart: () => {
      const p = globalScene.getPlayerPokemon();
      if (p) {
        p.hp = Math.max(1, Math.floor(p.getMaxHp() * 0.3));
        p.updateInfo();
      }
    },
  },
  {
    label: "Outburst hits the field",
    description:
      "#366 Outburst (and 26 other customs) used to hit ONE mon.\n"
      + "DOUBLE battle. DO: have Gengar use Outburst.\n"
      + "EXPECT: it damages BOTH enemy mons AND your ally, then Gengar faints.\n"
      + "Also: Bleakwind Storm hits both foes AND sets Tailwind on your side\n"
      + "(check the Field panel in Battle Info).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        MOVESET_OVERRIDE: [erMove(ErMoveId.OUTBURST), MoveId.BLEAKWIND_STORM, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GENGAR, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Oricorio Pom-Pom innate",
    description:
      "#361 Oricorio styles carry their OWN ability kits.\n"
      + "DO: open Battle Info (C) on the enemy Pom-Pom Oricorio and check its\n"
      + "abilities; or hit it with Thunderbolt.\n"
      + "EXPECT: it has LIGHTNING ROD (Electric absorbed/redirected), NOT Baile's\n"
      + "Flash Fire. Also: R cycles the side panel — page 2 description box sits\n"
      + "ABOVE the move list (no text overlap, has its own window), page 3 DMG\n"
      + "CALC counts ALL hits of multi-hit moves (Triple Axel reads ~6x one hit).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.THUNDERBOLT, MoveId.TRIPLE_AXEL, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ORICORIO,
        ENEMY_FORM_OVERRIDES: { [SpeciesId.ORICORIO]: 1 },
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.PIKACHU, { moveset: [MoveId.THUNDERBOLT, MoveId.TRIPLE_AXEL, MoveId.SPLASH] })];
    },
  },
  {
    label: "Hell final rival (Mega Ray)",
    description:
      "#340 Hell final rival battle (wave 195).\n"
      + "DO: beat/skip through the rival fight that starts immediately.\n"
      + "EXPECT: the rival fields a FULLY-EVOLVED late-game team (Vikavolt/\n"
      + "Swellow/Starmie/Tsareena/Mimikyu/Blaziken-line — never Smeargle, contest\n"
      + "Pikachus or unevolved mons) and the LAST mon is MEGA RAYQUAZA.\n"
      + "Before the fix the finale got a leftover early/mid team and no ace.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 95,
        STARTING_WAVE_OVERRIDE: 195,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.METAGROSS, {
          moveset: [MoveId.METEOR_MASH, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH, MoveId.EARTHQUAKE],
        }),
        makeStarter(SpeciesId.MILOTIC, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.RECOVER, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Hell: enemy = your top level",
    description:
      "ER HELL-ONLY level scaling, eased in by wave. Enemies spawn relative to the\n"
      + "HIGHEST level in YOUR party (benching a low mon can't soften a wave):\n"
      + "  waves 1-9: top - 3,  10-19: top - 2,  20-39: top - 1,  40+: top (parity).\n"
      + "Your party here is all LEVEL 50 at wave 5.\n"
      + "EXPECT: the wild enemy spawns at LEVEL 47 (top 50 minus 3 at this wave),\n"
      + "NOT the usual ~level 5 wave-scaled mon. By wave 10 it's 48, wave 20 it's 49,\n"
      + "and from wave 40 it matches your top level exactly.\n"
      + "OTHER MODES UNAFFECTED: the same setup on Ace/Elite/Youngster keeps the\n"
      + "normal low wave-scaled enemy level.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.BULBASAUR, {
          moveset: [MoveId.GIGA_DRAIN, MoveId.SLUDGE_BOMB, MoveId.SYNTHESIS, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Hell AI: no immune move into Flying",
    description:
      "Experimental (Foul-Play) AI must NOT pick a move that does NOTHING.\n"
      + "Reported: a Hell Rapidash kept using HIGH HORSEPOWER (Ground) into a\n"
      + "Flying target (0x immune) instead of its super-effective Wild Charge.\n"
      + "Cause: a no-effect move was left at the fixed -20 sentinel, which\n"
      + "out-sorted the real moves' (more-negative) depth-1 scores in a losing\n"
      + "position. DO: this is a HELL BOSS Rapidash (confirm the console logs\n"
      + "'ER AI: experimental brain'); let it attack your Togetic (Fairy/Flying)\n"
      + "for a few turns. EXPECT: it uses WILD CHARGE (2x on Flying), Blaze Kick,\n"
      + "or High Jump Kick - NEVER High Horsepower (check 'Chosen Move' in the\n"
      + "console). Before the fix 'Chosen Move: High Horsepower' vs the Flying mon.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 10,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RAPIDASH,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BLAZE_KICK, MoveId.WILD_CHARGE, MoveId.HIGH_HORSEPOWER, MoveId.HIGH_JUMP_KICK],
      });
      return [
        makeStarter(SpeciesId.TOGETIC, {
          moveset: [MoveId.DAZZLING_GLEAM, MoveId.AIR_SLASH, MoveId.ANCIENT_POWER, MoveId.ROOST],
        }),
      ];
    },
  },
  {
    label: "Fury Cutter/Echoed Voice x3",
    description:
      "#360 Fury Cutter + Echoed Voice — Triple Kick's effect.\n"
      + "Fury Cutter: 20 BP / 90% / 10 PP. Echoed Voice: 20 BP / 90% / 15 PP.\n"
      + "DO: check both movecards (R cycles the panel), then use each on Blissey.\n"
      + "EXPECT: each hits 3 TIMES with rising power (20 → 40 → 60), like Triple\n"
      + "Kick/Axel. Before the fix both were single-hit vanilla repeat-use ramps.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.FURY_CUTTER, MoveId.ECHOED_VOICE, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SCYTHER, { moveset: [MoveId.FURY_CUTTER, MoveId.ECHOED_VOICE, MoveId.SPLASH] })];
    },
  },
  {
    label: "First Impression flinches",
    description:
      "First Impression - in ER it shares the Fake Out effect (#623, effect\n"
      + "139): a GUARANTEED flinch, usable only on the first turn. Report: it\n"
      + "wasn't flinching (vanilla First Impression never did).\n"
      + "DO: turn 1, use First Impression on the slow Snorlax.\n"
      + "EXPECT: Golisopod moves first (+3 priority), and Snorlax FLINCHES -\n"
      + "it cannot use Tackle this turn ('flinched and couldn't move'). Turn 2,\n"
      + "First Impression FAILS (first-turn only), confirming the gate still works.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.FIRST_IMPRESSION, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [makeStarter(SpeciesId.GOLISOPOD, { moveset: [MoveId.FIRST_IMPRESSION, MoveId.SPLASH] })];
    },
  },
  {
    label: "Biome identity: Power Plant terrain",
    description:
      "#439 §3 biome battle identity (GROUP A). Power Plant has Electric Terrain\n"
      + "ALWAYS on (vanilla biomes never set terrain). DO: start the battle.\n"
      + "EXPECT: Electric Terrain is active from turn 1 (the field glows; grounded\n"
      + "mons can't be put to sleep; Electric moves are boosted). It persists for\n"
      + "the whole biome, not 5 turns. Use the builder to also check GRASS/JUNGLE\n"
      + "(Grassy Terrain) and SPACE (Psychic Terrain).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.POWER_PLANT,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.PIKACHU, { moveset: [MoveId.SPLASH, MoveId.THUNDERBOLT] })];
    },
  },
  {
    label: "Biome identity: Desert sandstorm",
    description:
      "#439 §3 biome battle identity (GROUP A). Desert/Badlands have sandstorm as\n"
      + "a BASELINE (guaranteed on entry, not just a likely pool roll). DO: start.\n"
      + "EXPECT: a sandstorm is whipping from turn 1 and stays up the whole biome.\n"
      + "Builder check the other baselines too: ICE_CAVE/SNOWY_FOREST = snow,\n"
      + "GRAVEYARD = fog, BEACH = harsh-less sun.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.DESERT,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SANDILE,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GARCHOMP, { moveset: [MoveId.SPLASH, MoveId.EARTHQUAKE] })];
    },
  },
  {
    label: "Biome: Sea non-swimmer -1 Spd",
    description:
      "#439 §3 Group C. SEA saps non-swimmers (no Water/Flying type, no Levitate)\n"
      + "of 1 Speed stage WHEN THEY ENTER. DO: just start the battle.\n"
      + "EXPECT: turn 0, 'SNORLAX's Speed fell!' (Snorlax is a non-swimmer). A\n"
      + "Water/Flying mon or a Levitate mon would be exempt. Builder check SPACE\n"
      + "(STARTING_BIOME_OVERRIDE) too: there ALL grounded mons get -1 Spd on entry\n"
      + "AND -10% accuracy, with Psychic Terrain up.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.SEA,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH, MoveId.BODY_SLAM] })];
    },
  },
  {
    label: "Biome: Swamp bog chip",
    description:
      "#439 §3 Group E. SWAMP attrition: grounded non-Poison/Steel mons lose 1/16\n"
      + "max HP at the END of every turn (Magic Guard exempts). DO: use Splash and\n"
      + "watch the turn end. EXPECT: 'SNORLAX is sapped by the bog!' and ~6% HP lost\n"
      + "each turn. A Poison, Steel, or Flying/Levitate (ungrounded) mon takes NO\n"
      + "chip - swap the starter to test the immunity.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.SWAMP,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH, MoveId.BODY_SLAM] })];
    },
  },
  {
    label: "Biome: Plains free run",
    description:
      "#439 §3 Group F. PLAINS open fields: fleeing ALWAYS succeeds. DO: pick Run\n"
      + "(Flee) on turn 1, repeatedly if you like. EXPECT: you escape every time,\n"
      + "even against a faster wild mon (vanilla flee can fail on a speed deficit).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 5,
        STARTING_BIOME_OVERRIDE: BiomeId.PLAINS,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.NINJASK, // very fast - vanilla flee would often fail
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SLOWPOKE, { moveset: [MoveId.SPLASH, MoveId.TACKLE] })];
    },
  },
  {
    label: "Biome: Fairy Cave - no infatuation",
    description:
      "#439 §3 Group F. FAIRY CAVE blessing: your fielded mons CANNOT be infatuated,\n"
      + "and sleep wears off a turn faster. DO: let the enemy use Attract (it leads\n"
      + "with it). EXPECT: Attract FAILS - no '...fell in love!' / infatuation; your\n"
      + "mon acts freely every turn. (Outside Fairy Cave the same Attract would\n"
      + "infatuate.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_BIOME_OVERRIDE: BiomeId.FAIRY_CAVE,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GARDEVOIR,
        ENEMY_MOVESET_OVERRIDE: [MoveId.ATTRACT],
      });
      return [makeStarter(SpeciesId.GALLADE, { moveset: [MoveId.SPLASH, MoveId.PSYCHO_CUT] })];
    },
  },
  {
    label: "Biome: Mountain Flying+20%/-acc",
    description:
      "#439 §3 Group B. MOUNTAIN wind: Flying-type moves deal +20% (both sides) and\n"
      + "ALL moves take -5% accuracy. DO: open the move panel (R cycles to the Damage\n"
      + "Calc) and compare Air Slash here vs in a neutral biome - it should read ~20%\n"
      + "higher. EXPECT also slightly more misses across the board. Builder check\n"
      + "VOLCANO: Fire moves +20% AND a ~10% burn risk on grounded non-Fire entry;\n"
      + "CAVE: -10% accuracy unless a Flash/Illuminate ability is on the field.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_BIOME_OVERRIDE: BiomeId.MOUNTAIN,
        MOVESET_OVERRIDE: [MoveId.AIR_SLASH, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.STARAPTOR, { moveset: [MoveId.AIR_SLASH, MoveId.SPLASH] })];
    },
  },
  {
    label: "Biome: Abyss Dark +1 crit",
    description:
      "#439 §3 Group F. ABYSS: Dark-type attackers get +1 crit stage. DO: spam a\n"
      + "Dark move (Night Slash) and watch the crit rate - it should crit far more\n"
      + "often than the base 1/24 (one stage = ~1/8). Non-Dark moves are unaffected.\n"
      + "Statistical - take several swings to see it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_BIOME_OVERRIDE: BiomeId.ABYSS,
        MOVESET_OVERRIDE: [MoveId.NIGHT_SLASH, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.WEAVILE, { moveset: [MoveId.NIGHT_SLASH, MoveId.SPLASH] })];
    },
  },
  {
    label: "Biome: Jungle wild +2 levels",
    description:
      "#439 §3 encounter shape. JUNGLE overgrowth: WILD mons spawn +2 levels above\n"
      + "the normal wave level. DO: start (a wild battle), open the enemy's summary\n"
      + "and read its level - it should be ~2 higher than a same-wave wild elsewhere.\n"
      + "Trainer mons are unaffected (their levels come from the party template).\n"
      + "Builder check GRASS/TALL_GRASS: those DOUBLE the wild double-battle rate -\n"
      + "re-enter several wild waves and you'll see doubles roughly twice as often.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 20,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.JUNGLE,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GARCHOMP, { moveset: [MoveId.SPLASH, MoveId.EARTHQUAKE] })];
    },
  },
  {
    label: "Biome: Forest ambush (free turn)",
    description:
      "#439 §3 encounter shape. FOREST/SNOWY FOREST: ~20% of WILD encounters, the\n"
      + "foe gets a FREE turn-1 move before you act - UNLESS your lead outspeeds it.\n"
      + "This lead is a slow Munchlax (the fast wild Electrode outspeeds it), so the\n"
      + "ambush can fire. DO: start a few wild Forest waves. EXPECT: ~1 in 5, the\n"
      + "Electrode attacks ONCE for free before your first command. Swap the lead to\n"
      + "something faster than the foe and the ambush should never trigger.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_BIOME_OVERRIDE: BiomeId.FOREST,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ELECTRODE,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [makeStarter(SpeciesId.MUNCHLAX, { moveset: [MoveId.SPLASH, MoveId.BODY_SLAM] })];
    },
  },
  {
    label: "Biome: Island exotic spawns",
    description:
      "#439 §3 encounter shape. ISLAND (Elite/Hell only): wild spawns are biased\n"
      + "toward REGIONAL variants (Alolan/Galarian/etc) AND ER REDUX forms - 'exotic\n"
      + "imports'. DO: on Elite/Hell, walk several wild Island waves and check the\n"
      + "foes. EXPECT: noticeably more regionals + Redux-form mons than a normal\n"
      + "biome. On ACE/YOUNGSTER it stays PURE vanilla (no Redux, normal pool) -\n"
      + "switch difficulty to confirm the gate.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_BIOME_OVERRIDE: BiomeId.ISLAND,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GARCHOMP, { moveset: [MoveId.SPLASH, MoveId.EARTHQUAKE] })];
    },
  },
  {
    label: "Berry Smash eats a berry",
    description:
      "#342/#398 Berry Smash — the user must EAT one of its held berries.\n"
      + "Snorlax holds a Sitrus AND a Lum berry (two berries). DO: use Berry Smash\n"
      + "on the enemy.  EXPECT: it deals damage AND the USER consumes ONE berry\n"
      + "(random of the two) — e.g. Sitrus heals SNORLAX, not Blissey.\n"
      + "ALSO (#398): the berry's effect must NEVER apply to the TARGET — a\n"
      + "report had the defender eating the attacker's berry like a reverse\n"
      + "Pluck. Watch who gets the heal message.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [erMove(ErMoveId.BERRY_SMASH), MoveId.SPLASH],
        STARTING_HELD_ITEMS_OVERRIDE: [
          { name: "BERRY", type: BerryType.SITRUS, count: 1 },
          { name: "BERRY", type: BerryType.LUM, count: 1 },
        ],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.SNORLAX, { moveset: [erMove(ErMoveId.BERRY_SMASH), MoveId.SPLASH] })];
    },
  },
  {
    label: "Fight panel: R cycles 3 pages",
    description:
      "#356 Move info while choosing moves.\n"
      + "DO: open FIGHT, highlight a move, press R (mobile: on-screen R) repeatedly.\n"
      + "EXPECT: page 1 = stats panel; page 2 = a WIDE description box above the\n"
      + "move list (long text auto-scrolls; stats stay in the side panel); page 3 =\n"
      + "DMG CALC in the side panel, fully inside the panel (no overflow); then back\n"
      + "to page 1. Works for every move incl. the 5th rogue-slot move.\n"
      + "MULTI-HIT: page 3 DMG CALC shows min-max % of foe HP + a 'crit ~%' line;\n"
      + "multi-hit moves (Bullet Seed, Double Kick, a Multi-Headed mon's move) now\n"
      + "scale the % by ALL hits (with a '2-5 hits' / 'N heads' note). The Battle\n"
      + "Info Damage Calculator page likewise shows the full multi-hit total now.\n"
      + "ALSO (#377): on the stats page a small static 'R ⇄' hint sits at the\n"
      + "panel edge so the cycling is discoverable. The hint must appear ONLY\n"
      + "there - NOT on the title screen, starter select, command menu or any\n"
      + "other screen (it used to leak everywhere until the first fight).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.FIRE_BLAST, MoveId.STONE_EDGE],
        }),
      ];
    },
  },
  {
    label: "Dragon Rage = 80 BP",
    description:
      "#336 Dragon Rage info — must DISPLAY power 80 (not 1).\n"
      + "ER's Dragon Rage is a normal 80-BP Dragon move that hits Fairy neutrally.\n"
      + "DO: open the move detail (fight menu) / Battle Info Moves panel and read\n"
      + "Dragon Rage's power; then use it on the Clefable.  EXPECT: power shows 80\n"
      + "(was 1), and it HITS the Fairy for a normal 80-BP chunk.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.DRAGON_RAGE, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CLEFABLE,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.DRATINI, { moveset: [MoveId.DRAGON_RAGE, MoveId.SPLASH] })];
    },
  },

  // ===========================================================================
  // FIXES — already merged on the branch
  // ===========================================================================
  {
    label: "Normalize vs resist",
    description:
      "#329 Normalize ignores RESISTANCES.\n"
      + "Normalize makes Tackle a Normal move. Steelix (Steel/Ground) normally resists\n"
      + "Normal.  DO: use Tackle.  EXPECT: NEUTRAL damage — the resistance is ignored\n"
      + "(no 'not very effective').",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.NORMALIZE,
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.STEELIX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.PORYGON, { moveset: [MoveId.TACKLE] })];
    },
  },
  {
    label: "Normalize vs immune",
    description:
      "#329 control — Normalize ignores resistances but NOT immunities.\n"
      + "DO: use Tackle (now Normal) on Gengar (Ghost).  EXPECT: 0 damage / 'doesn't\n"
      + "affect' — Ghost's immunity to Normal still applies.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.NORMALIZE,
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.PORYGON, { moveset: [MoveId.TACKLE] })];
    },
  },
  {
    label: "Fire Aspect burn",
    description:
      "#334 Fire Aspect — all the holder's attacks inflict burn.\n"
      + "DO: hit Snorlax with Tackle (a NON-Fire move).  EXPECT: Snorlax is BURNED\n"
      + "afterwards (burn status + chip damage each turn).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FIRE_ASPECT),
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.CHARIZARD, { moveset: [MoveId.TACKLE] })];
    },
  },
  {
    label: "Gifted Mind: Dark/Ghost/Bug immunity",
    description:
      "#332/#333 Gifted Mind (2.65 dex) - grants IMMUNITY to Dark, Ghost and Bug-type\n"
      + "moves (and makes the holder's own status moves never miss). Alakazam (pure\n"
      + "Psychic) is normally weak (2x) to all three. DO: use Splash and let Tyranitar\n"
      + "hit you with Crunch (Dark), Shadow Ball (Ghost) and X-Scissor (Bug).  EXPECT:\n"
      + "every one shows 'it doesn't affect' and deals 0 damage (NOT the 2x it took\n"
      + "before). The earlier fix only neutralized to 1x; it is full immunity now.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.GIFTED_MIND),
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.TYRANITAR,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.CRUNCH, MoveId.SHADOW_BALL, MoveId.X_SCISSOR],
      });
      return [makeStarter(SpeciesId.ALAKAZAM, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "Telekinetic vs Magic Bounce",
    description:
      "Telekinetic casts Telekinesis on the OPPONENT on switch-in. Bug: the cast was\n"
      + "reflectable, so a Magic Bounce foe bounced it back and the HOLDER got hurled\n"
      + "into the air instead. DO: send out your Telekinetic Gardevoir against a Magic\n"
      + "Bounce Espeon, then Splash.  EXPECT: 'Foe Espeon was hurled into the air!' on\n"
      + "entry (the FOE is telekinesed, NOT your Gardevoir) - no Magic Bounce reflection.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.TELEKINETIC),
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ESPEON,
        ENEMY_ABILITY_OVERRIDE: AbilityId.MAGIC_BOUNCE,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.GARDEVOIR, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "Gear Up: ER self-buff",
    description:
      "Gear Up was still the vanilla Plus/Minus team buff (did nothing useful on a normal\n"
      + "mon). ER dex: a SELF buff - raises SpAtk and SHARPLY raises Speed. DO: use Gear Up.\n"
      + "EXPECT: the user's Sp. Atk rises 1 stage and its Speed rises 2 stages (no Plus/Minus\n"
      + "needed, no ally involvement).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.GEAR_UP, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.KLINKLANG, { moveset: [MoveId.GEAR_UP, MoveId.SPLASH, MoveId.PROTECT, MoveId.REST] }),
      ];
    },
  },
  {
    label: "Decorate is blocked by Protect",
    description:
      "ER Decorate became a damaging foe-move but kept the vanilla ally-buff's ignores-Protect\n"
      + "flag, so it punched through Protect (reported: hit a protected Sobble in doubles). DO:\n"
      + "use Decorate on the Sobble the turn it uses Protect.  EXPECT: 'Sobble protected itself!'\n"
      + "and Decorate deals 0 - it does NOT bypass Protect anymore.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.DECORATE, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SOBBLE,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.SCATTERBUG, {
          moveset: [MoveId.DECORATE, MoveId.SPLASH, MoveId.STRING_SHOT, MoveId.TACKLE],
        }),
      ];
    },
  },
  {
    label: "Mega Tyranitar Evaporate: water immunity",
    description:
      "Mega Tyranitar's Evaporate ('takes no damage and sets Mist if hit by water') did\n"
      + "nothing - the immunity attr was never collected by the damage engine. DO: let the\n"
      + "enemy hit your Evaporate Tyranitar with a Water move (Water Gun).  EXPECT: 'It doesn't\n"
      + "affect Tyranitar', 0 damage, and 'Your team became shrouded in mist!' (Mist set).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.EVAPORATE),
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.WATER_GUN],
      });
      return [
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.SPLASH, MoveId.CRUNCH, MoveId.ROCK_SLIDE, MoveId.EARTHQUAKE],
        }),
      ];
    },
  },
  {
    label: "Mystical Rock extends Drought (ability weather)",
    description:
      "Mystical Rock (+2 turns/stack to weather) didn't extend ABILITY-set weather - Drought\n"
      + "was always a flat 8 turns. DO: this Tyranitar has Drought + holds 1 Mystical Rock; send\n"
      + "it out and read the weather counter (R -> turn info, or just count).  EXPECT: harsh\n"
      + "sunlight lasts 10 turns (ER base 8 + 2), not 8. Move-set weather already worked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.DROUGHT,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "MYSTICAL_ROCK", count: 1 }],
      });
      return [
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.SPLASH, MoveId.CRUNCH, MoveId.ROCK_SLIDE, MoveId.EARTHQUAKE],
        }),
      ];
    },
  },
  {
    label: "Razor Wind: +1 priority in Tailwind",
    description:
      "ER dex: Razor Wind gets +1 priority while Tailwind is active (it was unimplemented).\n"
      + "DO: turn 1 use Tailwind; turn 2 use Razor Wind against the slower-looking foe.  EXPECT:\n"
      + "with Tailwind up, Razor Wind moves BEFORE a normal-priority foe move it would otherwise\n"
      + "lose the speed tie/race to. (Razor Wind also no longer charges - it hits immediately.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.TAILWIND, MoveId.RAZOR_WIND],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.PIDGEOT, {
          moveset: [MoveId.TAILWIND, MoveId.RAZOR_WIND, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Mega/Primal forms can't evolve",
    description:
      "DATA fix - verify outside a forced battle: a battle-only resting form (Mega / Primal /\n"
      + "Gigantamax) must NEVER evolve. ER added level evos to some lines (Scrafty -> Scrafster,\n"
      + "Scyther -> Scizor/Kleavor, Cascoon -> Dustox) that weren't form-gated, so the MEGA/PRIMAL\n"
      + "form could still evolve. Now getValidEvolutions() returns nothing for a mega/primal/max\n"
      + "form; only the BASE form evolves. Check: a Mega Scrafty at L55+ does NOT offer Scrafster;\n"
      + "a base Scrafty still does. (Unit-tested via getValidEvolutions on a forced Mega form.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 60 });
      return [
        makeStarter(SpeciesId.SCRAFTY, {
          moveset: [MoveId.CRUNCH, MoveId.HIGH_JUMP_KICK, MoveId.DRAGON_DANCE, MoveId.BULK_UP],
        }),
      ];
    },
  },
  {
    label: "(note) Delibirdy takes SE-resist berries as berries",
    description:
      "DATA fix - verify in a Delibird-y mystery encounter (not a battle): ER's super-effective\n"
      + "resist berries (Chople, Shuca, Occa, ...) are a separate item class from vanilla berries,\n"
      + "so Delibirdy refused to take them as a berry (reported: 'SE berries aren't berries').\n"
      + "Now they count: hold an SE-resist berry, pick 'Give Food' -> the berry IS offered and the\n"
      + "reward is a Candy Jar (not a Berry Pouch). They're also excluded from the 'give any other\n"
      + "item' option. (Unit-tested in delibirdy-encounter.test.ts.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1 });
      return [
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.AURA_SPHERE, MoveId.CLOSE_COMBAT, MoveId.EXTREME_SPEED, MoveId.METEOR_MASH],
        }),
      ];
    },
  },
  {
    label: "Mimikyu Apex: Disguise blocks first hit",
    description:
      "Mimikyu Apex's Disguise did NOTHING (the Apex / Rayquaza tiers ship as separate\n"
      + "ER species, not forms, so there was no busted form to break into - the\n"
      + "canBreakForm guard disabled the block). Fix: the busted counterpart is now\n"
      + "injected as a form. DO: use Splash and let Gengar hit your Mimikyu Apex with\n"
      + "Shadow Ball twice. EXPECT: turn 1 the hit is NULLIFIED (Mimikyu keeps almost\n"
      + "all HP, loses only ~1/8 to recoil) and it BUSTS (broken-disguise sprite); turn\n"
      + "2 it takes FULL super-effective damage. Before the fix turn 1 was not blocked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 90,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.DISGUISE,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SHADOW_BALL],
      });
      return [
        makeStarter(erSpecies(ErSpeciesId.MIMIKYU_APEX), {
          moveset: [MoveId.SPLASH, MoveId.SHADOW_SNEAK, MoveId.PLAY_ROUGH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Dynamax Cannon: 2x vs Mega",
    description:
      "#690 Dynamax Cannon - 'Deals 2x damage to Mega foes' (no Dynamax in ER, so the\n"
      + "clause applies to Mega-evolved targets). Vanilla shipped it as a plain 100 BP\n"
      + "Dragon special. DO: use Dynamax Cannon on the Mega Gengar. EXPECT: roughly\n"
      + "DOUBLE the damage (Dragon is neutral on Gengar, so Mega is the only multiplier\n"
      + "- remove the ENEMY_FORM_OVERRIDES in scenarios.ts to see the 1x baseline).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 70,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.DYNAMAX_CANNON, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_FORM_OVERRIDES: { [SpeciesId.GENGAR]: formIndexByKey(SpeciesId.GENGAR, "mega") },
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.LATIOS, {
          moveset: [MoveId.DYNAMAX_CANNON, MoveId.SPLASH, MoveId.PSYCHIC, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Aura Force vs Ghost",
    description:
      "#326 Aura Force (ER Fighting move) is super-effective vs Ghost.\n"
      + "DO: use Aura Force on Gengar.  EXPECT: it HITS (no 'doesn't affect') AND is\n"
      + "super-effective — a big chunk / likely KO.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [erMove(ErMoveId.AURA_FORCE)],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.LUCARIO, { moveset: [erMove(ErMoveId.AURA_FORCE)] })];
    },
  },
  {
    label: "Pressure clears boosts",
    description:
      "#321 Pressure clears the opponent's POSITIVE stat stages on entry.\n"
      + "The enemy Snorlax starts at +6 all.  DO: switch your lead Magikarp OUT for\n"
      + "Machamp (both have Pressure here).  EXPECT: when Machamp ENTERS, Snorlax's\n"
      + "positive stages snap back to 0.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.PRESSURE,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MAGIKARP, { moveset: [MoveId.SPLASH] }),
        makeStarter(SpeciesId.MACHAMP, { moveset: [MoveId.SPLASH] }),
      ];
    },
    onBattleStart: () => boostEnemy(allStages(6)),
  },
  {
    // #325. EXPECT: leveling Kadabra-Redux to 32 evolves it into Alakazam-REDUX
    // (Redux sprite/typing), NOT the normal Alakazam. Was reverting to base form
    // on evolve even though the evolution preview showed the Redux sprite.
    label: "Redux evo keeps form (Kadabra)",
    description:
      "#325 Redux line must KEEP its form on evolution.\n"
      + "You start with a L31 Kadabra-Redux (evolves at 32). DO: win the opening\n"
      + "battle, then take the RARE CANDY from the rewards and use it on Kadabra to\n"
      + "hit L32 and evolve.  EXPECT: it becomes Alakazam-REDUX (Redux sprite +\n"
      + "typing + Redux learnset), NOT the normal Alakazam.\n"
      + "(Rare candy, not combat XP — the dev battle gives little/no XP.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 31,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.PSYCHIC, MoveId.SHADOW_BALL],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 31,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.KADABRA, {
          formIndex: formIndexByKey(SpeciesId.KADABRA, "redux"),
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL],
        }),
      ];
    },
    // Evolve via a guaranteed Rare Candy in the post-battle shop (level 31 → 32),
    // not combat XP.
    shopItems: [modifierTypes.RARE_CANDY],
  },
  {
    label: "Capsule ability drops on evo (#607)",
    description:
      "#607 - this Shelmet's ACTIVE ability is pinned to Damp (as if Ability-\n"
      + "Capsule'd to one of Shelmet's own abilities). DO: win the opening battle,\n"
      + "then in the shop use the Rare Candy on Shelmet (L29 -> L30) so it evolves\n"
      + "to Accelgor, and open its Abilities. EXPECT: the active ability is one of\n"
      + "ACCELGOR's own (Momentum/Unburden/...), NOT Damp. Before the fix the capsule\n"
      + "override kept Damp (an ability Accelgor cannot legally have).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 29, // one Rare Candy -> L30 -> evolves to Accelgor
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SHELMET, {
          moveset: [MoveId.MEGA_DRAIN, MoveId.ACID, MoveId.PROTECT, MoveId.STRUGGLE_BUG],
        }),
      ];
    },
    onBattleStart: () => {
      const lead = globalScene.getPlayerPokemon();
      if (lead) {
        // Simulate an Ability Capsule pinning the active ability to Damp (one of
        // Shelmet's own abilities). Accelgor has no Damp in its ability set.
        lead.customPokemonData.ability = AbilityId.DAMP;
        lead.updateInfo();
      }
    },
    shopItems: [modifierTypes.RARE_CANDY],
  },
  {
    label: "Candy stats: 2 in a row (no +0)",
    description:
      "Rare Candy stat-gain fix. Bug: buying 2+ candies in a row on a level-capped\n"
      + "mon showed one level-up with the full gain and the next with +0 on every\n"
      + "stat (looked like 'candy adds no stats'). Cause: candy advanced the level\n"
      + "eagerly per purchase but the stat recalc/display was deferred to a phase, so\n"
      + "back-to-back candies raced and one screen diffed against an already-final\n"
      + "level. DO: this Regice is L50 at wave 5 (well above the cap). Win the opening\n"
      + "battle, then in the shop BUY BOTH Rare Candies on Regice, one after the\n"
      + "other. EXPECT: EACH level-up screen shows real POSITIVE stat gains (never +0\n"
      + "on all six), and Regice's final stats match L52. Before the fix the 2nd\n"
      + "candy (and retroactively the 1st) showed +0.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.ICE_BEAM, MoveId.THUNDERBOLT, MoveId.ANCIENT_POWER, MoveId.PROTECT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.REGICE, {
          moveset: [MoveId.ICE_BEAM, MoveId.THUNDERBOLT, MoveId.ANCIENT_POWER, MoveId.PROTECT],
        }),
      ];
    },
    // Two guaranteed candies so the tester can buy both back-to-back (the trigger).
    shopItems: [modifierTypes.RARE_CANDY, modifierTypes.RARE_CANDY],
  },
  {
    label: "Rare Candy evolves a FUSED mon (no black screen)",
    description:
      "Using a Rare Candy on a FUSED Pokemon black-screened the game when the evolved\n"
      + "fusion's sprite was missing/slow: the fusion-palette build threw, that rejected\n"
      + "the evolved-sprite load, and the evolution scene - which awaits it - hung on a\n"
      + "black screen forever. DO: this Bulbasaur is fused with Charmander at L15. Win\n"
      + "the opening battle, then in the shop use the Rare Candy on it (L15 -> L16) so\n"
      + "the Bulbasaur half evolves to Ivysaur.  EXPECT: the evolution animation plays,\n"
      + "the evolved FUSED sprite renders, and control returns to the game (NO black\n"
      + "screen / freeze). The palette degrades gracefully if a sprite is ever absent.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 15, // one Rare Candy -> L16 -> Bulbasaur evolves to Ivysaur
        STARTING_WAVE_OVERRIDE: 5,
        STARTER_FUSION_OVERRIDE: true,
        STARTER_FUSION_SPECIES_OVERRIDE: SpeciesId.CHARMANDER,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BULBASAUR, {
          moveset: [MoveId.TACKLE, MoveId.VINE_WHIP, MoveId.GROWL, MoveId.GROWTH],
        }),
      ];
    },
    shopItems: [modifierTypes.RARE_CANDY],
  },
  {
    label: "(note) On-entry setup survives an on-entry flinch",
    description:
      "COMBAT note (hard to force live - flinch is a 30% roll + needs the flincher to\n"
      + "move first). A Pokemon that SETS UP on switch-in via an ability - e.g. Air Blower\n"
      + "casts Tailwind on entry - must NOT have that setup cancelled by an opponent's own\n"
      + "on-switch-in flinch move (e.g. Jumpscare's Astonish). The self-buff cast used a\n"
      + "MovePhase that the FLINCHED tag could cancel, so a faster on-entry flincher could\n"
      + "wipe the Tailwind. Self-targeting on-entry casts now fire flinch-immune (the\n"
      + "FOLLOW_UP use mode, like a called move); offensive on-entry casts are unchanged.\n"
      + "Verified by er-entry-setup-flinch.test.ts (self -> FOLLOW_UP, offensive -> INDIRECT).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50, ABILITY_OVERRIDE: AbilityId.SAND_RUSH });
      return [
        makeStarter(SpeciesId.PELIPPER, {
          moveset: [MoveId.HURRICANE, MoveId.HYDRO_PUMP, MoveId.ROOST, MoveId.TAILWIND],
        }),
      ];
    },
  },
  {
    label: "Evo bg video: no cross-origin crash (#7)",
    description:
      "#7 'fainted Pokemon on the battlefield'. The evolution scene's BACKGROUND is a\n"
      + "video (evo_bg) served from the CDN. It was loaded WITHOUT crossOrigin, so the\n"
      + "browser tainted the <video>; when the evolution animation uploaded a frame as a\n"
      + "WebGL texture, texImage2D threw an UNCAUGHT SecurityError ('the video element\n"
      + "contains cross-origin data'). That aborts the render loop mid-frame, and in this\n"
      + "kind of DOUBLES TRAINER fight - where an enemy fainted right as the lead leveled\n"
      + "up and evolved - the just-KO'd foe was left DRAWN on the field while the game\n"
      + "logic continued underneath (the reported 'fainted Pokemon on the battlefield').\n"
      + "Fix: the cached evo_bg now carries crossOrigin 'anonymous' (jsDelivr sends ACAO\n"
      + "*), so the texture is never tainted.\n"
      + "DO (must be on STAGING/PROD - it is served from the CDN): win the opening doubles\n"
      + "trainer battle, then in the shop use the Rare Candy on Charmander (L15 -> L16) so\n"
      + "it evolves to Charmeleon. WATCH the evolution scene's animated swirling\n"
      + "BACKGROUND, then check the browser console (or hit Send Logs).\n"
      + "EXPECT: the evolution plays WITH its animated video background and control\n"
      + "returns cleanly; the console has NO 'texImage2D ... cross-origin data'\n"
      + "SecurityError. Before the fix that error appeared and the background did not\n"
      + "render. NOTE: only reproducible on the CDN build - locally the asset is\n"
      + "same-origin, so the video was never cross-origin and never crashed; this is also\n"
      + "why it can't be reproduced in the headless harnesses (WebGL/video/CORS).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 15, // one Rare Candy -> L16 -> Charmander evolves to Charmeleon
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_TYPE_OVERRIDE: BattleType.TRAINER, // the reported doubles-trainer context
        BATTLE_STYLE_OVERRIDE: "double",
      });
      return [
        makeStarter(SpeciesId.CHARMANDER, {
          moveset: [MoveId.EMBER, MoveId.DRAGON_BREATH, MoveId.SCRATCH, MoveId.SMOKESCREEN],
        }),
        // Sturdy partner so the doubles fight is winnable; Snorlax does not evolve,
        // so the Rare Candy unambiguously belongs to Charmander.
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
    shopItems: [modifierTypes.RARE_CANDY],
  },
  {
    // The systematic "Redux X → normal evolved form" repro — BOTH shapes:
    //   • form-carry lines (Drilbur→Excadrill-Redux, Kadabra→Alakazam-Redux)
    //   • the LAST-STAGE / single-evo lines whose Redux evolution is a brand-new
    //     custom species (Psyduck→SHYDUCK, Cinccino→FROSTUCCINO,
    //     Excadrill→REXCADRILL) — the ones that wrongly fell down the normal
    //     line before the redux-edge fix.
    // Party is L49 (above every evo level; Excadrill→Rexcadrill needs exactly 50,
    // reached on the next level-up). EXP SHARE ×3 spreads battle XP to the
    // BENCHED mons too, so winning levels everyone — or take the guaranteed
    // RARER CANDY from the shop (whole-party +1) for the deterministic path.
    label: "Redux evos carry form (all)",
    description:
      "Redux lines must evolve WITHIN the Redux line — never into the normal one.\n"
      + "Party (all Redux, L49): Drilbur→Excadrill-Redux, Kadabra→Alakazam-Redux,\n"
      + "Psyduck→SHYDUCK, Cinccino→FROSTUCCINO, Excadrill→REXCADRILL (at L50).\n"
      + "DO: WIN the fight (Chansey + Exp Share = whole party levels) OR take the\n"
      + "RARER CANDY in the shop (party +1).  EXPECT: every one evolves into its\n"
      + "REDUX evolution (sprite/typing/learnset) — e.g. Psyduck becomes Shyduck,\n"
      + "NOT plain Golduck; Cinccino becomes Frostuccino, NOT Beniccino.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 49,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.EARTHQUAKE, MoveId.PSYCHIC, MoveId.SURF, MoveId.ICE_BEAM],
        // Exp Share ×3 → benched party members receive battle XP too, so a win
        // levels (and evolves) the whole overdue party, per the maintainer.
        STARTING_MODIFIER_OVERRIDE: [{ name: "EXP_SHARE", count: 3 }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 49,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      const redux = (id: SpeciesId): Starter => makeStarter(id, { formIndex: formIndexByKey(id, "redux") });
      return [
        redux(SpeciesId.DRILBUR),
        redux(SpeciesId.KADABRA),
        redux(SpeciesId.PSYDUCK),
        redux(SpeciesId.CINCCINO),
        redux(SpeciesId.EXCADRILL),
        redux(SpeciesId.KRABBY),
      ];
    },
    // Whole-party level-up → all overdue Redux mons evolve at once.
    shopItems: [modifierTypes.RARER_CANDY],
  },

  // ===========================================================================
  // EARLIER scenarios (sprites / megas / type-chart / multi-head)
  // ===========================================================================
  {
    label: "Multi-Head x3 (Sandy)",
    description:
      "#312 Multi-Headed — strikes once per head.\n"
      + "Sandy Shocks has 3 heads.  DO: use Thunder Shock on Blissey (survives).\n"
      + "EXPECT: it hits 3 TIMES.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MULTI_HEADED),
        MOVESET_OVERRIDE: [MoveId.THUNDER_SHOCK],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
      });
      return [makeStarter(SpeciesId.SANDY_SHOCKS)];
    },
  },
  {
    label: "Multi-Head x2 (Doduo)",
    description:
      "#312 control — Multi-Headed respects head count.\n"
      + "Doduo has 2 heads.  DO: use Tackle on Blissey.  EXPECT: it hits exactly 2\n"
      + "TIMES (NOT 3) — two-headed mons were not over-bumped.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MULTI_HEADED),
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
      });
      return [makeStarter(SpeciesId.DODUO)];
    },
  },
  {
    label: "Molten Down neutral",
    description:
      "#316 Molten Down — must not over-apply super-effective.\n"
      + "DO: use Ember on Relicanth (Water/Rock).  EXPECT: NEUTRAL damage. Before the\n"
      + "fix the Rock override made it 2× and ignored the Water half.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MOLTEN_DOWN),
        MOVESET_OVERRIDE: [MoveId.EMBER, MoveId.FLAMETHROWER],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RELICANTH,
        ENEMY_LEVEL_OVERRIDE: 50,
      });
      return [makeStarter(SpeciesId.CHARIZARD)];
    },
  },
  {
    label: "Calyrex As One",
    description:
      "#319 Calyrex Shadow Rider — ability must show.\n"
      + "DO: open the party Summary.  EXPECT: the ABILITY line reads 'As One'\n"
      + "(Spectrier), not blank.",
    setup: () => {
      resetDevOverrides();
      const form = formIndexContaining(SpeciesId.CALYREX, "shadow");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 70,
        STARTING_WAVE_OVERRIDE: 5,
        STARTER_FORM_OVERRIDES: { [SpeciesId.CALYREX]: form },
      });
      return [
        makeStarter(SpeciesId.CALYREX, {
          formIndex: form,
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Mega abilities are the DEX abilities (Hydreigon/Excadrill)",
    description:
      "Mega/primal forms showed the WRONG abilities: the dex resolves a species'\n"
      + "ability refs by ARRAY POSITION, but the ER engine was keyed by the dex id\n"
      + "field, which differs for 81 (mega-exclusive) abilities. So Hydreigon Mega\n"
      + "showed Ice Picks/Sundae and Excadrill Mega showed Overcast. mapAbilityId now\n"
      + "translates position -> id, so megas get their real dex abilities.\n"
      + "DO: win the opening battle, take a MEGA STONE for Hydreigon (then re-run for\n"
      + "Excadrill), mega it, open SUMMARY -> Abilities/Innates.\n"
      + "EXPECT Hydreigon Mega: ability WINGS OF PESTILENCE; innates HYDRA, MIND\n"
      + "CRUNCH, MERCILESS (NOT Ice Picks / Sundae).\n"
      + "EXPECT Excadrill Mega: abilities MOLD BREAKER / SAND RUSH / SAND GUARD;\n"
      + "innates MEGA DRILL, STEELWORKER, AFTERSHOCK (NOT Overcast).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [MEGA_BRACELET],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.HYDREIGON, {
          moveset: [MoveId.DRAGON_PULSE, MoveId.DARK_PULSE, MoveId.FLAMETHROWER, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.EXCADRILL, {
          moveset: [MoveId.EARTHQUAKE, MoveId.IRON_HEAD, MoveId.ROCK_SLIDE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    // Two-mon party so the Form-Change Item can roll either mega stone.
    shopItems: [modifierTypes.FORM_CHANGE_ITEM, modifierTypes.FORM_CHANGE_ITEM],
  },
  {
    // In ER, a mega is a permanent form/evo ACTIVATED by giving the mon its mega
    // stone (not an in-battle toggle). This tests the store path: get the stone
    // for a specific mon and apply it. Party is JUST Venusaur, so the guaranteed
    // Form-Change Item the shop offers resolves to Venusaurite.
    label: "Store: Mega stone (Venusaur)",
    description:
      "ER megas = permanent forms unlocked by a MEGA STONE from the shop.\n"
      + "You have a lone Venusaur + a Mega Bracelet. DO: win the opening battle, then\n"
      + "in the rewards take the offered MEGA STONE (Venusaurite) and give it to\n"
      + "Venusaur.  EXPECT: Venusaur takes its Mega form (sprite + stat/ability/typing\n"
      + "change). Tests 'start in the store, apply a specific item to a specific mon'.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [MEGA_BRACELET],
        MOVESET_OVERRIDE: [MoveId.SOLAR_BEAM, MoveId.SLUDGE_BOMB],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SOLAR_BEAM, MoveId.SLUDGE_BOMB, MoveId.GROWTH, MoveId.SYNTHESIS],
        }),
      ];
    },
    // The shop guarantees a Form-Change Item; with only Venusaur in the party it
    // can only roll Venusaurite — the "mega stone for a specific mon".
    shopItems: [modifierTypes.FORM_CHANGE_ITEM],
  },
  {
    // Sprite regression: an injected mega whose form was registered by an earlier
    // pass (skipped by injectAllErMegaForms as "already present") never got its
    // `elite-redux/<slug>` sprite redirect, so it fell back to the vanilla
    // `{id}-{formKey}` path, 404'd, and rendered the BASE sprite. The "Wigglytuff
    // Mega shows the NORMAL Wigglytuff" report. installAllErMegaSpriteRedirects()
    // now redirects EVERY mega form. Wigglytuff has 3 stones (Mega, Mega X, Mega Y),
    // so a few Form-Change Items let you check each one's sprite.
    label: "Store: Mega sprite renders (Wigglytuff)",
    description:
      "Mega forms were showing the BASE sprite (e.g. Wigglytuff Mega looked like a\n"
      + "normal Wigglytuff) - the mega sprite 404'd and fell back. You have a lone\n"
      + "Wigglytuff + a Mega Bracelet. DO: win the opening battle, take an offered\n"
      + "MEGA STONE (Wigglytuffite / Wigglytuffite X / Wigglytuffite Y) and give it to\n"
      + "Wigglytuff; re-run to try the other stones.\n"
      + "EXPECT: Wigglytuff takes its Mega form with a DISTINCT mega sprite (not the\n"
      + "plain Wigglytuff sprite). Check front + back + shiny.\n"
      + "ALSO (UI surface): in the Pokedex / starter-select preview, browse to a mega\n"
      + "form (e.g. Wigglytuff Mega) and toggle shiny - the mega sprite must render\n"
      + "there too, with NO 'Missing animation: pkmn__er__<slug>' in the console.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [MEGA_BRACELET],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.WIGGLYTUFF, {
          moveset: [MoveId.DAZZLING_GLEAM, MoveId.HYPER_VOICE, MoveId.ICE_BEAM, MoveId.THUNDERBOLT],
        }),
      ];
    },
    // Lone Wigglytuff → each Form-Change Item rolls one of its mega stones; a few
    // so the tester can verify the sprite of each mega form.
    shopItems: [modifierTypes.FORM_CHANGE_ITEM, modifierTypes.FORM_CHANGE_ITEM, modifierTypes.FORM_CHANGE_ITEM],
  },
  {
    // Reachability check for a mon ER SPLITS across species: Oricorio Baile is
    // VANILLA (SpeciesId.ORICORIO, 741) but Pom-Pom / Pa'u / Sensu are ER-CUSTOM
    // species (10336 / 10337 / 10338). All four share the SAME Oricorionite -> Mega.
    // Reported: the Oricorio Mega is NOT listed in the Pokedex form browser. This
    // scenario tests BOTH the in-run reachability (does the stone mega-evolve it?)
    // and the Pokedex listing, for the vanilla AND the custom variants.
    label: "Store: Oricorio mega reachable (Baile)",
    description:
      "ER splits Oricorio across species: Baile = VANILLA 741 (this scenario), while\n"
      + "Pom-Pom/Pa'u/Sensu are SEPARATE ER-custom species (10336-8). All share the\n"
      + "Oricorionite -> Mega. Reported: Oricorio Mega is MISSING from the Pokedex form\n"
      + "list - and Baile is the one gated out of the dex's ER-mega path.\n"
      + "DO: win the opening battle, take the offered MEGA STONE (Oricorionite) and give\n"
      + "it to Oricorio.\n"
      + "EXPECT (reachability): Oricorio MEGA-EVOLVES to its Mega form (sprite + stat /\n"
      + "type / ability change). If the stone never appears or won't apply, that is a\n"
      + "real reachability regression.\n"
      + "ALSO (Pokedex): open the dex / starter form browser on Oricorio and confirm the\n"
      + "Mega form is LISTED / browsable. (Pom-Pom/Pa'u/Sensu are distinct dex entries -\n"
      + "check those separately in the Pokedex if you've seen them.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [MEGA_BRACELET],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      // Lone VANILLA Baile Oricorio (741) - guaranteed-valid starter, and the form
      // gated out of the dex ER-mega path; a lone mon makes the Form-Change Item
      // resolve to its Oricorionite.
      return [
        makeStarter(SpeciesId.ORICORIO, {
          moveset: [MoveId.REVELATION_DANCE, MoveId.AIR_SLASH, MoveId.HURRICANE, MoveId.ROOST],
        }),
      ];
    },
    shopItems: [modifierTypes.FORM_CHANGE_ITEM, modifierTypes.FORM_CHANGE_ITEM],
  },
  {
    // #359/#318 verification: these holders' megas were among the 51 that had
    // NO working stone before the form-change-bridge fix — second megas of
    // multi-mega species (Venusaur Mega-Y, Gyarados Mega-X, Lucario Mega-X AND
    // Mega-Z on distinct stones) and regional-form megas (Galarian Slowbro,
    // Hisuian Arcanine). 6 guaranteed Form-Change Items roll stones for the
    // party; rerolls re-pick if duplicates show.
    label: "Store: fixed megas reachable",
    description:
      "#359 — 51 megas had no obtainable stone; verify the fix.\n"
      + "Party: Venusaur, Gyarados, Lucario, Galarian Slowbro, Hisuian Arcanine\n"
      + "(+ Mega Bracelet). DO: win the opening fight; the shop offers MEGA STONES\n"
      + "for your party (reroll if dupes). Give each mon its stone, then mega in\n"
      + "battle.  EXPECT: every offered stone WORKS (sprite/stats change). Lucario\n"
      + "must offer TWO different stones: Lucarionite (Mega X) + Lucarionite Z\n"
      + "(Mega Z). Note any stone that does nothing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [MEGA_BRACELET],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN, MoveId.GROWTH, MoveId.SYNTHESIS],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.DRAGON_DANCE, MoveId.ICE_FANG],
        }),
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.FLASH_CANNON, MoveId.SWORDS_DANCE, MoveId.EXTREME_SPEED],
        }),
        makeStarter(SpeciesId.GALAR_SLOWBRO, {
          moveset: [MoveId.PSYCHIC, MoveId.SURF, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.HISUI_ARCANINE, {
          moveset: [MoveId.FLARE_BLITZ, MoveId.ROCK_SLIDE, MoveId.EXTREME_SPEED, MoveId.CRUNCH],
        }),
      ];
    },
    shopItems: [
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
      modifierTypes.FORM_CHANGE_ITEM,
    ],
  },
  {
    label: "Resist berries (#357)",
    description:
      "#357 Resistance berries — trainer-only held berries that HALVE one\n"
      + "super-effective hit of their type BEFORE it lands, then are eaten.\n"
      + "Enemy Charizard holds a PASSHO BERRY (Water).\n"
      + "DO: 1) Use SURF — EXPECT roughly HALF damage + message '…Passho Berry\n"
      + "weakened the attack!' and the berry is gone. 2) Surf again — EXPECT full\n"
      + "damage (one use only). 3) Restart and use THIEF first — EXPECT you STEAL\n"
      + "the berry; an enemy Water hit on your mon is then halved once instead.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHARIZARD,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SURF],
      });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.SURF, MoveId.THIEF, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => {
      // Guarantee the berry (the real trainer roll is 1%/5%/10% per mon).
      const enemy = globalScene.getEnemyPokemon();
      if (enemy) {
        const mod = erResistBerryModifierType(PokemonType.WATER).newModifier(enemy);
        if (mod) {
          // ignoreUpdate=false → the enemy item bar refreshes immediately, so
          // the berry icon is visible from turn 1.
          void globalScene.addEnemyModifier(mod as PokemonHeldItemModifier, false, true);
        }
      }
    },
  },
  {
    label: "Ward Stones (#358)",
    description:
      "#358 Ward Stones — charge-based CC blockers (legendary resistance).\n"
      + "Enemy Snorlax holds a GREATER WARD STONE (2 charges, cyan stone icon).\n"
      + "DO: 1) Use THUNDER WAVE twice — EXPECT both BLOCKED ('…Ward Stone\n"
      + "blocked the paralysis!') and the icon's charge number dropping 2->1->0.\n"
      + "2) A third Thunder Wave lands (stone empty). 3) Confuse Ray while it\n"
      + "still has charges is also blocked. 4) Restart and THIEF it — EXPECT the\n"
      + "stolen stone arrives at 0 charges (it refills after 15 won waves).\n"
      + "Bonus: holding ANY stone makes you immune to Shadow-Tag-style trapping\n"
      + "at no charge cost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.THUNDER_WAVE, MoveId.CONFUSE_RAY, MoveId.THIEF, MoveId.SURF],
        }),
      ];
    },
    onBattleStart: () => {
      // Guarantee the stone (real rolls: Hell wave 100+ / Elite 150+).
      const enemy = globalScene.getEnemyPokemon();
      if (enemy) {
        const mod = erWardStoneModifierType("greater").newModifier(enemy);
        if (mod) {
          // ignoreUpdate=false → the stone (tinted cyan, charge counter) shows
          // on the enemy item bar from turn 1.
          void globalScene.addEnemyModifier(mod as PokemonHeldItemModifier, false, true);
        }
      }
    },
  },
  {
    label: "Hell trainer boss buff (#135 T1)",
    description:
      "#135 Tier 1 - on HELL, after wave 100, every trainer's HIGHEST-BST mon is\n"
      + "promoted to a 2-health-bar BOSS that carries a GUARANTEED (stealable)\n"
      + "Greater Ward Stone + a resist berry for EACH of its type weaknesses. This\n"
      + "forces a Hell TRAINER fight at wave 112.\n"
      + "DO: send out the trainer's team. Find the strongest mon (highest base-stat\n"
      + "total). EXPECT: it has TWO HP bars (boss shield), a cyan Greater Ward Stone\n"
      + "in its item row, and one or more resist berries (Occa/Passho/... matching\n"
      + "its weaknesses) - THIEF/Covet them to confirm. The OTHER, weaker mons must\n"
      + "NOT get the forced 2-bar boss treatment. Tier 2 (3-bar apex + a 2nd boss,\n"
      + "all PRIME stones) is NOT live yet - do not expect it.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 90,
        STARTING_WAVE_OVERRIDE: 112, // a Hell trainer wave past the 100 gate
        BATTLE_TYPE_OVERRIDE: BattleType.TRAINER, // guarantee the trainer fight
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.THIEF, MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE],
        }),
      ];
    },
  },
  {
    label: "Chili Sample (#387)",
    description:
      "#387 CHILI SAMPLE - the holder's DAMAGING moves gain a 10% burn chance,\n"
      + "contact or not. Yanmega holds one (red-tinted charcoal icon).\n"
      + "DO: spam AIR SLASH / BUG BUZZ (both non-contact) for several turns.\n"
      + "EXPECT: Chansey gets BURNED now and then (about 1 hit in 10). Soft-\n"
      + "Boiled does not cure burn, so the status sticks once it lands.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.AIR_SLASH, MoveId.BUG_BUZZ, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["chiliSample", 1]]),
  },
  {
    label: "Loaded Dice (#387)",
    description:
      "#387 LOADED DICE - each stack raises the MINIMUM strikes of 2-5-hit\n"
      + "moves by 1. Yanmega holds the full 3 stacks (gold-tinted lens icon).\n"
      + "DO: use FURY SWIPES repeatedly.\n"
      + "EXPECT: it hits 5 TIMES EVERY USE (normally 2-5, weighted low). Pass\n"
      + "only if you never see fewer than 5 hits across several uses.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.FURY_SWIPES, MoveId.AIR_SLASH, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["loadedDice", 3]]),
  },
  {
    label: "Lucky Heart (#387)",
    description:
      "#387 LUCKY HEART - +15% move effect chance per stack (max 2), additive\n"
      + "with Serene Grace style abilities. Yanmega holds BOTH stacks (pink\n"
      + "charm icon), so Air Slash's flinch chance is +30 points.\n"
      + "DO: open with AIR SLASH every turn (you outspeed).\n"
      + "EXPECT: Snorlax flinches MUCH more often than the move's base chance -\n"
      + "it should visibly fail to act on most turns it gets hit.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.AIR_SLASH, MoveId.BUG_BUZZ, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["luckyHeart", 2]]),
  },
  {
    label: "Omni Gem (#387)",
    description:
      "#387 OMNI GEM - doubles the holder's next damaging move; 2 CHARGES\n"
      + "total, then the gem SHATTERS and vanishes. Yanmega holds one (white\n"
      + "elemental-gem icon on its item bar).\n"
      + "DO: attack three times with BUG BUZZ.\n"
      + "EXPECT: hit 1 - double damage + 'Omni Gem doubled the blow! (1 charge\n"
      + "left)'. Hit 2 - double damage + '...and shattered!' and the gem icon\n"
      + "DISAPPEARS from the item bar. Hit 3 - normal damage, no message.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.BUG_BUZZ, MoveId.AIR_SLASH, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["omniGem", 1]]),
  },
  {
    label: "Minion Control 25% (#399)",
    description:
      "#399 MINION CONTROL (Redux Alakazam line) - '+1 hit per healthy party\n"
      + "member' was hitting up to 6 TIMES AT FULL POWER. Per the ROM text,\n"
      + "extra strikes deal 10% each; the first hit stays 100%.\n"
      + "Your Alakazam has Minion Control via override + 5 healthy benchmates.\n"
      + "DO: use PSYCHIC and read the damage numbers per strike (R dmg panel).\n"
      + "EXPECT: 6 strikes - one big, five tiny (~10% of the first each).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MINION_CONTROL),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT] }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.DRAGON_DANCE, MoveId.ICE_FANG],
        }),
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.FLASH_CANNON, MoveId.SWORDS_DANCE, MoveId.EXTREME_SPEED],
        }),
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.ARCANINE, {
          moveset: [MoveId.FLARE_BLITZ, MoveId.EXTREME_SPEED, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Evo screen sprite (#396)",
    description:
      "#396 Evolution screen showed the PRE-evolution sprite for redux shinies\n"
      + "(reported: shiny Ralts Redux -> Kirlia Redux kept showing Ralts;\n"
      + "console said 'Missing animation: ..._shiny3'). The front animation is\n"
      + "now rebuilt on demand.\n"
      + "DO: your SHINY Ralts Redux is level 19 - win once, level to 20, evolve.\n"
      + "EXPECT: the evolution cutscene visibly MORPHS into Kirlia Redux and\n"
      + "the end screen shows KIRLIA REDUX's sprite, not Ralts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 19,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.RALTS, {
          formIndex: formIndexByKey(SpeciesId.RALTS, "redux"),
          shiny: true,
          variant: 2,
          moveset: [MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.SHADOW_BALL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Justified absorbs Dark (#397)",
    description:
      "#397 JUSTIFIED - per the ER dex it boosts Attack INSTEAD OF being hit\n"
      + "by Dark-type moves (a Sap Sipper style absorb, not hit-then-boost).\n"
      + "Enemy Weavile spams CRUNCH at your Lucario (ability: Justified).\n"
      + "EXPECT: Crunch does NO damage at all - Lucario absorbs it and gains\n"
      + "+1 Attack every time. Before the fix the hit still dealt damage.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.JUSTIFIED,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WEAVILE,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.CRUNCH],
      });
      return [
        makeStarter(SpeciesId.LUCARIO, {
          moveset: [MoveId.SPLASH, MoveId.AURA_SPHERE, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Power Herb (#401)",
    description:
      "#401/#406 POWER HERB - skips the charge turn of two-turn moves. 2\n"
      + "charges, regains one every 10 waves. Venusaur holds one (ROM icon).\n"
      + "DO: use SOLAR BEAM three times (no sun is up).\n"
      + "EXPECT: the herb icon shows a GREEN charge number (#406). Uses 1 and\n"
      + "2 FIRE IMMEDIATELY with 'became fully charged due to its Power Herb!'\n"
      + "and the number counts 2 -> 1 -> 0 (red at 0). Use 3 charges normally\n"
      + "for a turn (herb empty). The herb is NOT consumed - after 10 more won\n"
      + "waves the counter ticks back up.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SOLAR_BEAM, MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => givePlayerCommunityItems([["powerHerb", 1]]),
  },
  {
    label: "Aftermath vs multihit (#405)",
    description:
      "#405 AFTERMATH vs MULTI-HIT - enemy Koffing has Aftermath as an innate\n"
      + "(on KO it uses a 100 BP Explosion as its dying act).\n"
      + "DO: use ICICLE SPEAR (2-5 strikes) to KO it.\n"
      + "EXPECT: Aftermath triggers ONCE on the lethal strike - the volley\n"
      + "STOPS there (no extra strikes), Koffing immediately explodes and\n"
      + "faints. Before the fix every leftover strike re-triggered Aftermath\n"
      + "and Koffing kept sitting at 1 HP with the popup spamming.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.KOFFING,
        ENEMY_LEVEL_OVERRIDE: 15,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.DEWGONG, {
          moveset: [MoveId.ICICLE_SPEAR, MoveId.SWIFT, MoveId.PROTECT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Claws + Copper Rod (#387)",
    description:
      "#387 Contact status items - your Scizor holds RUSTY CLAW + SPIKED\n"
      + "KNUCKLES; the enemy Snorlax holds a COPPER ROD.\n"
      + "DO: spam BULLET PUNCH (contact) and watch a few turns.\n"
      + "EXPECT: ~10% per hit the Snorlax gets POISONED (Rusty Claw) or BLEEDS\n"
      + "(Spiked Knuckles, red badge). The enemy's Copper Rod can PARALYZE YOUR\n"
      + "Scizor when you make contact (defensive proc). SWIFT (non-contact)\n"
      + "never procs any of them. ALSO (#437): win and check the SHOP - the\n"
      + "guaranteed Copper Rod offer must show the COPPER-tinted claw icon\n"
      + "(it used to render untinted, like a plain Quick Claw).",
    shopItems: [modifierTypes.ER_COPPER_ROD],
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SCIZOR, {
          moveset: [MoveId.BULLET_PUNCH, MoveId.SWIFT, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => {
      givePlayerCommunityItems([
        ["rustyClaw", 1],
        ["spikedKnuckles", 1],
      ]);
      const enemy = globalScene.getEnemyPokemon();
      if (enemy) {
        const rod = erCommunityItemModifierType("copperRod").newModifier(enemy);
        if (rod) {
          void globalScene.addEnemyModifier(rod as PokemonHeldItemModifier, false, true);
        }
      }
    },
  },
  {
    label: "Frostbite Orb (#387)",
    description:
      "#387 FROSTBITE ORB - the Toxic/Flame Orb sibling for ER's Frostbite.\n"
      + "Your Machamp holds one (icy-blue orb icon).\n"
      + "DO: end a turn (use Splash).\n"
      + "EXPECT: at turn end Machamp gets the FROSTBITE badge (1/16 chip per\n"
      + "turn, weakened special attacks) - fuel for Guts-style abilities. ALSO:\n"
      + "switch to Glalie (slot 2, also holding one) - it NEVER gets\n"
      + "frostbitten (Ice-types are immune).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.SPLASH, MoveId.CLOSE_COMBAT, MoveId.FACADE, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.GLALIE, {
          moveset: [MoveId.SPLASH, MoveId.ICE_BEAM, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => {
      for (const member of globalScene.getPlayerParty()) {
        const orb = modifierTypes
          .FROSTBITE_ORB()
          .withIdFromFunc(modifierTypes.FROSTBITE_ORB)
          .newModifier(member) as PokemonHeldItemModifier | null;
        if (orb) {
          globalScene.addModifier(orb, true);
        }
      }
      globalScene.updateModifiers(true);
    },
  },
  {
    label: "Frostbite Orb vs Magma Armor",
    description:
      "Frostbite Orb must NOT proc frostbite on a MAGMA ARMOR holder (Magma Armor\n"
      + "grants freeze immunity, and ER frostbite is the freeze analog). Reported on\n"
      + "a Heatran with Magma Armor.\n"
      + "Your SLUGMA has Magma Armor and holds a Frostbite Orb; the Machamp also\n"
      + "holds one but has no immunity.\n"
      + "EXPECT: Slugma NEVER gains the FROST badge at turn end (orb blocked by\n"
      + "Magma Armor), while the Machamp DOES get frostbitten by its orb.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED],
      });
      return [
        makeStarter(SpeciesId.SLUGMA, {
          abilityIndex: 0, // Magma Armor
          moveset: [MoveId.SPLASH, MoveId.LAVA_PLUME, MoveId.FLAMETHROWER, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.SPLASH, MoveId.CLOSE_COMBAT, MoveId.FACADE, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => {
      for (const member of globalScene.getPlayerParty()) {
        const orb = modifierTypes
          .FROSTBITE_ORB()
          .withIdFromFunc(modifierTypes.FROSTBITE_ORB)
          .newModifier(member) as PokemonHeldItemModifier | null;
        if (orb) {
          globalScene.addModifier(orb, true);
        }
      }
      globalScene.updateModifiers(true);
    },
  },
  {
    label: "(note) Redux dex crash + move-loop",
    description:
      "DATA / FLOW fixes - verify outside a forced battle:\n"
      + "1) POKEDEX CRASH: open the Pokedex and view Redux / ER-custom / mid-stage\n"
      + "forms (Monferno Redux, Flaaffy Redux 'Fluffbee', etc.). The ABILITIES,\n"
      + "EVOLUTION, and EGG-MOVE screens must open WITHOUT crashing (was 'show()\n"
      + "crashed: ...eggMoves / abilityAttr of undefined' for basically every Redux\n"
      + "mon). Root: starterId resolved to an id with no starterData entry.\n"
      + "2) INFINITE MOVE-LEARN LOOP: a mon hitting a 4-move learnset tier (Latios\n"
      + "lv37: Confusion / Dragon Rage / Power Swap / Guard Swap) no longer re-offers\n"
      + "the same moves forever (was a run-blocker). Root: a leaked MOVESET_OVERRIDE\n"
      + "made the 'already knows it' check read the override view, not the real\n"
      + "moveset; the dedup now reads the real moveset.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1 });
      return [
        makeStarter(SpeciesId.LATIOS, {
          moveset: [MoveId.PSYCHIC, MoveId.DRAGON_PULSE, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Ghost trainer movesets + endless contamination",
    description:
      "POOL / SERVER fixes - verify by playing the Ghost Trainers challenge (or the\n"
      + "endgame ghost waves), NOT a single forced battle (the ghost pool is the live\n"
      + "cross-player run history):\n"
      + "1) GHOST MOVESETS: a ghost whose stored species gets devolved or BST-swapped on\n"
      + "spawn (a deep team fielded early, or an over-cap mon capped down to fit the wave)\n"
      + "now keeps a level-appropriate GENERATED moveset for its FINAL species instead of\n"
      + "the stored moves of the original species (was 'ghost has wrong/empty moves'). A\n"
      + "ghost whose species is unchanged still uses its exact stored moveset.\n"
      + "2) ENDLESS CONTAMINATION: endless / daily runs are no longer captured into the\n"
      + "ghost pool, and the shared /sample query drops endless-depth rows (wave > 200) +\n"
      + "any tagged endless run - so a classic ghost is never a 1000-wave endless team.\n"
      + "Headless coverage: test/tests/elite-redux/er-ghost-challenge.test.ts (moveset\n"
      + "species-match + the endless capture gate). The worker /sample filter ships in\n"
      + "workers/er-save-api (deploy gated on the maintainer).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Dex Nav + Capsule (#387/#392)",
    description:
      "#387/#392/#404 New consumables - win the opening battle; the FIRST\n"
      + "shop guarantees DEX NAV (green scanner), ABILITY CAPSULE, OMNI GEM\n"
      + "and LEARNER'S SHROOM (teal mushroom).\n"
      + "DO+EXPECT: 1) DEX NAV - a species list of the CURRENT BIOME opens;\n"
      + "register 2 Pokemon; both then show as CAUGHT in the Pokedex/starter\n"
      + "select. 2) ABILITY CAPSULE on Yanmega - its ACTIVE ability switches to\n"
      + "the species' next legal one (check the summary). Buying a second\n"
      + "capsule for the same mon shows 'no effect' - it works ONCE per mon.\n"
      + "Then EXIT to title -> starter select -> Yanmega: the ability the\n"
      + "capsule switched it to is now UNLOCKED (selectable), not greyed.\n"
      + "3) OMNI GEM - held item, see the dedicated Omni Gem scenario.\n"
      + "4) LEARNER'S SHROOM on Yanmega - pick ANY move it can learn (TMs,\n"
      + "tutors, egg moves, reached level-ups) from the big list; it learns it\n"
      + "on the spot. Future level-up moves are NOT in the list.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.YANMEGA, {
          moveset: [MoveId.AIR_SLASH, MoveId.BUG_BUZZ, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
    shopItems: [
      modifierTypes.ER_DEX_NAV,
      modifierTypes.ER_ABILITY_CAPSULE,
      modifierTypes.ER_OMNI_GEM,
      modifierTypes.ER_LEARNERS_SHROOM,
    ],
  },
  {
    label: "Ability Capsule: cycled slot survives mega (#754)",
    description:
      "#754 - The Ability Capsule changes a mon's ACTIVE ability SLOT, but the chosen\n"
      + "slot was lost when the mon mega-evolved: a mon cycled to its 3rd/hidden\n"
      + "ability would revert to its 2nd-slot ability after mega. Repro mon: Dragapult\n"
      + "(Clear Body / Speed Boost / Parental Bond), which has a Mega.\n"
      + "DO: win the opening battle. In the FIRST shop, use the ABILITY CAPSULE on\n"
      + "Dragapult and cycle its active ability to PARENTAL BOND (the 3rd / hidden\n"
      + "slot) - the summary should read Parental Bond. Take the FORM CHANGE ITEM\n"
      + "(a single-mon party makes it Dragapult's mega stone). Next battle, mega-evolve.\n"
      + "EXPECT: after mega, Dragapult Mega's ACTIVE ability reflects the 3rd / hidden\n"
      + "SLOT the capsule selected - NOT its 2nd-slot Speed Boost. The slot choice\n"
      + "carries across the form change (before the fix it fell back a slot).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.DRAGAPULT, {
          moveset: [MoveId.DRAGON_PULSE, MoveId.SHADOW_BALL, MoveId.U_TURN, MoveId.PROTECT],
        }),
      ];
    },
    shopItems: [modifierTypes.ER_ABILITY_CAPSULE, modifierTypes.FORM_CHANGE_ITEM],
  },
  {
    label: "Big Leaves: sun-emulation Growth +2 / Solar Beam no charge (#756)",
    description:
      "#756 - Big Leaves bundles Chloroplast, so its holder must act AS IF in sun even\n"
      + "with NO real weather: Growth raises Atk/SpAtk by +2 (not +1), and Solar Beam\n"
      + "fires the SAME turn it is used (no charge). Brontonana's Big Leaves was only\n"
      + "giving Growth +1 and Solar Beam was still charging.\n"
      + "(Big Leaves is normally an INNATE; this scenario forces it ACTIVE so it can be\n"
      + "tested without the candy unlock.)\n"
      + "DO: with NO weather set, use GROWTH, then SOLAR BEAM on the Snorlax.\n"
      + "EXPECT: Growth raises Atk +2 AND SpAtk +2 (two arrows each, check Battle Info);\n"
      + "Solar Beam deals damage on the turn it is selected - it does NOT spend a charge\n"
      + "turn. (Verified headless: Growth gave +2/+2 under Big Leaves.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 70,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.BIG_LEAVES),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.GROWTH, MoveId.SOLAR_BEAM, MoveId.SLUDGE_BOMB, MoveId.SYNTHESIS],
        }),
      ];
    },
  },
  {
    label: "Learner's Shroom: back-out doesn't consume it (#25)",
    description:
      "#25 - Backing out of the move-learn after picking a Learner's Shroom used to\n"
      + "CONSUME the Shroom without teaching a move (the level-up Memory Mushroom was\n"
      + "fine; the Shroom was missing the 'return to shop' copy that TM/Memory get).\n"
      + "Snorlax starts with a FULL 4-move set so the forget screen appears.\n"
      + "DO: KO the Magikarp, take the LEARNER'S SHROOM, pick Snorlax, pick any move,\n"
      + "then at 'forget which move?' BACK OUT (cancel / pick the new move row / answer\n"
      + "No to 'stop teaching'). \n"
      + "EXPECT: you are returned to the SAME reward screen with the Learner's Shroom\n"
      + "STILL AVAILABLE to pick again - it is NOT consumed. (If you DO teach a move,\n"
      + "the reward screen closes normally, as before.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
    shopItems: [modifierTypes.ER_LEARNERS_SHROOM],
  },
  {
    label: "TM Case: universal single-use TM (COMMON)",
    description:
      "TM Case replaces the old TM_COMMON/GREAT/ULTRA in the reward pool + biome\n"
      + "shop. It is a single-use universal TM: pick a party Pokemon, then pick ANY\n"
      + "ONE move from that Pokemon's COMPATIBLE TM LIST (moves it can still learn,\n"
      + "minus what it already knows). Snorlax has a 3-move set here so the new move\n"
      + "drops into the empty 4th slot with no forget prompt.\n"
      + "DO: KO the Magikarp, BUY/take the TM CASE, pick Snorlax, pick any TM move\n"
      + "(e.g. Ice Beam, Thunderbolt), confirm.\n"
      + "EXPECT: the move list shows Snorlax's TM-learnable moves (NOT level-up-only\n"
      + "moves), the chosen move is taught into the open slot, and the reward screen\n"
      + "CLOSES (the TM Case is CONSUMED - it does not reappear).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST],
        }),
      ];
    },
    shopItems: [modifierTypes.TM_CASE],
  },
  {
    label: "TM Case: back-out doesn't consume it (#25)",
    description:
      "Like the Learner's Shroom (#25), backing out of the move-learn after picking\n"
      + "a TM Case must NOT consume it. Snorlax starts with a FULL 4-move set so the\n"
      + "'forget which move?' screen appears.\n"
      + "DO: KO the Magikarp, take the TM CASE, pick Snorlax, pick any TM move, then\n"
      + "at 'forget which move?' BACK OUT (cancel / pick the new-move row / answer No\n"
      + "to 'stop teaching').\n"
      + "EXPECT: you are returned to the SAME reward screen with the TM Case STILL\n"
      + "AVAILABLE to pick again - it is NOT consumed. (If you DO teach a move, the\n"
      + "reward screen closes normally.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
    shopItems: [modifierTypes.TM_CASE],
  },
  {
    label: "Black shiny: REDUX form (#393)",
    description:
      "#393 CRITICAL - Redux-form (and ER-custom) black shinies showed the\n"
      + "TINTED-HUE PLACEHOLDER instead of the real black art, in the suite AND\n"
      + "live. Root cause: black shinies are shiny, so the slug atlas lookup\n"
      + "used the shiny path (elite-redux/{slug}/shiny-3) which is not a\n"
      + "manifest key.\n"
      + "Your starter is a BLACK SHINY RALTS REDUX.\n"
      + "EXPECT: it renders with the REAL black smoke-halo art from its very\n"
      + "first frame - front (summary) AND back (battle) - no dark-tint-over-\n"
      + "normal-sprite look. Check the party screen icon too.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.RALTS,
      });
      return [
        makeStarter(SpeciesId.RALTS, {
          formIndex: formIndexByKey(SpeciesId.RALTS, "redux"),
          moveset: [MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.SHADOW_BALL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Black shiny: acquisition",
    description:
      "#349 Black Shinies - catching one (acquisition path).\n"
      + "The wild Gardevoir is a BLACK SHINY (real black smoke-halo sprite; its\n"
      + "ability + 3 innates are UNTOUCHED, it just gains the 5th GIFT slot).\n"
      + "DO: weaken it (False Swipe) and CATCH it (5 Rogue Balls provided).\n"
      + "EXPECT: it spawns BLACK from its FIRST frame (no normal-then-black\n"
      + "swap - same speed as any shiny). After catching, its summary/ability\n"
      + "screens show its normal abilities plus the Gift row, and the black\n"
      + "state SURVIVES save/reload. ALSO: in starter select, the caught\n"
      + "filter dropdown has a BLACK sparkle option that shows only your\n"
      + "black-unlocked starters.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GARDEVOIR,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_ENEMY_OVERRIDE: SpeciesId.GARDEVOIR,
      });
      return [
        makeStarter(SpeciesId.SCIZOR, {
          moveset: [MoveId.FALSE_SWIPE, MoveId.THUNDER_WAVE, MoveId.BULLET_PUNCH, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    onBattleStart: () => {
      const balls = globalScene.pokeballCounts;
      balls[3] = Math.max(balls[3] ?? 0, 5); // Rogue Balls
    },
  },
  {
    label: "Black shiny: battle kit",
    description:
      "#349 Black Shinies — your OWN black shiny in battle.\n"
      + "Your Garchomp is a BLACK SHINY: normal ability + innates UNTOUCHED,\n"
      + "plus the 5th GIFT slot with 3 switchable pool choices.\n"
      + "DO (out of combat, in the REWARD SHOP): open the summary Abilities\n"
      + "page — EXPECT the Gift row (Gift 1/3, violet italic). PRESS R — EXPECT\n"
      + "the gift cycles 1/3 to 2/3 to 3/3 and the shown ability changes (live\n"
      + "in your NEXT battle). MID-COMBAT the gift is LOCKED: open Battle Info\n"
      + "during a fight and press R — EXPECT it does NOT cycle (no swapping the\n"
      + "ability to game the current fight). EXPECT the real black sprite from the\n"
      + "FIRST frame of the battle (no delayed normal-then-black swap), and at\n"
      + "the SAME HEIGHT as a normal mon (feet on the platform, not floating).\n"
      + "ALSO open the PARTY screen - EXPECT a BLACK star (not red) and an\n"
      + "obsidian-tinted party icon.\n"
      + "ALSO (#432): black shinies grant LUCK 5 - win and check the shop's\n"
      + "luck readout / reroll discount reflects 5 (normal shiny max is 3).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.THUNDER_WAVE],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.GARCHOMP,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Black shiny: ally gift share",
    description:
      "#349 Black Shinies — the GIFT is shared with allies on the field.\n"
      + "DOUBLE battle: your Jigglypuff is a BLACK SHINY; its ACTIVE gift\n"
      + "ability is shared with your Snorlax while both are out.\n"
      + "DO: open Battle Info → Abilities for SNORLAX (the non-black ally).\n"
      + "EXPECT: Snorlax's ability list includes the Jigglypuff's active gift\n"
      + "ability, and its effect works for Snorlax in combat. Switch the\n"
      + "Jigglypuff out: the gift disappears from Snorlax.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 10,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.JIGGLYPUFF,
      });
      return [
        makeStarter(SpeciesId.JIGGLYPUFF, {
          moveset: [MoveId.HYPER_VOICE, MoveId.SING, MoveId.PROTECT, MoveId.WISH],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Hell finale: BLACK Cascoon",
    description:
      "#349/#380 — the Hell finale STARTS as PRIMAL CASCOON; stage 2 is its\n"
      + "BLACK SHINY form (real generated black sprite + smoke, black sparkle).\n"
      + "Wave 200 on HELL with a REAL winning hell team (by 'unstressing',\n"
      + "ghost pool). DO: break stage 1's boss bars.  EXPECT: stage 2 turns\n"
      + "BLACK, returns to FULL HP / five boss bars, and has a gift ability on\n"
      + "top of Angel's Wrath. ALSO (#380): open\n"
      + "Battle Info -> Moves on the boss in BOTH stages - it carries the FULL\n"
      + "7-move Angel's Wrath kit (compressed list), and the AI actually uses\n"
      + "the spread (hazards, omniboost, King's Shield, traps...).",
    setup: () => {
      resetDevOverrides();
      setErDifficultyForScenario("hell");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 200,
        STARTING_WAVE_OVERRIDE: 200,
      });
      // Verbatim winning hell team from the prod ghost pool (player
      // "unstressing", wave 200 victory) — per the maintainer's standing rule.
      const m = (ids: number[]): MoveId[] => ids.map(id => erMove(id));
      return [
        makeStarter(382 as SpeciesId, { formIndex: 1, moveset: m([573, 618, 847, 542]) }),
        makeStarter(413 as SpeciesId, { formIndex: 2, abilityIndex: 2, moveset: m([456, 552, 455, 483]) }),
        makeStarter(157 as SpeciesId, { formIndex: 2, moveset: m([414, 552, 908, 284]) }),
        makeStarter(358 as SpeciesId, { moveset: m([586, 871, 826, 914]) }),
        makeStarter(263 as SpeciesId, { moveset: m([609, 667, 245, 882]) }),
        makeStarter(454 as SpeciesId, { moveset: m([827, 823, 837, 813]) }),
      ];
    },
  },
  {
    label: "Redux sprites (party)",
    description:
      "Redux form sprites/icons.\n"
      + "DO: open the party/summary and send them out.  EXPECT: Bellsprout-Redux and\n"
      + "Bounsweet-Redux show correct icons + battle sprites (no green box / wrong mon).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.BELLSPROUT, {
          formIndex: formIndexByKey(SpeciesId.BELLSPROUT, "redux"),
          moveset: [MoveId.VINE_WHIP, MoveId.RAZOR_LEAF, MoveId.GROWTH, MoveId.SLEEP_POWDER],
        }),
        makeStarter(SpeciesId.BOUNSWEET, {
          formIndex: formIndexByKey(SpeciesId.BOUNSWEET, "redux"),
          moveset: [MoveId.MAGICAL_LEAF, MoveId.PLAY_ROUGH, MoveId.SWEET_SCENT, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Redux sprite (enemy)",
    description:
      "Enemy Redux sprite.\n"
      + "DO: just look at the wild mon.  EXPECT: Bellsprout-Redux enemy renders its\n"
      + "Redux sprite correctly (no dark/green box).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BELLSPROUT,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_FORM_OVERRIDES: { [SpeciesId.BELLSPROUT]: formIndexByKey(SpeciesId.BELLSPROUT, "redux") },
      });
      return [makeStarter(SpeciesId.PIKACHU, { moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK] })];
    },
  },
  {
    label: "Heaven Asunder crit (#373)",
    description:
      "#373 Heaven Asunder: Spacial Rend ALWAYS crits (plus the +1 crit level for\n"
      + "everything else).\n"
      + "DO: use Spacial Rend several times.  EXPECT: EVERY Spacial Rend is a critical\n"
      + "hit. Aura Sphere crits only sometimes (that one just gets the +1 level).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.HEAVEN_ASUNDER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PALKIA, {
          moveset: [MoveId.SPACIAL_REND, MoveId.AURA_SPHERE, MoveId.SURF, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Youngster innates (#368)",
    description:
      "#368 Youngster trial mode: innates unlock FREE by level for the run\n"
      + "(slot 1 always, slot 2 at Lv 15, slot 3 at Lv 24) - no candies needed.\n"
      + "ALSO: on the difficulty picker after team select, HIGHLIGHTING each\n"
      + "mode shows its description in the message box under the list.\n"
      + "DO: open Battle Info -> Abilities (and the summary ability page) on the Lv 30\n"
      + "Gyarados.  EXPECT: all 3 innates show ACTIVE (Intimidate procs on entry too,\n"
      + "if not candy-unlocked it would normally be locked).\n"
      + "(Also #368: NO egg voucher after trainer wins on Youngster; wild shinies are\n"
      + "1.5x on Elite / 2x on Hell. Mode descriptions show when picking a difficulty\n"
      + "after team select.)",
    setup: () => {
      resetDevOverrides();
      setErDifficultyForScenario("youngster");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.ICE_FANG, MoveId.DRAGON_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Outrage retargets (#372)",
    description:
      "#372 Thrash/Outrage in doubles: after the locked move KOs its target, the\n"
      + "remaining frenzy turns used to FAIL every turn.\n"
      + "DOUBLE battle vs two frail Rattata. DO: use Outrage on one of them (it\n"
      + "dies). EXPECT: the NEXT forced Outrage turn automatically hits the OTHER\n"
      + "Rattata instead of failing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 70,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 15,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.OUTRAGE, MoveId.THRASH, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.SPLASH, MoveId.PROTECT, MoveId.YAWN, MoveId.REST] }),
      ];
    },
  },
  {
    label: "Soul Linker (#376)",
    description:
      "#376 Soul Linker: damage links BOTH ways.\n"
      + "The enemy Snorlax has Soul Linker as its ACTIVE ability.\n"
      + "DO: hit it with Waterfall.  EXPECT: your Gyarados takes the SAME damage\n"
      + "back. The harness regression passes; if your in-run case still fails,\n"
      + "note WHICH mon had Soul Linker (active vs innate slot) and Send Logs.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_ABILITY_OVERRIDE: erAbility(ErAbilityId.SOUL_LINKER),
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.ICE_FANG, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "SE-vs-type moves (#374)",
    description:
      "#374 'Super effective vs X' moves now ACTUALLY override the type chart\n"
      + "(SE message + 2x even into a resist).\n"
      + "Enemy is EMPOLEON (Water/Steel). DO: use each move.  EXPECT ALL FOUR show\n"
      + "'It's super effective!': Tsunami Hammer (vs Water - was resisted and on\n"
      + "the wrong type), Hacksaw + Gigaton Hammer (vs Steel - were resisted),\n"
      + "Brine (vs Water - was missing entirely).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.EMPOLEON,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MELMETAL, {
          moveset: [erMove(1002), erMove(1023), MoveId.GIGATON_HAMMER, MoveId.BRINE],
        }),
      ];
    },
  },
  {
    label: "NGas blocks Scare (#375)",
    description:
      "#375 Neutralizing Gas suppresses Scare's on-entry Sp. Atk drop.\n"
      + "The enemy Weezing has Neutralizing Gas; your Gyarados has SCARE.\n"
      + "DO: just enter the battle, then open Battle Info on the enemy.\n"
      + "EXPECT: Weezing's Sp. Atk stage is 0 (NOT -1). Regression-locked in the\n"
      + "harness for both active and innate Scare; if you can still reproduce a\n"
      + "drop in a real run, Send Logs with the exact mons involved.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SCARE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WEEZING,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_ABILITY_OVERRIDE: AbilityId.NEUTRALIZING_GAS,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.ICE_FANG, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Black art: Redux forms",
    description:
      "#349 Black art now covers ER CUSTOM (Redux) forms too - 4,053 generated\n"
      + "slug atlases. Your Bellsprout-Redux is a BLACK SHINY.\n"
      + "DO: look at its in-battle BACK sprite, then open the summary (FRONT).\n"
      + "EXPECT: REAL black smoke-halo art of the REDUX form on both sides - not\n"
      + "a flat dark tint, and not the base Bellsprout's art - and it is black\n"
      + "from the FIRST frame (no delayed swap).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 10,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.BELLSPROUT,
      });
      return [
        makeStarter(SpeciesId.BELLSPROUT, {
          formIndex: formIndexByKey(SpeciesId.BELLSPROUT, "redux"),
          moveset: [MoveId.VINE_WHIP, MoveId.RAZOR_LEAF, MoveId.GROWTH, MoveId.SLEEP_POWDER],
        }),
      ];
    },
  },
  {
    label: "Black Gardevoir (screenshot)",
    description:
      "#349 - showcase scenario for screenshots. The wild Gardevoir is a\n"
      + "BLACK SHINY with real smoke-halo art, black from the first frame,\n"
      + "standing at normal height. It only uses Splash; take your time\n"
      + "framing the shot.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GARDEVOIR,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ER_BLACK_SHINY_ENEMY_OVERRIDE: SpeciesId.GARDEVOIR,
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Move spec batch (#386)",
    description:
      "#386 community move batch. Your Enamorus carries the reworked moves.\n"
      + "DO: check the fight panel stats, then USE each move twice.\n"
      + "EXPECT: Razor Wind 70 BP, NO charge turn, super effective vs Rock\n"
      + "(the foe is Golem). Springtide Storm sets misty terrain on the first\n"
      + "use and DOES NOT FAIL on the second (it used to). Steel Roller works\n"
      + "with no terrain and clears one when present. Synchronoise hits the\n"
      + "Golem (and runs as the user's SECOND type). ALSO: no move anywhere\n"
      + "shows more than 20 PP now.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GOLEM,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ENAMORUS, {
          moveset: [MoveId.SPRINGTIDE_STORM, MoveId.RAZOR_WIND, MoveId.STEEL_ROLLER, MoveId.SYNCHRONOISE],
        }),
      ];
    },
  },
  {
    label: "Wishmaker heals SELF (#412)",
    description:
      "#412 WISHMAKER - the on-entry Wish used to land on the OPPONENT and\n"
      + "heal THEM. Your Dragonite (Wishmaker) enters hurt vs a Chansey.\n"
      + "DO: stall a turn (Protect) and watch the end of the NEXT turn.\n"
      + "EXPECT: the Wish heal lands on YOUR Dragonite (big HP jump), never\n"
      + "on the enemy.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: ErAbilityId.WISHMAKER as unknown as AbilityId,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.DRAGONITE, {
          moveset: [MoveId.PROTECT, MoveId.DRAGON_CLAW, MoveId.ROOST, MoveId.SPLASH],
        }),
      ];
    },
    onBattleStart: () => {
      const p = globalScene.getPlayerPokemon();
      if (p) {
        p.hp = Math.floor(p.getMaxHp() / 4);
      }
    },
  },
  {
    label: "Two Step dance rider (#413)",
    description:
      "#413 TWO STEP - the Revelation Dance follow-up after a dance move\n"
      + "used to SELF-HIT the dancer when the dance was a self-buff.\n"
      + "DO: use QUIVER DANCE with your Oricorio (Two Step).\n"
      + "EXPECT: the 50 BP Revelation Dance fires INTO the enemy Snorlax -\n"
      + "your dancer never damages itself. Same for Victory Dance.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: ErAbilityId.TWO_STEP as unknown as AbilityId,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.ORICORIO, {
          moveset: [MoveId.QUIVER_DANCE, MoveId.REVELATION_DANCE, MoveId.AIR_SLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Flash hits BOTH foes (#415)",
    description:
      "#415 FLASH - it is multi-target in ER but hit only ONE foe here.\n"
      + "Doubles vs two Snorlax. DO: use FLASH.\n"
      + "EXPECT: BOTH enemies take damage from the single Flash (60 BP\n"
      + "Electric, 50% chance to drop Atk on each).\n"
      + "ALSO CHECK: open High Jump Kick's move info - the description\n"
      + "must now mention its Striker boost (same for punch/bite/slice\n"
      + "moves and their Iron Fist / Strong Jaw / Keen Edge notes).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        BATTLE_STYLE_OVERRIDE: "double",
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.FLASH, MoveId.THUNDERBOLT, MoveId.HIGH_JUMP_KICK, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.RAICHU, {
          moveset: [MoveId.FLASH, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Locked innate must stay OFF (#425)",
    description:
      "#425 - a LOCKED Overwhelm innate let Dragon moves hit Fairies.\n"
      + "Zekrom (Overwhelm NOT unlocked) vs Clefable.\n"
      + "DO: use Dragon Claw on Clefable.\n"
      + "EXPECT: 'It doesn't affect...' - NO damage. Fairy stays immune\n"
      + "to Dragon until Overwhelm is actually unlocked and enabled.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 20,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CLEFABLE,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ZEKROM, {
          moveset: [MoveId.DRAGON_CLAW, MoveId.THUNDERBOLT, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Wildbolt Storm: no miss in rain (#426)",
    description:
      "#426 report said Wildbolt Storm always misses in rain - it\n"
      + "verifies CORRECT here, so please confirm in-game.\n"
      + "DO: use Wildbolt Storm repeatedly (it sets rain itself).\n"
      + "EXPECT: once rain is up it NEVER misses (90% accuracy without\n"
      + "rain). If you ever see a miss IN RAIN, press Fail + Send Logs.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ZEKROM, {
          moveset: [MoveId.WILDBOLT_STORM, MoveId.THUNDERBOLT, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Infatuation: ER stat cut (#427)",
    description:
      "#427 - ER infatuation replaces vanilla's 50% immobilize: the\n"
      + "infatuated mon ALWAYS acts but its Atk AND Sp.Atk are HALVED.\n"
      + "Your male Snorlax vs female Lopunny (Cute Charm).\n"
      + "DO: poke it with Tackle until Cute Charm infatuates you, note\n"
      + "Tackle's damage before vs after (about half), and confirm you\n"
      + "are NEVER 'immobilized by love' across many turns.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.LOPUNNY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_ABILITY_OVERRIDE: AbilityId.CUTE_CHARM,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.HYPER_VOICE, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Power of Alchemy: transmute (#429)",
    description:
      "#429 - ER Power of Alchemy transmutes opposing Berries on entry\n"
      + "(it had vanilla's copy-fainted-ally effect with the ER text).\n"
      + "Your Alolan Muk (Power of Alchemy) vs Snorlax holding berries.\n"
      + "DO: just enter the battle. EXPECT a 'transmuted ... Berries away'\n"
      + "message and the Snorlax has NO berries left (it never heals via\n"
      + "Sitrus). ALSO check the ability description reads the ER text.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ABILITY_OVERRIDE: AbilityId.POWER_OF_ALCHEMY,
      });
      return [
        makeStarter(SpeciesId.ALOLA_MUK, {
          moveset: [MoveId.TACKLE, MoveId.SLUDGE_BOMB, MoveId.SPLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Ogerpon Cornerstone audit (#391)",
    description:
      "#391 - Cornerstone Ogerpon full check (old report: dead Rockhard\n"
      + "Will innate + Ivy Cudgel not type-shifting; both verified fixed).\n"
      + "DO: open Ivy Cudgel's move info - EXPECT it reads ROCK type on\n"
      + "this form (Water/Fire on the other masks). Open the abilities\n"
      + "panel - EXPECT Rockhard Will listed as an innate. Use Power Gem\n"
      + "or Ivy Cudgel and sanity-check the Rock boost feels ~1.2x.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        STARTER_FORM_OVERRIDES: { [SpeciesId.OGERPON]: 3 },
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.OGERPON, {
          moveset: [MoveId.IVY_CUDGEL, MoveId.POWER_GEM, MoveId.LEAFAGE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Cloud push warn (#389)",
    description:
      "#389 - Save and Quit force-pushes the FULL save (system + session)\n"
      + "to the cloud, bypassing the sync throttle. NEW: if that push fails\n"
      + "(server down, offline), a warning appears BEFORE quitting telling\n"
      + "you the save is on this device only. CHECK: while logged in, use\n"
      + "Save and Quit normally (no warning, run reappears on another\n"
      + "browser); then disconnect your network and Save and Quit again -\n"
      + "the local-only warning must appear.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Fainted lead not 'ineligible for challenge'",
    description:
      "Bugfix (hard to stage in one battle). When an on-field player mon can't\n"
      + "legally be there, turn-init switches it out. The gate is isAllowedInBattle()\n"
      + "= !isFainted() && isAllowedInChallenge(), so a mon that merely FAINTED also\n"
      + "tripped it - and was wrongly announced as 'changed into an ineligible Pokemon\n"
      + "for this challenge!' (reported: a fainted Scyther Redux on the field, with NO\n"
      + "challenge active - ER difficulty tiers like Elite are not challenges). FIX:\n"
      + "that challenge-worded message now shows ONLY when the mon is genuinely illegal\n"
      + "under a challenge (!isAllowedInChallenge()); a fainted lead is switched out\n"
      + "silently. CHECK: if you ever see 'ineligible ... for this challenge' when a mon\n"
      + "simply fainted (and you are not in a Mono-Gen/Type/Color challenge), that is\n"
      + "the regression - it must never appear.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SCYTHER, {
          moveset: [MoveId.X_SCISSOR, MoveId.AERIAL_ACE, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Save loss on refresh/Continue",
    description:
      "Save-loss fix (not battle-testable). Runs were vanishing on refresh and\n"
      + "'Continue' was wiping the other slots. Cause: on load, initSystem compared\n"
      + "the SYSTEM-save timestamp and, when the server's was >= local (every normal\n"
      + "load), it called clearLocalData() which DELETED ALL 5 SESSION SLOTS. A run\n"
      + "that hadn't synced yet was lost. Now session slots are preserved (local wins\n"
      + "over not-yet-synced remote). CHECK (logged in, not Guest): start a run, get a\n"
      + "few waves in, then REFRESH the page quickly (before/without a cloud sync) -\n"
      + "the run must still be there. With multiple saved slots, use Continue and\n"
      + "confirm the OTHER slots are NOT wiped. Regression-covered by the\n"
      + "game-data.test.ts 'local session preservation' test.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.EEVEE, {
          moveset: [MoveId.SWIFT, MoveId.QUICK_ATTACK, MoveId.BITE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Mega forms share their base's candy",
    description:
      "Candy-pooling fix (dex/UI, not battle-testable). An ER custom Mega (e.g. Flygon\n"
      + "Redux B Mega) is a battle FORM of its base, but it was built as a standalone\n"
      + "species with no prevolution, so it kept its OWN candy bucket and showed a\n"
      + "SEPARATE candy count from Flygon Redux B. Now a mega-target id pools its candy /\n"
      + "passive / ability unlocks onto the base (getStarterDataEntry resolves mega->base;\n"
      + "consolidateStarterDataToRoots heals already-split saves to base = X+Y).\n"
      + "CHECK: in the Pokedex, the base and its Mega show the SAME candy count, and\n"
      + "spending candy on one is reflected on the other. Regression-covered by\n"
      + "er-mega-candy-merge.test.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.FLYGON, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.U_TURN, MoveId.ROOST],
        }),
      ];
    },
  },
  {
    label: "Biome Market preview (#440)",
    description:
      "#440 BIOME MARKET - x0 boss waves now OPEN A BESPOKE SHOP SCREEN (they\n"
      + "had none before - vanilla skips the item screen on boss waves). After\n"
      + "the wave-10 boss + reward popups, the MARKET opens: a full-screen BW\n"
      + "backdrop with a biome shopkeeper on the LEFT and a '<BIOME> MARKET'\n"
      + "banner up top - clearly NOT the vanilla potion shop. The priced row is\n"
      + "the biome's signature items + discounted-category picks + a wildcard.\n"
      + "NO healing items appear (healing stays the normal-wave shop's job).\n"
      + "DO: win this wave-10 fight, wait through the reward popups. EXPECT:\n"
      + "the market opens with the BW art; buy items REPEATEDLY - each buy\n"
      + "deducts money + applies the item and the shop STAYS OPEN (buy as much\n"
      + "as you can afford). Press B/Cancel to LEAVE: a Yes/No confirm now asks\n"
      + "'Are you sure you want to leave the market?' (so a stray Cancel does\n"
      + "not skip the shop). Pick No to return to the market; pick Yes to\n"
      + "continue to biome-select. The Abyss biome has NO market by design.\n"
      + "REGRESSION: the normal reward/shop screen must NOT list the market's\n"
      + "items - they used to leak into the vanilla shop row and be re-bought\n"
      + "unlimited times. Now only the dedicated market shows them.\n"
      + "#504: the market fires every 10 GLOBAL waves even INSIDE a long biome\n"
      + "(not only at the biome boundary), and it NEVER shows healing items no\n"
      + "matter which wave it opens on (the old bug fell through to the vanilla\n"
      + "potion row when it fired off a non-x0 boundary wave). You ALSO get a\n"
      + "full party HEAL on every 10th wave (mid-biome x0 waves heal here; biome-\n"
      + "change waves still heal on transition).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 10,
        STARTING_MONEY_OVERRIDE: 20000,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Curve/ghost/sprite (#419+)",
    description:
      "#419 - ELITE trainer mons now respect a per-wave BST ceiling (420 at\n"
      + "w1-20 up to 600 at w81-100, +40 on boss waves; legends banned before\n"
      + "w80). Violators devolve a stage or swap. CHECK: early Elite trainer\n"
      + "teams field basic/mid-stage mons, no wave-20 Kyogre. Hell unchanged.\n"
      + "#422 - new challenge GHOST TRAINERS (7 Favour): every trainer wave\n"
      + "is a ghost team when the pool has one, else a normal trainer.\n"
      + "#436 - wave 5 (the fixed Youngster/Lass battle) is now ALSO a ghost\n"
      + "in the challenge. CHECK: start a Ghost Trainers run, the wave-5\n"
      + "trainer is a ghost (player name + ghost music), not a Youngster.\n"
      + "#422-fix - past wave 50, ghost teams are FULLY EVOLVED (a deep team\n"
      + "drawn for a high wave is re-levelled down, never devolved). Only the\n"
      + "EARLY challenge trainer waves (<50) still devolve for fairness; the\n"
      + "scheduled ghost waves (hell 63+, elite 87+) all stay evolved. CHECK:\n"
      + "in a Ghost Trainers run, ghosts at wave 63/87/137 show final evolved\n"
      + "forms, NOT babies/base forms (the unevolved-ghost bug).\n"
      + "#421 - wrong-sprite self-heal: if a Pokemon atlas key is requested\n"
      + "with a different path than it loaded with, the texture reloads and\n"
      + "a [er-atlas] warning is logged - if you SEE a wrong sprite (mega art\n"
      + "on a base mon), press Send Logs so we capture the culprit trace.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Wishiwashi Schooling form (#451)",
    description:
      "#451 - Schooling is a HP-gated FORM change (not an evolution): with the\n"
      + "Schooling ability and level >= 20, Wishiwashi is in School (big) form\n"
      + "above 1/4 HP and reverts to Solo form at or below 1/4 HP. CHECK: this\n"
      + "Wishiwashi (Lv30) starts in School form; chip it below 1/4 HP and it\n"
      + "should shrink back to Solo, then return to School when healed above 1/4.\n"
      + "If it stays stuck in School form, report it (Send Logs).",
    setup: () => {
      resetDevOverrides();
      O.STARTING_LEVEL_OVERRIDE = 30;
      O.ABILITY_OVERRIDE = AbilityId.SCHOOLING;
      return [
        makeStarter(SpeciesId.WISHIWASHI, {
          moveset: [MoveId.WATER_GUN, MoveId.TAKE_DOWN, MoveId.PROTECT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Grappler trap 1/6 HP (#454)",
    description:
      "#454 - Grappler (ER 523) trapping moves now deal 1/6 max HP per turn\n"
      + "(was 1/8) and last 6 turns. CHECK: this Snorlax has Grappler + Wrap;\n"
      + "use Wrap on the foe and watch the end-of-turn chip - it should take\n"
      + "~16.7% of the foe's max HP each turn, not ~12.5%.",
    setup: () => {
      resetDevOverrides();
      O.ABILITY_OVERRIDE = erAbility(523); // Grappler
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.WRAP, MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "(note) Enemy vitamins mirror your stacking",
    description:
      "ER anti-stack: in EVERY trainer battle, the trainer's single HIGHEST-BST\n"
      + "mon now gets the same number of vitamins (base-stat boosters) as the MOST\n"
      + "you have piled onto any ONE of your own mons, randomly spread across its\n"
      + "stats. Stack 15 vitamins on one lead and every enemy ace also gets 15.\n"
      + "It reads your live vitamins, so it is nothing early and grows over the run;\n"
      + "spread them thin and the effect shrinks. CHECK: pile several vitamins\n"
      + "(Protein/Iron/Calcium/...) onto one mon, then fight any trainer - their\n"
      + "strongest mon should be noticeably tankier/stronger than its level implies.\n"
      + "Unit-tested in test/tests/elite-redux/er-trainer-vitamins.test.ts.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Biome-leave heals only every 10 waves",
    description:
      "Full-heal cadence fix. The biome REST (full heal) is supposed to be every 10\n"
      + "GLOBAL waves, but with the World Map's variable biome length / Crossroads a\n"
      + "biome can END off the 10-wave boundary - and SelectBiomePhase was healing on\n"
      + "EVERY biome leave, so you got a free full-heal 'just for leaving the biome'.\n"
      + "Now the heal only fires on the every-10 tick (mid-biome x0 waves heal via\n"
      + "VictoryPhase; biome-ending x0 waves heal here; off-cadence biome leaves do\n"
      + "NOT). CHECK (classic run, World Map on): leave a biome OFF a x0 wave (Crossroads\n"
      + "'Move on', or a biome that ends short) - party HP is NOT restored. On x0 waves\n"
      + "(every 10) the party still fully heals. Before the fix, leaving any biome healed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 30 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) New biome sets its weather/terrain (World Map)",
    description:
      "World-Map biome-entry fix. On every World Map biome change the new biome's\n"
      + "weather + terrain (and the arena-effect reset) were SKIPPED, because the\n"
      + "encounter that starts the new biome ran as NextEncounterPhase (same-biome)\n"
      + "instead of NewBiomeEncounterPhase. Cause: isNewBiome is stateful under the\n"
      + "World Map, and SwitchBiomePhase rolled the new biome's structure forward\n"
      + "BEFORE isNewBiome was consulted to pick the encounter phase, so it read the\n"
      + "cleared wave as 'mid-biome'. Reported as 'Beach didn't trigger the harsh\n"
      + "sunlight'. CHECK (classic run, World Map on): travel into a biome with a\n"
      + "signature weather/terrain - Desert/Badlands (sandstorm), Ice Cave (snow),\n"
      + "Graveyard (fog), Beach/Island (a chance of sun), Power Plant (Electric\n"
      + "Terrain) - the weather/terrain must appear on the FIRST wave of that biome.\n"
      + "Before the fix, the new biome opened with whatever weather carried over (or\n"
      + "none). Hatch/entry-effect abilities (Drought etc.) still set their own.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 30 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Reactive items show holder icon",
    description:
      "Held-item icon fix. The 5 reactive items (Cell Battery, Absorb Bulb, Snowball,\n"
      + "Luminous Moss, Weakness Policy) are standalone er-assets textures, not in the\n"
      + "items atlas. Their held-item bar entry rendered ONLY the item sprite with NO\n"
      + "holder Pokemon icon, so you couldn't tell WHICH mon held it (esp. enemy-held) -\n"
      + "the same bug the gems/seeds had. getIcon now draws the holder's Pokemon icon +\n"
      + "the standalone sprite, matching the gems/seeds. CHECK: face/spawn an enemy (or\n"
      + "a player mon) holding a reactive item - the item-bar icon shows the holder's\n"
      + "Pokemon icon on the left, then the item sprite (not a bare/blank item).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 5, STARTING_LEVEL_OVERRIDE: 30 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Youngster innates show unlocked",
    description:
      "Display fix. On Youngster, innate slots are temp-unlocked by level (1/15/24),\n"
      + "and the in-battle innate panel showed them unlocked - but the SUMMARY screen's\n"
      + "Abilities page still showed 'Innate (Locked - unlock with candy)' because it\n"
      + "only checked the candy bitmask, ignoring the Youngster/Daily/Innate-Shrine/\n"
      + "TRUANT free-slot rules (the report: 'all 4 unlocked on Youngster but don't show\n"
      + "as unlocked'). The summary now mirrors the battle panel. (Run difficulty itself\n"
      + "already persists across reload via the session save - that part was not the\n"
      + "bug.) CHECK on a YOUNGSTER run: open a mon's summary -> Abilities page; its\n"
      + "level-unlocked innates show UNLOCKED (no candy-lock icon), matching the battle\n"
      + "innate panel. Also verify the same mon's panel in battle agrees.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("youngster");
      setOverrides({ STARTING_LEVEL_OVERRIDE: 30, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Blast Burn: can act next turn (no recharge)",
    description:
      "ER dex: Blast Burn / Hydro Cannon / Frenzy Plant / Prismatic Laser 'can't be\n"
      + "used next turn' - the MOVE locks for a turn but the user STILL ACTS (Gigaton\n"
      + "Hammer model), NOT the vanilla recharge that makes you 'rest'. (Hyper Beam /\n"
      + "Giga Impact / Rock Wrecker / Eternabeam DO rest - dex 'leaves the user\n"
      + "immobile'.) DO: use Blast Burn turn 1; turn 2 you get the move menu - Blast Burn\n"
      + "itself is unselectable (greyed), but you can pick Flamethrower. EXPECT: no\n"
      + "forced 'must recharge' turn. Before the fix Blast Burn made you rest.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.BLAST_BURN, MoveId.FLAMETHROWER],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.BLAST_BURN, MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Decorate: damages + raises Atk/SpAtk/Crit",
    description:
      "ER Decorate (dex #705): 'Damages foes. Raises allies' Attack, Special Attack,\n"
      + "and Crit by 2 stages.' Bug: the patch damaged the foe and raised Atk/SpAtk but\n"
      + "was MISSING the +2 crit-stage boost (and the contact flag). DO: use Decorate on\n"
      + "the enemy. EXPECT: it DAMAGES the foe (80 BP Special Fairy) AND raises your\n"
      + "Atk +2, SpAtk +2, and crit stage +2 (a 'getting pumped'/crit-up message), and\n"
      + "it makes contact. Before the fix there was no crit boost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.DECORATE, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ALCREMIE, {
          moveset: [MoveId.DECORATE, MoveId.DAZZLING_GLEAM, MoveId.RECOVER, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Steel Roller works with NO terrain",
    description:
      "ER Steel Roller is usable WITHOUT terrain (it still clears one when present) -\n"
      + "dex: 'Rolls over the opponent while destroying terrain'. Bug: it still failed\n"
      + "off-terrain like the base game. Cause: the vanilla 'fails unless terrain'\n"
      + "condition is at sequence 3 (conditionsSeq3), but the ER patch only cleared the\n"
      + "default conditions (seq 4). DO: turn 1 (no terrain is active), use Steel Roller\n"
      + "on the enemy. EXPECT: it CONNECTS and deals damage (no 'But it failed!').\n"
      + "Before the fix it failed because no terrain was up.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.STEEL_ROLLER, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.STEELIX, {
          moveset: [MoveId.STEEL_ROLLER, MoveId.SPLASH, MoveId.IRON_HEAD, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Ability Capsule cycles 1->2->Hidden (repeatable)",
    description:
      "ER Ability Capsule fix. It cycles a mon's ACTIVE ability through its legal\n"
      + "abilities (1 -> 2 -> hidden -> 1), as the description says. Bug: it was\n"
      + "single-use PER MON - after one use it said 'It won't have an effect', so you\n"
      + "could never reach the hidden ability ('only works the first time'). Now it is\n"
      + "REPEATABLE (each use is one consumed capsule). DO: win the opening battle, then\n"
      + "in the shop use BOTH Ability Capsules on Snorlax, one after the other. EXPECT:\n"
      + "the FIRST advances its ability (e.g. Immunity -> Thick Fat) and the SECOND\n"
      + "advances again (-> Gluttony/hidden), never 'won't have an effect'.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 40, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
    // Two capsules so the tester can use both on the same mon and confirm it does
    // NOT lock after the first (the reported bug).
    shopItems: [modifierTypes.ER_ABILITY_CAPSULE, modifierTypes.ER_ABILITY_CAPSULE],
  },
  {
    label: "(note) Locked Battle Bond does nothing",
    description:
      "Battle Bond gating fix. Reported: a LOCKED Battle Bond innate still fired on\n"
      + "a KO - it form-changed / applied its Atk+SpA+Spe stat boost even though the\n"
      + "innate wasn't unlocked (e.g. Lv8, no candy, non-Youngster). Cause: Battle\n"
      + "Bond carries form-change-driver attrs, and the 'form-change innates are never\n"
      + "gated' exemption was per-ABILITY, so the whole ability (boost included)\n"
      + "bypassed the unlock lock. Fix: Battle Bond is treated as a power spike, NOT\n"
      + "passive identity (unlike Forecast/Stance Change), so it gates like any innate.\n"
      + "CHECK (Elite/Hell, where innate slots are candy-locked): a mon with Battle\n"
      + "Bond in a LOCKED innate slot KOs a foe -> NOTHING happens (no form change, no\n"
      + "stat boost). Once the slot is unlocked (candy / Innate Shrine), the form (if a\n"
      + "path exists) or the boost fires normally. Battle Bond as a mon's MAIN ability\n"
      + "is unaffected (only innate-slot Battle Bond is gated).",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("elite");
      return [
        makeStarter(SpeciesId.GRENINJA, {
          moveset: [MoveId.WATER_SHURIKEN, MoveId.DARK_PULSE, MoveId.ICE_BEAM, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Granted ability sticks on a Mega",
    description:
      "Ability-grant on mega fix. Reported: the Clowning Around ME granted Drought,\n"
      + "but adding it to a Mega Chandelure did nothing - the mega kept its native\n"
      + "ability (Oblivious). Cause: the grant wrote customPokemonData.ability but not\n"
      + "abilityOverridesForm, and mega/G-max forms DERIVE their ability from the form\n"
      + "data, shadowing the grant. Fix: applyAbilityOverrideToPokemon now sets\n"
      + "abilityOverridesForm when the mon uses form-derived abilities (mirrors the\n"
      + "Ability Randomizer). CHECK: run Clowning Around, grant an ability to a mon,\n"
      + "then mega it (or grant it to an already-mega'd mon) - the GRANTED ability must\n"
      + "show on the summary and actually work in battle, not the mega's default.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.CHANDELURE, {
          moveset: [MoveId.SHADOW_BALL, MoveId.FLAMETHROWER, MoveId.ENERGY_BALL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Priority abilities only filtered moves (#outspeed)",
    description:
      "Random-outspeed fix. Cutthroat(743)/Edgelord(882)/Galeforce Wings(923) were\n"
      + "mis-classified as a BARE priority and gave +1 priority to EVERY move - the mon\n"
      + "moved first with anything (the 'faster mon outsped / Hydro Pump moves first'\n"
      + "reports). Each is now filtered to its move type/flag. CHECK: this Pidgeot has\n"
      + "Galeforce Wings (Flying moves +1 priority) and is SLOWER than the foe Jolteon.\n"
      + "Use AIR SLASH (Flying) -> Pidgeot moves FIRST (priority). Use SWIFT (Normal) ->\n"
      + "the faster Jolteon moves first. Before the fix BOTH moved first.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(923), // Galeforce Wings
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.AIR_SLASH, MoveId.SWIFT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.JOLTEON,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.THUNDERBOLT],
      });
      return [
        makeStarter(SpeciesId.PIDGEOT, {
          moveset: [MoveId.AIR_SLASH, MoveId.SWIFT, MoveId.ROOST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Restraining Order force-out (#452)",
    description:
      "#452 - Restraining Order (Gooschase sig, ER ability 690) + Chuckster\n"
      + "(864) now force the ATTACKER out when the holder is hit, once per\n"
      + "switch-in - NOT the holder (the old wire acted like Wimp Out). CHECK:\n"
      + "this Snorlax has Restraining Order; vs a TRAINER (has back-up mons),\n"
      + "let the foe hit you - the ATTACKER should be dragged out, you stay in.\n"
      + "It fires only once per send-out.",
    setup: () => {
      resetDevOverrides();
      O.ABILITY_OVERRIDE = erAbility(690); // Restraining Order
      O.STARTING_WAVE_OVERRIDE = 5; // a trainer battle (foe has switch targets)
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Ability Capsule + evo (#445)",
    description:
      "#445 - Ability Capsule no longer leaves a wasted active ability that\n"
      + "duplicates an innate after evolution. If the capsule-set active ability\n"
      + "becomes an innate on the evolved form, it is dropped (active re-derives\n"
      + "to a distinct ability, innate kept) and the capsule re-arms so you can\n"
      + "re-pick. CHECK: capsule a pre-evo to an ability its evolved form has as\n"
      + "an INNATE, evolve - the active should change (not double the innate) and\n"
      + "the capsule should be usable again on the evolved mon.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Ability-boost move flags (#449/#453)",
    description:
      "#449/#453 - move flags now derive from the ER 2.65 dex 'X boost' text\n"
      + "(authoritative), fixing moves that shipped with no flags. Affects ALL\n"
      + "ability-boost families: Keen Edge (slicing, e.g. Dire Claw), Mega\n"
      + "Launcher (pulse), Iron Fist (punch), Strong Jaw (bite), Mighty Horn,\n"
      + "Striker (kick), Archer (arrow). CHECK: Dire Claw + Sweeping Edge/\n"
      + "Sharpness never-miss + 1.5x; a Mega Launcher / Iron Fist / Strong Jaw\n"
      + "mon now boosts the right moves. Kicks use Roundhouse, not Sweeping Edge.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER Wind Rider higher atk (#496)",
    description:
      "#496 - ER Wind Rider raises whichever ATTACKING stat is higher (Atk vs\n"
      + "SpAtk), not always physical Attack. Player Gardevoir (SpAtk >> Atk) has\n"
      + "Wind Rider forced; the enemy spams Gust (a wind move).\n"
      + "EXPECT: Gust is absorbed (no damage) and Gardevoir's SP. ATK rises +1 each\n"
      + "time (NOT its Attack). Also applies to the Tailwind-on-entry boost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: AbilityId.WIND_RIDER,
        ENEMY_MOVESET_OVERRIDE: [MoveId.GUST],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.PIDGEOT,
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.MOONBLAST, MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER Accelerate instant charge (#449)",
    description:
      "#449 - ER Accelerate ('Moves that need a charge turn are now used instantly')\n"
      + "now actually skips the charge turn (was a no-op). Player has Accelerate forced\n"
      + "and Solar Beam + Fly in its moveset.\n"
      + "EXPECT: Solar Beam and Fly both fire the SAME turn (no charge/semi-invuln turn),\n"
      + "every time, with no item needed (same skip Power Herb does).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.ACCELERATE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SOLAR_BEAM, MoveId.FLY, MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN],
        }),
      ];
    },
  },
  {
    label: "ER Aegislash stance swap (#480)",
    description:
      "#480 - Redux Aegislash's Stance Change is an INNATE (not the active ability),\n"
      + "which was being candy/level gated, so the form never switched ('stuck'). It\n"
      + "is now treated as a form-change driver, so the swap is never locked out, and\n"
      + "it swaps by MOVE CATEGORY per the 2.65 dex: physical -> Axe ('blade' form),\n"
      + "special / King's Shield / switch-out -> Bow ('shield' form).\n"
      + "Aegislash here is a FRESH starter (Stance Change innate NOT unlocked).\n"
      + "EXPECT: starts as Bow (shield). Iron Head (physical) -> switches to Axe (blade)\n"
      + "sprite. Shadow Ball (special) -> back to Bow. King's Shield -> Bow. Every time.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
      });
      return [
        makeStarter(SpeciesId.AEGISLASH, {
          moveset: [MoveId.IRON_HEAD, MoveId.SHADOW_BALL, MoveId.KINGS_SHIELD, MoveId.SACRED_SWORD],
        }),
      ];
    },
  },
  {
    label: "ER Cloud Nine clears weather (#450)",
    description:
      "#450 - per the 2.65 dex, ER Cloud Nine CLEARS all weather on switch-in (not\n"
      + "just nullifies its effects like vanilla). Both player mons have Cloud Nine\n"
      + "forced; the enemy has Drizzle (sets Rain on entry).\n"
      + "EXPECT: the Rain weather indicator is CLEARED entirely (gone, not just 'no\n"
      + "effect'). Switch your other Cloud Nine mon in - if Rain was re-set it is\n"
      + "cleared again on entry. Any weather set while a Cloud Nine mon is out also\n"
      + "gives NO damage boost / ability triggers (suppressed).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: AbilityId.CLOUD_NINE,
        ENEMY_ABILITY_OVERRIDE: AbilityId.DRIZZLE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.PELIPPER,
      });
      return [
        makeStarter(SpeciesId.GOLDUCK, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.LICKILICKY, {
          moveset: [MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "ER Castform Foggy form (#450)",
    description:
      "#450 - ER added Fog as a real weather and a matching Foggy (Ghost-type)\n"
      + "Castform form. Forecast Castform is forced; the battle starts in Fog.\n"
      + "EXPECT: Castform takes its FOGGY form (Ghost type, the castform_foggy ER\n"
      + "sprite - not Normal form, not a placeholder). Use Sunny Day -> Sunny (Fire)\n"
      + "form; Rain Dance -> Rainy (Water); back to fog (e.g. via a fog setter or\n"
      + "switch) -> Foggy again. Reverts to Normal when weather clears / on switch-out.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        WEATHER_OVERRIDE: WeatherType.FOG,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
      });
      return [
        makeStarter(SpeciesId.CASTFORM, {
          moveset: [MoveId.WEATHER_BALL, MoveId.SUNNY_DAY, MoveId.RAIN_DANCE, MoveId.SHADOW_BALL],
        }),
      ];
    },
  },
  {
    label: "ER Raging Storm in rain (#452)",
    description:
      "#452 - Primal Kyogre's Raging Storm: 'Ups highest attacking stat by 1.5x in\n"
      + "rain.' Kyogre (SpAtk >> Atk) has Raging Storm forced; battle starts in Rain.\n"
      + "EXPECT: its SP. ATK is multiplied 1.5x while it's raining (special moves hit\n"
      + "~50% harder); in clear weather, no boost. Picks whichever attack stat is\n"
      + "higher, so it boosts SP. ATK here (not Attack).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.RAGING_STORM),
        WEATHER_OVERRIDE: WeatherType.RAIN,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
      });
      return [
        makeStarter(SpeciesId.KYOGRE, {
          moveset: [MoveId.ORIGIN_PULSE, MoveId.ICE_BEAM, MoveId.THUNDER, MoveId.CALM_MIND],
        }),
      ];
    },
  },
  {
    label: "ER Roar of Time rework (#452)",
    description:
      "#452 - Roar of Time is reworked per the 2.65 dex: 90 BP, 100 acc, 10 PP,\n"
      + "priority -6 (MOVES LAST), forces the target to switch, and NO recharge\n"
      + "(was vanilla 150 BP + recharge turn). Temporal Rupture is forced, so it ALSO\n"
      + "sets the target's ability to Slow Start on hit.\n"
      + "EXPECT: Dialga acts again next turn (no recharge), Roar of Time goes last,\n"
      + "and the target's ability becomes Slow Start. Best vs a multi-mon trainer to\n"
      + "see the forced switch.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.TEMPORAL_RUPTURE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
      });
      return [
        makeStarter(SpeciesId.DIALGA, {
          moveset: [MoveId.ROAR_OF_TIME, MoveId.FLASH_CANNON, MoveId.DRACO_METEOR, MoveId.CALM_MIND],
        }),
      ];
    },
  },
  {
    label: "ER Inverse Kecleon (#452)",
    description:
      "#452 - Kecleon's Inversion: 'Sets up Inverse Room on entry, lasts 3 turns.'\n"
      + "Inversion is forced on Kecleon.\n"
      + "EXPECT: on entry, Inverse Room is set (type chart inverted) for 3 turns -\n"
      + "normally-resisted/immune hits become super-effective and vice versa. Confirm\n"
      + "via a move that is normally weak/immune now landing super-effective.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.INVERSION),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
      });
      return [
        makeStarter(SpeciesId.KECLEON, {
          moveset: [MoveId.SHADOW_SNEAK, MoveId.POWER_UP_PUNCH, MoveId.SUCKER_PUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER Restraining Order / Gooschase (#452)",
    description:
      "#452 - Restraining Order (Gooschase line): 'Forces the ATTACKER out when hit,\n"
      + "once each switch-in' - NOT Wimp Out (which switches the holder out). Forced\n"
      + "on the player; the enemy is a multi-mon trainer that attacks.\n"
      + "EXPECT: when the holder is hit by a move, the ATTACKER (not the holder) is\n"
      + "forced to switch out, once per the holder's switch-in.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ABILITY_OVERRIDE: erAbility(ErAbilityId.RESTRAINING_ORDER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.CRUNCH],
        }),
      ];
    },
  },
  {
    label: "ER Smokescreen smoke field (#394)",
    description:
      "#394 - ER Smokescreen no longer lowers the target's accuracy. Instead it\n"
      + "'obscures the user's party in smoke for 5 turns, increasing evasiveness by\n"
      + "25%.' Use Smokescreen turn 1.\n"
      + "EXPECT: 'Smoke billowed across the field...' message; for the next 5 turns the\n"
      + "ENEMY's moves miss noticeably more often (your whole side has +25% evasion,\n"
      + "i.e. incoming accuracy x0.8). Switching in your other mon keeps the buff (it's\n"
      + "side-wide). After 5 turns 'The smoke cleared away.' and accuracy is normal.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
      });
      return [
        makeStarter(SpeciesId.KOFFING, {
          moveset: [MoveId.SMOKESCREEN, MoveId.SLUDGE_BOMB, MoveId.PROTECT, MoveId.PAIN_SPLIT],
        }),
        makeStarter(SpeciesId.PIDGEOT, {
          moveset: [MoveId.AIR_SLASH, MoveId.ROOST, MoveId.PROTECT, MoveId.HURRICANE],
        }),
      ];
    },
  },
  {
    label: "(note) No custom evo on vanilla (#479)",
    description:
      "#479 - on the PURE-VANILLA difficulties (Youngster / Ace) a wild vanilla\n"
      + "mon must never EVOLVE into its ER custom final stage. A high-wave wild\n"
      + "Kecleon was being substituted into the custom 'Kecleong' (cost 12).\n"
      + "Root cause: arena.randomSpecies' level-evolution substitution re-gated only\n"
      + "by BST, not by custom-id. Now: on a vanilla difficulty, a custom (id >=\n"
      + "10000) evolution is skipped and the vanilla stage is kept (Elite/Hell keep\n"
      + "custom evolutions). CHECK (no forced-spawn override exists - the override\n"
      + "bypasses the evo path): play a YOUNGSTER run to a high wave in a biome with\n"
      + "a Kecleon-line spawn and confirm NO ER custom ('Kecleong', any Redux/\n"
      + "paradox name) ever appears as a WILD; only vanilla mons spawn.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Ability screen crash (#443)",
    description:
      "#443 - the Pokemon Info / summary ABILITIES screen no longer hard-\n"
      + "crashes or renders garbled for edge-case mons (reported on a freshly-\n"
      + "evolved Gholdengo and on Bloodmoon Ursaluna). The render is now\n"
      + "guarded: a bad row is skipped and logged instead of killing the page.\n"
      + "CHECK: evolve a Gimmighoul to Gholdengo and open its abilities; open\n"
      + "Bloodmoon Ursaluna's abilities - both should display, not crash. If a\n"
      + "row is missing, press Send Logs so the underlying cause is captured.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Evo cancel freeze (#444)",
    description:
      "#444 - cancelling an evolution no longer freezes the game. The UI was\n"
      + "left stuck in the evolution scene when the player declined; it now\n"
      + "hands control back like a normal completed/failed evolution.\n"
      + "CHECK: bring an Eevee to a level where it can evolve (its branched-\n"
      + "evolution PICK list appears post-battle), choose Cancel - you should\n"
      + "return to the field/party normally, not a black screen. Same for\n"
      + "pressing B to stop any single-path evolution mid-animation.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.EEVEE, {
          moveset: [MoveId.QUICK_ATTACK, MoveId.BITE, MoveId.SWIFT, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Event intro sprites (#490)",
    description:
      "#490 - ER mystery events no longer all reuse the blue chest sprite for\n"
      + "their intro art. Each now shows a thematic Pokemon: e.g. Fairy's Boon =\n"
      + "Clefable, Still Waters = Milotic, Glittering Vein = Carbink, Abyssal\n"
      + "Vent = Lanturn, Overgrown Temple = Cradily, Tide Pools = Corsola, Lake\n"
      + "Spirit = Uxie, Observatory = Lunatone, Echo Chamber = Noibat, Informant\n"
      + "= Nickit, The Storm = Pelipper, Ultra Wormhole = Cosmog, Sunken Vessel\n"
      + "= Dhelmise, X Marks the Spot = Gimmighoul, Aurora = Cryogonal, etc.\n"
      + "CHECK: trigger these ER events (delve/map/blessing events) - the intro\n"
      + "should be the themed mon, not the generic chest. (The Exotic Trader and\n"
      + "Black Market keep theirs until their shop rework lands.)",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Unown egg hatch (#442)",
    description:
      "#442 - Unown REVELATION (the battle-only school form) no longer\n"
      + "hatches from eggs or appears as a wild Unown's resting form. The\n"
      + "form is only reachable in battle via the Revelation ability.\n"
      + "CHECK: hatch Unown eggs / catch wild Unown - always a letter form\n"
      + "(A-Z, ! or ?), never the big multi-Unown school sprite. Already-\n"
      + "hatched Revelation Unown from before the fix are unaffected.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Delve ward/berry finds (#491)",
    description:
      "#491 - the delve press-your-luck events (Abyssal Vent, Glittering Vein,\n"
      + "Overgrown Temple) now turn up WARD STONES and RESIST BERRIES, with a\n"
      + "find chance that climbs DRASTICALLY the deeper you push. Shallow strikes\n"
      + "never yield them; deep strikes very often do (Ward Stone ~0/0/15/30/45/\n"
      + "60% by depth, tier Minor->Greater->Prime; resist berry ~0/12/24/38/52/\n"
      + "68%). Found items bank into the cash-in shop on RISE/PACK UP.\n"
      + "CHECK: dive these events deep (push 4+ levels) and bank - the reward\n"
      + "shop should include Ward Stones / resist berries far more often than a\n"
      + "shallow dive. They are lost on a party wipe like the rest of the haul.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Berry/Ward rates (#420)",
    description:
      "#420 - resist berry rolls doubled (Ace 5% / Elite 10% / Hell 20%)\n"
      + "and Ward Stone rolls doubled on Elite/Hell (boss Prime 20%/Greater\n"
      + "30%, regular Greater 10%/Minor 40%); Ace now gets a flat 5% Ward\n"
      + "Stone roll from wave 150. CHECK: steal from trainer mons past the\n"
      + "gates, drops should feel about twice as common.\n"
      + "#382 - the challenge screen Start bar now SHOWS the (L/R: last\n"
      + "setup) hint whenever a previous setup exists.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Mono Color challenge (#388)",
    description:
      "#388 - new challenge: MONO COLOR (5 Favour). Open Challenges and\n"
      + "pick a dex color (Red, Green, Blue, White, Brown, Yellow, Purple,\n"
      + "Pink, Gray, Black - the ROM's own color table). EXPECT: starter\n"
      + "select only allows Pokemon of that color, and a team member whose\n"
      + "evolution changes color becomes unusable in battle (like Mono\n"
      + "Type). Favour display should show +5.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Faster game speed (#416)",
    description:
      "#416 - two new speed tiers above Turbo: HYPER (7x) and LUDICROUS\n"
      + "(10x). Check in Settings > General > Game Speed, or cycle with the\n"
      + "speed-change hotkeys (plus/minus) mid-battle - the hotkeys now reach\n"
      + "the new tiers too. EXPECT: animations and text run much faster but\n"
      + "the MUSIC and sound pitch stay completely normal, and battles still\n"
      + "resolve cleanly at 10x (no skipped or stuck phases).",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) No Ace redux wilds (#421)",
    description:
      "#421 - wild spawns had a 1-in-8 chance to roll their REDUX form on\n"
      + "EVERY difficulty, so pure-vanilla Ace/Youngster met ER customs in\n"
      + "the wild. Now Elite/Hell only. CHECK: play early Ace waves - wild\n"
      + "mons must always be their normal vanilla form (Battle Info shows\n"
      + "vanilla abilities, not ER innates). On Elite/Hell redux forms still\n"
      + "appear in the wild.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) No mega transforms (#414)",
    description:
      "#414 - a wave-13 Weird Dream on Ace turned a party mon into a\n"
      + "permanent MEGA URSHIFU (the standalone ER mega species records\n"
      + "leaked into the transform and GTS trade pools). Not battle-testable\n"
      + "here - check by replaying Weird Dream / GTS encounters: results\n"
      + "must never be a Mega/Primal/battle-form species, and on Ace or\n"
      + "Youngster never an ER custom at all.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Egg declutter + RDX (#407)",
    description:
      "#407/#408/#409 - NOT a battle test, this entry tracks the checks.\n"
      + "DO: (1) hatch a bunch of eggs - NO Unown letters, Arceus types,\n"
      + "Pikachu caps, Furfrou trims, Therians, Castform weather forms etc\n"
      + "may hatch anymore (the vanilla mon covers those forms). (2) If you\n"
      + "owned a removed form SHINY, its shine (incl. red/black) now shows\n"
      + "on the VANILLA base in starter select, candies carried over. (3)\n"
      + "The RDX gen tab (starter select + Pokedex) lists EVERY ER custom\n"
      + "incl. convergents like Wispywaspy and the Iron series. (4) The\n"
      + "mono-gen challenge offers RDX. (5) Egg gacha: a 4th teal REDUX UP\n"
      + "machine pulls mostly ER customs; auto-restock offers it too.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Redux slot un-hijack (#410)",
    description:
      "#410 - NOT a battle test, this entry tracks the check.\n"
      + "DO: catch a Redux-form mon (e.g. Spearow Redux) in a run, then open\n"
      + "starter select. EXPECT: the catch shows up on the RDX tab entry,\n"
      + "NOT on the vanilla gen slot (gen 1 Spearow stays uncaught unless you\n"
      + "really caught a normal one). If your save was already hijacked, one\n"
      + "reload moves the unlock (shiny tiers + candies) to the RDX entry and\n"
      + "frees the vanilla slot. Pass/Fail once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Weedle Redux line (#411)",
    description:
      "#411 - NOT a battle test, this entry tracks the check.\n"
      + "DO: get a Weedle Redux (RDX tab / Redux Up gacha) and level it: 7\n"
      + "then 10. EXPECT: Weedle Redux -> Kakuna Redux -> Beedrill Redux (no\n"
      + "plain Beedrill). The Beedrill Redux learns ITS kit on level-up (Icicle\n"
      + "Spear etc.), not vanilla Beedrill moves. Same for the redux FORM\n"
      + "version caught in runs. Pass/Fail once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) RDX egg moves (#417)",
    description:
      "#417 - NOT a battle test, this entry tracks the check.\n"
      + "DO: in starter select, open the egg-move panel on RDX customs -\n"
      + "especially Flygon Redux B, Mimikyu Apex, Ribombee Redux,\n"
      + "Serena-Delphox and Weavile Redux. EXPECT: all four egg-move slots\n"
      + "show real, kit-appropriate moves (Mimikyu Apex rare = Dragon\n"
      + "Ascent; Ribombee Redux rare = Tail Glow) - no empty/??? slots on\n"
      + "any hatchable RDX mon. Pass/Fail once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Egg countdown (#378)",
    description:
      "#378 QoL - NOT a battle test, this entry just tracks the check.\n"
      + "DO: in a normal run, open the EGG LIST from the menu (and hatch one).\n"
      + "EXPECT: every egg's hatch text ends with the REAL number, e.g.\n"
      + "'(25 more waves to hatch.)' - no vague wording anywhere.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Daily innates (#379)",
    description:
      "#379 - NOT a battle test, this entry just tracks the check.\n"
      + "DO: start a DAILY run and open Battle Info -> Abilities (or the summary\n"
      + "ability page) on your mons.\n"
      + "EXPECT: ALL THREE innate slots are ACTIVE with no candy unlocks, their\n"
      + "effects work in combat, and after the daily ends your save's real\n"
      + "unlock state is unchanged (run-only).  Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Truant is free (#381)",
    description:
      "#381 - NOT a battle test, this entry just tracks the check.\n"
      + "DO: in STARTER SELECT, search ability text 'Truant' and inspect a mon\n"
      + "whose INNATE slot is Truant (Slakoth line is the classic case).\n"
      + "EXPECT: that slot shows unlocked AND enabled by default at ZERO candy\n"
      + "cost (it is a nerf, so it is free), and in battle the Truant innate is\n"
      + "live from turn 1.  Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.SLAKOTH, {
          moveset: [MoveId.SLACK_OFF, MoveId.BODY_SLAM, MoveId.SHADOW_CLAW, MoveId.YAWN],
        }),
      ];
    },
  },
  {
    label: "(note) Challenge reuse (#382)",
    description:
      "#382 QoL - NOT a battle test, this entry just tracks the check.\n"
      + "DO: on the CHALLENGE screen, set modifiers and start a run. Abandon,\n"
      + "return to the challenge screen and press ACTION to focus the bottom\n"
      + "bar (it is reachable even with NOTHING selected when a saved setup\n"
      + "exists). Press LEFT/RIGHT to switch it to 'Reuse Last Setup', confirm.\n"
      + "EXPECT: the exact last-used configuration is re-applied, every value\n"
      + "restored. The R hotkey from the list does the same.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Doubles Only (#383)",
    description:
      "#383 - NOT a battle test, this entry just tracks the check.\n"
      + "DO: start a challenge run with DOUBLES ONLY (grants 3 Favour) and play\n"
      + "past a few trainer waves.\n"
      + "EXPECT: EVERY trainer battle is a double battle; wild encounters keep\n"
      + "their normal single/double odds; the finale is unchanged.\n"
      + "ALSO (#385): trainers whose pool would send a SINGLE mon now field two\n"
      + "instead - the forced double used to FREEZE on the empty second slot.\n"
      + "Play through early trainer waves and EXPECT no freeze, ever.\n"
      + "ALSO (#400): KO BOTH enemy mons in the SAME turn (double KO) - this\n"
      + "used to HARD FREEZE when the trainer had only one reserve left.\n"
      + "EXPECT the lone replacement to come in (or the battle to end) cleanly.\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Early gods gate (#395)",
    description:
      "#395 - NOT a battle test, this entry just tracks the check.\n"
      + "Two holes let 600+ BST 'gods' spawn wild before wave 55 on Youngster/\n"
      + "Ace/Elite: (1) after 10 failed rerolls the gated mon was KEPT (always\n"
      + "happened when a biome's boss pool was all high-BST), now a common-pool\n"
      + "pick replaces it; (2) the level-evolution substitution ran AFTER the\n"
      + "gate, so a harmless roll could evolve into a 600+ BST final - now the\n"
      + "evolved form is re-gated and the weaker stage is kept.\n"
      + "DO: play Youngster/Ace runs to wave ~50 and watch wild + boss spawns.\n"
      + "EXPECT: no pseudo-legendary finals, box legendaries or ER endgame\n"
      + "customs in the wild before wave 55. Pass/Fail once satisfied.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 20, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) Usage tiers (#384)",
    description:
      "#384 - NOT a battle test, this entry just tracks the check.\n"
      + "DO: start a challenge run with the USAGE TIER challenge at each value.\n"
      + "EXPECT starter select only offers lines BELOW the tier's usage level:\n"
      + "UU < 2.25% (3 Favour, legendary egg lines banned), RU < 1% (8 Favour,\n"
      + "epic eggs banned too), PU < 0.5% (15 Favour, rare eggs banned, Favour\n"
      + "shiny cap rises 3x -> 5x), NU < 0.25% (20 Favour, common eggs only,\n"
      + "5x cap). Tiers self-update nightly from real player runs.\n"
      + "CATCH BLOCK (#125): in ANY roster challenge (Usage Tier / Mono Type / Mono\n"
      + "Color / Mono Gen), throwing a ball at a wild mon OUTSIDE the restriction now\n"
      + "registers it in the Pokedex but does NOT add it to your party - the message\n"
      + "reads 'caught, but it cannot join you in this challenge'. A legal wild mon is\n"
      + "caught normally.\n"
      + "IN-BATTLE BENCH (#384 anti-cheat Phase A): Usage Tier previously only gated at\n"
      + "ADD time (starter / catch). Now a tier-illegal mon is also BLOCKED at battle\n"
      + "time, like Mono Type / Mono Color / Mono Gen already are - no matter HOW it\n"
      + "reached your team (egg, event, mystery encounter, or an edited save).\n"
      + "DO: in a USAGE TIER (NU) run, get a clearly high-tier mon onto the team (e.g.\n"
      + "a Legendary via an egg / event), then try to send it out or switch it in.\n"
      + "EXPECT: it is treated as 'not eligible for this challenge' and cannot enter\n"
      + "battle (the same bench the other roster challenges use). A legal NU-tier mon\n"
      + "is unaffected, AND a Redux form / custom MEGA of an NU-legal base (e.g. a\n"
      + "Flygon mega) is STILL usable - the mega resolves to its base line's tier, it\n"
      + "is not wrongly benched. (Fail-safe: a mon whose tier cannot be resolved is\n"
      + "never benched.)\n"
      + "Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Cross Chop: 2 hits + high crit",
    description:
      "Community report - Cross Chop should be TWO 40BP hits with a high crit\n"
      + "ratio (ER 2.65 dex), not the vanilla single 100BP hit.\n"
      + "DO: select Cross Chop against the Snorlax (tanky, survives a turn).\n"
      + "EXPECT: the move strikes TWICE in one turn (two damage numbers), each\n"
      + "hit ~40BP, and crits often (high critical-hit ratio). 100% acc, 15 PP.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.CROSS_CHOP, MoveId.PROTECT, MoveId.BULK_UP, MoveId.DETECT],
        }),
      ];
    },
  },
  {
    label: "Clobbopus evolves at lv24 (no Taunt)",
    description:
      "Community report - Clobbopus would not evolve by level because it kept a\n"
      + "vanilla 'knows Taunt' gate. ER 2.65 dex = plain level-24 evolution.\n"
      + "DO: this Clobbopus starts at level 23 and does NOT know Taunt. Win a\n"
      + "battle so it reaches level 24.\n"
      + "EXPECT: it evolves into Grapploct on hitting level 24 with no Taunt\n"
      + "requirement. (note) Pure data fix - if it evolves, pass.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 23,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CLOBBOPUS, {
          moveset: [MoveId.BRUTAL_SWING, MoveId.DETECT, MoveId.ROCK_SMASH, MoveId.BIND],
        }),
      ];
    },
  },
  {
    label: "Mind Reader = SpDef protect",
    description:
      "ER 2.65 dex - Mind Reader is no longer a lock-on. It is now a King's\n"
      + "Shield-style PROTECT (priority +4, Psychic, Status, self): it dodges ALL\n"
      + "attacks and, on CONTACT, drops the ATTACKER's Special Defense by 1 stage.\n"
      + "May fail if used in succession.\n"
      + "DO: your Alakazam uses Mind Reader; the enemy Rattata uses Tackle (a\n"
      + "CONTACT move) into it.\n"
      + "EXPECT: Tackle is BLOCKED (Alakazam takes 0 damage / 'protected itself')\n"
      + "AND the enemy Rattata's Sp. Def falls by 1 stage. (Use Battle Info / the\n"
      + "stat arrows to confirm the -1 SpDef on the enemy.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.MIND_READER, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.RATTATA,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [makeStarter(SpeciesId.ALAKAZAM, { moveset: [MoveId.MIND_READER, MoveId.SPLASH] })];
    },
  },
  {
    label: "Drifloon move list: no duplicates",
    description:
      "Community report - the move-swap list showed Psycho Shift TWICE (and a\n"
      + "long list). Drifloon has Psycho Shift in BOTH its ER level-up learnset\n"
      + "and its egg moves; the swap list was not de-duplicated.\n"
      + "DO: win the opening battle, take the Move Slot Expander from the shop, use\n"
      + "it on Drifloon, and open the move-to-learn list.\n"
      + "EXPECT: every move appears exactly ONCE (Psycho Shift listed a single\n"
      + "time). The list being long is fine - that is Drifloon's full ER movepool;\n"
      + "the bug was the duplicate. (note) Pure UI/data fix.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.DRIFLOON, {
          moveset: [MoveId.SHADOW_BALL, MoveId.CALM_MIND, MoveId.GUST, MoveId.THUNDERBOLT],
        }),
      ];
    },
    shopItems: [modifierTypes.MOVE_SLOT_EXPANDER],
  },
  {
    label: "Pichu line: candy + passives pool to root",
    description:
      "Community report - evolving a Pichu showed Pikachu/Raichu passives\n"
      + "'Locked' and candy split across stages (Pichu 26 / Pikachu 0 / Raichu 98).\n"
      + "Cause: candy + passive unlocks keyed by different species ids across the\n"
      + "line (Pichu AND Pikachu are both starters). Now everything pools to the\n"
      + "line root, and a one-time load migration merges historic scatter.\n"
      + "DO: this Pichu starts at lv24; win the opening battle so it evolves to\n"
      + "Pikachu, take the Rare Candy from the shop to push it toward Raichu, and\n"
      + "open Pokemon Info > Abilities at each stage.\n"
      + "EXPECT: the candy count is the SAME pooled total at every stage, and any\n"
      + "passive you unlocked stays Unlocked through both evolutions. (note) Save-\n"
      + "data fix - existing saves consolidate on load with no candy lost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 24,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PICHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.NUZZLE, MoveId.QUICK_ATTACK, MoveId.PROTECT],
        }),
      ];
    },
    shopItems: [modifierTypes.RARE_CANDY],
  },
  {
    label: "ER #486: World Map overlay",
    description:
      "Phase D Map system, increment 3 - the read-only World Map overlay.\n"
      + "DO: start this scenario. On the first turn it reveals a handful of sample\n"
      + "map nodes + 2 Treasure-Map fragments, then opens the World Map overlay\n"
      + "automatically. Scroll the list with Up/Down; press B (or the action\n"
      + "button) to close it and return to the battle.\n"
      + "EXPECT: a centred 'World Map' card listing the revealed nodes (label, biome\n"
      + "name, and a [Route]/[Landmark]/[Treasure] tag), a 'Treasure-Map Fragments:\n"
      + "2 / 3' line, the cursor highlighting the selected row and scrolling when\n"
      + "the list runs past 6 entries, and a clean close back to combat. (note) UI-\n"
      + "only; revealed nodes also persist across save/load (see er-map-nodes test).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.PROTECT, MoveId.IRON_TAIL],
        }),
      ];
    },
    onBattleStart: () => {
      // Seed a clean, recognisable map state, then pop the overlay.
      resetErMapNodes();
      revealMapNodes([
        { biome: BiomeId.SEA, label: "Distant Isle", kind: "biome" },
        { biome: BiomeId.SPACE, label: "The Observatory", kind: "landmark" },
        { biome: BiomeId.BEACH, label: "Buried Cache", kind: "treasure" },
        { biome: BiomeId.LAKE, label: "Quiet Lake", kind: "biome" },
        { biome: BiomeId.CAVE, label: "Echoing Cavern", kind: "landmark" },
        { biome: BiomeId.JUNGLE, label: "Overgrown Temple", kind: "landmark" },
        { biome: BiomeId.VOLCANO, label: "Smoking Crater", kind: "biome" },
      ]);
      addTreasureFragments(2);
      openErMapOverlay();
    },
  },
  {
    label: "ER #486: Message in a Bottle",
    description:
      "Phase D map event - a Sea bottle that grants a Treasure-Map fragment and\n"
      + "charts nearby routes. Starts you with 2 fragments seeded.\n"
      + "DO: on wave 12 (SEA) the bottle spawns. Choose 'Open the bottle'. Then press\n"
      + "M to open the World Map.\n"
      + "EXPECT: a message confirming a fragment + chart; the World Map now shows\n"
      + "'Treasure-Map Fragments: 3 / 3' and lists the onward routes as [Route] nodes.\n"
      + "(note) With 3 fragments, the Beach 'X Marks the Spot' dig now pays out.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEA,
        ER_TREASURE_FRAGMENTS_OVERRIDE: 2,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_MESSAGE_IN_A_BOTTLE,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: X Marks the Spot (dig)",
    description:
      "Phase D map payout - the Beach buried-cache event. Starts you with 3\n"
      + "Treasure-Map fragments seeded (press J before choosing to confirm 3 / 3).\n"
      + "DO: on wave 12 (BEACH) choose 'Dig at the X'.\n"
      + "EXPECT: a 'buried cache' message, then a reward selection of solid items\n"
      + "(Rogue / Ultra / Great tier). After taking the reward, press J: the fragment\n"
      + "count is back to 0 / 3 (the three were spent). 'Scratch around' instead would\n"
      + "add one fragment; 'Walk the shoreline' just leaves.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.BEACH,
        ER_TREASURE_FRAGMENTS_OVERRIDE: 3,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_X_MARKS_THE_SPOT,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: The Observatory (reveal)",
    description:
      "Phase D reveal event (Space). DO: on wave 12 choose 'Chart the heavens',\n"
      + "then press J.\n"
      + "EXPECT: the World Map lists the onward routes as [Route] nodes plus 'The\n"
      + "Observatory' as a [Landmark]. 'Leave' just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SPACE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_OBSERVATORY,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: Echo Chamber (reveal)",
    description:
      "Phase D reveal event (Cave). DO: on wave 12 choose 'Listen to the echoes',\n"
      + "then press J.\n"
      + "EXPECT: the World Map lists the onward routes as [Route] nodes. 'Move on'\n"
      + "just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.CAVE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_ECHO_CHAMBER,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: The Informant (reveal + fragment)",
    description:
      "Phase D reveal event (Slum), money-gated. Starts with 50000 money.\n"
      + "DO: on wave 12 choose 'Buy the tip' (greyed if you cannot afford it), then\n"
      + "press J.\n"
      + "EXPECT: money drops by the fee; the World Map shows the onward [Route] nodes\n"
      + "and the fragment count went up by 1. 'Walk on' just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SLUM,
        STARTING_MONEY_OVERRIDE: 50000,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_INFORMANT,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: The Storm (travel)",
    description:
      "Phase D travel event (Sea). DO: on wave 12 choose 'Brave the storm'.\n"
      + "EXPECT: a 'swept off-course' message. The travel target is set - at the NEXT\n"
      + "biome transition (wave 20) the run jumps to that destination instead of the\n"
      + "normal choice. 'Turn back' sets no travel. (note) the jump is verified at the\n"
      + "biome boundary, so play on to wave 20 to confirm the destination.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEA,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_THE_STORM,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: Ultra Wormhole (travel)",
    description:
      "Phase D travel event (Space). DO: on wave 12 choose 'Step through'.\n"
      + "EXPECT: a 'flung onward' message. Like The Storm, the next biome transition\n"
      + "(wave 20) is forced to the chosen destination. 'Back away' sets no travel.\n"
      + "(note) verify the jump at the wave-20 biome boundary.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SPACE,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_ULTRA_WORMHOLE,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: Lost Wanderer (reveal + fragment)",
    description:
      "Phase D reveal event (Plains). DO: on wave 12 choose 'Point the way', then\n"
      + "press J.\n"
      + "EXPECT: the World Map shows the onward [Route] nodes and the fragment count\n"
      + "went up by 1. 'Leave them be' just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.PLAINS,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_LOST_WANDERER,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "ER #486: Sunken Vessel (reveal + fragment)",
    description:
      "Phase D reveal event (Seabed). DO: on wave 12 choose 'Scout the wreck', then\n"
      + "press J.\n"
      + "EXPECT: the World Map shows the onward [Route] nodes and the fragment count\n"
      + "went up by 1. 'Drift on' just exits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: BiomeId.SEABED,
        MYSTERY_ENCOUNTER_RATE_OVERRIDE: 256,
        MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.ER_SUNKEN_VESSEL,
      });
      return [makeStarter(SpeciesId.PIDGEY, { moveset: [MoveId.SPLASH] })];
    },
  },
  {
    label: "(note) ER #486: World Map core (length / crossroads / picker)",
    description:
      "#486 World Map CORE (dev/staging only, classic non-daily). Three new pieces\n"
      + "to verify across a real run with this strong team:\n"
      + "1) VARIABLE BIOME LENGTH - biomes are no longer a fixed 10 waves. Each biome\n"
      + "   rolls a length in [7, 25] waves (#504; biased long, most rolls clear 10),\n"
      + "   re-rolled on every biome entry. The roll is a HARD cap. Two runs of the\n"
      + "   same biome should differ.\n"
      + "2) CROSSROADS - every 5 waves spent in a biome (after the reward, not on the\n"
      + "   biome's final wave), a 'Stay / Move on' prompt appears. STAY keeps going;\n"
      + "   MOVE ON ends the biome now and opens the map picker.\n"
      + "3) VISUAL MAP PICKER - leaving a biome (forced end OR Move on) shows a\n"
      + "   BRANCHING map screen (origin node on the left, destination biomes\n"
      + "   branching right with route lines; gated nodes show as '???'), NOT the old\n"
      + "   plain text list. Up/Down picks a revealed route, A travels.\n"
      + "CHECK: play several biomes. Lengths vary; the biome SHOP + heal/interest\n"
      + "still bookend each biome (no double or missing shop); the J overlay still\n"
      + "shows onward routes. FINALE SAFETY (most important): from wave ~170 on,\n"
      + "biomes revert to the vanilla 10-wave cadence and the END biome must enter\n"
      + "at wave 191 with the wave-200 finale exactly as vanilla. Save+reload\n"
      + "mid-biome must keep the SAME boundary (no skipped/repeated transition). If\n"
      + "anything desyncs near the finale, press Send Logs.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 100,
        STARTING_BIOME_OVERRIDE: BiomeId.PLAINS,
      });
      return [
        makeStarter(SpeciesId.MEWTWO, {
          moveset: [MoveId.PSYSTRIKE, MoveId.ICE_BEAM, MoveId.AURA_SPHERE, MoveId.RECOVER],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GHOLDENGO, {
          moveset: [MoveId.MAKE_IT_RAIN, MoveId.SHADOW_BALL, MoveId.NASTY_PLOT, MoveId.RECOVER],
        }),
      ];
    },
  },
  {
    label: "ER #504: Biome Notoriety (overstay)",
    description:
      "#504 biome NOTORIETY / overstay escalation (dev/staging only, classic\n"
      + "non-daily). This run STARTS deep inside a biome (wave 18 = 8 waves OVER the\n"
      + "10-wave free window) so notoriety is ALREADY in effect on the opening\n"
      + "battle. The first 10 in-biome waves run the GLOBAL curve unchanged; past 10\n"
      + "the place turns hostile, escalating with each extra wave (LOCAL to this\n"
      + "biome only).\n"
      + "DO: fight on in this biome (choose the Stay verb at each Crossroads). Watch\n"
      + "the next several waves.\n"
      + "EXPECT: a one-time 'you are gaining notoriety' warning the first time you\n"
      + "pass 10 waves in a biome (already shown if you keep staying here). Bosses\n"
      + "and trainers come far more often (roughly every 2-3 waves, climbing toward\n"
      + "EVERY wave by ~wave 20 in-biome). Enemy BST climbs above the normal cap (up\n"
      + "to +100 by ~wave 20 in-biome, then holds), enemy LEVELS run over the normal\n"
      + "cap, and enemies hold more resist berries / ward stones / held items. The\n"
      + "biome still HARD-ENDS at its rolled cap (max 25 waves) even if you keep\n"
      + "staying. CRITICAL: when you LEAVE this biome (Move on, or the cap ends it),\n"
      + "notoriety RESETS - the very next biome drops back to the NORMAL global curve\n"
      + "(no inflated BST/level/boss-rate carried over). If overstay inflation leaks\n"
      + "into the next biome, that is the bug - press Send Logs.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("elite");
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 18,
        STARTING_BIOME_OVERRIDE: BiomeId.CAVE,
      });
      return [
        makeStarter(SpeciesId.MEWTWO, {
          moveset: [MoveId.PSYSTRIKE, MoveId.ICE_BEAM, MoveId.AURA_SPHERE, MoveId.RECOVER],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GHOLDENGO, {
          moveset: [MoveId.MAKE_IT_RAIN, MoveId.SHADOW_BALL, MoveId.NASTY_PLOT, MoveId.RECOVER],
        }),
      ];
    },
  },
  {
    label: "(note) Pokedex Editor overrides",
    description:
      "Editor feature - the er-editor 'Learnsets / TMs / Abilities' tabs now\n"
      + "write per-species overrides (er-learnsets.json / er-tm-learnsets.json /\n"
      + "er-species-abilities.json) that the game applies LAST at init, on top of\n"
      + "every other pass. The loader is FAIL-SAFE: bad ids are dropped, unmapped\n"
      + "species skipped, and it can only no-op on error (never crashes a run).\n"
      + "With NO override committed, the dex is unchanged.\n"
      + "CHECK (after committing an edit in the editor + a staging redeploy): the\n"
      + "edited species shows the new level-up learnset (catch/hatch it and check\n"
      + "its moves), the new TM-learnable moves (starter-select / TM rewards), and\n"
      + "the new ability slots (summary ABILITIES screen). Console logs an\n"
      + "[er-pokedex-overrides] summary line. If anything is off, press Send Logs.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.VOLT_SWITCH, MoveId.GRASS_KNOT, MoveId.NUZZLE],
        }),
      ];
    },
  },
  {
    label: "Hell AI: smarter move pick (Slice 1)",
    description:
      "Slice 1 of the smarter Elite/Hell AI. On HELL, trainer/boss enemies now\n"
      + "score moves by REAL simulated damage vs your mon's actual bulk (accuracy-\n"
      + "weighted, with a big bonus for a guaranteed KO) instead of the old power x\n"
      + "type-effectiveness proxy, and they NEVER deliberately throw - they always\n"
      + "use their best-scored move (sharpness 1 on Hell).\n"
      + "DO: fight this Hell boss Tyranitar a few turns, then press Send Logs. The\n"
      + "console prints 'Move Pool', 'Move Scores' and 'Chosen Move' each enemy\n"
      + "turn; the CHOSEN move should always be the TOP score, and a guaranteed-KO\n"
      + "move should dominate (huge score). On Ace/Youngster and vs wild mons the\n"
      + "old behavior is unchanged - switch difficulty to confirm.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setErSmartAiTestForced(true); // opt this scenario into the (master-OFF) smarter AI
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.TYRANITAR,
        ENEMY_HEALTH_SEGMENTS_OVERRIDE: 2, // force a boss so the AI profile is active
        ENEMY_MOVESET_OVERRIDE: [MoveId.CRUNCH, MoveId.STONE_EDGE, MoveId.EARTHQUAKE, MoveId.LOW_KICK],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "(note) Hell AI: smarter switching (Slice 2)",
    description:
      "Slice 2 of the smarter Elite/Hell AI - switching. On Elite/Hell, trainer\n"
      + "switch decisions now use a BEST-MOVE matchup (the strongest damaging move\n"
      + "vs you, not the diluted average of all moves), a LOWER switch threshold\n"
      + "(Hell 1.5 / Elite 2.0 vs vanilla 2/3) so they swap to a real counter more\n"
      + "readily, and forced/faint replacements are now HAZARD-AWARE (the AI no\n"
      + "longer sends a Stealth-Rock-weak mon into its own hazards after a KO).\n"
      + "DO: play a Hell TRAINER fight (set Rocks/Spikes on the enemy side if you\n"
      + "can). EXPECT the AI to pivot to type counters and to avoid bringing a\n"
      + "4x-hazard-weak mon in after a faint. Switch to Ace to confirm the old\n"
      + "behavior. Press Send Logs if a switch looks wrong.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setErSmartAiTestForced(true); // opt this scenario into the (master-OFF) smarter AI
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 11 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STEALTH_ROCK, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE],
        }),
      ];
    },
  },
  {
    label: "(note) Hell AI: setup + hazards (Slice 3)",
    description:
      "Slice 3 of the smarter Elite/Hell AI - field & strategy. On Elite/Hell the\n"
      + "AI now: (1) refuses to use a SETUP move (Swords Dance, etc.) while frail\n"
      + "(<45% HP / about to be KO'd) and is willing to set up when healthy; (2)\n"
      + "values ENTRY HAZARDS (Rocks/Spikes) when you still have a bench to punish\n"
      + "and none are up yet - and won't waste a turn re-setting one that's already\n"
      + "down or when you're on your last mon.\n"
      + "DO: bring a FULL party vs a Hell boss/trainer that has a hazard or setup\n"
      + "move. EXPECT it to lay hazards early (full bench) but not re-lay them, and\n"
      + "to set up only when it's healthy, not at low HP. Send Logs if it sets up\n"
      + "while nearly fainted or re-lays a hazard.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setErSmartAiTestForced(true); // opt this scenario into the (master-OFF) smarter AI
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 11 });
      return [
        makeStarter(SpeciesId.DRAGONITE, {
          moveset: [MoveId.DRAGON_DANCE, MoveId.EARTHQUAKE, MoveId.STEALTH_ROCK, MoveId.EXTREME_SPEED],
        }),
        makeStarter(SpeciesId.METAGROSS, {
          moveset: [MoveId.METEOR_MASH, MoveId.EARTHQUAKE, MoveId.BULLET_PUNCH, MoveId.ICE_PUNCH],
        }),
      ];
    },
  },
  {
    label: "(note) Hell AI: doubles ally-safety (Slice 4)",
    description:
      "Slice 4 of the smarter Elite/Hell AI - doubles. On Elite/Hell, a spread\n"
      + "move that also hits the enemy's OWN ally (Earthquake, Surf in doubles,\n"
      + "etc.) is penalized by the damage it would deal that ally - so the AI won't\n"
      + "Earthquake its grounded partner, and will NEVER pick a spread move that\n"
      + "KOs its own ally. If the ally is immune (Flying / Levitate) there's no\n"
      + "penalty, so it still spreads freely.\n"
      + "DO: this is a forced DOUBLE Hell battle vs two grounded Tyranitar that\n"
      + "carry Earthquake. EXPECT them to prefer single-target moves over EQ while\n"
      + "their partner is alive and grounded (the EQ score is reduced - see the\n"
      + "'Move Scores' log via Send Logs); a Flying/Levitate ally removes the\n"
      + "penalty. On Ace the old behavior is unchanged.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setErSmartAiTestForced(true); // opt this scenario into the (master-OFF) smarter AI
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        BATTLE_STYLE_OVERRIDE: "double", // forces a double battle (BATTLE_TYPE is wild/trainer/ME, not the style)
        ENEMY_SPECIES_OVERRIDE: SpeciesId.TYRANITAR,
        ENEMY_HEALTH_SEGMENTS_OVERRIDE: 1,
        ENEMY_MOVESET_OVERRIDE: [MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.STONE_EDGE, MoveId.ICE_PUNCH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.SKARMORY, {
          moveset: [MoveId.BRAVE_BIRD, MoveId.SPIKES, MoveId.ROOST, MoveId.IRON_HEAD],
        }),
      ];
    },
  },
  {
    label: "(note) Notoriety resets on biome switch (#504)",
    description:
      "#504 - NOT a single-battle test, this entry tracks the manual check.\n"
      + "Biome NOTORIETY raises enemy levels above the global cap the LONGER you\n"
      + "over-stay one biome; LEAVING the biome must drop that bonus to ZERO so\n"
      + "the next biome follows the normal global curve again.\n"
      + "BUG (reported): after switching biomes everything was suddenly ~+25\n"
      + "levels above the player (e.g. Plains wave 62, your team ~lv49 but the\n"
      + "wild mons lv74) and it never came back down. Root cause: a SAVE LOAD\n"
      + "re-rolled the biome start wave back to 1 (newArena ran before the battle\n"
      + "was restored), so wavesSinceEntered was huge and notoriety pinned to MAX.\n"
      + "DO: play a run with the World Map biome routing, OVER-STAY a biome a few\n"
      + "waves (watch enemy levels climb above your cap), then SWITCH to a new\n"
      + "biome. Also try SAVE & QUIT then CONTINUE mid-biome.\n"
      + "EXPECT: right after a biome switch (and after any reload) enemy levels\n"
      + "snap back to the normal global curve (roughly your own level), not a\n"
      + "permanent +25. Notoriety only climbs again if you LINGER in the new\n"
      + "biome.  Pass/Fail this entry once checked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 50, STARTING_WAVE_OVERRIDE: 5 });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "(note) AI A/B: standard vs experimental, back-to-back",
    description:
      "A-B harness for the smarter AI. Drops you into the DOJO on HELL (almost\n"
      + "every wave is a trainer) with ALTERNATE experimental mode: trainers on\n"
      + "EVEN waves use the EXPERIMENTAL brain, ODD waves use STANDARD - so you\n"
      + "fight the two brains back-to-back without one affecting the other.\n"
      + "WATCH the console each enemy turn: 'ER AI: standard|experimental brain\n"
      + "(sharpness X)' tells you which trainer is on which. The EXPERIMENTAL brain\n"
      + "is the Foul-Play-style depth-1 evaluator: it scores the board AFTER its\n"
      + "move + your best reply, so it should secure KOs that deny your turn, snipe\n"
      + "with priority, refuse to set up into a KO, and trade better. Press Send\n"
      + "Logs to capture a comparison.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setErSmartAiTestForced(true);
      setErAiExperimentalMode("alternate");
      setOverrides({ STARTING_LEVEL_OVERRIDE: 60, STARTING_BIOME_OVERRIDE: BiomeId.DOJO });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.ROTOM, {
          moveset: [MoveId.THUNDERBOLT, MoveId.SHADOW_BALL, MoveId.VOLT_SWITCH, MoveId.NASTY_PLOT],
        }),
      ];
    },
  },
  {
    label: "AI: experimental (Foul-Play depth-1) brain ON",
    description:
      "Forces the EXPERIMENTAL brain on EVERY Hell trainer (mode 'all'), so you\n"
      + "can stress the depth-1 positional AI directly. It looks one ply ahead -\n"
      + "its move plus your best reply - and scores the whole resulting board\n"
      + "(alive/HP/status/boosts/hazards). EXPECT: it favors a KO that also denies\n"
      + "your turn (incl. via priority), it will NOT walk a slow move into a faint\n"
      + "or set up in front of a KO, and it picks the better trade rather than the\n"
      + "biggest number. Singles only (it falls back to standard in doubles).\n"
      + "WATCH the console: 'ER AI: experimental brain'. Send Logs with notes.",
    setup: () => {
      resetDevOverrides();
      setErDifficulty("hell");
      setErSmartAiTestForced(true);
      setErAiExperimentalMode("all");
      setOverrides({ STARTING_LEVEL_OVERRIDE: 60, STARTING_BIOME_OVERRIDE: BiomeId.DOJO });
      return [
        makeStarter(SpeciesId.DRAGAPULT, {
          moveset: [MoveId.DRAGON_DARTS, MoveId.PHANTOM_FORCE, MoveId.U_TURN, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "(note) Biome composition: GRAVEYARD (event-heavy)",
    description:
      "Per-biome ENCOUNTER COMPOSITION. Drops you into the GRAVEYARD mid-run and\n"
      + "you PLAY FORWARD several waves. Graveyard has eventMult ~2.2x, so mystery\n"
      + "encounters should fire NOTICEABLY more often than usual (baseline is ~1\n"
      + "ME / 10-15 waves; here expect bursts). Compare against a quiet biome (Sea/\n"
      + "Plains ~0.7x) where they should be rare. Trainers are a touch sparser (0.6x)\n"
      + "and wild bosses a touch more common (+25%). Note: applies on ALL\n"
      + "difficulties (biome rules are universal). Send Logs after ~15 waves.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 21,
        STARTING_BIOME_OVERRIDE: BiomeId.GRAVEYARD,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.ROTOM, {
          moveset: [MoveId.THUNDERBOLT, MoveId.SHADOW_BALL, MoveId.VOLT_SWITCH, MoveId.NASTY_PLOT],
        }),
      ];
    },
  },
  {
    label: "(note) Biome composition: WASTELAND (boss gauntlet)",
    description:
      "Per-biome ENCOUNTER COMPOSITION. Drops you into the WASTELAND and you PLAY\n"
      + "FORWARD. Wasteland is the every-wild-wave BOSS gauntlet: nearly every\n"
      + "non-trainer wave should be a 2-3 bar boss mon, with trainers rare (0.3x).\n"
      + "A short, brutal stretch. EXPECT back-to-back boss bars. Send Logs after a\n"
      + "few waves.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 70,
        STARTING_WAVE_OVERRIDE: 41,
        STARTING_BIOME_OVERRIDE: BiomeId.WASTELAND,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.DRAGAPULT, {
          moveset: [MoveId.DRAGON_DARTS, MoveId.PHANTOM_FORCE, MoveId.U_TURN, MoveId.DRAGON_DANCE],
        }),
      ];
    },
  },
  {
    label: "(note) Biome composition: DESERT (empty-wave skip)",
    description:
      "Per-biome ENCOUNTER COMPOSITION. Drops you into the DESERT and you PLAY\n"
      + "FORWARD. The desert is a sparse crossing: ~40% of plain waves are EMPTY -\n"
      + "you should see 'The desert stretches on. Nothing stirs out here.' and the\n"
      + "run advances with NO fight. The waves that DO fire lean hard toward\n"
      + "SOMETHING NOTABLE (events ~2x, high wild-boss %), trainers rare (0.3x).\n"
      + "EXPECT: stretches of nothing, then an event or a boss. x0 boss/shop waves\n"
      + "are never skipped. Send Logs after ~15 waves.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 21,
        STARTING_BIOME_OVERRIDE: BiomeId.DESERT,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.ROTOM, {
          moveset: [MoveId.THUNDERBOLT, MoveId.SHADOW_BALL, MoveId.VOLT_SWITCH, MoveId.NASTY_PLOT],
        }),
      ];
    },
  },
  {
    label: "Grassy Seed insta-proc under Grassy Surge (Rillaboom)",
    description:
      "Tests the Grassy Seed held item with a Grassy Surge mon. Rillaboom (forced\n"
      + "GRASSY SURGE) starts holding an ER Grassy Seed in a NON-grass biome, so the\n"
      + "ONLY source of Grassy Terrain is its own ability. EXPECT turn 1: Grassy\n"
      + "Surge sets Grassy Terrain on switch-in, the Grassy Seed procs -> Rillaboom's\n"
      + "Defense rises +1, then the seed is consumed (gone from its held items). If\n"
      + "Defense does NOT rise on entry, the seed is checking terrain BEFORE the\n"
      + "surge sets it (a switch-in ordering bug) - Send Logs and note it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ABILITY_OVERRIDE: AbilityId.GRASSY_SURGE,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "ER_GRASSY_SEED" }],
      });
      return [
        makeStarter(SpeciesId.RILLABOOM, {
          moveset: [MoveId.WOOD_HAMMER, MoveId.KNOCK_OFF, MoveId.U_TURN, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  {
    label: "(repro) Move-learn loop: candy-evolve a FAINTED mon, then skip",
    description:
      "REPRO for the reported bug (helps pinpoint it - Send Logs the moment it\n"
      + "happens). Charmander starts at lv15 (evolves at 16) alongside a sturdy\n"
      + "Lapras.\n"
      + "DO: in the opening battle, let CHARMANDER FAINT (switch it in and let it go\n"
      + "down), then win with Lapras. In the shop, take the Rare Candy and use it on\n"
      + "the FAINTED Charmander to push it past lv16 so it evolves and is offered new\n"
      + "moves. LEARN ONE move, then try to SKIP / cancel the rest.\n"
      + "EXPECT: it closes cleanly. BUG: if it jumps BACK to the level-up move\n"
      + "selection instead, press Send Logs RIGHT THEN - the capture will show the\n"
      + "exact phase that re-fires so the loop can be fixed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_LEVEL_OVERRIDE: 15 });
      return [
        makeStarter(SpeciesId.CHARMANDER, {
          moveset: [MoveId.EMBER, MoveId.SCRATCH, MoveId.SMOKESCREEN, MoveId.DRAGON_BREATH],
        }),
        makeStarter(SpeciesId.LAPRAS, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.BODY_SLAM, MoveId.PROTECT],
        }),
      ];
    },
    shopItems: [modifierTypes.RARE_CANDY],
  },
  {
    label: "ER ID 388: Thundercall",
    description:
      "ID 388 - Thundercall must not load Discipline or another neighboring ability.\n"
      + "DO: use Thunder Shock, then use Tackle. EXPECT: Thunder Shock triggers the\n"
      + "extra Electric follow-up; Tackle does not. The ability name is Thundercall.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.THUNDERCALL),
        MOVESET_OVERRIDE: [MoveId.THUNDER_SHOCK, MoveId.TACKLE, MoveId.QUICK_ATTACK, MoveId.THUNDER_WAVE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.TACKLE, MoveId.REST, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDER_SHOCK, MoveId.TACKLE, MoveId.QUICK_ATTACK, MoveId.THUNDER_WAVE],
        }),
      ];
    },
  },
  {
    label: "ER ID 869: Blistering Sun",
    description:
      "ID 869 - Blistering Sun must not load Fire Aspect or another neighboring ability.\n"
      + "DO: start the battle and inspect the field and ability name. EXPECT: Blistering\n"
      + "Sun activates its Desolate Land/Air Blower package, not Fire absorption/burn.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.BLISTERING_SUN),
        MOVESET_OVERRIDE: [MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.SOLAR_BEAM, MoveId.PROTECT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLASTOISE,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.WATER_PULSE, MoveId.ICE_BEAM, MoveId.TACKLE, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.SOLAR_BEAM, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER ID 907: Laser Drill",
    description:
      "ID 907 - Laser Drill must not load Turf War or another neighboring ability.\n"
      + "DO: repeatedly use Horn Attack, then Earthquake. EXPECT: horn attacks have\n"
      + "the 50% burn rider; Earthquake does not. The ability name is Laser Drill.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.LASER_DRILL),
        MOVESET_OVERRIDE: [MoveId.HORN_ATTACK, MoveId.MEGAHORN, MoveId.EARTHQUAKE, MoveId.PROTECT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.TACKLE, MoveId.REST, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.NIDOKING, {
          moveset: [MoveId.HORN_ATTACK, MoveId.MEGAHORN, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER ID 945: Chainsaw",
    description:
      "ID 945 - Chainsaw must not load Echolocation or another neighboring ability.\n"
      + "DO: use X-Scissor, then Close Combat. EXPECT: the slicing attack lowers the\n"
      + "target's Defense by one stage; the non-slicing attack does not.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.CHAINSAW),
        MOVESET_OVERRIDE: [MoveId.X_SCISSOR, MoveId.NIGHT_SLASH, MoveId.CLOSE_COMBAT, MoveId.PROTECT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.TACKLE, MoveId.REST, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.GALLADE, {
          moveset: [MoveId.X_SCISSOR, MoveId.NIGHT_SLASH, MoveId.CLOSE_COMBAT, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER ID 1025: Foul Energy",
    description:
      "ID 1025 - Foul Energy must not load Reaper's Embarce or another neighboring\n"
      + "ability. DO: compare Crunch with Earthquake, then repeat below one-third HP.\n"
      + "EXPECT: Dark moves receive the stated 1.2x boost, increasing to 1.5x at low HP.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FOUL_ENERGY),
        MOVESET_OVERRIDE: [MoveId.CRUNCH, MoveId.DARK_PULSE, MoveId.EARTHQUAKE, MoveId.PROTECT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BODY_SLAM, MoveId.TACKLE, MoveId.REST, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.KROOKODILE, {
          moveset: [MoveId.CRUNCH, MoveId.DARK_PULSE, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Poison Point while burned",
    description:
      "ID 38 - an existing status on the ability holder must not disable its\n"
      + "offensive Poison Point roll. DO: use Tackle repeatedly while burned.\n"
      + "EXPECT: contact attacks can still poison the enemy at the stated 30% rate.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ABILITY_OVERRIDE: AbilityId.POISON_POINT,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.NIDOKING, {
          moveset: [MoveId.TACKLE, MoveId.POISON_JAB, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Flame Body offense tiers",
    description:
      "ID 49 - Flame Body works offensively even while its holder is burned.\n"
      + "DO: alternate Tackle and Swift repeatedly. EXPECT: Tackle can burn at\n"
      + "30%; non-contact Swift can burn at 20%. Neither tier is disabled.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ABILITY_OVERRIDE: AbilityId.FLAME_BODY,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.MAGMAR, {
          moveset: [MoveId.TACKLE, MoveId.SWIFT, MoveId.FLAMETHROWER, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Poison Touch single roll",
    description:
      "ID 143 - Poison Touch had two independent offensive 30% rolls.\n"
      + "DO: use Tackle repeatedly while burned. EXPECT: it still poisons while\n"
      + "statused, but uses one 30% roll rather than the old effective 51% rate.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ABILITY_OVERRIDE: AbilityId.POISON_TOUCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.GRIMER, {
          moveset: [MoveId.TACKLE, MoveId.POISON_JAB, MoveId.SLUDGE_BOMB, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Toxic Chain while burned",
    description:
      "ID 608 - an existing status on the holder must not disable Toxic Chain.\n"
      + "DO: use Water Gun repeatedly while burned. EXPECT: damaging moves can\n"
      + "still badly poison the enemy at the stated 30% rate.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ABILITY_OVERRIDE: AbilityId.TOXIC_CHAIN,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.OKIDOGI, {
          moveset: [MoveId.WATER_GUN, MoveId.TACKLE, MoveId.BITE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Cute Charm offense direction",
    description:
      "ID 56 - offensive Cute Charm used reversed contact participants and was\n"
      + "disabled by holder status. DO: use Tackle repeatedly while burned.\n"
      + "EXPECT: the female Lopunny can become infatuated by the male holder.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ABILITY_OVERRIDE: AbilityId.CUTE_CHARM,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.LOPUNNY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.PROTECT],
          female: false,
        }),
      ];
    },
  },
  {
    label: "Frostmaw offense direction",
    description:
      "ID 692 - Frostmaw must evaluate the holder as the attacker even while\n"
      + "statused. DO: use Crunch repeatedly. EXPECT: biting moves can inflict\n"
      + "frostbite at 50%; non-biting Earthquake cannot.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FROSTMAW),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.FERALIGATR, {
          moveset: [MoveId.CRUNCH, MoveId.ICE_FANG, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Deep Cuts offense direction",
    description:
      "ID 736 - Deep Cuts must evaluate the holder as the attacker even while\n"
      + "statused. DO: use X-Scissor repeatedly. EXPECT: slicing moves can inflict\n"
      + "bleed at 50%; non-slicing Close Combat cannot.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.DEEP_CUTS),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.GALLADE, {
          moveset: [MoveId.X_SCISSOR, MoveId.NIGHT_SLASH, MoveId.CLOSE_COMBAT, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Icicle Fist offense direction",
    description:
      "ID 1017 - Icicle Fist must evaluate the holder as the attacker even while\n"
      + "statused. DO: use Mach Punch repeatedly. EXPECT: punching moves can cause\n"
      + "frostbite at 30%; non-punching Ice Beam cannot.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.ICICLE_FIST),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.HITMONCHAN, {
          moveset: [MoveId.MACH_PUNCH, MoveId.ICE_PUNCH, MoveId.ICE_BEAM, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Grip Pincer trapped target",
    description:
      "IDs 373/849 - Grip Pincer must trap on the holder's contact attacks.\n"
      + "DO: use Tackle until Wrap appears, then use Focus Blast. EXPECT: the\n"
      + "target takes trap damage and attacks against it ignore accuracy and defensive stat changes.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.GRIP_PINCER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.IRON_DEFENSE, MoveId.AMNESIA, MoveId.SPLASH, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.TACKLE, MoveId.FOCUS_BLAST, MoveId.BRICK_BREAK, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Fungal Infection offense",
    description:
      "ID 398 - contact moves seed the target, not attackers that hit the holder.\n"
      + "DO: use Tackle. EXPECT: Snorlax receives Leech Seed. Use Swift after a\n"
      + "fresh restart to confirm a non-contact move does not seed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FUNGAL_INFECTION),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.BRELOOM, {
          moveset: [MoveId.TACKLE, MoveId.SWIFT, MoveId.MACH_PUNCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Fearmonger offense",
    description:
      "ID 408 - entry lowers enemy Attack and Sp. Atk, and the holder's contact\n"
      + "moves have a 10% fear chance. DO: verify both entry drops, then use\n"
      + "Tackle repeatedly. EXPECT: fear can affect Snorlax, never the holder.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FEARMONGER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.TACKLE, MoveId.SHADOW_PUNCH, MoveId.SHADOW_BALL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Absorbant drain boost",
    description:
      "ID 425 - drain moves recover 50% more and seed their target. DO: use\n"
      + "Giga Drain or Mega Drain while injured. EXPECT: boosted immediate healing\n"
      + "and Leech Seed on Snorlax. Tackle must do neither.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.ABSORBANT),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.GIGA_DRAIN, MoveId.MEGA_DRAIN, MoveId.STRENGTH_SAP, MoveId.TACKLE],
        }),
      ];
    },
    onBattleStart: () => {
      const player = globalScene.getPlayerField()[0];
      if (player) {
        player.hp = Math.max(1, Math.floor(player.getMaxHp() / 4));
      }
    },
  },
  {
    label: "Freezing Point tiers",
    description:
      "IDs 492/493 - frostbite works offensively and defensively: 20% on contact,\n"
      + "30% on non-contact. DO: alternate Tackle and Swift while Snorlax attacks.\n"
      + "EXPECT: exactly one applicable tier rolls per hit; contact never gets both rolls.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FREEZING_POINT),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE, MoveId.SWIFT, MoveId.REST, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.GLALIE, {
          moveset: [MoveId.TACKLE, MoveId.SWIFT, MoveId.ICE_BEAM, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Dead Power offense",
    description:
      "ID 599 - the holder has 1.5x Attack and its own contact moves have a 20%\n"
      + "curse chance. DO: use Tackle repeatedly. EXPECT: Snorlax can be cursed;\n"
      + "Snorlax hitting the holder must not curse itself.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.DEAD_POWER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE, MoveId.SPLASH, MoveId.REST, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.DUSKNOIR, {
          moveset: [MoveId.TACKLE, MoveId.SHADOW_PUNCH, MoveId.SHADOW_BALL, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Serpent Bind offense",
    description:
      "IDs 818/819 - any holder attack has a 50% chance to trap, then trapped\n"
      + "targets lose one Speed stage each turn. DO: alternate Tackle and Swift.\n"
      + "EXPECT: either attack can apply a 4-5 turn damaging trap and Speed drops each turn.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SERPENT_BIND),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.SEVIPER, {
          moveset: [MoveId.TACKLE, MoveId.SWIFT, MoveId.POISON_JAB, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Surprise priority counter",
    description:
      "ID 623 - in fog, enemy priority moves are preempted by a 40 BP +3 Astonish\n"
      + "that always flinches. DO: use Splash while the enemy selects Quick Attack.\n"
      + "EXPECT: Astonish lands first and the enemy's priority move is stopped.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        WEATHER_OVERRIDE: WeatherType.FOG,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SURPRISE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.LUCARIO,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.QUICK_ATTACK, MoveId.MACH_PUNCH, MoveId.TACKLE, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SPLASH, MoveId.SHADOW_BALL, MoveId.PROTECT, MoveId.CONFUSE_RAY],
        }),
      ];
    },
  },
  {
    label: "Wonder Skin boost block",
    description:
      "IDs 147/341/486/827 - blocks opponent damage-boosting and added-hit\n"
      + "abilities without reducing ordinary damage. DO: compare enemy Crunch\n"
      + "and Tackle. EXPECT: Strong Jaw does not boost Crunch; Tackle is not reduced.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.WONDER_SKIN,
        ENEMY_ABILITY_OVERRIDE: AbilityId.STRONG_JAW,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.CRUNCH, MoveId.TACKLE, MoveId.BITE, MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SHUCKLE, {
          moveset: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
        }),
      ];
    },
  },
  {
    label: "Sand Force highest attack",
    description:
      "IDs 159/744/900 - in sand, Sand Force multiplies only the holder's higher\n"
      + "calculated attacking stat by 1.5 and grants sand immunity. DO: compare\n"
      + "physical and special moves. EXPECT: the higher Attack is boosted regardless of move type.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        WEATHER_OVERRIDE: WeatherType.SANDSTORM,
        ABILITY_OVERRIDE: AbilityId.SAND_FORCE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.EXCADRILL, {
          moveset: [MoveId.IRON_HEAD, MoveId.EARTH_POWER, MoveId.BRICK_BREAK, MoveId.FLASH_CANNON],
        }),
      ];
    },
  },
  {
    label: "Wonder Skin multihit block",
    description:
      "IDs 147/341/486/827 - suppresses opponent multihit abilities except\n"
      + "Parental Bond and Multi-Headed. DO: let the enemy use Tackle.\n"
      + "EXPECT: Unrelenting does not turn Tackle into a 2-5 hit move.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.WONDER_SKIN,
        ENEMY_ABILITY_OVERRIDE: erAbility(ErAbilityId.UNRELENTING),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE, MoveId.SPLASH, MoveId.PROTECT, MoveId.REST],
      });
      return [
        makeStarter(SpeciesId.SHUCKLE, {
          moveset: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
        }),
      ];
    },
  },
  {
    label: "Berserk single trigger",
    description:
      "IDs 201/661/992 - an opposing attack crossing half HP raises only the\n"
      + "higher calculated attacking stat by one stage, once per battle. DO:\n"
      + "let Snorlax attack through half HP, heal, and cross again. EXPECT: only Attack rises once.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.BERSERK,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BODY_SLAM, MoveId.TACKLE, MoveId.SPLASH, MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.TAUROS, {
          moveset: [MoveId.REST, MoveId.SLEEP_TALK, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER constants (note)",
    description:
      "IDs 8/81/55/120/125/148 and composites - numeric dex corrections.\n"
      + "EXPECT: Sand Veil/Snow Cloak 1.25 evasion; Hustle 1.4 damage and 0.9\n"
      + "accuracy on all attacks; Reckless 1.2; Sheer Force/Analytic 1.3.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.HUSTLE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.BRICK_BREAK, MoveId.FOCUS_BLAST, MoveId.TACKLE, MoveId.SWIFT],
        }),
      ];
    },
  },
  {
    label: "Rhythmic no cap",
    description:
      "ID 640 - each consecutive successful use of the same move adds 10%\n"
      + "damage with no cap; a fail or different move resets it. DO: spam Tackle,\n"
      + "then use Splash and return to Tackle. EXPECT: damage keeps rising, then resets.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.RHYTHMIC),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SOFT_BOILED, MoveId.SPLASH, MoveId.PROTECT, MoveId.HEAL_PULSE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.SPLASH, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "First bite priority",
    description:
      "IDs 302/676 - only the first landed biting move after entry gets +1\n"
      + "priority; Sidewinder regains it after a direct KO. DO: use Bite twice.\n"
      + "EXPECT: Bite moves before Quick Attack once, then Quick Attack moves first.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.COIL_UP),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.QUICK_ATTACK, MoveId.SPLASH, MoveId.PROTECT, MoveId.REST],
      });
      return [
        makeStarter(SpeciesId.AERODACTYL, {
          moveset: [MoveId.BITE, MoveId.CRUNCH, MoveId.TACKLE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "On the Prowl clamp",
    description:
      "IDs 648/727 - first turn: priority 0+ moves gain +1 and negative\n"
      + "priority becomes exactly 0. DO: use Dragon Tail on turns one and two.\n"
      + "EXPECT: it acts at normal speed first turn, then returns to negative priority.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.ON_THE_PROWL),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE, MoveId.SPLASH, MoveId.PROTECT, MoveId.REST],
      });
      return [
        makeStarter(SpeciesId.AERODACTYL, {
          moveset: [MoveId.DRAGON_TAIL, MoveId.TACKLE, MoveId.PROTECT, MoveId.ROOST],
        }),
      ];
    },
  },
  {
    label: "Volcano Rage follow-up",
    description:
      "ID 382 - DO: use Flamethrower, then Slash. EXPECT: the Fire move is\n"
      + "immediately followed by a 50 BP Eruption; the Normal move has no follow-up.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.VOLCANO_RAGE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.HEAL_PULSE],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.FLAMETHROWER, MoveId.SLASH, MoveId.ROOST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Pyro Shells Outburst",
    description:
      "ID 397 - DO: use Water Pulse, then Surf. EXPECT: the pulse move is\n"
      + "immediately followed by the real 50 BP Outburst; Surf has no follow-up.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.PYRO_SHELLS),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.HEAL_PULSE],
      });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.WATER_PULSE, MoveId.SURF, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Temporal Rupture no switch",
    description:
      "ID 830 (#604) - DO: use Roar of Time on the foe. EXPECT: the target is\n"
      + "NOT switched out (it stays on the field), its Ability becomes Slow Start,\n"
      + "and Roar of Time moves at normal speed (not last). Without Temporal\n"
      + "Rupture, Roar of Time instead forces the target to switch out.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.TEMPORAL_RUPTURE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.HEAL_PULSE],
      });
      return [
        makeStarter(SpeciesId.DIALGA, {
          moveset: [MoveId.ROAR_OF_TIME, MoveId.FLASH_CANNON, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Aftermath detonates through flinch (#605)",
    description:
      "#605 - the enemy's Fake Out flinches AND KOs this Drifblim. EXPECT: Aftermath\n"
      + "STILL detonates (Drifblim self-KOs and the Fake Out user takes the blast),\n"
      + "even though the KO hit also flinched it. Before the fix the explosion was\n"
      + "flinch-cancelled and Drifblim was stranded at 1 HP.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 5, // frail + slow: enemy Fake Out goes first and KOs
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: AbilityId.AFTERMATH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.HITMONLEE,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_MOVESET_OVERRIDE: [MoveId.FAKE_OUT],
      });
      return [
        makeStarter(SpeciesId.DRIFBLIM, {
          moveset: [MoveId.SHADOW_BALL, MoveId.AIR_SLASH, MoveId.PROTECT, MoveId.REST],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST, MoveId.YAWN],
        }),
      ];
    },
  },
  {
    label: "Aftershock Magnitude 4-7",
    description:
      "ID 491 - DO: repeatedly use Tackle. EXPECT: every landed attack is\n"
      + "followed by Magnitude, and its message is always Magnitude 4, 5, 6, or 7.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.AFTERSHOCK),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.HEAL_PULSE],
      });
      return [
        makeStarter(SpeciesId.GOLEM, {
          moveset: [MoveId.TACKLE, MoveId.ROCK_SLIDE, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Jumpscare first entry",
    description:
      "ID 718 - EXPECT: Gengar uses 40 BP Astonish on its opening entry. DO:\n"
      + "switch to Snorlax and back. EXPECT: Astonish does not fire a second time.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.JUMPSCARE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.HEAL_PULSE],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.HYPNOSIS, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Sludge Spit Venom Bolt",
    description:
      "ID 876 - DO: use Tackle. EXPECT: it is immediately followed by the\n"
      + "real ER Venom Bolt at 35 BP, not vanilla Sludge.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SLUDGE_SPIT),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.HEAL_PULSE],
      });
      return [
        makeStarter(SpeciesId.MUK, {
          moveset: [MoveId.TACKLE, MoveId.POISON_JAB, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Thunder Clouds 35 BP",
    description:
      "ID 993 - DO: use Thunder Shock, then Tackle. EXPECT: only the special\n"
      + "move is immediately followed by a 35 BP Thunderbolt.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.THUNDER_CLOUDS),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.HEAL_PULSE],
      });
      return [
        makeStarter(SpeciesId.RAICHU, {
          moveset: [MoveId.THUNDER_SHOCK, MoveId.TACKLE, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Fatal Precision SE crit (#623)",
    description:
      "Fatal Precision (was unimplemented). DO: use Psychic on the Machamp.\n"
      + "EXPECT: the super-effective hit ALWAYS lands a critical hit and never\n"
      + "misses. Try a few times - SE moves should never miss.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FATAL_PRECISION),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MACHAMP,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.PROTECT, MoveId.REST, MoveId.BULK_UP],
      });
      return [
        makeStarter(SpeciesId.MEWTWO, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.RECOVER, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Speed Force contact damage (#622)",
    description:
      "Speed Force (was unimplemented). DO: use Crunch (contact) then Earth\n"
      + "Power (non-contact) on the Snorlax. EXPECT: Crunch hits noticeably\n"
      + "harder than its base Attack implies (20% of Aerodactyl's high Speed is\n"
      + "added to Attack); the non-contact move gets no bonus.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SPEED_FORCE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.REST, MoveId.PROTECT, MoveId.BLOCK],
      });
      return [
        makeStarter(SpeciesId.AERODACTYL, {
          moveset: [MoveId.CRUNCH, MoveId.EARTH_POWER, MoveId.ROOST, MoveId.PROTECT],
        }),
      ];
    },
  },
  // (note) #620 Tyrogue now evolves by level-up at L20 (ER dex) and the player
  //   CHOOSES the path - Hitmonlee / Hitmonchan / Hitmontop - like other split
  //   evos. No longer gated on knowing Low Sweep/Mach Punch/Rapid Spin. Check by
  //   leveling a Tyrogue to 20: the evolution prompt offers all three Hitmons.
  // (note) #625 Stantler learns Psyshield Bash at L25 again (the ER moveset
  //   override had dropped it). Check its learnset / that it can evolve to Wyrdeer.
  // (note) #626 Basculin and Basculegion now share a candy bucket (both root to
  //   Basculin). Check the candy count is shared in starter-select.
  // (note) #612 ER rivals at high waves now field fully evolved teams (no L60
  //   Growlithe on a wave-55 Hell rival).
  // ===========================================================================
  // Co-op — per-player 3-mon cap holds on catch (#633, P1g)
  // ===========================================================================
  {
    label: "Co-op: host at 3 can't reach 4 on catch (#633)",
    description:
      "#633 co-op - the shared 6-slot party is split between two players, each\n"
      + "owning up to 3. The host starts here with a FULL 3-mon half (all tagged\n"
      + "'host'); the guest half is empty.\n"
      + "DO: catch the wild Magikarp (throw a Poke Ball - the L3 Magikarp catches\n"
      + "easily). Then open Check Team and look at the 4-mon party.\n"
      + "EXPECT: the catch SUCCEEDS but is attributed to the GUEST half - the host\n"
      + "still owns exactly 3, never 4. (Before the fix a player who started with 3\n"
      + "could grow to 6 by catching.) The console prints the per-side counts after\n"
      + "the catch: host=3, guest=1. If you fill BOTH halves to 3 (total 6), a further\n"
      + "catch must offer the RELEASE/replace prompt at 6 just like solo.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3, // frail + easy to catch
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
      ];
    },
    onBattleStart: () => {
      // Flip the live run into co-op and tag the 3 starters as the HOST's half so
      // the per-player cap is exercised by an ordinary catch this battle.
      globalScene.gameMode = getGameMode(GameModes.COOP);
      for (const mon of globalScene.getPlayerParty()) {
        mon.coopOwner = "host";
      }
      const party = globalScene.getPlayerParty();
      console.log(
        `[#633 co-op cap] start: host=${coopOwnedCount(party, "host")} guest=${coopOwnedCount(party, "guest")} `
          + "(catch the Magikarp; it should land on the guest half, host stays 3)",
      );
    },
  },
  {
    label: "Co-op: partner slot auto-acts + switch is half-locked (#633)",
    description:
      "#633 co-op BATTLE CONTROL - in the forced-DOUBLE co-op battle each player\n"
      + "drives ONLY their own active mon. Field slot 0 (LEFT, Snorlax) = YOUR mon\n"
      + "(the host); field slot 1 (RIGHT, Gengar) = your PARTNER's mon (auto-played\n"
      + "by AI in this local/spoof path).\n"
      + "DO: take a turn. You are prompted for the LEFT mon ONLY. The RIGHT mon acts\n"
      + "on its own (watch the log: it uses one of Gengar's moves every turn without\n"
      + "ever opening a menu for it). Then on the LEFT mon pick Pokemon -> Switch.\n"
      + "EXPECT: the command menu appears ONLY for the LEFT (host) mon - the RIGHT\n"
      + "(guest) mon never prompts you and auto-submits a legal move. In the switch\n"
      + "list, only the HOST's bench (Gyarados) is selectable; the GUEST's bench\n"
      + "(Alakazam) is blocked with a 'belongs to your partner!' message. (Before the\n"
      + "fix you controlled both mons and could switch in anyone.) Console prints the\n"
      + "ownership tags and the partner's auto-chosen move.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 40,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      // Host half = slots 0-2 (Snorlax lead + Gyarados bench), guest half = slots
      // 3-5 (Gengar lead + Alakazam bench). The launch partition is by slot order.
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.FOCUS_BLAST, MoveId.RECOVER],
        }),
      ];
    },
    onBattleStart: () => {
      // Flip the live run into co-op and register the local (host) session so the
      // command-routing + switch-ownership gates engage. The forced-double above
      // gives each side two active mons; the merged party is partitioned host =
      // slots 0-2, guest = slots 3-5.
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username });
      }
      const party = globalScene.getPlayerParty();
      party.forEach((mon, i) => {
        mon.coopOwner = i < 3 ? "host" : "guest";
      });
      console.log(
        "[#633 co-op control] tags: "
          + party.map(m => `${m.getNameToRender()}=${m.coopOwner}`).join(", ")
          + ` | local role=${getCoopController()?.role} `
          + "(you drive the LEFT mon; the RIGHT mon is auto-played and switch is half-locked)",
      );
    },
  },
  {
    label: "Co-op: partner death syncs + auto-replaces (#633)",
    description:
      "#633 co-op PARTNER-DEATH SYNC - in the authoritative co-op forced-DOUBLE, a\n"
      + "PLAYER-side faint (one of the two leads, field slot 0/1) used to NOT propagate\n"
      + "to the guest renderer: the host captured only ACTIVE player mons, so a\n"
      + "just-fainted partner was DROPPED from the checkpoint and the guest kept it on\n"
      + "field forever -> field composition diverged from the first move. On top of that,\n"
      + "when the GUEST's mon fainted the host waited 300s for a replacement choice the\n"
      + "pure-renderer guest never sends (a stall).\n"
      + "DO: take a turn and let the RIGHT (guest, Gengar) lead FAINT (the foe is strong;\n"
      + "or pick a move that lets it drop). Watch the field after it faints.\n"
      + "EXPECT: the fainted partner is removed cleanly and its BENCH replacement\n"
      + "(Alakazam) is auto-sent into the RIGHT slot with NO 300s hang and NO desync -\n"
      + "the host auto-picks the guest's first legal bench mon and the guest's field\n"
      + "renders the same species at that slot. (Before the fix the slot stayed empty /\n"
      + "the guest still showed the dead mon and the run desynced.) The host's own\n"
      + "(LEFT) faint already worked; this scenario covers the partner / guest-owned\n"
      + "side. Console prints the ownership tags.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        // A hard-hitting foe so the partner (guest) lead can be KO'd this turn, exercising the
        // player-faint propagation + the host's auto-pick replacement for the guest's slot.
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MACHAMP,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.CLOSE_COMBAT],
      });
      // Host half = slots 0-2 (Snorlax lead + Gyarados bench), guest half = slots 3-5
      // (Gengar lead + Alakazam bench) - the guest's Alakazam is the auto-pick replacement.
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.FOCUS_BLAST, MoveId.RECOVER],
        }),
      ];
    },
    onBattleStart: () => {
      // Flip the live run into co-op and register the local (host) session so the partner-death
      // propagation + the host's authoritative auto-pick replacement engage. Host = slots 0-2,
      // guest = slots 3-5.
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username });
      }
      const party = globalScene.getPlayerParty();
      party.forEach((mon, i) => {
        mon.coopOwner = i < 3 ? "host" : "guest";
      });
      console.log(
        "[#633 co-op partner-death] tags: "
          + party.map(m => `${m.getNameToRender()}=${m.coopOwner}`).join(", ")
          + ` | local role=${getCoopController()?.role} `
          + "(let the RIGHT/guest Gengar faint; its Alakazam bench should auto-replace, no hang)",
      );
    },
  },
  // Co-op - AUTHORITATIVE mystery-encounter that spawns a BOSS battle (#633 ME battle handoff)
  {
    label: "(note) Co-op: ME boss-spawn handoff (2 clients, authoritative)",
    description:
      "#633 co-op AUTHORITATIVE ME BATTLE HANDOFF - NOT stageable in one client (it is a\n"
      + "cross-client deadlock that needs TWO live engines + a transport; the headless repro\n"
      + "lives in test/tests/elite-redux/coop/coop-me-battle-handoff.test.ts).\n"
      + "THE BUG: a mystery encounter whose option spawns a wild BOSS battle hung. The GUEST\n"
      + "owned the ME (alternation parity), drove the option, then forked into the spawned\n"
      + "battle - so the HOST (the button-replay watcher) STALLED at the ME option screen\n"
      + "forever (the owner's button stream dried up at the encounter -> battle boundary) and\n"
      + "the guest waited in the battle for the host to drive it. Both screens froze.\n"
      + "THE FIX: at the encounter -> battle boundary the ME owner relays a BATTLE-HANDOFF\n"
      + "signal (the watcher ends its pump WITHOUT leaving the encounter), and the HOST streams\n"
      + "the boss party keyed by the ME interaction; the GUEST adopts it verbatim. The battle\n"
      + "then runs host-authoritatively (host drives, guest replays via CoopReplayTurnPhase).\n"
      + "DO (needs 2 clients on the staging build, AUTHORITATIVE netcode): play to a wave where\n"
      + "an ME spawns and pick the option that starts a BOSS/wild battle - first on the GUEST's\n"
      + "alternation turn (guest owns the ME), then on the HOST's turn (host owns the ME).\n"
      + "EXPECT (both owner cases): NO freeze. The owner picks the option, both clients enter\n"
      + "the SAME boss battle (identical species/level - the host's party), the host drives it\n"
      + "and the guest renders it, and the run continues to the reward shop + next wave.\n"
      + "VERIFY post-ME the two clients still agree (no recurring [coop-desync] lines; the\n"
      + "meChecksum / state matches). This (note) flags that a live 2-client run is the final\n"
      + "validation - the single-client suite cannot reproduce the deadlock.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // Co-op - HOST launch no longer stalls on the SAVE_SLOT picker (#633, 2 clients)
  {
    label: "(note) Co-op: host launches with NO save-slot picker (#633)",
    description:
      "#633 co-op HOST LAUNCH - NOT stageable in one client (it is a 2-client launch\n"
      + "handoff; the headless repro lives in test/tests/elite-redux/coop/coop-launch.test.ts).\n"
      + "THE BUG: after team-select + difficulty, the run did not start. The HOST opened the\n"
      + "INTERACTIVE SAVE_SLOT picker mid-launch; its per-slot cloud loads dead-ended\n"
      + "('Invalid save data JSON detected! Session not found.' on every empty slot), the\n"
      + "picker callback NEVER fired, so initBattle never ran. The guest had already\n"
      + "auto-picked its slot and reached the wave-1 EncounterPhase, so it waited forever.\n"
      + "(This interactive save-slot step blocked co-op launch TWICE - a stale-text overlay\n"
      + "first, then these empty-slot loads.)\n"
      + "THE FIX: NEITHER client runs the picker now. Both AUTO-PICK a slot and drop straight\n"
      + "into the merged battle. The HOST (persistence authority) picks the FIRST EMPTY save\n"
      + "slot, read DIRECTLY from localStorage so an existing solo/other run is NEVER\n"
      + "overwritten; it falls back to its current slot only when all 5 slots are full. The\n"
      + "guest reuses its current slot (its save is non-authoritative). The SOLO save-slot\n"
      + "picker is unchanged.\n"
      + "DO (needs 2 clients on the staging build, AUTHORITATIVE netcode): start a co-op run -\n"
      + "host + guest each pick a team, then pick the difficulty.\n"
      + "EXPECT: the run STARTS IMMEDIATELY after the difficulty pick - NO save-slot screen on\n"
      + "EITHER client, both drop into the wave-1 double, and neither hangs. DATA SAFETY: if the\n"
      + "host had an existing solo run in a slot, that run is untouched (the co-op run lands in\n"
      + "the first EMPTY slot). Confirm the prior run is still there afterward. VERIFY this (note)\n"
      + "is the final check - the single-client suite cannot reproduce the 2-client launch hang.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // Co-op - LOBBY handshake self-heals a lost runConfig/roster/ready frame (#868, 2 clients)
  {
    label: "(note) Co-op: lobby handshake self-heals a dropped frame (#868)",
    description:
      "#868 co-op LOBBY HANDSHAKE - NOT stageable in one client (it needs TWO live engines + a\n"
      + "transport that can flap; the headless repro lives in\n"
      + "test/tests/elite-redux/coop/coop-lobby-selfheal.test.ts).\n"
      + "THE BUG: the lobby-critical state (runConfig, roster, ready) crossed the wire ONE-SHOT\n"
      + "with no way to re-request or re-broadcast it. When a single lobby frame was lost - dropped\n"
      + "on a channel flap (#805 hot-rejoin) or sent while the transport was momentarily down - the\n"
      + "two clients were left permanently divergent: the GUEST sat at starter-select requesting the\n"
      + "runConfig forever ('stuck on the pokemon select screen while teammate started'), or the HOST\n"
      + "looped with partnerReady=false forever ('partner got kicked, no players showing'). The #805\n"
      + "rejoin resync only healed BATTLE state, never the LOBBY, and the roster/ready direction had\n"
      + "no re-request at all.\n"
      + "THE FIX: the handshake is now self-healing. A symmetric requestRoster (mirror of the existing\n"
      + "requestRunConfig) lets either side ask the peer to re-broadcast its roster+ready; a\n"
      + "resyncLobbyState() re-establishes BOTH directions (hello + roster + ready + host runConfig +\n"
      + "the peer re-requests) and runs automatically on a transport RECONNECT and on a short interval\n"
      + "while a ready client waits for its partner. A lost lobby frame now converges instead of\n"
      + "stranding.\n"
      + "DO (needs 2 clients on the staging build, AUTHORITATIVE netcode): start a co-op run and, if\n"
      + "you can, briefly kill/restore one client's network (or just play normally through team-select\n"
      + "+ difficulty a few times to catch a real flap).\n"
      + "EXPECT: neither client gets stuck at starter-select or on 'Waiting for your partner...'; a\n"
      + "brief disconnect during the lobby recovers (the reconnect banner shows, then both proceed) and\n"
      + "the run launches. VERIFY this (note) is the final check - the single-client suite cannot\n"
      + "reproduce the 2-client lobby handshake strand.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // Co-op - GUEST's OWN switch no longer desyncs (#633, coop-me-authoritative, 2 clients)
  {
    label: "(note) Co-op: GUEST switch no longer desyncs (#633)",
    description:
      "#633 co-op AUTHORITATIVE GUEST SELF-SWITCH - NOT stageable in one client (it needs TWO\n"
      + "live engines + a transport; the headless repro lives in\n"
      + "test/tests/elite-redux/coop/coop-guest-renderer.test.ts -> 'SELF-SWITCH MIRROR' +\n"
      + "'HEAL REPAIR').\n"
      + "THE BUG: in authoritative co-op the GUEST is a pure renderer - its TurnStartPhase diverts\n"
      + "the WHOLE turn to CoopReplayTurnPhase BEFORE the loop that is the ONLY place a switch is\n"
      + "executed. So when the GUEST switched a Pokemon, the guest never mirrored its OWN switch:\n"
      + "its on-field composition kept the OLD lead while the host (which simulates with the guest's\n"
      + "relayed command) swapped in the new mon. The serialized field array shifted by one, the\n"
      + "per-turn checksum mismatched EVERY turn, and the numeric-only resync heal could not move an\n"
      + "on-field mon, so it never self-healed (the live 'desync after switching' / 'UNHEALED 25+\n"
      + "fields').\n"
      + "THE FIX: the guest now mirrors its OWN switch inside the divert with the SAME side-effect-free\n"
      + "party swap the host does (no fresh RNG, no re-fired hazards/abilities), so its field realigns\n"
      + "with the host's and the checksum converges. A heal safety net also repositions an on-field\n"
      + "mon that is at the WRONG slot (not just a bench replacement).\n"
      + "DO (needs 2 clients on the staging build, AUTHORITATIVE netcode): start a co-op double; on the\n"
      + "GUEST client, take a turn and pick Pokemon -> Switch on the guest's OWN (RIGHT) lead, swapping\n"
      + "in a bench mon. Take a few more turns afterward.\n"
      + "EXPECT: both clients show the SAME mon in the guest's slot immediately after the switch, the\n"
      + "guest's bench/party order matches the host's, and there are NO recurring [coop-desync] /\n"
      + "[coop-resync] UNHEALED lines on EITHER client for the turns after the switch (before the fix a\n"
      + "guest switch desynced every subsequent turn). VERIFY this (note) is the final 2-client check -\n"
      + "the single-client suite cannot reproduce the cross-client switch desync.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // Co-op - AUTHORITATIVE exp + bench-revive + evolution (#633 B5/B4/B6, 2 clients)
  {
    label: "(note) Co-op: exp authority + bench revive + evolution (#633 B5/B4/B6)",
    description:
      "#633 co-op AUTHORITATIVE PROGRESSION - NOT stageable in one client (it needs TWO live\n"
      + "engines + a transport; the headless repros live in test/tests/elite-redux/coop/\n"
      + "coop-exp-authoritative.test.ts, coop-bench-drift.test.ts, coop-evolution-authoritative.test.ts).\n"
      + "THE BUGS (build mqv07ocq): (1) REVIVE desync - a player revives a fainted BENCH mon in the\n"
      + "shop; the HOST shows it fainted (0 hp), the GUEST shows it alive (22 hp). The per-turn\n"
      + "checksum + comprehensive resync healed ON-FIELD mons but NOT bench-mon hp/level/exp/form.\n"
      + "(2) LEARN-MOVE on the WRONG mon - learn-move is relayed by party slot, but the guest COMPUTED\n"
      + "its own exp, so its level/evolution path diverged and the relayed slot hit a different mon.\n"
      + "THE FIX: #838 - the GUEST's applyPartyExp is gated off; the HOST streams the SETTLED post-exp\n"
      + "battle state (whole party as PokemonData, in its BattleEndPhase after the exp/level/evolution\n"
      + "chain drains) on a `waveEndState` message; the guest adopts it via one id-based full-state apply\n"
      + "(so both VictoryPhase -> LevelUp -> LearnMove hit the SAME mon). B4 - the resync now carries the\n"
      + "WHOLE party as PokemonData (`benchParty`) +\n"
      + "hashes `partyLevels`, so a bench-mon hp/level/exp/form drift (the revive) is DETECTED + HEALED.\n"
      + "B6 - the guest skips evolution (it would build a per-client mon); it adopts the host's evolved\n"
      + "species via benchParty on the next resync.\n"
      + "DO (needs 2 clients on the staging build, AUTHORITATIVE netcode): play a co-op double a few\n"
      + "waves; (a) let a BENCH mon faint, reach the shop, and REVIVE it on one client; (b) let a mon\n"
      + "LEVEL UP and LEARN a move; (c) let a mon EVOLVE on level-up.\n"
      + "EXPECT: after the revive both clients agree the bench mon is ALIVE at the same hp/level (no\n"
      + "host=fainted / guest=alive split); the learned move lands on the RIGHT mon on BOTH clients;\n"
      + "the evolved species matches on both. NO recurring [coop-desync] / [coop-resync] UNHEALED lines\n"
      + "for the party after these events. VERIFY this (note) is the final 2-client check - the\n"
      + "single-client suite cannot reproduce the cross-client progression desync.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // Co-op - arena-tag (hazard / screen) SYNC (#633 GAP 1)
  {
    label: "Co-op: hazards / screens sync to the guest (#633 GAP 1)",
    description:
      "#633 co-op ARENA-TAG SYNC (GAP 1) - hazards (Stealth Rock, Spikes), screens (Reflect,\n"
      + "Light Screen) and Tailwind are set by host MoveEffectPhases the PURE-RENDERER guest\n"
      + "never runs. They WERE detected by the per-turn checksum but NOT carried in the\n"
      + "checkpoint, so the guest never gained them -> a resync-loop EVERY turn (the most\n"
      + "frequent co-op desync). The per-turn checkpoint now carries arena tags and the guest\n"
      + "reconciles its arena to the host's set by (tagType, side).\n"
      + "DO: set up the co-op double, then use Stealth Rock (and Spikes / a screen) and take a\n"
      + "few turns. Watch the console for the per-turn [coop-desync] / [coop-resync] lines.\n"
      + "EXPECT: NO recurring [coop-desync] every turn from arena tags - the guest gains the\n"
      + "host's hazard / screen and the checksum CONVERGES (a one-time resync at most, then\n"
      + "quiet). Clearing a screen on the host (it lapses) likewise removes it on the guest.\n"
      + "(Before the fix the run logged a fresh checksum mismatch + still-diverged resync on\n"
      + "every single turn while any hazard / screen was up.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      // Host half = slots 0-2, guest half = slots 3-5. The leads carry the hazard / screen
      // setters so the host's MoveEffectPhases lay them and the guest must sync to them.
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.STEALTH_ROCK, MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE],
        }),
        makeStarter(SpeciesId.SKARMORY, {
          moveset: [MoveId.SPIKES, MoveId.LIGHT_SCREEN, MoveId.REFLECT, MoveId.BRAVE_BIRD],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.FOCUS_BLAST, MoveId.RECOVER],
        }),
      ];
    },
    onBattleStart: () => {
      // Flip the live run into authoritative co-op so the per-turn checkpoint + arena-tag
      // reconcile engage. Host = slots 0-2, guest = slots 3-5.
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username, netcodeMode: "authoritative" });
      }
      const party = globalScene.getPlayerParty();
      party.forEach((mon, i) => {
        mon.coopOwner = i < 3 ? "host" : "guest";
      });
      console.log(
        "[#633 co-op hazard-sync] tags: "
          + party.map(m => `${m.getNameToRender()}=${m.coopOwner}`).join(", ")
          + ` | local role=${getCoopController()?.role} `
          + "(use Stealth Rock / Spikes / a screen; the checksum should CONVERGE, not loop every turn)",
      );
    },
  },
  // Co-op - ME battle-handoff -> reward shop deadlock (the "berry bush" freeze, #847). NEEDS TWO LIVE
  // CLIENTS, so this is a (note): drive it in a real co-op session, not a single-client dev battle.
  {
    label: "(note) Co-op: berry-bush ME reward freeze (#847)",
    description:
      "#847 co-op ME BATTLE-HANDOFF -> REWARD SHOP deadlock (the 'berry bush' P0: after a mystery-\n"
      + "encounter battle ends, NEITHER player can pick the rewards - the run is frozen). ROOT CAUSE:\n"
      + "an ME whose option spawns a battle hands off to the host-authoritative battle path; when the\n"
      + "host WINS, VictoryPhase takes the isMysteryEncounter branch BEFORE broadcasting the co-op\n"
      + "wave-advance, so the guest never got a signal to stop the battle. It opened a PHANTOM next-turn\n"
      + "command for a battle the host already left for the shop -> each client waited at a DIFFERENT\n"
      + "sync barrier (host at shop:W:C, guest at cmd:W:C+1) -> both ate the full 60s anti-hang -> freeze.\n"
      + "FIX: (1) the guest detects the ME-battle win directly and runs the reward tail instead of a\n"
      + "phantom turn; (2) the rendezvous CROSS-POINT releases a barrier the moment the partner is proven\n"
      + "to be at another sync point (no 60s wait). VERIFY IN A REAL 2-CLIENT SESSION: play a co-op run\n"
      + "to a battle-spawning ME (e.g. the berry-bush / Fight-or-Flight class), let the host win the\n"
      + "fight, and CHECK both clients reach the reward shop and CAN pick - no freeze, no 60s stall, and\n"
      + "NO '[coop:rendezvous] RENDEZVOUS TIMEOUT' WARN in the console. Headless proof (2 real engines):\n"
      + "test/tests/elite-redux/coop/coop-duo-me-battle-reward.test.ts + coop-rendezvous.test.ts.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
      ];
    },
  },
  // Co-op - per-mon HELD ITEMS + the ball inventory sync to the guest (#698 RISKY #1-#4)
  {
    label: "Co-op: held items + ball counts sync (#698 RISKY #1-#4)",
    description:
      "#698 co-op HELD-ITEM + BALL SYNC (RISKY #1-#4) - per-mon held-item binding and the\n"
      + "pokeball inventory live OUTSIDE the per-turn checkpoint, so a host-only consume\n"
      + "(Knock Off, Bug Bite), a rebind (Grip Claw / Covet stealing onto a different on-field\n"
      + "mon), or a ball decrement (the host alone runs the catch) was invisible to the guest.\n"
      + "The checksum now carries an ON-FIELD per-mon held-item digest (by battler index) plus a\n"
      + "ball-count vector, and the resync snapshot heals both on the guest. Your lead holds Grip\n"
      + "Claw and Knock Off; the foe Snorlax holds Leftovers and a Sitrus Berry.\n"
      + "DO: in the co-op double, knock items off the foe and let Grip Claw steal one across a few\n"
      + "turns, then watch the console for [coop-desync] / [coop-resync] lines.\n"
      + "EXPECT: after each turn BOTH clients show identical held-item icons AND identical ball\n"
      + "counts - the checksum CONVERGES (a one-time resync at most, then quiet), it does NOT loop\n"
      + "every turn. BENCH-mon held items may lag until the next wave (deferred by design).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        // Wave 145: past the ER #419 elite BST-cap ladder so the bulky Snorlax spawns as itself.
        STARTING_WAVE_OVERRIDE: 145,
        BATTLE_STYLE_OVERRIDE: "double",
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "GRIP_CLAW" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }, { name: "BERRY", type: BerryType.SITRUS }],
      });
      // Host half = slots 0-2, guest half = slots 3-5. The host lead carries Grip Claw + Knock Off
      // so the host's MoveEffectPhases mutate held-item binding the guest must sync to.
      return [
        makeStarter(SpeciesId.WEAVILE, {
          moveset: [MoveId.KNOCK_OFF, MoveId.ICE_PUNCH, MoveId.FAKE_OUT, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.FOCUS_BLAST, MoveId.RECOVER],
        }),
      ];
    },
    onBattleStart: () => {
      // Flip the live run into authoritative co-op so the per-turn checkpoint + held-item / ball
      // reconcile engage. Host = slots 0-2, guest = slots 3-5.
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username, netcodeMode: "authoritative" });
      }
      const party = globalScene.getPlayerParty();
      party.forEach((mon, i) => {
        mon.coopOwner = i < 3 ? "host" : "guest";
      });
      console.log(
        "[#698 co-op held-item-sync] tags: "
          + party.map(m => `${m.getNameToRender()}=${m.coopOwner}`).join(", ")
          + ` | local role=${getCoopController()?.role} `
          + "(knock items off / let Grip Claw steal; held-item icons + ball counts should CONVERGE)",
      );
    },
  },
  {
    label: "(note) Co-op TRAINER-VICTORY deadlock (#633)",
    description:
      "#633 co-op AUTHORITATIVE TRAINER-WIN (2-client flow, not single-client testable). After\n"
      + "beating a TRAINER, the HOST ran the full tail (VictoryPhase -> BattleEnd -> TrainerVictory\n"
      + "-> Money/Voucher rewards -> EggLapse -> SelectModifierPhase) and parked as the reward-shop\n"
      + "WATCHER. The GUEST, however, ran only VictoryPhase -> ExpPhase -> next wave's CommandPhase:\n"
      + "it SKIPPED the entire trainer reward chain + the reward shop and advanced a wave -> DEADLOCK\n"
      + "(host waits at the shop for the guest/OWNER's picks; guest is a wave ahead) AND the guest\n"
      + "got NO egg/AG vouchers. ROOT CAUSE: the guest removes a host-KOd enemy with hp=0 but never\n"
      + "stamped StatusEffect.FAINT, so VictoryPhase's win-branch guard (which checks isFainted(TRUE)\n"
      + "= hp<=0 AND status===FAINT) saw a 'still-alive' enemy and skipped the whole reward branch.\n"
      + "FIX: reconcileCoopEnemyField/PlayerField now stamp FAINT (mirroring the host's FaintPhase),\n"
      + "so the guest's VictoryPhase enters the win branch and queues TrainerVictoryPhase +\n"
      + "SelectModifierPhase. Both clients run TrainerVictoryPhase, so EACH credits its OWN account\n"
      + "the full ER voucher amount (Youngster 0 / Ace 1 / Elite 2 / Hell 3); the shared money pool\n"
      + "is host-authoritative so the guest renders the money line WITHOUT re-adding (no double money).\n"
      + "CHECK (needs a REAL 2-client authoritative session): beat a trainer wave; BOTH players must\n"
      + "land on the SAME reward shop (one drives as OWNER, the other watches), neither jumps ahead a\n"
      + "wave, and BOTH accounts gain the trainer's egg vouchers. (Regression unit test:\n"
      + "test/tests/elite-redux/coop/coop-guest-renderer.test.ts 'TRAINER-VICTORY' + 'VOUCHER CREDIT'.)",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // Co-op - the AUTHORITATIVE guest now ANIMATES the host's combat step-by-step (#633, replay redesign)
  {
    label: "(note) Co-op: guest ANIMATES the fight + faints (#633)",
    description:
      "#633 co-op AUTHORITATIVE guest combat REPLAY - NOT single-client testable (it is the\n"
      + "host->guest stream; the headless repro lives in\n"
      + "test/tests/elite-redux/coop/coop-battle-events.test.ts 'Step 1' + the guest-renderer suite).\n"
      + "THE BUG: on the GUEST the battle read as a still summary - a move's animation played, then the\n"
      + "enemy just VANISHED ('flamethrower and that's it; how they fainted is not given'). ROOT CAUSE:\n"
      + "CoopReplayTurnPhase applied the host's end-of-turn CHECKPOINT SYNCHRONOUSLY - it leaveField'd a\n"
      + "host-fainted mon BEFORE the queued move/HP-drain/faint animation phases drained, so the target\n"
      + "was already gone and the damage + faint could not animate. Faints from poison/weather/recoil/\n"
      + "hazards had NO events at all (recorded only on the direct move-hit path), so those mons winked\n"
      + "out silently.\n"
      + "THE FIX: the checkpoint is DEFERRED into a new CoopFinalizeTurnPhase that is unshifted LAST, so\n"
      + "it drains BEHIND the animation phases (which now play against the still-ALIVE pre-turn field) -\n"
      + "the faint phase performs the visible cry+drop+leaveField at the host's KO instant, then the\n"
      + "finalize checkpoint reconciles (a no-op for the already-removed mon). The hp + faint events are\n"
      + "now recorded at the UNIVERSAL damage chokepoint (Pokemon.damage), so a KO from ANY source\n"
      + "(move / status / weather / recoil / hazard / multi-KO) animates. The end-of-turn hashed state\n"
      + "is byte-identical, so the per-turn checksum still matches (no new desync).\n"
      + "CHECK (needs a REAL 2-client AUTHORITATIVE session on staging): as the HOST, KO an enemy with a\n"
      + "damaging move, then KO another with end-of-turn POISON (Toxic) / a weather chip / Spikes on\n"
      + "switch-in. On the GUEST screen EXPECT to WATCH each KO: the move animation, the HP bar draining\n"
      + "to 0, then the fainting cry + drop - in order, for EVERY faint regardless of source - instead\n"
      + "of the mon vanishing. VERIFY the two clients still agree afterward (no new [coop-desync] lines;\n"
      + "the per-turn checksum still matches). This (note) flags that the visual fidelity + near-real-\n"
      + "time feel are the final 2-client validation; the single-client suite proves the ordering +\n"
      + "checksum invariant only.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "(note) Black-shiny gift cycle refreshes on summary (#349)",
    description:
      "#349 - on the party SUMMARY screen's Abilities page, pressing R to cycle\n"
      + "your black shiny's GIFT now REDRAWS the gift row in place. Before the fix\n"
      + "the data advanced but the display was stuck: the row kept showing 'Gift\n"
      + "1/3' and the first ability no matter how many times you pressed R (the\n"
      + "page-cursor re-render dropped the forced-refresh flag). UI-only fix.\n"
      + "CHECK: this Garchomp is a black shiny. Open it in the party SUMMARY,\n"
      + "tab to the Abilities page (the violet italic 'Gift 1/3 (R)' row), and\n"
      + "press R a few times - EXPECT the counter step 1/3 -> 2/3 -> 3/3 -> 1/3\n"
      + "AND the shown gift ability NAME change with each press, every time, with\n"
      + "no tab flicker and without leaving ability-selection mode if you entered\n"
      + "it. (The in-battle Battle Info overlay already refreshed correctly - this\n"
      + "fix is specifically the summary page.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 60,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 55,
        ENEMY_MOVESET_OVERRIDE: [MoveId.THUNDER_WAVE],
        ER_BLACK_SHINY_PLAYER_OVERRIDE: SpeciesId.GARCHOMP,
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Shiny Lab FX: combat, party, summary",
    description:
      "Shiny Lab visual regression. Bulbasaur and the enemy Vulpix are forced shiny and both\n"
      + "species are seeded with Duo Neon + Star Map + Static Field in Shiny Lab.\n"
      + "CHECK 1: in combat, both player backsprite and enemy frontsprite show the equipped\n"
      + "palette PLUS animated surface/aura FX, not the default shiny palette.\n"
      + "CHECK 2: open the party screen; the Bulbasaur mini icon shows the Lab look.\n"
      + "CHECK 3: open Bulbasaur SUMMARY from party; the large summary sprite shows the same\n"
      + "palette/surface/aura layers and keeps animating.",
    setup: () => {
      resetDevOverrides();
      seedShinyLabVisualLook(SpeciesId.BULBASAUR);
      seedShinyLabVisualLook(SpeciesId.VULPIX);
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 35,
        STARTING_WAVE_OVERRIDE: 5,
        SHINY_OVERRIDE: true,
        VARIANT_OVERRIDE: 0,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.VULPIX,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_SHINY_OVERRIDE: true,
        ENEMY_VARIANT_OVERRIDE: 0,
        ENEMY_MOVESET_OVERRIDE: [MoveId.QUICK_ATTACK, MoveId.TAIL_WHIP, MoveId.EMBER, MoveId.CONFUSE_RAY],
      });
      return [
        makeStarter(SpeciesId.BULBASAUR, {
          shiny: true,
          variant: 0,
          moveset: [MoveId.VINE_WHIP, MoveId.TACKLE, MoveId.LEECH_SEED, MoveId.SLEEP_POWDER],
        }),
      ];
    },
  },
  {
    label: "(note) MEs respect roster challenge (#126)",
    description:
      "#126 - three VANILLA mystery encounters could hand you (or transform you\n"
      + "into) a mon that BREAKS the active roster challenge, because they grant /\n"
      + "transform OUTSIDE the catch gate. Now each filters its species pool through\n"
      + "the same legality the starter grid uses, so a challenge run stays within\n"
      + "bounds. NOT battle-testable here - it needs a REAL challenge run. CHECK:\n"
      + "start a new run with a Mono Type challenge (e.g. WATER), then trigger each\n"
      + "of these MEs and confirm no off-type mon is ever offered / granted /\n"
      + "transformed-into:\n"
      + "  1. The Pokemon Salesman - the mon it SELLS must be the chosen type (this\n"
      + "     one fully bypassed the catch gate; most important).\n"
      + "  2. Global Trade System - both the per-mon trade options AND the Wonder\n"
      + "     Trade result must be the chosen type.\n"
      + "  3. Weird Dream - it now SPAWNS under Mono Type / Mono Generation (it used\n"
      + "     to refuse), and EVERY party member it transforms must come out as the\n"
      + "     chosen type. Repeat with a Mono Color or Mono Generation challenge - same\n"
      + "     result. With NO challenge active, all three behave exactly as before\n"
      + "     (unrestricted). Regression-covered by\n"
      + "     er-mystery-encounter-challenge-legality.test.ts.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SQUIRTLE, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.PROTECT, MoveId.RAPID_SPIN],
        }),
      ];
    },
  },
  {
    label: "(note) World Map biome Conditions panel (#129)",
    description:
      "#129 - the World Map route picker now shows a 'Conditions' footer listing the\n"
      + "highlighted biome's special rules (forced weather/terrain, ambush, double-battle\n"
      + "bias, type boost, entry status, field rules, shop/berry notes, dominant gem).\n"
      + "NOT battle-testable here - open it from a real run. CHECK: in a Classic run,\n"
      + "finish a biome to open the World Map route picker, then move the cursor LEFT/\n"
      + "RIGHT across the onward biome tiles. EXPECT the Conditions panel to update to the\n"
      + "highlighted biome and match its rules - e.g. Volcano = 'Always sunny' + 'Fire\n"
      + "moves +20%' + '10% burn on entry'; Grass = 'Grassy terrain' + 'Double battles\n"
      + "twice as likely'; Desert = 'Always a sandstorm'; Abyss = 'No shop here'. A plain\n"
      + "biome shows 'No special conditions'. ALSO press J in-battle to open the read-only\n"
      + "World Map; its Conditions panel describes the CURRENT biome (the gold HERE tile).",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SQUIRTLE, {
          moveset: [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.TAIL_WHIP, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // ER relics batch (#130) - Blood Pact, Momentum Engine, Stormglass, Cartographer's
  // Lens, Trailblazer's Mark, Merchant's Seal, Gambler's Coin.
  // ===========================================================================
  {
    label: "Relic: Blood Pact (+20% dealt, +15% taken)",
    description:
      "#130 Blood Pact relic. Your team deals 20% more damage but also TAKES 15% more.\n"
      + "DO: with the Blood Pact held, attack the Magikarp with Tackle, and let it Tackle\n"
      + "you back. EXPECT: your Tackle hits noticeably harder than an un-pacted hit, and\n"
      + "the damage you TAKE is ~15% higher than normal. (Both edges are live at once.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_BLOOD_PACT" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Relic: Momentum Engine (+1 Speed per KO)",
    description:
      "#130 Momentum Engine relic. Each foe your team KOs grants your active mon +1\n"
      + "Speed stage (resets each battle). DO: in this DOUBLE battle, KO the two Magikarp.\n"
      + "EXPECT: after each faints, your active Snorlax gains +1 Speed ('the Momentum\n"
      + "Engine drives Snorlax faster!'), stacking to +2. Speed resets to 0 next battle.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_MOMENTUM_ENGINE" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.BLISSEY, {
          moveset: [MoveId.SEISMIC_TOSS, MoveId.SOFT_BOILED, MoveId.PROTECT, MoveId.TOXIC],
        }),
      ];
    },
  },
  {
    label: "Relic: Stormglass (sets chosen weather 5 turns)",
    description:
      "#130 Stormglass relic. At the start of EACH battle it conjures a weather of\n"
      + "your choice for 5 turns. The FIRST battle PROMPTS you to choose the weather\n"
      + "(see the dedicated 'Stormglass weather PICKER' scenario); the pick then persists\n"
      + "for the run. DO: enter the battle holding Stormglass and pick a weather. EXPECT:\n"
      + "that weather appears at battle start (rain/sun/sandstorm/hail/fog) and counts\n"
      + "down over 5 turns, overriding the biome's ambient. It re-applies each new battle.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_STORMGLASS" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Relic shop: Merchant's Seal + Gambler's Coin",
    description:
      "#130 economy relics. WIN the opening battle to reach the shop; the Merchant's\n"
      + "Seal and Gambler's Coin are guaranteed reward options. Merchant's Seal: the\n"
      + "reroll cost is HALVED and the reward screen shows ONE extra item slot. Gambler's\n"
      + "Coin: after each TRAINER battle, the money reward is doubled 55% of the time and\n"
      + "lost the other 45% (seeded per wave - stable across rerolls). CHECK both relics\n"
      + "appear in the shop and the reroll price is half normal once Merchant's Seal is taken.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
    shopItems: [modifierTypes.ER_RELIC_MERCHANTS_SEAL, modifierTypes.ER_RELIC_GAMBLERS_COIN],
  },
  {
    label: "(note) Relic: Cartographer's Lens + Trailblazer's Mark (map)",
    description:
      "#130 map relics - NOT battle-testable; check from a real Classic run.\n"
      + "Cartographer's Lens: on the World Map, ONE extra onward biome NODE is revealed\n"
      + "(base reveals 2; with the Lens, 3). CHECK: finish a biome to open the route\n"
      + "picker, count the lit onward tiles, and cursor the extra one to read its\n"
      + "Conditions.\n"
      + "Trailblazer's Mark: biome notoriety builds 50% slower. CHECK: at a Crossroads\n"
      + "choose to STAY past the free window; the over-cap enemy level/BST climbs about\n"
      + "half as fast as without the relic, and over-stayed enemies drop more loot.\n"
      + "Both are granted off-pool (Dormant Guardian, Buried City, Bog Witch).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_CARTOGRAPHERS_LENS" }, { name: "ER_RELIC_TRAILBLAZERS_MARK" }],
      });
      return [
        makeStarter(SpeciesId.SQUIRTLE, {
          moveset: [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.TAIL_WHIP, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Relic: Stormglass weather PICKER (#130)",
    description:
      "#130 Stormglass picker - on first battle you should be prompted to choose a\n"
      + "weather; it then persists for the run.\n"
      + "DO: start the battle holding ER_RELIC_STORMGLASS. At the very start a prompt\n"
      + "appears ('The Stormglass hums. Choose the weather it conjures for 5 turns.')\n"
      + "with FIVE options: Sun, Rain, Sandstorm, Hail, Fog. Pick one (e.g. Rain).\n"
      + "EXPECT: that weather is set for 5 turns THIS battle (the chosen weather wins\n"
      + "over the biome's ambient). You are NEVER prompted again - on every later\n"
      + "battle the same chosen weather is reapplied for 5 turns, and it survives Save\n"
      + "& Quit (the choice is stored on the relic). Before the fix the relic silently\n"
      + "auto-picked a default and never asked.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        STARTING_MODIFIER_OVERRIDE: [{ name: "ER_RELIC_STORMGLASS" }],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "ER Abyss: Curiosity bargain (#544 8th deal)",
    description:
      "#544 - Curiosity, the 8th Giratina's Bargain deal (the ability gamble). WIN this\n"
      + "wave-10 Abyss battle and Giratina's Bargain fires post-victory. The party is a\n"
      + "SINGLE mon (no shiny, no 3-item holder, no 100+ candy), so only Greed + Curiosity\n"
      + "are offerable -> Curiosity is ALWAYS shown.\n"
      + "DO: pick Curiosity. The flow is:\n"
      + " 1. Pick the mon, then the ability slot to LOCK (the party ability screen, like\n"
      + "    the Ability Randomizer item - active ability or an innate).\n"
      + " 2. Seven RANDOM abilities appear in a Bargain-styled picker, each with its\n"
      + "    description. Pick one.\n"
      + " 3. Pick which slot the chosen ability replaces (it may even be the slot you\n"
      + "    just locked - your call, not forced).\n"
      + "EXPECT:\n"
      + " - The locked slot reads 'Locked' on the in-battle Abilities panel (press R ->\n"
      + "   Abilities) and on SUMMARY, and that ability does NOTHING this run.\n"
      + " - The grafted ability sits in the replace slot and is LIVE.\n"
      + " - CRITICAL: the lock is RUN-ONLY. Open starter-select for this species - the\n"
      + "   locked ability is STILL shown UNLOCKED there (the candy unlock is untouched),\n"
      + "   and a Save & Quit + reload keeps the lock + grafted ability for the run.\n"
      + "Garchomp is Lv 30 with 3 innate slots so there is always a slot to lock + one to\n"
      + "replace. (note) The starter-select unlock + reload checks are out-of-battle.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        // Start ON a x0 wave in the Abyss: win this battle and the Abyss shop slot
        // fires Giratina's Bargain (TheBargainPhase) post-victory.
        STARTING_WAVE_OVERRIDE: 10,
        STARTING_BIOME_OVERRIDE: BiomeId.ABYSS,
      });
      // Single mon, nothing that unlocks the other sins -> only Greed + Curiosity
      // are offerable, so Curiosity is guaranteed in the (max 3) shown bargains.
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Combat — Spiky Shield causes BLEEDING on contact (ER 2.65 dex id 596)
  // ===========================================================================
  {
    label: "Spiky Shield: bleeds the attacker on contact",
    description:
      "Spiky Shield fix. The ER 2.65 dex says it 'protects the user and causes bleeding\n"
      + "on contact' - i.e. Protect PLUS ER_BLEED on any attacker that makes CONTACT, NOT\n"
      + "vanilla's 1/8 chip damage. Your bulky Blissey knows Spiky Shield; the foe Snorlax\n"
      + "(Normal, bleed-eligible) uses Tackle (a contact move).\n"
      + "DO: select SPIKY SHIELD, then let Snorlax attack into it. Pass a couple more turns\n"
      + "(Splash) to watch the bleed tick.\n"
      + "EXPECT:\n"
      + " - Blissey is fully protected (takes no damage from Tackle).\n"
      + " - The foe Snorlax gains BLEED and loses ~1/16 max HP at every turn-end (a DoT),\n"
      + "   NOT a single 1/8 chip. A NON-contact move would NOT cause it, and a Rock/Ghost\n"
      + "   attacker is immune (try swapping the foe to verify).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Wave 113 (past the #419 BST cap ladder) so the 540-BST Snorlax isn't
        // devolved, and a plain wild single battle (no fixed trainer/boss wave).
        STARTING_WAVE_OVERRIDE: 113,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE], // contact move -> triggers the bleed-on-contact
      });
      return [
        makeStarter(SpeciesId.BLISSEY, {
          moveset: [MoveId.SPIKY_SHIELD, MoveId.SOFT_BOILED, MoveId.SEISMIC_TOSS, MoveId.ICE_BEAM],
        }),
      ];
    },
  },
  // ===========================================================================
  // Item - Ability Capsule can ALSO unlock an innate for the run (maintainer request)
  // ===========================================================================
  {
    label: "Ability Capsule: unlock an innate for the run",
    description:
      "The Ability Capsule now offers a CHOICE on use. Garchomp has three recognizable\n"
      + "innates forced into its slots (Innate 1 = STURDY, 2 = DRIZZLE, 3 = MOXIE), and NO\n"
      + "candy innate unlock - so every innate starts LOCKED (dead in battle).\n"
      + "DO: KO Magikarp, then in the FIRST shop take the ABILITY CAPSULE and APPLY it to\n"
      + "Garchomp. Pick from the two options:\n"
      + " (A) 'Change ability' - cycles Garchomp's ACTIVE ability to the next legal one\n"
      + "     (Sand Veil -> Rough Skin -> Sand Force -> ...), exactly as before.\n"
      + " (B) 'Unlock an innate for the run' - opens the ability-slot picker (the same one\n"
      + "     the Ability Randomizer uses); pick a LOCKED innate (e.g. Innate 1 STURDY).\n"
      + "EXPECT for (B):\n"
      + " - That innate is now ACTIVE this run: open the in-battle Info -> Abilities panel\n"
      + "   (R, then Abilities) - the picked Innate row reads LIVE (not 'Innate (Locked)'),\n"
      + "   and its effect fires (e.g. STURDY survives a lethal hit at 1 HP).\n"
      + " - It is RUN-ONLY: in starter-select that same innate STILL reads LOCKED (the\n"
      + "   permanent candy unlock is untouched), and a future run starts it locked again.\n"
      + " - It SURVIVES a mid-run reload: Save & Quit, then Continue - the innate is still\n"
      + "   active this run.\n"
      + " - Backing out of the option-select or the slot picker (B) does NOT consume the\n"
      + "   capsule (you return to the shop with it still offered).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    onBattleStart: () => {
      const player = globalScene.getPlayerPokemon();
      if (!player) {
        return;
      }
      // Force recognizable abilities into the 3 innate slots so the picker + Abilities
      // panel show clear rows (Innate 1 = STURDY, 2 = DRIZZLE, 3 = MOXIE).
      player.setAbilityOverrideForSlot(1, AbilityId.STURDY);
      player.setAbilityOverrideForSlot(2, AbilityId.DRIZZLE);
      player.setAbilityOverrideForSlot(3, AbilityId.MOXIE);
      // No candy innate unlock: every innate slot starts LOCKED, so the capsule's
      // run-unlock is the only way to light one up this run (classic mode, so no
      // Youngster free-innate slots interfere). Leaving passiveAttr at 0 is also what
      // makes starter-select keep showing the innate LOCKED after the run-unlock.
      const sd = globalScene.gameData.starterData;
      const root = player.species.getRootSpeciesId();
      if (sd[root]) {
        sd[root].passiveAttr = 0;
      }
      player.updateInfo();
    },
    shopItems: [modifierTypes.ER_ABILITY_CAPSULE],
  },
  // ===========================================================================
  // Item - Greater Ability Capsule (violet reskin; ULTRA tier): permanently unlock
  // ONE innate, OR run-unlock TWO innates for the run.
  // ===========================================================================
  {
    label: "Greater Ability Capsule: permanent vs run-unlock",
    description:
      "The GREATER ABILITY CAPSULE (a VIOLET reskin of the Ability Capsule, ULTRA tier)\n"
      + "offers a stronger CHOICE. Garchomp has three recognizable innates forced into its\n"
      + "slots (Innate 1 = STURDY, 2 = DRIZZLE, 3 = MOXIE), NO candy unlock - all LOCKED.\n"
      + "DO: KO Magikarp; in the FIRST shop take a GREATER ABILITY CAPSULE (violet) and APPLY\n"
      + "it to Garchomp. Two options:\n"
      + " (A) 'Permanently unlock an innate' - pick a LOCKED innate (e.g. Innate 1 STURDY).\n"
      + " (B) 'Unlock two innates for the run' - pick TWO locked innates, one after the other\n"
      + "     (e.g. Innate 2 DRIZZLE then Innate 3 MOXIE).\n"
      + "EXPECT for (A) - the PERMANENT unlock:\n"
      + " - That innate is LIVE this run (Info -> Abilities (R): the picked Innate row reads\n"
      + "   LIVE, not 'Innate (Locked)'; STURDY survives a lethal hit at 1 HP).\n"
      + " - It is PERMANENT: EXIT to title -> starter select -> Garchomp shows that SAME innate\n"
      + "   as UNLOCKED (selectable, not greyed), and a future run starts it unlocked - exactly\n"
      + "   like a candy innate unlock.\n"
      + "EXPECT for (B) - the RUN-unlock (two slots):\n"
      + " - BOTH picked innates are LIVE this run (Info -> Abilities: both rows read LIVE).\n"
      + " - It is RUN-ONLY: in starter-select those innates STILL read LOCKED (no permanent\n"
      + "   unlock written), and a future run starts them locked again. It survives a mid-run\n"
      + "   reload (Save & Quit -> Continue).\n"
      + " - Backing out of the option-select or either slot pick does NOT consume the capsule.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    onBattleStart: () => {
      const player = globalScene.getPlayerPokemon();
      if (!player) {
        return;
      }
      // Recognizable innates so the picker + Abilities panel show clear rows.
      player.setAbilityOverrideForSlot(1, AbilityId.STURDY);
      player.setAbilityOverrideForSlot(2, AbilityId.DRIZZLE);
      player.setAbilityOverrideForSlot(3, AbilityId.MOXIE);
      // No candy innate unlock: every innate starts LOCKED. This is also what makes the
      // RUN-unlock (B) keep showing LOCKED in starter-select, and lets the PERMANENT
      // unlock (A) flip the picked slot to UNLOCKED there.
      const sd = globalScene.gameData.starterData;
      const root = player.species.getRootSpeciesId();
      if (sd[root]) {
        sd[root].passiveAttr = 0;
      }
      player.updateInfo();
    },
    shopItems: [modifierTypes.ER_GREATER_ABILITY_CAPSULE, modifierTypes.ER_GREATER_ABILITY_CAPSULE],
  },
  // ===========================================================================
  // Item - Greater Ability Randomizer (pink reskin; MASTER tier): pick a slot, then
  // choose 1 of 4 random abilities to replace it (run-only, no lock cost).
  // ===========================================================================
  {
    label: "Greater Ability Randomizer: pick 1 of 4",
    description:
      "The GREATER ABILITY RANDOMIZER (a PINK reskin of the Ability Randomizer, MASTER tier)\n"
      + "is Curiosity's reward half, simplified: you choose the slot AND choose the ability.\n"
      + "DO: KO Magikarp; in the FIRST shop take a GREATER ABILITY RANDOMIZER (pink) and APPLY\n"
      + "it to Garchomp.\n"
      + " 1) Pick ANY of Garchomp's ability/innate slots (active Sand Veil, or Innate 1/2/3).\n"
      + " 2) A chooser shows FOUR random abilities WITH descriptions (the same Bargain-styled\n"
      + "    picker Curiosity uses, with 4 rows). Pick one.\n"
      + "EXPECT:\n"
      + " - The chosen ability REPLACES the picked slot (Info -> Abilities (R), or SUMMARY:\n"
      + "   that slot now shows the picked ability and it fires in battle).\n"
      + " - It is RUN-ONLY: NO permanent dex unlock is written - in starter-select Garchomp's\n"
      + "   abilities/innates are unchanged, and a future run is back to normal. It survives a\n"
      + "   mid-run reload (Save & Quit -> Continue).\n"
      + " - There is NO lock cost (unlike Curiosity, nothing is disabled).\n"
      + " - Backing out of the slot pick or the 4-ability chooser does NOT consume the item.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    onBattleStart: () => {
      const player = globalScene.getPlayerPokemon();
      if (!player) {
        return;
      }
      // Recognizable innates so a REPLACE on an innate slot is easy to see in the panel.
      player.setAbilityOverrideForSlot(1, AbilityId.STURDY);
      player.setAbilityOverrideForSlot(2, AbilityId.DRIZZLE);
      player.setAbilityOverrideForSlot(3, AbilityId.MOXIE);
      player.updateInfo();
    },
    shopItems: [modifierTypes.ER_GREATER_ABILITY_RANDOMIZER, modifierTypes.ER_GREATER_ABILITY_RANDOMIZER],
  },
  // Co-op - ER ability-picker shop softlock (#633 B9c). Single-client stages the shop + the item;
  // the two-client divergence/softlock is the (note) part that needs a REAL session.
  {
    label: "(note) Co-op: Ability Capsule in shop, no softlock (#633)",
    description:
      "#633 co-op ER ABILITY-PICKER SHOP SOFTLOCK - the LIVE bug (build mqv07ocq). A player uses an\n"
      + "ER ABILITY CAPSULE (or Greater Ability Capsule / Greater Ability Randomizer) in the co-op\n"
      + "reward shop to unlock an innate / cycle an ability FOR THE RUN. THE BUG: BOTH clients ran\n"
      + "ErAbilityCapsulePhase and opened their OWN ability picker; they picked INDEPENDENTLY -> the\n"
      + "two runs DIVERGED -> the GUEST hung awaiting reward options the HOST (already advanced) never\n"
      + "sent = SHOP SOFTLOCK.\n"
      + "THE FIX (B9c): only the shop OWNER drives the picker + rolls RNG, then relays the resolved\n"
      + "OUTCOME on the shop's interaction seq (the SAME owner/watcher channel reward picks use). The\n"
      + "WATCHER never opens a picker (and the randomizer watcher never rolls RNG) - it applies the\n"
      + "owner's LITERAL outcome. EVERY owner end-path (the cycle/run-unlock commit OR any cancel /\n"
      + "guard / mon-vanished) relays an outcome (CANCEL when nothing committed), so the watcher never\n"
      + "stalls; on the owner's CANCEL the watcher re-enters the shop watch via its surviving\n"
      + "continuation copy (the capsule is re-offered, NOT consumed - back-out safe #25).\n"
      + "DO (single client, just to reach the item): KO Magikarp; in the FIRST shop take the ER ABILITY\n"
      + "CAPSULE and apply it to Garchomp - pick 'Change ability' OR 'Unlock an innate for the run', AND\n"
      + "separately try BACKING OUT (cancel) of the choice. EXPECT (single client): the capsule works\n"
      + "exactly as in solo - the ability cycles / the innate run-unlocks, and a cancel re-offers the\n"
      + "capsule un-consumed. DO (needs a REAL 2-client AUTHORITATIVE session on staging): on each\n"
      + "player's alternation turn, have the OWNER use the Ability Capsule and pick an ability; EXPECT\n"
      + "BOTH clients show the SAME ability/innate on that mon, the shop continues for both with NO hang,\n"
      + "and an owner CANCEL re-offers the capsule on both sides. VERIFY no [coop-desync] / no stall.\n"
      + "(Regression unit test: test/tests/elite-redux/coop/coop-ability-picker-relay.test.ts.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    shopItems: [modifierTypes.ER_ABILITY_CAPSULE],
  },
  // Co-op - shop "Check Team" party-mutation relay (#633 B9b)
  {
    label: "(note) Co-op: shop Check Team mutations sync (2 clients)",
    description:
      "#633 co-op SHOP CHECK-TEAM RELAY (B9b) - the LIVE desync. In the co-op reward shop the OWNER\n"
      + "opens 'Check Team' (the party screen) and reorders / gives to partner / releases / unsplices /\n"
      + "renames / unpauses-evolution / toggles a form-change item (mega stone) on the SHARED party.\n"
      + "THE BUG: that mutation applied ONLY on the owner's client. Party order/length/speciesId,\n"
      + "formIndex, abilityId, and the held-item (persistent-modifier) set are ALL in the per-turn\n"
      + "checksum, so an owner-only Check-Team change flipped the watcher's checksum -> resync storm,\n"
      + "and an on-field RELEASE / form toggle visibly diverged the field.\n"
      + "THE FIX: the OWNER relays each resolved Check-Team mutation on the shop's interaction seq (the\n"
      + "SAME owner/watcher channel reward picks use, action code COOP_ACT_CHECK). The WATCHER never\n"
      + "opens the party screen; it applies each relayed op verbatim against its identical party - a\n"
      + "RELEASE strips the SAME held items + splices the SAME mon (so the modifier multiset converges),\n"
      + "a form toggle resolves the SAME item index + fires the identical form-change trigger.\n"
      + "DO (single client, just to reach the screen): KO Magikarp; in the FIRST shop open Check Team and\n"
      + "try each action - Move (reorder) two mons, Release a benched mon, Rename one, toggle Charizard's\n"
      + "mega stone (Form-Change Item). EXPECT (single client): every action behaves exactly as in solo\n"
      + "- the form toggles, the release removes the mon and its items, the reorder sticks.\n"
      + "DO (needs a REAL 2-client AUTHORITATIVE session on staging): on the OWNER's alternation turn,\n"
      + "perform each Check-Team action; EXPECT BOTH clients show the SAME party order, the SAME mon\n"
      + "released (and the same held-items gone), the SAME on-field form, the SAME nickname, with NO\n"
      + "[coop-desync] lines and no resync storm. VERIFY the post-shop checksum matches on both sides.\n"
      + "(Regression unit test: test/tests/elite-redux/coop/coop-shop-check-ops.test.ts.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      // A Charizard lead (its mega stone is the Form-Change Item to toggle in Check Team) plus a
      // bench so reorder / release / rename / give have real targets.
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.DRAGON_PULSE, MoveId.ROOST],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
      ];
    },
    onBattleStart: () => {
      // Flip the live run into co-op so the Check-Team relay gates engage (the relay no-ops outside
      // co-op). Host = slots 0-2; with a single local client this is the spoof/host-owner path, so the
      // relay sends are inert here - the 2-client convergence is the (note) part validated on staging.
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username });
      }
      const party = globalScene.getPlayerParty();
      party.forEach((mon, i) => {
        mon.coopOwner = i < 3 ? "host" : "guest";
      });
      console.log(
        "[#633 co-op B9b Check-Team] tags: "
          + party.map(m => `${m.getNameToRender()}=${m.coopOwner}`).join(", ")
          + " (open Check Team in the first shop; on 2 clients the owner's mutations should mirror to the watcher)",
      );
    },
    shopItems: [modifierTypes.FORM_CHANGE_ITEM],
  },
  // Co-op - shop Check-Team RELEASE strips held items + on-field form toggle (#633 B9b, checksum-critical)
  {
    label: "(note) Co-op: Check Team release + on-field form sync (2 clients)",
    description:
      "#633 co-op B9b - the two CHECKSUM-CRITICAL Check-Team ops, isolated. A RELEASE in Check Team must\n"
      + "strip the released mon's HELD ITEMS (persistent modifiers, hashed as a multiset) AND splice it,\n"
      + "exactly like the owner - a look-alike removal that leaves the items behind would mismatch the\n"
      + "checksum. A FORM-CHANGE-ITEM toggle on the ON-FIELD lead changes formIndex (hashed), so it must\n"
      + "be relayed or the field forms diverge.\n"
      + "DO (single client, to reach the screen): KO Magikarp; in the FIRST shop open Check Team, toggle\n"
      + "Charizard's mega stone (Form-Change Item) ON (it megas in place), then RELEASE the benched\n"
      + "Gyarados (which is holding the Leftovers given below). EXPECT (single client): Charizard megas;\n"
      + "Gyarados and its Leftovers are gone.\n"
      + "DO (needs a REAL 2-client AUTHORITATIVE session on staging): on the OWNER's alternation turn,\n"
      + "toggle the on-field mega and release the item-holder. EXPECT BOTH clients show the SAME on-field\n"
      + "form (mega vs base) AND the SAME held-item set after the release (the released mon's Leftovers\n"
      + "gone on BOTH), with NO [coop-desync] and a matching post-shop checksum.\n"
      + "(Regression unit test: test/tests/elite-redux/coop/coop-shop-check-ops.test.ts - the RELEASE\n"
      + "convergence test asserts the held-item multiset is stripped, catching the look-alike-removal gap.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.DRAGON_PULSE, MoveId.ROOST],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
      ];
    },
    onBattleStart: () => {
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username });
      }
      const party = globalScene.getPlayerParty();
      party.forEach((mon, i) => {
        mon.coopOwner = i < 3 ? "host" : "guest";
      });
      // Hand the benched Gyarados a persistent held item so the RELEASE must strip it (the
      // checksum-multiset convergence the unit test asserts).
      const holder = party[1];
      if (holder != null) {
        const item = modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS).newModifier(holder);
        if (item != null) {
          globalScene.addModifier(item, true);
        }
      }
      console.log(
        "[#633 co-op B9b release+form] tags: "
          + party.map(m => `${m.getNameToRender()}=${m.coopOwner}`).join(", ")
          + " (toggle Charizard's mega + release the Leftovers-holding Gyarados in the first shop's Check Team)",
      );
    },
    shopItems: [modifierTypes.FORM_CHANGE_ITEM],
  },
  // ===========================================================================
  // CO-OP DESYNC FIXES (#698) - live-report batch: faint deadlock, alternation,
  // move-learn forward, money sync. The netcode flows need 2 real clients; these
  // set up the host-side party + ownership split and tell the tester what to verify.
  // ===========================================================================
  {
    label: "Co-op: guest faint at hp=1 enemy survives - no false win (BUG1)",
    description:
      "BUG1 co-op FAINT AUTO-SWITCH PREMATURE-VICTORY DEADLOCK - in the authoritative\n"
      + "co-op forced-DOUBLE, the host is the sole engine and the guest is a pure renderer\n"
      + "that replays the host's turn then snaps to the per-turn checkpoint. The guest used\n"
      + "to ALSO run its OWN damaging end-of-turn phases (weather / TurnEnd chip damage). On\n"
      + "the turn the guest's mon faints while ONE enemy survives at hp=1 on the host, that\n"
      + "local engine chipped the hp=1 enemy to 0 -> a LOCAL FaintPhase -> a premature\n"
      + "VictoryPhase / BattleEnd the host never resolved. The guest parked as a reward\n"
      + "watcher while the host correctly continued to turn 2 and awaited the guest's move:\n"
      + "a hard DEADLOCK (host waits for the guest, guest waits for the host).\n"
      + "DO: turn on sandstorm is preset; take ONE turn. Let the RIGHT (guest, Gengar) lead\n"
      + "FAINT this turn (the foe hits hard), and leave at least one enemy alive at low hp so\n"
      + "the chip damage would have finished it locally on the buggy build. Watch BOTH clients\n"
      + "after the turn resolves.\n"
      + "EXPECT: NO victory / reward screen on the guest, NO BattleEnd. The fainted guest mon\n"
      + "is removed and its bench replacement (Alakazam) is auto-sent in by the host; the run\n"
      + "advances to turn 2 on BOTH clients and the guest is prompted for its turn-2 move (no\n"
      + "300s hang). A real wave win must arrive ONLY when the host actually KOs the last\n"
      + "enemy and streams waveResolved - never from the guest's local turn-end. The headless\n"
      + "regression lives in test/tests/elite-redux/coop/coop-guest-faint-no-local-victory.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        STARTING_WAVE_OVERRIDE: 5,
        BATTLE_STYLE_OVERRIDE: "double",
        WEATHER_OVERRIDE: WeatherType.SANDSTORM,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MACHAMP,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_MOVESET_OVERRIDE: [MoveId.CLOSE_COMBAT],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.FALSE_SWIPE],
        }),
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.FOCUS_BLAST, MoveId.RECOVER],
        }),
      ];
    },
    onBattleStart: () => {
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username });
      }
      const party = globalScene.getPlayerParty();
      party.forEach((mon, i) => {
        mon.coopOwner = i < 3 ? "host" : "guest";
      });
      console.log(
        "[BUG1 co-op faint] tags: "
          + party.map(m => `${m.getNameToRender()}=${m.coopOwner}`).join(", ")
          + ` | local role=${getCoopController()?.role} `
          + "(let the RIGHT guest mon faint with an enemy alive at low hp; expect NO local victory)",
      );
    },
  },
  {
    label: "Co-op: level-up move-learn on partner mon (#633 BUG3+5)",
    description:
      "#633 BUG3+5 - AUTHORITATIVE co-op. The GUEST-owned mon (party slot 2) learns a\n"
      + "new move by LEVEL-UP after the opening battle while holding a FULL moveset, so the\n"
      + "move-forget menu must open. Before this fix the HOST hung forever awaiting a pick\n"
      + "the guest (a pure renderer) never sent, and the WebRTC peer eventually dropped.\n"
      + "DO (2 paired clients, authoritative netcode): win the opening battle so slot-2\n"
      + "(the partner's mon) levels up and tries to learn a move with all slots full.\n"
      + "EXPECT: the move-forget picker opens on the GUEST (the mon's owner), the HOST shows\n"
      + "the same picker read-only and MIRRORS the guest's cursor, and after the guest picks\n"
      + "(or cancels = keep current moves) BOTH clients advance to the reward shop. It must\n"
      + "NOT freeze on either client. If the guest idles/disconnects, the host keeps the\n"
      + "mon's current moves after a bounded wait and still advances (no hang).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 5,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 30,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.THUNDER_WAVE],
        }),
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.TACKLE, MoveId.SAND_ATTACK, MoveId.DRAGON_RAGE, MoveId.BITE],
        }),
      ];
    },
    onBattleStart: () => {
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username });
      }
      const party = globalScene.getPlayerParty();
      if (party[0]) {
        party[0].coopOwner = "host";
      }
      if (party[1]) {
        party[1].coopOwner = "guest";
      }
    },
  },
  {
    label: "Co-op: Learner's Shroom on partner mon (#633 BUG3+5)",
    description:
      "#633 BUG3+5 - AUTHORITATIVE co-op. Use LEARNER'S SHROOM on the PARTNER'S (guest-\n"
      + "owned) full-moveset mon. Before this fix BOTH clients queued a LearnMovePhase: the\n"
      + "host computed WATCHER and hung awaiting a pick, and the guest (a pure renderer) could\n"
      + "not drive its own move-forget menu, so the human was stuck on the learn screen.\n"
      + "DO (2 paired clients, authoritative netcode): win the opening battle, take the\n"
      + "LEARNER'S SHROOM in the first shop, and use it on the GUEST-owned mon (slot 2),\n"
      + "choosing a move it does not yet know so the forget menu opens.\n"
      + "EXPECT: the move-forget picker opens on the GUEST (the owner) - the human CAN pick a\n"
      + "move to forget (or cancel = keep current moves). The HOST mirrors the cursor read-\n"
      + "only. The picker opens EXACTLY ONCE (no double menu). BOTH clients then advance. It\n"
      + "must NOT freeze and the guest must NOT be stuck unable to act.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.THUNDER_WAVE],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
    onBattleStart: () => {
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username });
      }
      const party = globalScene.getPlayerParty();
      if (party[0]) {
        party[0].coopOwner = "host";
      }
      if (party[1]) {
        party[1].coopOwner = "guest";
      }
    },
    shopItems: [modifierTypes.ER_LEARNERS_SHROOM],
  },
  {
    label: "Co-op: reward-shop alternation stays in sync (note, BUG2)",
    description:
      "BUG2 reward-shop alternation drift. CO-OP ONLY (needs two clients - host + guest).\n"
      + "DO: start a 2-player co-op run. Play through several waves so you hit a sequence of\n"
      + "reward shops AND at least one mystery encounter, watching the inter-wave boundary (a\n"
      + "checksum resync can fire there). On EACH reward shop note who is allowed to pick (the\n"
      + "OWNER) and who is the WATCHER.\n"
      + "EXPECT: ownership strictly ALTERNATES host -> guest -> host -> ... across consecutive\n"
      + "shops, and on every shop EXACTLY ONE client drives (never 'both pick' / 'someone\n"
      + "chooses twice', never 'nobody can pick'); the watcher's cursor mirrors the owner's\n"
      + "real picks. Specifically: at a reward shop right after the previous interaction's\n"
      + "advance (and across a wave-boundary resync) the two clients must agree on the owner -\n"
      + "they must NOT drift one apart (host pins parity 0 / guest pins parity 1 -> both drive).\n"
      + "Verify in console: '[coop:interaction] CoopInteractionTurn.mergeRemote DEFER ...'\n"
      + "appears for inbound broadcasts (live counter NOT bumped on receipt) and the catch-up\n"
      + "'CoopInteractionTurn.advance catch-up (pendingRemote=...)' only folds in at a LOCAL\n"
      + "advance. Headless regression: test/tests/elite-redux/coop/coop-interaction-sync.test.ts\n"
      + "(REWARD-SHOP PIN IMMUNE / GENUINE CATCH-UP / RESYNC-INTERLEAVE). This is a manual\n"
      + "two-client check; the trivial battle below is only a launch shell for the banner.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 20,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.THUNDER_WAVE],
        }),
      ];
    },
  },
  {
    label: "Co-op: money sync - reward shop reroll/buy (note, BUG4)",
    description:
      "BUG4 #698. Two-client AUTHORITATIVE co-op (host = battle engine, guest = renderer).\n"
      + "After winning the opening battle, in the reward shop the OWNER REROLLS once and then\n"
      + "BUYS a shop item. EXPECT: the money counter is byte-identical on BOTH screens\n"
      + "immediately after each reroll AND each purchase - no one-wave lag, and no\n"
      + "'[coop:heal] money host=.. guest=..' resync warning on the next turn. Pre-fix the\n"
      + "guest lagged a whole wave (checkpoint money is captured at turn-end, before the shop\n"
      + "runs) and the watcher re-deducted its OWN reroll/shop cost, so a resync landing\n"
      + "between the checkpoint and the relayed reroll double-deducted (capture: host=750 while\n"
      + "guest=500). Fix: the host streams its exact post-spend money on the relayed pick; the\n"
      + "watcher SETS money verbatim instead of recomputing. VERIFY against dev-logs: the guest\n"
      + "capture for the shop wave must contain NO '[coop:heal] money host=.. guest=..' line.\n"
      + "Manual two-client check on staging; the trivial battle below is only a launch shell.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 20,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.THUNDER_WAVE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Bleed (ER dex spec): non-move heals don't cure it + it survives a switch-out
  // ===========================================================================
  {
    label: "Bleed: persists on switch, cured ONLY by a heal move",
    description:
      "Bleed (ER dex) spec, two FIXED behaviors. Your Snorlax has Blood Stain (ABILITY\n"
      + "override) so it re-bleeds itself every turn-end - a perpetual test subject\n"
      + "(Normal type, so bleedable). It holds Leftovers; Blissey is benched.\n"
      + "EXPECT each turn: a ~1/16 max-HP chip ('hurt by its bleeding').\n"
      + "FIX 1 - non-move heals do NOT cure it: your Leftovers (and any item / terrain /\n"
      + "ability heal) restores NOTHING while bled and the bleed STAYS. Only a healing\n"
      + "MOVE removes it - use RECOVER or REST: it heals nothing, prints 'bleeding was\n"
      + "healed!', and clears the bleed (Blood Stain re-applies it next turn-end - so\n"
      + "you'll be bled again, that's expected).\n"
      + "FIX 2 - survives switching: switch Snorlax OUT to Blissey then back IN - the\n"
      + "bleed is STILL on Snorlax (before the fix, switching wiped it). A different\n"
      + "status (poison via Blissey's Toxic) also does NOT clear it. Rock/Ghost types\n"
      + "can never be bled.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145, // past the #419 BST cap so Snorlax stays Snorlax
        STARTING_LEVEL_OVERRIDE: 50,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.BLOOD_STAIN),
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY, // bulky + feeble: lets the bleed tick for many turns
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: [MoveId.GROWL],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.RECOVER, MoveId.REST, MoveId.PROTECT, MoveId.BODY_SLAM],
        }),
        makeStarter(SpeciesId.BLISSEY, {
          moveset: [MoveId.SOFT_BOILED, MoveId.SEISMIC_TOSS, MoveId.PROTECT, MoveId.TOXIC],
        }),
      ];
    },
  },
  // ===========================================================================
  // Double-battle lone survivor recenters (the rival "+32 sprite shift" fix)
  // ===========================================================================
  {
    label: "Double battle: lone surviving foe recenters (no +32 shift)",
    description:
      "Rival sprite-shift fix. In a DOUBLE battle, when ONE foe faints and nothing\n"
      + "switches into its slot, the lone survivor used to STAY shifted to its side\n"
      + "(+32px right / -32px left) instead of recentering - the 'rival sprite shifted\n"
      + "entirely to the right' bug (it hit mons that never evolved, so it was NOT an\n"
      + "evolution issue). Here you face TWO frail foes in a forced double.\n"
      + "DO: KO exactly ONE of the two foes (your fast L100 lead one-shots; leave the\n"
      + "other alive - have the second mon PROTECT).\n"
      + "EXPECT: the surviving foe slides to the CENTER of the field, not stuck off to\n"
      + "one side. (The player's lone survivor already recentered; this fixes the enemy\n"
      + "side to match.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP, // frail - a single hit OHKOs one foe
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.GROWL],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.PROTECT, MoveId.REST, MoveId.TACKLE],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.PROTECT, MoveId.NUZZLE, MoveId.SURF],
        }),
      ];
    },
  },
  // ===========================================================================
  // Notes (dex / reward-pool / UI fixes that aren't shown in a single battle)
  // ===========================================================================
  {
    label: "(note) Greater Ability Randomizer rarity (Master Ball tier)",
    description:
      "Reward-pool weight fix (not battle-testable). The ER Greater Ability Randomizer\n"
      + "was weight 8 in the Master Ball reward tier, so it appeared far too often.\n"
      + "Lowered to weight 2 to match its sibling Greater Ability Capsule.\n"
      + "CHECK: over many Master Ball-tier reward rolls it now shows up about as often\n"
      + "as the Greater Ability Capsule, not dominating the tier.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.TACKLE] }),
      ];
    },
  },
  {
    label: "(note) Starter line shares candy + passive (Pichu/Pikachu/Raichu)",
    description:
      "Pokedex candy/passive linking fix (dex/UI, not battle-testable). Candy and\n"
      + "passive/ability unlocks are stored on the evolution line's ROOT (e.g. Pichu),\n"
      + "but the Pokedex read them off a per-stage key, so a line member (Raichu) showed\n"
      + "0 candy / a locked passive even after you paid on another member, and unlocking\n"
      + "the passive on Raichu did not show on Pichu. The Pokedex now reads the SAME\n"
      + "root key the storage pools under (getRootStarterSpeciesId).\n"
      + "CHECK: in the Pokedex, every member of a line (Pichu/Pikachu/Raichu, the Burmy\n"
      + "line, etc.) shows the SAME candy count and the SAME passive/ability unlock\n"
      + "state; unlocking a passive on one member shows it unlocked on all.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.RAICHU, { moveset: [MoveId.THUNDERBOLT, MoveId.SURF, MoveId.NUZZLE, MoveId.PROTECT] }),
      ];
    },
  },
  {
    label: "(note) Giratina Bargain shows the correct ability description",
    description:
      "Bargain ability-description fix (UI/data, not battle-testable). The Giratina\n"
      + "Bargain ability pickers (Curiosity / Greater Ability Randomizer) pulled the ROM\n"
      + "'Detail' text, a few blocks of which are shifted (e.g. Arctic Fur rendered\n"
      + "Spectralize's text). It now uses the SAME short ability description the in-game\n"
      + "summary shows, which is correct.\n"
      + "CHECK: in a Giratina Bargain ability picker, each ability's description matches\n"
      + "what the Pokemon summary's Abilities page shows for that ability (e.g. Arctic\n"
      + "Fur: 'Weakens incoming physical and special moves by 35%').",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.TACKLE] }),
      ];
    },
  },
  // Co-op - GUEST sees the catch animation + "caught!" line (#689)
  {
    label: "Co-op: guest catch animation + caught! (#689)",
    description:
      "#689 co-op GUEST CATCH PRESENTATION - the HOST runs AttemptCapturePhase (ball throw +\n"
      + "shake + capture stars + 'X was caught!'); the authoritative GUEST is a pure renderer that\n"
      + "never runs it, so its catch was SILENT (the mon just appeared in the party). The host now\n"
      + "streams a tiny cosmetic presentation on waveResolved('capture') and the guest plays the\n"
      + "ball animation + a LOCALLY-localized 'caught!' line via a hardened CoopCaptureReplayPhase.\n"
      + "TWO CLIENTS (host + guest): a single wild Pidgey at low HP, your lead holds Poke Balls.\n"
      + "DO: on the HOST, weaken the wild mon (a soft hit) then throw a Poke Ball and catch it.\n"
      + "EXPECT (GUEST screen): the GUEST now SEES a ball thrown in, capture stars, and a\n"
      + "'Pidgey was caught!' line in the GUEST's language - NOT a silent party grow. The mon still\n"
      + "lands in both parties (the handshake is unchanged), the message shows EXACTLY ONCE (no\n"
      + "double 'caught!'), and nothing hangs. A CHALLENGE-BLOCKED catch (if a roster challenge is\n"
      + "active) shows NO guest 'caught!' line (host-gated). Console (host): a single\n"
      + "[coop:replay] host SEND waveResolved ... cap=sp<id> line.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        BATTLE_STYLE_OVERRIDE: "single",
        // A wild single battle with a frail catchable foe; plenty of Poke Balls to throw.
        ENEMY_SPECIES_OVERRIDE: SpeciesId.PIDGEY,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.FALSE_SWIPE, MoveId.TACKLE, MoveId.REST, MoveId.BODY_SLAM],
        }),
      ];
    },
    onBattleStart: () => {
      // Flip the live run into authoritative co-op so the host's capture broadcast carries the
      // new cosmetic presentation. On the HOST client this scenario tags the lead as host-owned;
      // pair with a real GUEST client to watch CoopCaptureReplayPhase render the catch.
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username, netcodeMode: "authoritative" });
      }
      const party = globalScene.getPlayerParty();
      for (const mon of party) {
        mon.coopOwner = "host";
      }
      console.log(
        "[#689 co-op catch-anim] local role="
          + getCoopController()?.role
          + " (HOST: weaken the wild Pidgey then throw a Poke Ball; the GUEST client should SEE the"
          + " ball + capture stars + a localized 'caught!' line - previously silent)",
      );
    },
  },
  // Co-op - GUEST regenerates "X used Y!" / "X fainted!" in its OWN language (#691)
  {
    label: "Co-op: guest move/faint lines in its own language (#691)",
    description:
      "#691 host-language leak. In authoritative co-op all battle narration is recorded AFTER the\n"
      + "host localizes it, so the guest used to read EVERY line in the HOST's language. This fix has\n"
      + "the guest REGENERATE the two dominant lines ('X used Y!' and 'X fainted!') in its OWN\n"
      + "language from the structured moveUsed/faint events, and the host stops streaming its host-\n"
      + "language duplicate of exactly those two lines.\n"
      + "SETUP (two clients): Client A = HOST, set Language = Deutsch (German) in Options. Client B =\n"
      + "GUEST, set Language = English. Pair them into an AUTHORITATIVE co-op session and launch this\n"
      + "scenario.\n"
      + "DO: on the HOST, have a player mon use Tackle on the frail Magikarp so it faints. Watch the\n"
      + "GUEST's battle log.\n"
      + "EXPECT (GUEST, in ENGLISH): 'Snorlax used Tackle!' then 'The opposing Magikarp fainted!' -\n"
      + "NOT the German 'setzt Tackle ein!' / 'wurde besiegt!'. The HOST still sees its own German\n"
      + "lines. KNOWN BOUNDED SCOPE: other lines (stat-stage, status, weather, ability/item, miss/\n"
      + "crit/super-effective, and a Magic-Coat REFLECTED move) may STILL show in German on the guest\n"
      + "- only the two highest-volume lines are relocalized.\n"
      + "ALSO VERIFY (no regression): the battle stays in sync (no resync storm) - the regenerated\n"
      + "lines are purely cosmetic (NOT in the per-turn checksum); an ignoreFaintPhase KO shows NO\n"
      + "extra faint line on the guest; a captured (not KO'd) mon shows NO spurious 'fainted!' line.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        BATTLE_STYLE_OVERRIDE: "double",
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.THUNDER_WAVE],
        }),
      ];
    },
    onBattleStart: () => {
      // Flip the live run into authoritative co-op so the host RECORDS its turn with the new move/
      // faint message suppression. Pair with a real GUEST client (set to a different language) to
      // confirm the guest regenerates the two dominant lines in ITS locale.
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username, netcodeMode: "authoritative" });
      }
      const party = globalScene.getPlayerParty();
      if (party[0]) {
        party[0].coopOwner = "host";
      }
      if (party[1]) {
        party[1].coopOwner = "guest";
      }
    },
  },
  // Co-op - WATCHER does not hang on a TM/Memory reward shop the host already left (#698)
  {
    label: "Co-op: watcher survives a TM-Case reward + continue (#698)",
    description:
      "#698 stale-reward-shop softlock. CO-OP ONLY (2 clients, authoritative). When the OWNER takes a\n"
      + "reward that opens a move-learn (TM Case, Memory Mushroom, Learner's Shroom), the shop queues a\n"
      + "back-out copy that the host removes inside the move-learn but the guest's no-op move-learn did\n"
      + "NOT - so the WATCHER re-entered a reward shop the host already left and HUNG on a stale shop (the\n"
      + "resync that should rescue it was blocked behind that hang).\n"
      + "DO (2 paired clients, authoritative netcode): win the opening battle. On the OWNER of the reward\n"
      + "shop, take the TM CASE reward and teach a move (or cancel), then CONTINUE to the next wave.\n"
      + "EXPECT: the WATCHER advances to the next wave too - it must NOT get stuck on the reward screen.\n"
      + "The move-learn picker still relays/opens exactly once; both clients reach the next encounter.\n"
      + "Headless regression: test/tests/elite-redux/coop/coop-shop-continuation-orphan.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 30,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL, MoveId.THUNDER_WAVE],
        }),
      ];
    },
    onBattleStart: () => {
      globalScene.gameMode = getGameMode(GameModes.COOP);
      if (getCoopController() == null) {
        startLocalCoopSession({ username: loggedInUser?.username, netcodeMode: "authoritative" });
      }
    },
    shopItems: [modifierTypes.TM_CASE],
  },
  // Greater Ability Capsule permanently unlocks an innate even when it is only run-free
  {
    label: "Greater Ability Capsule: permanent unlock works on a run-free innate",
    description:
      "Greater Ability Capsule wrongly said 'no effect' on every Pokemon when its innates\n"
      + "were already FREE for the run (Youngster mode, or after a normal Ability Capsule).\n"
      + "The PERMANENT-unlock option keyed off the run-unlockable set, which is empty once an\n"
      + "innate is run-free - so it offered nothing even though the innate was never\n"
      + "PERMANENTLY (candy) unlocked. Fixed: option (A) now keys off the permanent passiveAttr.\n"
      + "DO: KO the Magikarp. This scenario run-unlocks ALL of Garchomp's innates first turn\n"
      + "(simulating the Youngster/already-free state). On the reward screen pick the GREATER\n"
      + "ABILITY CAPSULE (violet) and target Garchomp.\n"
      + "EXPECT: it does NOT say 'no effect'. You are offered 'Permanently unlock an innate';\n"
      + "pick a slot and it permanently unlocks (stays unlocked in starter-select + future runs).\n"
      + "Regression: test/tests/elite-redux/er-greater-ability-capsule.test.ts.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 3,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    onBattleStart: () => runUnlockAllLeadInnates(),
    shopItems: [modifierTypes.ER_GREATER_ABILITY_CAPSULE],
  },
  // ===========================================================================
  // Triple battles - positional adjacency, flying/pulse bypass, Wide Guard, Shift
  // ===========================================================================
  {
    label: "TRIPLE battle: competitive 3v3 (adjacency / flying / Wide Guard / Shift)",
    description:
      "Triple battle (3 per side) with competitive teams. Exercise the new mechanics:\n"
      + "- ADJACENCY: command a WING mon (left/right) with a normal move (Earthquake / Stone\n"
      + "  Edge) - it reaches the foe OPPOSITE you + the CENTRE foe, but NOT the far diagonal.\n"
      + "  The CENTRE mon reaches ALL three foes.\n"
      + "- FLYING / PULSE BYPASS: a wing's FLYING move (Talonflame's Brave Bird) or a Pulse move\n"
      + "  hits ANY foe, ignoring position.\n"
      + "- SPREAD: Earthquake from a wing hits only the adjacent foes (and your own adjacent\n"
      + "  ally!); from the centre it hits all three.\n"
      + "- WIDE GUARD (Hitmontop) shields your WHOLE side from spread moves.\n"
      + "- SHIFT: open the Pokemon (party) menu and pick an active ALLY to SWAP field positions\n"
      + "  (consumes the turn) - e.g. move a strong mon to the centre to reach everything.\n"
      + "Your team: Garchomp / Talonflame / Hitmontop. Enemy: Garchomp / Sylveon / Metagross.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        // Past the #419 BST-cap ladder so the ~600-BST mons spawn at full strength, and
        // NOT a fixed-battle wave. 145 was RIVAL_5 - a SCRIPTED rival TRAINER fight that
        // BATTLE_TYPE_OVERRIDE can't turn wild, so it ignored the staged party and fielded
        // one rival ("3v1"). 133 is a normal wave; force it WILD so the staged 3-mon party
        // fills all three foe slots.
        STARTING_WAVE_OVERRIDE: 133,
        STARTING_LEVEL_OVERRIDE: 80,
        BATTLE_STYLE_OVERRIDE: "triple",
        BATTLE_TYPE_OVERRIDE: BattleType.WILD,
        DISABLE_STANDARD_TRAINERS_OVERRIDE: true,
      });
      // The opposing 3-mon competitive team (distinct mons + movesets). The triple
      // encounter consumes this staged party for its three on-field foes.
      setPendingDevEnemyParty([
        {
          speciesId: SpeciesId.GARCHOMP,
          level: 80,
          moveIds: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.FIRE_FANG],
        },
        {
          speciesId: SpeciesId.SYLVEON,
          level: 80,
          moveIds: [MoveId.HYPER_VOICE, MoveId.HELPING_HAND, MoveId.MYSTICAL_FIRE, MoveId.PROTECT],
        },
        {
          speciesId: SpeciesId.METAGROSS,
          level: 80,
          moveIds: [MoveId.METEOR_MASH, MoveId.BULLET_PUNCH, MoveId.EARTHQUAKE, MoveId.ICE_PUNCH],
        },
      ]);
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE],
        }),
        makeStarter(SpeciesId.TALONFLAME, {
          moveset: [MoveId.BRAVE_BIRD, MoveId.FLARE_BLITZ, MoveId.TAILWIND, MoveId.ROOST],
        }),
        makeStarter(SpeciesId.HITMONTOP, {
          moveset: [MoveId.WIDE_GUARD, MoveId.FAKE_OUT, MoveId.CLOSE_COMBAT, MoveId.SUCKER_PUNCH],
        }),
      ];
    },
  },
  {
    label: "TRIPLE: ability adjacency (Intimidate hits ADJACENT foes only)",
    description:
      "Triple battle where ALL THREE of your mons have INTIMIDATE (forced). On entry each\n"
      + "Intimidate lowers the ATTACK only of the foes it is ADJACENT to (the mainline triple\n"
      + "rule), so:\n"
      + "- The CENTRE foe is reached by all three of your mons -> Attack -3.\n"
      + "- Each WING foe (left / right) is reached by only two of your mons -> Attack -2.\n"
      + "WHAT TO DO: at battle start, open the INFO screen (Stats page) and read each foe's\n"
      + "Attack stage. EXPECT centre = -3, both wings = -2. If adjacency were broken (the old\n"
      + "all-foes behaviour) every foe would read -3.\n"
      + "The same adjacency rule now governs Scare / Terrify / Fearmonger / Cotton Down /\n"
      + "Download / Trace and the ally auras (Battery / Power Spot / Friend Guard). The foes are\n"
      + "given Ball Fetch so none are Intimidate-immune.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 133,
        STARTING_LEVEL_OVERRIDE: 50,
        BATTLE_STYLE_OVERRIDE: "triple",
        BATTLE_TYPE_OVERRIDE: BattleType.WILD,
        DISABLE_STANDARD_TRAINERS_OVERRIDE: true,
        ABILITY_OVERRIDE: AbilityId.INTIMIDATE,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
      });
      setPendingDevEnemyParty([
        { speciesId: SpeciesId.SNORLAX, level: 50, moveIds: [MoveId.SPLASH] },
        { speciesId: SpeciesId.SNORLAX, level: 50, moveIds: [MoveId.SPLASH] },
        { speciesId: SpeciesId.SNORLAX, level: 50, moveIds: [MoveId.SPLASH] },
      ]);
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.VOLT_SWITCH, MoveId.SURF, MoveId.NUZZLE],
        }),
        makeStarter(SpeciesId.EEVEE, {
          moveset: [MoveId.QUICK_ATTACK, MoveId.BITE, MoveId.SWIFT, MoveId.HELPING_HAND],
        }),
      ];
    },
  },
  {
    label: "(note) Triples Only challenge (menu-activated)",
    description:
      "MENU feature - verify from the Challenges screen, not a forced battle. New challenge\n"
      + "'Triples Only': turn it ON, start a run, and EVERY regular battle (wild AND trainer)\n"
      + "should be a 3v3 TRIPLE (finale / endless boss / mystery encounters stay single, like\n"
      + "Doubles Only). CHECK: (1) trainers send out all 3 mons; (2) Triples Only and Doubles\n"
      + "Only are MUTUALLY EXCLUSIVE - turning one on flips the other to Off (never both);\n"
      + "(3) scroll QoL - pressing UP past the 'Last Setup' header wraps to the very BOTTOM of\n"
      + "the challenge list. It must NOT disturb any Doubles-Only achievements / community\n"
      + "challenges (it is a separate challenge id). Unit-tested via the challenge -> triple\n"
      + "arrangement + the mutual-exclusion helper (er-triples-only-challenge.test.ts).",
    setup: () => {
      resetDevOverrides();
      setOverrides({ STARTING_WAVE_OVERRIDE: 1, STARTING_LEVEL_OVERRIDE: 50 });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "(note) Ghost Trainer FX: entrance + aura (editor)",
    description:
      "Ghost Trainer FX - cosmetic ENTRANCE arrival + AURA overlay for YOUR published ghost.\n"
      + "Not battle-testable in one forced fight: the effects ride on the profile that publishes\n"
      + "with YOUR runs, and you only SEE them when ANOTHER player encounters your ghost (the\n"
      + "ghost pool is server-side). So verify it in TWO parts.\n"
      + "PART 1 - the editor + the AP shop (do this now):\n"
      + "  Title -> PROFILE -> Ghost Trainer Editor. The header shows your spendable AP (the\n"
      + "  achievement-point balance). Scroll to ENTRANCE EFFECT and AURA EFFECT. Left / Right\n"
      + "  browses; a LOCKED effect is greyed and shows its AP cost. Press A on a locked effect to\n"
      + "  BUY it (AP drops, a buy sound plays, it auto-equips); press A on an owned effect to\n"
      + "  equip / unequip it (free). The preview pane re-plays the entrance every ~3s and holds\n"
      + "  the aura around the trainer sprite. PUBLISH PROFILE saves it. EXPECT: you can only buy\n"
      + "  what you can afford (an error sound otherwise), AP never goes negative, the balance and\n"
      + "  achievements are never altered (it only spends the SPENDABLE pool), and re-opening the\n"
      + "  editor re-seeds your equipped picks.\n"
      + "PART 2 - on a ghost (needs a live ghost pool): start a Ghost Trainers challenge (or reach\n"
      + "  the endgame ghost waves / the Graveyard 'Unfinished Business' ME). EXPECT a ghost whose\n"
      + "  uploader equipped FX ARRIVES with its entrance effect (rise / fog / flash / shadow /\n"
      + "  descend / dissolve - not the plain slide-in) and shows its aura overlay during the\n"
      + "  encounter. If anything is off, press Send Logs.",
    setup: () => {
      resetDevOverrides();
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM],
        }),
      ];
    },
  },
  // ===========================================================================
  // Status — ER major statuses are mutually exclusive (Frostbite blocks Bleed)
  // ===========================================================================
  {
    label: "Status: ER majors block each other (Frostbite vs Bleed)",
    description:
      "ER 2.65: the custom major statuses (Frostbite / Bleed / Fear) are MUTUALLY\n"
      + "EXCLUSIVE, exactly like vanilla non-volatile status (you cannot burn an already-\n"
      + "poisoned mon). Reported: 'frostbite being replaced by bleed when it should be\n"
      + "blocking'. Your Snorlax starts FROSTBITTEN; the foe has Blood Stain, which spreads\n"
      + "Bleed onto anything that makes contact with it.\n"
      + "DO: hit the Chansey with a CONTACT move (BODY SLAM). Blood Stain then tries to\n"
      + "inflict Bleed on your Snorlax.\n"
      + "EXPECT: Snorlax STAYS Frostbitten (the frostbite status icon is unchanged) - the\n"
      + "Bleed is BLOCKED, not applied on top of / over the frostbite. Before the fix the\n"
      + "frostbite was overwritten by bleed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: erAbility(ErAbilityId.BLOOD_STAIN),
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.EARTHQUAKE],
        }),
      ];
    },
    onBattleStart: () => {
      // Pre-frostbite the lead: the vanilla FREEZE status reroutes to ER Frostbite.
      globalScene.getPlayerPokemon()?.trySetStatus(StatusEffect.FREEZE);
    },
  },
  // ===========================================================================
  // Move — Rain Flush is non-contact (must not trigger Rough Skin), #254 class
  // ===========================================================================
  {
    label: "Move: Rain Flush is non-contact (no Rough Skin recoil)",
    description:
      "ER 2.65: Rain Flush is a special water blast with NO 'Makes Contact' flag, so it\n"
      + "must not trigger contact-punish abilities. Reported: it was proc'ing the foe's\n"
      + "Rough Skin (same class as #254). Your Snorlax has Rain Flush; the Chansey has\n"
      + "Rough Skin.\n"
      + "DO: use RAIN FLUSH on the Chansey (bulky, survives).\n"
      + "EXPECT: NO 'Rough Skin hurt its attacker!' message and your Snorlax takes NO\n"
      + "recoil from the move. (For contrast, a real contact move like BODY SLAM DOES\n"
      + "take the Rough Skin chip - try it to compare.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 50,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.ROUGH_SKIN,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [erMove(ErMoveId.RAIN_FLUSH), MoveId.BODY_SLAM, MoveId.REST, MoveId.EARTHQUAKE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability — Queen's Mourning counts holder + ally stat drops (once per stat)
  // ===========================================================================
  {
    label: "Ability: Queen's Mourning counts holder + ally drops",
    description:
      "ER 2.65: Queen's Mourning 'triggers when the user OR THEIR ALLY has their stats\n"
      + "lowered ... boosting Sp.Atk and Sp.Def by one stage', once PER STAT lowered.\n"
      + "Reported: it only counted the holder's OWN drops. DOUBLE battle; your Vespiquen\n"
      + "has Queen's Mourning and the foes have Fearmonger (Intimidate + Scare: ATK &\n"
      + "Sp.Atk -1 to your whole side on entry).\n"
      + "DO: nothing - the boost lands on entry. Open Check Team / the summary and read\n"
      + "Vespiquen's stat-stage arrows.\n"
      + "EXPECT: Vespiquen's Sp.Def is MAXED (+6) and Sp.Atk strongly boosted - it counts\n"
      + "the drops on BOTH of your mons, once per stat. Before the fix it was only about\n"
      + "+2 (its own drops, once per event).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 55,
        BATTLE_STYLE_OVERRIDE: "double",
        ABILITY_OVERRIDE: erAbility(ErAbilityId.QUEEN_S_MOURNING),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BLISSEY,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_ABILITY_OVERRIDE: erAbility(ErAbilityId.FEARMONGER),
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.VESPIQUEN, {
          moveset: [MoveId.BUG_BUZZ, MoveId.AIR_SLASH, MoveId.POWER_GEM, MoveId.ROOST],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability — Neutralizing Gas suppresses Fearmonger's entry drop (VERIFIED OK)
  // ===========================================================================
  {
    label: "(note) Neut Gas suppresses Fearmonger's entry drop",
    description:
      "VERIFIED CORRECT (no code change needed): with a Neutralizing Gas mon on the\n"
      + "field, a Fearmonger entry/switch-in's ATK & Sp.Atk drop is SUPPRESSED - at battle\n"
      + "start AND on a mid-battle switch-in, and whether Fearmonger is the active ability\n"
      + "or an innate. It is handled by the generic ability-suppression pipeline, exactly\n"
      + "like the Scare/#375 fix. Regression-checked headlessly.\n"
      + "DO: this battle has YOUR Gyarados with Fearmonger vs a Weezing with Neutralizing\n"
      + "Gas. Check the Weezing's stat arrows on entry.\n"
      + "EXPECT: the Weezing's ATK / Sp.Atk are NOT lowered (0 stages) - Fearmonger is\n"
      + "gassed. If a tester ever sees the drop LAND under active Neut Gas, Send Logs: it\n"
      + "would be a summon-ORDER case (Fearmonger entering before the Gas activates), not\n"
      + "this suppression path.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 50,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FEARMONGER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.WEEZING,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_ABILITY_OVERRIDE: AbilityId.NEUTRALIZING_GAS,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.DRAGON_DANCE],
        }),
      ];
    },
  },
  // ===========================================================================
  // Achievement — Sorry For The Wait (first-turn charge move boss KO)
  // ===========================================================================
  {
    label: "Achv: Sorry For The Wait (turn-1 charge KO)",
    description:
      "Reported: a genuine charge-turn Meteor Beam boss OHKO never granted 'Sorry For\n"
      + "The Wait'. Root cause: the tracker recorded the charge only on an impossible\n"
      + "turn value, so the achievement was UNOBTAINABLE for everyone. Your Probopass\n"
      + "has Meteor Beam (NO Power Herb - skipping the charge is excluded by design);\n"
      + "the foe is a frail boss.\n"
      + "DO: on TURN 1 use METEOR BEAM (it charges), let the beam land on turn 2 and\n"
      + "KO the boss.\n"
      + "EXPECT: the 'Sorry For The Wait' achievement pops on the KO (re-unlock is\n"
      + "forced in this scenario, so it pops even if you already own it).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ACHIEVEMENTS_REUNLOCK_OVERRIDE: true,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_HEALTH_SEGMENTS_OVERRIDE: 2,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PROBOPASS, {
          moveset: [MoveId.METEOR_BEAM, MoveId.POWER_GEM, MoveId.FLASH_CANNON, MoveId.EARTH_POWER],
        }),
      ];
    },
  },
  // ===========================================================================
  // ER ABILITY AUDIT FIXES (2026 dex-faithfulness pass) — one scenario per fix.
  // ===========================================================================
  {
    label: "Ability: Heat Sink boosts the HIGHEST attacking stat",
    description:
      "ER 2.65: Heat Sink 'Draws in Fire moves, absorbs them, and boosts the highest\n"
      + "attacking stat by one stage.' Regice has SpAtk 100 > Atk 50, so the boost must\n"
      + "go to SP. ATTACK. Reported: it always boosted Attack (the wrong stat on Regice).\n"
      + "Your Regice has Heat Sink; the foe spams Ember.\n"
      + "DO: use SPLASH and let the foe's EMBER hit you.\n"
      + "EXPECT: the Ember is ABSORBED (no damage) and Regice's SP. ATTACK rises +1 (open\n"
      + "the summary to read the arrows). Attack stays at +0.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.HEAT_SINK),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.EMBER],
      });
      return [
        makeStarter(SpeciesId.REGICE, {
          moveset: [MoveId.SPLASH, MoveId.ICE_BEAM, MoveId.THUNDERBOLT, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Last Stand scales Def/SpDef with missing HP",
    description:
      "ER 2.65: Last Stand 'Defense and Special Defense increase LINEARLY as HP drops -\n"
      + "1.0x at full HP up to 1.6x at 0% (1.3x at 50%, 1.45x at 25%).' Reported: it was a\n"
      + "flat single tier (no boost above 50%, a hard 1.6x below). Your Regirock has Last\n"
      + "Stand; the foe chips you with Body Slam.\n"
      + "DO: let the foe whittle your Regirock DOWN over several turns (use Splash / a weak\n"
      + "move). Note how much each Body Slam takes as your HP falls.\n"
      + "EXPECT: physical hits do LESS % damage the lower your HP gets - the bulk climbs\n"
      + "smoothly, not in one jump at 50%. At ~half HP it is noticeably tankier; near\n"
      + "death it is at its toughest.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.LAST_STAND),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BODY_SLAM],
      });
      return [
        makeStarter(SpeciesId.REGIROCK, {
          moveset: [MoveId.SPLASH, MoveId.STONE_EDGE, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Snow Song boosts ALL sound moves (+ Normal->Ice)",
    description:
      "ER 2.65: Snow Song 'Boosts the power of ALL sound-based moves by 20% and converts\n"
      + "Normal-type sound moves to Ice.' Reported: the 1.2x only applied to the Normal\n"
      + "sound moves (the ones being converted), not every sound move. Your Exploud has\n"
      + "Snow Song and both a Normal sound move (Hyper Voice) and a non-Normal sound move\n"
      + "(Overdrive, Electric).\n"
      + "DO: use HYPER VOICE (turns Ice, super-effective on the Dragonite) then OVERDRIVE.\n"
      + "EXPECT: BOTH sound moves hit ~20% harder than their raw power; Hyper Voice reads\n"
      + "as ICE (super effective vs Dragonite). A non-sound move (Stomping Tantrum) gets\n"
      + "no bonus - compare.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SNOW_SONG),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.DRAGONITE,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.EXPLOUD, {
          moveset: [MoveId.HYPER_VOICE, MoveId.OVERDRIVE, MoveId.STOMPING_TANTRUM, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Beautiful Music infatuates IGNORING gender",
    description:
      "ER 2.65: Beautiful Music 'Sound moves have a 50% chance to infatuate targets on\n"
      + "hit, IGNORING gender (cutting their Atk and SpAtk in half).' Reported: it used\n"
      + "vanilla infatuation, which needs the OPPOSITE gender - so a genderless or\n"
      + "same-gender foe could never be infatuated. Your Exploud has Beautiful Music; the\n"
      + "foe is a GENDERLESS Metagross.\n"
      + "DO: use HYPER VOICE (a sound move) repeatedly (~50% per hit).\n"
      + "EXPECT: within a few hits Metagross becomes INFATUATED despite being genderless,\n"
      + "and its Attack/Sp.Atk are halved while infatuated (it hits much softer). Before\n"
      + "the fix a genderless foe was never infatuated.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.BEAUTIFUL_MUSIC),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.METAGROSS,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.EXPLOUD, {
          moveset: [MoveId.HYPER_VOICE, MoveId.ECHOED_VOICE, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  {
    label: "Ability: Denting Blows drops Def only on a connecting hammer",
    description:
      "ER 2.65: Denting Blows 'Lowers the target's Defense by one stage when HITTING with\n"
      + "Hammer attacks, once per target per turn, after damage.' Reported: it queued the\n"
      + "drop even on a MISS/immune target and had no once-per-turn lock. Your Conkeldurr\n"
      + "has Denting Blows + Wood Hammer (a Hammer move) and Superpower (NOT a hammer).\n"
      + "DO: use WOOD HAMMER on the foe (it connects). Then, on another try, use SUPERPOWER.\n"
      + "EXPECT: WOOD HAMMER lowers the foe's Defense by exactly 1 (after the damage);\n"
      + "SUPERPOWER does NOT (it is not a hammer move). A hammer move that MISSES leaves\n"
      + "Defense unchanged.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.DENTING_BLOWS),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CONKELDURR, {
          moveset: [MoveId.WOOD_HAMMER, MoveId.SUPERPOWER, MoveId.MACH_PUNCH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: From the Shadows traps when moving first",
    description:
      "ER 2.65: From the Shadows 'When the user moves FIRST, attacks trap the target and\n"
      + "gain a 20% flinch chance (flinch only on the first hit of a multihit; the trap\n"
      + "applies regardless).' Reported: the flinch/trap were gated to the LAST hit\n"
      + "(inverted). Your fast Jolteon has From the Shadows.\n"
      + "DO: use QUICK ATTACK / any attack while you outspeed the foe.\n"
      + "EXPECT: on the hit the foe becomes TRAPPED (cannot switch/flee) every time you\n"
      + "move first, and sometimes flinches. Trapping does NOT wait for a last hit.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FROM_THE_SHADOWS),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.JOLTEON, {
          moveset: [MoveId.QUICK_ATTACK, MoveId.THUNDERBOLT, MoveId.SHADOW_BALL, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Strategic Pause +30% power (not 50%) when moving last",
    description:
      "ER 2.65: Strategic Pause 'When the user moves AFTER the target, boosts crit ratio\n"
      + "by 2 stages AND attack power by 30%.' Reported: the crit was right but the power\n"
      + "boost was 1.5x (+50%). Your SLOW Snorlax has Strategic Pause and moves last.\n"
      + "DO: use BODY SLAM on the foe (you move after it).\n"
      + "EXPECT: your move lands with a boosted crit chance and roughly +30% power (not\n"
      + "+50%). If you move FIRST (foe slower) there is no bonus.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.STRATEGIC_PAUSE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.JOLTEON,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.CRUNCH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Tentalock traps for 6 turns (not 4-5)",
    description:
      "ER 2.65: Tentalock 'Grappler + gives attacks a 50% chance to trap the target for\n"
      + "6 TURNS (1/6 max HP per turn), then drops their Speed each turn.' Reported: the\n"
      + "trap PROC only lasted 4-5 turns (Serpent Bind's value) because Grappler's 6-turn\n"
      + "extension didn't reach this proc. Your Tentacruel has Tentalock.\n"
      + "DO: attack the bulky foe until the 50% trap procs (Scald/Sludge Bomb).\n"
      + "EXPECT: once trapped the counter reads SIX turns of bind (1/6 HP each turn) and\n"
      + "the foe's Speed drops each turn it stays in.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.TENTALOCK),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.TENTACRUEL, {
          moveset: [MoveId.SLUDGE_BOMB, MoveId.SCALD, MoveId.SLUDGE_WAVE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Faraday Cage counters with a 50 BP Thunder Cage",
    description:
      "ER 2.65: Faraday Cage 'Uses Thunder Cage when hit by CONTACT moves - a 50 BP\n"
      + "Electric special move that traps the foe.' Reported: it cast Thunder Cage at its\n"
      + "natural 80 BP (too strong). Your Chesnaught has Faraday Cage; the foe makes\n"
      + "contact with Body Slam.\n"
      + "DO: use PROTECT-then-Splash / just tank the foe's BODY SLAM (a contact move).\n"
      + "EXPECT: on being hit you retaliate with THUNDER CAGE that traps the foe, dealt at\n"
      + "the reduced 50 BP (weaker than a full-power Thunder Cage). A NON-contact hit does\n"
      + "not trigger it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FARADAY_CAGE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BODY_SLAM],
      });
      return [
        makeStarter(SpeciesId.CHESNAUGHT, {
          moveset: [MoveId.SPLASH, MoveId.SPIKY_SHIELD, MoveId.WOOD_HAMMER, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Steel Beetle - Normal moves become Bug with STAB",
    description:
      "ER 2.65: Steel Beetle 'Normal-type moves become Bug-type and GAIN STAB' (a real\n"
      + "+0.5, i.e. 1.5x). Reported: the wire gave a flat 1.2x, and since Iron Heart is\n"
      + "Ghost/Rock (no natural Bug STAB) that undershot the intended 1.5x. Your Golem\n"
      + "(stand-in) has Steel Beetle forced.\n"
      + "DO: use a Normal move (BODY SLAM) on the foe.\n"
      + "EXPECT: the move resolves as BUG-type and hits ~1.5x harder than its raw power\n"
      + "(full STAB), super-effective vs the Grass/Dark Cacturne.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.STEEL_BEETLE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CACTURNE,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GOLEM, {
          moveset: [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.ROCK_SLIDE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Blind Rage does NOT bypass Grass Pelt (base-stat)",
    description:
      "ER 2.65: Blind Rage 'Scrappy + Mold Breaker, but does NOT bypass abilities that\n"
      + "modify base stats such as Grass Pelt.' Reported: its Mold Breaker suppressed\n"
      + "base-stat abilities too. Your Bewear has Blind Rage; the foe has GRASS PELT and\n"
      + "the terrain is GRASSY (so Grass Pelt gives +50% Def).\n"
      + "DO: hit the foe with a physical move (HAMMER ARM).\n"
      + "EXPECT: the foe still takes REDUCED physical damage - Grass Pelt's Def boost is\n"
      + "preserved (Blind Rage does not strip it). Ghost foes still take neutral Normal/\n"
      + "Fighting (Scrappy) and immunity/damage-reduction abilities are still bypassed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.BLIND_RAGE),
        STARTING_TERRAIN_OVERRIDE: TerrainType.GRASSY,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.GRASS_PELT,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BEWEAR, {
          moveset: [MoveId.HAMMER_ARM, MoveId.DOUBLE_EDGE, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Dreamscape doubles power when ANY mon is asleep",
    description:
      "ER 2.65: Dreamscape (Dreamcatcher) 'Doubles the power of moves when ANY active\n"
      + "Pokemon is asleep (user/ally/opponent), + 20% more damage.' Reported: the 2x was\n"
      + "gated on the TARGET being asleep only. Your Musharna has Dreamscape; the foe is\n"
      + "put to sleep.\n"
      + "DO: the foe starts ASLEEP - use PSYCHIC on it, then let it wake and compare.\n"
      + "EXPECT: while ANY mon on the field is asleep your moves hit for DOUBLE power (plus\n"
      + "the flat +20%). Note Comatose does NOT count as asleep for this.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.DREAMSCAPE),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_STATUS_OVERRIDE: StatusEffect.SLEEP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MUSHARNA, {
          moveset: [MoveId.PSYCHIC, MoveId.DAZZLING_GLEAM, MoveId.SHADOW_BALL, MoveId.REST],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move - Trepidation: the foe's Psychic moves miss for 3 turns
  // ===========================================================================
  {
    label: "Move: Trepidation seals the foe's Psychic moves (3 turns)",
    description:
      "ER 2.65 dex - Trepidation: 'The foe falls into despair. All Psychic-type moves\n"
      + "they use miss for 3 turns.' It is a damaging move (small body), then applies the\n"
      + "despair seal. The foe here is an Alakazam whose ONLY attacking move is Psychic\n"
      + "(plus a non-Psychic Shadow Ball as a control).\n"
      + "DO: use TREPIDATION on the Alakazam so it connects (retry if it misses - 90 acc).\n"
      + "Then let it attack for the next few turns.\n"
      + "EXPECT: 'Alakazam fell into despair!'. For the next 3 turns EVERY Psychic move it\n"
      + "uses MISSES (no damage to you), while its non-Psychic Shadow Ball still HITS. After\n"
      + "3 turns the despair wears off and its Psychic moves land again. (Before the fix\n"
      + "Trepidation was a plain flinch proxy and Psychic moves connected normally.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 100,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ALAKAZAM,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.PSYCHIC, MoveId.SHADOW_BALL],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [erMove(ErMoveId.TREPIDATION), MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move - Spectral Flame: burns Fire types + suppresses abilities in fog
  // ===========================================================================
  {
    label: "Move: Spectral Flame burns a Fire type (+ ability-suppress in fog)",
    description:
      "ER 2.65 dex - Spectral Flame: 'Burns the target, including Fire types. Suppresses\n"
      + "abilities in fog.' The foe is a Fire-type Arcanine (normally immune to burn).\n"
      + "DO: use SPECTRAL FLAME on the Arcanine (retry if it misses - 85 acc). Then set the\n"
      + "field to fog with EERIE FOG and use SPECTRAL FLAME again.\n"
      + "EXPECT: the Fire-type Arcanine IS burned by Spectral Flame (its HP chips each turn),\n"
      + "even though a normal Will-O-Wisp would say 'it doesn't affect Arcanine'. In FOG, a\n"
      + "Spectral Flame hit ALSO suppresses the target's ability (Intimidate/Flash Fire etc.\n"
      + "stops working). Outside fog only the burn applies. (Before the fix Spectral Flame\n"
      + "was a plain burn that Fire types shrugged off, with no fog suppression.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 100,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ARCANINE,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.INTIMIDATE,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [erMove(ErMoveId.SPECTRAL_FLAME), erMove(ErMoveId.EERIE_FOG), MoveId.SHADOW_BALL, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move - Fetch: retrieves the user's consumed berry, then switches out
  // ===========================================================================
  {
    label: "Move: Fetch retrieves the eaten berry and switches out",
    description:
      "ER 2.65 dex - Fetch: 'The user retrieves its lost item and switches to an ally.' In\n"
      + "this engine the only 'lost item' tracked is a CONSUMED BERRY, so Fetch restores the\n"
      + "user's most-recently eaten berry as a held item, then self-switches. The Snorlax\n"
      + "holds a Sitrus Berry and starts at ~30% HP so it eats the berry on the first hit.\n"
      + "DO: let the foe (or your own chip) trigger the Sitrus Berry so it is eaten (HP jumps\n"
      + "up, berry consumed). Then use FETCH.\n"
      + "EXPECT: 'Snorlax got its <Sitrus Berry> back!' - the eaten berry returns as a held\n"
      + "item, and Snorlax switches out to Munchlax. Open Check Team to confirm the Sitrus\n"
      + "Berry is on Snorlax again. (Before the fix Fetch only switched and never returned\n"
      + "the item.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 1,
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 40,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [erMove(ErMoveId.FETCH), MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH],
        }),
        makeStarter(SpeciesId.MUNCHLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.TACKLE],
        }),
      ];
    },
    onBattleStart: () => {
      // Start the lead at ~30% HP so its Sitrus Berry (50% threshold) fires on the
      // first hit - then Fetch has a consumed berry to retrieve.
      const lead = globalScene.getPlayerPokemon();
      if (lead) {
        lead.hp = Math.max(1, Math.floor(lead.getMaxHp() * 0.3));
      }
    },
  },
  // ===========================================================================
  // Ability - Know Your Place is a TRUE Quash (move last regardless of priority)
  // ===========================================================================
  {
    label: "Ability: Know Your Place (true Quash)",
    description:
      "Know Your Place (2.65 dex): 'Contact attacks make foes move last for 5 turns\n"
      + "regardless of priority, speed, or other effects.' It was a one-turn -6 SPD\n"
      + "drop; now it is a real Quash.\n"
      + "DO: let the foe hit your Snorlax with Tackle (contact) - the foe is now\n"
      + "Quashed. Next turn, use Body Slam (normal priority) while the foe uses Quick\n"
      + "Attack (+1 priority).\n"
      + "EXPECT: your Body Slam still goes FIRST - the Quashed foe moves dead last even\n"
      + "with a priority move. Before the fix a +1 Quick Attack would outspeed you.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5437), // Know Your Place
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY, // tanky, survives to keep acting
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE, MoveId.QUICK_ATTACK],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability - Assassin's Tools is ONE pooled 30% proc (not two rolls)
  // ===========================================================================
  {
    label: "Ability: Assassin's Tools (single pooled proc)",
    description:
      "Assassin's Tools (2.65 dex): 'Contact moves have a 30% chance to poison,\n"
      + "paralyze, OR bleed.' It rolled TWO independent 30% chances (could inflict a\n"
      + "status AND bleed at once, ~51% total); now it is ONE 30% roll that picks a\n"
      + "single outcome.\n"
      + "DO: attack the tanky foe with Tackle (contact) over several turns.\n"
      + "EXPECT: roughly 30% of hits inflict exactly ONE of poison / paralysis / bleed -\n"
      + "never a status AND bleed together on the same hit.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5394), // Assassin's Tools
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY, // Normal: poison- AND bleed-eligible
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability - Unicorn's Pixilate: Normal moves become Fairy-type
  // ===========================================================================
  {
    label: "Ability: Unicorn (Pixilate conversion)",
    description:
      "Unicorn (2.65 dex): 'Boosts horn and drill attacks 30%. Converts Normal moves\n"
      + "to Fairy-type and Fairy STAB.' The Pixilate half was dropped (flat boost only);\n"
      + "now Normal moves really become Fairy.\n"
      + "DO: attack the Dragon-type foe (Salamence) with Tackle (a Normal move).\n"
      + "EXPECT: 'It's super effective!' - Tackle is now a Fairy move (2x on the Dragon).\n"
      + "Before the fix Tackle stayed Normal and dealt neutral damage.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5351), // Unicorn
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SALAMENCE, // Dragon/Flying - Fairy is 2x
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.TACKLE, MoveId.MOONBLAST, MoveId.REST, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability - Blood Stain spreads the ABILITY (Mummy-style), not just bleed
  // ===========================================================================
  {
    label: "Ability: Blood Stain (ability contagion)",
    description:
      "Blood Stain (2.65 dex): 'When the user makes contact offensively or defensively\n"
      + "with a Pokemon who does not have this ability, it REPLACES their current\n"
      + "ability and causes bleeding.' It only spread the bleed, not the ability; now it\n"
      + "spreads Blood Stain itself (Mummy-style).\n"
      + "DO: hit the tanky foe with Tackle (contact).\n"
      + "EXPECT: the foe's ability is REPLACED with Blood Stain ('gave its target Blood\n"
      + "Stain!') and it starts bleeding. Before the fix its ability was untouched.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5377), // Blood Stain
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY, // tanky, suppressable ability
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability - Mimikyu disguise heals + Patchwork restores it in fog
  // ===========================================================================
  {
    label: "Ability: Patchwork disguise restore (fog)",
    description:
      "The ER Mimikyu tiers (Apex / Rayquaza) never healed their busted disguise - the\n"
      + "busted->intact form edge was missing, so the DISGUISE reset (between battles /\n"
      + "on faint) no-op'd. Patchwork also restores the disguise in FOG.\n"
      + "DO: let the foe break your Mimikyu Rayquaza's disguise (first damaging hit is\n"
      + "blocked, the disguise busts). With fog on the field, switch to Snorlax and then\n"
      + "switch Mimikyu back in.\n"
      + "EXPECT: on switching back in during fog, the disguise is RESTORED (intact\n"
      + "sprite, and it can block a hit again). Before the fix the disguise stayed busted\n"
      + "forever - it never healed on switch, in fog, or between battles.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        WEATHER_OVERRIDE: WeatherType.FOG,
        ABILITY_OVERRIDE: erAbility(5396), // Patchwork
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(erSpecies(10767) /* Mimikyu Rayquaza */, {
          moveset: [MoveId.SHADOW_CLAW, MoveId.PLAY_ROUGH, MoveId.REST, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // TIER-4 audit fixes
  // ===========================================================================
  {
    label: "Ability: Impulse (Speed replaces Attack)",
    description:
      "Impulse (2.65 dex): 'Non-contact moves use the Speed stat for damage INSTEAD OF\n"
      + "Attack/Special Attack.' It was adding Speed to Attack (~2x); now it replaces.\n"
      + "DO: as fast, low-Attack Ninjask, use the non-contact move Swift on the foe.\n"
      + "EXPECT: Swift hits for damage based on your (high) Speed, not your (low) Attack.\n"
      + "A CONTACT move (e.g. Fury Cutter) still uses Attack normally.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5274), // Impulse
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.NINJASK, { moveset: [MoveId.SWIFT, MoveId.FURY_CUTTER, MoveId.REST, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Super Hot Goo (contact-gated)",
    description:
      "Super Hot Goo (2.65 dex): '30% burn AND -1 Speed to the attacker when hit by a\n"
      + "CONTACT move.' The -1 Speed used to fire on ANY move; now it is contact-gated.\n"
      + "DO: let the foe hit you with a NON-contact move (Water Gun) - nothing happens to\n"
      + "its Speed. Then a CONTACT move (Tackle) - now it can lose Speed / be burned.\n"
      + "EXPECT: no Speed drop from the non-contact hit; the contact hit drops its Speed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5199), // Super Hot Goo
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.WATER_GUN, MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.PROTECT, MoveId.REST, MoveId.SPLASH, MoveId.BODY_SLAM] }),
      ];
    },
  },
  {
    label: "Ability: Rite Of Spring (sun boosts)",
    description:
      "Rite Of Spring (2.65 dex): 'In sun, boosts Speed AND the highest attacking stat by\n"
      + "50%.' The old composite gave Speed x2, SpAtk-only, plus an unwanted HP drain.\n"
      + "DO: in harsh sun, attack over a couple of turns.\n"
      + "EXPECT: you outspeed/hit ~50% harder in sun (Speed +50% and your higher of\n"
      + "Atk/SpAtk +50%), and you take NO per-turn HP loss from the ability.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        WEATHER_OVERRIDE: WeatherType.SUNNY,
        ABILITY_OVERRIDE: erAbility(5503), // Rite Of Spring
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.REST, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Ability: Crispy Cream (burn OR frostbite)",
    description:
      "Crispy Cream (2.65 dex): '30% to inflict burn OR frostbite when hit by contact.'\n"
      + "It used to roll two independent 15% chances (could land both); now it is ONE\n"
      + "30% roll that picks a single outcome.\n"
      + "DO: let the foe repeatedly hit you with a CONTACT move (Tackle).\n"
      + "EXPECT: roughly 30% of contact hits inflict EITHER burn OR frostbite on the foe -\n"
      + "never both at once on one hit.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5593), // Crispy Cream
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.PROTECT, MoveId.REST, MoveId.SPLASH, MoveId.BODY_SLAM] }),
      ];
    },
  },
  {
    label: "Ability: Volcano Rage (50 BP Eruption follow-up)",
    description:
      "Volcano Rage (2.65 dex): 'After any Fire move, a followup Eruption at 50 base power\n"
      + "that scales with the user's HP.' It was firing Eruption at its full 150 BP (3x).\n"
      + "DO: use a Fire move (Ember) on the foe at full HP.\n"
      + "EXPECT: a followup Eruption lands, but at ~50 BP (a THIRD of a real Eruption).\n"
      + "As your HP drops, the followup scales down.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5119), // Volcano Rage
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, { moveset: [MoveId.EMBER, MoveId.FLAMETHROWER, MoveId.REST, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Relic Stone (suppresses foe STAB)",
    description:
      "Relic Stone (2.65 dex): 'While on field, every OTHER Pokemon gets no STAB bonus.'\n"
      + "It was a no-op; now it is a real field aura.\n"
      + "DO: attack the foe with a STAB move (Snorlax's Normal Body Slam) while the foe has\n"
      + "Relic Stone.\n"
      + "EXPECT: your Body Slam deals ~1.5x LESS than normal (no STAB bonus) because the\n"
      + "foe's Relic Stone suppresses your STAB. (Your foe's own STAB still works.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: erAbility(5567), // Relic Stone
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Toxic Spill (field-wide + Poison Heal)",
    description:
      "Toxic Spill (2.65 dex): 'Damages all non-Poison Pokemon 1/8 HP each turn; Poison\n"
      + "Heal holders recover instead.' It was foes-only with no Poison Heal branch.\n"
      + "DO: hold Toxic Spill; every turn watch the non-Poison foe lose 1/8 HP. (In\n"
      + "doubles a non-Poison ally would also take it.)\n"
      + "EXPECT: the non-Poison foe chips 1/8 each turn; a Poison Heal foe would HEAL 1/8\n"
      + "instead; a Poison-type foe is unaffected.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5147), // Toxic Spill
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.PROTECT, MoveId.REST, MoveId.SPLASH, MoveId.BODY_SLAM] }),
      ];
    },
  },
  {
    label: "Ability: Toxic Boost (Toxic-Terrain self-poison)",
    description:
      "Toxic Boost (2.65 dex): '+50% Attack when poisoned; immediately self-poisons in\n"
      + "Toxic Terrain (any grounding); nullifies poison damage.' The self-poison in Toxic\n"
      + "Terrain was missing.\n"
      + "DO: start in Toxic Terrain holding Toxic Boost, then attack.\n"
      + "EXPECT: you become POISONED on entry (from the terrain), take NO poison damage,\n"
      + "and hit ~50% harder physically from the Toxic Boost Attack bonus.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        STARTING_TERRAIN_OVERRIDE: TerrainType.TOXIC,
        ABILITY_OVERRIDE: AbilityId.TOXIC_BOOST,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Salt Circle (traps all foes)",
    description:
      "Salt Circle (2.65 dex): 'When the user enters, all opposing Pokemon cannot flee or\n"
      + "switch until it leaves. Forced switches / pivot moves still work.' It used to trap\n"
      + "only one foe via Mean Look; now it is a continuous field trap.\n"
      + "DO: with a wild foe, open the menu and try to switch out is fine (you're not\n"
      + "trapped); the FOE cannot switch. (Best observed vs a trainer, but wild works too.)\n"
      + "EXPECT: the opposing Pokemon is trapped for as long as your Salt Circle mon is out;\n"
      + "Ghost-types and Run Away foes are still free.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5273), // Salt Circle
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Electromorphosis (charge on any move)",
    description:
      "Electromorphosis (2.65 dex): 'When hit by ANY move, becomes Charged (next Electric\n"
      + "move doubled).' Vanilla only charged on a DAMAGING hit; ER charges on any move.\n"
      + "DO: let the foe hit you with a STATUS move (Growl), then fire an Electric move.\n"
      + "EXPECT: the Growl still makes you Charged ('became charged!'), so your next\n"
      + "Electric move is doubled. Before the fix a status move did not charge you.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.ELECTROMORPHOSIS,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.GROWL],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, { moveset: [MoveId.THUNDERBOLT, MoveId.PROTECT, MoveId.REST, MoveId.SPLASH] }),
      ];
    },
  },
  // ===========================================================================
  // TIER-5 audit fixes
  // ===========================================================================
  {
    label: "Ability: Fae Hunter (1.5x to / 0.5x from Fairy)",
    description:
      "Fae Hunter (2.65 dex): 'Deals 1.5x TO Fairy-type Pokemon and takes 0.5x FROM\n"
      + "Fairy-type Pokemon - based on the POKEMON's types, not the move's.' The 0.5x used\n"
      + "to gate on the move's type; now it gates on the attacker being Fairy-type.\n"
      + "DO: attack the Fairy foe (Gardevoir) with any move (Body Slam), and let it hit you\n"
      + "with a NON-Fairy move (Psychic).\n"
      + "EXPECT: your move deals ~1.5x to the Fairy foe; the foe's non-Fairy Psychic still\n"
      + "only deals HALF (0.5x) to you because the ATTACKER is Fairy-type.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5178), // Fae Hunter
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GARDEVOIR,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.PSYCHIC],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, { moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Wildfire (50 BP Fire Spin on entry)",
    description:
      "Wildfire (2.65 dex): 'Uses a 50 BP Fire Spin on switch-in (traps 4-5 turns, 1/8 HP\n"
      + "each turn).' It was firing the port's 35 BP Fire Spin.\n"
      + "DO: start the battle - Wildfire auto-uses Fire Spin on entry.\n"
      + "EXPECT: the foe is trapped and chipped 1/8 each turn; the initial hit is a 50 BP\n"
      + "Fire Spin (a bit stronger than before).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5420), // Wildfire
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.FLAMETHROWER, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Move: Web Shot (sets Sticky Web + high crit)",
    description:
      "Web Shot (2.65 dex): 'Sets up Sticky Web. +1 crit chance. Archer boost.' Only the\n"
      + "Archer boost was wired; the hazard + crit were missing.\n"
      + "DO: use Web Shot on the foe.\n"
      + "EXPECT: STICKY WEB is set on the foe's side ('Sticky web was laid out...'), so the\n"
      + "next foe to switch in has its Speed lowered; Web Shot also crits more often.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ARIADOS, {
          moveset: [erMove(5048) /* Web Shot */, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Ability: Tectonize (Normal moves become Ground)",
    description:
      "Tectonize (2.65 dex): 'Normal moves become Ground-type; if the holder is Ground-type\n"
      + "it is immune to Stealth Rock/Spikes, otherwise gains Ground STAB.' The conversion +\n"
      + "hazard immunity were missing (only a flat boost existed).\n"
      + "DO: attack the Electric foe (Magneton) with Tackle (a Normal move).\n"
      + "EXPECT: 'It's super effective!' - Tackle is now a Ground move (2x on Electric). A\n"
      + "Ground-type Tectonize holder would also take no Stealth Rock / Spikes damage.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5046), // Tectonize
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGNETON,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, { moveset: [MoveId.TACKLE, MoveId.EARTHQUAKE, MoveId.REST, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Draconize (Normal->Dragon, neutral vs Fairy)",
    description:
      "Draconize (2.65 dex): 'Normal moves become Dragon-type; if the holder is Dragon-type\n"
      + "its Dragon moves deal NEUTRAL damage vs Fairy, otherwise it gains Dragon STAB.' The\n"
      + "conversion + Fairy override were missing.\n"
      + "DO: as Dragon-type Garchomp, attack the Fairy foe (Gardevoir) with Tackle (Normal).\n"
      + "EXPECT: Tackle is now a Dragon move that HITS the Fairy for NEUTRAL damage (not the\n"
      + "usual 0x immunity), thanks to the holder being Dragon-type.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5149), // Draconize
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GARDEVOIR,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, { moveset: [MoveId.TACKLE, MoveId.DRAGON_CLAW, MoveId.REST, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Big Leaves (highest attacking stat in sun)",
    description:
      "Big Leaves (2.65 dex): among its sun effects, 'raises the HIGHEST attacking stat by\n"
      + "50% in sun.' It was boosting Sp.Atk only, so a physical attacker got nothing.\n"
      + "DO: in harsh sun, attack with the physical attacker Machamp.\n"
      + "EXPECT: your physical hits are ~50% stronger in sun (your Attack, the higher stat,\n"
      + "gets the boost - not just Sp.Atk). You also outspeed (+50% Speed) and cure status.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        WEATHER_OVERRIDE: WeatherType.SUNNY,
        ABILITY_OVERRIDE: erAbility(5111), // Big Leaves
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, { moveset: [MoveId.CLOSE_COMBAT, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH] }),
      ];
    },
  },
  {
    label: "Ability: Mycelium Might (status ignores type immunity)",
    description:
      "Mycelium Might (2.65 dex): 'Status moves bypass all immunities and type resistances\n"
      + "(but move last).' The type-immunity bypass was missing.\n"
      + "DO: use Thunder Wave on the GROUND-type foe (Golem). Try Toxic on a Steel foe too.\n"
      + "EXPECT: Thunder Wave PARALYZES the Ground-type (normally immune), and Toxic poisons\n"
      + "a Steel-type - status moves ignore the type immunity. Your status move moves last.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.MYCELIUM_MIGHT,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GOLEM,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.THUNDER_WAVE, MoveId.TOXIC, MoveId.SHADOW_BALL, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Ability: Determination (SpAtk up when statused)",
    description:
      "Determination (2.65 dex): '+50% Special Attack when the holder has ANY status; also\n"
      + "prevents frostbite from reducing Special Attack.' The frostbite tag wasn't counted.\n"
      + "DO: let the foe burn you (Will-O-Wisp), then fire a special move.\n"
      + "EXPECT: once statused (burn/poison/frostbite), your special moves hit ~50% harder;\n"
      + "and a frostbitten Determination holder's Sp.Atk is NOT cut (the ability waives it).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5236), // Determination
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.WILL_O_WISP],
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, { moveset: [MoveId.PSYCHIC, MoveId.REST, MoveId.PROTECT, MoveId.SPLASH] }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Victory Bomb (729) — TRUE any-KO detonation
  // ===========================================================================
  {
    label: "Ability: Victory Bomb explodes on ANY KO",
    description:
      "Victory Bomb (2.65 dex 729): 'When fainting, retaliate with a 100 BP Fire-type\n"
      + "Explosion targeting all adjacent Pokemon. Cannot miss. Works regardless of how\n"
      + "the user was KOed.' Before the fix it only fired on a lethal DAMAGING hit - a\n"
      + "status/weather/recoil/hazard KO never detonated.\n"
      + "DO: the foe (Victory Bomb) starts poisoned and at 1 HP. Use Splash and let it\n"
      + "faint to its own poison at end of turn (do NOT attack it).\n"
      + "EXPECT: when the foe faints to POISON (a non-damaging cause), it STILL detonates\n"
      + "a 100 BP Fire Explosion that damages your Snorlax.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: erAbility(5431), // Victory Bomb
        ENEMY_STATUS_OVERRIDE: StatusEffect.POISON,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => {
      const e = globalScene.getEnemyPokemon();
      if (e) {
        e.hp = 1; // faints to the poison chip at end of the first turn (a non-damaging KO)
      }
    },
  },
  // ===========================================================================
  // Ability: Berserker Rage (480, incl. Rampage) — recharge clears on KO
  // ===========================================================================
  {
    label: "Ability: Berserker Rage clears recharge on KO",
    description:
      "Berserker Rage (2.65 dex 480, includes Rampage): 'When the user knocks out an\n"
      + "opponent, it instantly recovers from recharge status, allowing immediate use of\n"
      + "moves like Hyper Beam without waiting.' Double battle so the fight continues past\n"
      + "the KO.\n"
      + "DO: with your LEFT Snorlax use Hyper Beam and KO a frail foe (right Snorlax can\n"
      + "Splash).\n"
      + "EXPECT: next turn the LEFT Snorlax is NOT locked recharging - its command menu\n"
      + "opens and it can act immediately. (Hyper Beam WITHOUT a KO still forces a normal\n"
      + "recharge turn.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        BATTLE_STYLE_OVERRIDE: "double",
        ABILITY_OVERRIDE: erAbility(5211), // Berserker Rage
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 5,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.HYPER_BEAM, MoveId.BODY_SLAM, MoveId.SPLASH, MoveId.REST],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Shallow Grave (629) — TRUE deferred revive at next send-out
  // ===========================================================================
  {
    label: "Ability: Shallow Grave revives at next send-out",
    description:
      "Shallow Grave (2.65 dex 629): 'After fainting while fog is active, the user\n"
      + "revives at 25% max HP when sending out your next party member.' Before the fix\n"
      + "the mon never actually fainted (it clung to 1 HP and stayed on the field).\n"
      + "DO: FOG is active; your lead Snorlax starts poisoned and at 1 HP. Use Splash and\n"
      + "let it FAINT to the poison. Send out Magikarp when prompted.\n"
      + "EXPECT: Snorlax truly FAINTS and leaves the field; when you send out Magikarp,\n"
      + "Snorlax is REVIVED to ~25% max HP as a usable reserve (switch back to it to see\n"
      + "it alive).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        WEATHER_OVERRIDE: WeatherType.FOG,
        ABILITY_OVERRIDE: erAbility(5333), // Shallow Grave
        STATUS_OVERRIDE: StatusEffect.POISON,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.MAGIKARP, {
          moveset: [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE],
        }),
      ];
    },
    onBattleStart: () => {
      const p = globalScene.getPlayerPokemon();
      if (p) {
        p.hp = 1; // faints to the poison chip at end of the first turn
      }
    },
  },
  // ===========================================================================
  // WEATHER — Eerie Fog (distinct), Snowy Wrath, Delta Stream weather-block
  // ===========================================================================
  {
    label: "Eerie Fog: Fog Machine sets it",
    description:
      "Fog Machine (er 905) summons the DISTINCT Eerie Fog weather (NOT vanilla fog).\n"
      + "DO: let the foe TACKLE you once, then use Curse.\n"
      + "EXPECT: after the hit the banner shows 'An eerie fog crept in!'; Curse then acts\n"
      + "as the GHOST-type Curse (Mightyena sacrifices ~half its HP and curses the foe)\n"
      + "even though it's not a Ghost-type — proof the fog synergies fire under Eerie Fog.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FOG_MACHINE),
        MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.CURSE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [makeStarter(SpeciesId.MIGHTYENA, { moveset: [MoveId.SPLASH, MoveId.CURSE] })];
    },
  },
  {
    label: "Snowy Wrath: chip + Ice Def",
    description:
      "Snowy Wrath (er 666) summons a wrathful blizzard for 8 turns.\n"
      + "DO: keep using Splash.\n"
      + "EXPECT: the non-Ice foe (Chansey) is chipped 1/16 max HP each turn; the Ice\n"
      + "holder (Walrein) takes NO chip and its Defense is buffed +50% (open Summary).\n"
      + "This is a DISTINCT weather — vanilla hail/snow (Abomasnow) is unaffected.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 50,
        STARTING_WAVE_OVERRIDE: 5,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SNOWY_WRATH),
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [makeStarter(SpeciesId.WALREIN, { moveset: [MoveId.SPLASH, MoveId.SURF, MoveId.ICE_BEAM, MoveId.REST] })];
    },
  },
  {
    label: "Delta Stream: weather-move block",
    description:
      "Delta Stream (er 191) makes weather-based moves unusable (like Desolate Land vs Fire).\n"
      + "DO: use Weather Ball, then use Thunderbolt.\n"
      + "EXPECT: Weather Ball fizzles ('The mysterious strong winds dissipated the attack!')\n"
      + "and deals no damage; Thunderbolt lands normally the next turn.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_WAVE_OVERRIDE: 5,
        MOVESET_OVERRIDE: [MoveId.WEATHER_BALL, MoveId.THUNDERBOLT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.DELTA_STREAM,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.WEATHER_BALL, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.THUNDER_WAVE],
        }),
      ];
    },
  },
  // ===========================================================================
  // MOVE — Ghastly Echo (848): the switch-in gets +50% move power for 1 turn
  // ===========================================================================
  {
    label: "Move: Ghastly Echo empowers the switch-in",
    description:
      "Ghastly Echo (2.65 dex 848): 'Deals damage and switches. Switch-in gets 50%\n"
      + "boost for 1 turn. Sound-based.' The damage + self force-switch + sound flag were\n"
      + "already in; this is the previously-missing 'empower the switch-in' half.\n"
      + "DO: with Gengar, use GHASTLY ECHO (it hits the foe and forces Gengar to switch\n"
      + "out). Send out Pikachu when prompted. Turn 2, use THUNDERBOLT and note the\n"
      + "damage; turn 3, use THUNDERBOLT again.\n"
      + "EXPECT: after the switch, the banner reads 'Pikachu was empowered by the ghastly\n"
      + "echo!'. Its FIRST move (turn 2 Thunderbolt) deals ~1.5x; its SECOND move (turn 3)\n"
      + "is back to normal — the boost lasts a single acting turn. Compare the two damage\n"
      + "numbers: the first is ~50% higher. (Enemy Harden only raises its Defense, which\n"
      + "does not touch the special Thunderbolt, so the two hits differ only by the boost.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        // Bronzong (Steel/Psychic) is NOT Normal-typed, so it takes the Ghost-type
        // Ghastly Echo (a Normal-type foe would be immune and never switch); its
        // huge special bulk survives both Thunderbolts, and it has no trapping
        // ability to block the forced switch.
        ENEMY_SPECIES_OVERRIDE: SpeciesId.BRONZONG,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.HARDEN],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [erMove(ErMoveId.GHASTLY_ECHO), MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT],
        }),
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.THUNDERBOLT, MoveId.THUNDER, MoveId.QUICK_ATTACK, MoveId.SWIFT],
        }),
      ];
    },
  },
  // ===========================================================================
  // ABILITY — Soothsayer (773): 3-turn "not very effective" FLOOR (#52)
  // ===========================================================================
  {
    label: "Ability: Soothsayer NVE-floors hits for 3 turns",
    description:
      "Soothsayer (2.65 dex 773): 'On entry, all attacks received are considered NOT\n"
      + "very effective for 3 turns.' Fixed: it now CLAMPS the type-effectiveness to 0.5x\n"
      + "(Tera-Shell-style), instead of the old flat x0.5 damage cut that mis-scaled\n"
      + "super-effective and resisted hits.\n"
      + "DO: with Machamp, use MACH PUNCH (Fighting, 4x vs the Aggron) on turns 1, 2, 3\n"
      + "and 4.\n"
      + "EXPECT: turns 1-3 read 'It's not very effective…' (the 4x is floored to 0.5x —\n"
      + "small damage). On turn 4 the window has closed and it reads 'It's super\n"
      + "effective!' with a big damage spike.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.MACH_PUNCH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.AGGRON,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: erAbility(5474), // Soothsayer
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.MACH_PUNCH, MoveId.BULLET_PUNCH, MoveId.BULK_UP, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () => boostEnemy([[Stat.DEF, 6]]), // survive four Mach Punches
  },
  // ===========================================================================
  // ABILITY — Drakelp Head (932): consume-on-first-defend (#56)
  // ===========================================================================
  {
    label: "Ability: Drakelp Head weakens only the FIRST hit",
    description:
      "Drakelp Head (2.65 dex 932): 'Weakens the FIRST move taken and drops that\n"
      + "attacker's Attack.' Fixed: it is now a one-shot — only the first damaging hit is\n"
      + "halved and the attacker's Attack drops once, then it is spent (was: blanket\n"
      + "turn-1 halving + an Attack drop on EVERY hit).\n"
      + "DO: with Alakazam, use PSYCHIC (special — so the -1 Attack it suffers does not\n"
      + "muddy the damage) on turn 1, then PSYCHIC again on turn 2.\n"
      + "EXPECT: turn 1 Psychic does roughly HALF the damage of turn 2 (the first hit is\n"
      + "weakened), and Alakazam's Attack falls to -1 after turn 1. On turn 2 the damage\n"
      + "is full and Alakazam's Attack stays at -1 (no second drop).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.PSYCHIC],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: erAbility(5690), // Drakelp Head
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.CALM_MIND, MoveId.RECOVER],
        }),
      ];
    },
    onBattleStart: () => boostEnemy([[Stat.SPDEF, 6]]), // survive two Psychics
  },
  // ===========================================================================
  // ABILITY — Gleam Eyes (707): foe held items suppressed (#54)
  // ===========================================================================
  {
    label: "Ability: Gleam Eyes suppresses the foe's items",
    description:
      "Gleam Eyes (2.65 dex 707): on entry it reveals the foe's items (Frisk), drops\n"
      + "their Sp. Atk (Scare), AND prevents their items from working (Embargo-style).\n"
      + "The item-suppression clause was missing; it is now wired.\n"
      + "NOTE: a faithful 2-turn window needs a dedicated Embargo battler tag (owned by a\n"
      + "concurrent batch); this delivers the suppression while Gleam Eyes is on the field.\n"
      + "DO: the Snorlax is pre-set to ~55% HP and holds a Sitrus Berry (heals at 50%).\n"
      + "With Slowbro (Gleam Eyes forced active), use WATER GUN once to chip it below 50%.\n"
      + "EXPECT: the Sitrus Berry does NOT trigger — Snorlax stays below half HP (normally\n"
      + "it would eat the berry and heal back up).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5410), // Gleam Eyes (force active on the player)
        MOVESET_OVERRIDE: [MoveId.WATER_GUN],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS }],
      });
      return [
        makeStarter(SpeciesId.SLOWBRO, {
          moveset: [MoveId.WATER_GUN, MoveId.PSYCHIC, MoveId.SLACK_OFF, MoveId.CALM_MIND],
        }),
      ];
    },
    onBattleStart: () => {
      const e = globalScene.getEnemyPokemon();
      if (e) {
        e.hp = Math.floor(e.getMaxHp() * 0.55);
        e.updateInfo();
      }
    },
  },
  // ===========================================================================
  // ABILITY — Lead Coat (296): TRIPLES the holder's weight (#60)
  // ===========================================================================
  {
    label: "Ability: Lead Coat triples the holder's weight",
    description:
      "Lead Coat (2.65 dex 296): '-40% physical damage, x0.9 Speed, TRIPLES the holder's\n"
      + "weight' — mirroring its special-side twin Chrome Coat (539). The weight-triple\n"
      + "clause was dropped in the port and is now restored.\n"
      + "DO: the foe is a lightweight Meowth (~4 kg → 12 kg with Lead Coat). With Machamp,\n"
      + "use LOW KICK (its power scales with the target's weight).\n"
      + "EXPECT: Low Kick hits noticeably HARDER than the foe's real weight would suggest —\n"
      + "the tripled weight bumps it into a higher power tier (40 BP instead of 20 BP).\n"
      + "(Lead Coat's own -40% physical reduction is also in effect, so it is not a full\n"
      + "doubling of damage, but the power tier jump is clear.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.LOW_KICK],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MEOWTH,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: erAbility(5034), // Lead Coat
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.LOW_KICK, MoveId.BULLET_PUNCH, MoveId.BULK_UP, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // ABILITY — Evaporate (444): Mist shields the DOUBLES ALLY's self-drops (#60)
  // ===========================================================================
  {
    label: "Ability: Evaporate Mist protects the ally too",
    description:
      "Evaporate (2.65 dex 444): 'Negates Water damage and sets Mist when hit by Water.\n"
      + "Mist protects the ENTIRE TEAM from stat reductions, including self-drops.' The\n"
      + "holder's own self-drop immunity was already in; this adds the DOUBLES ALLY.\n"
      + "DO (double battle): turn 1, have Blastoise (Evaporate) use PROTECT while the foe\n"
      + "Water Guns it (this sets Mist on your side); have Charizard use OVERHEAT. Repeat\n"
      + "Overheat on turn 2 if needed.\n"
      + "EXPECT: while your side's Mist is up, Charizard's OVERHEAT does NOT drop its own\n"
      + "Sp. Atk — the ally is shielded by the holder's Mist (without Evaporate the ally's\n"
      + "Sp. Atk would fall by 2 each Overheat).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        BATTLE_STYLE_OVERRIDE: "double",
        ABILITY_OVERRIDE: erAbility(5180), // Evaporate (player side)
        ENEMY_SPECIES_OVERRIDE: SpeciesId.QUAGSIRE,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.WATER_GUN],
      });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.PROTECT, MoveId.SURF, MoveId.ICE_BEAM, MoveId.RAPID_SPIN],
        }),
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.OVERHEAT, MoveId.AIR_SLASH, MoveId.DRAGON_PULSE, MoveId.ROOST],
        }),
      ];
    },
  },
  // ===========================================================================
  // ABILITY — Tera Shell / Teraform Zero: resist EVERY hit of a multi-hit (#46)
  // ===========================================================================
  {
    label: "Ability: Tera Shell resists every multi-hit strike",
    description:
      "Tera Shell (607) / Teraform Zero (739): 'Activates on EACH hit of a multi-hit\n"
      + "attack, unlike other similar abilities.' Regression check — a full-HP holder must\n"
      + "resist EVERY sub-hit, not just the first (the effectiveness latch handles this).\n"
      + "DO: with Breloom, use BULLET SEED (2-5 hits) against the full-HP Snorlax (Tera\n"
      + "Shell forced active).\n"
      + "EXPECT: 'It's not very effective…' shows and EVERY hit lands for the same reduced\n"
      + "damage (all strikes floored to 0.5x), even though Snorlax is Normal-typed and\n"
      + "Bullet Seed is Grass (naturally neutral) — the resist holds across all hits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.BULLET_SEED],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.TERA_SHELL,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BRELOOM, {
          moveset: [MoveId.BULLET_SEED, MoveId.MACH_PUNCH, MoveId.SPORE, MoveId.SWORDS_DANCE],
        }),
      ];
    },
    onBattleStart: () => boostEnemy([[Stat.DEF, 6]]), // survive all strikes to observe each resist
  },
  // ===========================================================================
  // ABILITY — Mental Pollution (816): on-enrage FIELD ability suppression (#53)
  // ===========================================================================
  {
    label: "Ability: Mental Pollution suppresses foes when the holder enrages",
    description:
      "Mental Pollution (816): 'Applies ability suppression to OTHER Pokemon when the\n"
      + "user becomes enraged. Suppression lasts while those Pokemon remain on the field.'\n"
      + "The foe here NEVER attacks you (it only Swaggers) — the old wire missed exactly\n"
      + "this case. The foe holds Levitate (Ground-immune).\n"
      + "DO: turn 1, use EARTHQUAKE — it does NOTHING (foe's Levitate blocks it). The foe\n"
      + "Swaggers you, so you become ENRAGED ('Garchomp became enraged!'). Turn 2, use\n"
      + "EARTHQUAKE again.\n"
      + "EXPECT: turn 2 Earthquake now CONNECTS and damages the foe — its Levitate is\n"
      + "suppressed because you are enraged, even though it never attacked you.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.MENTAL_POLLUTION),
        MOVESET_OVERRIDE: [MoveId.EARTHQUAKE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.ROTOM,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.LEVITATE,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SWAGGER],
      });
      return [
        makeStarter(SpeciesId.GARCHOMP, {
          moveset: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // ABILITY — Gleam Eyes (707): real 2-turn Embargo on entry (#54)
  // ===========================================================================
  {
    label: "Ability: Gleam Eyes disables foe items for exactly 2 turns",
    description:
      "Gleam Eyes (707): on entry it REVEALS the foe's items, drops all foes' Sp. Atk by\n"
      + "one stage, and PREVENTS their items from working for exactly 2 TURNS (Embargo-\n"
      + "style; Mega Stones are exempt). The foe holds Leftovers.\n"
      + "DO: on entry you'll see 'frisked … found: Leftovers!' and 'Sp. Atk fell!'. Use\n"
      + "TACKLE each turn to chip the tanky foe and watch its END-OF-TURN Leftovers heal.\n"
      + "EXPECT: turns 1 and 2 — NO Leftovers heal (items disabled). Turn 3 — Leftovers\n"
      + "heals again (the 2-turn window has lapsed).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 60,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.GLEAM_EYES),
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 60,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.TACKLE, MoveId.WATERFALL, MoveId.CRUNCH, MoveId.DRAGON_DANCE],
        }),
      ];
    },
    onBattleStart: () => boostEnemy([[Stat.DEF, 6]]), // stay alive across 3 turns to observe the heal gap
  },
  // ===========================================================================
  // MOVE — Fetch (969): retrieves a lost NON-BERRY item, then switches (#55)
  // ===========================================================================
  {
    label: "Move: Fetch retrieves a knocked-off item, then switches",
    description:
      "Fetch (969): 'The user retrieves its lost item and switches to an ally.' The\n"
      + "consumed-item ledger now records NON-BERRY losses (knocked-off items, consumed\n"
      + "one-time items, shattered Gems), not just berries. Your lead holds Leftovers and\n"
      + "the foe spams KNOCK OFF.\n"
      + "DO: turn 1, let the foe KNOCK OFF your Leftovers (its icon disappears). Turn 2,\n"
      + "use FETCH.\n"
      + "EXPECT: Fetch RETRIEVES the Leftovers (a 'created … Leftovers' message) and your\n"
      + "lead SWITCHES OUT to the ally — check the bench mon: the Leftovers is back on it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 50,
        MOVESET_OVERRIDE: [erMove(ErMoveId.FETCH)],
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 20,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.KNOCK_OFF],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [erMove(ErMoveId.FETCH), MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.MUNCHLAX, {
          moveset: [MoveId.TACKLE, MoveId.DEFENSE_CURL, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ===========================================================================
  // remaining-dex audit batch — moves & abilities
  // ===========================================================================
  // ABILITY — Overgrow/Blaze/Torrent/Swarm (65-68): baseline boost no longer stacks
  {
    label: "Ability: Overgrow is 1.5x below 1/3 HP (not 1.8x)",
    description:
      "Overgrow/Blaze/Torrent/Swarm (65-68): ER's always-on +20% type boost used to\n"
      + "STACK with the low-HP +50% (1.2x1.5 = 1.8x below 1/3 HP). ER is mutually\n"
      + "exclusive: 1.2x above 1/3 HP, 1.5x at/below 1/3 HP.\n"
      + "DO: turn 1 at FULL HP, use SEED BOMB (note the damage). Turn 2, the foe has\n"
      + "been pre-set to chip you below 1/3 HP; use SEED BOMB again.\n"
      + "EXPECT: the low-HP Grass hit is ~1.25x the full-HP hit (1.5 vs 1.2), NOT ~1.5x\n"
      + "(which would be the old 1.8x stack).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.OVERGROW,
        MOVESET_OVERRIDE: [MoveId.SEED_BOMB],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.SEED_BOMB, MoveId.GIGA_DRAIN, MoveId.SLUDGE_BOMB, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ABILITY — Sage Power (352): move-lock WITHOUT the spurious ATK boost
  {
    label: "Ability: Sage Power locks move, no Attack boost",
    description:
      "Sage Power (352): '+50% Special Attack and locks into the first move.' It used\n"
      + "to borrow Gorilla Tactics, which ALSO gave a bogus +50% physical Attack.\n"
      + "DO: use TACKLE (this locks the mon into Tackle). Try to pick another move next\n"
      + "turn — only Tackle is selectable.\n"
      + "EXPECT: the move lock works, but the holder's physical Attack is UNCHANGED (no\n"
      + "Gorilla ATK boost). Only Special Attack is buffed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.SAGE_POWER),
        MOVESET_OVERRIDE: [MoveId.TACKLE, MoveId.EMBER],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.TACKLE, MoveId.EMBER, MoveId.PSYCHIC, MoveId.PROTECT],
        }),
      ];
    },
  },
  // ABILITY — Blur (809) / Elude (810): Speed substitutes for the defensive stat
  {
    label: "Ability: Blur uses Speed vs contact hits",
    description:
      "Blur (809): 'Uses Speed instead of Defense OR Special Defense when hit by\n"
      + "CONTACT moves.' (Elude 810 is the same for NON-contact.) It used to only cover\n"
      + "Defense and ADD Speed instead of REPLACING it.\n"
      + "DO: let the fast foe hit your slow-but-speedy Electrode with a CONTACT move\n"
      + "(TACKLE) and a special CONTACT move (DRAINING KISS).\n"
      + "EXPECT: both take very little damage — Electrode's huge Speed is used as BOTH\n"
      + "Def and SpDef against contact hits.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.BLUR),
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE, MoveId.DRAINING_KISS],
      });
      return [
        makeStarter(SpeciesId.ELECTRODE, {
          moveset: [MoveId.SPLASH, MoveId.THUNDERBOLT, MoveId.VOLT_SWITCH, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Flash (148): drops Attack (not Accuracy)
  {
    label: "Move: Flash drops the foe's Attack",
    description:
      "Flash (148) is an ER Electric special move that has a 50% chance to drop the\n"
      + "foe's ATTACK (it used to drop Accuracy).\n"
      + "DO: use FLASH a few times.\n"
      + "EXPECT: on a proc, the foe's ATTACK falls (not its Accuracy).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        MOVESET_OVERRIDE: [MoveId.FLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.FLASH, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Thief (168): 100% steal + itemless +1 priority
  {
    label: "Move: Thief steals with 100% reliability",
    description:
      "Thief (168): 'Steals or removes the foe's item' (100%, not 30%), and gains +1\n"
      + "priority when the user holds NO item.\n"
      + "DO: use THIEF once (you hold nothing; the foe holds a Sitrus Berry).\n"
      + "EXPECT: the steal ALWAYS lands (foe's item gone, now on your mon), and Thief\n"
      + "moved with +1 priority (before the foe).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        MOVESET_OVERRIDE: [MoveId.THIEF],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS }],
      });
      return [
        makeStarter(SpeciesId.WEAVILE, {
          moveset: [MoveId.THIEF, MoveId.ICE_SHARD, MoveId.SWORDS_DANCE, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Reflect Type (513): projects the USER's type onto the target
  {
    label: "Move: Reflect Type makes the foe your type",
    description:
      "Reflect Type (513): 'The user projects its type onto the foe, making it the\n"
      + "same type.' (The port had it backwards — user copied the foe.)\n"
      + "DO: use REFLECT TYPE on the Normal-type Snorlax.\n"
      + "EXPECT: the FOE becomes Grass/Poison (your Venusaur's typing) — check the\n"
      + "type-effectiveness of your next move against it.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        MOVESET_OVERRIDE: [MoveId.REFLECT_TYPE, MoveId.SLUDGE_BOMB],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.VENUSAUR, {
          moveset: [MoveId.REFLECT_TYPE, MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Aromatic Mist (597): +2 SpDef to the USER and its ally (doubles)
  {
    label: "Move: Aromatic Mist +2 SpDef to user and ally",
    description:
      "Aromatic Mist (597): 'Sharply raises the Special Defense of the user AND its\n"
      + "partner.' The port only gave +1 to the ally and failed in singles.\n"
      + "DO: (double battle) use AROMATIC MIST with the left mon.\n"
      + "EXPECT: BOTH your mons gain +2 Special Defense (the user included).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        BATTLE_STYLE_OVERRIDE: "double",
        MOVESET_OVERRIDE: [MoveId.AROMATIC_MIST, MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.AROMATIC_MIST, MoveId.SPLASH, MoveId.SURF, MoveId.PROTECT],
        }),
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.AROMATIC_MIST, MoveId.SPLASH, MoveId.FLAMETHROWER, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Tearful Look (669): drops Special Attack ONLY
  {
    label: "Move: Tearful Look drops Sp. Atk only",
    description:
      "Tearful Look (669): 'The foe's Special Attack is lowered.' The port also\n"
      + "dropped physical Attack.\n"
      + "DO: use TEARFUL LOOK.\n"
      + "EXPECT: the foe's Special Attack falls by 1; its physical Attack is UNCHANGED.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        MOVESET_OVERRIDE: [MoveId.TEARFUL_LOOK],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SYLVEON, {
          moveset: [MoveId.TEARFUL_LOOK, MoveId.MOONBLAST, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Barb Barrage (895): x1.5 vs any statused foe
  {
    label: "Move: Barb Barrage x1.5 vs a statused foe",
    description:
      "Barb Barrage (895): '30% poison; 50% power boost if the target is statused'\n"
      + "(x1.5 for ANY status). The port only doubled vs POISON.\n"
      + "DO: the foe is pre-set with PARALYSIS. Use BARB BARRAGE (note damage), then\n"
      + "compare against a clean foe (rerun without the status).\n"
      + "EXPECT: ~1.5x damage against the statused foe (works for paralysis/burn/etc.,\n"
      + "not just poison).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.BARB_BARRAGE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_STATUS_OVERRIDE: StatusEffect.PARALYSIS,
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.BARB_BARRAGE, MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Hard Press (906): fixed 80 power + negate ability if foe already moved
  {
    label: "Move: Hard Press is fixed 80 BP + ability negate",
    description:
      "Hard Press (906): dex is a FIXED 80-BP Steel move that 'negates the foe's\n"
      + "Ability if it has already moved this turn.' The port kept the vanilla\n"
      + "HP-scaling power and had no ability negation.\n"
      + "DO: your slower mon uses HARD PRESS after the FASTER foe has moved.\n"
      + "EXPECT: damage is constant regardless of the foe's HP, AND the foe's ability\n"
      + "is suppressed for the rest of the battle (it moved first).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.HARD_PRESS],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.JOLTEON, // fast — acts before your Snorlax
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.VOLT_ABSORB,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.HARD_PRESS, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Eerie Fog (950): sets ER EERIE_FOG weather (not vanilla FOG)
  {
    label: "Move: Eerie Fog sets EERIE FOG weather",
    description:
      "Eerie Fog (950) sets ER's distinct EERIE FOG weather for 8 turns (a Ghost/\n"
      + "Psychic weather with NO accuracy debuff), not vanilla Fog. Each turn it drains\n"
      + "positive stat boosts from non-Ghost/Psychic mons.\n"
      + "DO: use EERIE FOG.\n"
      + "EXPECT: the weather banner reads 'An eerie fog crept in!' (EERIE FOG, 8 turns).\n"
      + "Non-Ghost/Psychic mons lose a stage off each positive boost every turn.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        WEATHER_OVERRIDE: WeatherType.NONE,
        MOVESET_OVERRIDE: [erMove(ErMoveId.EERIE_FOG)],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [erMove(ErMoveId.EERIE_FOG), MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Captivate (445): x2 damage vs an infatuated foe
  {
    label: "Move: Captivate doubles vs an infatuated foe",
    description:
      "Captivate (445): a Fairy special 65-BP move that deals DOUBLE damage to an\n"
      + "INFATUATED foe (no gender gate, single-target). The port kept the vanilla\n"
      + "SpAtk-drop + opposite-gender fail and never doubled.\n"
      + "DO: turn 1 use ATTRACT to infatuate the foe, turn 2 use CAPTIVATE (compare to a\n"
      + "Captivate on a non-infatuated foe).\n"
      + "EXPECT: Captivate hits ~2x harder against the infatuated foe.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.CAPTIVATE, MoveId.ATTRACT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.CAPTIVATE, MoveId.ATTRACT, MoveId.MOONBLAST, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Focus Punch (264): reduced to 40 BP when hit (not interrupted)
  {
    label: "Move: Focus Punch hits at 40 BP when struck",
    description:
      "Focus Punch (264): 'Damage reduced to 40 BP if hit' (it no longer FAILS when\n"
      + "the user takes damage before acting).\n"
      + "DO: use FOCUS PUNCH; the faster foe hits you first with Tackle.\n"
      + "EXPECT: Focus Punch still LANDS (at reduced power), instead of being\n"
      + "interrupted/failing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.FOCUS_PUNCH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.JOLTEON,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.FOCUS_PUNCH, MoveId.KNOCK_OFF, MoveId.BULK_UP, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Submission (66): dex 120/100/10, 33% recoil
  {
    label: "Move: Submission is 120 BP with 33% recoil",
    description:
      "Submission (66): ER dex is 120 power / 100 acc / 10 PP with 33% recoil (the\n"
      + "port had 150/80/15 and 25% recoil).\n"
      + "DO: use SUBMISSION on a bulky foe.\n"
      + "EXPECT: it never misses at close range (100 acc) and the recoil you take is\n"
      + "~1/3 of the damage dealt.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        MOVESET_OVERRIDE: [MoveId.SUBMISSION],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SHUCKLE,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.SUBMISSION, MoveId.KNOCK_OFF, MoveId.BULK_UP, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Powder Snow (181): power 80, 30% frostbite; Drill Peck (65): high crit
  {
    label: "Move: Powder Snow 80 BP + frostbite; Drill Peck high crit",
    description:
      "Powder Snow (181) is now power 80 with a 30% chance to FROSTBITE (ER status,\n"
      + "halves Sp. Atk), not the vanilla 40-BP freeze. Drill Peck (65) now has a HIGH\n"
      + "CRIT ratio.\n"
      + "DO: use POWDER SNOW a few times (watch for the frostbite proc); use DRILL PECK\n"
      + "repeatedly (watch the crit rate).\n"
      + "EXPECT: Powder Snow hits noticeably harder (80 BP) and can inflict FROSTBITE;\n"
      + "Drill Peck crits far more often than a normal move.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        MOVESET_OVERRIDE: [MoveId.POWDER_SNOW, MoveId.DRILL_PECK],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ARTICUNO, {
          moveset: [MoveId.POWDER_SNOW, MoveId.DRILL_PECK, MoveId.ICE_BEAM, MoveId.PROTECT],
        }),
      ];
    },
  },
  // MOVE — Barrier (112): sets Light Screen + Reflect under Psychic Terrain
  {
    label: "Move: Barrier sets both screens in Psychic Terrain",
    description:
      "Barrier (112): 'The user sets Light Screen AND Reflect if Psychic Terrain is\n"
      + "active.' (The port kept the vanilla Def+2.)\n"
      + "DO: (Psychic Terrain is pre-set) use BARRIER.\n"
      + "EXPECT: BOTH Reflect and Light Screen go up on your side (no Def+2). Off Psychic\n"
      + "Terrain the move fails.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_TERRAIN_OVERRIDE: TerrainType.PSYCHIC,
        MOVESET_OVERRIDE: [MoveId.BARRIER],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.BARRIER, MoveId.PSYCHIC, MoveId.CALM_MIND, MoveId.PROTECT],
        }),
      ];
    },
  },

  // ===========================================================================
  // ABILITY dex-fidelity batch (ER 2.65). Each fixes a PARTIAL/APPROXIMATION gap
  // vs the 2.65 dex. Combat-observable; verified headlessly + vitest.
  // ===========================================================================

  // 9 STATIC / 143 POISON TOUCH — the status proc now fires on OFFENSE too.
  {
    label: "Ability: Static paralyzes when ATTACKING (offense proc)",
    description:
      "Static (9) dex: 'chance to paralyze when attacking OR when hit — 30% contact,\n"
      + "10% non-contact.' The port only had the defense side.\n"
      + "DO: use TACKLE (contact) into the tanky foe repeatedly.\n"
      + "EXPECT: the FOE gets PARALYZED from being hit by your contact move (roughly 30%\n"
      + "per hit), in addition to the classic 'paralyzed when it hits you' side.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.STATIC,
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () =>
      boostEnemy([
        [Stat.DEF, 6],
        [Stat.SPDEF, 6],
      ]),
  },
  {
    label: "Ability: Poison Touch poisons on BOTH attack and defend",
    description:
      "Poison Touch (143) dex: '30% poison on contact moves, both when attacking AND\n"
      + "being attacked.' The port only had the offense side.\n"
      + "DO: let the foe (Poison Touch) get hit by / hit you with contact moves.\n"
      + "EXPECT: you get POISONED when you strike the Poison Touch foe with a contact\n"
      + "move (defense-side proc), not only when it strikes you.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        MOVESET_OVERRIDE: [MoveId.TACKLE],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.POISON_TOUCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
    onBattleStart: () =>
      boostEnemy([
        [Stat.DEF, 6],
        [Stat.SPDEF, 6],
      ]),
  },
  // 85 HEATPROOF — full burn immunity (not merely halved) + no burn Attack cut.
  {
    label: "Ability: Heatproof — full burn immunity",
    description:
      "Heatproof (85) dex: 'Immune to burn damage AND the Attack drop from burn.' The\n"
      + "port only HALVED the burn tick.\n"
      + "DO: you start BURNED. End a few turns.\n"
      + "EXPECT: you take ZERO burn tick damage each turn, and your physical damage is\n"
      + "NOT reduced by the burn.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.HEATPROOF,
        STATUS_OVERRIDE: StatusEffect.BURN,
        MOVESET_OVERRIDE: [MoveId.BODY_SLAM],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT, MoveId.CRUNCH],
        }),
      ];
    },
  },
  // 90 POISON HEAL — immune to the ER Toxic Terrain chip.
  {
    label: "Ability: Poison Heal — immune to Toxic Terrain chip",
    description:
      "Poison Heal (90) dex: 'Also prevents damage from Toxic terrain.' The port still\n"
      + "chipped a grounded non-Poison Poison-Heal holder.\n"
      + "DO: (Toxic Terrain is pre-set) end a few turns.\n"
      + "EXPECT: you take NO 1/16 toxic-terrain chip (a non-Poison-Heal grounded mon would).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.POISON_HEAL,
        STARTING_TERRAIN_OVERRIDE: TerrainType.TOXIC,
        MOVESET_OVERRIDE: [MoveId.PROTECT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.PROTECT, MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH],
        }),
      ];
    },
  },
  // 155 RATTLED — +1 Speed when the holder flinches.
  {
    label: "Ability: Rattled — +1 Speed on flinch",
    description:
      "Rattled (155) dex: '+1 Speed ... or when the user flinches.' The port only reacted\n"
      + "to Bug/Dark/Ghost hits (and an off-dex Intimidate).\n"
      + "DO: let the foe FAKE OUT you (100% flinch turn 1).\n"
      + "EXPECT: your Speed rises +1 from the flinch.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.RATTLED,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.HITMONTOP,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.FAKE_OUT],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        }),
      ];
    },
  },
  // 165 AROMA VEIL — Taunt/Encore/Torment immunity restored.
  {
    label: "Ability: Aroma Veil — immune to Taunt",
    description:
      "Aroma Veil (165) dex: protects from infatuation, heal block, AND disabling moves\n"
      + "'including Disable, Taunt, Encore, and Torment.' The port had dropped Taunt/\n"
      + "Encore/Torment.\n"
      + "DO: let the foe TAUNT you.\n"
      + "EXPECT: Taunt has NO effect — you can still use status moves.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.AROMA_VEIL,
        MOVESET_OVERRIDE: [MoveId.SPLASH, MoveId.CALM_MIND],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TAUNT],
      });
      return [
        makeStarter(SpeciesId.GARDEVOIR, {
          moveset: [MoveId.CALM_MIND, MoveId.MOONBLAST, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // 117 SNOW WARNING — Ice-type +50% Def under the summoned Hail.
  {
    label: "Ability: Snow Warning — Ice Def boost under Hail",
    description:
      "Snow Warning (117) dex: the summoned weather 'Boosts the Defense of Ice-type\n"
      + "Pokemon by 50%.' The port summoned HAIL but the +50% only fired under SNOW.\n"
      + "DO: (Hail auto-summons on entry) let a physical attacker hit your Ice-type.\n"
      + "EXPECT: your Ice-type takes noticeably less physical damage (its Def is x1.5).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.SNOW_WARNING,
        MOVESET_OVERRIDE: [MoveId.PROTECT],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BODY_SLAM],
      });
      return [
        makeStarter(SpeciesId.GLACEON, {
          moveset: [MoveId.PROTECT, MoveId.ICE_BEAM, MoveId.REST, MoveId.SPLASH],
        }),
      ];
    },
  },
  // 88 DOWNLOAD — a Def==SpDef tie raises ATTACK.
  {
    label: "Ability: Download — tie raises Attack",
    description:
      "Download (88) dex: 'If Special Defense is higher OR EQUAL, raise Attack.' On an\n"
      + "exact Def==SpDef tie the port used to raise Sp. Atk instead.\n"
      + "DO: (foe is a Ditto — equal Def/SpDef) observe the switch-in boost.\n"
      + "EXPECT: your ATTACK rises +1 (not Sp. Atk).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.DOWNLOAD,
        MOVESET_OVERRIDE: [MoveId.SPLASH],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.DITTO,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PORYGON_Z, {
          moveset: [MoveId.SPLASH, MoveId.TRI_ATTACK, MoveId.RECOVER, MoveId.PROTECT],
        }),
      ];
    },
  },
  // 7 LIMBER — Jump Kick crash damage halved.
  {
    label: "Ability: Limber — halves Jump Kick crash damage",
    description:
      "Limber (7) dex: 'All recoil halved ... including crash damage like Jump Kick.'\n"
      + "The port never halved the maxHp/2 crash.\n"
      + "DO: use JUMP KICK and MISS (the foe Protects, or it just misses).\n"
      + "EXPECT: the crash costs only ~1/4 max HP (not 1/2).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.LIMBER,
        MOVESET_OVERRIDE: [MoveId.JUMP_KICK],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.PROTECT],
      });
      return [
        makeStarter(SpeciesId.HITMONLEE, {
          moveset: [MoveId.JUMP_KICK, MoveId.CLOSE_COMBAT, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // 164 TERAVOLT — does NOT bypass base-stat abilities (Grass Pelt).
  {
    label: "Ability: Teravolt keeps Grass Pelt active",
    description:
      "Teravolt (164) dex: 'Does not bypass abilities that modify base stats such as\n"
      + "Grass Pelt.' The port's Mold-Breaker bypass wrongly ignored Grass Pelt's Def.\n"
      + "DO: (Grassy Terrain is pre-set) attack the Grass Pelt foe.\n"
      + "EXPECT: the foe's Grass Pelt Def boost still applies — your hit is NOT stronger\n"
      + "than a non-Teravolt attacker's would be.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 5,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.TERAVOLT,
        STARTING_TERRAIN_OVERRIDE: TerrainType.GRASSY,
        MOVESET_OVERRIDE: [MoveId.BODY_SLAM],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.GRASS_PELT,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ZEKROM, {
          moveset: [MoveId.BODY_SLAM, MoveId.FUSION_BOLT, MoveId.PROTECT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // ER ability dex-fidelity batch 2 (Section B)
  // ===========================================================================
  {
    label: "Ability: Mirror Armor bypasses Clear Body",
    description:
      "Mirror Armor (240) dex: 'The reflection bypasses immunities.' When a Clear Body\n"
      + "foe lowers your stat, Mirror Armor reflects the drop back onto it - and the\n"
      + "reflection must land THROUGH Clear Body (Full Metal Body / Mist too).\n"
      + "DO: let the Clear Body foe use Growl on you (it lowers your Attack). Watch the\n"
      + "reflection.\n"
      + "EXPECT: your Attack is NOT lowered (Mirror Armor reflects it) AND the foe's own\n"
      + "Attack drops to -1 even though it has Clear Body. Before the fix Clear Body\n"
      + "cancelled the reflected drop.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.MIRROR_ARMOR,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.METAGROSS,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.CLEAR_BODY,
        ENEMY_MOVESET_OVERRIDE: [MoveId.GROWL],
      });
      return [
        makeStarter(SpeciesId.CORVIKNIGHT, {
          moveset: [MoveId.SPLASH, MoveId.BRAVE_BIRD, MoveId.IRON_HEAD, MoveId.ROOST],
        }),
      ];
    },
  },
  {
    label: "Ability: Guard Dog inverts Scare",
    description:
      "Guard Dog (553) dex: 'or Scare ... raises the stat instead of lowering it.' A foe\n"
      + "with Scare lowers your Sp. Atk on entry; Guard Dog must RAISE the same stat.\n"
      + "DO: start the battle vs the Scare foe and read your stat stages (open Summary).\n"
      + "EXPECT: your Sp. Atk is +1 (raised), NOT lowered, and NOT a wrong Attack bump.\n"
      + "(Vs a plain Intimidate foe, Guard Dog still raises Attack +1 - also correct.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.GUARD_DOG,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: erAbility(5067), // Scare (lowers foes' Sp.Atk on entry)
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MIGHTYENA, {
          moveset: [MoveId.CRUNCH, MoveId.PLAY_ROUGH, MoveId.SPLASH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Haunted Spirit spares Ghost KOers",
    description:
      "Haunted Spirit (335) dex: 'Ghost-type attackers are immune to the curse.' When\n"
      + "this mon is KO'd, its attacker is Cursed (25%/turn) - UNLESS the attacker is\n"
      + "Ghost-type.\n"
      + "DO: let a GHOST foe (Gengar) KO your Haunted Spirit lead, then watch the foe.\n"
      + "EXPECT: the Gengar is NOT Cursed (no curse chip). A NON-Ghost KOer would be\n"
      + "Cursed - before the fix even a Ghost attacker got Cursed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5073), // Haunted Spirit
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GENGAR,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SHADOW_BALL],
      });
      return [
        makeStarter(SpeciesId.SHUCKLE, {
          moveset: [MoveId.SPLASH, MoveId.REST, MoveId.ROCK_SLIDE, MoveId.TOXIC],
        }),
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Ability: Mountaineer ignores Stealth Rock",
    description:
      "Mountaineer (314) dex: 'Immune to all Rock-type attacks AND Stealth Rock damage.'\n"
      + "The Rock-move immunity worked; the Stealth Rock hazard damage was NOT waived.\n"
      + "DO: with Stealth Rock on your side, switch the Mountaineer mon (Aggron) in.\n"
      + "EXPECT: it takes ZERO switch-in damage from Stealth Rock (and Rock attacks still\n"
      + "do nothing to it).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5052), // Mountaineer
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.STEALTH_ROCK],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH],
        }),
        makeStarter(SpeciesId.AGGRON, {
          moveset: [MoveId.IRON_HEAD, MoveId.EARTHQUAKE, MoveId.SPLASH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Moon Spirit Moonlight heals 75%",
    description:
      "Moon Spirit (478) dex: 'When using Moonlight, recovery increases to 75% max HP\n"
      + "instead of normal 50%.'\n"
      + "DO: drop to low HP (let the foe chip you), then use Moonlight in clear weather.\n"
      + "EXPECT: Moonlight restores ~75% of max HP (noticeably more than the usual half).\n"
      + "Before the fix it healed the normal 50%.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5209), // Moon Spirit
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SEISMIC_TOSS],
      });
      return [
        makeStarter(SpeciesId.UMBREON, {
          moveset: [MoveId.MOONLIGHT, MoveId.FOUL_PLAY, MoveId.SPLASH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Jaws of Carnage biting KO heals 50%",
    description:
      "Jaws of Carnage (438) dex: 'Restores 50% max HP when defeating foes with biting\n"
      + "moves, or 25% with other moves.'\n"
      + "DO: at reduced HP, KO a frail foe with a BITING move (Crunch/Bite), note the\n"
      + "heal. Repeat KOing with a NON-biting move (Waterfall).\n"
      + "EXPECT: the biting KO restores ~50% max HP; the non-biting KO only ~25%. Before\n"
      + "the fix every KO healed a flat 50%.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5174), // Jaws of Carnage
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GYARADOS, {
          moveset: [MoveId.BITE, MoveId.WATERFALL, MoveId.SPLASH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Toxic Surge grounded Steel safe",
    description:
      "Toxic Surge (834) dex: grounded non-Poison AND non-Steel mons take 1/16 each turn\n"
      + "on Toxic Terrain. The chip wrongly hit grounded Steel-types.\n"
      + "DO: with Toxic Surge up (auto on entry), let a grounded STEEL foe (Aggron) sit a\n"
      + "few turns.\n"
      + "EXPECT: the grounded Steel foe takes NO end-of-turn toxic-terrain chip (Poison-\n"
      + "types are also immune). A grounded Normal-type still takes 1/16.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5535), // Toxic Surge
        ENEMY_SPECIES_OVERRIDE: SpeciesId.AGGRON,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MUK, {
          moveset: [MoveId.SLUDGE_BOMB, MoveId.SPLASH, MoveId.REST, MoveId.TOXIC],
        }),
      ];
    },
  },
  {
    label: "Ability: Air Blower 3-turn Tailwind",
    description:
      "Air Blower (320) dex: 'Casts a 3-turn Tailwind on entry.' The port cast a 4-turn\n"
      + "Tailwind (the move's duration).\n"
      + "DO: send the Air Blower mon out and count the Tailwind duration.\n"
      + "EXPECT: your side's Speed is doubled for exactly 3 turns (not 4). Wind Rider\n"
      + "allies still get their Attack bump.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5058), // Air Blower
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIDGEOT, {
          moveset: [MoveId.BRAVE_BIRD, MoveId.HURRICANE, MoveId.SPLASH, MoveId.ROOST],
        }),
      ];
    },
  },
  {
    label: "Ability: Weather Control blocks Storm moves",
    description:
      "Weather Control (354) dex: immune to Thunder, Solar Beam/Blade, Hurricane,\n"
      + "Blizzard, Silver Wind, all Storm moves (Wildbolt/Bleakwind/Sandsear/Springtide),\n"
      + "Sheer Cold, and Pledge moves. The Storm/Silver-Wind/Sheer-Cold/Pledge set was\n"
      + "missing.\n"
      + "DO: let the foe hit you with Bleakwind Storm (or Silver Wind / Fire Pledge).\n"
      + "EXPECT: the weather-based move does NO damage to the Weather Control holder.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5092), // Weather Control
        ENEMY_SPECIES_OVERRIDE: SpeciesId.TORNADUS,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.BLEAKWIND_STORM],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.SPLASH, MoveId.REST, MoveId.CRUNCH],
        }),
      ];
    },
  },
  {
    label: "Ability: Toxic Debris needs contact",
    description:
      "Toxic Debris (402) dex: 'Sets Toxic Spikes when hit by CONTACT moves.' The port\n"
      + "fired on any PHYSICAL move (so Earthquake wrongly set spikes) and missed special\n"
      + "contact moves.\n"
      + "DO: let the foe hit you with a physical NON-contact move (Earthquake) - no spikes\n"
      + "should appear. Then a CONTACT move (Tackle) - spikes should appear on the foe.\n"
      + "EXPECT: Toxic Spikes are laid on the foe's side only on the CONTACT hit.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.TOXIC_DEBRIS,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.EARTHQUAKE, MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH],
        }),
      ];
    },
  },
  {
    label: "Ability: Fighting Spirit retypes Normal",
    description:
      "Fighting Spirit (300) dex: 'Changes Normal moves to Fighting. If the user is\n"
      + "Fighting-type its Fighting moves break screens, otherwise gains Fighting STAB.'\n"
      + "DO: attack with a Normal move (Body Slam) - it now resolves as Fighting.\n"
      + "EXPECT: Body Slam is Fighting-typed (super-effective vs the Normal foe) and gets\n"
      + "STAB on your non-Fighting mon. If the holder IS Fighting-type, its Fighting moves\n"
      + "shatter the foe's Reflect/Light Screen.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5038), // Fighting Spirit
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.BODY_SLAM, MoveId.HYPER_VOICE, MoveId.SPLASH, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Ability: Exploit Weakness targets lower def",
    description:
      "Exploit Weakness (284) dex: 'When attacking a statused opponent, targets their\n"
      + "LOWER defensive stat.' Now a real defensive-stat swap (effective Def/SpDef incl.\n"
      + "stages), not a capped power proxy.\n"
      + "DO: poison the foe (or it starts statused), then hit it with a PHYSICAL move even\n"
      + "though its Defense is much higher than its Sp. Def.\n"
      + "EXPECT: the physical hit is computed against the foe's LOWER (Sp.Def) stat, so it\n"
      + "hits far harder than a normal physical move into its high Defense would.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5022), // Exploit Weakness
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SHUCKLE, // huge Def, low-ish SpDef relative
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_STATUS_OVERRIDE: StatusEffect.POISON,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.KNOCK_OFF, MoveId.SPLASH, MoveId.REST],
        }),
      ];
    },
  },
  // ===================================================================
  // Move dex-fidelity batch (Section B) — combat-observable move fixes
  // ===================================================================
  {
    label: "Move: Glare paralyzes Electric-types",
    description:
      "Glare (137) dex effect 41 'Paralyze Ignore Type' / 'Can paralyze Electric-types'.\n"
      + "The port kept the vanilla Electric paralysis immunity so Glare whiffed on them.\n"
      + "DO: use Glare on the Electric-type foe (Jolteon).\n"
      + "EXPECT: the foe IS paralyzed (message 'was paralyzed'), despite being Electric.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.JOLTEON,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.QUICK_ATTACK],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.GLARE, MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH],
        }),
      ];
    },
  },
  {
    label: "Move: Stomp destroys the terrain",
    description:
      "Stomp (23) dex 'Destroys terrain. 30% chance to flinch. Strike boost.' The terrain\n"
      + "wipe was never wired.\n"
      + "DO: battle starts on Electric Terrain; use Stomp on the foe.\n"
      + "EXPECT: the Electric Terrain is cleared after Stomp resolves (no terrain banner).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_TERRAIN_OVERRIDE: TerrainType.ELECTRIC,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.TAUROS, {
          moveset: [MoveId.STOMP, MoveId.BODY_SLAM, MoveId.REST, MoveId.GROWL],
        }),
      ];
    },
  },
  {
    label: "Move: Sheer Cold hits Ice-types",
    description:
      "Sheer Cold (329) ER redesign is a regular 100-BP Ice special; the dex lists NO Ice\n"
      + "immunity, but the port kept IceNoEffectTypeAttr and zeroed damage vs Ice foes.\n"
      + "DO: use Sheer Cold on the Ice foe (Glaceon).\n"
      + "EXPECT: it DEALS damage ('not very effective', ~0.5x) instead of doing nothing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.GLACEON,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.LAPRAS, {
          moveset: [MoveId.SHEER_COLD, MoveId.SURF, MoveId.REST, MoveId.GROWL],
        }),
      ];
    },
  },
  {
    label: "Move: Scary Face inflicts Fear",
    description:
      "Scary Face (184) dex effect 98 'Inflicts Fear and sharply lowers Speed.' The port\n"
      + "only dropped Speed.\n"
      + "DO: use Scary Face on the foe.\n"
      + "EXPECT: the foe's Speed falls 2 stages AND it is inflicted with ER Fear (trapped 2\n"
      + "turns, takes +50% damage). Try to make it flee/switch - it can't while Feared.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.SCARY_FACE, MoveId.BODY_SLAM, MoveId.REST, MoveId.CRUNCH],
        }),
      ];
    },
  },
  {
    label: "Move: Sweet Kiss confuses + infatuates",
    description:
      "Sweet Kiss (186) dex effect 99 'Causes confusion AND infatuation.' The port only\n"
      + "confused.\n"
      + "DO: use Sweet Kiss on an opposite-gender foe.\n"
      + "EXPECT: the foe is BOTH confused and infatuated (ER Infatuation = -50% its damage).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.NIDOKING, // male, so a female user infatuates it
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.CLEFABLE, {
          female: true,
          moveset: [MoveId.SWEET_KISS, MoveId.MOONBLAST, MoveId.REST, MoveId.GROWL],
        }),
      ];
    },
  },
  {
    label: "Move: Megahorn ignores foe stat drops",
    description:
      "Megahorn (224) dex 'Ignores foe's stat changes. Mighty Horn boost.' The stat-ignore\n"
      + "was missing.\n"
      + "DO: the foe starts at +6 Defense; hit it with Megahorn.\n"
      + "EXPECT: Megahorn deals damage as if the foe's Defense were unboosted (the +6 Def is\n"
      + "ignored), so it hits far harder than a normal physical move into +6 Def.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.HERACROSS, {
          moveset: [MoveId.MEGAHORN, MoveId.CLOSE_COMBAT, MoveId.REST, MoveId.GROWL],
        }),
      ];
    },
    onBattleStart: () => boostEnemy([[Stat.DEF, 6]]),
  },
  {
    label: "Move: Heal Bell self-heals 30%",
    description:
      "Heal Bell (215) dex 'Heals the status problems of allies and restores 30% HP to the\n"
      + "user.' The 30% self-heal was missing (Aromatherapy 312 got the same fix).\n"
      + "DO: start burned; let the foe chip your HP a turn, then use Heal Bell.\n"
      + "EXPECT: your party's status is cured AND the user regains ~30% of its max HP.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        STATUS_OVERRIDE: StatusEffect.BURN,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MACHAMP,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.KARATE_CHOP],
      });
      return [
        makeStarter(SpeciesId.BLISSEY, {
          moveset: [MoveId.HEAL_BELL, MoveId.BODY_SLAM, MoveId.REST, MoveId.GROWL],
        }),
      ];
    },
  },
  {
    label: "Move: Sandstorm / Hail last 8 turns",
    description:
      "Sandstorm (201) and Hail (258) dex both say 'lasting eight turns'; the move-set\n"
      + "weather defaulted to vanilla's 5 turns.\n"
      + "DO: use Sandstorm (or Hail); count the weather turns.\n"
      + "EXPECT: the storm lasts 8 turns (the ER convention), not 5.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.SANDSTORM, MoveId.HAIL, MoveId.STONE_EDGE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Move: Covet always steals + itemless prio",
    description:
      "Covet (343) dex effect 88 @100% 'Steals or removes the foe's item' + '+1 priority if\n"
      + "the user has no item.' The port stole only 30% and had no priority clause.\n"
      + "DO: with no held item, use Covet on a foe holding an item (e.g. Leftovers).\n"
      + "EXPECT: Covet moves at +1 priority AND steals the foe's item 100% of the time.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.COVET, MoveId.BODY_SLAM, MoveId.REST, MoveId.GROWL],
        }),
      ];
    },
  },
  // ===========================================================================
  // FINAL move dex-fidelity batch (er 379/380/388/404/510/524/532/563/570/577/
  // 580/581/604/641/798/824/843/911/979). Appended 2026-07.
  // ===========================================================================
  {
    label: "Move: Gastro Acid also poisons",
    description:
      "Gastro Acid (380, effect 213) dex 'negating its abilities and poisoning it' -\n"
      + "the port only suppressed the ability, never poisoned.\n"
      + "DO: use Gastro Acid on the foe.\n"
      + "EXPECT: the foe's ability is suppressed AND it is poisoned (100%).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.INTIMIDATE,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MEW, {
          moveset: [MoveId.GASTRO_ACID, MoveId.PSYCHIC, MoveId.RECOVER, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Move: Terrain moves last 8 turns",
    description:
      "Grassy (580) / Misty (581) / Electric (604) / Psychic (641) Terrain dex all read\n"
      + "'For 8 turns'; the move-set defaulted to vanilla's 5 turns (only the terrain\n"
      + "ABILITIES set 8).\n"
      + "DO: use each terrain move; count the terrain turns.\n"
      + "EXPECT: the terrain lasts 8 turns, not 5 (Terrain Extender still adds +3).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.TAPU_KOKO, {
          moveset: [MoveId.GRASSY_TERRAIN, MoveId.MISTY_TERRAIN, MoveId.ELECTRIC_TERRAIN, MoveId.PSYCHIC_TERRAIN],
        }),
      ];
    },
  },
  {
    label: "Move: Frost Breath 30% frostbite",
    description:
      "Frost Breath (524, effect 4 @30%) is an always-crit Ice move that should have a\n"
      + "30% frostbite chance; the port left the chance dangling (no status wired).\n"
      + "DO: spam Frost Breath on a bulky foe (it always crits).\n"
      + "EXPECT: it always crits AND ~30% of hits inflict frostbite (ER FREEZE remap).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 90,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ARTICUNO, {
          moveset: [MoveId.FROST_BREATH, MoveId.SPLASH, MoveId.ROOST, MoveId.HURRICANE],
        }),
      ];
    },
  },
  {
    label: "Move: Aqua Cutter 20% bleed",
    description:
      "Aqua Cutter (843) dex '20% bleed chance. High crit ratio.' The port had the high\n"
      + "crit but the 20% ER Bleed never procced (chance was dangling).\n"
      + "DO: spam Aqua Cutter on a bulky, non-Rock/Ghost foe.\n"
      + "EXPECT: high crit rate AND ~20% of hits inflict ER Bleed (1/16 chip per turn).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 40,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 90,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GRENINJA, {
          moveset: [MoveId.AQUA_CUTTER, MoveId.SPLASH, MoveId.SUBSTITUTE, MoveId.HAZE],
        }),
      ];
    },
  },
  {
    label: "Move: Worry Seed inflicts Fear",
    description:
      "Worry Seed (388, effect 221) dex 'causes Fear and gives Insomnia'; the port only\n"
      + "changed the ability to Insomnia.\n"
      + "DO: use Worry Seed on the foe.\n"
      + "EXPECT: the foe's ability becomes Insomnia AND it is inflicted with ER Fear\n"
      + "(trapped 2 turns, takes +50% damage).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.BRELOOM, {
          moveset: [MoveId.WORRY_SEED, MoveId.SEED_BOMB, MoveId.MACH_PUNCH, MoveId.SPORE],
        }),
      ];
    },
  },
  {
    label: "Move: Draining Kiss / Parabolic heals",
    description:
      "Draining Kiss (577) dex heals 50% of damage (port wrongly healed 75%); Parabolic\n"
      + "Charge (570) dex heals 25% (port wrongly healed 50%).\n"
      + "DO: at reduced HP, use each on a bulky foe and watch the self-heal amount.\n"
      + "EXPECT: Draining Kiss heals 50% of the damage dealt; Parabolic Charge heals 25%.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 70,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 90,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MEW, {
          moveset: [MoveId.DRAINING_KISS, MoveId.PARABOLIC_CHARGE, MoveId.BELLY_DRUM, MoveId.SPLASH],
        }),
      ];
    },
    onBattleStart: () => {
      // Drop the user to ~40% HP so the drain heal is visible.
      const mon = globalScene.getPlayerPokemon();
      if (mon) {
        mon.hp = Math.max(1, Math.floor(mon.getMaxHp() * 0.4));
      }
    },
  },
  {
    label: "Move: Horn Leech ignores stat changes",
    description:
      "Horn Leech (532) dex 'Absorbs half the damage. Ignores foe's stat changes.' The\n"
      + "port drained 50% but did NOT ignore the target's defensive stat stages.\n"
      + "DO: let the foe raise its Defense (e.g. +6), then use Horn Leech.\n"
      + "EXPECT: Horn Leech ignores the foe's Def boosts (full damage) and drains 50%.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SAWSBUCK, {
          moveset: [MoveId.HORN_LEECH, MoveId.SPLASH, MoveId.SWORDS_DANCE, MoveId.JUMP_KICK],
        }),
      ];
    },
    onBattleStart: () => {
      boostEnemy([[Stat.DEF, 6]]);
    },
  },
  {
    label: "Move: X-Scissor high crit",
    description:
      "X-Scissor (404) dex 'High crit ratio'; the port left it at the normal crit rate.\n"
      + "DO: spam X-Scissor and watch the crit frequency.\n"
      + "EXPECT: a visibly elevated (~1/8) crit rate, not the normal ~1/24.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 90,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SCIZOR, {
          moveset: [MoveId.X_SCISSOR, MoveId.SPLASH, MoveId.SWORDS_DANCE, MoveId.ROOST],
        }),
      ];
    },
  },
  {
    label: "Move: Power Trick swaps Atk+Def & boosts",
    description:
      "Power Trick (379) dex 'swaps its Attack and Defense stats AND stat boosts.' The\n"
      + "port swapped only the base stats, not the ATK/DEF stat stages.\n"
      + "DO: raise Attack a few stages (Swords Dance), then use Power Trick.\n"
      + "EXPECT: base Atk<->Def swap AND the Atk stages move to Def (and vice-versa).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SHUCKLE, {
          moveset: [MoveId.POWER_TRICK, MoveId.SWORDS_DANCE, MoveId.ROCK_SLIDE, MoveId.REST],
        }),
      ];
    },
  },
  {
    label: "Move: Headlong Rush no Iron Fist boost",
    description:
      "Headlong Rush (824) dex flags = Makes Contact only. The port wrongly flagged it\n"
      + "PUNCHING, so Iron Fist / punch-boosters buffed it.\n"
      + "DO: use Headlong Rush with Iron Fist active vs without.\n"
      + "EXPECT: identical damage - Iron Fist does NOT boost Headlong Rush.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ABILITY_OVERRIDE: AbilityId.IRON_FIST,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 90,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.URSALUNA, {
          moveset: [MoveId.HEADLONG_RUSH, MoveId.SPLASH, MoveId.SWORDS_DANCE, MoveId.CRUNCH],
        }),
      ];
    },
  },
  {
    label: "Move: Supercell Slam is hammer-based",
    description:
      "Supercell Slam (911) dex 'Hammer-based'; the port never set the HAMMER_BASED flag,\n"
      + "so ER's Super Slammer ability didn't boost it.\n"
      + "DO: use Supercell Slam with Super Slammer active.\n"
      + "EXPECT: Super Slammer boosts Supercell Slam (it now counts as a hammer move).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 90,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ELECTIVIRE, {
          moveset: [MoveId.SUPERCELL_SLAM, MoveId.SPLASH, MoveId.EARTHQUAKE, MoveId.ICE_PUNCH],
        }),
      ];
    },
  },
  {
    label: "Move: Rototiller +2 in Grassy Terrain",
    description:
      "Rototiller (563) dex boosts Grass Atk/SpAtk +1, 'or 2 stages in Grassy Terrain.'\n"
      + "The port always granted +1.\n"
      + "DO: set Grassy Terrain, then use Rototiller (user is Grass + grounded).\n"
      + "EXPECT: +2 Atk and +2 SpAtk in Grassy Terrain (+1 each on plain ground).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SAWSBUCK, {
          moveset: [MoveId.ROTOTILLER, MoveId.GRASSY_TERRAIN, MoveId.HORN_LEECH, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Move: Safe Passage shields the switch-in",
    description:
      "Safe Passage (979) dex 'Guides an ally onto the field. They take -35% damage this\n"
      + "turn.' The port only did the self-switch; the incoming mon got no shield.\n"
      + "DO: in a double battle, use Safe Passage; a benched ally is guided in.\n"
      + "EXPECT: the user switches out, the replacement is 'guided to safety', and any\n"
      + "damage it takes THIS turn is reduced by 35%.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        BATTLE_STYLE_OVERRIDE: "double",
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 70,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MEW, {
          moveset: [ErMoveId.SAFE_PASSAGE as MoveId, MoveId.PSYCHIC, MoveId.RECOVER, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.MEWTWO, {
          moveset: [MoveId.PSYCHIC, MoveId.RECOVER, MoveId.ICE_BEAM, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.CELEBI, {
          moveset: [MoveId.GIGA_DRAIN, MoveId.RECOVER, MoveId.PSYCHIC, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Move: Diamond Blade 10% Stealth Rock",
    description:
      "Diamond Blade (798) dex 'Slashes with an unbreakable blade. 10% chance of Stealth\n"
      + "Rocks. Keen Edge boost.' The port had the slice boost but never set the rocks.\n"
      + "DO: spam Diamond Blade on the foe.\n"
      + "EXPECT: ~10% of hits scatter Stealth Rock onto the foe's side of the field.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 60,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 90,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.KLEAVOR, {
          moveset: [ErMoveId.DIAMOND_BLADE as MoveId, MoveId.SPLASH, MoveId.SWORDS_DANCE, MoveId.CLOSE_COMBAT],
        }),
      ];
    },
  },
  {
    label: "Move: Incinerate burns Berries AND Gems",
    description:
      "Incinerate (510, effect 266) dex 'burns up any Berry or Gem the foe holds.' The\n"
      + "port only stripped berries, never ER elemental Gems.\n"
      + "DO: use Incinerate on a foe holding an ER elemental Gem (or a Berry).\n"
      + "EXPECT: the foe's Berry OR Gem is burned up (removed).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS }],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [MoveId.INCINERATE, MoveId.SPLASH, MoveId.ROOST, MoveId.AIR_SLASH],
        }),
      ];
    },
  },
  {
    label: "Move: Trick swaps held items",
    description:
      "Trick (271) dex 'The user swaps its held item with the target's.' The port\n"
      + "left it unimplemented (did nothing).\n"
      + "DO: use Trick on the foe (you hold Leftovers, the foe holds a Wide Lens).\n"
      + "EXPECT: after Trick YOU hold the foe's Wide Lens and the FOE holds your\n"
      + "Leftovers. Untradeable items (Mega Stones) never swap.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 70,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "WIDE_LENS" }],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [MoveId.TRICK, MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.SPLASH],
        }),
      ];
    },
  },
  {
    label: "Move: Magic Room suppresses held items",
    description:
      "Magic Room (478) dex 'Suppresses the effects of all held items on the field\n"
      + "for 5 turns.' The port left it unimplemented.\n"
      + "DO: take some chip damage, then use Magic Room while holding Leftovers.\n"
      + "EXPECT: for 5 turns Leftovers gives NO end-of-turn heal (all held-item\n"
      + "effects are off, both sides); after Magic Room ends, Leftovers heals again.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 70,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.SNORLAX, {
          moveset: [MoveId.MAGIC_ROOM, MoveId.SPLASH, MoveId.REST, MoveId.BODY_SLAM],
        }),
      ];
    },
  },
  {
    label: "Move: Transmute regens item on KO",
    description:
      "Transmute (970) dex 'Recovers a used item if this attack knocks out the\n"
      + "opponent.' The port ran the 80-BP body but never regenerated the item.\n"
      + "DO: lose/consume a held item this battle (e.g. eat your Sitrus Berry by\n"
      + "dropping below 25% HP, or get it Knocked Off), then KO a foe with Transmute.\n"
      + "EXPECT: on the KO your most-recently consumed/lost item is regenerated.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 40,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [erMove(ErMoveId.TRANSMUTE), MoveId.SHADOW_BALL, MoveId.SPLASH, MoveId.PAIN_SPLIT],
        }),
      ];
    },
  },
  {
    label: "Ability: Harvest regrows a Flung berry",
    description:
      "Harvest (139) dex also regrows a berry consumed via Fling / Natural Gift (the\n"
      + "port marked this an edge case). Fling here is a berry-fling (consumes the\n"
      + "held berry, ledgered like an eaten berry).\n"
      + "DO: with Harvest and a Sitrus Berry, in Sun, use Fling.\n"
      + "EXPECT: at end of turn Harvest (100% in Sun) regrows the flung Sitrus Berry.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 70,
        ABILITY_OVERRIDE: AbilityId.HARVEST,
        WEATHER_OVERRIDE: WeatherType.SUNNY,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 70,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.TROPIUS, {
          moveset: [MoveId.FLING, MoveId.SPLASH, MoveId.SYNTHESIS, MoveId.AIR_SLASH],
        }),
      ];
    },
  },
  {
    label: "Ability: Unnerve blocks foe consumables",
    description:
      "Unnerve (127) dex 'Prevents opposing Pokemon from consuming their held items'\n"
      + "— ALL consumables, not just berries. The port blocked only berries.\n"
      + "DO: with Unnerve on your side, hit a foe holding a berry / pinch item.\n"
      + "EXPECT: the foe cannot consume ANY held item (berry OR non-berry) while\n"
      + "Unnerve is on the field.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 55,
        STARTING_LEVEL_OVERRIDE: 80,
        ABILITY_OVERRIDE: AbilityId.UNNERVE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 80,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.SITRUS }],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MEWTWO, {
          moveset: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.ICE_BEAM, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Forewarn (108) — casts an 80-BP always-hit Future Sight on entry
  // ===========================================================================
  {
    label: "Ability: Forewarn casts 80-BP Future Sight",
    description:
      "Forewarn (2.65 dex): 'Casts an 80 BP Future Sight on the opposing Pokemon when\n"
      + "switching in. Strikes 2 turns later … cannot miss once initiated … cannot\n"
      + "target the same Pokemon twice.' A DEDICATED 80-BP always-hit Future Sight\n"
      + "variant is cast (NOT the real 120-BP move).\n"
      + "DO: send out Alakazam (Forewarn). Just Splash for ~3 turns and watch the foe.\n"
      + "EXPECT: ~2 turns after entry the foe is struck by Future Sight for an 80-BP\n"
      + "special hit (it ALWAYS connects), even though you only ever Splashed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.FOREWARN,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY, // tanky — survives to show the strike
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.SPLASH, MoveId.PSYCHIC, MoveId.RECOVER, MoveId.CALM_MIND],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Flare Boost (138) — self-ignites (burn) in Eerie Fog
  // ===========================================================================
  {
    label: "Ability: Flare Boost self-ignites in fog",
    description:
      "Flare Boost (2.65 dex): '+50% Special Attack when burned. Negates burn damage.\n"
      + "Immediately applies burn to self in fog.' Under Eerie Fog a Flare Boost holder\n"
      + "burns ITSELF on entry, then enjoys the +50% SpAtk with no burn chip.\n"
      + "DO: send out Mightyena (Flare Boost) with Eerie Fog already on the field.\n"
      + "EXPECT: on entry Mightyena is BURNED by its own ability, takes NO burn damage\n"
      + "at end of turn (negated), and its Special Attack is boosted +50%.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        WEATHER_OVERRIDE: WeatherType.EERIE_FOG,
        ABILITY_OVERRIDE: AbilityId.FLARE_BOOST,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MIGHTYENA, {
          moveset: [MoveId.DARK_PULSE, MoveId.SLUDGE_BOMB, MoveId.SPLASH, MoveId.CALM_MIND],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Aerilate (184) — a Flying user's Flying moves are 10% stronger
  // ===========================================================================
  {
    label: "Ability: Aerilate +10% for a Flying user",
    description:
      "Aerilate (2.65 dex): 'Normal moves become Flying. If the user is Flying-type its\n"
      + "Flying moves are 10% faster, otherwise it gains Flying STAB.' The ER ROM\n"
      + "implements the '10% faster' clause as a 1.1× DAMAGE boost on the Flying user's\n"
      + "Flying moves (same as every sibling -ate ability), on top of natural STAB.\n"
      + "DO: attack Chansey with Pidgeot (Aerilate) using Gust a few times.\n"
      + "EXPECT: Gust hits ~10% harder than the same Pidgeot would without Aerilate.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.AERILATE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIDGEOT, {
          moveset: [MoveId.GUST, MoveId.HYPER_BEAM, MoveId.AIR_SLASH, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Sharpen (159) — grants Cutthroat to a non-Cutthroat user
  // ===========================================================================
  {
    label: "Move: Sharpen grants Cutthroat",
    description:
      "Sharpen (2.65 dex): 'The user sharpens its edges. Raises highest Attack and Crit\n"
      + "and sets Cutthroat.' Besides raising the higher attacking stat + crit odds, using\n"
      + "Sharpen SETS the user's ability to Cutthroat (a non-Cutthroat holder).\n"
      + "DO: with Kingambit (BALL_FETCH), use Sharpen on turn 1, then check the ability.\n"
      + "EXPECT: after Sharpen, Kingambit's ability is now Cutthroat, its highest\n"
      + "attacking stat rose, and its crit rate is boosted.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.KINGAMBIT, {
          moveset: [MoveId.SHARPEN, MoveId.KOWTOW_CLEAVE, MoveId.IRON_HEAD, MoveId.SUCKER_PUNCH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Psywave (149) — a real 40-BP special (scales with SpAtk), not level×rand
  // ===========================================================================
  {
    label: "Move: Psywave scales with SpAtk",
    description:
      "Psywave (2.65 dex): a 40-BP special move (+1 priority, 10% confuse) that uses the\n"
      + "NORMAL damage formula — NOT vanilla's level×random fixed damage. The subclass\n"
      + "RandomLevelDamageAttr is now stripped so stats/STAB drive the damage.\n"
      + "DO: hit Chansey with Alakazam's Psywave. Then Calm Mind (+SpAtk) and hit again.\n"
      + "EXPECT: Psywave deals normal special damage that GROWS as your SpAtk rises (it is\n"
      + "no longer a flat level-based chip); ~10% of hits also confuse the foe.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.PSYWAVE, MoveId.CALM_MIND, MoveId.RECOVER, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Snatch (289) — steal the foe's self-targeting move
  // ===========================================================================
  {
    label: "Move: Snatch steals a self-buff",
    description:
      "Snatch (2.65 dex): 'Steals the effects of the foe's healing or status-changing move.'\n"
      + "Snatch (priority +4) primes the user; the next self-targeting status/heal/stat move the\n"
      + "foe uses this turn is stolen and performed by the Snatch user instead.\n"
      + "DO: use Snatch on turn 1 while the foe uses Swords Dance (or swap its moveset to Recover).\n"
      + "EXPECT: 'Regirock snatched the foe's move!' — YOUR Regirock gets +2 Atk (or the heal),\n"
      + "and the foe gains nothing.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.CHANSEY,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SWORDS_DANCE],
      });
      return [
        makeStarter(SpeciesId.REGIROCK, {
          moveset: [MoveId.SNATCH, MoveId.ROCK_SLIDE, MoveId.EARTHQUAKE, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Me First (382) — copy the foe's queued attack at x1.5, going first
  // ===========================================================================
  {
    label: "Move: Me First copies the foe's attack",
    description:
      "Me First (2.65 dex): 'The foe's intended move is stolen and used first, with greater power.'\n"
      + "The (faster) user reads the foe's queued attacking move and performs it FIRST at x1.5 power.\n"
      + "Fails if the foe already moved or chose a status move.\n"
      + "DO: use Me First while the slow foe (Shuckle) has an attacking move queued (Rock Slide).\n"
      + "EXPECT: your fast Regieleki goes first and uses the FOE's Rock Slide at x1.5; then the foe\n"
      + "takes its own turn normally. (Against a status move, Me First just fails.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SHUCKLE,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.ROCK_SLIDE],
      });
      return [
        makeStarter(SpeciesId.REGIELEKI, {
          moveset: [MoveId.ME_FIRST, MoveId.THUNDERBOLT, MoveId.VOLT_SWITCH, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Pursuit (228) — strike a switching-out foe at x2, before it leaves
  // ===========================================================================
  {
    label: "Move: Pursuit hits a switching foe x2",
    description:
      "Pursuit (2.65 dex): 'An attack move that works especially well on a foe that is switching out.'\n"
      + "When a foe switches out (menu switch) the same turn you use Pursuit, Pursuit acts BEFORE the\n"
      + "switch and hits the OUTGOING mon at x2 power.\n"
      + "DO: this is a TRAINER battle (enemy has a bench). Keep pressing Pursuit; when the AI decides\n"
      + "to switch, watch the log.\n"
      + "EXPECT: on the switch turn, Pursuit fires at ~2x its usual damage and lands on the mon that\n"
      + "is leaving (not the one coming in), which THEN switches. NOTE: the AI's decision to switch is\n"
      + "not forced here — it may take several turns, or a HP threshold, to trigger a switch.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        BATTLE_TYPE_OVERRIDE: BattleType.TRAINER,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_LEVEL_OVERRIDE: 100,
      });
      return [
        makeStarter(SpeciesId.TYRANITAR, {
          moveset: [MoveId.PURSUIT, MoveId.CRUNCH, MoveId.STONE_EDGE, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Dreamcatcher (305) — strike a SLEEPING foe as it switches out
  // ===========================================================================
  {
    label: "Ability: Dreamcatcher switch-strike",
    description:
      "Dreamcatcher (2.65 dex): '...Attacks hit sleeping foes who are switching out ... damaging them\n"
      + "before leaving.' While the holder attacks and the foe is asleep, if that foe switches out the\n"
      + "same turn, the attack strikes the outgoing sleeper before it leaves.\n"
      + "DO: TRAINER battle; the enemy starts ASLEEP. Attack it with your Dreamcatcher holder each turn\n"
      + "and watch for an AI switch.\n"
      + "EXPECT: when the sleeping foe switches, your attack lands on the OUTGOING sleeper first, then\n"
      + "it switches. NOTE: the AI switch is not forced (Dreamcatcher also doubles power vs sleepers).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        BATTLE_TYPE_OVERRIDE: BattleType.TRAINER,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.DREAMCATCHER),
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_STATUS_OVERRIDE: StatusEffect.SLEEP,
      });
      return [
        makeStarter(SpeciesId.HYPNO, {
          moveset: [MoveId.ZEN_HEADBUTT, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Wonder Room (472) — swap ATK <-> SpAtk field-wide for 5 turns
  // ===========================================================================
  {
    label: "Move: Wonder Room swaps ATK/SpAtk",
    description:
      "Wonder Room (2.65 dex): 'For 5 turns, Attack and SpAtk stats are swapped and their stat buffs\n"
      + "are ignored.' Alakazam has tiny ATK (50) and huge SpAtk (135); normally its physical moves are\n"
      + "weak.\n"
      + "DO: use Wonder Room, then hit the foe with a PHYSICAL move (Zen Headbutt / Fire Punch).\n"
      + "EXPECT: while Wonder Room is up, Alakazam's physical damage jumps (it hits using its base SpAtk,\n"
      + "not its base ATK) and any ATK/SpAtk stat-stage arrows are ignored. Re-using Wonder Room ends it\n"
      + "early (Room-style). After 5 turns the swap wears off and physical damage drops back down.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.WONDER_ROOM, MoveId.ZEN_HEADBUTT, MoveId.FIRE_PUNCH, MoveId.PSYCHIC],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Ally Switch (502) — swap field positions with your ally (doubles)
  // ===========================================================================
  {
    label: "Move: Ally Switch swaps ally slots",
    description:
      "Ally Switch (2.65 dex): 'The user teleports using a strange power and swaps with its ally.'\n"
      + "DOUBLE battle. Alakazam (left) and Blastoise (right).\n"
      + "DO: use Ally Switch with the LEFT mon (Alakazam). It has +2 priority, so it resolves first.\n"
      + "EXPECT: Alakazam and Blastoise trade field positions (left <-> right) and their HP bars swap\n"
      + "slots. A foe move that was aimed at the old left slot now follows whoever stands there.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        BATTLE_STYLE_OVERRIDE: "double",
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.ALAKAZAM, {
          moveset: [MoveId.ALLY_SWITCH, MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.SPLASH],
        }),
        makeStarter(SpeciesId.BLASTOISE, {
          moveset: [MoveId.SURF, MoveId.ICE_BEAM, MoveId.FLASH_CANNON, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Shields Down — Shell Smash forces Core Form (no revert)
  // ===========================================================================
  {
    label: "Shields Down: Shell Smash -> Core (no revert)",
    description:
      "Shields Down (2.65 rom): '...When using Shell Smash, immediately transforms to Core Form\n"
      + "regardless of current HP. Cannot revert to Meteor Form once transformed during battle.'\n"
      + "Minior starts at FULL HP in Meteor Form.\n"
      + "DO: use Shell Smash (turn 1). Then keep attacking / healing with Roost.\n"
      + "EXPECT: Shell Smash flips Minior to CORE Form immediately even though HP is still full, and it\n"
      + "STAYS Core for the rest of the battle - healing back above 50% (Roost) does NOT restore Meteor\n"
      + "Form. (It only resets to Meteor at the start of the next battle.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.SHIELDS_DOWN,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGIKARP,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MINIOR, {
          formIndex: 0, // red-meteor
          moveset: [MoveId.SHELL_SMASH, MoveId.ROOST, MoveId.POWER_GEM, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Sky Drop (507) — 2-turn lift; target immobilized, damage on turn 2
  // ===========================================================================
  {
    label: "Move: Sky Drop 2-turn lift + immobilize",
    description:
      "Sky Drop (2.65 dex): 'Immobilizes and then slams the foe.' 2-turn move.\n"
      + "DO: use Sky Drop on the foe. Your mon is faster, so it lifts the foe first.\n"
      + "EXPECT: turn 1 - your mon flies up (semi-invulnerable) taking the foe with it; the foe is HELD\n"
      + "and cannot act (its move is cancelled). Turn 2 - your mon slams down and deals damage.\n"
      + "RESIDUAL (still partial): the weight >= 200kg fail, Flying-type immunity, hazards-on-drop, and\n"
      + "redirection-clear are not yet implemented; the held foe is not given its own semi-invuln.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SHUCKLE, // very slow -> gets immobilized on the charge turn
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.TACKLE],
      });
      return [
        makeStarter(SpeciesId.STARAPTOR, {
          moveset: [MoveId.SKY_DROP, MoveId.BRAVE_BIRD, MoveId.CLOSE_COMBAT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // ER 2.65 dex "Section A" residuals — non-c-source numeric/mechanic fixes.
  // ===========================================================================
  // Ability: Normalize (96) — "10% power boost" (x1.1, NOT the buggy x1.32)
  {
    label: "Normalize: x1.1 boost (not x1.32)",
    description:
      "Normalize (2.65 dex): all moves become Normal-type and get a '10% power boost' (x1.1), and they\n"
      + "ignore the target's resistances (not immunities). A prior port bug STACKED the vanilla x1.2 boost\n"
      + "on top of ER's x1.1 (net x1.32).\n"
      + "DO: use Ember on the Normal-type Snorlax (Normalize converts it to a Normal move).\n"
      + "EXPECT: Ember lands as a NORMAL-type hit (1x vs Snorlax) doing only ~10% more than an unboosted\n"
      + "90-BP-equivalent - NOT the inflated ~32% of the old double-boost.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.NORMALIZE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.PIKACHU, {
          moveset: [MoveId.EMBER, MoveId.SWIFT, MoveId.THUNDERBOLT, MoveId.SPLASH],
        }),
      ];
    },
  },
  // Ability: Violent Rush (350) — first turn +50% Speed AND +20% Attack
  {
    label: "Violent Rush: 1st-turn +50% Spd, +20% Atk",
    description:
      "Violent Rush (2.65 dex): 'Boosts Speed by 50% and Attack by 20% on the first turn.' The Attack\n"
      + "piece is a LITERAL physical-Attack boost (a prior port used an all-move power boost that also lifted\n"
      + "special moves).\n"
      + "DO: turn 1 - hit the bulky Snorlax with Close Combat (physical); turn 2 - hit it again.\n"
      + "EXPECT: turn 1 you move first (+50% Speed) AND the physical hit is ~20% stronger than the identical\n"
      + "turn-2 hit (the Attack boost EXPIRES after the first move). A special move (e.g. Aura Sphere) is NOT\n"
      + "boosted by the Attack clause.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.VIOLENT_RUSH),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.KNOCK_OFF, MoveId.BULLET_PUNCH, MoveId.SPLASH],
        }),
      ];
    },
  },
  // Ability: Fighter (509) — low-HP boost triggers at 1/3 HP OR LOWER (inclusive)
  {
    label: "Fighter: 1.5x at exactly 1/3 HP (inclusive)",
    description:
      "Fighter (2.65 rom): boosts Fighting moves; at '1/3 HP OR LOWER' the boost jumps to x1.5. The port's\n"
      + "boundary used a strict '<' so EXACTLY 1/3 HP still gave the weaker x1.2. Now inclusive ('<=').\n"
      + "DO: your Machamp starts at ~33% HP (mid-battle). Use Close Combat on the bulky Snorlax.\n"
      + "EXPECT: at 1/3 HP the Fighting-move boost is the FULL x1.5 (a clearly bigger hit than just above 1/3).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(ErAbilityId.FIGHTER),
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MACHAMP, {
          moveset: [MoveId.CLOSE_COMBAT, MoveId.KNOCK_OFF, MoveId.BULLET_PUNCH, MoveId.SPLASH],
        }),
      ];
    },
    onBattleStart: () => {
      // Drop the player to exactly 1/3 HP to sit ON the inclusive boundary.
      const p = globalScene.getPlayerPokemon();
      if (p) {
        p.hp = Math.max(1, Math.floor(p.getMaxHp() / 3));
        p.updateInfo();
      }
    },
  },
  // Move: Feint Attack (185) — 80 BP / 10 PP / never misses
  {
    label: "Feint Attack: 80 BP, always hits",
    description:
      "Feint Attack (2.65 dex): a Dark move that 'hits without fail', 80 BP / 10 PP (the port kept the stale\n"
      + "vanilla 60 BP / 20 PP).\n"
      + "DO: use Feint Attack on the foe (even behind Double Team / at -acc).\n"
      + "EXPECT: it always connects and hits noticeably harder than a 60-BP move would (now 80 BP).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.DOUBLE_TEAM],
      });
      return [
        makeStarter(SpeciesId.WEAVILE, {
          moveset: [MoveId.FEINT_ATTACK, MoveId.ICE_PUNCH, MoveId.SWORDS_DANCE, MoveId.SPLASH],
        }),
      ];
    },
  },
  // Move: Scorched Earth (766) — Fire OR Ground, whichever is more effective
  {
    label: "Scorched Earth: Fire/Ground best-effect",
    description:
      "Scorched Earth (2.65 dex): 'Deals damage as Fire or Ground, whichever is more effective', 10% burn.\n"
      + "The port's best-effectiveness type chooser was null-target-broken in combat (always Fire), so vs\n"
      + "Water/Electric/Steel/Rock foes it dealt Fire (often resisted) instead of the better Ground.\n"
      + "DO: use Scorched Earth on the Electric-type Magnezone (Fire 1x, Ground 2x on Electric).\n"
      + "EXPECT: it lands SUPER EFFECTIVE (picks Ground) - not a resisted/neutral Fire hit.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.MAGNEZONE, // Electric/Steel: Ground 4x, Fire 2x -> Ground wins
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.CHARIZARD, {
          moveset: [erMove(ErMoveId.SCORCHED_EARTH), MoveId.FLAMETHROWER, MoveId.EARTH_POWER, MoveId.SPLASH],
        }),
      ];
    },
  },
  // Move: Black Magic (801) — USE_HIGHEST_OFFENSE (higher of Atk/SpAtk)
  {
    label: "Black Magic: uses higher offense stat",
    description:
      "Black Magic (2.65 dex): a Dark move (90 BP) that strikes off the user's HIGHER offensive stat, 20%\n"
      + "bleed. The port coerced it to always-Physical, so a special attacker (Gengar, SpAtk 130 >> Atk 65)\n"
      + "hit off its weak Attack.\n"
      + "DO: use Black Magic on Snorlax with Gengar (a special attacker).\n"
      + "EXPECT: it damages off Gengar's Sp.Atk (a big hit), not its feeble Attack. A physical attacker (e.g.\n"
      + "Machamp) would instead strike off Attack.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [erMove(ErMoveId.BLACK_MAGIC), MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.SPLASH],
        }),
      ];
    },
  },
  // Move: Flash Freeze (811) — never misses if the user is Ice-type
  {
    label: "Flash Freeze: Ice user never misses",
    description:
      "Flash Freeze (2.65 dex): inflicts Frostbite; 'Never misses if the user is Ice-type.' The port left it\n"
      + "at flat 90% accuracy for everyone.\n"
      + "DO: use Flash Freeze with the pure-Ice Glalie against a foe spamming Double Team (evasion up).\n"
      + "EXPECT: it ALWAYS connects (Ice-type user bypass) and applies Frostbite. A non-Ice user of the same\n"
      + "move can still miss.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.DOUBLE_TEAM],
      });
      return [
        makeStarter(SpeciesId.GLALIE, {
          moveset: [erMove(ErMoveId.FLASH_FREEZE), MoveId.ICE_BEAM, MoveId.SHADOW_BALL, MoveId.SPLASH],
        }),
      ];
    },
  },
  // Move: Vexing Void (974) — never misses in (Eerie) Fog
  {
    label: "Vexing Void: never misses in fog",
    description:
      "Vexing Void (2.65 dex): Dark move (110 BP, 85% acc), 30% to lower Sp.Def; 'Never misses in fog.'\n"
      + "The fog-accuracy bypass wasn't wired.\n"
      + "DO: with Eerie Fog on the field, use Vexing Void against a foe using Double Team.\n"
      + "EXPECT: it ALWAYS connects while fog is up (accuracy bypass), even through evasion boosts. Without\n"
      + "fog it can miss as normal.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        WEATHER_OVERRIDE: WeatherType.EERIE_FOG,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_MOVESET_OVERRIDE: [MoveId.DOUBLE_TEAM],
      });
      return [
        makeStarter(SpeciesId.GENGAR, {
          moveset: [erMove(ErMoveId.VEXING_VOID), MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Sky Drop (507) — fails vs a heavy (>=200kg) target
  // ===========================================================================
  {
    label: "Move: Sky Drop fails on a heavy target",
    description:
      "Sky Drop (2.65 dex): 'Immobilizes and then slams the foe.' Residual clauses now\n"
      + "wired: it FAILS entirely against a target that weighs >= 200 kg (too heavy to\n"
      + "carry up) or is a Flying type (can't be lifted); a light non-Flying foe is\n"
      + "lifted + slammed as before; hazards on the target's side trigger on the drop.\n"
      + "DO: use Sky Drop on the foe Snorlax (460 kg).\n"
      + "EXPECT: 'But it failed!' — no lift, no charge, Snorlax takes NO damage. (Swap the\n"
      + "foe for a light non-Flying mon and Sky Drop lifts + slams it over 2 turns.)",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.SALAMENCE, {
          moveset: [MoveId.SKY_DROP, MoveId.DRAGON_CLAW, MoveId.CRUNCH, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Dreamcatcher (305) — the switch-strike on a sleeping foe is 1x
  // ===========================================================================
  {
    label: "Ability: Dreamcatcher switch-strike is 1x",
    description:
      "Dreamcatcher (2.65 dex): '2x when any foe is asleep. Attacks hit sleeping foes\n"
      + "who are switching out for 1x power instead.' The everyday 2x still applies; only\n"
      + "the dedicated strike on a SWITCHING sleeper is 1x.\n"
      + "DO: this is a trainer battle. Put the foe to sleep (it starts asleep), then attack\n"
      + "with Tackle while the foe switches out (a disadvantaged trainer AI swaps).\n"
      + "EXPECT: a normal Tackle on the sleeping foe hits at ~2x; the Tackle that lands as\n"
      + "the foe SWITCHES OUT hits at ~1x (roughly half). Both still connect.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: erAbility(5043), // Dreamcatcher
        BATTLE_TYPE_OVERRIDE: BattleType.TRAINER,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_STATUS_OVERRIDE: StatusEffect.SLEEP,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.REGIROCK, {
          moveset: [MoveId.TACKLE, MoveId.STONE_EDGE, MoveId.EARTHQUAKE, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Fling (543) — base power comes from the flung item's Fling table BP
  // ===========================================================================
  {
    label: "Move: Fling uses the item's Fling BP",
    description:
      "Fling (2.65 dex): flings the user's held item; its base power depends on the item\n"
      + "(ER_FLING_POWER_TABLE — Grip Claw = 90, most items 30, berries 10). The item is\n"
      + "thrown (consumed) after the hit; a flung berry is ledgered so Harvest can regrow it.\n"
      + "DO: your Regirock holds a Grip Claw. Use Fling on the foe.\n"
      + "EXPECT: a big hit (90 BP, far more than the old flat-10) and the Grip Claw is gone\n"
      + "afterward (check the party held-item list).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "GRIP_CLAW" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.REGIROCK, {
          moveset: [MoveId.FLING, MoveId.STONE_EDGE, MoveId.EARTHQUAKE, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Natural Gift (363) — type + power come from the consumed berry
  // ===========================================================================
  {
    label: "Move: Natural Gift takes the berry's type/power",
    description:
      "Natural Gift (2.65 dex): consumes a held berry; its TYPE and POWER come from that\n"
      + "berry (ER_NATURAL_GIFT_TABLE — Liechi = Grass 100, Sitrus = Psychic 80). The berry\n"
      + "is ledgered so Harvest can regrow it.\n"
      + "DO: your Regirock holds a Liechi berry. Use Natural Gift on the foe Swampus (Water).\n"
      + "EXPECT: 'It's super effective!' — Natural Gift becomes a 100-BP GRASS hit vs the\n"
      + "Water foe (Grass > Water), and the Liechi berry is consumed.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "BERRY", type: BerryType.LIECHI }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SWAMPERT, // Water/Ground
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.REGIROCK, {
          moveset: [MoveId.NATURAL_GIFT, MoveId.STONE_EDGE, MoveId.EARTHQUAKE, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Trick (271) — Sticky Hold on the USER fails the swap (all-or-nothing)
  // ===========================================================================
  {
    label: "Move: Trick fails with Sticky Hold on the user",
    description:
      "Trick (2.65 dex): swaps held items. It is ALL-OR-NOTHING: if EITHER side has Sticky\n"
      + "Hold the swap fails cleanly (no partial trade). The user-side Sticky Hold gap is now\n"
      + "closed.\n"
      + "DO: your Muk has Sticky Hold and holds Leftovers; the foe holds a Soothe Bell. Use\n"
      + "Trick.\n"
      + "EXPECT: nothing swaps — you keep Leftovers, the foe keeps its Soothe Bell (no partial\n"
      + "one-way transfer).",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.STICKY_HOLD,
        STARTING_HELD_ITEMS_OVERRIDE: [{ name: "LEFTOVERS" }],
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "SOOTHE_BELL" }],
        ENEMY_MOVESET_OVERRIDE: [MoveId.SPLASH],
      });
      return [
        makeStarter(SpeciesId.MUK, {
          moveset: [MoveId.TRICK, MoveId.GUNK_SHOT, MoveId.SHADOW_SNEAK, MoveId.SPLASH],
        }),
      ];
    },
  },
  // ===========================================================================
  // Ability: Unnerve (127) — a foe under Unnerve can't consume its elemental Gem
  // ===========================================================================
  {
    label: "Ability: Unnerve blocks the foe's Gem",
    description:
      "Unnerve (2.65 dex): 'Prevents all opposing Pokemon from consuming held items.' The\n"
      + "block now covers ER elemental Gems (not just berries), matching the reactive-item /\n"
      + "As-One path.\n"
      + "DO: your Regirock has Unnerve. The foe holds a Normal Gem and attacks with a Normal\n"
      + "move (Body Slam). Splash and watch the foe's Gem.\n"
      + "EXPECT: the foe's Normal Gem does NOT fire and is NOT consumed while Unnerve is up —\n"
      + "no '...Gem strengthened...' message, and the Gem is still in the foe's items.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.UNNERVE,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_HELD_ITEMS_OVERRIDE: [{ name: "ER_NORMAL_GEM" }],
        ENEMY_MOVESET_OVERRIDE: [MoveId.BODY_SLAM],
      });
      return [
        makeStarter(SpeciesId.REGIROCK, {
          moveset: [MoveId.SPLASH, MoveId.STONE_EDGE, MoveId.EARTHQUAKE, MoveId.REST],
        }),
      ];
    },
  },
  // ===========================================================================
  // Move: Pursuit (228) — intercepts a foe self-switching via a MOVE (U-turn)
  // ===========================================================================
  {
    label: "Move: Pursuit intercepts a U-turn switch",
    description:
      "Pursuit (2.65 dex): 'Works especially well on a foe switching out.' It already hit\n"
      + "MENU switches at 2x; now it also intercepts a foe self-switching via a MOVE\n"
      + "(U-turn / Volt Switch): Pursuit strikes the foe at 2x BEFORE its self-switch\n"
      + "resolves, even if the foe is faster.\n"
      + "DO: this is a trainer battle (the foe has a bench). Use Pursuit while the foe uses\n"
      + "U-turn.\n"
      + "EXPECT: Pursuit lands on the ORIGINAL foe at ~2x, THEN the foe's U-turn switch\n"
      + "happens — the incoming mon is not the one that took the Pursuit hit.",
    setup: () => {
      resetDevOverrides();
      setOverrides({
        STARTING_WAVE_OVERRIDE: 145,
        STARTING_LEVEL_OVERRIDE: 100,
        ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        BATTLE_TYPE_OVERRIDE: BattleType.TRAINER,
        ENEMY_SPECIES_OVERRIDE: SpeciesId.SNORLAX,
        ENEMY_LEVEL_OVERRIDE: 100,
        ENEMY_ABILITY_OVERRIDE: AbilityId.BALL_FETCH,
        ENEMY_MOVESET_OVERRIDE: [MoveId.U_TURN],
      });
      return [
        makeStarter(SpeciesId.WEAVILE, {
          moveset: [MoveId.PURSUIT, MoveId.ICE_PUNCH, MoveId.NIGHT_SLASH, MoveId.SPLASH],
        }),
      ];
    },
  },
];
