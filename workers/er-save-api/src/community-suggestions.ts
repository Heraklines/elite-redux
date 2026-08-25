export const COMMUNITY_SUGGESTION_FILES = [
  "egg-moves",
  "species-tuning",
  "item-tuning",
  "trainer-tuning",
  "balance-tuning",
  "learnsets",
  "tm-learnsets",
  "species-abilities",
  "custom-trainers",
  "custom-trainers-config",
] as const;

export type CommunitySuggestionFile = (typeof COMMUNITY_SUGGESTION_FILES)[number];

export interface CommunitySuggestionDraft {
  entityType: string;
  entityKey: string;
  entityLabel: string;
  reason: string;
  sourceRevision: string;
  changes: Partial<Record<CommunitySuggestionFile, Record<string, unknown>>>;
  baseline: Partial<Record<CommunitySuggestionFile, Record<string, unknown>>>;
}

export interface SuggestionValidationResult {
  ok: boolean;
  errors: string[];
  draft?: CommunitySuggestionDraft;
}

export interface CommunitySuggestionEligibilityProgress {
  eligible: boolean;
  achievementCount: number;
  requiredAchievements: number;
  totalAchievements: number;
}

export function calculateCommunitySuggestionEligibility(
  unlockedIds: Iterable<string>,
  eligibleIds: ReadonlySet<string>,
  requiredAchievements: number,
): CommunitySuggestionEligibilityProgress {
  const unlocked = new Set(unlockedIds);
  let achievementCount = 0;
  for (const id of eligibleIds) {
    if (unlocked.has(id)) {
      achievementCount++;
    }
  }
  return {
    eligible: achievementCount >= requiredAchievements,
    achievementCount,
    requiredAchievements,
    totalAchievements: eligibleIds.size,
  };
}

/**
 * Read the account's authoritative achievement map from its current system save.
 * The save Worker stores system saves as JSON (legacy GZ1 rows are decompressed by
 * the caller), so eligibility does not have to depend on the best-effort report.
 */
export function extractCommunitySuggestionAchievementIds(
  systemSave: string,
  eligibleIds: ReadonlySet<string>,
): string[] {
  try {
    const root: unknown = JSON.parse(systemSave);
    if (!isPlainObject(root) || !isPlainObject(root.achvUnlocks)) {
      return [];
    }
    return Object.keys(root.achvUnlocks).filter(id => eligibleIds.has(id));
  } catch {
    return [];
  }
}

const FILES = new Set<string>(COMMUNITY_SUGGESTION_FILES);
const ENTITY_TYPES = new Set(["pokemon", "item", "trainer", "game", "other"]);
const MAX_REASON = 1200;
const MAX_LABEL = 80;
const MAX_ENTITY_KEY = 100;
const MAX_FILES = 6;
const MAX_LEAVES = 300;
const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function countLeaves(value: unknown, depth = 0): number {
  if (depth > MAX_DEPTH) {
    return MAX_LEAVES + 1;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + countLeaves(entry, depth + 1), 0);
  }
  if (isPlainObject(value)) {
    return Object.values(value).reduce((total, entry) => total + countLeaves(entry, depth + 1), 0);
  }
  return 1;
}

function cleanFileMap(value: unknown, errors: string[], label: string) {
  const result: Partial<Record<CommunitySuggestionFile, Record<string, unknown>>> = {};
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return result;
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_FILES) {
    errors.push(`${label} must contain 1-${MAX_FILES} editor files`);
  }
  for (const [file, delta] of entries) {
    if (!FILES.has(file)) {
      errors.push(`${label} contains unsupported file ${file}`);
      continue;
    }
    if (!isPlainObject(delta) || Object.keys(delta).length === 0) {
      errors.push(`${label}.${file} must be a non-empty object`);
      continue;
    }
    if (countLeaves(delta) > MAX_LEAVES) {
      errors.push(`${label}.${file} is too large`);
      continue;
    }
    result[file as CommunitySuggestionFile] = delta;
  }
  return result;
}

export function validateCommunitySuggestion(value: unknown): SuggestionValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ["suggestion must be an object"] };
  }
  const entityType = typeof value.entityType === "string" ? value.entityType.trim().toLowerCase() : "";
  const entityKey = typeof value.entityKey === "string" ? value.entityKey.trim() : "";
  const entityLabel = typeof value.entityLabel === "string" ? value.entityLabel.trim() : "";
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  const sourceRevision = typeof value.sourceRevision === "string" ? value.sourceRevision.trim() : "";

  if (!ENTITY_TYPES.has(entityType)) {
    errors.push("entityType must be pokemon, item, trainer, game, or other");
  }
  if (!entityKey || entityKey.length > MAX_ENTITY_KEY || !/^[A-Za-z0-9_.:-]+$/.test(entityKey)) {
    errors.push(`entityKey must be 1-${MAX_ENTITY_KEY} safe characters`);
  }
  if (!entityLabel || entityLabel.length > MAX_LABEL) {
    errors.push(`entityLabel must be 1-${MAX_LABEL} characters`);
  }
  if (reason.length > MAX_REASON) {
    errors.push(`reason must be at most ${MAX_REASON} characters`);
  }
  if (sourceRevision.length > 80) {
    errors.push("sourceRevision must be at most 80 characters");
  }

  const changes = cleanFileMap(value.changes, errors, "changes");
  const baseline = cleanFileMap(value.baseline, errors, "baseline");
  for (const file of Object.keys(changes)) {
    if (!(file in baseline)) {
      errors.push(`baseline is missing ${file}`);
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        errors,
        draft: { entityType, entityKey, entityLabel, reason, sourceRevision, changes, baseline },
      };
}

export function mergeSuggestionDeltas(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    target[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeSuggestionDeltas({ ...current }, value)
        : structuredClone(value);
  }
  return target;
}
