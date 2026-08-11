import {
  buildMoodyDetailedRecapSections,
  buildMoodyMarkerSummaryRows,
  buildMoodyMoveStateLabels,
  buildMoodyMoveTileSuffix,
  buildMoodyRuntimeSummaryRows,
  type MoodyLivePresentationSnapshot,
} from "#ui/moody/moody-live-presentation";
import {
  buildPressureValveBoonTarget,
  buildPressureValveOperation,
  moodyNegativeSpaceEligibility,
} from "#ui/moody/moody-operation";
import { buildMoodyEnemyPanelRows } from "#ui/moody/moody-presentation";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.env.INIT_CWD ?? process.cwd();

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Moody operation contracts", () => {
  it("Pressure Valve persists exactly one Healing, Barrier, or PP selection", () => {
    const model = buildPressureValveOperation({ healing: "heal", barrier: "shield", pp: "restore" });
    expect(model).toMatchObject({ kind: "pressure-valve", minSelections: 1, maxSelections: 1, cancellable: false });
    expect(model.options.map(option => option.id)).toEqual(["healing", "barrier", "pp"]);
    expect(buildPressureValveBoonTarget(41, 2, ["barrier"])).toEqual({
      pokemonIds: [41],
      partySlots: [2],
      option: "barrier",
    });
    expect(buildPressureValveBoonTarget(41, 2, [])).toBeNull();
    expect(buildPressureValveBoonTarget(41, 2, ["healing", "pp"])).toBeNull();
    expect(buildPressureValveBoonTarget(41, 2, ["invalid"])).toBeNull();
  });

  it("Negative Space rejects structural moves and the last damaging move", () => {
    expect(
      moodyNegativeSpaceEligibility({ damaging: false, eligible: true, structural: true, usableDamagingMoveCount: 2 }),
    ).toEqual({
      eligible: false,
      reason: "Structural or otherwise ineligible move.",
    });
    expect(
      moodyNegativeSpaceEligibility({ damaging: true, eligible: true, usableDamagingMoveCount: 1 }).reason,
    ).toContain("last usable damaging");
    expect(moodyNegativeSpaceEligibility({ damaging: true, eligible: true, usableDamagingMoveCount: 2 })).toEqual({
      eligible: true,
    });
  });

  it("the shared operation result preserves selected IDs and reorder plans", () => {
    const handler = source("src/ui/moody/moody-choice-ui-handler.ts");
    expect(handler).toContain('action: "confirm"');
    expect(handler).toContain("selectedIds: [...this.operationSelected]");
    expect(handler).toContain("orderedIds: this.operationOptions.map");
    expect(handler).toMatch(/case Button\.(ACTION|SUBMIT)/);
    expect(handler).toMatch(/case Button\.(LEFT|RIGHT)/);
  });

  it("uses a compact lead forecast and the normal party screen for Borrowed Future reordering", () => {
    const handler = source("src/ui/moody/moody-choice-ui-handler.ts");
    const party = source("src/ui/handlers/party-ui-handler.ts");
    expect(handler).toContain("BORROWED_FUTURE_HEIGHT");
    expect(handler).toContain("addPokemonIcon");
    expect(handler).toContain("PartyUiMode.BORROWED_FUTURE_REORDER");
    expect(handler).toMatch(/case Button\.UP:[\s\S]*openBorrowedFutureReorder/);
    expect(party).toContain("cursor < this.borrowedFutureLeadCount");
    expect(party).toContain("Choose a lead to replace. Back when finished.");
  });
});

describe("Moody draft cadence wiring", () => {
  it("reuses the ability lane and replaces an occupied bar in hide-then-show order", () => {
    const phase = source("src/phases/show-moody-effect-phase.ts");
    expect(phase).toMatch(
      /if \(globalScene\.abilityBar\.isVisible\(\)\) \{[\s\S]*unshiftNew\("HideAbilityPhase"\);[\s\S]*unshiftPhase\(new ShowMoodyEffectPhase\(this\.cue\)\)/,
    );
    expect(source("src/ui/containers/ability-bar.ts")).toContain("showTrainerEffect");
  });

  it("renders and emits enemy-owned boon cues from the opposing trainer side", () => {
    const bar = source("src/ui/containers/ability-bar.ts");
    const adapter = source("src/data/elite-redux/moody/moody-scene-adapter.ts");
    const scenarios = source("src/dev-tools/test-suite/scenarios.ts");
    expect(bar).toContain("globalScene.currentBattle?.trainer?.getSprites().at(0)");
    expect(bar).toContain(".setFrame(source.frame.name)");
    expect(bar).toContain(".clearTint()");
    expect(bar).toContain("setTintFill(trainerEffectTint[kind])");
    expect(bar).toContain("trainerPortraitCropHeightRatio");
    expect(bar).toContain(".setCrop(cropX, cropY, cropWidth, cropHeight)");
    expect(bar).toContain("source.frame.realWidth");
    expect(bar).toContain("source.frame.realHeight");
    expect(bar).toContain("this.bringToTop(this.trainerPortrait)");
    expect(bar).not.toContain("TRAINER BOON");
    expect(bar).not.toContain("TRAINER CURSE");
    expect(adapter).toContain('getMoodyEffectFlyoutCue({ boons: loadout.boons, curses: [] }, effectId, "enemy")');
    expect(scenarios).toContain('label: "UI: Moody enemy trainer boon flyout"');
    expect(scenarios).not.toContain("showMoodyEnemyTrainerHarnessPortrait()");
    expect(scenarios).toContain('showTrainerEffect("Mithridatism II", "boon", "enemy")');
  });

  it("uses the shared concise delta formatter in the live boon cards", () => {
    const handler = source("src/ui/handlers/moody-boon-select-ui-handler.ts");
    expect(handler).toContain("moodyOfferDescription(offer, definition)");
    expect(handler).toContain("moodyOfferDeltaLines(offer, definition)");
    expect(handler).not.toContain("CURRENT - Rank I:");
  });

  it("opens with a boon and attaches a random curse only after the boon completes", () => {
    const starterPhase = source("src/phases/select-starter-phase.ts");
    expect(starterPhase).toContain("const completeOpeningDraft = () =>");
    expect(starterPhase).toContain("rollAndCommitMoodyCurse(");
    expect(starterPhase).toContain("showMoodyCurseReceived(curse)");
    expect(starterPhase).toMatch(/\.setOverlayMode\([^,]+, initialDraftWave, completeOpeningDraft\)/);
    expect(starterPhase).toContain(".catch(completeOpeningDraft)");
    expect(starterPhase).not.toContain("MOODY_CURSE_SELECT");
  });

  it("keeps MESSAGE in the overlay stack so the opening draft cannot return to a stale target picker", () => {
    const ui = source("src/ui/ui.ts");
    expect(ui).toContain("if (chainMode && !clear)");
    expect(ui).not.toContain("if (chainMode && this.mode && !clear)");
  });

  it("attaches the next random curse after every ten-wave boon draft", () => {
    const phase = source("src/phases/select-moody-boon-phase.ts");
    expect(phase).toContain("const completeDraft = () =>");
    expect(phase).toContain("rollAndCommitMoodyCurse(");
    expect(phase).toContain("showMoodyCurseReceived(curse)");
    expect(phase).toMatch(/setOverlayMode\([^,]+, this\.waveIndex, completeDraft\)\.catch\(completeDraft\)/);
  });

  it("requires confirmation on the post-draft curse report", () => {
    const ui = source("src/ui/ui.ts");
    const reportHandler = source("src/ui/moody/moody-section-report-ui-handler.ts");
    expect(ui).toContain('title: "CURSE RECEIVED"');
    expect(ui).toContain("requireConfirm: true");
    expect(reportHandler).toContain("if (this.config.requireConfirm)");
    expect(reportHandler).toContain("COMPACT_WINDOW_MIN_H");
    expect(reportHandler).toContain("Math.ceil(this.bodyText.displayHeight) + BODY_TOP + this.footerSpace");
    expect(reportHandler).toContain("this.reportWindow.setPosition(this.windowX, this.windowY).setSize");
  });

  it("derives the battle drawer wrapping from the usable panel width", () => {
    const hud = source("src/ui/moody/moody-battle-hud.ts");
    expect(hud).toContain("getMoodyBattleHudWrapCharacters(width)");
    expect(hud).toContain("(width - 14) / PANEL_TEXT_CHARACTER_WIDTH");
    expect(hud).not.toContain("(width - 14) / 4.5");
  });

  it("uses a names-first boon/curse accordion without internal trigger history", () => {
    const hud = source("src/ui/moody/moody-battle-hud.ts");
    const runtime = source("src/ui/moody/moody-runtime-ui.ts");
    expect(hud).toContain('title: "BOONS"');
    expect(hud).toContain('title: "CURSES"');
    expect(hud).toContain("expandedDetailId");
    expect(hud).toContain("expandedDetailId = details[selectedDetailIndex]?.id ?? null");
    expect(runtime).not.toContain('title: "RECENT TRIGGER"');
    expect(runtime).not.toContain("...trackers.map(tracker => ({");
  });

  it("labels Borrowed Future commitments as moves", () => {
    const handler = source("src/ui/moody/moody-choice-ui-handler.ts");
    expect(handler).toContain("`MOVE: ${action.action}`");
  });

  it("keeps the collapsed battle drawer compact while retaining a larger touch target", () => {
    const hud = source("src/ui/moody/moody-battle-hud.ts");
    expect(hud).toContain("const TAB_WIDTH = 10");
    expect(hud).toContain("const TAB_HEIGHT = 8");
    expect(hud).toContain("const TAB_HIT_WIDTH = 16");
    expect(hud).toContain("const TAB_HIT_HEIGHT = 12");
  });

  it("cannot spin forever when a missing atlas leaves the fainting battler on a static placeholder", () => {
    const pokemon = source("src/field/pokemon.ts");
    expect(pokemon.match(/Number\.isFinite\(msPerFrame\) && msPerFrame > 0/g)).toHaveLength(2);
  });
});

describe("Moody live move, stack, marker, and recap projection", () => {
  const snapshot: MoodyLivePresentationSnapshot = {
    pokemon: [
      {
        pokemonId: 7,
        temporaryAbilities: [
          {
            abilityId: 1,
            name: "Carousel",
            description: "Temporary fifth ability.",
            sourceLabel: "Ability Carousel",
            carousel: true,
          },
        ],
        moves: [
          {
            pokemonId: 7,
            moveId: 33,
            temporary: true,
            sealed: true,
            ppCost: 3,
            overdraftHpPercent: 10,
            overdraftPowerPercent: 25,
            refrainCount: 2,
            guaranteedSecondary: true,
            cannotMiss: true,
            sourceLabel: "Final Draft",
            originalMoveName: "Tackle",
          },
        ],
        itemStacks: [
          {
            stackId: "vitamin",
            name: "Calcium",
            count: 8,
            attachedEffects: ["Heirloom"],
            setLabel: "Pantry",
            setProgress: "2/3",
            amplificationLabel: "+50%",
            disabled: true,
            disabledReason: "Cursed Inventory",
          },
        ],
        barrier: 40,
        damageDebt: 20,
        debtDueLabel: "due in 1 turn",
        revivalCharges: 2,
        revivalLabel: "APEX",
        modifiers: [{ label: "Damage", value: "+20%", sourceLabel: "Chosen One" }],
      },
    ],
    trackers: [{ id: "cadence", label: "Avalanche", value: "3/5", pokemonId: 7 }],
    curseMarkers: [
      { id: "mark", label: "Blood Mark", detail: "Pays the next debt.", pokemonId: 7, urgency: "critical" },
    ],
    recap: {
      selectedCurse: "Fog of War",
      mostTriggered: ["Chosen One - 18"],
      completedBounties: ["Type Mosaic"],
      highestGlory: 12,
      flawlessLedgerProgress: "7 upgrades",
      mostUsedPokemon: "Eevee",
      majorCurseEvents: ["Blood Moon revived the boss"],
      replayId: "RUN-1",
    },
  };

  it("covers every required move state in tiles and details", () => {
    const move = snapshot.pokemon![0].moves![0];
    const labels = buildMoodyMoveStateLabels(move);
    expect(labels.join(" | ")).toContain("TEMP");
    expect(labels).toContain("SEALED");
    expect(labels).toContain("PP COST 3");
    expect(labels.join(" | ")).toContain("OVERDRAFT");
    expect(labels).toContain("REFRAIN x2");
    expect(labels).toContain("SECONDARY GUARANTEED");
    expect(labels).toContain("CANNOT MISS");
    expect(labels).toContain("REPLACES: Tackle");
    expect(labels).toContain("SOURCE: Final Draft");
    expect(buildMoodyMoveTileSuffix(move)).toContain("[T X P3 O R2 S !]");
  });

  it("projects Carousel, vitamins/items, barriers, debt, APEX, modifiers, cadence, and curse markers", () => {
    const rows = [...buildMoodyRuntimeSummaryRows(snapshot.pokemon![0]), ...buildMoodyMarkerSummaryRows(snapshot, 7)];
    const text = rows.map(row => `${row.label}\n${row.detail}`).join("\n");
    for (const required of [
      "ABILITY 5",
      "Calcium x8",
      "DISABLED",
      "BARRIER",
      "DAMAGE DEBT",
      "APEX",
      "Chosen One",
      "Avalanche",
      "Blood Mark",
    ]) {
      expect(text, required).toContain(required);
    }
  });

  it("builds the detailed end-run recap without dropping requested fields", () => {
    const text = buildMoodyDetailedRecapSections([], snapshot.recap)
      .flatMap(section => section.lines)
      .join("\n");
    for (const required of [
      "Fog of War",
      "Chosen One - 18",
      "Type Mosaic",
      "12",
      "7 upgrades",
      "Eevee",
      "Blood Moon",
      "RUN-1",
    ]) {
      expect(text, required).toContain(required);
    }
  });
});

describe("Moody production reachability and eight-slot limits", () => {
  it("renders an explicit eight-Pokemon enemy roster without revealing reserves", () => {
    const rows = buildMoodyEnemyPanelRows([], { rosterSize: 8, hiddenReserves: true });
    expect(rows.filter(row => row.kind === "slot")).toHaveLength(8);
    expect(
      rows
        .filter(row => row.kind === "slot")
        .slice(1)
        .every(row => row.label.includes("Unknown reserve")),
    ).toBe(true);
  });

  it("keeps all interactive operations production-callable through the registered choice mode", () => {
    const ui = source("src/ui/ui.ts");
    for (const method of [
      "requestMoodyRecycler",
      "showMoodyBountyBoard",
      "requestMoodyLegacySlot",
      "showMoodyBorrowedFuture",
      "requestMoodyBloodMarket",
      "requestMoodyPressureValve",
      "requestMoodyItemStackAttachment",
    ]) {
      expect(ui, method).toContain(method);
    }
    expect(ui).toMatch(/UiMode\.MOODY_CHOICE/);
    expect(source("src/data/elite-redux/coop/coop-ui-registry.ts")).toMatch(/UiMode\.MOODY_CHOICE/);
    const coordinator = source("src/data/elite-redux/moody/moody-runtime-game-adapter.ts");
    expect(coordinator).toContain('kind: "bounty"');
    expect(coordinator).toContain('kind: "legacy"');
    expect(coordinator).toContain('kind: "borrowed-future"');
    expect(source("src/phases/biome-shop-phase.ts")).toContain("requestMoodyBloodMarket");
    expect(source("src/phases/select-modifier-phase.ts")).toContain("requestMoodyRecycler");
  });

  it("wires real harness scenarios, eight moves, eight party slots, Fog observations, and input parity", () => {
    const scenarios = source("src/dev-tools/test-suite/scenarios.ts");
    for (const call of [
      "showMoodyBountyBoard",
      "showMoodyBorrowedFuture",
      "requestMoodyRecycler",
      "requestMoodyPressureValve",
    ]) {
      expect(scenarios, call).toContain(call);
    }
    expect(source("src/ui/handlers/fight-ui-handler.ts")).toContain("Math.min(8");
    expect(source("src/ui/handlers/summary-ui-handler.ts")).toContain("Math.min(8");
    expect(source("src/ui/handlers/party-ui-handler.ts")).toContain("globalScene.getPlayerParty().length");
    expect(source("src/ui/handlers/menu-ui-handler.ts")).toContain("observedEnemyBoonInstanceIds");
    const inputs = source("src/ui-inputs.ts");
    expect(inputs).toMatch(/Button\.CYCLE_GENDER/);
    expect(inputs).toContain("toggleMoodyTriggerFeed");
  });
});
