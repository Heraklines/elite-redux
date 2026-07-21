# Elite Redux — custom mechanics reference (AUTHORITATIVE)

Maintainer-provided descriptions of ER's brand-new weathers, terrains, and status
effects. These are ER-SPECIFIC and do NOT match vanilla PokeRogue — when
implementing or auditing anything that touches them, THIS is the source of truth
(alongside the in-game 2.65 dex). Do not assume vanilla behavior.

> 🔴 If a port implementation sets a *vanilla* weather/terrain/status where ER
> defines its own, that is a BUG. Example: Fog Machine must set **Eerie Fog** (the
> ER weather below), NOT vanilla `WeatherType.FOG` — Eerie Fog is a completely
> separate weather with its own identity and even drops the vanilla accuracy debuff.

## Eerie Fog (weather)

Completely separate from Sinnoh's/vanilla fog. It has **NO accuracy debuff** —
instead it is a whole new weather themed around Ghost- and Psychic-types, with its
own setters, synergistic abilities, and moves. (A certain weather-loving Pokemon
even gets a unique Eerie Fog form — and a Sandstorm form — in ER.)

Effects:
- Stat **buffs** from non-Ghost- or non-Psychic-type Pokemon are reduced by 1 stage
  per turn, back down to +0 over time (positive stages only; only on non-Ghost/
  Psychic holders).
- Halves weather-based recovery (Moonlight / Synthesis / Morning Sun heal less),
  similarly to other non-Sun weathers.
- Ghost- and Psychic-type Pokemon get a **20% damage reduction** from moves.
- All Curses become the **Ghost-type Curse**.

## Toxic Terrain (terrain)

A new terrain based around the Poison type, with its own setters, synergistic
abilities, and moves. (Terrain type already exists in the port as
`TerrainType.TOXIC`.)

Effects (affect all **grounded** Pokemon):
- Affected Pokemon that **aren't Poison- or Steel-type take 1/16 max HP damage each
  turn**.
- Boosts **Poison-type moves by 30%** for affected targets.
- **Spikes are replaced by Toxic Spikes** (2 or more layers of Spikes become 2
  layers of Toxic Spikes).
- Move synergy: the opponent acts **as if poisoned** (for moves that key off poison
  status).
- Moves that **drain HP instead cause injury** (recoil-style) if the target is
  Poison-type.
- **Stench** keeps its 10% flinch chance AND additionally makes Toxic Terrain
  **permanent while the user (with Stench) is on the field**. During that time,
  terrain setters and terrain-clearing moves cannot remove or replace it.

## New / reworked status effects

### Bleed (new status)
- Take **1/16 max HP** as damage per turn, like Burn.
- **Prevents the effects of healing** on the affected Pokemon.
- **Negates any stat boosts** on the affected Pokemon.
- **Rock- and Ghost-types are immune** to bleeding.
- **Removed by using a healing move** (Recover, Roost, etc.) — the move does NOT
  heal, it removes the status instead.
- Inflicted by most **Keen Edge** moves, as well as **Blood Shot**.
- (In the port this is the `ER_BLEED` battler tag.)

### Fear (new status)
- **Traps the target for two turns** (prevents switching).
- **Damage dealt to a feared Pokemon is boosted by 50%.**
- Inflicted by **Scary Face** and **Worry Seed** (to be expanded).
- Treated as a **volatile** status (like Confusion / Infatuation); cured upon
  switching if forced out (e.g. by Roar).

### Enrage (status)
- Causes the Pokemon to deal **33% of the damage it deals with moves as recoil**.
- Also makes the Pokemon **affected by Reckless**.
- **Lasts until switched out.**
- (In the port this is the `ER_ENRAGE` battler tag.)

### Drench (status)
- The afflicted Pokemon **moves last in its priority bracket for 2 turns**.
- **Water-types are immune** (as are otherwise water-immune Pokemon).

### Infatuation (REWORKED in ER)
- Instead of the vanilla 1/2 chance to not move each turn, the infatuated Pokemon
  **deals 50% less damage** with its moves.
- Inflicted by Attract, Cute Charm, and a few other abilities. Still only applies to
  Pokemon of the **opposite gender**.
