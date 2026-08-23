const EMPTY_BIOME_BGM_LOOP_POINTS: Record<string, number> = Object.freeze({});

export let biomeBgmLoopPoints: Record<string, number> = EMPTY_BIOME_BGM_LOOP_POINTS;

/**
 * Resolve optional presentation metadata without allowing a failed/late asset request to abort gameplay.
 * A zero loop point simply lets the track restart from its beginning.
 */
export function getBiomeBgmLoopPoint(biomeKey: string): number {
  const loopPoint = biomeBgmLoopPoints[biomeKey];
  return Number.isFinite(loopPoint) && loopPoint >= 0 ? loopPoint : 0;
}

export function assignBiomeBgmLoopPoints(data: unknown): void {
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    biomeBgmLoopPoints = data as Record<string, number>;
    return;
  }
  biomeBgmLoopPoints = EMPTY_BIOME_BGM_LOOP_POINTS;
}
