import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { EvoLevelThresholdKind } from "#enums/evo-level-threshold-kind";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// DIAGNOSTIC (raw ids, ER-aware names): for every vanilla species with an
// injected "redux" FORM, what does ER say its REDUX line evolves into, and can
// our form-model mon actually reach it via pokemonEvolutions?
describe.skipIf(!RUN)("ER redux-line evolution audit (raw ids)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  const name = (id: number): string => {
    try {
      const sp = getPokemonSpecies(id as SpeciesId);
      return sp ? `${sp.name}#${id}` : `<?>#${id}`;
    } catch {
      return `<unresolvable>#${id}`;
    }
  };

  it("maps every redux line: ER redux-record evolutions vs reachable pokemonEvolutions edges", () => {
    const byConst = new Map(ER_SPECIES.map(d => [d.speciesConst, d]));
    let unreachable = 0;
    for (const draft of ER_SPECIES) {
      if (!draft.speciesConst.endsWith("_REDUX") || draft.speciesConst.split("_REDUX").length > 2) {
        continue;
      }
      const levelEvos = draft.evolutions.filter(e => e.kind === 0 || e.kind === 3 || e.kind === 4);
      if (levelEvos.length === 0) {
        continue;
      }
      const baseConst = draft.speciesConst.slice(0, -"_REDUX".length);
      const baseDraft = byConst.get(baseConst);
      if (!baseDraft) {
        continue;
      }
      const basePkrgId = ER_ID_MAP.species[baseDraft.id];
      if (basePkrgId === undefined) {
        continue;
      }
      const baseSp = allSpecies.find(s => s.speciesId === basePkrgId);
      if (!baseSp || !baseSp.forms.some(f => f.formKey === "redux")) {
        continue; // redux modeled as separate species or absent — not the form model
      }
      for (const evo of levelEvos) {
        const targetDraft = ER_SPECIES[evo.into];
        const targetPkrgId = targetDraft ? ER_ID_MAP.species[targetDraft.id] : undefined;
        const baseEdges = (pokemonEvolutions[basePkrgId] ?? []).map(e => e.speciesId as number);
        const reachable = targetPkrgId !== undefined && baseEdges.includes(targetPkrgId);
        // Is the target a "<EVOLVED>_REDUX" whose vanilla counterpart carries a redux FORM
        // (then the existing form-carry path already covers it)?
        let coveredByFormCarry = false;
        if (targetDraft?.speciesConst.endsWith("_REDUX")) {
          const evolvedBase = byConst.get(targetDraft.speciesConst.slice(0, -"_REDUX".length));
          const evolvedPkrgId = evolvedBase ? ER_ID_MAP.species[evolvedBase.id] : undefined;
          const evolvedSp = allSpecies.find(s => s.speciesId === evolvedPkrgId);
          coveredByFormCarry =
            !!evolvedSp
            && evolvedSp.forms.some(f => f.formKey === "redux")
            && baseEdges.includes(evolvedPkrgId as number);
        }
        const status = coveredByFormCarry ? "OK(form-carry)" : reachable ? "OK(direct edge)" : "UNREACHABLE";
        if (status === "UNREACHABLE") {
          unreachable++;
        }
        // biome-ignore lint/suspicious/noConsole: diagnostic
        console.log(
          `${status}  ${baseConst}(pkrg ${name(basePkrgId)}) --L${evo.requirement}--> ${targetDraft?.speciesConst ?? "?"} (pkrg ${targetPkrgId === undefined ? "?" : name(targetPkrgId)}) | base edges: [${baseEdges.map(name).join(", ")}]`,
        );
      }
    }
    // biome-ignore lint/suspicious/noConsole: diagnostic
    console.log(`TOTAL UNREACHABLE redux-line evolutions: ${unreachable}`);
    // REGRESSION GUARD: appendReduxFormEvolutions() must bridge every redux-line
    // evolution onto the vanilla base species (redux-gated). 15 lines were
    // unreachable before the fix (Psyduck→Shyduck, Cinccino→Frostuccino, …).
    expect(unreachable).toBe(0);
  });

  it("trainer-gen evolves a high-level Rockruff (never fields the base at L119)", () => {
    const sp = getPokemonSpecies(SpeciesId.ROCKRUFF);
    for (let i = 0; i < 8; i++) {
      const id = sp.getTrainerSpeciesForLevel(119, true, PartyMemberStrength.AVERAGE, EvoLevelThresholdKind.NORMAL);
      // biome-ignore lint/suspicious/noConsole: diagnostic
      console.log(`Rockruff@119 trainer-evo raw id=${id} name=${name(id as number)}`);
      expect(id, "L119 trainer Rockruff must evolve (Lycanroc family)").not.toBe(SpeciesId.ROCKRUFF);
    }
  });

  it("redux gating: Redux Psyduck evolves to Shyduck; normal Psyduck to Golduck only", async () => {
    await game.classicMode.runToSummon(SpeciesId.PSYDUCK);
    const psyduck = game.field.getPlayerPokemon();
    const edges = pokemonEvolutions[SpeciesId.PSYDUCK] ?? [];
    const reduxEdge = edges.find(e => e.preFormKey === "redux");
    const normalEdge = edges.find(e => e.preFormKey === "");
    expect(reduxEdge, "Psyduck must have a redux-gated edge (→ Shyduck)").toBeDefined();
    expect(normalEdge, "Psyduck's Golduck edge must be base-form-gated").toBeDefined();
    expect(getPokemonSpecies(reduxEdge?.speciesId as SpeciesId)?.name).toBe("Shyduck");
    expect(normalEdge?.speciesId).toBe(SpeciesId.GOLDUCK);

    // Form gating via validate(): base form matches only the normal edge,
    // redux form matches only the redux edge.
    psyduck.formIndex = 0;
    psyduck.level = 60;
    expect(normalEdge?.validate(psyduck)).toBe(true);
    expect(reduxEdge?.validate(psyduck)).toBe(false);

    const reduxIdx = psyduck.species.forms.findIndex(f => f.formKey === "redux");
    expect(reduxIdx, "Psyduck has a redux form").toBeGreaterThan(0);
    psyduck.formIndex = reduxIdx;
    expect(reduxEdge?.validate(psyduck)).toBe(true);
    expect(normalEdge?.validate(psyduck)).toBe(false);

    // And the evolve itself: Redux Psyduck becomes the SHYDUCK custom species.
    await psyduck.evolve(reduxEdge ?? null, psyduck.species);
    expect(psyduck.species.name).toBe("Shyduck");
  });
});
