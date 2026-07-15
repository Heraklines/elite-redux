/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// jsdom SMOKE HARNESS for the Custom Trainers editor tab (editor/app.js).
//
// The editor is a static browser SPA (no build, no module system): a flat script
// of top-level `const`/`function` declarations that calls `init()` (which fetches
// live data) at the very bottom. To exercise its Custom-Trainers logic WITHOUT a
// browser or network, we:
//   1. build a minimal DOM (the chrome the module reads at load: #status/#save/…),
//   2. strip the trailing `init();` so no fetch fires, and APPEND a shim that
//      re-exports the tab's functions + live state (in the SAME lexical scope, so
//      it can see the module's `const`s), then
//   3. eval the whole thing inside a jsdom window (`runScripts: "outside-only"`),
//   4. seed a tiny species/move fixture and drive the real input/click handlers.
//
// This ROUND-4 harness extends the prior editor smoke coverage (bgm picker / sets
// / legality / collapse) with the three new features: weighted slot variants (the
// "Weighted slot?" toggle + possibility stepper/weight/odds + add/remove), the
// slot-fill probability field (slots 2-6), and the RLA/RLNA move tokens (offered
// at the top of the datalist + exempt from the legality/unknown-move save gate),
// plus the save-payload shapes (flat member vs variants array, slotChance).
//
// Pure DOM + logic — no ER boot, so it is NOT gated behind ER_SCENARIO.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** The Custom-Trainers surface exposed by the appended shim (see below). */
interface EditorHarness {
  blankCtrTrainer(): Record<string, unknown>;
  ctrIsMoveToken(v: string): boolean;
  ctrSlotOdds(m: Record<string, unknown>): string;
  render(): void;
  onCustomTrainerInput(el: Element): boolean;
  onCustomTrainerChange(el: Element): boolean;
  onCustomTrainerClick(e: { target: Element }): boolean;
  buildDeltas(): { deltas: Record<string, unknown>; bad: string[] };
  ctrMoveIllegal(m: Record<string, unknown>, move: string): boolean;
  ctrFusedName(a: string, b: string): string;
  ctrLiveToEdit(entry: Record<string, unknown>): Record<string, any>;
  ctrBuildBaselines(delta: Record<string, unknown>): Record<string, string>;
  hashCtrTrainerEntry(entry: unknown): string;
  markCustomTrainersSaved(delta: Record<string, unknown>, data: Record<string, unknown>): void;
  CTR_LIVE: Record<string, any>;
  HELD_ITEMS: { key: string; label: string; category: string }[];
  CHALLENGE_VALUES: Record<string, { value: number; label: string }[]>;
  CHALLENGE_PRESETS: { name: string; challenge: string; challengeValue: number }[];
  ctr: { current: Record<string, any>; baseline: Record<string, any> };
  ctrConfig: {
    current: { windowSize: number; windowChancePct: number };
    baseline: { windowSize: number; windowChancePct: number };
  };
  spByConst: Map<string, unknown>;
  spById: Map<number, unknown>;
  trainerClassByName: Map<string, { name: string; sprite: string; genders: boolean }>;
  trainerSpriteByKey: Map<string, { key: string; spriteKey: string; label: string; genders: boolean }>;
  SHINY_EFFECTS: { palette: any[]; surface: any[]; around: any[] };
  shinyEffectById: Map<string, { id: string; label: string; accent: string; category: string }>;
  TRAINER_FX: { id: string; label: string; accent: string }[];
  trainerFxById: Map<string, { id: string; label: string; accent: string }>;
  MOVE_SET: Set<string>;
  moveNameToEnumKey(name: string): string;
  legalMovesFor(speciesConst: string): Set<string>;
  learn: { current: Record<string, [number, number][]>; baseline: Record<string, unknown> };
  tms: { current: Record<string, number[]>; baseline: Record<string, unknown> };
  moveById: Map<number, { id: number; name: string }>;
  ctrOpenMembers: Set<number>;
  ctrSetSel: Map<number, number>;
  legalMovesCache: Map<string, unknown>;
  egg: { current: Record<string, string[]>; baseline: Record<string, unknown> };
  ctrSelected: string | null;
  setTab(v: string): void;
}

const HARNESS_HTML = `<!doctype html><html><body>
  <div id="status"></div>
  <button id="save"></button>
  <button id="deploy"></button>
  <button id="undo"></button>
  <input id="search" /><select id="sort"><option value="name">name</option></select>
  <nav class="tabs"><button data-tab="customtrainers">Custom Trainers</button></nav>
  <div id="content"></div>
  <input id="password" />
</body></html>`;

let win: JSDOM["window"];
let ct: EditorHarness;

/** `document.querySelector` against the jsdom window. */
function q(sel: string): Element | null {
  return win.document.querySelector(sel);
}

/** Seed a species into both editor lookups (species by CONST + by numeric id). */
function addSpecies(constKey: string, id: number, name: string): void {
  const entry = { const: constKey, name, id, dex: id, bst: 500, slug: name.toLowerCase() };
  ct.spByConst.set(constKey, entry);
  ct.spById.set(id, entry);
}

/** Create + select a fresh trainer via the real "＋ New trainer" click; returns its key. */
function newTrainer(name = "Smoke"): string {
  ct.setTab("customtrainers");
  ct.render();
  ct.onCustomTrainerClick({ target: q("#ctr-new")! });
  const key = ct.ctrSelected!;
  ct.ctr.current[key].name = name;
  return key;
}

/** Type a species CONST into slot `i`'s species input (input + blur handlers). */
function setSpecies(i: number, constKey: string): void {
  const el = q(`.ctr-species[data-idx="${i}"]`) as HTMLInputElement;
  el.value = constKey;
  ct.onCustomTrainerInput(el);
  ct.onCustomTrainerChange(el);
}

beforeAll(() => {
  const appSrc = readFileSync(resolve(process.cwd(), "editor/app.js"), "utf8");
  // Strip the trailing bootstrap call so no fetch fires, then expose the tab's
  // functions + live state to the test (the shim runs in the SAME script scope,
  // so it can reference the module's top-level `const`s directly).
  const stripped = appSrc.replace(/\ninit\(\);\s*$/, "\n");
  const shim = `
    ;window.__ct = {
      blankCtrTrainer, ctrIsMoveToken, ctrSlotOdds, ctrMoveIllegal, ctrFusedName, ctrLiveToEdit,
      ctrBuildBaselines, hashCtrTrainerEntry, markCustomTrainersSaved,
      render, onCustomTrainerInput, onCustomTrainerChange, onCustomTrainerClick, buildDeltas,
      ctr, ctrConfig, spByConst, spById, trainerClassByName, trainerSpriteByKey, SHINY_EFFECTS, shinyEffectById, TRAINER_FX, trainerFxById, MOVE_SET, moveNameToEnumKey, legalMovesFor, learn, tms, moveById, ctrOpenMembers, ctrSetSel, legalMovesCache, egg,
      get ctrSelected(){ return ctrSelected; }, set ctrSelected(v){ ctrSelected = v; },
      get CTR_LIVE(){ return CTR_LIVE; }, set CTR_LIVE(v){ CTR_LIVE = v; },
      get HELD_ITEMS(){ return HELD_ITEMS; }, set HELD_ITEMS(v){ HELD_ITEMS = v; },
      get CHALLENGE_VALUES(){ return CHALLENGE_VALUES; }, set CHALLENGE_VALUES(v){ CHALLENGE_VALUES = v; },
      get CHALLENGE_PRESETS(){ return CHALLENGE_PRESETS; }, set CHALLENGE_PRESETS(v){ CHALLENGE_PRESETS = v; },
      setTab(v){ activeTab = v; },
    };`;
  const dom = new JSDOM(HARNESS_HTML, { runScripts: "outside-only", pretendToBeVisual: true });
  win = dom.window;
  // No network in the harness: any stray fetch (e.g. the sprite preview) resolves
  // to a benign "not ok" so nothing hangs or throws.
  win.fetch = (() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })) as never;
  win.eval(stripped + shim);
  ct = win.__ct as EditorHarness;
});

beforeEach(() => {
  // Reset editor state between tests (module state is shared across the file).
  ct.ctr.current = {};
  ct.ctr.baseline = {};
  ct.CTR_LIVE = {};
  ct.ctrConfig.current = { windowSize: 10, windowChancePct: 25 };
  ct.ctrConfig.baseline = { windowSize: 10, windowChancePct: 25 };
  ct.ctrSelected = null;
  ct.ctrOpenMembers.clear();
  ct.ctrSetSel.clear();
  ct.legalMovesCache.clear();
  ct.egg.current = {};
  ct.learn.current = {};
  ct.tms.current = {};
  ct.moveById.clear();
  ct.spByConst.clear();
  ct.spById.clear();
  ct.MOVE_SET.clear();
  addSpecies("SPECIES_PIKACHU", 25, "Pikachu");
  addSpecies("SPECIES_RAICHU", 26, "Raichu");
  addSpecies("SPECIES_SNORLAX", 143, "Snorlax");
  addSpecies("SPECIES_GENGAR", 94, "Gengar");
  for (const mv of ["THUNDERBOLT", "BODY_SLAM", "SHADOW_BALL", "THUNDER", "SURF"]) {
    ct.MOVE_SET.add(mv);
  }
  // Trainer-class sprite catalog: ACE_TRAINER ships both m/f sprites; HIKER a single one.
  ct.trainerClassByName.clear();
  ct.trainerClassByName.set("ACE_TRAINER", { name: "ACE_TRAINER", sprite: "ace_trainer", genders: true });
  ct.trainerClassByName.set("HIKER", { name: "HIKER", sprite: "hiker", genders: false });
  ct.trainerSpriteByKey.clear();
  // Shiny Lab effect registry fixture (a couple per category).
  ct.SHINY_EFFECTS.palette.length = 0;
  ct.SHINY_EFFECTS.surface.length = 0;
  ct.SHINY_EFFECTS.around.length = 0;
  ct.shinyEffectById.clear();
  const seedShiny = (category: "palette" | "surface" | "around", id: string, label: string, accent: string) => {
    ct.SHINY_EFFECTS[category].push({ id, label, accent });
    ct.shinyEffectById.set(id, { id, label, accent, category });
  };
  seedShiny("palette", "glacier", "Glacier", "#7fd8ff");
  seedShiny("palette", "inferno", "Inferno", "#ff6a24");
  seedShiny("surface", "holofoil", "Holo Foil", "#7fe0ff");
  seedShiny("around", "zaps", "Zaps", "#ffd27a");
  // Held-item catalog fixture: at least one of each grouped category so the
  // picker's grouping can be asserted (booster/berry/gem/utility).
  ct.HELD_ITEMS = [
    { key: "CHARCOAL", label: "Charcoal", category: "booster" },
    { key: "SILK_SCARF", label: "Silk Scarf", category: "booster" },
    { key: "SITRUS_BERRY", label: "Sitrus Berry", category: "berry" },
    { key: "ER_FIRE_GEM", label: "Fire Gem", category: "gem" },
    { key: "LEFTOVERS", label: "Leftovers", category: "utility" },
  ];
  // Challenge VALUE option lists fixture: a couple of parameterizable kinds
  // (mono-type / mono-gen) so the value dropdown can be exercised. `inverse` is
  // deliberately absent -> not parameterizable (no value dropdown).
  ct.CHALLENGE_VALUES = {
    monotype: [
      { value: 9, label: "Steel" },
      { value: 10, label: "Fire" },
      { value: 11, label: "Water" },
    ],
    monogen: [
      { value: 1, label: "Gen 1" },
      { value: 10, label: "RDX (Elite Redux)" },
    ],
  };
  // Named challenge presets fixture (mined from the achievement catalog).
  ct.CHALLENGE_PRESETS = [
    { name: "I Cast Fireball!", challenge: "monotype", challengeValue: 10 },
    { name: "Extra Ordinary", challenge: "monotype", challengeValue: 1 },
    { name: "Redux Means Redux", challenge: "monogen", challengeValue: 10 },
  ];
  // Ghost Trainer FX aura catalog fixture (the per-trainer sprite-effect picker).
  ct.TRAINER_FX.length = 0;
  ct.trainerFxById.clear();
  for (const e of [
    { id: "smoke", label: "Smoke", accent: "#cccccc" },
    { id: "shadowaura", label: "Shadow Aura", accent: "#9b6cff" },
  ]) {
    ct.TRAINER_FX.push(e);
    ct.trainerFxById.set(e.id, e);
  }
});

describe("Custom Trainers editor — round-4 smoke (jsdom)", () => {
  it("weighted toggle reveals the possibility stepper; add/remove and stepper SWAP the member form", () => {
    newTrainer();
    const key = ct.ctrSelected!;
    const t = ct.ctr.current[key];
    setSpecies(0, "SPECIES_PIKACHU");

    // Not weighted yet -> no variant controls.
    expect(q(".ctr-var-ctrls")).toBeNull();
    expect(t.team[0].weighted).toBe(false);

    // Toggle "Weighted slot?" on.
    const cb = q('.ctr-weighted[data-idx="0"]') as HTMLInputElement;
    cb.checked = true;
    ct.onCustomTrainerChange(cb);
    expect(t.team[0].weighted).toBe(true);
    expect(q(".ctr-var-ctrls")).not.toBeNull();
    // The single (folded) possibility is Pikachu; N == 1 so no ✕ possibility yet.
    expect(t.team[0].variants.length).toBe(1);
    expect(t.team[0].variants[0].species).toBe("SPECIES_PIKACHU");
    expect(q(".ctr-var-del")).toBeNull();

    // + possibility -> N == 2, cur moves to the fresh (blank) possibility.
    ct.onCustomTrainerClick({ target: q('.ctr-var-add[data-idx="0"]')! });
    expect(t.team[0].variants.length).toBe(2);
    expect(t.team[0].cur).toBe(1);
    expect(t.team[0].species).toBe(""); // form swapped to the blank possibility
    expect(q(".ctr-var-del")).not.toBeNull(); // ✕ appears at N > 1

    // Fill the 2nd possibility with Raichu.
    setSpecies(0, "SPECIES_RAICHU");
    expect(t.team[0].species).toBe("SPECIES_RAICHU");

    // Stepper ◂ -> possibility 1: the ENTIRE member form swaps back to Pikachu.
    ct.onCustomTrainerClick({ target: q('.ctr-var-prev[data-idx="0"]')! });
    expect(t.team[0].cur).toBe(0);
    expect(t.team[0].species).toBe("SPECIES_PIKACHU");
    // ▸ -> back to possibility 2 (Raichu), proving the swap round-trips.
    ct.onCustomTrainerClick({ target: q('.ctr-var-next[data-idx="0"]')! });
    expect(t.team[0].cur).toBe(1);
    expect(t.team[0].species).toBe("SPECIES_RAICHU");

    // Edit the current possibility's weight -> pick odds reflect it.
    const w = q('.ctr-var-weight[data-idx="0"]') as HTMLInputElement;
    w.value = "70";
    ct.onCustomTrainerInput(w);
    ct.onCustomTrainerChange(w);
    expect(t.team[0].variants[1].weight).toBe(70);
    // Possibility 1 kept its default weight 1 -> odds 70/71.
    expect(ct.ctrSlotOdds(t.team[0])).toBe(`70/71 = ${Math.round((70 / 71) * 100)}%`);

    // ✕ possibility removes the current one -> back to a single possibility.
    ct.onCustomTrainerClick({ target: q('.ctr-var-del[data-idx="0"]')! });
    expect(t.team[0].variants.length).toBe(1);
    expect(q(".ctr-var-del")).toBeNull();
  });

  it("Slot Probability field shows for slots 2-6 only and edits slotChance", () => {
    newTrainer();
    const key = ct.ctrSelected!;
    const t = ct.ctr.current[key];
    setSpecies(0, "SPECIES_SNORLAX");
    // Add a 2nd member (slot index 1).
    ct.onCustomTrainerClick({ target: q("#ctr-add-member")! });
    setSpecies(1, "SPECIES_GENGAR");

    // Slot 1 (index 0, the lead) has NO Slot Probability field.
    expect(q('.ctr-slotchance[data-idx="0"]')).toBeNull();
    // Slot 2 (index 1) does.
    const sc = q('.ctr-slotchance[data-idx="1"]') as HTMLInputElement;
    expect(sc).not.toBeNull();
    sc.value = "50";
    ct.onCustomTrainerInput(sc);
    ct.onCustomTrainerChange(sc);
    expect(t.team[1].slotChance).toBe(50);
    // An out-of-range/blank entry normalizes back to 100.
    sc.value = "0";
    ct.onCustomTrainerInput(sc);
    expect(t.team[1].slotChance).toBe(100);
  });

  it("weight field renders, serializes (always written), and migrates a legacy spawnChance on load", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // The Weight input renders (replacing the old Spawn chance % field) at default 100.
    const w = q("#ctr-weight") as HTMLInputElement;
    expect(w).not.toBeNull();
    expect(Number(w.value)).toBe(100);
    // Old field is gone.
    expect(q("#ctr-spawnchance")).toBeNull();

    // Default weight 100 serializes as `weight` (always written); no spawnChance.
    let delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.weight).toBe(100);
    expect(delta.spawnChance).toBeUndefined();

    // Edit the weight; it serializes the new value.
    w.value = "250";
    ct.onCustomTrainerInput(w);
    ct.onCustomTrainerChange(w);
    expect(ct.ctr.current[key].weight).toBe(250);
    delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.weight).toBe(250);

    // Out-of-range/blank normalizes to >= 1 (0 -> 1).
    w.value = "0";
    ct.onCustomTrainerInput(w);
    expect(ct.ctr.current[key].weight).toBe(1);

    // Migration: a live entry carrying only a legacy spawnChance loads as weight.
    const migrated = ct.ctrLiveToEdit({
      id: 70099,
      name: "Legacy",
      trainerClass: "ACE_TRAINER",
      spawnChance: 40,
      team: [{ species: 25 }],
    });
    expect(migrated.weight).toBe(40);
    expect(migrated.spawnChance).toBeUndefined();
    // weight present wins over a co-present spawnChance.
    expect(
      ct.ctrLiveToEdit({
        id: 70098,
        name: "W",
        trainerClass: "ACE_TRAINER",
        weight: 7,
        spawnChance: 40,
        team: [{ species: 25 }],
      }).weight,
    ).toBe(7);
    // Neither present -> default 100.
    expect(
      ct.ctrLiveToEdit({ id: 70097, name: "N", trainerClass: "ACE_TRAINER", team: [{ species: 25 }] }).weight,
    ).toBe(100);
  });

  it("spawn density panel renders (no trainer needed), edits config, and serializes only when changed", () => {
    ct.setTab("customtrainers");
    ct.render();
    // The panel renders ABOVE the list, with no trainer selected.
    const chance = q("#ctr-density-chance") as HTMLInputElement;
    const window = q("#ctr-density-window") as HTMLInputElement;
    expect(chance).not.toBeNull();
    expect(window).not.toBeNull();
    expect(Number(chance.value)).toBe(25); // shipped default
    expect(Number(window.value)).toBe(10);

    // Untouched default == baseline -> no config delta (byte-clean).
    expect(ct.buildDeltas().deltas["custom-trainers-config"]).toBeUndefined();

    // Edit the per-window chance; state updates without a selected trainer.
    chance.value = "40";
    expect(ct.onCustomTrainerInput(chance)).toBe(true);
    expect(ct.ctrConfig.current.windowChancePct).toBe(40);
    // Edit the window size.
    window.value = "5";
    expect(ct.onCustomTrainerInput(window)).toBe(true);
    expect(ct.ctrConfig.current.windowSize).toBe(5);

    // Now it differs from baseline -> a whole-config delta is emitted.
    const cfg = ct.buildDeltas().deltas["custom-trainers-config"] as Record<string, number>;
    expect(cfg).toEqual({ windowSize: 5, windowChancePct: 40 });

    // Out-of-range normalizes: chance 200 -> 25, window 0 -> 10.
    chance.value = "200";
    ct.onCustomTrainerInput(chance);
    expect(ct.ctrConfig.current.windowChancePct).toBe(25);
    window.value = "0";
    ct.onCustomTrainerInput(window);
    expect(ct.ctrConfig.current.windowSize).toBe(10);

    // 0% chance is a VALID, distinct value (disables custom trainers) and serializes.
    chance.value = "0";
    ct.onCustomTrainerInput(chance);
    expect(ct.ctrConfig.current.windowChancePct).toBe(0);
    const cfg2 = ct.buildDeltas().deltas["custom-trainers-config"] as Record<string, number>;
    expect(cfg2.windowChancePct).toBe(0);
  });

  // ---- MULTI-STAFF SAVE SAFETY (Batch A) -----------------------------------
  it("builds per-trainer baselines only for MODIFIED (loaded) trainers, not new ones or deletions", () => {
    // MOD existed at load (in CTR_LIVE); NEW is freshly created; DEL is a deletion.
    ct.CTR_LIVE = { MOD: { id: 70001, name: "Mod", trainerClass: "ACE_TRAINER", team: [{ species: 25 }] } };
    const delta = {
      MOD: { id: 70001, name: "Mod v2", trainerClass: "ACE_TRAINER", team: [{ species: 25 }] },
      NEW: { id: 70002, name: "New", trainerClass: "ACE_TRAINER", team: [{ species: 25 }] },
      DEL: null,
    };
    const baselines = ct.ctrBuildBaselines(delta);
    // Only MOD gets a baseline hash (of the LOADED CTR_LIVE version).
    expect(Object.keys(baselines)).toEqual(["MOD"]);
    expect(baselines.MOD).toBe(ct.hashCtrTrainerEntry(ct.CTR_LIVE.MOD));
    expect(baselines.NEW).toBeUndefined();
    expect(baselines.DEL).toBeUndefined();
  });

  it("applies the server id remap from a save response so the UI shows the real id (no reload)", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // The client minted a provisional id; the worker returns the real one.
    const delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.id).toBeGreaterThanOrEqual(70001);
    ct.markCustomTrainersSaved({ [key]: delta }, { idRemap: { [key]: 70123 }, conflicts: [] });
    // Local edit state now reflects the server id...
    expect(ct.ctr.current[key].id).toBe(70123);
    // ...its baseline is clean (not dirty) and CTR_LIVE advanced to the saved entry.
    expect(ct.ctr.baseline[key].id).toBe(70123);
    expect(ct.CTR_LIVE[key].id).toBe(70123);
    // Not dirty anymore: buildDeltas emits no custom-trainers change.
    expect(ct.buildDeltas().deltas["custom-trainers"]).toBeUndefined();
  });

  it("keeps a per-trainer CONFLICT dirty (baseline NOT advanced) while saving the rest", () => {
    // Two trainers both loaded + edited; the worker rejects CONFLICT, applies OK.
    ct.CTR_LIVE = {
      OK: { id: 70001, name: "Ok", trainerClass: "ACE_TRAINER", team: [{ species: 25 }] },
      CONFLICT: { id: 70002, name: "Clash", trainerClass: "ACE_TRAINER", team: [{ species: 25 }] },
    };
    ct.ctr.current = {
      OK: {
        id: 70001,
        name: "Ok v2",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [{ species: "SPECIES_PIKACHU" }],
      },
      CONFLICT: {
        id: 70002,
        name: "Clash MINE",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [{ species: "SPECIES_PIKACHU" }],
      },
    };
    // Baselines differ from current -> both start dirty.
    ct.ctr.baseline = {
      OK: {
        id: 70001,
        name: "Ok",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [{ species: "SPECIES_PIKACHU" }],
      },
      CONFLICT: {
        id: 70002,
        name: "Clash",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [{ species: "SPECIES_PIKACHU" }],
      },
    };
    const okDelta = { id: 70001, name: "Ok v2", trainerClass: "ACE_TRAINER", team: [{ species: 25 }] };
    const conflictDelta = { id: 70002, name: "Clash MINE", trainerClass: "ACE_TRAINER", team: [{ species: 25 }] };

    ct.markCustomTrainersSaved(
      { OK: okDelta, CONFLICT: conflictDelta },
      {
        idRemap: {},
        conflicts: [
          {
            key: "CONFLICT",
            error: "CONFLICT: modified by someone else since you loaded - reload to get their version",
          },
        ],
      },
    );

    // OK advanced to clean: baseline == current.
    expect(ct.ctr.baseline.OK).toEqual(ct.ctr.current.OK);
    expect(ct.CTR_LIVE.OK.name).toBe("Ok v2");
    // CONFLICT stays DIRTY: baseline is NOT advanced (still "Clash") and CTR_LIVE
    // is NOT updated, so the author can reload the teammate's version.
    expect(ct.ctr.baseline.CONFLICT.name).toBe("Clash");
    expect(ct.ctr.current.CONFLICT.name).toBe("Clash MINE");
    expect(ct.CTR_LIVE.CONFLICT.name).toBe("Clash");
  });

  it("RLA/RLNA are offered atop the datalist and exempt from the legality/unknown-move gate", () => {
    // Give Pikachu a legal pool so an ordinary illegal move (SURF) IS flagged,
    // proving the tokens are treated differently (never flagged).
    ct.egg.current.SPECIES_PIKACHU = ["THUNDERBOLT"];
    newTrainer();
    const key = ct.ctrSelected!;
    const t = ct.ctr.current[key];
    setSpecies(0, "SPECIES_PIKACHU");
    const m = t.team[0];

    // Move slot 0 -> RLA (exempt), slot 1 -> SURF (known but illegal), slot 2 -> THUNDERBOLT (legal).
    const setMove = (slot: number, val: string) => {
      const el = q(`.ctr-move[data-idx="0"][data-slot="${slot}"]`) as HTMLInputElement;
      el.value = val;
      ct.onCustomTrainerInput(el);
      return el;
    };
    const rlaEl = setMove(0, "RLA");
    expect(m.moves[0]).toBe("RLA");
    expect(rlaEl.style.borderColor).toBe(""); // token is not marked invalid
    setMove(1, "SURF");
    setMove(2, "THUNDERBOLT");
    ct.onCustomTrainerChange(rlaEl); // re-render (error line + datalist)

    // The tokens are legal; SURF is not.
    expect(ct.ctrIsMoveToken("rla")).toBe(true);
    expect(ct.ctrIsMoveToken("RLNA")).toBe(true);
    expect(ct.ctrMoveIllegal(m, "RLA")).toBe(false);
    expect(ct.ctrMoveIllegal(m, "RLNA")).toBe(false);
    expect(ct.ctrMoveIllegal(m, "SURF")).toBe(true);

    // The per-member datalist offers RLA + RLNA at the very top.
    const dl = q("#ctr-moves-0") as HTMLDataListElement;
    const opts = [...dl.querySelectorAll("option")].map(o => (o as HTMLOptionElement).value);
    expect(opts[0]).toBe("RLA");
    expect(opts[1]).toBe("RLNA");

    // Save gate: SURF trips an illegal-move error, RLA/RLNA never do.
    const { bad } = ct.buildDeltas();
    expect(bad.some(b => /SURF/.test(b))).toBe(true);
    expect(bad.some(b => /\bRLA\b|\bRLNA\b/.test(b))).toBe(false);
  });

  it("move legality: numeric learnset -> enum keys (learned move passes); two-word input normalizes; nonsense flagged; RLA/RLNA exempt", () => {
    // moves-rich ships DISPLAY names keyed by numeric move id; learnsets/tm are
    // numeric-id keyed. The bug: legalMovesFor held the DISPLAY names, so NOTHING
    // ever matched the enum-name inputs. Seed the real shapes to prove the fix.
    ct.moveById.set(58, { id: 58, name: "Ice Beam" });
    ct.moveById.set(85, { id: 85, name: "Thunderbolt" });
    ct.MOVE_SET.add("ICE_BEAM");
    ct.MOVE_SET.add("THUNDERBOLT");
    ct.learn.current.SPECIES_PIKACHU = [[1, 58]]; // Pikachu's level-up learns Ice Beam
    ct.tms.current.SPECIES_PIKACHU = [85]; // TM: Thunderbolt
    ct.legalMovesCache.clear();

    // The legal pool is now ENUM KEYS, not the display names (the root-cause fix).
    const pool = ct.legalMovesFor("SPECIES_PIKACHU");
    expect(pool.has("ICE_BEAM")).toBe(true);
    expect(pool.has("THUNDERBOLT")).toBe(true);
    expect(pool.has("Ice Beam")).toBe(false); // never the raw display name

    // moveNameToEnumKey is the single normalization both sides use.
    expect(ct.moveNameToEnumKey("Ice Beam")).toBe("ICE_BEAM");
    expect(ct.moveNameToEnumKey("ice beam")).toBe("ICE_BEAM");
    expect(ct.moveNameToEnumKey("THUNDERBOLT")).toBe("THUNDERBOLT");

    newTrainer();
    const key = ct.ctrSelected!;
    const t = ct.ctr.current[key];
    setSpecies(0, "SPECIES_PIKACHU");
    const m = t.team[0];
    expect(m.sanityOff).toBe(false); // enforcement ON (default)

    const typeMove = (slot: number, val: string) => {
      const el = q(`.ctr-move[data-idx="0"][data-slot="${slot}"]`) as HTMLInputElement;
      el.value = val;
      ct.onCustomTrainerInput(el);
      return el;
    };

    // Sanity ON: typing a LOWERCASE TWO-WORD move normalizes to ICE_BEAM (spaces ->
    // "_"), then PASSES legality. Before the fix it kept "ICE BEAM" and was flagged.
    const el0 = typeMove(0, "ice beam");
    expect(el0.value).toBe("ICE_BEAM");
    expect(m.moves[0]).toBe("ICE_BEAM");
    expect(el0.style.borderColor).toBe(""); // legal -> no red border
    expect(ct.ctrMoveIllegal(m, "ICE_BEAM")).toBe(false);
    expect(ct.ctrMoveIllegal(m, "THUNDERBOLT")).toBe(false); // TM move also legal

    // A nonsense move IS flagged (pool is non-empty, so enforcement is live).
    expect(ct.ctrMoveIllegal(m, "NONSENSE_MOVE")).toBe(true);

    // RLA/RLNA remain exempt even with sanity ON.
    expect(ct.ctrMoveIllegal(m, "RLA")).toBe(false);
    expect(ct.ctrMoveIllegal(m, "RLNA")).toBe(false);
  });

  it("save payload: 1 possibility -> flat member; >1 -> variants array; slotChance serialized", () => {
    const key = newTrainer();
    // Slot 1 (index 0): flat Snorlax.
    setSpecies(0, "SPECIES_SNORLAX");
    // Slot 2 (index 1): weighted [Gengar 30, Pikachu 70] + slotChance 50.
    ct.onCustomTrainerClick({ target: q("#ctr-add-member")! });
    setSpecies(1, "SPECIES_GENGAR");
    const cb = q('.ctr-weighted[data-idx="1"]') as HTMLInputElement;
    cb.checked = true;
    ct.onCustomTrainerChange(cb);
    // Gengar is possibility 1 (weight 30); add Pikachu as possibility 2 (weight 70).
    const w1 = q('.ctr-var-weight[data-idx="1"]') as HTMLInputElement;
    w1.value = "30";
    ct.onCustomTrainerInput(w1);
    ct.onCustomTrainerChange(w1);
    ct.onCustomTrainerClick({ target: q('.ctr-var-add[data-idx="1"]')! });
    setSpecies(1, "SPECIES_PIKACHU");
    const w2 = q('.ctr-var-weight[data-idx="1"]') as HTMLInputElement;
    w2.value = "70";
    ct.onCustomTrainerInput(w2);
    ct.onCustomTrainerChange(w2);
    const sc = q('.ctr-slotchance[data-idx="1"]') as HTMLInputElement;
    sc.value = "50";
    ct.onCustomTrainerInput(sc);
    ct.onCustomTrainerChange(sc);

    const { deltas, bad } = ct.buildDeltas();
    expect(bad).toEqual([]);
    const team = (deltas["custom-trainers"] as Record<string, any>)[key].team;
    expect(team.length).toBe(2);

    // Slot 1 -> FLAT member (species by numeric id), no variants/slotChance.
    expect(team[0].species).toBe(143);
    expect(team[0].variants).toBeUndefined();
    expect(team[0].slotChance).toBeUndefined();

    // Slot 2 -> VARIANTS array (Gengar 30 / Pikachu 70) + slotChance 50.
    expect(team[1].species).toBeUndefined();
    expect(Array.isArray(team[1].variants)).toBe(true);
    expect(team[1].variants.map((v: any) => [v.species, v.weight])).toEqual([
      [94, 30],
      [25, 70],
    ]);
    expect(team[1].slotChance).toBe(50);

    // A slotChance of 100 (default) is OMITTED (flat members stay byte-clean).
    sc.value = "100";
    ct.onCustomTrainerInput(sc);
    ct.onCustomTrainerChange(sc);
    const again = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].team;
    expect(again[1].slotChance).toBeUndefined();
  });

  it("gender picker shows only for a gendered class; selecting F serializes gender:'f'", () => {
    const key = newTrainer();
    const t = ct.ctr.current[key];
    setSpecies(0, "SPECIES_PIKACHU");
    // ACE_TRAINER has gendered sprites -> the M/F radio renders, default "m".
    expect(t.trainerClass).toBe("ACE_TRAINER");
    expect(q(".ctr-gender-radio")).not.toBeNull();
    expect(t.gender).toBe("m");
    // Default "m" is byte-clean: no gender field serialized.
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].gender).toBeUndefined();

    // Pick F -> the trainer fields the female variant; it serializes as gender:'f'.
    const fRadio = q('.ctr-gender-radio[value="f"]') as HTMLInputElement;
    fRadio.checked = true;
    ct.onCustomTrainerChange(fRadio);
    expect(t.gender).toBe("f");
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].gender).toBe("f");

    // Switch to a SINGLE-sprite class (HIKER) -> the gender picker disappears and
    // gender never serializes (no gendered sprite to pick).
    const classInput = q("#ctr-class") as HTMLInputElement;
    classInput.value = "HIKER";
    ct.onCustomTrainerChange(classInput);
    expect(q(".ctr-gender-radio")).toBeNull();
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].gender).toBeUndefined();
  });

  it("shiny picker: per-category selects render, swatch shows, and payload serializes", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    const t = ct.ctr.current[key];
    // The three category selects render for the (open) member.
    expect(q('.ctr-shiny-sel[data-cat="palette"][data-idx="0"]')).not.toBeNull();
    expect(q('.ctr-shiny-sel[data-cat="surface"][data-idx="0"]')).not.toBeNull();
    expect(q('.ctr-shiny-sel[data-cat="around"][data-idx="0"]')).not.toBeNull();
    // No effect yet -> nothing serialized.
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].team[0].shiny).toBeUndefined();

    // Pick a palette + aura effect and a name prefix.
    const pal = q('.ctr-shiny-sel[data-cat="palette"][data-idx="0"]') as HTMLSelectElement;
    pal.value = "inferno";
    ct.onCustomTrainerChange(pal);
    const aura = q('.ctr-shiny-sel[data-cat="around"][data-idx="0"]') as HTMLSelectElement;
    aura.value = "zaps";
    ct.onCustomTrainerChange(aura);
    expect(t.team[0].shiny.palette).toBe("inferno");
    expect(t.team[0].shiny.around).toBe("zaps");
    // The swatch chips render (one per active category).
    expect(q(".ctr-shiny-swatch")).not.toBeNull();
    expect([...q(".ctr-shiny-swatch")!.querySelectorAll(".ctr-shiny-dot")].length).toBe(2);

    const nameInput = q('.ctr-shiny-name[data-idx="0"]') as HTMLInputElement;
    nameInput.value = "Prism";
    ct.onCustomTrainerInput(nameInput);

    // Payload: only the picked categories + trimmed name; surface omitted.
    const shiny = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].team[0].shiny;
    expect(shiny).toEqual({ palette: "inferno", around: "zaps", name: "Prism" });
    expect(shiny.surface).toBeUndefined();

    // Clearing all effects drops the shiny field entirely.
    pal.value = "";
    ct.onCustomTrainerChange(pal);
    aura.value = "";
    ct.onCustomTrainerChange(aura);
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].team[0].shiny).toBeUndefined();
  });

  it("intro blurb: one-line input serializes trimmed + 200-capped, omitted when empty", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // The Identity intro input renders.
    const intro = q("#ctr-intro") as HTMLInputElement;
    expect(intro).not.toBeNull();
    // Empty -> not serialized.
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].introDialogue).toBeUndefined();

    intro.value = "  You dare challenge me?  ";
    ct.onCustomTrainerInput(intro);
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].introDialogue).toBe(
      "You dare challenge me?",
    );

    // A 250-char blurb caps to 200 in the payload.
    intro.value = "a".repeat(250);
    ct.onCustomTrainerInput(intro);
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].introDialogue.length).toBe(200);
  });

  it("victory/defeat lines + sprite-effect picker render, edit and serialize (omitted when empty)", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // The Identity victory/defeat inputs + the sprite-effect select all render.
    const victory = q("#ctr-victory") as HTMLInputElement;
    const defeat = q("#ctr-defeat") as HTMLInputElement;
    const effect = q("#ctr-effect") as HTMLSelectElement;
    expect(victory).not.toBeNull();
    expect(defeat).not.toBeNull();
    expect(effect).not.toBeNull();
    // The effect picker offers "(none)" + the seeded auras.
    const opts = [...effect.querySelectorAll("option")].map(o => (o as HTMLOptionElement).value);
    expect(opts[0]).toBe(""); // "(none)"
    expect(opts).toContain("smoke");
    expect(opts).toContain("shadowaura");

    // Empty -> none of the three fields serialize.
    let delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.victoryDialogue).toBeUndefined();
    expect(delta.defeatDialogue).toBeUndefined();
    expect(delta.trainerEffect).toBeUndefined();

    // Fill victory + defeat (trimmed) and pick an aura.
    victory.value = "  Well fought.  ";
    ct.onCustomTrainerInput(victory);
    defeat.value = "  Better luck next time!  ";
    ct.onCustomTrainerInput(defeat);
    effect.value = "shadowaura";
    ct.onCustomTrainerChange(effect);
    const t = ct.ctr.current[key];
    expect(t.trainerEffect).toBe("shadowaura");

    delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.victoryDialogue).toBe("Well fought.");
    expect(delta.defeatDialogue).toBe("Better luck next time!");
    expect(delta.trainerEffect).toBe("shadowaura");

    // The preview panel shows the effect swatch (one dot for the picked aura).
    expect(q(".ctr-preview-effect")).not.toBeNull();
    expect(q(".ctr-preview-effect .ctr-shiny-dot")).not.toBeNull();

    // An unknown aura id normalizes away (never serialized).
    effect.value = "notarealaura";
    ct.onCustomTrainerChange(effect);
    expect(ct.ctr.current[key].trainerEffect).toBe("");
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].trainerEffect).toBeUndefined();

    // A 250-char victory line caps to 200 in the payload.
    victory.value = "z".repeat(250);
    ct.onCustomTrainerInput(victory);
    expect((ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key].victoryDialogue.length).toBe(200);
  });

  it("clone trainer: deep-copies the whole trainer as a NEW entry (fresh id/key, name + ' (copy)')", () => {
    const key = newTrainer("Ace Rico");
    const src = ct.ctr.current[key];
    setSpecies(0, "SPECIES_PIKACHU");
    // Give it some content to prove a DEEP copy (a 2nd member + a challenge).
    ct.onCustomTrainerClick({ target: q("#ctr-add-member")! });
    setSpecies(1, "SPECIES_SNORLAX");
    src.challenge = "monotype";
    src.challengeValue = 10;
    ct.render();

    const beforeKeys = Object.keys(ct.ctr.current);
    // The Clone button renders next to Delete.
    const cloneBtn = q("#ctr-clone");
    expect(cloneBtn).not.toBeNull();
    ct.onCustomTrainerClick({ target: cloneBtn! });

    // A brand-new entry was added and is now selected.
    const afterKeys = Object.keys(ct.ctr.current);
    expect(afterKeys.length).toBe(beforeKeys.length + 1);
    const newKey = ct.ctrSelected!;
    expect(newKey).not.toBe(key);
    const clone = ct.ctr.current[newKey];

    // Fresh provisional id (different, still in the 70000 band) + suffixed name.
    expect(clone.id).not.toBe(src.id);
    expect(clone.id).toBeGreaterThanOrEqual(70001);
    expect(clone.name).toBe("Ace Rico (copy)");
    // Deep-copied content: same team + challenge, but a SEPARATE object graph.
    expect(clone.team.length).toBe(2);
    expect(clone.team[0].species).toBe("SPECIES_PIKACHU");
    expect(clone.team[1].species).toBe("SPECIES_SNORLAX");
    expect(clone.challenge).toBe("monotype");
    expect(clone.challengeValue).toBe(10);
    expect(clone).not.toBe(src);
    expect(clone.team).not.toBe(src.team);
    // Editing the clone must not mutate the source (proves the deep copy).
    clone.team[0].species = "SPECIES_RAICHU";
    expect(src.team[0].species).toBe("SPECIES_PIKACHU");

    // The clone is a NEW (never-loaded) entry, so it serializes with its fresh id
    // and the server assigns the real id/key on save (no baseline for it).
    const delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[newKey];
    expect(delta).toBeDefined();
    expect(delta.id).toBe(clone.id);
    expect(delta.name).toBe("Ace Rico (copy)");

    // The long-name case caps to 24 chars while preserving the " (copy)" suffix.
    newTrainer("A Very Very Long Trainer Name");
    setSpecies(0, "SPECIES_PIKACHU");
    ct.render();
    ct.onCustomTrainerClick({ target: q("#ctr-clone")! });
    const longClone = ct.ctr.current[ct.ctrSelected!];
    expect(longClone.name.length).toBeLessThanOrEqual(24);
    expect(longClone.name.endsWith(" (copy)")).toBe(true);
  });

  it("fusion move-pool union: a move legal only on the fusion partner is NOT flagged illegal", () => {
    // Base Pikachu learns THUNDERBOLT; fusion partner Machamp learns CROSS_CHOP.
    // A fused member can legally know EITHER (union), so CROSS_CHOP must pass on
    // the fused member but be flagged on the non-fused one.
    ct.moveById.set(85, { id: 85, name: "Thunderbolt" });
    ct.moveById.set(238, { id: 238, name: "Cross Chop" });
    ct.MOVE_SET.add("THUNDERBOLT");
    ct.MOVE_SET.add("CROSS_CHOP");
    ct.learn.current.SPECIES_PIKACHU = [[1, 85]]; // Pikachu -> Thunderbolt
    ct.learn.current.SPECIES_MACHAMP = [[1, 238]]; // Machamp -> Cross Chop
    ct.legalMovesCache.clear();
    addSpecies("SPECIES_MACHAMP", 68, "Machamp");

    const key = newTrainer();
    const t = ct.ctr.current[key];
    setSpecies(0, "SPECIES_PIKACHU");
    const m = t.team[0];

    // Non-fused: CROSS_CHOP (Machamp-only) is illegal; THUNDERBOLT is legal.
    expect(ct.ctrMoveIllegal(m, "CROSS_CHOP")).toBe(true);
    expect(ct.ctrMoveIllegal(m, "THUNDERBOLT")).toBe(false);

    // Fuse with Machamp -> the union now covers CROSS_CHOP too (no longer illegal),
    // and the base's THUNDERBOLT stays legal.
    const fusOn = q('.ctr-fusion-on[data-idx="0"]') as HTMLInputElement;
    fusOn.checked = true;
    ct.onCustomTrainerChange(fusOn);
    const fusSp = q('.ctr-fusion-species[data-idx="0"]') as HTMLInputElement;
    fusSp.value = "SPECIES_MACHAMP";
    ct.onCustomTrainerInput(fusSp);
    ct.onCustomTrainerChange(fusSp);
    expect(m.fusion.species).toBe("SPECIES_MACHAMP");
    expect(ct.ctrMoveIllegal(m, "CROSS_CHOP")).toBe(false); // fusion-partner move now legal
    expect(ct.ctrMoveIllegal(m, "THUNDERBOLT")).toBe(false); // base move still legal
    // A move on NEITHER species is still flagged.
    expect(ct.ctrMoveIllegal(m, "SURF")).toBe(true);
  });

  it("copy member: into a slot (first empty / new) and as a new possibility (weight 100, auto-weighted)", () => {
    const key = newTrainer();
    const t = ct.ctr.current[key];
    setSpecies(0, "SPECIES_PIKACHU");
    // Give the lead a distinctive moveset so we can prove a DEEP clone.
    const mv0 = q('.ctr-move[data-idx="0"][data-slot="0"]') as HTMLInputElement;
    mv0.value = "THUNDERBOLT";
    ct.onCustomTrainerInput(mv0);

    // The Copy picker renders on the member.
    const copy = q('.ctr-copy[data-idx="0"]') as HTMLSelectElement;
    expect(copy).not.toBeNull();

    // --- Target A: copy into a slot. The blank trainer has only the lead, so the
    // copy appends as a NEW slot (no other empty slot exists).
    copy.value = "slot:auto";
    ct.onCustomTrainerChange(copy);
    expect(t.team.length).toBe(2);
    // Slot 2 is a deep clone of the lead (species + moves), a SEPARATE object.
    expect(t.team[1].species).toBe("SPECIES_PIKACHU");
    expect(t.team[1].moves[0]).toBe("THUNDERBOLT");
    expect(t.team[1]).not.toBe(t.team[0]);
    t.team[1].species = "SPECIES_RAICHU"; // mutating the copy must not touch the source
    expect(t.team[0].species).toBe("SPECIES_PIKACHU");
    t.team[1].species = "SPECIES_PIKACHU";

    // --- Target B: copy the lead AS A NEW POSSIBILITY of slot 2. Slot 2 becomes a
    // weighted slot with a 2nd possibility at weight 100.
    ct.render();
    const copy0 = q('.ctr-copy[data-idx="0"]') as HTMLSelectElement;
    copy0.value = "poss:1";
    ct.onCustomTrainerChange(copy0);
    expect(t.team[1].weighted).toBe(true);
    expect(t.team[1].variants.length).toBe(2);
    // The appended possibility is the deep-cloned lead at weight 100.
    const appended = t.team[1].variants[1];
    expect(appended.species).toBe("SPECIES_PIKACHU");
    expect(appended.moves[0]).toBe("THUNDERBOLT");
    expect(appended.weight).toBe(100);

    // --- Slot target when an EMPTY slot exists: fills it rather than appending.
    // Add a blank 3rd member, then copy the lead into the first empty slot.
    ct.onCustomTrainerClick({ target: q("#ctr-add-member")! });
    expect(t.team.length).toBe(3);
    expect(t.team[2].species).toBe(""); // blank/empty
    ct.render();
    const copyLead = q('.ctr-copy[data-idx="0"]') as HTMLSelectElement;
    copyLead.value = "slot:auto";
    ct.onCustomTrainerChange(copyLead);
    // Filled the empty slot 3 (no new slot appended).
    expect(t.team.length).toBe(3);
    expect(t.team[2].species).toBe("SPECIES_PIKACHU");
    expect(t.team[2].moves[0]).toBe("THUNDERBOLT");
  });

  it("named challenge preset picker sets the challenge + value fields and serializes", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // The preset picker is a SEPARATE select from the main challenge dropdown.
    const preset = q("#ctr-challenge-preset") as HTMLSelectElement;
    expect(preset).not.toBeNull();
    expect(q("#ctr-challenge")).not.toBeNull();
    expect(preset).not.toBe(q("#ctr-challenge")); // distinct controls
    // It offers the seeded presets grouped by kind (optgroups) + a placeholder.
    expect(preset.querySelector("option")!.getAttribute("value")).toBe(""); // placeholder first
    expect([...preset.querySelectorAll("optgroup")].length).toBeGreaterThanOrEqual(2);
    const presetVals = [...preset.querySelectorAll("option")].map(o => (o as HTMLOptionElement).value);
    expect(presetVals).toContain("monotype:10"); // I Cast Fireball!
    expect(presetVals).toContain("monogen:10"); // Redux Means Redux

    // Pick "I Cast Fireball!" (monotype:10) -> both fields are set under the hood.
    preset.value = "monotype:10";
    ct.onCustomTrainerChange(preset);
    expect(ct.ctr.current[key].challenge).toBe("monotype");
    expect(ct.ctr.current[key].challengeValue).toBe(10);
    // The main dropdown + value dropdown now reflect it (single gating mechanism).
    expect((q("#ctr-challenge") as HTMLSelectElement).value).toBe("monotype");
    expect((q("#ctr-challenge-value") as HTMLSelectElement).value).toBe("10");
    let delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.challenge).toBe("monotype");
    expect(delta.challengeValue).toBe(10);

    // Applying a mono-gen preset re-points both fields.
    const preset2 = q("#ctr-challenge-preset") as HTMLSelectElement;
    preset2.value = "monogen:10";
    ct.onCustomTrainerChange(preset2);
    expect(ct.ctr.current[key].challenge).toBe("monogen");
    expect(ct.ctr.current[key].challengeValue).toBe(10);
    delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.challenge).toBe("monogen");
    expect(delta.challengeValue).toBe(10);
  });

  it("challenge value dropdown appears for parameterizable kinds, serializes, and clears otherwise", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // Default challenge is "none" -> no value dropdown.
    expect(q("#ctr-challenge-value")).toBeNull();
    let delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.challengeValue).toBeUndefined();

    // Pick a parameterizable challenge (mono-type) -> the value dropdown appears.
    const chall = q("#ctr-challenge") as HTMLSelectElement;
    chall.value = "monotype";
    ct.onCustomTrainerChange(chall);
    const valSel = q("#ctr-challenge-value") as HTMLSelectElement;
    expect(valSel).not.toBeNull();
    // The option list is the seeded mono-type values + a "(any value)" first entry.
    const optVals = [...valSel.querySelectorAll("option")].map(o => (o as HTMLOptionElement).value);
    expect(optVals[0]).toBe(""); // "(any value)"
    expect(optVals).toContain("10"); // Fire
    // Still unset -> not serialized (any value qualifies).
    delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.challenge).toBe("monotype");
    expect(delta.challengeValue).toBeUndefined();

    // Pick Fire (10) -> challengeValue serializes.
    valSel.value = "10";
    ct.onCustomTrainerChange(valSel);
    expect(ct.ctr.current[key].challengeValue).toBe(10);
    delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.challengeValue).toBe(10);

    // Switch to a NON-parameterizable challenge (inverse) -> dropdown gone AND the
    // stale value is dropped (never serialized under a valueless challenge).
    chall.value = "inverse";
    ct.onCustomTrainerChange(chall);
    expect(q("#ctr-challenge-value")).toBeNull();
    expect(ct.ctr.current[key].challengeValue).toBeNull();
    delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.challenge).toBe("inverse");
    expect(delta.challengeValue).toBeUndefined();

    // Back to mono-gen, pick the RDX pseudo-gen (10) -> serializes.
    chall.value = "monogen";
    ct.onCustomTrainerChange(chall);
    const valSel2 = q("#ctr-challenge-value") as HTMLSelectElement;
    valSel2.value = "10";
    ct.onCustomTrainerChange(valSel2);
    delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.challenge).toBe("monogen");
    expect(delta.challengeValue).toBe(10);
  });

  it("held-item picker is fed from the full grouped catalog (booster/berry/gem/utility)", () => {
    newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // Add a held-item row (the member is expanded by default) so the picker input
    // + its datalist render.
    ct.onCustomTrainerClick({ target: q('.ctr-held-add[data-idx="0"]')! });
    const input = q('.ctr-held-item[data-idx="0"][data-heldidx="0"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    // The input references the shared held-item datalist rendered in the section.
    expect(input.getAttribute("list")).toBe("helditems-list");
    const dl = q("#helditems-list") as HTMLDataListElement;
    expect(dl).not.toBeNull();
    const opts = [...dl.querySelectorAll("option")] as HTMLOptionElement[];
    const values = opts.map(o => o.value);
    // Every catalog key is offered, incl. the new type-booster / berry / gem keys.
    expect(values).toContain("CHARCOAL");
    expect(values).toContain("SITRUS_BERRY");
    expect(values).toContain("ER_FIRE_GEM");
    expect(values).toContain("LEFTOVERS");
    // Grouped: boosters come before berries before gems before utility.
    const firstIdx = k => values.indexOf(k);
    expect(firstIdx("CHARCOAL")).toBeLessThan(firstIdx("SITRUS_BERRY"));
    expect(firstIdx("SITRUS_BERRY")).toBeLessThan(firstIdx("ER_FIRE_GEM"));
    expect(firstIdx("ER_FIRE_GEM")).toBeLessThan(firstIdx("LEFTOVERS"));
    // Each option's text tags its category for at-a-glance grouping.
    const charcoal = opts.find(o => o.value === "CHARCOAL")!;
    expect(charcoal.textContent).toMatch(/booster/i);
    const berry = opts.find(o => o.value === "SITRUS_BERRY")!;
    expect(berry.textContent).toMatch(/berry/i);
  });

  it("dialogue fields are relabeled from the TRAINER's point of view (bindings unchanged)", () => {
    // The maintainer ruling: keep the JSON schema (victoryDialogue = trainer
    // defeated, defeatDialogue = trainer wins) but relabel the editor inputs so a
    // staff author can't confuse whose win it is. The input ids/bindings are the
    // SAME; only the labels change.
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // Both inputs still exist with their original ids (schema/binding unchanged).
    const winsInput = q("#ctr-defeat") as HTMLInputElement; // bound to defeatDialogue
    const defeatedInput = q("#ctr-victory") as HTMLInputElement; // bound to victoryDialogue
    expect(winsInput).not.toBeNull();
    expect(defeatedInput).not.toBeNull();
    // The visible <label> wrapping each input names the TRAINER's outcome.
    const winsLabel = winsInput.closest("label")!.textContent || "";
    const defeatedLabel = defeatedInput.closest("label")!.textContent || "";
    expect(winsLabel).toMatch(/trainer\s+WINS/i);
    expect(defeatedLabel).toMatch(/trainer\s+is\s+DEFEATED/i);

    // Typing into the WINS field still serializes as defeatDialogue (trainer wins);
    // the DEFEATED field still serializes as victoryDialogue (player wins).
    winsInput.value = "You never stood a chance.";
    ct.onCustomTrainerInput(winsInput);
    defeatedInput.value = "Impressive... you have earned this.";
    ct.onCustomTrainerInput(defeatedInput);
    const delta = (ct.buildDeltas().deltas["custom-trainers"] as Record<string, any>)[key];
    expect(delta.defeatDialogue).toBe("You never stood a chance."); // trainer wins
    expect(delta.victoryDialogue).toBe("Impressive... you have earned this."); // trainer defeated
  });

  it("clicking the readonly trainer Id field never clears the team (BUG regression)", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_SNORLAX");
    // Add a 2nd member so there is a team to (not) lose.
    ct.onCustomTrainerClick({ target: q("#ctr-add-member")! });
    setSpecies(1, "SPECIES_GENGAR");
    const teamBefore = ct.ctr.current[key].team.length;
    const markupBefore = win.document.querySelectorAll(".ctr-mem-sum").length;
    expect(teamBefore).toBe(2);

    // The Id field is a readonly TEXT input with an explicit id (no number spinner).
    const idEl = q("#ctr-id") as HTMLInputElement;
    expect(idEl).not.toBeNull();
    expect(idEl.type).toBe("text");
    expect(idEl.readOnly).toBe(true);

    // Drive click / input / change through the delegated ctr handlers: all inert.
    ct.onCustomTrainerClick({ target: idEl });
    ct.onCustomTrainerInput(idEl);
    ct.onCustomTrainerChange(idEl);

    // The selected trainer, its team, and the rendered team markup all survive.
    expect(ct.ctrSelected).toBe(key);
    expect(ct.ctr.current[key].team.length).toBe(teamBefore);
    ct.render();
    expect(win.document.querySelectorAll(".ctr-mem-sum").length).toBe(markupBefore);
  });

  it("fusion preview renders sprites + the generated fused name for a fused member", () => {
    newTrainer();
    const key = ct.ctrSelected!;
    const t = ct.ctr.current[key];
    setSpecies(0, "SPECIES_PIKACHU");
    // No fusion yet -> no preview.
    expect(q(".ctr-fusion-preview")).toBeNull();

    // Toggle fusion on, then set the fusion species.
    const fusOn = q('.ctr-fusion-on[data-idx="0"]') as HTMLInputElement;
    fusOn.checked = true;
    ct.onCustomTrainerChange(fusOn);
    const fusSp = q('.ctr-fusion-species[data-idx="0"]') as HTMLInputElement;
    fusSp.value = "SPECIES_RAICHU";
    ct.onCustomTrainerInput(fusSp);
    ct.onCustomTrainerChange(fusSp);
    expect(t.team[0].fusion.species).toBe("SPECIES_RAICHU");

    // The preview renders: two sprite <img>s + the game-generated fused name.
    const preview = q(".ctr-fusion-preview");
    expect(preview).not.toBeNull();
    expect(preview!.querySelectorAll("img").length).toBe(2);
    const expectedName = ct.ctrFusedName("Pikachu", "Raichu");
    expect(preview!.querySelector(".ctr-fusion-name")!.textContent).toContain(expectedName);
    // The fused-name derivation matches the game's fragment blend (deterministic).
    expect(expectedName).toBe(ct.ctrFusedName("Pikachu", "Raichu"));
    expect(expectedName.length).toBeGreaterThan(0);
  });

  it("two-column layout: form + sticky preview panel; panel tracks the focused member", () => {
    const key = newTrainer();
    setSpecies(0, "SPECIES_PIKACHU");
    // The two-column container + the right preview panel both render.
    expect(q(".ctr-layout")).not.toBeNull();
    expect(q(".ctr-layout-main")).not.toBeNull();
    const panel = q(".ctr-preview-panel");
    expect(panel).not.toBeNull();
    // The trainer-sprite preview moved INTO the panel (round-2 inline preview relocated).
    expect(panel!.querySelector("#ctr-sprite-preview")).not.toBeNull();
    // The panel's member section (slot header) shows the focused member (Pikachu)
    // + its species sprite. The section header text is "Slot N: <name>".
    const memberHeader = () => {
      const p = q(".ctr-preview-panel")!;
      return [...p.querySelectorAll(".ctr-preview-h")].map(h => h.textContent).find(x => /Slot \d/.test(x || "")) || "";
    };
    expect(memberHeader()).toContain("Pikachu");
    expect(panel!.querySelector(".ctr-preview-mon img")).not.toBeNull();

    // Add a 2nd member -> it becomes the focused one; the panel follows.
    ct.onCustomTrainerClick({ target: q("#ctr-add-member")! });
    setSpecies(1, "SPECIES_SNORLAX");
    expect(memberHeader()).toContain("Snorlax");

    // Clicking slot 1's summary refocuses the panel back to Pikachu.
    ct.onCustomTrainerClick({ target: q('.ctr-mem-sum[data-idx="0"]')! });
    expect(memberHeader()).toContain("Pikachu");
    expect(ct.ctrSelected).toBe(key);
  });

  it("list card shows the trainer sprite + one team-member icon per member (no 'Nmon' count)", () => {
    const key = newTrainer("Team Card");
    // 3-member team: Pikachu, Snorlax, Gengar.
    setSpecies(0, "SPECIES_PIKACHU");
    ct.onCustomTrainerClick({ target: q("#ctr-add-member")! });
    setSpecies(1, "SPECIES_SNORLAX");
    ct.onCustomTrainerClick({ target: q("#ctr-add-member")! });
    setSpecies(2, "SPECIES_GENGAR");
    ct.render();

    const card = q(`[data-ctropen="${key}"]`)!;
    expect(card).not.toBeNull();
    // Header still carries the name + #id.
    expect(card.querySelector(".ctr-card-head")!.textContent).toContain("Team Card");
    expect(card.querySelector(".ctr-card-head")!.textContent).toContain(`#${ct.ctr.current[key].id}`);
    // The old "Nmon" member COUNT is gone.
    expect(card.textContent).not.toMatch(/\dmon\b/);

    // One member ICON per team member, each an <img> (species resolved -> a sprite).
    const icons = card.querySelectorAll(".ctr-card-mon");
    expect(icons.length).toBe(3);
    expect(card.querySelectorAll(".ctr-card-mon img").length).toBe(3);
    // The trainer's own sprite node is present (ACE_TRAINER ships gendered sprites,
    // so it carries the atlas file to paint lazily).
    const sprite = card.querySelector(".ctr-card-sprite") as HTMLElement;
    expect(sprite).not.toBeNull();
    expect(sprite.dataset.ctrsprite).toBe("ace_trainer_m");

    // A WEIGHTED lead shows the FIRST possibility's icon (title carries its species).
    const cb = q('.ctr-weighted[data-idx="0"]') as HTMLInputElement;
    cb.checked = true;
    ct.onCustomTrainerChange(cb);
    ct.onCustomTrainerClick({ target: q('.ctr-var-add[data-idx="0"]')! });
    setSpecies(0, "SPECIES_RAICHU"); // 2nd possibility
    ct.render();
    const firstIcon = q(`[data-ctropen="${key}"] .ctr-card-mon`) as HTMLElement;
    expect(firstIcon.title).toBe("SPECIES_PIKACHU"); // possibility 0, not the edited cur
  });

  it("empty-species slot renders a neutral icon box with NO img (never a broken image)", () => {
    const key = newTrainer("Blank Slot");
    // Leave the lead's species empty (blank trainer default).
    ct.render();
    const card = q(`[data-ctropen="${key}"]`)!;
    const icons = card.querySelectorAll(".ctr-card-mon");
    expect(icons.length).toBe(1);
    // No <img> for an unresolvable species: the box stands in as the placeholder.
    expect(card.querySelectorAll(".ctr-card-mon img").length).toBe(0);
  });

  it("serializes a reusable uploaded sprite key without changing the trainer class", () => {
    ct.trainerSpriteByKey.set("staff_rival", {
      key: "staff_rival",
      spriteKey: "staff_rival",
      label: "Staff Rival",
      genders: false,
    });
    const key = newTrainer("Uploaded Art");
    setSpecies(0, "SPECIES_PIKACHU");
    ct.ctr.current[key].trainerClass = "HIKER";
    ct.ctr.current[key].trainerSprite = "staff_rival";

    const { deltas, bad } = ct.buildDeltas();
    const saved = (deltas["custom-trainers"] as Record<string, any>)[key];
    expect(bad).toEqual([]);
    expect(saved.trainerClass).toBe("HIKER");
    expect(saved.trainerSprite).toBe("staff_rival");
  });

  it("prior-surface smoke still holds: member collapse/expand + the battle-music picker render", () => {
    newTrainer();
    const key = ct.ctrSelected!;
    setSpecies(0, "SPECIES_PIKACHU");
    // Member 0 starts expanded (open) -> the species input is present.
    expect(q('.ctr-species[data-idx="0"]')).not.toBeNull();
    expect(ct.ctrOpenMembers.has(0)).toBe(true);
    // Click the collapsed-summary toggle -> collapses (species input gone).
    ct.onCustomTrainerClick({ target: q('.ctr-mem-sum[data-idx="0"]')! });
    expect(ct.ctrOpenMembers.has(0)).toBe(false);
    expect(q('.ctr-species[data-idx="0"]')).toBeNull();
    // The battle-music picker renders with a "(default)" option.
    const bgm = q("#ctr-bgm") as HTMLSelectElement;
    expect(bgm).not.toBeNull();
    expect([...bgm.querySelectorAll("option")].some(o => (o as HTMLOptionElement).value === "")).toBe(true);
    // The trainer is still the one we created.
    expect(ct.ctrSelected).toBe(key);
  });
});
