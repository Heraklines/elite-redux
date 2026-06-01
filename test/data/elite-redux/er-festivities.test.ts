import { MoveFlagInjectionAbAttr } from "#data/elite-redux/archetypes/move-flag-injection";
import { MoveFlags } from "#enums/move-flags";
import { describe, expect, it } from "vitest";

/**
 * Festivities — "Sound moves become dance moves and vice versa." The Sound→Dance
 * half: the holder's sound moves are treated as dance moves (DANCE_MOVE flag
 * injected, so they trigger Dancer). Verifies the new "sound-moves" injection
 * scope. (Dance→Sound is engine-blocked — documented in the dispatcher.)
 */
describe("ER ability - Festivities (sound moves become dances)", () => {
  const attr = new MoveFlagInjectionAbAttr(MoveFlags.DANCE_MOVE, "sound-moves");
  const move = (sound: boolean) => ({ hasFlag: (f: MoveFlags) => sound && f === MoveFlags.SOUND_BASED }) as any;

  it("injects DANCE_MOVE onto a sound move", () => {
    expect(attr.injects(MoveFlags.DANCE_MOVE, move(true))).toBe(true);
  });

  it("does NOT inject onto a non-sound move", () => {
    expect(attr.injects(MoveFlags.DANCE_MOVE, move(false))).toBe(false);
  });

  it("does NOT inject a flag it isn't configured for", () => {
    expect(attr.injects(MoveFlags.SOUND_BASED, move(true))).toBe(false);
  });
});
