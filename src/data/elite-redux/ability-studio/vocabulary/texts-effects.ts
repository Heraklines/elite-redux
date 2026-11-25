/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The plain-language summary, browse category and extra search words of every
// effect (DO block) and every safety rule (guard), spec sections 8.2 and 8.4. Hand-written by the librarian pass (B19).

import type { VocabularyText } from "./texts";

export const EFFECT_TEXTS: Readonly<Record<string, VocabularyText>> = {
  // ---- Damage and power -------------------------------------------------------------------
  "effect.multiply-power": {
    summary: "Multiplies the move's power by the amount you set. Example: 1.5 makes a 60-power move 90 power.",
    category: "Damage",
  },
  "effect.multiply-damage-taken": {
    summary: "Multiplies the damage this Pokemon takes by the amount you set. Example: 0.5 means half damage.",
    category: "Damage",
    synonyms: ["reduce damage", "less damage", "damage taken", "multiscale"],
  },
  "effect.multiply-damage-dealt": {
    summary: "Multiplies the damage this Pokemon deals by the amount you set. Example: 1.3 means 30% more damage.",
    category: "Damage",
  },
  "effect.add-damage": {
    summary: "Adds a fixed amount of damage to the hit. Example: 10 adds 10 HP of damage on top of the normal damage.",
    category: "Damage",
  },
  "effect.cap-damage": {
    summary:
      "Stops one hit from taking more than a share of max HP. Example: 50 means a hit can never take more than half of max HP.",
    category: "Damage",
  },
  "effect.negate": {
    summary: "Blocks the thing being checked, so it does not happen. Example: block a stat drop, a status or a hit.",
    category: "Other",
  },
  "effect.block-crit": {
    summary: "Stops critical hits against this Pokemon. Example: a hit that would crit does normal damage.",
    category: "Damage",
  },
  "effect.set-damage-roll": {
    summary:
      "Makes attacks use a fixed share of their top damage roll. Example: 85 means every hit does the lowest 85% roll.",
    category: "Damage",
  },
  "effect.survive-lethal-hit": {
    summary:
      "Leaves this Pokemon on 1 HP when a hit would knock it out. Example: a 300 damage hit on a 200 HP Pokemon leaves 1 HP.",
    category: "Damage",
  },
  "effect.recoil": {
    summary:
      "Hurts this Pokemon by a share of the damage it deals. Example: 25 means a quarter of the damage dealt comes back.",
    category: "Damage",
  },
  "effect.hurt-percent-of-max-hp": {
    summary:
      "Takes a share of max HP from every foe, or everyone else, except spared types. Example: 0.125 takes an eighth from each foe that is not Poison type.",
    category: "Damage",
  },
  "effect.multiply-ally-damage-taken": {
    summary:
      "Multiplies the damage my partners take by the amount you set. Example: 0.75 means allies take a quarter less, like Friend Guard.",
    category: "Damage",
  },
  "effect.raise-crit-stage": {
    summary:
      "Adds levels to the critical hit rate of the move. Example: +1 level raises the crit chance from 1 in 24 to 1 in 8.",
    category: "Damage",
  },
  "effect.multiply-crit-damage": {
    summary:
      "Makes critical hits do more extra damage. Example: 1.5 makes a 1.5x critical hit 2.25x as strong as a normal hit.",
    category: "Damage",
  },
  "effect.force-crit": {
    summary:
      "Makes the hit a critical hit every time. Example: every hit against a poisoned foe is critical, like Merciless.",
    category: "Damage",
  },
  "effect.hit-n-times": {
    summary: "Adds extra hits to the move. Example: 1 makes a one-hit move strike twice, like Parental Bond.",
    category: "Damage",
  },
  "effect.hit-random-times": {
    summary:
      "Makes the move hit a random number of times, from 2 to 5 as the game usually rolls. Example: like Bullet Seed.",
    category: "Damage",
  },
  "effect.add-stab-bonus": {
    summary:
      "Adds a number to the same-type bonus the move already has. Example: +0.5 turns a 1.5x bonus into 2x, like Adaptability.",
    category: "Damage",
  },
  "effect.grant-stab": {
    summary:
      "Treats the move as the same type as the user and sets that bonus. Example: 1.5 gives a Fire move the bonus on a Water Pokemon.",
    category: "Damage",
  },
  "effect.set-power": {
    summary:
      "Sets the move's power to exactly the number you give. Example: 50 gives the move 50 power whatever it had.",
    category: "Damage",
  },
  "effect.multiply-stat-changes": {
    summary:
      "Multiplies every stat change this Pokemon gets. Example: 2 doubles +1 to +2 (Simple); -1 flips +1 to -1 (Contrary).",
    category: "Stats",
  },

  // ---- Stats ------------------------------------------------------------------------------
  "effect.multiply-stat": {
    summary:
      "Multiplies one of this Pokemon's stats by the amount you set. Example: 2 on Attack doubles it, like Huge Power.",
    category: "Stats",
    synonyms: ["swift swim", "double speed", "multiply attack"],
  },
  "effect.stat-stage": {
    summary: "Raises or lowers one stat by a number of stages. Example: +1 on Attack, or -1 on a foe's Speed.",
    category: "Stats",
    synonyms: [
      "raise attack",
      "lower attack",
      "raise defense",
      "lower defense",
      "raise speed",
      "lower speed",
      "raise sp. atk",
      "raise special attack",
      "lower sp. atk",
      "raise sp. def",
      "raise special defense",
      "lower sp. def",
      "raise evasion",
      "lower evasion",
      "raise accuracy",
      "lower accuracy",
      "speed boost",
      "attack down",
      "defense down",
      "speed down",
      "attack up",
    ],
  },
  "effect.stat-stages": {
    summary: "Raises or lowers several stats at once. Example: Attack and Sp. Atk +1 together, like Anger Shell.",
    category: "Stats",
  },
  "effect.reset-stat-stages": {
    summary:
      "Sets every stat change of the target back to 0. Example: a foe at +2 Attack and -1 Speed ends at 0 and 0, like Haze.",
    category: "Stats",
  },
  "effect.ignore-stat-changes": {
    summary:
      "Ignores the foe's stat boosts and drops while working out damage. Example: Unaware plays as if the foe were at +0.",
    category: "Stats",
  },

  // ---- Accuracy and priority --------------------------------------------------------------
  "effect.always-hit": {
    summary: "Makes the move never miss. Example: No Guard.",
    category: "Moves",
  },
  "effect.multiply-accuracy-against-me": {
    summary: "Multiplies the accuracy of moves aimed at this Pokemon. Example: 0.8 makes foes 20% less accurate.",
    category: "Moves",
  },
  "effect.raise-base-accuracy": {
    summary: "Lifts a move's accuracy to at least a number, never lowering it. Example: 90 turns a 70% move into 90%.",
    category: "Moves",
  },
  "effect.change-priority": {
    summary: "Adds a number to the move's priority. Example: +1 makes it go before normal moves.",
    category: "Moves",
  },
  "effect.lift-slow-move-priority": {
    summary:
      "Makes slow-priority moves normal and gives other moves +1 priority. Example: turns -1 into 0 and 0 into +1.",
    category: "Moves",
  },
  "effect.set-turn-order-place": {
    summary:
      "Puts the move first, normal or last among moves with the same priority. Example: Last for status moves, like Mycelium Might.",
    category: "Moves",
  },
  "effect.change-move-category": {
    summary: "Changes the move to physical or special damage. Example: slicing moves hit with Sp. Atk.",
    category: "Moves",
  },
  "effect.multiply-effect-chance": {
    summary:
      "Multiplies the chance of a move's extra effect, capped at 100%. Example: 2 turns 30% into 60%, like Serene Grace.",
    category: "Moves",
  },
  "effect.bypass-protections": {
    summary: "Lets the move pass screens, Substitute, Safeguard and Mist. Example: Infiltrator hits through Reflect.",
    category: "Moves",
  },
  "effect.reflect-move": {
    summary:
      "Bounces a status move back at the Pokemon that used it. Example: Toxic aimed at me poisons the user, like Magic Bounce.",
    category: "Moves",
  },
  "effect.ignore-target-abilities": {
    summary:
      "Makes the move ignore the target's ability. Example: Earthquake hits a Levitate Pokemon, like Mold Breaker.",
    category: "Moves",
  },
  "effect.scripted-move": {
    summary:
      "Uses a free follow-up move of your choice with the power you set. Example: Surf at 50 power after being hit.",
    category: "Moves",
  },
  "effect.spend-first-move-bonus": {
    summary: "Uses up the one-time bonus of my first move. Example: after the bonus is used, the next move is normal.",
    category: "Moves",
  },
  "effect.restore-first-move-bonus": {
    summary: "Gives back the one-time bonus of my first move. Example: using a chosen move rearms the bonus.",
    category: "Moves",
  },

  // ---- Types and immunities ---------------------------------------------------------------
  "effect.immune-to-type": {
    summary: "Makes this Pokemon immune to moves of one type. Example: Ground gives Levitate-like immunity.",
    category: "Types & immunities",
  },
  "effect.change-move-type": {
    summary: "Changes the move's type to the type you pick. Example: turn a Normal move into a Fairy move.",
    category: "Types & immunities",
  },
  "effect.cap-type-matchup": {
    summary:
      "Limits how effective attacks are against this Pokemon. Example: 0.5 means no hit is better than not very effective.",
    category: "Types & immunities",
  },
  "effect.set-matchup": {
    summary:
      "Makes an immune matchup count as a set number. Example: 1 makes an immune matchup a normal hit, like Scrappy.",
    category: "Types & immunities",
  },
  "effect.ignore-type-immunity": {
    summary: "Lets the move hit foes that are normally immune to its type. Example: Normal moves hit Ghost types.",
    category: "Types & immunities",
  },
  "effect.ignore-status-type-immunity": {
    summary: "Lets a status land on types that normally block it. Example: poison a Steel type, like Corrosion.",
    category: "Types & immunities",
  },
  "effect.change-own-type": {
    summary:
      "Changes a Pokemon's type to one type or the move's type; the other Pokemon needs a trigger with one. Example: become Fire type after a Fire move hits me.",
    category: "Types & immunities",
  },
  "effect.add-type": {
    summary: "Gives a Pokemon an extra type on top of its own. Example: the attacker gains Ghost type.",
    category: "Types & immunities",
  },

  // ---- Healing ----------------------------------------------------------------------------
  "effect.heal-percent": {
    summary: "Restores a whole percent of max HP. Example: 25 heals a quarter of max HP.",
    category: "Healing",
  },
  "effect.heal-fraction-of-max-hp": {
    summary:
      "Restores one part of max HP, such as an eighth or a sixteenth. Example: 8 heals 1/8 of max HP, at least 1 HP.",
    category: "Healing",
  },
  "effect.drain": {
    summary:
      "Heals this Pokemon by a share of the damage it dealt. Example: 50 heals half the damage dealt, like Drain Punch.",
    category: "Healing",
  },
  "effect.restore-eaten-berry": {
    summary:
      "Brings back a berry this Pokemon ate earlier so it can eat it again. Example: Harvest at the end of a turn.",
    category: "Items",
  },

  // ---- Status conditions ------------------------------------------------------------------
  "effect.inflict-status": {
    summary: "Gives the chosen Pokemon a status condition. Example: burn the attacker.",
    category: "Status conditions",
  },
  "effect.cure-status": {
    summary:
      "Cures a status condition, or any status, of the chosen Pokemon or of everyone on my side. Example: cure my own paralysis when I enter.",
    category: "Status conditions",
  },
  "effect.apply-tag": {
    summary: "Puts a battle effect such as confusion or Taunt on the chosen Pokemon. Example: confuse the attacker.",
    category: "Status conditions",
    synonyms: ["flinch", "make it flinch", "infatuate"],
  },
  "effect.remove-tag": {
    summary: "Removes a battle effect from the chosen Pokemon. Example: shake off confusion when I enter.",
    category: "Status conditions",
  },
  "effect.change-status-duration": {
    summary:
      "Shortens how long a status lasts each time it is counted. Example: 1 turn off sleep each count, like Early Bird.",
    category: "Status conditions",
  },
  "effect.multiply-burn-damage": {
    summary: "Multiplies the damage burn does to this Pokemon each turn. Example: 0.5 halves it, 0 removes it.",
    category: "Status conditions",
  },

  // ---- Weather and terrain ----------------------------------------------------------------
  "effect.set-weather": {
    summary:
      "Changes the weather. Turns 0 keeps the usual length; another number sets how many turns it lasts. Example: Rain for 8 turns when I enter, like Drizzle.",
    category: "Weather & terrain",
  },
  "effect.clear-weather": {
    summary:
      "Ends the current weather. By default extreme weather like Heavy Rain stays; turn that off to end it too. Example: Cloud Nine on entry.",
    category: "Weather & terrain",
  },
  "effect.set-terrain": {
    summary:
      "Changes the terrain. Turns 0 keeps the usual length; another number sets how many turns it lasts. Example: Electric Terrain for 8 turns, like Electric Surge.",
    category: "Weather & terrain",
  },
  "effect.arena-tag": {
    summary: "Sets a field effect such as Reflect or Spikes on a side. Example: put Light Screen on my side.",
    category: "Weather & terrain",
  },
  "effect.follow-weather-form": {
    summary:
      "Changes every weather-form Pokemon on the field to match the weather. Example: Castform turns into its Rain form.",
    category: "Form changes",
  },
  "effect.weather-forms-to-normal": {
    summary:
      "Sends every weather-form Pokemon on the field back to its normal form. Example: Castform returns to normal.",
    category: "Form changes",
  },

  // ---- Switching --------------------------------------------------------------------------
  "effect.force-switch-out": {
    summary: "Switches this Pokemon out for another party member. Example: Wimp Out and Emergency Exit.",
    category: "Switching",
  },
  "effect.more-double-battles": {
    summary:
      "Makes wild double battles four times as likely. Example: a 1 in 8 chance becomes 1 in 2, like Arena Trap.",
    category: "Other",
  },

  // ---- Form changes -----------------------------------------------------------------------
  "effect.change-form": {
    summary: "Changes this Pokemon to the named form. Example: go to the Ape form when HP is low.",
    category: "Form changes",
  },
  "effect.ability-form-change": {
    summary: "Changes to the form the species lists for this ability. Example: Disguise or Ice Face forms.",
    category: "Form changes",
  },
  "effect.return-base-form": {
    summary: "Sends this Pokemon back to its base form. Example: leave the Ape form once HP is back up.",
    category: "Form changes",
  },
  "effect.trigger-ability-form-change": {
    summary:
      "Changes to the form the species lists for this ability, as the game does when the ability triggers. Example: Zen Mode.",
    category: "Form changes",
  },

  // ---- Items ------------------------------------------------------------------------------
  "effect.remove-item": {
    summary: "Takes the chosen Pokemon's held item away so it is gone. Example: knock off the attacker's item.",
    category: "Items",
  },
  "effect.steal-item": {
    summary:
      "Takes a random held item for myself from the other Pokemon (needs a trigger with one), or from any foe. Example: steal a berry from the foe I hit.",
    category: "Items",
  },
  "effect.use-item": {
    summary: "Uses my own held item right now. Example: eat my berry the moment it is needed.",
    category: "Items",
  },
  "effect.reveal-held-items": {
    summary: "Shows what each foe is holding. Example: Frisk shows the items when I enter.",
    category: "Items",
  },
  "effect.raise-berry-threshold": {
    summary:
      "Eats pinch berries at twice the usual HP level. Example: a berry that waits for 25% HP is eaten at 50%, like Gluttony.",
    category: "Items",
  },
  "effect.multiply-berry-effect": {
    summary: "Multiplies how much the berries I eat heal. Example: 2 doubles a berry's healing, like Ripen.",
    category: "Items",
  },

  // ---- Other ------------------------------------------------------------------------------
  "effect.multiply-weight": {
    summary: "Multiplies this Pokemon's weight. Example: 2 doubles it, like Heavy Metal.",
    category: "Other",
  },
  "effect.copy-nature": {
    summary: "Gives the other Pokemon my nature. Example: a wild Pokemon takes my nature, like Synchronize.",
    category: "Other",
  },
  "effect.faint-self": {
    summary: "Makes this Pokemon faint on the spot. Example: faint after the attack, like Explosion.",
    category: "Other",
  },
  "effect.faint-other": {
    summary: "Makes the other Pokemon faint on the spot. Example: take down the attacker that knocked me out.",
    category: "Other",
  },
  "effect.message": {
    summary:
      "Shows a line of text in the battle log, or a built-in announcement with my name. Example: Pressure's entry message.",
    category: "Other",
  },
  "effect.arm-effect": {
    summary: "Prepares another effect to happen later. Example: arm a bonus now and spend it on the next move.",
    category: "Other",
  },
  "effect.package": {
    summary:
      "A one-off mechanic that works as one piece and cannot be taken apart. It keeps its own settings and can be reused whole.",
    category: "Other",
  },

  // ---- Library completion pass (wave C) ------------------------------------------------------
  "effect.add-stat-share": {
    summary:
      "Adds a share of one of my stats to the stat being calculated, or uses it instead. Example: 0.2 of my 100 Speed adds 20 to my Attack.",
    category: "Stats",
  },
  "effect.multiply-stat-per-fainted-ally": {
    summary:
      "Raises the stat for every fainted teammate, not counting me. Example: 0.05 with 2 fainted teammates gives 10% more.",
    category: "Stats",
  },
  "effect.set-accuracy": {
    summary:
      "Raises a move's accuracy to the number you set, never lowering it. Example: 90 turns Hypnosis from 60% into 90%.",
    category: "Moves",
  },
  "effect.ignore-secondary-effects": {
    summary:
      "Sets the chance of a move's extra effect to zero. Example: Flamethrower aimed at me can never burn, like Shield Dust.",
    category: "Moves",
  },
  "effect.multiply-power-per-count": {
    summary:
      "Raises the move's power for each counted thing, up to a limit. Example: 5% per healthy benched teammate, 3 waiting gives 15% more.",
    category: "Damage",
  },
  "effect.multiply-accuracy-per-count": {
    summary:
      "Raises the move's accuracy for each counted thing, up to a limit. Example: 5% per healthy benched teammate.",
    category: "Moves",
  },
  "effect.use-weaker-defense": {
    summary:
      "Makes my attack use the lower of the foe's Defense and Sp. Def. Example: a crit on a foe with 100 Def and 60 Sp. Def uses 60.",
    category: "Stats",
  },
  "effect.trap-foe": {
    summary:
      "Keeps the foe from fleeing or switching out. Ghost types and Run Away users always escape. Example: Arena Trap.",
    category: "Switching",
  },
  "effect.jump-turn-order": {
    summary:
      "Lets me act before others that picked moves of the same priority this turn. Example: Quick Draw going first.",
    category: "Moves",
  },
  "effect.reflect-stat-drop": {
    summary:
      "Blocks a stat drop and gives it to the Pokemon that caused it. Example: an Intimidate aimed at me lowers the user's Attack, like Mirror Armor.",
    category: "Stats",
  },
  "effect.scripted-move-at": {
    summary:
      "Uses a free move at a foe, every foe, me or its normal targets; aims at the other Pokemon need a trigger with one. Example: Spikes when I enter.",
    category: "Moves",
  },
  "effect.cancel-recharge": {
    summary:
      "Ends my recharge turn so I can act next turn. Example: after Hyper Beam knocks out a foe, no recharge turn, like Rampage.",
    category: "Moves",
  },
  "effect.remove-type": {
    summary:
      "Takes one type from a Pokemon and keeps its others; the other Pokemon needs a trigger with one. Example: a Water and Ghost foe I hit becomes only Water.",
    category: "Types & immunities",
  },
  "effect.stat-stage-on-highest": {
    summary:
      "Changes whichever listed stat is highest; the other Pokemon needs a trigger with one. Example: Attack 120 and Sp. Atk 90 means Attack goes up by 1.",
    category: "Stats",
  },
  "effect.drain-adjacent-foes": {
    summary:
      "Takes a share of max HP from each adjacent foe and heals me by what they lost. Example: 0.125 takes an eighth every turn.",
    category: "Healing",
  },
  "effect.force-other-out": {
    summary:
      "Makes the other Pokemon switch out for a party member. Example: the attacker is dragged out after hitting me.",
    category: "Switching",
  },
  "effect.set-marker": {
    summary:
      "Puts a named reminder on me for the battle, this switch-in or this turn, so a condition can check it. Example: remember a trap was used.",
    category: "Other",
  },
  "effect.clear-marker": {
    summary: "Removes a named reminder from me. Example: forget a stored charge when I enter again.",
    category: "Other",
  },
  "effect.change-charge-stacks": {
    summary:
      "Adds or spends my stored electric charges, at most 4 at a time. Example: add 1 when an Electric move hits me.",
    category: "Other",
  },
  "effect.drain-pp": {
    summary: "Takes PP from one of the other Pokemon's moves. Example: the move that hit me loses 4 PP, like Spiteful.",
    category: "Moves",
  },
  "effect.match-weather-form": {
    summary: "Changes me into the form that matches the weather. Example: Castform turns into its Rainy form in rain.",
    category: "Form changes",
  },
  "effect.give-ability": {
    summary:
      "Replaces the other Pokemon's ability with the one you name. Example: an attacker that touches me gets Mummy.",
    category: "Other",
  },
  "effect.remove-arena-tags": {
    summary:
      "Removes field effects from a side: screens, Smokescreen, Spikes, Toxic Spikes, Stealth Rock, Sticky Web or Tailwind. The other Pokemon's side needs a trigger with one. Example: Screen Cleaner.",
    category: "Weather & terrain",
  },
};

export const GUARD_TEXTS: Readonly<Record<string, VocabularyText>> = {
  "not-own-hp-cost-move": {
    summary:
      "Locked safety rule: does nothing when the HP was spent by my own move. Example: Belly Drum does not trigger Wimp Out.",
    category: "Damage",
    synonyms: ["self inflicted", "own move cost"],
  },
  "not-already-forced-out": {
    summary:
      "Locked safety rule: does nothing when the attacker's move already forces a switch. Example: Dragon Tail already moved me out.",
    category: "Switching",
  },
  "sheer-force-negates": {
    summary:
      "Locked safety rule: does nothing when the attacker's move is boosted by Sheer Force. Example: a Sheer Force Flamethrower leaves the effect off.",
    category: "Moves",
    synonyms: ["no secondary effects", "sheer force boosted"],
  },
  "after-final-hit": {
    summary:
      "Locked safety rule: waits for the last hit of a multi-hit move against me. Example: Bullet Seed with 5 hits triggers after hit 5.",
    category: "Damage",
  },
  "not-fainted": {
    summary:
      "Locked safety rule: does nothing once this Pokemon has fainted. Example: a fainted Pokemon never changes form.",
    category: "Other",
  },
  "weather-form-species-only": {
    summary: "Locked safety rule: only Castform with Forecast and Cherrim with Flower Gift can change weather form.",
    category: "Form changes",
  },
  "not-blocked-by-effect-shield": {
    summary:
      "Locked safety rule: skips a target that ignores extra effects, like Shield Dust. Example: no flinch on a Shield Dust Pokemon.",
    category: "Moves",
  },
  "not-self-target": {
    summary:
      "Locked safety rule: does nothing when the move's target is the user. Example: an effect meant for foes never lands on me.",
    category: "Moves",
  },
  "status-set-by-a-pokemon": {
    summary:
      "Locked safety rule: needs a Pokemon that caused the status. Example: a burn from weather has no one to pass it back to.",
    category: "Status conditions",
  },
  "hit-connected": {
    summary: "Locked safety rule: only reacts when the hit connected. Example: a missed or blocked move does nothing.",
    category: "Damage",
  },
  "hit-connected-on-another-pokemon": {
    summary:
      "Locked safety rule: only reacts when the hit connected on a different Pokemon. Example: a hit on myself does not count.",
    category: "Damage",
  },
  "hit-dealt-damage": {
    summary:
      "Locked safety rule: only reacts when the hit took away more than 0 HP. Example: a hit on a Substitute is ignored.",
    category: "Damage",
  },
  "hit-on-another-living-target": {
    summary:
      "Locked safety rule: only reacts when the move hurt a different Pokemon that is still standing. Example: not on a fainted target.",
    category: "Damage",
  },
  "after-my-final-hit": {
    summary:
      "Locked safety rule: waits for the last hit of my own multi-hit move. Example: Triple Axel triggers after hit 3.",
    category: "Damage",
  },
  "knocked-out-by-a-move": {
    summary:
      "Locked safety rule: needs a Pokemon's move to have knocked me out. Example: poison or weather faints do not count.",
    category: "Damage",
  },
  "attacker-still-standing": {
    summary:
      "Locked safety rule: does nothing when the attacker already fainted. Example: no retaliation against a fainted foe.",
    category: "Damage",
  },
  "credited-with-the-knock-out": {
    summary:
      "Locked safety rule: only I get the reward for a knockout I caused. Example: bystanders do not heal when a foe faints.",
    category: "Damage",
  },
  "not-protected-from-indirect-damage": {
    summary:
      "Locked safety rule: does nothing to a Pokemon protected from indirect damage. Example: Magic Guard ignores the chip damage.",
    category: "Damage",
  },
  // ---- Library completion pass (wave B) -----------------------------------------------------
  "not-simulated": {
    summary:
      "Locked safety rule: does nothing while the game only previews the move. Example: no dice roll and no memory while the computer opponent looks ahead.",
    category: "Other",
  },
  "another-holder-keeps-weather": {
    summary:
      "Locked safety rule: keeps the weather while another Pokemon on the field holds it up. Example: Heavy Rain stays while a second Primordial Sea is out.",
    category: "Weather & terrain",
  },
  "foe-can-be-trapped": {
    summary:
      "Locked safety rule: never traps a Ghost type or a Pokemon that can always run. Example: a Ghost foe escapes Arena Trap.",
    category: "Switching",
  },
};
