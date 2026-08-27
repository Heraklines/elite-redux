/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import {
  isDisallowedPublicUsername,
  moderateGhostPresentation,
  moderateGhostUsername,
} from "../../../workers/er-save-api/src/ghost-public-moderation";

describe("public ghost moderation", () => {
  it("rewrites every confirmed dialogue line without changing other profile fields", () => {
    const presentation = {
      displayName: "Garchomp Fan",
      title: "Champion",
      dialogue: {
        intro: "garchomp segs",
        defeatPlayer: "I enjoy big tit goth girls",
        defeated: "IF U BEAT ME, U LIKE BEATING KIDS",
        afterWin: "pussy to fat",
      },
    };

    expect(moderateGhostPresentation(presentation)).toEqual({
      displayName: "Garchomp Fan",
      title: "Champion",
      dialogue: {
        intro: "My Garchomp clicked Earthquake next to Levitate. We planned this.",
        defeatPlayer: "I am very edgy. Dark-type, even.",
        defeated: "If you beat me, I'm reporting your Quick Claw.",
        afterWin: "Snorlax ate my post-battle excuse.",
      },
    });
    expect(presentation.dialogue.intro).toBe("garchomp segs");
  });

  it("does not broadly censor ordinary trash talk or malformed presentation values", () => {
    const trashTalk = { dialogue: { intro: "Your team is getting swept." } };
    expect(moderateGhostPresentation(trashTalk)).toBe(trashTalk);
    expect(moderateGhostPresentation(null)).toBeNull();
    expect(moderateGhostPresentation("hello")).toBe("hello");
  });

  it("keeps the historical public alias and rejects high-confidence slur registrations", () => {
    expect(moderateGhostUsername("Bigdickenergy 69")).toBe("smallpeckerenergy");
    expect(moderateGhostUsername("Normal Trainer")).toBe("Normal Trainer");
    expect(isDisallowedPublicUsername("nigga44")).toBe(true);
    expect(isDisallowedPublicUsername("The Nigger Hater")).toBe(true);
    expect(isDisallowedPublicUsername("Sniggers softly")).toBe(false);
    expect(isDisallowedPublicUsername("snigger-nigga")).toBe(true);
    expect(isDisallowedPublicUsername("GarchompFan")).toBe(false);
  });
});
