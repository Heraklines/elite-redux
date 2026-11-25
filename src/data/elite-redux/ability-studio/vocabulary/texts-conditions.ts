/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The plain-language summary, browse category and extra search words of every
// condition (IF block), spec sections 8.2 and 8.4. Hand-written by the librarian pass (B19): each summary says what
// the question asks and gives one real example with numbers.

import type { VocabularyText } from "./texts";

export const CONDITION_TEXTS: Readonly<Record<string, VocabularyText>> = {
  // ---- HP -----------------------------------------------------------------------------------
  "hp.full": {
    summary:
      "Yes when the chosen Pokemon has all of its HP. A single missing HP counts as not full. Example: Multiscale halves damage only at full HP.",
    category: "Damage",
  },
  "hp.at-most": {
    summary:
      "Yes when HP is at or below the percent you set, counted in whole HP. Example: at most 33% of 100 max HP is 33 HP or less.",
    category: "Damage",
  },
  "hp.at-least": {
    summary:
      "Yes when HP is at or above the percent you set, counted in whole HP. Example: at least 50% of 101 max HP needs 51 HP.",
    category: "Damage",
  },
  "hp.between": {
    summary:
      "Yes when HP is inside a range of percents, ends included. Example: between 10% and 50% of 200 max HP is 20 to 100 HP.",
    category: "Damage",
  },
  "hp.crossed-below": {
    summary:
      "Yes when the hit that just landed pushed HP from above the line to at or below it. Example: HP 60 to 40 of 100 max crosses the 50% line.",
    category: "Damage",
  },
  "hit.would-knock-out": {
    summary:
      "Yes when the hit about to land is as big as the Pokemon's remaining HP. Example: 300 damage against 200 HP would knock it out.",
    category: "Damage",
    synonyms: ["knockout", "would knock out", "finishing blow"],
  },
  "hit.dealt-damage": {
    summary:
      "Yes when the hit took away at least 1 HP. Example: a blocked hit or a hit on a Substitute that did 0 damage is a no.",
    category: "Damage",
  },
  "hit.first-strike": {
    summary:
      "Yes on the first strike of a move that hits several times. Example: the first of the 3 hits of Triple Axel.",
    category: "Moves",
  },
  "hit.landed-damage": {
    summary:
      "Yes when the hit connected and hurt: normal, super effective, not very effective or a one-hit KO. Missed, blocked and status hits are a no.",
    category: "Damage",
  },
  "hit.critical": {
    summary:
      "Yes when the chosen Pokemon took a critical hit this turn. Example: burn the target only when my attack was a critical hit.",
    category: "Damage",
  },

  // ---- Moves --------------------------------------------------------------------------------
  "move.type": {
    summary: "Yes when the move is of the chosen type. Example: Water Absorb checks for a Water move.",
    category: "Moves",
  },
  "move.category": {
    summary:
      "Yes when the move is physical, special or a status move. Example: Assault Vest-style effects only care about special moves.",
    category: "Moves",
  },
  "move.flag": {
    summary:
      "Yes when the move has a property, such as making contact, biting or sound, counting any property an ability adds. Example: Tough Claws boosts contact moves.",
    category: "Moves",
    synonyms: ["slicing", "kick", "bite", "iron fist", "pulse", "sharpness", "strong jaw", "dance", "wind", "bullet"],
  },
  "move.inherent-flag": {
    summary:
      "Yes when the move itself has the property as printed, whatever abilities add. Example: Bulletproof only looks at the move's own ball-and-bomb flag.",
    category: "Moves",
  },
  "move.power": {
    summary:
      "Yes when the move's power passes the comparison. Example: power at most 60 is true for Quick Attack (40).",
    category: "Moves",
  },
  "move.damaging": {
    summary:
      "Yes when the move deals damage, which means it is physical or special. Example: a status move like Growl is a no. Use this one in most rules.",
    category: "Moves",
  },
  "move.is-attack-move": {
    summary:
      "Advanced: yes when the move is on the game's own list of attacking moves, which Wonder Guard reads. Most rules want 'The move deals damage'.",
    category: "Moves",
  },
  "move.target-kind": {
    summary:
      "Yes when the move aims at a broad group such as one foe, all foes, everyone else or the field. Example: spread moves aim at all foes.",
    category: "Moves",
  },
  "move.aimed-at": {
    summary:
      "Yes when the move is aimed exactly as chosen, such as one adjacent foe or all foes. Example: Earthquake aims at all other Pokemon.",
    category: "Moves",
  },
  "move.targets-whole-side": {
    summary:
      "Yes when the move is aimed at a whole side of the field and not at a Pokemon. Example: Stealth Rock aims at the foe's side.",
    category: "Moves",
  },
  "move.priority": {
    summary:
      "Yes when the move's printed priority passes the comparison. Example: priority above 0 is true for Quick Attack (+1).",
    category: "Moves",
  },
  "move.effective-priority": {
    summary:
      "Yes when the move's real priority, with the user's abilities counted, passes the comparison. Example: a Prankster status move counts as +1.",
    category: "Moves",
  },
  "move.multi-hit": {
    summary: "Yes when the move hits more than once this turn. Example: Bullet Seed with 3 hits.",
    category: "Moves",
  },
  "move.hit-index": {
    summary:
      "Yes when the number of the current hit passes the comparison. Example: hit number 2 or higher means every strike after the first.",
    category: "Moves",
  },
  "move.last-hit": {
    summary: "Yes on the final hit of a move. Example: the third strike of a 3-hit move.",
    category: "Moves",
  },
  "move.effectiveness": {
    summary:
      "Yes when the move's type matchup against the target passes the comparison, abilities included. Example: at least 2 means super effective, like Filter. Use this one in most rules.",
    category: "Types & immunities",
  },
  "move.type-chart-effectiveness": {
    summary:
      "Advanced: reads the type chart directly, skipping the status-move and saved-result rules of the normal check. Most rules want 'The move's effectiveness'.",
    category: "Types & immunities",
  },
  "move.type-multiplier": {
    summary:
      "Advanced: the matchup number the game has worked out so far for this hit. Example: below 2 lets Wonder Guard block moves that are not super effective.",
    category: "Types & immunities",
  },
  "move.drains": {
    summary:
      "Yes when the move heals its user by part of the damage, like a draining move. Example: Drain Punch and Giga Drain.",
    category: "Healing",
  },
  "move.has-effect-chance": {
    summary:
      "Yes when the move has an extra effect that happens by chance. Example: Flamethrower can burn, so it is a yes.",
    category: "Moves",
  },
  "move.has-flinch-effect": {
    summary: "Yes when the move can already make its target flinch. Example: Bite and Fake Out.",
    category: "Moves",
  },
  "move.hits-substitute": {
    summary:
      "Yes when the move would hit the target's Substitute and not the target. Example: a normal attack on a Pokemon behind a Substitute.",
    category: "Moves",
  },
  "move.inflicts-status": {
    summary: "Yes when the move itself can inflict the chosen status. Example: Flamethrower can inflict Burn.",
    category: "Status conditions",
  },
  "move.ability-can-change-type": {
    summary:
      "Advanced: yes unless the move keeps its own type whatever abilities do. Example: Weather Ball and Judgment keep their type, a normal move does not.",
    category: "Types & immunities",
  },
  "move.is-move": {
    summary:
      "Yes when the move is the one you name, including Elite Redux moves. Example: only when the move is Earthquake.",
    category: "Moves",
  },

  // ---- Field --------------------------------------------------------------------------------
  "field.weather": {
    summary:
      "Yes when the chosen weather is on the field, even while Cloud Nine or Air Lock switches its effects off. To respect them, use 'The weather is one of'.",
    category: "Weather & terrain",
  },
  "field.weather-in-effect": {
    summary:
      "Yes when one of the chosen weathers is on and Cloud Nine or Air Lock is not switching it off. Type names, e.g. Rain, Heavy rain. Example: Rain Dish.",
    category: "Weather & terrain",
  },
  "field.weather-lasting": {
    summary:
      "Yes when the weather is one that never runs out: harsh sunlight, heavy rain or strong winds. Example: Desolate Land.",
    category: "Weather & terrain",
  },
  "field.weather-fog": {
    summary: "Yes when fog or eerie fog covers the field. Example: boost Dark moves while it is foggy.",
    category: "Weather & terrain",
  },
  "field.terrain": {
    summary:
      "Yes when the chosen terrain is on the field, unless Clueless hides it. Example: Grassy Terrain is active.",
    category: "Weather & terrain",
  },
  "field.terrain-unhidden": {
    summary:
      "Advanced: yes when one of the chosen terrains is really there, even while Clueless hides it. Most rules want 'The terrain is'. Example: Grassy.",
    category: "Weather & terrain",
  },
  "field.terrain-just-set": {
    summary:
      "Yes when the terrain that was just set is one of the chosen ones. Example: Quark Drive reacts to Electric Terrain starting.",
    category: "Weather & terrain",
  },
  "field.arena-tag": {
    summary:
      "Yes when a field effect such as Reflect or Spikes is up on the chosen side. Example: Light Screen on my side.",
    category: "Weather & terrain",
  },
  "field.anyone-asleep": {
    summary:
      "Yes when any Pokemon on the field is asleep; my own Comatose counts for me. Example: Bad Dreams needs a sleeping foe.",
    category: "Status conditions",
  },
  "field.gravity": {
    summary: "Yes while Gravity is active. Example: grounded Pokemon cannot float.",
    category: "Weather & terrain",
    synonyms: ["grounded", "no floating", "gravity field"],
  },
  "field.trick-room": {
    summary: "Yes while Trick Room is active. Example: slower Pokemon move first.",
    category: "Weather & terrain",
    synonyms: ["slow goes first", "reverse speed", "trick room field"],
  },

  // ---- Status and battle effects ---------------------------------------------------------------
  "status.has": {
    summary:
      "Yes when the chosen Pokemon has the chosen status, any status, or no status. Example: the foe is poisoned.",
    category: "Status conditions",
  },
  "status.has-any": {
    summary:
      "Yes when the chosen Pokemon has one of the listed status problems; an empty list means any. Example: Burn or Paralysis, as Limber cures.",
    category: "Status conditions",
  },
  "status.just-set": {
    summary:
      "Yes when the status that was just applied is one of the listed ones. Example: Synchronize reacts to Burn, Paralysis or Poison.",
    category: "Status conditions",
  },
  "status.confused": {
    summary: "Yes when the chosen Pokemon is confused. Example: Tangled Feet raises evasion while confused.",
    category: "Status conditions",
  },
  "tag.has": {
    summary:
      "Yes when the chosen Pokemon is under the chosen battle effect, such as confusion or Taunt. Example: the foe is infatuated.",
    category: "Status conditions",
  },
  "tag.has-any": {
    summary:
      "Yes when the chosen Pokemon is under at least one of the listed battle effects. Example: Own Tempo looks for confusion or infatuation.",
    category: "Status conditions",
  },
  "tag.trapped": {
    summary:
      "Yes when the chosen Pokemon cannot leave the battle, whatever trapped it. Example: Ingrain, Octolock or a binding move.",
    category: "Status conditions",
  },

  // ---- Stat stages ------------------------------------------------------------------------
  "stage.compare": {
    summary: "Yes when a stat's stage passes the comparison, from -6 to +6. Example: Attack stage at least +2.",
    category: "Stats",
  },
  "stage.just-changed": {
    summary:
      "Yes when the stat change that just happened went up, went down or either. Example: only react when a stat was lowered.",
    category: "Stats",
  },

  // ---- Time and memory --------------------------------------------------------------------
  "time.first-turn": {
    summary: "Yes on the first turn after this Pokemon came out. Example: Fake Out style bonuses.",
    category: "Other",
  },
  "time.turn-count": {
    summary:
      "Yes when the number of turns this Pokemon has been out passes the comparison. Example: Slow Start ends after 5 turns.",
    category: "Other",
  },
  "time.turn-count-multiple": {
    summary: "Yes on every Nth turn this Pokemon has been out. Example: with 2, turns 2, 4, 6 and so on.",
    category: "Other",
  },
  "time.last-move": {
    summary: "Yes when the chosen Pokemon's last move was the one you name. Example: a bonus after using Fire Blast.",
    category: "Moves",
  },
  "time.last-move-flag": {
    summary:
      "Yes when the chosen Pokemon's last move had a property such as sound or contact. Example: Steam Eruption boost after a Fire or Water move.",
    category: "Moves",
  },
  "time.last-move-result": {
    summary:
      "Yes when the chosen Pokemon's last move worked, failed or missed. Example: only if my last move did not fail.",
    category: "Moves",
  },
  "time.last-move-was-follow-up": {
    summary:
      "Advanced: yes when the last move was an extra move an ability triggered, not one the player chose. Example: do not echo an echo move.",
    category: "Moves",
  },
  "time.acted": {
    summary:
      "Yes when the chosen Pokemon has already moved this turn. Example: Analytic checks that the foe moved first.",
    category: "Moves",
  },
  "time.switched-in-this-turn": {
    summary:
      "Yes when the chosen Pokemon came in this turn. Example: Speed Boost does not trigger on the turn I switched in.",
    category: "Switching",
  },
  "time.failed-run-away": {
    summary:
      "Yes when the chosen Pokemon tried to run away this turn and failed. Example: no Speed Boost after a failed escape.",
    category: "Switching",
  },
  "time.once-per": {
    summary:
      "Yes the first time per entry, wave, battle, turn or switch-in, then no until it resets. Example: once per battle.",
    category: "Other",
  },
  "time.once-per-unused": {
    summary:
      "Advanced: yes while a once-per effect is still unused, without using it up. Most rules want 'Only once per'. Example: show a hint while it is unused.",
    category: "Other",
  },
  "time.nth-use": {
    summary: "Yes only on the Nth time this block is reached. Example: the 3rd time a hit lands.",
    category: "Other",
  },
  "time.marker-set": {
    summary:
      "Advanced: yes when a named marker that another block set is on the Pokemon. Example: only if my entry marker is not set yet.",
    category: "Other",
  },

  // ---- Items ------------------------------------------------------------------------------
  "item.holds": {
    summary: "Yes when the chosen Pokemon holds an item, or a berry. Example: Unburden needs a held item to lose.",
    category: "Items",
  },
  "item.none": {
    summary: "Yes when the chosen Pokemon holds no item. Example: Klutz-style bonuses for an empty hand.",
    category: "Items",
  },
  "item.lost": {
    summary:
      "Yes when the chosen Pokemon lost an item or ate a berry earlier in this battle. Example: Unburden after the item is gone.",
    category: "Items",
  },

  // ---- Party and side ---------------------------------------------------------------------
  "side.is": {
    summary: "Yes when the other Pokemon is my ally, a foe or myself. Example: only react to hits from a foe.",
    category: "Other",
  },
  "side.is-player": {
    summary: "Yes when the chosen Pokemon fights on the player's side. Example: a bonus only for my own team.",
    category: "Other",
  },
  "mon.is-first-ally": {
    summary:
      "Advanced: yes when the other Pokemon sits in my partner slot. Most rules want 'The other Pokemon is my ally'. Example: Telepathy ignores my partner.",
    category: "Other",
  },
  "party.ally-exists": {
    summary: "Yes when I have a partner on the field, even a fainted one. Example: doubles-only effects.",
    category: "Other",
  },
  "party.ally-active": {
    summary:
      "Yes when my partner is on the field and can still fight. Example: Costar only copies from an ally that is still fighting.",
    category: "Other",
  },
  "party.ally-ability": {
    summary: "Yes when my partner has the ability you name. Example: Plus works with a partner that has Minus.",
    category: "Other",
  },
  "party.count": {
    summary: "Yes when the number of Pokemon I still have passes the comparison. Example: at most 2 Pokemon left.",
    category: "Other",
  },
  "party.fainted-count": {
    summary:
      "Yes when the number of my fainted Pokemon passes the comparison. Example: at least 3 of my party have fainted.",
    category: "Other",
  },
  "party.bench-count": {
    summary:
      "Yes when the number of healthy Pokemon waiting on my bench passes the comparison. Example: at least 1 reserve.",
    category: "Other",
  },
  "party.last-pokemon": {
    summary: "Yes when this Pokemon is the last one standing on my side. Example: a last-stand boost.",
    category: "Other",
  },
  "party.doubles": {
    summary: "Yes in a double battle. Example: partner effects only matter in doubles.",
    category: "Other",
  },
  "party.multi-battle": {
    summary:
      "Yes when more than one Pokemon fights on each side, double battles included. Example: a spread effect for any multi battle.",
    category: "Other",
  },

  // ---- Pokemon ----------------------------------------------------------------------------
  "mon.has-type": {
    summary: "Yes when the chosen Pokemon has the chosen type. Example: Flying type means grounded checks differ.",
    category: "Types & immunities",
  },
  "mon.opposite-gender": {
    summary:
      "Yes when the other Pokemon is of the opposite gender; genderless never counts. Example: Cute Charm only works across genders.",
    category: "Other",
  },
  "mon.grounded": {
    summary: "Yes when the chosen Pokemon is touching the ground. Example: hazards only hurt grounded Pokemon.",
    category: "Types & immunities",
  },
  "mon.has-ability": {
    summary: "Yes when the chosen Pokemon has the ability you name. Example: the foe has Levitate.",
    category: "Other",
  },
  "mon.protected-from-effects": {
    summary:
      "Yes when the chosen Pokemon is shielded from the extra effects of moves, like Shield Dust. Example: skip the effect if the target has it.",
    category: "Moves",
  },
  "mon.switching-out": {
    summary:
      "Yes when the chosen Pokemon is in the middle of switching out on purpose. Example: Pursuit-style punishment.",
    category: "Switching",
  },
  "mon.ability-ignorable": {
    summary:
      "Yes when my ability can be ignored by effects like Mold Breaker. Example: Levitate can, Wonder Guard cannot.",
    category: "Other",
  },
  "mon.fainted": {
    summary: "Yes when the chosen Pokemon has fainted. Example: only if the other Pokemon already fainted.",
    category: "Other",
  },
  "mon.level": {
    summary:
      "Yes when the chosen Pokemon's level passes the comparison. Example: Schooling stays small below level 20.",
    category: "Other",
  },
  "mon.terastallized": {
    summary: "Yes when the chosen Pokemon is Terastallized. Example: a bonus only while Tera is active.",
    category: "Types & immunities",
  },
  "mon.in-form": {
    summary: "Yes when the chosen Pokemon is in the named form. Example: the Ice Face form.",
    category: "Form changes",
  },
  "mon.in-form-number": {
    summary: "Yes when the chosen Pokemon is in the form with this exact number. Example: form 1 is the second form.",
    category: "Form changes",
  },
  "mon.form-number": {
    summary:
      "Yes when the chosen Pokemon's form number passes the comparison. Example: form 7 or higher, as Shields Down checks.",
    category: "Form changes",
  },
  "mon.can-change-form": {
    summary:
      "Yes when the Pokemon can really go to and come back from the named form. Example: Zen Mode forms that are wired both ways.",
    category: "Form changes",
  },

  // ---- Chance and advanced ----------------------------------------------------------------
  "rng.chance": {
    summary:
      "Yes by chance, with the percent you set, rolled where the original ability rolled it. Example: 30% or 50% chance to paralyze on contact. Use this one.",
    category: "Other",
  },
  "rng.chance-float": {
    summary:
      "Advanced: the same percent, rolled as one decimal number like Harvest, so the game's random numbers shift differently. Most rules want the plain chance.",
    category: "Other",
  },
  "escape.legacy-closure": {
    summary:
      "A rule built into the original ability that has no block of its own yet. It works as one piece and cannot be edited.",
    category: "Other",
  },
  "escape.engine-guard": {
    summary:
      "A locked safety rule that the ability always keeps, such as not acting once fainted. It cannot be removed.",
    category: "Other",
  },

  // ---- Library completion pass, wave A ------------------------------------------------------
  "move.type-is-mine": {
    summary:
      "Yes when the move's type, after any type change, is one of my types. Example: a Fire move used by a Fire and Flying Pokemon is a yes.",
    category: "Types & immunities",
  },
  "stat.is": {
    summary:
      "Yes when the stat the game is working out right now is one you listed. Example: list Speed to change only my Speed.",
    category: "Stats",
  },
  "stat.is-highest": {
    summary:
      "Yes when the stat being worked out is my highest of the listed stats, before stages. A tie goes to the first listed. Example: 120 Attack beats 110 Sp. Atk.",
    category: "Stats",
  },
  "mon.tera-type": {
    summary:
      "Yes when the chosen Pokemon's Tera type is the one you pick, even before it Terastallizes. Example: Terapagos has the Stellar Tera type.",
    category: "Types & immunities",
  },
  "mon.species": {
    summary:
      "Yes when the chosen Pokemon is the species you name, in any form, or is fused with it. Example: only when I am a Terapagos.",
    category: "Other",
  },
  "move.type-counts-as": {
    summary:
      "Yes when the move is the type you pick, or one of my abilities makes it count as that type too. Example: a Fire move for Volcano Rage.",
    category: "Moves",
  },
  "status.asleep-or-comatose": {
    summary:
      "Yes when the chosen Pokemon is asleep, or has an ability like Comatose that makes it count as asleep. Example: Sweet Dreams heals while asleep.",
    category: "Status conditions",
  },
  "move.accuracy": {
    summary:
      "Yes when the move's accuracy passes the comparison. Moves that never miss are always a no. Example: less than 80% is a yes for Focus Blast (70%).",
    category: "Moves",
  },
  "time.hits-taken": {
    summary:
      "Yes when the number of direct hits the chosen Pokemon took this battle passes the comparison. Example: at least 1 hit after the first attack lands.",
    category: "Damage",
  },
  "time.last-move-type": {
    summary:
      "Yes when the chosen Pokemon's last move was of the type you pick. No when it has not moved yet. Example: Energized after an Electric move.",
    category: "Moves",
  },
  "move.sets-weather": {
    summary: "Yes when the move sets a weather, like Rain Dance or Sunny Day. Example: Tackle is a no.",
    category: "Weather & terrain",
  },
  "move.spread": {
    summary:
      "Yes when the move is aimed at more than one Pokemon, like Earthquake or Surf, even if only one is on the field. Example: Tackle is a no.",
    category: "Moves",
  },
  "move.can-be-multi-strike-enhanced": {
    summary:
      "Yes when the move may be given extra strikes, like Parental Bond does. Spread moves, moves that already hit several times and most charge moves are a no.",
    category: "Moves",
  },
  "time.acted-before": {
    summary:
      "Yes when the first Pokemon has already moved this turn and moved before the second one. Example: I moved, the foe has not moved yet.",
    category: "Other",
  },
  "foe.average-defense-not-higher": {
    summary:
      "Yes when the adjacent foes' average Defense is at most their average Sp. Def. Example: Download raises Attack against 80 Defense and 100 Sp. Def.",
    category: "Stats",
  },
  "field.aura-on-field": {
    summary:
      "Yes when any Pokemon on the field has Dark Aura or Fairy Aura, as you pick. Example: Aura Break turns the aura around while Dark Aura is out.",
    category: "Other",
  },
  "move.chosen-is-damaging": {
    summary:
      "Yes when the move I picked for this turn is physical or special. Example: Quick Draw only works when I picked an attack.",
    category: "Moves",
  },
  "party.any-ally-active": {
    summary:
      "Yes when any of my allies is on the field and can still fight, not only the one next to me. Example: in doubles, my partner is fighting.",
    category: "Other",
  },
  "party.active-ally-chose-damaging-move": {
    summary: "Yes when my fighting ally chose to use a damaging move this turn. Example: both of us attack this turn.",
    category: "Moves",
  },
  "time.attacked-this-turn": {
    summary:
      "Yes when the chosen Pokemon moved this turn and its last move was a damaging move. Example: a status move or a skipped turn is a no.",
    category: "Moves",
  },
  "mon.charge-stacks": {
    summary:
      "Yes when the chosen Pokemon's charge stacks pass the comparison. It can hold up to 4. Example: at least 2 stacks for Overloaded.",
    category: "Other",
  },
  "mon.mega-evolved": {
    summary: "Yes when the chosen Pokemon is Mega Evolved. Example: Bejeweled hits harder against a Mega Evolved foe.",
    category: "Form changes",
  },
  "mon.gigantamax-form": {
    summary:
      "Yes when the chosen Pokemon is in a Gigantamax form. Example: Bejeweled hits harder against a Gigantamax foe.",
    category: "Form changes",
  },
  "time.max-uses-per-wave": {
    summary:
      "Advanced: yes while the named counter was used fewer times this wave than the limit. Example: Wishmaker can cast 3 times per wave.",
    category: "Other",
  },
};
