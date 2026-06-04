# UI Audit — 4 Abilities Display

> Companion to Phase A's A16 starter-select panel. ER mons have 1 active + 3 passives. After B1a installed real passive triples on all 1025 vanilla species, the multi-passive UI gate (`species.getPassiveCount() > 1`) is true almost everywhere. This audit covers the UI surfaces beyond starter-select.

## Surfaces inspected

| Surface | File | Current state | Action |
|---|---|---|---|
| Starter-select 3-passive panel | `src/ui/handlers/starter-select-ui-handler.ts` (A16) | ✅ 3-row branch gated by `getPassiveCount() > 1`; fires for ~1025 species post-B1a | None (verified working) |
| Pokedex page passive section | `src/ui/handlers/pokedex-page-ui-handler.ts:910, 1993-2005, 2378` | Single-passive flow using `PassiveAttr.UNLOCKED` (= slot 1). `hasPassive = passiveAttr > 0` still works (any bit set). | **Deferred** (large surface — TODO comment kept from A16) |
| Pokemon summary screen | `src/ui/handlers/summary-ui-handler.ts:929-938` | Iterates `allAbilityInfo` with 1-2 entries (active + optional passive via `getPassiveAbility()` slot-0). | **Adjust this commit** — iterate all 3 passive slots via `getPassiveAbilities()` |
| Party menu | `src/ui/handlers/party-ui-handler.ts` | No passive references — shows active only. | **Deferred** — would require new panel space; out of scope for surgical commit |
| In-battle Pokemon info | Various (`pokemon-info-container.ts`, `pokemon-info.ts`) | Active only (no passive surface). | **Deferred** — vanilla pokerogue convention: passives are starter-meta, not in-battle UI |

## Key finding — summary screen

`summary-ui-handler.ts:934` calls the LEGACY singular `this.pokemon.getPassiveAbility()` which returns slot 0 only (via the `starterPassiveAbilities` lookup table). For ER species, this misses slots 1 and 2. The fix is to call `getPassiveAbilities()` and append each non-NONE slot to the existing `allAbilityInfo` array — the page-flip prompt logic already handles N entries.

Visual layout (BEFORE → AFTER):

```
BEFORE (vanilla):                    AFTER (with ER passive triples):
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ ABILITY                     │      │ ABILITY                     │
│ Overgrow                    │  ←→  │ Overgrow                    │
│ Boosts Grass when low HP.   │      │ Boosts Grass when low HP.   │
│                          [Z]│      │                          [Z]│
└─────────────────────────────┘      └─────────────────────────────┘
        (press Z)                            (press Z, page 1/4)
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ PASSIVE                     │      │ PASSIVE                     │
│ Chlorophyll                 │  ←→  │ Chlorophyll                 │ ← slot 1
│ Doubles speed in sun.       │      │ Doubles speed in sun.       │
│                          [Z]│      │                          [Z]│
└─────────────────────────────┘      └─────────────────────────────┘
                                             (press Z, page 2/4)
                                     ┌─────────────────────────────┐
                                     │ PASSIVE 2                   │
                                     │ Leaf Guard                  │ ← slot 2
                                     │ Prevents status in sun.     │
                                     │                          [Z]│
                                     └─────────────────────────────┘
                                             (press Z, page 3/4)
                                     ┌─────────────────────────────┐
                                     │ PASSIVE 3                   │
                                     │ Photosynthesis              │ ← slot 3
                                     │ Heals 1/16 max HP per turn. │
                                     │                          [Z]│
                                     └─────────────────────────────┘
```

The label "PASSIVE 2" / "PASSIVE 3" reuses the existing pixel-text `summary_profile_passive` sprite — no new asset is required. The added entries fit the existing page-flip prompt mechanic without growing the panel.

## Deferred work (Phase C follow-up tasks)

1. **Pokedex page** — the single-passive unlock flow at lines 1993-2005 only buys slot 1. ER players will need separate unlock entry points for slots 2 + 3. This is a larger UI redesign (3 candy-cost rows, 3 unlock buttons) and is the natural extension of A16's starter-select panel. Land as a dedicated task.
2. **Party menu** — adding passive display requires layout space the existing party panel doesn't have. Either compress the active-ability row or add an info-pop on hover. Both are non-trivial — defer.
3. **In-battle Pokemon info / Pokemon-info-container** — vanilla pokerogue doesn't surface passives during battle (passives are meta-progression). For ER's 4-abilities-active model, players may want a "current abilities" inspector. Out of scope for this commit; needs design.

## Note for future Pokemon Fusion / Transform audit (task #77)

When B1a installed passive triples via `setPassives()`, the values were stored on the `PokemonSpeciesForm` instance. Fusion / Transform / Imposter / Trace / Skill Swap / Role Play all operate on the `Pokemon` instance and don't currently consult `getPassiveAbilities()`. Audit + fix is its own task — see task #77.
