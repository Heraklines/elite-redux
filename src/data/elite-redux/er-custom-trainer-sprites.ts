import customTrainerSpritesJson from "./er-custom-trainer-sprites.json";

export interface ErCustomTrainerSprite {
  key: string;
  label: string;
  spriteKey: string;
  genders: boolean;
  kind: string;
  tags: readonly string[];
  author: string;
  license: string;
  sourceUrl: string;
}

const SPRITE_KEY_RE = /^[a-z0-9_]{2,64}$/;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** Normalize one staff-uploaded trainer sprite catalog entry. Invalid entries stay unavailable. */
export function normalizeErCustomTrainerSprite(
  key: unknown,
  catalog: Record<string, unknown>,
): ErCustomTrainerSprite | null {
  if (typeof key !== "string" || !SPRITE_KEY_RE.test(key)) {
    return null;
  }
  const raw = catalog[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const spriteKey = cleanText(entry.spriteKey, 64) || key;
  if (!SPRITE_KEY_RE.test(spriteKey)) {
    return null;
  }
  return {
    key,
    label: cleanText(entry.label, 80) || key,
    spriteKey,
    genders: entry.genders === true,
    kind: cleanText(entry.kind, 40),
    tags: Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === "string").map(tag => tag.trim().slice(0, 32)).filter(Boolean)
      : [],
    author: cleanText(entry.author, 80),
    license: cleanText(entry.license, 40) || "unknown",
    sourceUrl: cleanText(entry.sourceUrl, 500),
  };
}

/** Resolve one entry from the versioned game catalog. */
export function getErCustomTrainerSprite(key: unknown): ErCustomTrainerSprite | null {
  return normalizeErCustomTrainerSprite(key, customTrainerSpritesJson as Record<string, unknown>);
}
