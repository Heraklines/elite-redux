export enum BattlerTagType {
  RECHARGING = "RECHARGING",
  FLINCHED = "FLINCHED",
  INTERRUPTED = "INTERRUPTED",
  CONFUSED = "CONFUSED",
  INFATUATED = "INFATUATED",
  SEEDED = "SEEDED",
  NIGHTMARE = "NIGHTMARE",
  FRENZY = "FRENZY",
  CHARGING = "CHARGING",
  ENCORE = "ENCORE",
  HELPING_HAND = "HELPING_HAND",
  INGRAIN = "INGRAIN",
  OCTOLOCK = "OCTOLOCK",
  AQUA_RING = "AQUA_RING",
  DROWSY = "DROWSY",
  TRAPPED = "TRAPPED",
  BIND = "BIND",
  WRAP = "WRAP",
  FIRE_SPIN = "FIRE_SPIN",
  WHIRLPOOL = "WHIRLPOOL",
  CLAMP = "CLAMP",
  SAND_TOMB = "SAND_TOMB",
  MAGMA_STORM = "MAGMA_STORM",
  SNAP_TRAP = "SNAP_TRAP",
  THUNDER_CAGE = "THUNDER_CAGE",
  INFESTATION = "INFESTATION",
  PROTECTED = "PROTECTED",
  SPIKY_SHIELD = "SPIKY_SHIELD",
  KINGS_SHIELD = "KINGS_SHIELD",
  OBSTRUCT = "OBSTRUCT",
  SILK_TRAP = "SILK_TRAP",
  MIND_READER = "MIND_READER",
  BANEFUL_BUNKER = "BANEFUL_BUNKER",
  BURNING_BULWARK = "BURNING_BULWARK",
  /** ER (Merculight): a full protect that paralyzes contact attackers. */
  ER_PARALYZING_SHIELD = "ER_PARALYZING_SHIELD",
  /** ER (Tangling Husk, dex 955): a protect that lets Fire-type moves through and drops -1 Speed on non-Fire contact. */
  ER_TANGLING_HUSK = "ER_TANGLING_HUSK",
  ENDURING = "ENDURING",
  STURDY = "STURDY",
  PERISH_SONG = "PERISH_SONG",
  TRUANT = "TRUANT",
  SLOW_START = "SLOW_START",
  PROTOSYNTHESIS = "PROTOSYNTHESIS",
  QUARK_DRIVE = "QUARK_DRIVE",
  FLYING = "FLYING",
  UNDERGROUND = "UNDERGROUND",
  UNDERWATER = "UNDERWATER",
  HIDDEN = "HIDDEN",
  FIRE_BOOST = "FIRE_BOOST",
  CRIT_BOOST = "CRIT_BOOST",
  ALWAYS_CRIT = "ALWAYS_CRIT",
  IGNORE_ACCURACY = "IGNORE_ACCURACY",
  IGNORE_FLYING = "IGNORE_FLYING",
  SALT_CURED = "SALT_CURED",
  CURSED = "CURSED",
  CHARGED = "CHARGED",
  ROOSTED = "ROOSTED",
  FLOATING = "FLOATING",
  MINIMIZED = "MINIMIZED",
  DESTINY_BOND = "DESTINY_BOND",
  CENTER_OF_ATTENTION = "CENTER_OF_ATTENTION",
  STOCKPILING = "STOCKPILING",
  RECEIVE_DOUBLE_DAMAGE = "RECEIVE_DOUBLE_DAMAGE",
  ALWAYS_GET_HIT = "ALWAYS_GET_HIT",
  DISABLED = "DISABLED",
  SUBSTITUTE = "SUBSTITUTE",
  IGNORE_GHOST = "IGNORE_GHOST",
  IGNORE_DARK = "IGNORE_DARK",
  GULP_MISSILE_ARROKUDA = "GULP_MISSILE_ARROKUDA",
  GULP_MISSILE_PIKACHU = "GULP_MISSILE_PIKACHU",
  BEAK_BLAST_CHARGING = "BEAK_BLAST_CHARGING",
  SHELL_TRAP = "SHELL_TRAP",
  DRAGON_CHEER = "DRAGON_CHEER",
  NO_RETREAT = "NO_RETREAT",
  GORILLA_TACTICS = "GORILLA_TACTICS",
  UNBURDEN = "UNBURDEN",
  THROAT_CHOPPED = "THROAT_CHOPPED",
  TAR_SHOT = "TAR_SHOT",
  BURNED_UP = "BURNED_UP",
  DOUBLE_SHOCKED = "DOUBLE_SHOCKED",
  AUTOTOMIZED = "AUTOTOMIZED",
  MYSTERY_ENCOUNTER_POST_SUMMON = "MYSTERY_ENCOUNTER_POST_SUMMON",
  POWER_TRICK = "POWER_TRICK",
  HEAL_BLOCK = "HEAL_BLOCK",
  TORMENT = "TORMENT",
  TAUNT = "TAUNT",
  IMPRISON = "IMPRISON",
  SYRUP_BOMB = "SYRUP_BOMB",
  ELECTRIFIED = "ELECTRIFIED",
  TELEKINESIS = "TELEKINESIS",
  COMMANDED = "COMMANDED",
  GRUDGE = "GRUDGE",
  PSYCHO_SHIFT = "PSYCHO_SHIFT",
  ENDURE_TOKEN = "ENDURE_TOKEN",
  POWDER = "POWDER",
  MAGIC_COAT = "MAGIC_COAT",
  SUPREME_OVERLORD = "SUPREME_OVERLORD",
  BYPASS_SPEED = "BYPASS_SPEED",
  // ER-specific battler tags. Modelled as battler tags rather than vanilla
  // {@linkcode StatusEffect} entries to avoid mutating pokerogue's primary
  // status enum (which would cascade through save loaders, sprite picks,
  // status-immunity tables, etc). Semantic depth varies — BLEED is HP chip,
  // FROSTBITE/FEAR currently stub minimal flag-bearing tags so dispatch
  // can route. See {@linkcode BleedTag} et al. in `battler-tags.ts`.
  ER_BLEED = "ER_BLEED",
  ER_FROSTBITE = "ER_FROSTBITE",
  ER_FEAR = "ER_FEAR",
  /**
   * ER Frisk's "disable held items" rider. While present, the holder's
   * {@linkcode PokemonHeldItemModifier}s do not apply (berries, leftovers,
   * choice items, etc.). Mega Stones / form-change items are unaffected since
   * they are not gated through the held-item apply path.
   */
  ER_ITEM_DISABLED = "ER_ITEM_DISABLED",
  /**
   * Silken Decree's one-turn random move seal. Unlike vanilla Disable, this can
   * seal multiple selected moves and expires after the affected Pokemon's next
   * turn.
   */
  ER_SILKEN_DECREE = "ER_SILKEN_DECREE",
  /**
   * ER Ice Statue (applied by Hollow Ice Zone's Ice-type moves). The holder's
   * typing becomes pure Ice, but — unlike a real Ice-type — it gains NO
   * resistances (any incoming type multiplier below 1 is treated as neutral)
   * and LOSES the Ice-type immunity to frostbite. Persists until the holder
   * switches out.
   */
  ER_ICE_STATUE = "ER_ICE_STATUE",
  /**
   * Elite Redux Parasitic Spores (ability 609): the contact-spread infection.
   * The holder's contact moves apply this to the target; each turn-end the
   * bearer loses 1/8 max HP (Ghost types immune). Persists until the bearer
   * switches out. Independent of the ER "major status" tags (BLEED/FROSTBITE/
   * FEAR) — a spored mon can still be bled/frozen/etc.
   */
  ER_PARASITIC_SPORES = "ER_PARASITIC_SPORES",
  /**
   * ER Trepidation's "Despair" seal. Applied to the foe for 3 turns; while
   * present, EVERY Psychic-type move the holder USES misses (forced in the
   * move hit-check). Serializable so it survives a mid-battle save.
   */
  ER_DESPAIR = "ER_DESPAIR",
  /**
   * Elite Redux Drenched (2.65): a water-soaked debuff applied by the Water-move
   * drench chances (Water Gun, Hydro Pump, Surf, Waterlog, ...). While present,
   * the holder moves LAST within its move-priority bracket (checked in
   * {@linkcode Move.getPriorityModifier}) for 2 turns. It respects priority
   * brackets — a higher-priority move still outspeeds — unlike a full Quash.
   * Immune: Water-type Pokemon, water-immune abilities (Water Absorb / Dry Skin /
   * Storm Drain), and {@linkcode DrenchImmunityAbAttr} (Amphibious, Old Mariner).
   * Independent of the ER major-status tags (BLEED/FROSTBITE/FEAR).
   */
  ER_DRENCHED = "ER_DRENCHED",
  /**
   * Elite Redux Enrage (2.65): the bearer takes 33% of the damage it deals with
   * its moves as recoil (applied after each of its moves; see {@linkcode
   * ErEnrageTag}), and its moves are treated as recoil moves so Reckless boosts
   * them. Lasts until the bearer switches out. Recoil is blocked by the same
   * abilities that block move recoil (Rock Head / Steel Barrel / Brute Force via
   * {@linkcode BlockRecoilDamageAttr}). Inflicted by Swagger, Flatter, Incite,
   * Berserk DNA, etc.
   */
  ER_ENRAGE = "ER_ENRAGE",
  /**
   * Elite Redux Quashed: the bearer moves LAST within its priority bracket
   * (checked in {@linkcode Move.getPriorityModifier}, the same path as
   * ER_DRENCHED) for a fixed number of turns. Applied by Know Your Place's
   * contact attacks (5 turns). No HP effect; independent of the ER status tags.
   */
  ER_QUASHED = "ER_QUASHED",
  /**
   * Elite Redux "empower the switch-in" (Ghastly Echo, dex 848). Applied to the
   * Pokemon sent out after Ghastly Echo's user force-switches itself out; grants
   * the holder x1.5 MOVE POWER (read in {@linkcode Move.getPower}, the same hook
   * as ER_ENRAGE) for its FIRST move, then lapses (BattlerTagLapseType.TURN_END,
   * turnCount 2 — it is summoned mid-turn, so it survives the summon turn's
   * turn-end and expires at the end of its first acting turn). Armed + consumed
   * via the per-side pending latch in `empower-switch-in.ts`. Not serialized
   * (transient effect).
   */
  ER_EMPOWERED_SWITCH_IN = "ER_EMPOWERED_SWITCH_IN",
  /**
   * Elite Redux "Commanded" (applied by Puppet Strings, dex-custom): a one-turn
   * volatile that hijacks the afflicted Pokemon's next action. The next time the
   * bearer acts (checked in the PRE_MOVE lapse), if it chose a DAMAGING move it
   * attacks a random living ally instead in doubles/triples (seeded pick) or, in
   * singles, hits itself for 40% of that move's self-computed damage (no crit, no
   * secondary effects, no contact procs); a STATUS move simply fails. Expires
   * after that action or at the end of the turn it was due to act. Distinct from
   * vanilla {@linkcode BattlerTagType.COMMANDED} (Tatsugiri's Commander). Cleared
   * on switch-out (ordinary volatile); NOT cured by persistent-status cures.
   */
  ER_COMMANDED = "ER_COMMANDED",
}
