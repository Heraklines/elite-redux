/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 5 / event-effect (Tier B).
//
// Read by hand from archetypes/post-summon-scripted-move.ts and from every place that builds it (the dispatcher, the ability upgrades,
// the roster files, the saved editor rules). The class extends PostSummonAbAttr (WHEN "when I enter the battle"), constructor `opts` (one
// options object, kept in the private field `opts`), `super()` (the ability banner is shown). canApply in the ORIGINAL clause order:
//   0. a preview (simulated) -> true, before anything else          stays in canApply (first clause, never a rule)
//   1. oncePerBattleKey set: with maxUsesPerBattle, the number of `key#N` markers is below the cap; without it, the plain `key`
//      is not in pokemon.waveData.entryEffectsFired                  gate     (library time.once-per, scope wave, same Set; the cap has no atom, R-B10-c5-01)
//   2. targetsSelf -> true (a self-side move needs nobody)          residual (feasibility)
//   3. at least one foe is still standing                           residual (feasibility: an offensive cast needs a target)
// no random draw. apply: simulated -> nothing; the target is the holder itself (targetsSelf), every living foe (allOpponents) or the
// first living foe; no living foe and not self -> nothing. Then the memory is written (the plain key, or `key#<uses so far>`), and a
// MovePhase with the scripted move (power override, alwaysHit, nonReflectable) is queued FIRST, as a FOLLOW_UP use when it is aimed
// at me (so an opposing flinch cannot cancel a set-up) and as a free INDIRECT use otherwise.
//
// Clause classification: clause 1 is the part staff may want to change ("only the first time I enter this battle"), so it is the
// replaceable gate; every user's binding spells it out. Clauses 2 and 3 are feasibility (somebody to aim at) and stay in the class.
// The effect is declared as a package ONLY because the library's "Use a move" effect needs a foe slot (`other`) that the entry trigger does not
// have, and lacks the aim, always-hit and not-reflectable settings (request R-B10-c5-03). It is not a one-off mechanic: it is the same free move
// as the library effect, with typed settings for every number and choice, and it should become that effect once the request is done.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { NOTHING, optionMoveCodec, optionNumberOrZero } from "./c3-codecs";
import {
  AIM_CHOICES,
  AIM_FIRST_FOE,
  aimCodec,
  buildEntryMoveOptions,
  maxUsesCodec,
  memoryKeyCodec,
  optionFlagCodec,
} from "./c5-codecs";

/** Every setting lives inside the one `opts` argument; `ctorOption` only names the setting (the builder places it). */
const IN_OPTS = { ctorIndex: 0, path: "opts" } as const;

export default defineDecl(PostSummonScriptedMoveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Use a free move as soon as I enter the battle",
  summary: params =>
    `When I enter, I use ${params.moveId}${Number(params.power) > 0 ? ` with ${params.power} power` : " at its own power"} for free (${String(params.aim).toLowerCase().replace(/_/g, " ")}). It costs no PP. Example: Sand Attack on the foe the moment I arrive.`,
  synonyms: [
    "use a move on entry",
    "cast a move when I switch in",
    "free move on switch in",
    "entry move",
    "start of battle move",
    "intimidate with a move",
    "tailwind on entry",
    "sand pit",
    "wildfire",
    "jumpscare",
    "web spinner",
    "wishmaker",
  ],
  examples: [
    "When I enter, I use a 40 power Astonish on the foe, only the first time, like Jumpscare",
    "When I enter, I use String Shot on every foe, like Web Spinner",
    "When I enter, I set Mist on my own side, like Frosty Prescence",
    "When I enter, I use Wish on myself up to three times per battle, like Wishmaker",
  ],
  params: [
    {
      id: "moveId",
      ...IN_OPTS,
      ctorOption: "moveId",
      control: "text",
      label: "Move to use (type its name, for example Tickle)",
      editable: true,
      gateIndependent: true,
      default: "TICKLE",
      codec: optionMoveCodec("moveId"),
    },
    {
      id: "power",
      ...IN_OPTS,
      ctorOption: "power",
      control: "number",
      min: 0,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of the move (0 = the move's own power)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: optionNumberOrZero("power"),
    },
    {
      id: "aim",
      ...IN_OPTS,
      ctorOption: "aim",
      control: "select",
      label: "Who the move is aimed at (the first foe, every foe, or me for set-up moves)",
      editable: true,
      gateIndependent: true,
      default: AIM_FIRST_FOE,
      options: [...AIM_CHOICES],
      codec: aimCodec,
    },
    {
      id: "alwaysHit",
      ...IN_OPTS,
      ctorOption: "alwaysHit",
      control: "boolean",
      label: "The move cannot miss (skips the accuracy check)",
      editable: true,
      gateIndependent: true,
      default: false,
      codec: optionFlagCodec("alwaysHit"),
    },
    {
      id: "nonReflectable",
      ...IN_OPTS,
      ctorOption: "nonReflectable",
      control: "boolean",
      label: "A foe's move-bouncing ability cannot send it back at me",
      editable: true,
      gateIndependent: true,
      default: false,
      codec: optionFlagCodec("nonReflectable"),
    },
    {
      id: "memoryKey",
      ...IN_OPTS,
      ctorOption: "memoryKey",
      control: "text",
      label: "Built-in rule: name of the per-battle memory (None = no limit; your condition block replaces it)",
      editable: false,
      default: NOTHING,
      codec: memoryKeyCodec,
    },
    {
      id: "maxUses",
      ...IN_OPTS,
      ctorOption: "maxUses",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Built-in rule: most casts per battle (0 = once per battle when a memory name is set)",
      editable: false,
      default: 0,
      codec: maxUsesCodec,
    },
  ],
  assembleCtorArg: { index: 0, build: buildEntryMoveOptions },
  conditions: [
    // The gate, per user (bindings.ts): the per-battle memory. No memory = an empty ALL group (always true). Jumpscare and Jackpot use
    // the library's once-per-wave atom on the class's own key; Wishmaker and Daydreamer's second copy (a cap of 3 casts) stay legacy
    // until the library has a counted memory (R-B10-c5-01).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A move aimed at a foe needs at least one foe still standing; a move aimed at me works even with nobody on the other side",
    "A move aimed at every foe is one cast that hits all of them; a move aimed at the first foe picks the leftmost foe that is still standing",
    "A move aimed at me is cast as a free follow-up, so a foe's flinch cannot cancel it",
    "Nothing happens in a preview",
  ],
  effect: {
    id: "effect.package",
    params: ["moveId", "power", "aim", "alwaysHit", "nonReflectable"],
  },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  // The foe is topped up after the entry cast so a damaging entry move (Fire Spin, Whirlpool) cannot end the battle before the second quiet turn.
  probes: [{ name: "entry with a foe in front of me", axes: { foeHp: ["max"] } }],
  status: "decomposed",
  notes:
    "Declared as the library package effect only until R-B10-c5-03 lets the library 'Use a move' effect run on entry (it needs a foe slot, the entry trigger has none; the class also has an aim, always-hit and not-reflectable setting the library effect lacks); the move, power, aim, always-hit and not-reflectable are typed settings and the trigger and the per-battle gate are separate blocks. Tier B split by hand (canApply keeps the preview clause first; gate = the per-battle memory; residual = somebody to aim at; no guards, no random draw). Users (40 attrs): no memory and aimed at the first foe (Insomnia attr 3, Cheap Tactics, Monkey Business, Trickster, Doombringer, Suppress attr 0, Change of Heart, Powder Burst, Monster Mash, Dream Whimsy, Tar Toss, Wind Rage, Neutralizing Fog, Let's Dance, Brainpower attr 6, Daydreamer attr 0, Oracle, Electro Booster attr 1; with a power: Low Blow 40, Phantom Thief 40, Wildfire 50, Poseidon's Dominion 50, Chilling Presence 10), every foe (Web Spinner; Sand Pit with 20 power and always hit), aimed at me (Let's Roll, Soothing Aroma, Draco Morale, Butter Up attr 1, Frosty Prescence, I Am Steve, Overcast attr 1, Curlipede, Electro Booster attr 0, Dirty Snowball attr 2, Mudball). Their gate is the empty ALL group (the class tests no memory). Once per battle: Jumpscare (key jumpscare-scripted-move, 40 power) and Jackpot (key jackpot-happy-hour, aimed at me) bind time.once-per scope wave on the class's own key, which is the same Set the class writes. A cap of three casts (Wishmaker, Daydreamer attr 1, same key wishmaker, so a Pokemon holding both shares the count) is legacy-closure-pending-request R-B10-c5-01: the class counts `key#N` markers, the library has no counted memory. Also used by the saved editor rules in er-custom-abilities.json (components that retarget `opts.moveId` of Brainpower attr 6 and Butter Up attr 1 and a third one) through the same options object. The not-reflectable option exists for an on-entry Telekinesis (the dispatcher builds one) but no live user sets it today; it is still a setting here. Oddities, NOT fixed: when the memory key is set the marker is written in apply even when the move later fails; the library effect additionally refuses when I have fainted and never starts from an indirect move, the class does neither (R-B10-c5-03); the count cap and the plain once-per-battle flag are two different memories on the same Set; unlike a normal move the cast never checks my PP; a foe-aimed cast with no living foe stays silent.",
});
