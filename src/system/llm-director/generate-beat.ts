import { type Beat, validateBeat } from "#data/llm-director/beat-schema";
import { BEAT_PROSE_SYSTEM_PROMPT, BEAT_SKELETON_SYSTEM_PROMPT } from "#data/llm-director/system-prompts";
import type { ContextEnvelope } from "#system/llm-director/context-envelope";
import type { DirectorClient } from "#system/llm-director/director-client";
import {
  logBeatParsed,
  logBeatRequest,
  logBeatResponse,
  logBeatValidationFail,
} from "#system/llm-director/director-log";

/**
 * Two-phase beat generation:
 *
 *   1. Skeleton — DeepSeek emits structured JSON. This is the
 *      authoritative pass for trainer composition, choice trees, etc.
 *   2. Prose (optional) — Kimi rewrites the human-facing text fields with
 *      better voice. v1 ships skeleton-only; the prose phase is wired but only
 *      runs when `withProsePass: true`.
 *
 * Schema validation on every response. On persistent failure we synthesize a
 * `narrative_only` fallback so the run never blocks.
 */

export interface GenerateBeatOptions {
  envelope: ContextEnvelope;
  /**
   * Primary skeleton model. Default minimax/minimax-latest (~24s on a real
   * beat prompt; richer prose, broader variety vs deepseek-flash which
   * over-indexes on stock phrasings and item picks).
   */
  skeletonModel?: string;
  /**
   * Ordered fallback chain. Each is tried in order on network/timeout
   * errors. Validation errors break out — they're model-agnostic.
   */
  fallbackSkeletonModels?: readonly string[];
  /** Defaults to moonshotai/kimi-k2.6 (better prose voice, used only when withProsePass is on). */
  proseModel?: string;
  /** Default 3. */
  maxRetries?: number;
  /** Default 90s — comfortable for the slower-but-better primary; pre-gen
   *  buffer is 3 waves ahead so up to 90s feels instant to the player. */
  timeoutMs?: number;
  /** v1 default false; turn on once costs are characterized. */
  withProsePass?: boolean;
}

/**
 * Beat-generation model chain. Probed against a real beat prompt:
 *
 *   minimax/minimax-latest      : ~24s, varied prose + items, schema-clean ✓
 *   deepseek/deepseek-v4-flash  : ~5s, but heavy repetition across beats
 *   zai-org/glm-latest          : works but slow (~90s)
 *   moonshotai/kimi-k2.6        : hangs on beat prompts (>150s no response) ✗
 *
 * MiniMax primary for quality. DeepSeek-flash fallback for the hot path
 * if MiniMax is unavailable / hangs. GLM as last resort.
 */
const DEFAULT_SKELETON_MODEL = "minimax/minimax-latest";
const DEFAULT_SKELETON_FALLBACK_CHAIN: readonly string[] = ["deepseek/deepseek-v4-flash", "zai-org/glm-latest"];
const DEFAULT_PROSE_MODEL = "moonshotai/kimi-k2.6";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 90_000;

const FENCE_REGEX = /^```(?:json)?\s*([\s\S]*?)\s*```$/m;

function parseLooseJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = FENCE_REGEX.exec(trimmed);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

function buildUserPrompt(envelope: ContextEnvelope, prevError?: string): string {
  const base = `Envelope:\n${JSON.stringify(envelope, null, 2)}\n\nGenerate ONE beat as JSON.`;
  if (prevError) {
    return `${base}\n\nYour previous output failed validation: ${prevError}\nRe-emit valid JSON.`;
  }
  return base;
}

function fallbackBeat(envelope: ContextEnvelope): Beat {
  return {
    beatId: `fallback-${envelope.currentWaveIndex}-${Date.now()}`,
    type: "narrative_only",
    introText: "The road continues.",
    bodyText: "You press on, the silence between things louder than usual.",
  };
}

async function runSkeletonPhase(
  client: DirectorClient,
  envelope: ContextEnvelope,
  primaryModel: string,
  fallbackModels: readonly string[],
  maxRetries: number,
  timeoutMs: number,
): Promise<Beat | null> {
  const wave = envelope.currentWaveIndex;
  const envelopeBytes = JSON.stringify(envelope).length;
  logBeatRequest(wave, envelopeBytes / 1024);

  // Build dedup'd model chain: primary first, then fallbacks.
  const seen = new Set<string>();
  const modelsToTry: string[] = [];
  for (const m of [primaryModel, ...fallbackModels]) {
    if (m && !seen.has(m)) {
      seen.add(m);
      modelsToTry.push(m);
    }
  }

  let lastError = "";
  for (const model of modelsToTry) {
    let lastWasValidationError = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let parsed: unknown;
      try {
        const result = await client.complete({
          model,
          messages: [
            { role: "system", content: BEAT_SKELETON_SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(envelope, attempt > 1 ? lastError : undefined) },
          ],
          timeoutMs,
          responseFormat: "json_object",
          // 4000 tokens lets the LLM emit a full beat + 2 inter-beat overrides
          // without truncation.
          maxTokens: 4000,
        });
        logBeatResponse(wave, result.content, result.latencyMs);
        parsed = parseLooseJson(result.content);
      } catch (err) {
        // Network / timeout / server error — break out of retries and try
        // the next model in the chain (don't burn retries on a hung model).
        lastError = err instanceof Error ? err.message : String(err);
        logBeatValidationFail(wave, `${model}: ${lastError}`, attempt);
        lastWasValidationError = false;
        break;
      }
      const validation = validateBeat(parsed);
      if (!validation.ok) {
        lastError = validation.error;
        logBeatValidationFail(wave, `${model}: ${lastError}`, attempt);
        lastWasValidationError = true;
        continue;
      }
      // First-beat semantic check: dialogue_choice with at least one
      // non-custom effect on each option AND at least one option with a
      // non-empty consequence.items[] (rewards-shop menu).
      if (envelope.isFirstBeat) {
        const semanticErr = validateFirstBeatSemantics(parsed as Beat);
        if (semanticErr) {
          lastError = `first-beat semantic check: ${semanticErr}`;
          logBeatValidationFail(wave, `${model}: ${lastError}`, attempt);
          lastWasValidationError = true;
          continue;
        }
      }
      // General-beat semantic check: scale-aware team requirements on
      // trainer overrides and the beat's own enemyTeam (trainer_battle).
      const generalErr = validateGeneralBeatSemantics(parsed as Beat, envelope.currentWaveIndex);
      if (generalErr) {
        lastError = `general-beat semantic check: ${generalErr}`;
        logBeatValidationFail(wave, `${model}: ${lastError}`, attempt);
        lastWasValidationError = true;
        continue;
      }
      logBeatParsed(wave, parsed);
      return parsed as Beat;
    }
    // Validation errors burned all retries — switching models won't help
    // since the schema/semantic constraints are model-agnostic.
    if (lastWasValidationError) {
      break;
    }
    // Network/timeout — try next model in the chain.
  }
  return null;
}

/** Effect types that are pointless on the first beat (party is at full HP,
 *  no fainted Pokemon, no statuses, no PP usage yet — these heal/cure
 *  effects literally do nothing for the player on wave 1). */
const POINTLESS_FIRST_BEAT_EFFECTS = new Set<string>([
  "heal_party_hp",
  "heal_party_status",
  "heal_party_full",
  "heal_party_pp",
  "revive",
  "revive_all",
]);

/** Item keys that are healing-class consumables (POTION-family, REVIVE, etc.).
 *  Pointless to grant in a first-beat rewards-shop menu since the team is
 *  full HP. The full set is enforced in consequence-effects.ts at runtime;
 *  here we surface a subset for the validator to reject early. */
const POINTLESS_FIRST_BEAT_ITEM_KEYS = new Set<string>([
  "POTION",
  "SUPER_POTION",
  "HYPER_POTION",
  "MAX_POTION",
  "FULL_RESTORE",
  "REVIVE",
  "MAX_REVIVE",
  "SACRED_ASH",
  "FULL_HEAL",
  "ETHER",
  "MAX_ETHER",
  "ELIXIR",
  "MAX_ELIXIR",
]);

function validateFirstBeatSemantics(beat: Beat): string | null {
  if (beat.type !== "dialogue_choice") {
    return `must be dialogue_choice, got "${beat.type}"`;
  }
  for (let i = 0; i < beat.options.length; i++) {
    const opt = beat.options[i];
    const effects = opt.consequence.effects ?? [];
    // Reject pointless heal/revive effects — wave 1 = full party HP, no
    // statuses, no fainted Pokemon. Granting these as the only "tangible"
    // consequence reads as a no-op to the player.
    const pointlessEffects = effects.filter(e => POINTLESS_FIRST_BEAT_EFFECTS.has(e.type));
    if (pointlessEffects.length > 0) {
      return `options[${i}] uses pointless first-beat effect "${pointlessEffects[0].type}" (party is full HP at wave 1; pick give_money / give_voucher / give_egg / status_inflict / give_held_item / buff_persistent / etc.)`;
    }
    const items = opt.consequence.items ?? [];
    const pointlessItem = items.find(it => POINTLESS_FIRST_BEAT_ITEM_KEYS.has(it.modifierType));
    if (pointlessItem) {
      return `options[${i}].items contains pointless first-beat consumable "${pointlessItem.modifierType}" (party is full HP; pick a held item, vitamin, charm, TM, voucher, egg, or other meaningful first-beat reward)`;
    }
    const hasNonCustom = effects.some(e => e.type !== "custom");
    if (!hasNonCustom) {
      return `options[${i}] must have at least one non-custom effect`;
    }
  }
  const anyHasItems = beat.options.some(o => (o.consequence.items?.length ?? 0) > 0);
  if (!anyHasItems) {
    return "at least one option must have non-empty consequence.items[] (a 2-3 entry rewards-shop menu)";
  }
  return null;
}

/**
 * Wave-curve minimum team size. Trainer fights at later waves should bring
 * more Pokemon — a 1-Pokemon "boss" at wave 50 reads as broken. The LLM's
 * tendency to under-author teams is corrected here by post-validation
 * rejection-and-retry.
 */
function minTeamSizeForWave(wave: number): number {
  if (wave <= 5) {
    return 1;
  }
  if (wave <= 15) {
    return 2;
  }
  if (wave <= 35) {
    return 3;
  }
  if (wave <= 70) {
    return 4;
  }
  return 5;
}

/** Past this wave, every Pokemon on a trainer's team should carry at least
 *  one held item — vanilla trainers do, and a story-authored trainer with
 *  no held items reads as flat. */
const HELD_ITEM_REQUIRED_WAVE = 10;

/**
 * General-beat semantic check (runs on every beat, not just the first).
 * Catches the most common LLM failure modes:
 *   - trainer overrides that name a specific trainer but skip enemyTeam
 *     (so vanilla rolls a generic team that doesn't match the narration)
 *   - enemyTeam too small for the wave's curve
 *   - trainer Pokemon past wave 10 with no held items
 *   - trainer_battle beats whose own enemyTeam violates the same rules
 */
function validateGeneralBeatSemantics(beat: Beat, currentWave: number): string | null {
  const minSize = minTeamSizeForWave(currentWave);

  // The beat's own trainer_battle enemyTeam.
  if (beat.type === "trainer_battle") {
    const team = beat.enemyTeam ?? [];
    if (team.length < minSize) {
      return `trainer_battle enemyTeam has ${team.length} entries; wave ${currentWave} requires at least ${minSize}`;
    }
    if (currentWave > HELD_ITEM_REQUIRED_WAVE) {
      const noItem = team.findIndex(p => !p.heldItemKeys || p.heldItemKeys.length === 0);
      if (noItem >= 0) {
        return `trainer_battle enemyTeam[${noItem}] has no heldItemKeys (required past wave ${HELD_ITEM_REQUIRED_WAVE}; pick from gameBalanceCard.trainerItemTiers)`;
      }
    }
  }

  // interBeatOverrides — these drive the off-beat waves.
  const overrides = beat.interBeatOverrides ?? [];
  for (let i = 0; i < overrides.length; i++) {
    const ov = overrides[i];
    const overrideWave = currentWave + (ov.atWaveOffset ?? 1);
    const overrideMinSize = minTeamSizeForWave(overrideWave);
    const tr = ov.trainerOverride;
    const wantsTrainer = !!ov.trainerName || !!tr?.trainerType || (tr?.enemyTeam && tr.enemyTeam.length > 0);
    if (wantsTrainer) {
      const team = tr?.enemyTeam ?? [];
      if (team.length === 0) {
        return `interBeatOverrides[${i}] (wave ${overrideWave}) names a trainer (trainerName="${ov.trainerName ?? ""}", trainerType=${tr?.trainerType ?? "?"}) but has no enemyTeam — narration would describe a foe the player never fights. Emit trainerOverride.enemyTeam.`;
      }
      if (team.length < overrideMinSize) {
        return `interBeatOverrides[${i}].trainerOverride.enemyTeam has ${team.length} entries; wave ${overrideWave} requires at least ${overrideMinSize}`;
      }
      if (overrideWave > HELD_ITEM_REQUIRED_WAVE) {
        const noItem = team.findIndex(p => !p.heldItemKeys || p.heldItemKeys.length === 0);
        if (noItem >= 0) {
          return `interBeatOverrides[${i}].trainerOverride.enemyTeam[${noItem}] has no heldItemKeys (required past wave ${HELD_ITEM_REQUIRED_WAVE})`;
        }
      }
    }
  }
  return null;
}

async function runProsePhase(client: DirectorClient, beat: Beat, model: string, timeoutMs: number): Promise<Beat> {
  let parsed: unknown;
  try {
    const result = await client.complete({
      model,
      messages: [
        { role: "system", content: BEAT_PROSE_SYSTEM_PROMPT },
        { role: "user", content: `Skeleton:\n${JSON.stringify(beat, null, 2)}\n\nReturn the polished beat as JSON.` },
      ],
      timeoutMs,
      responseFormat: "json_object",
      maxTokens: 1500,
    });
    parsed = parseLooseJson(result.content);
  } catch {
    return beat;
  }
  const validation = validateBeat(parsed);
  return validation.ok ? (parsed as Beat) : beat;
}

export async function generateBeat(client: DirectorClient, opts: GenerateBeatOptions): Promise<Beat> {
  const skeletonModel = opts.skeletonModel ?? DEFAULT_SKELETON_MODEL;
  const fallbackSkeletonModels = opts.fallbackSkeletonModels ?? DEFAULT_SKELETON_FALLBACK_CHAIN;
  const proseModel = opts.proseModel ?? DEFAULT_PROSE_MODEL;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const skeleton = await runSkeletonPhase(
    client,
    opts.envelope,
    skeletonModel,
    fallbackSkeletonModels,
    maxRetries,
    timeoutMs,
  );
  if (!skeleton) {
    return fallbackBeat(opts.envelope);
  }
  if (!opts.withProsePass) {
    return skeleton;
  }
  return runProsePhase(client, skeleton, proseModel, timeoutMs);
}
