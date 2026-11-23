/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 5 / event-effect, Tier A with branches (nothing to bind, nothing to gate). Read from the source
// (archetypes/entry-effect.ts, its parent PostSummonAbAttr in ab-attrs.ts, the dispatcher translators and the patch functions of
// init-elite-redux-vanilla-rebalance.ts) and from a live dump of all 67 users. The class has no condition at all:
//
//   canApply  always true (an explicit override of PostSummonAbAttr's own); nothing to extract, nothing to bind
//   apply     1. simulated -> return                                            (guard-like, kept in the class)
//             2. once = true: if waveData.entryEffectsFired has `entry-once:<kind>:<move ?? type ?? weather ?? stat ?? "">` return,
//                else add it (the key is written BEFORE the effect, even when the effect then does nothing)
//             3. switch on `effect.kind` (the branches below)
//
// The class is a discriminated union of eight sub-effects (a ninth, "first-move-priority", is an explicit no-op: "defer", no user), so
// the declaration is ONE block with one branch per sub-effect: the staff pick the kind, then fill only the settings that belong to
// it. The options object that the constructor takes must contain only the keys of the chosen kind (the once-key and the live
// configuration read them), so every kind-specific setting has a "Not used" choice (0 for a number) that leaves its key out.
//
// Users (67 attrs, all dumped live): set-weather x5 (Desert Spirit, Low Visibility/Overcast, Snowy Wrath, Storm Cloud), set-terrain x3
// (Electro Surge, Supercell, Toxic Surge), set-terrain-random x1 (Zen Garden), set-hazard x6 (Spider Lair, Watch Your Step, Hot Coals,
// Rising Dough, Rose Garden, Foamy Web), set-screen-or-room x15 (White Smoke x2, Delta Stream, Air Blower, Twisted Dimension,
// North Wind, Atlas, Gravity Well, Inversion, Fire Aspect, Blistering Sun, Molten Core, Gale Bloom, Dreadful Winds, Unintentional
// Genius), add-self-type x25 (Turboblaze, Teravolt, Aquatic, Grounded, ...), self-stat-boost x5 (Embody Aspect x4, Headstrong, ...),
// scripted-move x7 (Water Veil x2, Forewarn, Pastel Veil, Purifying Waters, Woodland Curse, Royal Decree (once), ...).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import {
  fieldCodec,
  FIELD_OPTION_NAMES,
  HAZARD_SIDE_NAMES,
  hazardSideCodec,
  KIND_NAMES,
  kindCodec,
  MOVE_NAMES,
  moveCodec,
  NOT_USED,
  STAT_NAMES,
  statCodec,
  TERRAIN_NAMES,
  terrainCodec,
  terrainListCodec,
  TRAP_OPTION_NAMES,
  TYPE_NAMES,
  trapCodec,
  typeCodec,
  WEATHER_NAMES,
  weatherCodec,
  zeroLeavesOut,
} from "#data/elite-redux/ability-studio/decl/B08/chunk5-choices";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";

const turnsWords = (turns: unknown): string => (Number(turns) > 0 ? `${turns} turns` : "the usual number of turns");

export default defineDecl(EntryEffectAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Do an entry effect (weather, trap, type, stat, move...)",
  summary: params => {
    const once = params.once === true ? " Only the first time in a battle." : "";
    switch (String(params.kind)) {
      case "Set the weather":
        return `When I enter the battle, set the weather to ${String(params.weather).toLowerCase()} for ${turnsWords(params.turns)}. Example: rain for 8 turns.${once}`;
      case "Set a terrain":
        return `When I enter the battle, set ${String(params.terrain)} terrain for ${turnsWords(params.turns)}. Example: Electric terrain for 8 turns.${once}`;
      case "Set one terrain picked at random":
        return `When I enter the battle, set one terrain from the list at random (a held terrain seed of a listed terrain decides it): ${String(params.terrains)}.${once}`;
      case "Lay a trap on the field":
        return `When I enter the battle, lay ${Number(params.layers) > 0 ? params.layers : 1} layer(s) of ${String(params.hazard)} on ${String(params.hazardSide).toLowerCase()}. Example: 2 layers of Spikes.${once}`;
      case "Set a screen, room or other field effect":
        return `When I enter the battle, set ${String(params.tag)} on my side (field-wide effects reach everyone) for ${turnsWords(params.turns)}. Example: Tailwind for 3 turns.${once}`;
      case "Add a type to myself":
        return `When I enter the battle, I gain the ${String(params.type)} type and keep my other types. Example: Water type added.${once}`;
      case "Change one of my own stats":
        return `When I enter the battle, my ${String(params.stat)} changes by ${params.stages} stage(s) (negative = lower). Example: +1 Sp. Def.${once}`;
      default:
        return `When I enter the battle, I use ${String(params.move)} right away, aimed at the first foe still standing. Example: Glare.${once}`;
    }
  },
  synonyms: [
    "entry effect",
    "on switch in",
    "summon weather",
    "set terrain",
    "set tailwind",
    "set trick room",
    "gravity",
    "entry hazard",
    "add a type",
    "extra type",
    "free move on entry",
    "stat boost on entry",
    "drizzle",
    "electric surge",
    "aquatic",
    "headstrong",
    "zen garden",
  ],
  examples: [
    "Set Tailwind for 3 turns when I enter",
    "Add the Water type to me when I enter",
    "Raise my Sp. Def by 1 stage when I enter",
    "Use Glare once per battle when I enter",
  ],
  params: [
    {
      id: "kind",
      ctorIndex: 0,
      ctorOption: "kind",
      path: "effect",
      control: "select",
      label: "What happens on entry",
      // The kind changes which settings the class reads, not the gate (there is none), so staff may switch it.
      editable: true,
      gateIndependent: true,
      default: "Set the weather",
      options: KIND_NAMES,
      codec: kindCodec,
    },
    {
      id: "once",
      ctorIndex: 1,
      path: "once",
      control: "boolean",
      label: "Only the first time I enter in a battle (not on every re-entry)",
      editable: true,
      gateIndependent: true,
      default: false,
    },
    {
      id: "weather",
      ctorIndex: 0,
      ctorOption: "weather",
      path: "effect",
      control: "select",
      label: "Weather (only for 'Set the weather')",
      editable: true,
      gateIndependent: true,
      default: "Rain",
      options: WEATHER_NAMES,
      codec: weatherCodec,
    },
    {
      id: "terrain",
      ctorIndex: 0,
      ctorOption: "terrain",
      path: "effect",
      control: "select",
      label: "Terrain (only for 'Set a terrain')",
      editable: true,
      gateIndependent: true,
      default: NOT_USED,
      options: TERRAIN_NAMES,
      codec: terrainCodec,
    },
    {
      id: "terrains",
      ctorIndex: 0,
      ctorOption: "terrains",
      path: "effect",
      control: "text",
      label: "Terrains to pick from, separated by commas, such as Grassy, Psychic (only for 'picked at random')",
      editable: true,
      gateIndependent: true,
      default: "",
      codec: terrainListCodec,
    },
    {
      id: "turns",
      ctorIndex: 0,
      ctorOption: "turns",
      path: "effect",
      control: "number",
      min: 0,
      max: 20,
      step: 1,
      integer: true,
      label:
        "Number of turns (weather, terrain, screens; 0 = not set, which means the usual length for weather and terrain)",
      editable: true,
      gateIndependent: true,
      default: 8,
      codec: zeroLeavesOut("turns"),
    },
    {
      id: "hazard",
      ctorIndex: 0,
      ctorOption: "hazard",
      path: "effect",
      control: "select",
      label: "Trap (only for 'Lay a trap on the field')",
      editable: true,
      gateIndependent: true,
      default: NOT_USED,
      options: TRAP_OPTION_NAMES,
      codec: trapCodec,
    },
    {
      id: "layers",
      ctorIndex: 0,
      ctorOption: "layers",
      path: "effect",
      control: "number",
      min: 0,
      max: 3,
      step: 1,
      integer: true,
      label: "Layers of the trap (0 = not set, which means 1 layer)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: zeroLeavesOut("layers"),
    },
    {
      id: "hazardSide",
      ctorIndex: 0,
      ctorOption: "side",
      path: "effect",
      control: "select",
      label: "Side of the field for the trap (Not used = both sides, the old behaviour)",
      editable: true,
      gateIndependent: true,
      default: NOT_USED,
      options: HAZARD_SIDE_NAMES,
      codec: hazardSideCodec,
    },
    {
      id: "tag",
      ctorIndex: 0,
      ctorOption: "tag",
      path: "effect",
      control: "select",
      label: "Field effect (only for 'Set a screen, room or other field effect')",
      editable: true,
      gateIndependent: true,
      default: NOT_USED,
      options: FIELD_OPTION_NAMES,
      codec: fieldCodec,
    },
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "effect",
      control: "select",
      label: "Type to add to me (only for 'Add a type to myself')",
      editable: true,
      gateIndependent: true,
      default: NOT_USED,
      options: TYPE_NAMES,
      codec: typeCodec,
    },
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "effect",
      control: "select",
      label: "Which of my stats (only for 'Change one of my own stats')",
      editable: true,
      gateIndependent: true,
      default: NOT_USED,
      options: STAT_NAMES,
      codec: statCodec,
    },
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "effect",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages (-6 to 6; negative lowers; 0 = not used)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: zeroLeavesOut("stages"),
    },
    {
      id: "move",
      ctorIndex: 0,
      ctorOption: "move",
      path: "effect",
      control: "select",
      label: "Move to use (only for 'Use a move')",
      editable: true,
      gateIndependent: true,
      default: NOT_USED,
      options: MOVE_NAMES,
      codec: moveCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Nothing happens while the game only previews the entry (a simulated check changes nothing)",
    "Weather and terrain can only be set if the game accepts them (not already active, a primal weather is not overwritten)",
    "A trap is not laid for Foamy Web while the same side already has a real Sticky Web",
    "A random terrain list that is empty does nothing",
    "The move is only used if a foe is still standing; otherwise it is aimed at me",
    "The type is not added again if I already have it",
  ],
  branches: [
    {
      label: "Set the weather",
      conditions: ["Entry effect is 'Set the weather'"],
      effect: { id: "effect.set-weather", params: ["weather", "turns"] },
    },
    {
      label: "Set a terrain",
      conditions: ["Entry effect is 'Set a terrain'"],
      effect: { id: "effect.set-terrain", params: ["terrain", "turns"] },
    },
    {
      label: "Set one terrain picked at random",
      conditions: ["Entry effect is 'Set one terrain picked at random'"],
      effect: { id: "effect.set-terrain", params: ["terrains", "turns"] },
    },
    {
      label: "Lay a trap on the field",
      conditions: ["Entry effect is 'Lay a trap on the field'"],
      effect: { id: "effect.arena-tag", params: ["hazard", "layers", "hazardSide"] },
    },
    {
      label: "Set a screen, room or other field effect",
      conditions: ["Entry effect is 'Set a screen, room or other field effect'"],
      effect: { id: "effect.arena-tag", params: ["tag", "turns"] },
    },
    {
      label: "Add a type to myself",
      conditions: ["Entry effect is 'Add a type to myself'"],
      // Library effect still to come (R-B08-4, extended by R-B08-46 for the holder as the target).
      effect: { id: "effect.package", params: ["type"] },
    },
    {
      label: "Change one of my own stats",
      conditions: ["Entry effect is 'Change one of my own stats'"],
      effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
    },
    {
      label: "Use a move",
      conditions: ["Entry effect is 'Use a move'"],
      // Library effect still to come (R-B08-47): the registry's scripted move needs a foe slot and a power.
      effect: { id: "effect.package", params: ["move"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "only 'Set one terrain picked at random', in apply: holder.randBattleSeedInt(number of listed terrains), skipped when the holder carries a terrain seed of a listed terrain",
    ],
    state: "battle",
    simulated: "ignores",
  },
  probes: [{ name: "enter the battle", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, no condition and no gate: canApply is an unconditional true and there is no closure, so there is nothing to bind and extra IFs are ANDed by the composition carrier. ONE class, eight sub-effects, so ONE block with one branch per sub-effect: the staff pick the 'What happens on entry' setting and fill only the settings of that branch; the build leaves every unused key out of the options object because the class derives its once-key (`entry-once:<kind>:<move ?? type ?? weather ?? stat ?? ''>`) and the live configuration from the keys that are present. A key left out is written 'Not used' (or 0), read back the same way. Branch effects: set-weather and set-terrain exist (but without `turns`, R-B08-45), the two arena-tag branches wait for R-B08-45, stat-stage exists (target fixed to me, source: StatStageChangePhase self-target), add-a-type and use-a-move wait for R-B08-46 and R-B08-47 and use effect.package as a named placeholder; the class stays the single source of behaviour. `once` is a memory test INSIDE apply (not canApply), so it is a plain setting here, not a time.once-per condition: moving it into canApply would change the ability flyout on re-entry (showAbility is true). The library atom time.once-per with scope wave and the key `entry-once:<kind>:<discriminator>` would read and write the same set (R-B08-48). `simulated`: apply returns before the once-memory and before everything else, so a preview changes nothing and consumes no random number; the class's canApply ignores it. RNG: only the random terrain draws (randBattleSeedInt) and only when the holder has no matching terrain seed. shouldActivateOnFormChange is false for self-stat-boost (Embody Aspect must not replay when a form changes); showAbility is true. NOT exposed on purpose: the kind 'first-move-priority' (the class returns without doing anything, a documented 'defer'; no user), the absolute `side` of a screen (ArenaTagSide.PLAYER/ENEMY/BOTH numbers; no user sets it, screens go to the holder's side; the 'side' setting here is the trap's own relative side), and the arena tags outside the curated lists. SUSPECTED GAME BUGS (recorded, not changed): (1) set-hazard without a `side` lays the trap on BOTH sides (`ArenaTagSide.BOTH`, 'legacy behaviour'), so Watch Your Step (2 layers of Spikes) and Rising Dough (Sticky Web) also hurt the holder's own side; their texts say 'on switch-in' and 'casts Sticky Web on entry' (Hot Coals, Rose Garden, Spider Lair and Foamy Web pass side foe). (2) Rising Dough's text says 'Lasts 7 turns', the trap is laid with 0 turns. (3) The once-key of a trap, screen or terrain kind has an empty or weather-less discriminator, so two once-effects of the same kind on one holder would share one key (only Royal Decree uses `once`). (4) The once-key is written before the effect, so a weather or terrain that the game rejects still spends the once. (5) White Smoke (73) carries two entry effects, Smokescreen at attr 1 and Mist at attr 2. Not verified against a battle: the Water Veil abilities (41, 5947) and Purifying Waters (5231, attr 3) use scripted-move AQUA_RING; Forewarn (108) uses the Forewarn-only Future Sight copy (id 9500, not in any move enum), offered here as its own choice.",
});
