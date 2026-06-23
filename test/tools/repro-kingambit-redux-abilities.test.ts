/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO (Kingambit Redux ability editor bug): testers edit Kingambit Redux +
// its Mega's abilities on the editor site (writes er-species-abilities.json),
// but in-game the abilities are "glitchy" / unchangeable. Hypothesis: the Mega
// is a FORM under the base species, not a standalone allSpecies entry, so the
// pokedex-override applier (which mutates allSpecies entries only) silently
// skips SPECIES_KINGAMBIT_REDUX_MEGA. This dumps the resolution + live abilities
// so we can see exactly what the editor edit does (and doesn't) reach.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-kingambit-redux-abilities.test.ts

import { allAbilities, allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MEGA_FORMS } from "#data/elite-redux/er-mega-forms";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import speciesAbilitiesJson from "../../src/data/elite-redux/er-species-abilities.json";

const RUN = process.env.ER_SCENARIO === "1";
const abilityName = (id: number): string => allAbilities[id]?.name ?? `??MISSING(${id})`;

describe.skipIf(!RUN)("repro: Kingambit Redux + Mega ability overrides", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => g?.destroy(true));

  it("dumps how the editor ability edit resolves for the base + mega", async () => {
    const game = new GameManager(g);
    await game.classicMode.startBattle(SpeciesId_PIKACHU());

    const draftByConst = new Map<string, number>();
    for (const d of ER_SPECIES) {
      draftByConst.set(d.speciesConst, d.id);
    }
    const speciesIds = new Set(allSpecies.map(s => s.speciesId));

    for (const c of ["SPECIES_KINGAMBIT_REDUX", "SPECIES_KINGAMBIT_REDUX_MEGA"] as const) {
      const draftId = draftByConst.get(c);
      const pkrgId = draftId === undefined ? undefined : ER_ID_MAP.species[draftId];
      const inAllSpecies = pkrgId !== undefined && speciesIds.has(pkrgId);
      const edit = (
        speciesAbilitiesJson as Record<
          string,
          { ability1?: number; ability2?: number; hidden?: number; innates?: number[] }
        >
      )[c];
      console.log(`\n=== ${c} ===`);
      console.log(`  draftId=${draftId} -> pkrgId=${pkrgId}  | standalone allSpecies entry? ${inAllSpecies}`);
      if (edit) {
        console.log(
          `  EDITOR set: a1=${edit.ability1}:${abilityName(edit.ability1!)} a2=${edit.ability2}:${abilityName(edit.ability2!)} hidden=${edit.hidden}:${abilityName(edit.hidden!)} innates=[${(edit.innates ?? []).map(i => `${i}:${abilityName(i)}`).join(", ")}]`,
        );
      }
      if (pkrgId !== undefined && inAllSpecies) {
        const sp = getPokemonSpecies(pkrgId);
        const live = [sp.ability1, sp.ability2, sp.abilityHidden].map(a => `${a}:${abilityName(a)}`).join(" | ");
        const pass = sp
          .getPassiveAbilities()
          .map(a => `${a}:${abilityName(a)}`)
          .join(" | ");
        console.log(`  LIVE species abilities: ${live}`);
        console.log(`  LIVE species innates  : ${pass}`);
      } else {
        console.log("  -> NOT a standalone species; the override applier skips it (this is the bug for the Mega).");
      }
    }

    // Also dump the base species' MEGA FORM abilities (where a mega'd mon actually reads from).
    const baseDraft = draftByConst.get("SPECIES_KINGAMBIT_REDUX");
    const basePkrg = baseDraft === undefined ? undefined : ER_ID_MAP.species[baseDraft];
    if (basePkrg !== undefined && speciesIds.has(basePkrg)) {
      const base = getPokemonSpecies(basePkrg);
      const forms =
        (
          base as unknown as {
            forms?: { formKey?: string; ability1: number; ability2: number; abilityHidden: number }[];
          }
        ).forms ?? [];
      console.log(`\n=== ${"SPECIES_KINGAMBIT_REDUX"} forms (${forms.length}) ===`);
      forms.forEach((f, i) => {
        console.log(
          `  form[${i}] key="${f.formKey}" abilities: ${[f.ability1, f.ability2, f.abilityHidden].map(a => `${a}:${abilityName(a)}`).join(" | ")}`,
        );
      });

      // ---- Regression assertions: the editor edit MUST reach the live forms ----
      const editJson = speciesAbilitiesJson as Record<
        string,
        { ability1: number; ability2: number; hidden: number; innates: number[] }
      >;
      const baseEdit = editJson.SPECIES_KINGAMBIT_REDUX;
      const megaEdit = editJson.SPECIES_KINGAMBIT_REDUX_MEGA;
      const baseForm = forms.find(f => f.formKey === "") ?? forms[0];
      const megaIdx = forms.findIndex(f => f.formKey === "mega");
      const megaForm = forms[megaIdx];

      // Base form abilities (was shadowed by the form-level slots before the fix).
      expect([baseForm.ability1, baseForm.ability2, baseForm.abilityHidden]).toEqual([
        baseEdit.ability1,
        baseEdit.ability2,
        baseEdit.hidden,
      ]);
      // Mega FORM abilities (the editor's SPECIES_..._MEGA edit must reach this form).
      expect(megaForm, "mega form exists").toBeTruthy();
      expect([megaForm.ability1, megaForm.ability2, megaForm.abilityHidden]).toEqual([
        megaEdit.ability1,
        megaEdit.ability2,
        megaEdit.hidden,
      ]);
      // Mega FORM passives (form-level _passives win over the base species').
      const megaPassives = base.getPassiveAbilities(megaIdx);
      console.log(`  mega form passives: ${megaPassives.map(a => `${a}:${abilityName(a)}`).join(" | ")}`);
      expect([...megaPassives]).toEqual(megaEdit.innates);
    }
  }, 120_000);

  it("audits EVERY edited entry: which were affected by the form-shadowing bug", async () => {
    const game = new GameManager(g);
    await game.classicMode.startBattle(SpeciesId_PIKACHU());

    const draftByConst = new Map<string, number>();
    for (const d of ER_SPECIES) {
      draftByConst.set(d.speciesConst, d.id);
    }
    const megaTargetDrafts = new Map<number, string>(); // targetErId -> formKey
    for (const m of ER_MEGA_FORMS) {
      megaTargetDrafts.set(m.targetErId, m.formKey);
    }
    const speciesIds = new Set(allSpecies.map(s => s.speciesId));

    const megaForm: string[] = []; // edit lands on a mega/alt FORM (was hitting the phantom species)
    const baseMultiForm: string[] = []; // base const on a multi-form species (base form shadowed)
    const fine: string[] = []; // single-form species - worked before the fix

    for (const key of Object.keys(speciesAbilitiesJson as Record<string, unknown>)) {
      const draftId = draftByConst.get(key);
      const formKey = draftId === undefined ? undefined : megaTargetDrafts.get(draftId);
      if (formKey !== undefined) {
        megaForm.push(`${key} (form "${formKey}")`);
        continue;
      }
      const pkrgId = draftId === undefined ? undefined : ER_ID_MAP.species[draftId];
      const sp = pkrgId !== undefined && speciesIds.has(pkrgId) ? getPokemonSpecies(pkrgId) : undefined;
      const formCount = (sp as unknown as { forms?: unknown[] } | undefined)?.forms?.length ?? 0;
      if (formCount > 0) {
        baseMultiForm.push(`${key} (${formCount} forms)`);
      } else {
        fine.push(key);
      }
    }

    console.log(`\n===== EDITOR ABILITY ENTRIES: ${Object.keys(speciesAbilitiesJson as object).length} total =====`);
    console.log(
      `\nAFFECTED - mega/alt-form edits that the fix now routes to the base species' FORM (${megaForm.length}):`,
    );
    for (const s of megaForm.sort()) {
      console.log(`  ${s}`);
    }
    console.log(`\nAFFECTED - base edits on a MULTI-FORM species (base form was shadowed) (${baseMultiForm.length}):`);
    for (const s of baseMultiForm.sort()) {
      console.log(`  ${s}`);
    }
    console.log(`\nNOT affected - single-form species, edits already applied (${fine.length}):`);
    console.log(`  ${fine.sort().join(", ")}`);

    // Verify the multi-form propagation reached EVERY Sawsbuck seasonal form
    // (vanilla Sawsbuck = dex 586; 4 seasons, all sharing the edited ability set).
    const sawsEdit = (speciesAbilitiesJson as Record<string, { ability1: number; ability2: number; hidden: number }>)
      .SPECIES_SAWSBUCK;
    if (sawsEdit && speciesIds.has(586)) {
      const saws = getPokemonSpecies(586);
      const forms =
        (
          saws as unknown as {
            forms?: { formKey: string; ability1: number; ability2: number; abilityHidden: number }[];
          }
        ).forms ?? [];
      console.log(`\nSawsbuck forms (${forms.length}):`);
      for (const f of forms) {
        console.log(
          `  "${f.formKey}": ${[f.ability1, f.ability2, f.abilityHidden].map(a => `${a}:${abilityName(a)}`).join(" | ")}`,
        );
        expect([f.ability1, f.ability2, f.abilityHidden], `Sawsbuck form "${f.formKey}"`).toEqual([
          sawsEdit.ability1,
          sawsEdit.ability2,
          sawsEdit.hidden,
        ]);
      }
    }

    expect(true).toBe(true);
  }, 120_000);
});

// Avoid importing SpeciesId at module scope just for one literal.
function SpeciesId_PIKACHU(): number {
  // PIKACHU = 25
  return 25;
}
