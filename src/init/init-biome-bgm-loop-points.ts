import { assignBiomeBgmLoopPoints } from "#data/biome-bgm-loop-points";
import { cachedFetch } from "#utils/fetch-utils";

export function initBiomeBgmLoopPoints(): void {
  void cachedFetch("./biome-bgm-loop-points.json")
    .then(res => res.json())
    .then(bgmLoopPoints => assignBiomeBgmLoopPoints(bgmLoopPoints))
    .catch(error => {
      // Loop points affect only where music restarts. A slow/failed optional JSON request must not create an
      // unhandled rejection during boot or leave a later EncounterPhase able to crash the battle engine.
      console.warn("[bgm] biome loop-point metadata unavailable; tracks will loop from the beginning", error);
    });
}
