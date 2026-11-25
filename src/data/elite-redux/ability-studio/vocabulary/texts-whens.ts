/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The plain-language summary, browse category and extra search words of every
// WHEN (spec section 8.2 and 8.4). Written by hand by the librarian pass (B19): one concrete sentence per trigger,
// with a real example. `synonyms` only lists words that the trigger did not have yet; texts.ts merges them.

import type { VocabularyText } from "./texts";

export const WHEN_TEXTS: Readonly<Record<string, VocabularyText>> = {
  // ---- Entry and exit ---------------------------------------------------------------------
  "event.on-entry": {
    summary:
      "Runs when this Pokemon comes into the battle, at the start or after a switch. Example: Intimidate lowers the foes' Attack as soon as it enters.",
    category: "Switching",
    synonyms: ["come in", "enters the field", "on entry"],
  },
  "event.ally-entered": {
    summary:
      "Runs when my partner comes onto the field or is revived. Example: Commander hops into an ally Dondozo's mouth the moment Dondozo arrives.",
    category: "Switching",
  },
  "event.foe-enters": {
    summary: "Runs when an opposing Pokemon comes onto the field. Example: answer every new foe with a free move.",
    category: "Switching",
  },
  "event.wild-pokemon-created": {
    summary:
      "Runs while a wild Pokemon is being made for an encounter, before any battle starts. Example: Synchronize gives the wild Pokemon my nature.",
    category: "Other",
    synonyms: ["wild spawn"],
  },
  "event.ability-lost": {
    summary:
      "Runs when this ability is taken away, replaced or switched off while the Pokemon stays on the field. Example: Illusion ends when Gastro Acid hits.",
    category: "Other",
  },
  "event.before-entry": {
    summary:
      "Runs just before this Pokemon appears, while the game still prepares the entry. Example: prepare a disguise before the Pokemon shows up.",
    category: "Switching",
    synonyms: ["before switch in", "pre entry", "about to enter", "just before I enter the battle"],
  },
  "event.battle-start": {
    summary:
      "Runs once when a new battle begins, before the first turn. Example: reset a form at the start of every battle.",
    category: "Other",
    synonyms: ["start of the fight", "first turn setup", "battle begins"],
  },
  "event.after-battle": {
    summary: "Runs once when the battle is over. Example: Pickup-style abilities hand out loot after the win.",
    category: "Other",
    synonyms: ["post battle", "battle over", "after the fight", "after the battle ends"],
  },
  "event.switch-out": {
    summary:
      "Runs when this Pokemon is recalled to the party. Example: Regenerator heals a third of max HP when it switches out.",
    category: "Switching",
    synonyms: ["recall", "withdraw", "regenerator"],
  },
  "event.leave-field": {
    summary:
      "Runs when this Pokemon leaves the field in any way: switching out, fainting or being forced out. Example: end a weather it created.",
    category: "Switching",
  },
  "event.faint": {
    summary:
      "Runs when this Pokemon faints, with the attacker when a move did it. Example: Aftermath hurts the attacker for a quarter of its max HP.",
    category: "Other",
  },
  "event.foe-switches-out": {
    summary: "Runs when an opposing Pokemon is about to switch out. Example: strike a foe with a move as it leaves.",
    category: "Switching",
  },

  // ---- Turn -------------------------------------------------------------------------------
  "event.end-of-turn": {
    summary:
      "Runs at the end of every turn this Pokemon is on the field. Example: Speed Boost raises Speed by 1 stage each turn.",
    category: "Other",
    synonyms: ["end of turn", "end of each turn", "end of every turn", "at the end of the turn", "each turn"],
  },
  "event.turn-start": {
    summary: "Runs at the start of a turn, before anyone moves. Example: choose a free move before the foes act.",
    category: "Other",
    synonyms: ["at the start of the turn", "start of turn", "start of each turn"],
  },
  "event.wake-up": {
    summary: "Runs when this Pokemon wakes from sleep. Example: raise Attack the first time it wakes up.",
    category: "Status conditions",
    synonyms: ["wake up", "stop sleeping", "end of sleep"],
  },
  "event.flinched": {
    summary:
      "Runs when this Pokemon flinches and loses its move. Example: Steadfast raises Speed by 1 stage after a flinch.",
    category: "Status conditions",
    synonyms: ["flinch", "steadfast", "lost its turn"],
  },
  "event.berry-phase-end": {
    summary:
      "Runs after the berries of the turn have been eaten. Example: Cud Chew eats last turn's berry again at this moment.",
    category: "Items",
  },
  "event.berry-eaten": {
    summary: "Runs after this Pokemon eats a berry. Example: Cheek Pouch heals a third of max HP right after a berry.",
    category: "Items",
    synonyms: ["ate a berry", "cheek pouch", "berry used", "after I eat a berry"],
  },

  // ---- Attacking --------------------------------------------------------------------------
  "event.before-i-use-move": {
    summary:
      "Runs just before this Pokemon uses a move, once the move is chosen. Example: change my type to match the move I am about to use.",
    category: "Moves",
    synonyms: ["about to attack", "move chosen", "libero protean", "just before I use a move"],
  },
  "event.my-move-starts": {
    summary:
      "Runs when this Pokemon's chosen move starts to execute. Example: lock the Pokemon into its first move, like Gorilla Tactics.",
    category: "Moves",
    synonyms: ["move begins", "move executes", "when I move", "when my move starts to execute"],
  },
  "event.after-my-hit": {
    summary:
      "Runs after this Pokemon's attack lands on a target. Example: Poison Touch may poison the target after a contact hit.",
    category: "Moves",
    synonyms: ["after my attack lands", "after I hit", "when I hit"],
  },
  "event.on-ko": {
    summary: "Runs after this Pokemon knocks out a Pokemon. Example: Moxie raises Attack by 1 stage after a knockout.",
    category: "Moves",
    synonyms: ["knockout", "knocked out", "after a knockout", "moxie", "beast boost"],
  },
  "event.on-win": {
    summary:
      "Runs for the Pokemon whose attack just knocked another out, once per knockout. Example: +1 Attack after each knockout.",
    category: "Moves",
    synonyms: ["knockout", "ko", "moxie", "made a Pokemon faint"],
  },
  "event.after-any-move": {
    summary: "Runs after any Pokemon on the field uses a move. Example: Dancer copies a dance move that was just used.",
    category: "Moves",
    synonyms: ["someone moved", "dancer", "any move used", "after anyone uses a move"],
  },
  "event.after-inflicting-status": {
    summary:
      "Runs after this Pokemon gives a foe a status condition. Example: confuse a foe right after it gets burned.",
    category: "Status conditions",
    synonyms: ["after I inflict a status", "inflict status", "gave a status"],
  },

  // ---- Being hit --------------------------------------------------------------------------
  "event.after-hit": {
    summary: "Runs after a move has hit this Pokemon. Example: Static may paralyze an attacker that made contact.",
    category: "Damage",
    synonyms: ["hit by", "attacked", "after I am hit", "got hit"],
  },
  "event.after-taking-damage": {
    summary:
      "Runs after this Pokemon takes any damage, from a move or not. Example: Wimp Out switches me out when a hit drops my HP below half.",
    category: "Damage",
    synonyms: ["after taking damage", "after damage", "after I take damage", "after I take any damage"],
  },
  "event.after-crit-taken": {
    summary:
      "Runs when a critical hit lands on this Pokemon. Example: Anger Point raises Attack to the maximum after a critical hit.",
    category: "Damage",
    synonyms: ["critical hit taken", "got crit", "anger point"],
  },
  "event.before-hit-lands": {
    summary:
      "Runs just before a hit lands on this Pokemon, when the game still lets the ability react. Example: change my type to resist the incoming move.",
    category: "Damage",
    synonyms: ["incoming hit", "about to be hit", "before damage", "just before a hit lands on me"],
  },
  "event.got-status": {
    summary:
      "Runs when this Pokemon gets a status condition. Example: Synchronize passes the burn back to whoever caused it.",
    category: "Status conditions",
  },
  "event.item-lost": {
    summary: "Runs when this Pokemon loses its held item. Example: use a free move when my item is knocked off.",
    category: "Items",
  },
  "event.intimidated": {
    summary:
      "Runs when a foe's Intimidate lands on this Pokemon. Example: Competitive raises Sp. Atk by 2 stages after an Intimidate.",
    category: "Stats",
    synonyms: ["intimidate trigger", "scare", "attack drop on entry"],
  },

  // ---- Field ------------------------------------------------------------------------------
  "event.weather-changed": {
    summary: "Runs when the weather changes. Example: Forecast changes Castform's form to match the new weather.",
    category: "Weather & terrain",
    synonyms: ["weather change", "new weather", "rain starts"],
  },
  "event.weather-each-turn": {
    summary:
      "Runs every turn while a weather is active. Example: Rain Dish heals 1/16 of max HP each turn in the rain.",
    category: "Weather & terrain",
    synonyms: ["each turn in weather", "weather tick", "residual weather", "each turn while weather is active"],
  },
  "event.terrain-changed": {
    summary: "Runs when the terrain changes. Example: Quark Drive gets a boost when Electric Terrain is set.",
    category: "Weather & terrain",
    synonyms: ["terrain change", "new terrain", "terrain starts"],
  },
  "event.biome-changed": {
    summary: "Runs when the run moves to a new biome. Example: set the weather again after every biome change.",
    category: "Weather & terrain",
    synonyms: ["new area", "area change", "new biome"],
  },

  // ---- Stat stages ------------------------------------------------------------------------
  "event.stat-changed": {
    summary:
      "Runs when one of this Pokemon's stats goes up or down. Example: Defiant raises Attack by 2 stages when a foe lowers a stat.",
    category: "Stats",
    synonyms: ["stat lowered", "stat raised", "defiant", "stat drop"],
  },
  "event.ally-stat-changed": {
    summary:
      "Runs when one of my partner's stats goes up or down. Example: raise my own Attack when someone lowers my ally's stats.",
    category: "Stats",
    synonyms: ["partner stat change", "ally stat drop", "ally boost"],
  },
  "event.foe-raised-stat": {
    summary: "Runs when a foe raises one of its stats. Example: Opportunist copies the boost for myself.",
    category: "Stats",
  },

  // ---- Calc triggers: damage and power ----------------------------------------------------
  "calc.move-power": {
    summary:
      "Runs while the game works out a move's power, before damage. Example: Technician raises the power of 60-power moves by 1.5.",
    category: "Damage",
  },
  "calc.damage-dealt": {
    summary:
      "Runs while the game works out the damage this Pokemon deals. Example: multiply the damage of every hit by 1.3.",
    category: "Damage",
    synonyms: ["damage output", "deal more damage", "stronger hits"],
  },
  "calc.damage-taken": {
    summary:
      "Runs while the game works out the damage this Pokemon takes. Example: Multiscale halves the damage at full HP.",
    category: "Damage",
    synonyms: ["damage taken", "reduce damage", "less damage", "take less damage"],
  },
  "calc.stab": {
    summary:
      "Runs while the game works out the same-type attack bonus. Example: Adaptability makes the bonus 2x instead of 1.5x.",
    category: "Damage",
    synonyms: ["adaptability", "same type bonus", "stab bonus"],
  },
  "calc.crit-stage": {
    summary: "Runs while the game works out the critical hit level of a move. Example: Super Luck adds 1 level.",
    category: "Damage",
    synonyms: ["crit rate", "crit level", "critical chance"],
  },
  "calc.crit-multiplier": {
    summary:
      "Runs while the game works out how much extra damage a critical hit does. Example: Sniper makes crits hit 1.5 times harder.",
    category: "Damage",
    synonyms: ["crit damage", "critical power", "sniper"],
  },
  "calc.crit-roll": {
    summary:
      "Runs while the game decides whether a hit is critical. Example: always land a critical hit against a poisoned foe, like Merciless.",
    category: "Damage",
    synonyms: ["always crit", "merciless", "guaranteed critical"],
  },
  "calc.hit-count": {
    summary:
      "Runs while the game decides how many times a move hits. Example: Parental Bond adds a second, weaker strike.",
    category: "Damage",
  },
  "calc.max-multi-hit": {
    summary:
      "Runs while the game rolls the hits of a 2 to 5 hit move. Example: Skill Link always gives the maximum 5 hits.",
    category: "Damage",
    synonyms: ["skill link", "always five hits", "max hits"],
  },
  "calc.accuracy": {
    summary:
      "Runs while the game works out how accurate this Pokemon's move is. Example: Compound Eyes multiplies accuracy by 1.3.",
    category: "Moves",
  },
  "calc.incoming-accuracy": {
    summary:
      "Runs while the game works out how accurate a move aimed at this Pokemon is. Example: Wonder Skin makes status moves 50% accurate.",
    category: "Moves",
    synonyms: ["wonder skin", "evasion", "hard to hit"],
  },
  "calc.effect-chance": {
    summary:
      "Runs while the game works out the chance of this Pokemon's move extra effect. Example: Serene Grace doubles it.",
    category: "Moves",
    synonyms: ["serene grace", "extra effect chance", "secondary chance"],
  },
  "calc.incoming-effect-chance": {
    summary:
      "Runs while the game works out the chance of an extra effect against this Pokemon. Example: Shield Dust sets it to 0.",
    category: "Moves",
    synonyms: ["shield dust", "block extra effects", "secondary effects against me"],
  },
  "calc.damage-roll": {
    summary:
      "Runs while the game rolls the random damage spread of a hit. Example: foes always roll the lowest damage against me.",
    category: "Damage",
    synonyms: ["damage spread", "random damage", "damage variance"],
  },
  "calc.weather-type-debuff": {
    summary:
      "Runs while the game applies weather damage changes to a move. Example: a Fire move keeps full power in the rain.",
    category: "Weather & terrain",
    synonyms: ["weather damage change", "rain weakens fire", "sun weakens water"],
  },
  "calc.recoil-taken": {
    summary:
      "Runs while the game works out the recoil this Pokemon takes. Example: Reckless-style abilities scale recoil up or down.",
    category: "Damage",
  },
  "calc.move-category": {
    summary:
      "Runs while the game decides whether a move is physical or special. Example: use the higher of Attack and Sp. Atk to pick.",
    category: "Moves",
  },
  "calc.always-hit-check": {
    summary: "Runs while the game checks whether a move is allowed to miss. Example: No Guard makes every move hit.",
    category: "Moves",
  },
  "calc.incoming-move": {
    summary:
      "Runs while the game prepares a hit against this Pokemon, before type and damage are worked out. Example: block a move that meets a rule.",
    category: "Damage",
    synonyms: ["incoming move", "hit against me", "before damage", "before I take a hit"],
  },
  "calc.outgoing-move": {
    summary:
      "Runs while the game prepares this Pokemon's attack, before type and damage are worked out. Example: change a stat used for the hit.",
    category: "Damage",
    synonyms: ["my attack", "outgoing move", "before my damage", "before I attack"],
  },

  // ---- Calc triggers: move flow -----------------------------------------------------------
  "calc.redirect-move": {
    summary: "Runs while the game picks who a move targets. Example: Lightning Rod draws every Electric move to me.",
    category: "Moves",
  },
  "calc.priority": {
    summary:
      "Runs while the game works out a move's priority. Example: Gale Wings gives Flying moves +1 priority at full HP.",
    category: "Moves",
  },
  "calc.speed-bypass": {
    summary:
      "Runs while the game decides whether this Pokemon jumps the turn order. Example: Quick Claw sometimes lets me move first.",
    category: "Moves",
    synonyms: ["quick claw", "quick draw", "jump the queue"],
  },
  "calc.trap-check": {
    summary:
      "Runs while the game checks whether a foe may switch or run. Example: Arena Trap stops every foe from leaving.",
    category: "Switching",
    synonyms: ["shadow tag", "arena trap", "stop switching"],
  },
  "calc.run-chance": {
    summary:
      "Runs while the game rolls this Pokemon's chance to flee a wild battle. Example: Run Away always succeeds.",
    category: "Switching",
    synonyms: ["flee chance", "run away", "escape chance"],
  },
  "calc.double-battle-chance": {
    summary:
      "Runs while the game rolls whether a wild encounter is a double battle. Example: Arena Trap makes doubles four times as likely.",
    category: "Other",
  },
  "calc.weight": {
    summary:
      "Runs while the game works out this Pokemon's weight. Example: Heavy Metal doubles it, which changes Heavy Slam.",
    category: "Other",
    synonyms: ["heavy metal", "light metal", "weigh more"],
  },
  "calc.burn-damage": {
    summary:
      "Runs while the game works out the damage burn does to this Pokemon at turn end. Example: Heatproof halves it.",
    category: "Status conditions",
    synonyms: ["burn tick", "heatproof", "burn chip damage"],
  },
  "calc.status-duration": {
    summary:
      "Runs while the game works out how long a status lasts. Example: Early Bird makes sleep end twice as fast.",
    category: "Status conditions",
    synonyms: ["early bird", "shorter sleep", "status turns"],
  },
  "calc.berry-effect": {
    summary:
      "Runs while the game works out how much a berry heals. Example: Ripen doubles the healing of berries I eat.",
    category: "Items",
    synonyms: ["ripen", "double berry", "berry healing"],
  },
  "calc.berry-threshold": {
    summary:
      "Runs while the game checks at what HP a pinch berry is eaten. Example: Gluttony eats it at half HP instead of a quarter.",
    category: "Items",
    synonyms: ["gluttony", "early berry", "pinch berry"],
  },

  // ---- Calc triggers: stats ---------------------------------------------------------------
  "calc.stat-value": {
    summary: "Runs while the game works out one of this Pokemon's stats. Example: Huge Power doubles Attack.",
    category: "Stats",
    synonyms: ["swift swim", "huge power", "stat boost"],
  },
  "calc.foe-stat-value": {
    summary: "Runs while the game works out a stat of a foe. Example: an aura that lowers every foe's Speed by 10%.",
    category: "Stats",
    synonyms: ["foe stat", "lower foe speed", "enemy stat aura"],
  },
  "calc.ally-stat-aura": {
    summary:
      "Runs while the game works out a stat of any Pokemon on my side. Example: Plus and Minus-style auras boost my whole team.",
    category: "Stats",
  },
  "calc.ignore-stat-stages": {
    summary:
      "Runs while the game applies a foe's stat changes to the damage. Example: Unaware ignores the foe's boosts.",
    category: "Stats",
    synonyms: ["unaware", "ignore boosts", "ignore drops"],
  },
  "calc.attack-stat": {
    summary:
      "Runs while the game picks the stat my attack uses. Example: Body Press-style abilities attack with Defense.",
    category: "Stats",
  },
  "calc.defensive-stat-substitute": {
    summary:
      "Runs while the game picks the stat this Pokemon defends with. Example: defend with Speed instead of Defense.",
    category: "Stats",
    synonyms: ["defend with another stat", "swap defense", "defensive stat"],
  },
  "calc.defensive-stat-pick": {
    summary:
      "Runs while the game picks which defense of the foe my attack hits. Example: hit the weaker of the foe's Defense and Sp. Def.",
    category: "Stats",
    synonyms: ["foe's defense", "weaker defense", "target defense"],
  },
  "calc.stage-change-amount": {
    summary:
      "Runs while the game works out how many stages a stat change moves. Example: Simple doubles every change, Contrary flips it.",
    category: "Stats",
  },

  // ---- Calc triggers: types ---------------------------------------------------------------
  "calc.my-attack-matchup": {
    summary:
      "Runs while the game rates how well my attack matches the target's types. Example: bone moves hit immune types for full damage.",
    category: "Types & immunities",
    synonyms: ["how well my attack matches the target's types", "attack matchup", "effectiveness of my attack"],
  },
  "calc.move-type": {
    summary: "Runs while the game decides a move's type. Example: Pixilate turns Normal moves into Fairy moves.",
    category: "Types & immunities",
  },
  "calc.type-matchup": {
    summary:
      "Runs while the game works out how well an incoming move matches this Pokemon's types. Example: Tera Shell caps every hit at not very effective.",
    category: "Types & immunities",
  },
  "calc.move-immunity": {
    summary:
      "Runs while the game checks whether a move can hit this Pokemon at all. Example: Levitate blocks Ground moves.",
    category: "Types & immunities",
  },
  "calc.ignore-type-immunity": {
    summary:
      "Runs while the game checks the foe's immunity to my move's type. Example: Scrappy lets Normal moves hit Ghost types.",
    category: "Types & immunities",
  },
  "calc.my-type-chart-override": {
    summary:
      "Runs while the game applies my own type chart to my attacks. Example: my attacks count as super effective against one type.",
    category: "Types & immunities",
    synonyms: ["how well my attacks match", "own type chart", "type chart override"],
  },
  "calc.ability-bypass": {
    summary:
      "Runs while the game decides whether my move ignores the target's ability. Example: Mold Breaker ignores Levitate.",
    category: "Moves",
    synonyms: ["mold breaker", "ignore abilities", "teravolt", "ignore ability"],
  },

  // ---- Cancel checks ----------------------------------------------------------------------
  "cancel.burn-attack-cut": {
    summary:
      "Runs while the game checks whether burn halves my attacks. Example: Guts keeps full strength while burned.",
    category: "Status conditions",
    synonyms: ["guts", "burn attack drop", "frostbite cut", "burn or frostbite weakens my attacks"],
  },
  "cancel.stat-drop": {
    summary:
      "Runs while the game checks whether a stat drop can land on me. Example: Clear Body blocks every drop a foe causes.",
    category: "Stats",
  },
  "cancel.stat-protect": {
    summary:
      "Runs while the game checks whether one of my stats is protected from a drop. Example: Keen Eye protects accuracy.",
    category: "Stats",
  },
  "cancel.stat-protect-field": {
    summary:
      "Runs while the game checks whether a stat of my side is protected. Example: Flower Veil protects Grass-type partners.",
    category: "Stats",
    synonyms: ["flower veil", "partner stat protection", "side stat guard"],
  },
  "cancel.stat-reflect": {
    summary:
      "Runs while the game checks whether a stat drop is bounced back. Example: Mirror Armor sends the drop to the attacker.",
    category: "Stats",
    synonyms: ["mirror armor", "bounce stat drop", "reflect drop"],
  },
  "cancel.intimidate": {
    summary: "Runs while the game checks whether Intimidate lands on me. Example: Inner Focus blocks the Attack drop.",
    category: "Stats",
  },
  "cancel.status": {
    summary: "Runs while the game checks whether a status can land on me. Example: Insomnia blocks sleep.",
    category: "Status conditions",
  },
  "cancel.status-immunity": {
    summary: "Runs while the game checks my immunity to chosen statuses. Example: Limber blocks paralysis.",
    category: "Status conditions",
  },
  "cancel.status-immunity-field": {
    summary:
      "Runs while the game checks whether my side is immune to a status. Example: Sweet Veil keeps my partner awake.",
    category: "Status conditions",
  },
  "cancel.status-type-immunity": {
    summary:
      "Runs while the game checks type-based status immunity. Example: Corrosion poisons Steel and Poison types.",
    category: "Status conditions",
    synonyms: ["corrosion", "poison steel", "type status immunity"],
  },
  "cancel.battle-effect": {
    summary:
      "Runs while the game checks whether a battle effect such as confusion can land on me. Example: Own Tempo blocks confusion.",
    category: "Status conditions",
    synonyms: ["volatile status", "confusion block", "effect immunity"],
  },
  "cancel.battle-effect-immunity": {
    summary:
      "Runs while the game checks my immunity to chosen battle effects. Example: Oblivious blocks infatuation and taunt.",
    category: "Status conditions",
  },
  "cancel.battle-effect-immunity-field": {
    summary:
      "Runs while the game checks whether my side is immune to a battle effect. Example: Aroma Veil protects my partner from Taunt.",
    category: "Status conditions",
    synonyms: ["aroma veil", "partner effect immunity", "ally taunt guard"],
  },
  "cancel.weather-damage": {
    summary:
      "Runs while the game checks whether weather damage hurts me. Example: Sand Veil takes no damage in a sandstorm.",
    category: "Weather & terrain",
  },
  "cancel.weather-effect": {
    summary:
      "Runs while the game checks whether a weather affects me at all. Example: be unaffected by the weather's side effects.",
    category: "Weather & terrain",
    synonyms: ["weather immunity", "unaffected by weather", "ignore weather"],
  },
  "cancel.weather-suppress": {
    summary:
      "Runs while the game checks whether the weather is switched off. Example: Cloud Nine cancels every weather effect.",
    category: "Weather & terrain",
    synonyms: ["cloud nine", "air lock", "no weather"],
  },
  "cancel.interaction": {
    summary:
      "Runs while the game checks whether a move interaction is blocked. Example: block an interaction a move would normally have.",
    category: "Other",
    synonyms: ["block interaction", "cancel", "prevent"],
  },
  "cancel.crit": {
    summary: "Runs while the game checks whether I can be critically hit. Example: Battle Armor blocks critical hits.",
    category: "Damage",
  },
  "cancel.item-theft": {
    summary: "Runs while the game checks whether my held item can be taken. Example: Sticky Hold keeps the item.",
    category: "Items",
    synonyms: ["sticky hold", "item lock", "keep my item"],
  },
  "cancel.indirect-damage": {
    summary:
      "Runs while the game checks whether indirect damage hurts me. Example: Magic Guard blocks poison, weather and recoil damage.",
    category: "Damage",
  },
  "cancel.one-hit-ko": {
    summary: "Runs while the game checks whether a one-hit KO move works on me. Example: Sturdy makes Fissure fail.",
    category: "Damage",
    synonyms: ["sturdy", "ohko immunity", "fissure guard"],
  },
  "cancel.forced-switch": {
    summary:
      "Runs while the game checks whether I can be forced out. Example: Suction Cups ignores Roar and Whirlwind.",
    category: "Switching",
  },
  "cancel.explosive-moves": {
    summary:
      "Runs while the game checks whether explosive moves are blocked. Example: Damp stops Explosion and Self-Destruct.",
    category: "Moves",
    synonyms: ["damp", "no explosions", "stop explosion"],
  },
  "cancel.berry-use": {
    summary:
      "Runs while the game checks whether a berry may be eaten. Example: Unnerve stops the foes from eating berries.",
    category: "Items",
    synonyms: ["unnerve", "block berries", "no berries"],
  },
  "cancel.reflect-status-move": {
    summary: "Runs while the game checks whether a status move is bounced back. Example: Magic Bounce reflects Toxic.",
    category: "Moves",
    synonyms: ["magic bounce", "bounce status", "reflect toxic"],
  },
  "cancel.infiltrate": {
    summary:
      "Runs while the game checks whether my move passes screens and Substitute. Example: Infiltrator ignores Reflect.",
    category: "Moves",
  },

  // ---- Always on --------------------------------------------------------------------------
  "while.active": {
    summary:
      "Always on while this ability is active; the game just looks for it. Example: Levitate keeps the Pokemon off the ground.",
    category: "Other",
  },
};
