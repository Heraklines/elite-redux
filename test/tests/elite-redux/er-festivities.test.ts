/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Festivities (ER ability 842) - dex: "Sound moves become dance moves and vice
// versa." Both directions must be wired as move-flag injections so the
// user-aware Move.doesFlagEffectApply honors them:
//   - SOUND -> DANCE: the holder's sound moves count as dance (others' Dancer).
//   - DANCE -> SOUND: the holder's dance moves count as sound (Punk Rock boost,
//     Soundproof immunity, Liquid Voice, Substitute bypass).
// Previously only the sound->dance half existed. This pins both injections + the
// per-move scoping (a sound move gets DANCE, a dance move gets SOUND, no cross).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { MoveFlagInjectionAbAttr } from "#data/elite-redux/archetypes/move-flag-injection";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { describe, expect, it } from "vitest";

const festivitiesInjectors = (): MoveFlagInjectionAbAttr[] =>
  dispatchArchetype("bespoke", null, 842).attrs.filter(
    (a): a is MoveFlagInjectionAbAttr => a instanceof MoveFlagInjectionAbAttr,
  );

describe("Festivities (842): bidirectional sound<->dance flag injection", () => {
  it("the dex move flags this test relies on are as expected", () => {
    expect(allMoves[MoveId.HYPER_VOICE].hasFlag(MoveFlags.SOUND_BASED)).toBe(true);
    expect(allMoves[MoveId.HYPER_VOICE].hasFlag(MoveFlags.DANCE_MOVE)).toBe(false);
    expect(allMoves[MoveId.DRAGON_DANCE].hasFlag(MoveFlags.DANCE_MOVE)).toBe(true);
    expect(allMoves[MoveId.DRAGON_DANCE].hasFlag(MoveFlags.SOUND_BASED)).toBe(false);
  });

  it("emits BOTH injections (was only sound->dance before)", () => {
    const inj = festivitiesInjectors();
    expect(inj).toHaveLength(2);
    expect(inj.some(a => a.injectFlag === MoveFlags.DANCE_MOVE)).toBe(true);
    expect(inj.some(a => a.injectFlag === MoveFlags.SOUND_BASED)).toBe(true);
  });

  it("sound->dance: a SOUND move gains DANCE, a non-sound move does not", () => {
    const s2d = festivitiesInjectors().find(a => a.injectFlag === MoveFlags.DANCE_MOVE)!;
    expect(s2d.injects(MoveFlags.DANCE_MOVE, allMoves[MoveId.HYPER_VOICE])).toBe(true);
    expect(s2d.injects(MoveFlags.DANCE_MOVE, allMoves[MoveId.DRAGON_DANCE])).toBe(false);
    // only injects its own flag
    expect(s2d.injects(MoveFlags.SOUND_BASED, allMoves[MoveId.HYPER_VOICE])).toBe(false);
  });

  it("dance->sound: a DANCE move gains SOUND, a non-dance move does not", () => {
    const d2s = festivitiesInjectors().find(a => a.injectFlag === MoveFlags.SOUND_BASED)!;
    expect(d2s.injects(MoveFlags.SOUND_BASED, allMoves[MoveId.DRAGON_DANCE])).toBe(true);
    expect(d2s.injects(MoveFlags.SOUND_BASED, allMoves[MoveId.HYPER_VOICE])).toBe(false);
    expect(d2s.injects(MoveFlags.DANCE_MOVE, allMoves[MoveId.DRAGON_DANCE])).toBe(false);
  });
});
