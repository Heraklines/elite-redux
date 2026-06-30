/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Ghost Trainer FX - serialization round-trip (engine-free).
//
// A player equips an entrance + aura in the Ghost Trainer Editor; the editor folds
// them onto GhostTrainerProfile (approach / aura / showAuraInBattle). That profile
// rides on every published ghost through the SAME path another player decodes it:
//
//   editor fold -> sanitizeGhostProfile (publish, er-ghost-teams:596)
//   -> JSON.stringify / JSON.parse  (worker `runs.presentation` blob, er-ghost-teams)
//   -> sanitizeGhostProfile (encounter, er-ghost-teams:1131)
//   -> the fields markTrainerAsGhost reads (erGhostApproach / erGhostAura)
//
// This proves the FX survive that round-trip intact, AND that an untrusted peer's
// bogus aura id / unknown approach are dropped to none/default by the sanitizer
// (the anti-tamper clamp). It also gates the locale bundle + the TrainerFxSaveData
// owned/equipped round-trip. No game engine - pure profile + sanitizer, like
// er-new-achievements.test.ts.
// =============================================================================

import {
  type GhostApproachEffect,
  type GhostTrainerProfile,
  sanitizeGhostProfile,
} from "#data/elite-redux/er-ghost-profile";
import {
  getEquippedTrainerAura,
  getEquippedTrainerEntrance,
  isTrainerAuraOwned,
  isTrainerEntranceOwned,
  sanitizeTrainerFxSaveData,
  setEquippedTrainerAura,
  setEquippedTrainerEntrance,
  setTrainerAuraOwned,
  setTrainerEntranceOwned,
  TRAINER_AURA_EFFECTS,
  TRAINER_ENTRANCE_EFFECTS,
  type TrainerFxSaveData,
} from "#data/elite-redux/er-trainer-fx";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mirror the editor's buildProfile() FX fold: an equipped entrance -> profile.approach,
 * an equipped aura -> profile.aura + showAuraInBattle (er-ghost-profile fields).
 */
function foldFx(base: GhostTrainerProfile, entranceId: string | null, auraId: string | null): GhostTrainerProfile {
  const entrance = entranceId ? TRAINER_ENTRANCE_EFFECTS.find(e => e.id === entranceId) : undefined;
  const aura = auraId ? TRAINER_AURA_EFFECTS.find(a => a.id === auraId) : undefined;
  return {
    ...base,
    approach: entrance?.approach,
    aura: aura?.id,
    showAuraInBattle: aura ? true : undefined,
  };
}

/**
 * The exact path a published ghost's presentation takes to ANOTHER player:
 * publish-time sanitize -> wire (JSON) -> encounter-time sanitize.
 */
function roundTrip(profile: GhostTrainerProfile): GhostTrainerProfile | null {
  const published = sanitizeGhostProfile(profile);
  const wire = JSON.parse(JSON.stringify(published)) as unknown;
  return sanitizeGhostProfile(wire);
}

/** What er-ghost-teams.markTrainerAsGhost reads off the decoded profile onto the Trainer. */
function readGhostFx(pres: GhostTrainerProfile | null): {
  erGhostApproach: GhostApproachEffect | undefined;
  erGhostAura: string | undefined;
} {
  return {
    erGhostApproach: pres?.approach && pres.approach !== "default" ? pres.approach : undefined,
    erGhostAura: pres?.aura && pres.showAuraInBattle ? pres.aura : undefined,
  };
}

describe("ER Ghost Trainer FX - profile serialization round-trip", () => {
  it("survives a non-default entrance + a known aura + showAuraInBattle through publish -> wire -> encounter", () => {
    // A real catalog entrance (non-default) + a real catalog aura.
    const entrance = TRAINER_ENTRANCE_EFFECTS.find(e => e.id === "riseFromGround");
    const aura = TRAINER_AURA_EFFECTS.find(a => a.id === "embers");
    expect(entrance, "riseFromGround entrance missing from catalog").toBeDefined();
    expect(aura, "embers aura missing from catalog").toBeDefined();

    const profile = foldFx({ displayName: "Revenant" }, entrance!.id, aura!.id);
    // The fold itself produced a non-default approach + the aura id + the show flag.
    expect(profile.approach).toBe(entrance!.approach);
    expect(profile.approach).not.toBe("default");
    expect(profile.aura).toBe("embers");
    expect(profile.showAuraInBattle).toBe(true);

    const decoded = roundTrip(profile);
    expect(decoded).not.toBeNull();
    // The FX fields survive the round-trip intact.
    expect(decoded?.approach).toBe(entrance!.approach);
    expect(decoded?.aura).toBe("embers");
    expect(decoded?.showAuraInBattle).toBe(true);
    // And other authored fields ride along unharmed.
    expect(decoded?.displayName).toBe("Revenant");

    // The encountering client applies them exactly as markTrainerAsGhost does.
    const applied = readGhostFx(decoded);
    expect(applied.erGhostApproach).toBe(entrance!.approach);
    expect(applied.erGhostAura).toBe("embers");
  });

  it("every catalog entrance maps to a non-default approach that survives the round-trip", () => {
    for (const entrance of TRAINER_ENTRANCE_EFFECTS) {
      expect(entrance.approach).not.toBe("default");
      const decoded = roundTrip(foldFx({}, entrance.id, null));
      expect(decoded?.approach, `${entrance.id} approach lost`).toBe(entrance.approach);
      expect(readGhostFx(decoded).erGhostApproach).toBe(entrance.approach);
    }
  });

  it("every catalog aura id survives the round-trip and applies when shown in battle", () => {
    for (const aura of TRAINER_AURA_EFFECTS) {
      const decoded = roundTrip(foldFx({}, null, aura.id));
      expect(decoded?.aura, `${aura.id} aura lost`).toBe(aura.id);
      expect(decoded?.showAuraInBattle).toBe(true);
      expect(readGhostFx(decoded).erGhostAura).toBe(aura.id);
    }
  });

  it("drops a bogus aura id and an unknown approach to none/default (anti-tamper clamp)", () => {
    // A hostile peer hand-crafts a presentation blob with effects that are NOT in the catalog.
    const tampered = {
      displayName: "Cheater",
      approach: "teleportMagic" as GhostApproachEffect,
      aura: "rainbowblast",
      showAuraInBattle: true,
    } as unknown as GhostTrainerProfile;

    const decoded = roundTrip(tampered);
    // The display name is fine, but the unknown approach + unknown aura are stripped.
    expect(decoded?.displayName).toBe("Cheater");
    expect(decoded?.approach).toBeUndefined();
    expect(decoded?.aura).toBeUndefined();

    const applied = readGhostFx(decoded);
    expect(applied.erGhostApproach).toBeUndefined();
    expect(applied.erGhostAura).toBeUndefined();
  });

  it("keeps a known aura on the profile but does NOT apply it when showAuraInBattle is false", () => {
    const decoded = roundTrip({ aura: "frost", showAuraInBattle: false });
    // The aura id is preserved (it is a valid catalog id)...
    expect(decoded?.aura).toBe("frost");
    // ...but markTrainerAsGhost only renders it when the show flag is set.
    expect(readGhostFx(decoded).erGhostAura).toBeUndefined();
  });
});

describe("ER Ghost Trainer FX - local save (TrainerFxSaveData) round-trip", () => {
  it("preserves owned bits + a valid equipped pick, and drops an equip the player does not own", () => {
    const save: TrainerFxSaveData = {};
    // Own + equip a known entrance and aura.
    setTrainerEntranceOwned(save, "riseFromGround");
    setTrainerAuraOwned(save, "embers");
    setEquippedTrainerEntrance(save, "riseFromGround");
    setEquippedTrainerAura(save, "embers");

    const restored = sanitizeTrainerFxSaveData(JSON.parse(JSON.stringify(save)));
    expect(restored).toBeDefined();
    expect(isTrainerEntranceOwned(restored, "riseFromGround")).toBe(true);
    expect(isTrainerAuraOwned(restored, "embers")).toBe(true);
    expect(getEquippedTrainerEntrance(restored)?.id).toBe("riseFromGround");
    expect(getEquippedTrainerAura(restored)?.id).toBe("embers");

    // Tamper: force an equipped index that points at an effect the player does NOT own.
    const tampered = { ...JSON.parse(JSON.stringify(save)), la: TRAINER_AURA_EFFECTS.length } as TrainerFxSaveData;
    const clamped = sanitizeTrainerFxSaveData(tampered);
    // The last aura is not owned, so the equip is cleared.
    expect(getEquippedTrainerAura(clamped)).toBeNull();
  });
});

describe("ER Ghost Trainer FX - locale bundle mirrors the catalog", () => {
  const locale = JSON.parse(readFileSync(resolve("locales/en/ghost-trainer-fx.json"), "utf-8")) as {
    rowEntrance: string;
    rowAura: string;
    entrances: Record<string, string>;
    auras: Record<string, string>;
  };

  it("has an English name for every entrance + aura that matches the catalog label", () => {
    expect(locale.rowEntrance.length).toBeGreaterThan(0);
    expect(locale.rowAura.length).toBeGreaterThan(0);
    for (const entrance of TRAINER_ENTRANCE_EFFECTS) {
      const name = locale.entrances[entrance.id];
      expect(name, `entrances.${entrance.id} missing from locales/en/ghost-trainer-fx.json`).toBeDefined();
      expect(name).toBe(entrance.label);
    }
    for (const aura of TRAINER_AURA_EFFECTS) {
      const name = locale.auras[aura.id];
      expect(name, `auras.${aura.id} missing from locales/en/ghost-trainer-fx.json`).toBeDefined();
      expect(name).toBe(aura.label);
    }
  });

  it("contains no em dash in any player-facing string (maintainer writing rule)", () => {
    const text = readFileSync(resolve("locales/en/ghost-trainer-fx.json"), "utf-8");
    expect(text.includes("—")).toBe(false);
  });
});
