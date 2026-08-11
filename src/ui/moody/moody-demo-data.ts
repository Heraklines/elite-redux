/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody UI dev/demo data.
//
// Deterministic, dense representative payloads for the Moody UI surfaces: long
// descriptions, 8-Pokémon rosters, hidden enemy slots, overflow badges, every
// effect state, mobile density, rank-up/evolution/replacement comparisons.
//
// These models are PRESENTATION-ONLY. They never touch moody-state.ts; the dev
// scenario (scenarios.ts "UI: Moody ..." entries) passes them straight to the
// handlers so every surface can be opened without a mechanics run.
// =============================================================================

import type {
  MoodyBoonInstance,
  MoodyBoonOffer,
  MoodyCurseInstance,
  MoodyModeSaveData,
} from "#data/elite-redux/moody/moody-types";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { MoodyBattleHudModel } from "#ui/moody/moody-battle-hud";
import type { MoodyEnemyPanelConfig } from "#ui/moody/moody-enemy-panel-ui-handler";
import type { MoodyLivePresentationSnapshot } from "#ui/moody/moody-live-presentation";
import { buildPressureValveOperation, type MoodyOperationModel } from "#ui/moody/moody-operation";
import type {
  MoodyChoicePanelModel,
  MoodyTargetPickerModel,
  MoodyTransitionSection,
} from "#ui/moody/moody-presentation";

let instanceCounter = 0;

function demoBoon(
  boonId: string,
  wave: number,
  rank: 1 | 2 | 3 = 1,
  extra: Partial<MoodyBoonInstance> = {},
): MoodyBoonInstance {
  instanceCounter++;
  return { instanceId: `demo-${boonId}-${instanceCounter}`, boonId, rank, acquiredAtWave: wave, ...extra };
}

/** A dense 12-line build hitting every attachment class + overflow states. */
export function demoMoodyBuild(): MoodyBoonInstance[] {
  instanceCounter = 0;
  return [
    demoBoon("crowned-vanguard", 10, 2, { target: { partySlots: [0] } }),
    demoBoon("bastion-seat", 10, 1, { target: { partySlots: [1] } }),
    demoBoon("sanctuary-seat", 20, 3, {
      target: { partySlots: [2] },
      evolutionId: "hallowed-seat",
    }),
    demoBoon("hungry-seat", 20, 1, {
      target: { partySlots: [3] },
      progress: { counters: { feastTokens: 3 } },
    }),
    demoBoon("twin-sigil", 30, 1, { target: { partySlots: [0, 4] } }),
    demoBoon("chosen-one", 30, 2, {
      target: { pokemonIds: [1001], partySlots: [0] },
      progress: { counters: { glory: 8 } },
    }),
    demoBoon("signature-technique", 40, 3, {
      target: { pokemonIds: [1001], partySlots: [0], moveIds: [MoveId.FLAMETHROWER] },
      evolutionId: "masterpiece",
    }),
    demoBoon("blood-rival", 50, 1, {
      target: { pokemonIds: [1002], partySlots: [1], pokemonType: PokemonType.DRAGON },
      progress: { counters: { kOs: 4 } },
    }),
    demoBoon("heirloom-bearer", 60, 1, {
      target: { pokemonIds: [1003], partySlots: [2], itemTypeIds: ["LEFTOVERS"] },
    }),
    demoBoon("toxic-bloom", 70, 2),
    demoBoon("turntable", 80, 1),
    // One dormant line exercises the Mood Swing badge state.
    demoBoon("echo-seat", 90, 1, { target: { partySlots: [5] }, dormant: true }),
  ];
}

export function demoMoodyState(): MoodyModeSaveData {
  const curses: MoodyCurseInstance[] = [
    { curseId: "type-tax", acquiredAtWave: 1 },
    { curseId: "fog-of-war", acquiredAtWave: 1 },
  ];
  return {
    version: 1,
    seed: 0xc0ffee,
    acquisitionRolls: 14,
    draftIndex: 5,
    boons: demoMoodyBuild(),
    curses,
    recentThreat: [],
  };
}

/** Three draft offers exercising new / rank-up / evolution / hidden. */
export function demoMoodyOffers(hidden = false): MoodyBoonOffer[] {
  const offers: MoodyBoonOffer[] = [
    { offerId: "demo:0:chosen-one:2", kind: "rank-up", boonId: "chosen-one", existingInstanceId: "demo-chosen-one-6" },
    {
      offerId: "demo:1:bastion-seat:3",
      kind: "evolution",
      boonId: "bastion-seat",
      existingInstanceId: "demo-bastion-seat-2",
    },
    { offerId: "demo:2:recapitulation:new", kind: "new", boonId: "recapitulation" },
  ];
  if (hidden) {
    offers[1] = { ...offers[1], hidden: true };
  }
  return offers;
}

/** Enemy panel with 8 slots, hidden reserves, fog-of-war and debug detail. */
export function demoMoodyEnemyPanel(): MoodyEnemyPanelConfig {
  const boons: MoodyBoonInstance[] = [
    demoBoon("toxic-bloom", 30, 2),
    demoBoon("crowned-vanguard", 30, 1, { target: { partySlots: [0] } }),
    demoBoon("bastion-seat", 30, 2, { target: { partySlots: [2] } }),
    demoBoon("bossbreaker", 30, 1, { target: { partySlots: [7] } }),
    demoBoon("heirloom-bearer", 30, 1, { target: { partySlots: [7], itemTypeIds: ["LEFTOVERS"] } }),
    demoBoon("sanctuary-seat", 30, 1, { target: { partySlots: [5] } }),
  ];
  return {
    boons,
    rosterSize: 8,
    hiddenReserves: true,
    fogOfWar: true,
    observedInstanceIds: new Set([boons[0].instanceId, boons[1].instanceId]),
    debug: true,
  };
}

/** Dense tracker tray + rule strip + HP overlay demo. */
export function demoMoodyBattleHud(): MoodyBattleHudModel {
  return {
    ruleLines: ["DOWNBEAT: −15% incoming damage", "PHASE SHIFT IN: 1 TURN", "NEXT SEASON: RAIN"],
    trackers: [
      { id: "glory", label: "◆ Glory", value: "8/10", urgency: "normal", pinned: true },
      { id: "debt", label: "≣ Debt", value: "38 (end of next turn)", urgency: "warning", pinned: true },
      { id: "sweeper", label: "☠ Sweeper", value: "chain 2", urgency: "critical", pinned: false },
      { id: "refrain", label: "✦ Refrain", value: "×2 · next PP 3", urgency: "normal", pinned: false },
      { id: "bounty", label: "§ Bounty", value: "3/5 types", urgency: "normal", pinned: false },
    ],
    feed: [
      { order: 1, label: "Bastion Seat II: +64 barrier" },
      { order: 2, label: "Toxic Bloom: poison cannot cause lethal damage" },
      { order: 3, label: "Misery Loves Company: damage reduced by 20%" },
      { order: 4, label: "Feedback Loop III: 18 HP queued" },
    ],
    details: [
      {
        id: "mithridatism",
        title: "Mithridatism I",
        description:
          "After three cures of the same status, gain Resistance I against it.\nCurrent: Poison: 1/3 cures - Resistance I at 3 (50% prevention)",
        tone: "boon",
      },
      {
        id: "revenge-entry",
        title: "Revenge Entry I",
        description: "Entering immediately after an ally faints grants +1 Speed and 20% move power for two turns.",
        tone: "boon",
      },
      {
        id: "curse-fatigue",
        title: "Accumulated Fatigue",
        description:
          "A Pokemon used in three consecutive waves deals 15% less damage until it sits out one full battle.\nCurrent: Charizard: 3/3 consecutive waves - 15% damage penalty active",
        tone: "curse",
      },
    ],
    hpOverlay: { barrier: 64, damageDebt: 38, debtDueLabel: "end of next turn", revivalGlyph: "♦", revivalCharges: 1 },
  };
}

/** Final Draft three-way choice demo. */
export function demoMoodyChoice(): MoodyChoicePanelModel {
  return {
    title: "FINAL DRAFT",
    prompt: "Flamethrower is on its final PP.",
    queueLabel: "Decision 1 / 2",
    cancellable: false,
    options: [
      { id: "climax", label: "CLIMAX", description: "+100% power" },
      { id: "precision", label: "PRECISION", description: "Perfect accuracy, guaranteed secondary effect" },
      { id: "revision", label: "REVISION", description: "Restore 2 PP afterward", costLine: "Cost: 15% maximum HP" },
    ],
  };
}

/** Generic target picker demo: 8 Pokémon with ineligible rows + previews. */
export function demoMoodyTargetPicker(): MoodyTargetPickerModel {
  const names = ["Charizard", "Blastoise", "Venusaur", "Pikachu", "Snorlax", "Gengar", "Dragonite", "Lucario"];
  return {
    title: "Choose a Pokémon",
    allowCancel: true,
    options: names.map((name, index) => ({
      id: index,
      label: `${index + 1}. ${name}`,
      detail: `Lv${55 + index}`,
      eligible: index !== 3,
      ...(index === 3 ? { ineligibleReason: "already bound to Chosen One" } : {}),
      attachments: index === 0 ? ["Chosen One II", "Signature Technique ★"] : index === 1 ? ["Bastion Seat"] : [],
      ...(index === 0 ? {} : { preview: `${name} gains the boon permanently.` }),
    })),
  };
}

/** Biome-transition report demo with every section kind. */
export function demoMoodyTransitionSections(): MoodyTransitionSection[] {
  return [
    { title: "MOOD SWING", lines: ["Bastion Seat is now dormant.", "Failure Is Data has reactivated."] },
    { title: "CURSED INVENTORY", lines: ["Luxray’s Calcium ×8 is disabled while Luxray is active."] },
    {
      title: "ENTROPY",
      lines: ["Luxray: Thunder Punch → Ice Punch", "Gardevoir: Calm Mind → Nasty Plot"],
    },
    { title: "BLOOD MARKET", lines: ["Previous Blood Debt cleared."] },
    { title: "THE LONG NIGHT", lines: ["Biome healing prevented."] },
  ];
}

/** Borrowed Future pre-battle panel demo. */
export function demoMoodyBorrowedFutureOperation(): MoodyOperationModel {
  return {
    kind: "borrowed-future",
    title: "BORROWED FUTURE",
    prompt: "Enemy actions are COMMITTED (locked, not predicted). Reorder once, then begin.",
    confirmLabel: "begin battle",
    cancellable: false,
    reorderable: true,
    minSelections: 0,
    committedActions: [
      { actor: "Garchomp", action: "Earthquake", target: "Current player lead" },
      { actor: "Rotom-Wash", action: "Hydro Pump", target: "Slot 2" },
    ],
    options: ["Charizard", "Blastoise", "Venusaur", "Pikachu", "Snorlax", "Gengar"].map((label, index) => ({
      id: `party-${index}`,
      label,
      description: `Party position ${index + 1}. LEFT/RIGHT moves this Pokemon in the planned order.`,
    })),
  };
}

/** Bounty Board demo: three feasible objectives. */
export function demoMoodyBountyOperation(): MoodyOperationModel {
  return {
    kind: "bounty",
    title: "BOUNTY BOARD",
    prompt: "Accept one feasible objective for the next segment.",
    confirmLabel: "accept contract",
    cancellable: true,
    minSelections: 1,
    maxSelections: 1,
    trackerLabel: "NEXT 10 WAVES",
    options: [
      {
        id: "type-mosaic",
        label: "TYPE MOSAIC",
        badge: "MEDIUM",
        description: "Use damaging moves of at least 5 distinct elemental types.",
        consequenceLines: [
          "Progress: 0/5",
          "Reward: Master-tier item",
          "Failure: segment ends without 5 types.",
          "Feasible: current team has 9 qualifying types.",
        ],
      },
      {
        id: "sweeper",
        label: "SWEEPER",
        badge: "HARD",
        description: "Win 3 battles without switching.",
        consequenceLines: [
          "Progress: 0/3",
          "Reward: Ultra-tier item",
          "Failure: any voluntary switch.",
          "Feasible: six conscious party members.",
        ],
      },
      {
        id: "pacifist",
        label: "PACIFIST",
        badge: "HARD",
        description: "Defeat the next boss without using a status move.",
        consequenceLines: [
          "Progress: pending",
          "Reward: Rogue-tier item",
          "Failure: any status move used.",
          "Feasible: four damaging moves are available.",
        ],
      },
    ],
  };
}

export function demoMoodyRecyclerOperation(): MoodyOperationModel {
  return {
    kind: "recycler",
    title: "RECYCLER",
    prompt: "Destroy one offer. The other two reroll with improved base-rarity weighting.",
    confirmLabel: "destroy and reroll",
    cancellable: true,
    minSelections: 1,
    maxSelections: 1,
    options: ["Calcium", "Rogue Ball", "Multi Lens"].map((label, index) => ({
      id: `reward-${index}`,
      label,
      description: index === 0 ? "Great base item" : index === 1 ? "Ultra base item" : "Rogue base item",
      consequenceLines: [
        "Flawless Ledger uplift is applied before Luck.",
        "Destroyed category may be excluded by Closed Loop.",
      ],
    })),
  };
}

export function demoMoodyLegacyOperation(): MoodyOperationModel {
  return {
    kind: "legacy",
    title: "LEGACY SLOT",
    prompt: "Choose progression to preserve before releasing the occupant.",
    confirmLabel: "store imprint",
    cancellable: true,
    minSelections: 1,
    maxSelections: 1,
    options: [
      {
        id: "chosen-one",
        label: "Chosen One",
        description: "Glory 8 -> inherited Glory 4",
        consequenceLines: ["Stored in slot 2."],
      },
      {
        id: "bossbreaker",
        label: "Bossbreaker",
        description: "Stacks 6 -> inherited stacks 3",
        consequenceLines: ["Stored in slot 2."],
      },
    ],
  };
}

export function demoMoodyBloodMarketOperation(): MoodyOperationModel {
  return {
    kind: "blood-market",
    title: "BLOOD MARKET",
    prompt: "Choose how to pay for Leftovers.",
    confirmLabel: "purchase",
    cancellable: true,
    minSelections: 1,
    maxSelections: 1,
    options: [
      {
        id: "money",
        label: "PAY MONEY",
        description: "$12,000",
        consequenceLines: ["The Long Night premium: x2 healing price."],
      },
      {
        id: "blood",
        label: "PAY BLOOD",
        description: "Debtor: Charizard (most used)",
        consequenceLines: ["-18% maximum HP until biome transition.", "Compound Interest: next debt +5%."],
      },
    ],
  };
}

export function demoMoodyPressureValveOperation(): MoodyOperationModel {
  return buildPressureValveOperation({
    healing: "Restore 30% maximum HP.",
    barrier: "Gain a 48 HP barrier.",
    pp: "Restore 2 PP to the selected move.",
  });
}

export function demoMoodyItemStackOperation(): MoodyOperationModel {
  return {
    kind: "item-stack",
    title: "ATTACH TO ITEM STACK",
    prompt: "Choose an exact stack. Existing attachments and suppression are shown.",
    confirmLabel: "attach",
    cancellable: true,
    minSelections: 1,
    maxSelections: 1,
    options: [
      {
        id: "leftovers",
        label: "Leftovers x2",
        description: "Held by Charizard",
        consequenceLines: ["Attached: Heirloom Bearer", "Set: Pantry 2/3"],
      },
      {
        id: "calcium",
        label: "Calcium x8",
        description: "Held by Luxray",
        consequenceLines: ["DISABLED: Cursed Inventory while Luxray is active"],
      },
    ],
  };
}

export function demoMoodyLivePresentation(pokemonIds: readonly number[]): MoodyLivePresentationSnapshot {
  return {
    pokemon: pokemonIds.map((pokemonId, index) => ({
      pokemonId,
      temporaryAbilities:
        index === 0
          ? [
              {
                abilityId: 22,
                name: "Intimidate",
                description: "Lowers opposing Attack on entry.",
                sourceLabel: "Ability Carousel",
                durationLabel: "1 turn",
                carousel: true,
              },
            ]
          : [],
      moves:
        index === 0
          ? [
              {
                pokemonId,
                moveId: MoveId.FLAMETHROWER,
                ppCost: 2,
                refrainCount: 2,
                guaranteedSecondary: true,
                cannotMiss: true,
                sourceLabel: "Final Draft",
              },
              {
                pokemonId,
                moveId: MoveId.SPLASH,
                temporary: true,
                sealed: true,
                durationLabel: "battle",
                originalMoveName: "Roost",
                sourceLabel: "Entropy",
              },
            ]
          : [],
      itemStacks: [
        {
          stackId: `stack-${index}`,
          name: index === 0 ? "Leftovers" : "Calcium",
          count: index === 0 ? 2 : 8,
          sourceLabel: "Heirloom Bearer",
          attachedEffects: ["Pantry"],
          disabled: index === 1,
          ...(index === 1 ? { disabledReason: "Cursed Inventory" } : {}),
        },
      ],
      barrier: 40 + index * 8,
      damageDebt: index === 0 ? 36 : 0,
      ...(index === 0 ? { debtDueLabel: "due in 1 turn" } : {}),
      revivalCharges: index === 0 ? 2 : 0,
      revivalLabel: "APEX",
      modifiers: [{ label: "Damage", value: "+20%", sourceLabel: "Chosen One II" }],
    })),
    bounty: {
      id: "type-mosaic",
      name: "Type Mosaic",
      progressLabel: "3/5 types",
      status: "active",
      detail: "Reward: Master-tier item",
    },
    trackers: [
      {
        id: "cadence",
        label: "Pressure Valve",
        value: "2 / 3",
        detail: "Next trigger after one more conversion.",
        pinned: true,
      },
    ],
    curseMarkers:
      pokemonIds.length === 0
        ? []
        : [
            {
              id: "blood-mark",
              label: "Blood Mark",
              detail: "Takes the next Blood Market payment.",
              pokemonId: pokemonIds[0],
              urgency: "critical",
            },
          ],
    recruiterEye: {
      pokemonId: -1,
      guaranteedTrait: "uncaught active ability",
      activeAbilityCollected: 2,
      activeAbilityTotal: 3,
      missingEggMoves: 3,
      missingNatures: 8,
      ivSummary: "HP 28 / Atk 31 / Def 24 / SpA 30 / SpD 27 / Spe 31",
    },
    recap: {
      selectedCurse: "Fog of War",
      mostTriggered: ["Chosen One - 18", "Bastion Seat - 14"],
      completedBounties: ["Type Mosaic", "Sweeper"],
      highestGlory: 12,
      flawlessLedgerProgress: "7 upgrades",
      mostUsedPokemon: "Charizard",
      majorCurseEvents: ["Blood Moon revived the boss at wave 100"],
      replayId: "MOODY-DEMO-001",
    },
  };
}
