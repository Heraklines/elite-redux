# Partner Eevee and Ability Overhaul Design

## Goals

1. Partner Eevee and every partner Eeveelution use the same three candy-unlock bits for innates.
2. Add every requested ability rider without deleting previous effects.
3. Replace only the abilities listed under full replacements.
4. Apply the requested nerfs.
5. Keep short, detailed, composite, and runtime descriptions synchronized.
6. Provide automated battle coverage and in-game test scenarios for every observable mechanic.

## Partner Eevee unlock ownership

Omniform's transient source snapshot correctly preserves unlocks after a mid-battle transform, but a partner Eeveelution instantiated directly has no snapshot and reads its transform-only species' empty starter data. The Omniform registry will therefore gain a persistent family unlock-owner mapping. Partner Eevee's vanilla Eevee `partner` form is the owner; all eight partner Eeveelution identities resolve to it. `Pokemon.innateSlotPassiveAttr()` remains the single battle/UI gate and consults the registered owner after co-op and transient-source handling.

## Ability mechanics

Vanilla changes remain in `init-elite-redux-vanilla-rebalance.ts`, whose `ABILITY_PATCHERS` table already distinguishes additive, replacement, and numeric patches. ER-custom additions use a final idempotent upgrade pass after custom construction, vanilla rebalance, composite refresh, and manual-composite wiring. This guarantees additions preserve final constituent behavior while replacements can intentionally clear it.

Repeated mechanics are implemented as reusable attributes: status/tag application, team healing, trapping, follow-up moves, item theft, move-flag expansion, damage/healing multipliers, field suppression, biome/meta rewards, and per-battle state. Unique mechanics use focused modules and existing gameplay chokepoints rather than ability-name checks spread throughout battle code.

## Ambiguous entries

Primary wording is authoritative: Mystic Power for Color Spectrum; Limber for Steadfast; maintained Aurora Veil for Snow Cloak; rain Sand Guard for Rain Shroud; no optional Spirit suppression on Aura Break; 1/8 Flourish recovery; 1/3 Shed Tail cost; full new Grappler behavior for Grip Pincer.

## Description model

- ER short text: `er-abilities.ts`.
- ER detailed text: `er-ability-rom-descriptions.ts`.
- Vanilla rewritten runtime text: `descriptionOverride` in the vanilla rebalance pass.
- Composite details continue resolving constituent descriptions dynamically.
- `Kunoichi's Blade` becomes `Ninja's Blade` without changing its numeric identity.

## Verification

Each mechanic receives a Vitest regression and an in-game dev scenario. Combat mechanics also receive a headless ScenarioSpec assertion. Replacement tests assert both the new behavior and absence of the old behavior. Partner Eevee tests cover every family member and all three unlock slots.
