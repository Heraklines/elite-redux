// =============================================================================
// Tests for the battle-anims URL resolver — confirms ER-custom moves route
// to `./battle-anims-er/<slug>.json` and vanilla moves stay on
// `./battle-anims/<slug>.json`. Catches regressions in the `getMoveAnimUrl`
// branch in `src/data/battle-anims.ts`.
// =============================================================================

import { getMoveAnimUrl } from "#data/battle-anims";
import { ErMoveId } from "#enums/er-move-id";
import { MoveId } from "#enums/move-id";
import { describe, expect, it } from "vitest";

// ER ids live outside the vanilla MoveId enum but the loader treats them
// as numeric MoveIds at runtime (see init-elite-redux-custom-moves.ts).
// Cast through `as MoveId` here for type-cleanliness.
const asMoveId = (n: number): MoveId => n as MoveId;

describe("battle-anims — getMoveAnimUrl", () => {
  describe("vanilla moves (id < 5000)", () => {
    it("routes TACKLE to ./battle-anims/tackle.json", () => {
      expect(getMoveAnimUrl(MoveId.TACKLE)).toBe("./battle-anims/tackle.json");
    });

    it("routes FLAMETHROWER to ./battle-anims/flamethrower.json", () => {
      expect(getMoveAnimUrl(MoveId.FLAMETHROWER)).toBe("./battle-anims/flamethrower.json");
    });

    it("kebab-cases multi-word vanilla move names", () => {
      // BODY_SLAM → body-slam.json
      expect(getMoveAnimUrl(MoveId.BODY_SLAM)).toBe("./battle-anims/body-slam.json");
    });

    it("routes assetless HAPPY_HOUR to a stable self-status fallback", () => {
      expect(getMoveAnimUrl(MoveId.HAPPY_HOUR)).toBe("./battle-anims/focus-energy.json");
    });
  });

  describe("ER-custom moves (id >= 5000)", () => {
    it("routes ER OUTBURST to ./battle-anims-er/outburst.json", () => {
      expect(getMoveAnimUrl(asMoveId(ErMoveId.OUTBURST))).toBe("./battle-anims-er/outburst.json");
    });

    it("routes ER AQUA_FANG to ./battle-anims-er/aqua-fang.json", () => {
      expect(getMoveAnimUrl(asMoveId(ErMoveId.AQUA_FANG))).toBe("./battle-anims-er/aqua-fang.json");
    });

    it("routes ER PLASMA_PULSE to ./battle-anims-er/plasma-pulse.json", () => {
      expect(getMoveAnimUrl(asMoveId(ErMoveId.PLASMA_PULSE))).toBe("./battle-anims-er/plasma-pulse.json");
    });

    it("returns null for an ER-range id that's not in ErMoveId", () => {
      // 9999 is in the ER range (>=5000) but unmapped — confirms we don't
      // accidentally synthesise a slug from the bare number.
      expect(getMoveAnimUrl(asMoveId(9999))).toBeNull();
    });
  });

  it("returns null for a wholly-unknown low id", () => {
    // 4000 falls between the vanilla MoveId ceiling (~950) and the ER
    // floor (5000) — neither enum has it, so the resolver must return null.
    expect(getMoveAnimUrl(asMoveId(4000))).toBeNull();
  });
});
