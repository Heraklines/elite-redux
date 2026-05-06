import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import type { Consequence, DialogueChoiceBeat } from "#data/llm-director/beat-schema";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { TrainerType } from "#enums/trainer-type";
import type { CustomModifierSettings, ModifierType } from "#modifiers/modifier-type";
import { ModifierTypeOption } from "#modifiers/modifier-type";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import {
  generateModifierType,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
} from "#mystery-encounters/utils/encounter-phase-utils";
import { applyConsequence } from "#system/llm-director/beat-applier";
import { recordPlayerChoice } from "#system/llm-director/beat-history";
import { applyEffects } from "#system/llm-director/consequence-effects";
import { logChoiceMade } from "#system/llm-director/director-log";
import { trainerConfigs } from "#trainers/trainer-config";

/**
 * Default speaker sprite for dialogue beats whose `speaker` either omits a
 * `trainerType` or supplies an unknown value. BACKPACKER reads as a generic
 * wanderer in most biomes.
 */
const FALLBACK_TRAINER_TYPE = TrainerType.BACKPACKER;

/**
 * Hard cap on options per encounter — the underlying option-select UI
 * supports up to 4. The schema already maxes at 4, this is defense-in-depth.
 */
const MAX_OPTIONS = 4;

/**
 * Soft cap on the description length. The MysteryEncounter description box
 * can render multi-line text but starts truncating around ~140 chars.
 */
const DESCRIPTION_MAX = 140;

/**
 * Build a runtime `MysteryEncounter` from an LLM-authored `dialogue_choice`
 * beat. Selecting an option:
 *   1. mutates the director state (alignment / factionRep / flags via
 *      `applyConsequence`),
 *   2. fires the option's `effects[]` (give_money, status_inflict, etc.)
 *      via `applyEffects`,
 *   3. queues the LLM-authored items (`consequence.items[]`) as a
 *      MysteryEncounter shop reward via `setEncounterRewards`,
 *   4. queues the option's `epilogueText` + any `custom`-effect narration
 *      as the encounter outro,
 *   5. exits the encounter with `leaveEncounterWithoutBattle` so the run
 *      proceeds to the next wave.
 *
 * Caller (`LLMDirectorBeatPhase.renderDialogue`) is expected to:
 *   - swap `currentBattle.battleType` to MYSTERY_ENCOUNTER,
 *   - assign the returned encounter to `currentBattle.mysteryEncounter`,
 *   - end the beat phase so PokeRogue's `EncounterPhase` picks it up
 *     and renders the proper UI (title bar, intro visuals, option list).
 */
export function buildLlmDialogueEncounter(beat: DialogueChoiceBeat): MysteryEncounter {
  const speakerName = beat.speaker?.name ?? "?";
  const trainerType = resolveSpeakerTrainerType(beat.speaker?.trainerType);
  const config = trainerConfigs[trainerType] ?? trainerConfigs[FALLBACK_TRAINER_TYPE];
  const spriteKey = config?.getSpriteKey(false, false) ?? "backpacker_m";

  const description = clip(beat.introText, DESCRIPTION_MAX);
  const title = speakerName;
  const query = "What will you do?";

  let builder = MysteryEncounterBuilder.withEncounterType(MysteryEncounterType.LLM_DIRECTED)
    .withEncounterTier(MysteryEncounterTier.COMMON)
    .withMaxAllowedEncounters(99)
    .withCatchAllowed(false)
    .withFleeAllowed(false)
    .withAutoHideIntroVisuals(true)
    .withIntroSpriteConfigs([
      {
        spriteKey,
        fileRoot: "trainer",
        hasShadow: true,
        x: 0,
        y: 0,
      },
    ])
    .withIntroDialogue([{ speaker: speakerName, text: beat.introText }])
    .withTitle(title)
    .withDescription(description)
    .withQuery(query);

  // Cap options + skip empties defensively. The schema enforces minItems: 1
  // already, so this is for safety only.
  const options = beat.options.slice(0, MAX_OPTIONS);

  // MysteryEncounterBuilder requires at least 2 options for the typed
  // build() signature. If the beat has only one, synthesize a noop second
  // so the encounter still renders rather than crashing the run.
  if (options.length < 2) {
    options.push({
      label: "Continue",
      consequence: { epilogueText: "You move on." },
    });
  }

  for (const option of options) {
    builder = builder.withOption(buildOption(option, beat.beatId ?? "(current)")) as typeof builder;
  }

  // The `as` cast is safe — withOption returns this & Pick<..., "options">
  // and we always add at least 2 options above.
  return (builder as unknown as { build(): MysteryEncounter }).build();
}

function buildOption(option: DialogueChoiceBeat["options"][number], beatId: string) {
  const label = clip(option.label, 40);
  const epilogueText = option.consequence.epilogueText ?? "";
  // Only include `selected` when there's actual epilogue text — the
  // OptionTextDisplay type is strict about undefined under
  // exactOptionalPropertyTypes.
  const dialogue: { buttonLabel: string; selected?: { text: string }[] } = { buttonLabel: label };
  if (epilogueText) {
    dialogue.selected = [{ text: epilogueText }];
  }
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue(dialogue)
    .withOptionPhase(async () => {
      const state = globalScene.gameData.llmDirectorState;
      const result = applyConsequence(state, option.consequence);
      recordPlayerChoice(state, option);
      logChoiceMade(beatId, option.label, {
        alignment: option.consequence.alignment ?? 0,
        factionRep: option.consequence.factionRep ?? {},
        flags: option.consequence.flags ?? {},
        itemCount: option.consequence.items?.length ?? 0,
        hasEpilogue: !!result.epilogueText,
      });

      // Apply effects (heal, give_money, status_inflict, etc.). Effects mutate
      // state directly; narrative strings (custom descriptions, biome flavor)
      // are returned for us to surface as outro dialogue.
      const effects = option.consequence.effects;
      const effectMessages = effects && effects.length > 0 ? applyEffects(effects) : [];

      // Queue any narrative text from custom-effects as outro dialogue.
      // The MysteryEncounter's "selected" dialogue already covers the
      // option's epilogueText; effect narration is APPENDED so the player
      // reads them before the rewards shop appears.
      if (effectMessages.length > 0) {
        const tail = effectMessages.map(m => m.trim()).filter(m => m.length > 0);
        if (tail.length > 0) {
          globalScene.phaseManager.queueMessage(tail.join("$"), null, true);
        }
      }

      // Hand LLM-authored items to setEncounterRewards. This routes through
      // PokeRogue's standard rewards-shop UI so the player gets the same
      // "pick from this row of items" experience as a regular wave.
      const settings = buildRewardSettings(option.consequence);
      if (settings) {
        setEncounterRewards(settings);
      }

      // No battle for dialogue_choice beats — exit cleanly to the next wave.
      leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
    })
    .build();
}

/**
 * Convert the LLM's `consequence.items[]` (shorthand) into a
 * `CustomModifierSettings` with one entry per emitted item, materializing
 * generators (TM_COMMON, EVOLUTION_ITEM, etc.) up front so the rewards UI
 * never shows a blank-name item.
 *
 * Returns `null` when the option emitted no items — caller should skip
 * the rewards-shop entirely so the encounter exits with no shop window.
 */
function buildRewardSettings(consequence: Consequence): CustomModifierSettings | null {
  if (!consequence.items || consequence.items.length === 0) {
    return null;
  }
  const factories = modifierTypes as Record<string, (() => ModifierType) | undefined>;
  const guaranteed: ModifierTypeOption[] = [];
  for (const item of consequence.items) {
    const factory = factories[item.modifierType];
    if (typeof factory !== "function") {
      console.warn(`[llm-director] unknown modifierType in mystery encounter rewards: "${item.modifierType}"`);
      continue;
    }
    const resolved = generateModifierType(factory);
    if (!resolved) {
      console.warn(
        `[llm-director] mystery-encounter reward "${item.modifierType}" produced no compatible item; skipping`,
      );
      continue;
    }
    const qty = Math.max(1, item.qty ?? 1);
    for (let i = 0; i < qty; i++) {
      guaranteed.push(new ModifierTypeOption(resolved, 0));
    }
  }
  if (guaranteed.length === 0) {
    return null;
  }
  return { guaranteedModifierTypeOptions: guaranteed, fillRemaining: false, rerollMultiplier: 0 };
}

function resolveSpeakerTrainerType(value: number | undefined): number {
  if (typeof value !== "number" || value < 0) {
    return FALLBACK_TRAINER_TYPE;
  }
  return trainerConfigs[value] ? value : FALLBACK_TRAINER_TYPE;
}

function clip(text: string | undefined, max: number): string {
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  const head = text.slice(0, max);
  const lastSentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return lastSentence > max * 0.6 ? head.slice(0, lastSentence + 1) : `${head.trimEnd()}…`;
}
