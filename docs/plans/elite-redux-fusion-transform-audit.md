# Mechanics Audit — Fusion / Transform / Ability-Copy interactions with 3-passive feature

> Companion audit for task #77. Documents every pokerogue mechanic that touches an "ability source" and how it interacts with ER's 1-active + 3-passive model. Outcome: which mechanics need behavior changes vs. which can stay current-behavior with rationale.

## Mechanics surveyed

### 1. Pokemon Fusion — `src/field/pokemon.ts:2030-2052, 2110-2129`

**How it works today:**
- `getAbility(ignoreOverride)` consults `fusionSpecies.getAbility(fusionAbilityIndex)` when fused, choosing one of the fusion species' 3 active-ability slots.
- `getPassiveAbilities()` (line 2110-2129) consults **only `this.species.getPassiveAbilities(this.formIndex)`** — the fusion species' passives are NEVER consulted.

**Behavior with 4 abilities (B1a installed real passive triples on 1025 vanilla species):**
A fused Pokemon (e.g., Charizard + Venusaur fusion) currently inherits the BASE species' 3 passives only. The fusion species' passives are silently lost.

**Design question for the user:** what's the right semantics?
- **Option A** (current): base species drives all 3 passives. Fusion species contributes type/stats/active-ability only.
- **Option B** (combined): pick the best 3 of 6 (3 from each parent). Requires a selection rule (random? player-picked?).
- **Option C** (per-side): slots 1+2 from base, slot 3 from fusion. Deterministic.

**Recommendation:** Stay with Option A for Phase B. If the user wants Option C, the change is a 5-line edit to `getPassiveAbilities()` to pull slot 3 from `fusionSpecies` when fused. Don't change without explicit direction.

**Action items if Option B/C chosen:**
- Modify `Pokemon.getPassiveAbilities()` (lines 2110-2129) to interleave fusion-species passives
- Audit `setPassives()` callers — none today, but B1a's init function only sets BASE species; fused mons would need a runtime-derived getter
- Update UI surfaces (summary screen, pokedex page) to display the combined set
- Update tests in `test/data/pokemon-species-passives.test.ts` for fusion cases

---

### 2. Transform / Imposter — `PostSummonTransformAbAttr` at `ab-attrs.ts:2821`

Pokerogue's Transform copies the target's: species, types, ability, stats (except HP), moveset. **Does NOT currently copy passives** (only `setTempAbility` is called, which is single-ability).

**Behavior with 4 abilities:** Transformed Pokemon takes target's ACTIVE ability, keeps OWN passives intact.

**Recommendation:** This is **correct semantics** — passives are meta-progression like Nature; they belong to the Pokemon's identity, not its "current form". Transform changes form, not identity. **No change needed.**

If user wants passives to also transfer, change `setTempAbility(target.getAbility())` to also call `setTempPassives(target.getPassiveAbilities())` — but this requires adding `setTempPassives` to Pokemon class first.

---

### 3. Trace — `PostSummonCopyAbilityAbAttr` at `ab-attrs.ts:2683-2715`

Calls `pokemon.setTempAbility(this.target.getAbility())` — copies the target's ACTIVE ability only.

**Behavior with 4 abilities:** Tracer keeps own passives, gains target's active.

**Recommendation:** **Correct as-is.** Trace is a vanilla mechanic with established semantics — copying active only. Passives are not "abilities to trace" in pokerogue's mental model.

---

### 4. Skill Swap — move-side effect (not in this audit's direct path)

Vanilla pokerogue's Skill Swap exchanges active abilities between user and target. Implementation in `src/data/moves/move-effects.ts` (search "SkillSwap").

**Behavior with 4 abilities:** Passives stay on each owner; only active abilities swap.

**Recommendation:** **Correct as-is** (same rationale as Trace).

---

### 5. Role Play, Gastro Acid, Worry Seed, Entrainment — same family as Trace/Skill Swap

All move-side ability-manipulation. None should touch passives. **No changes.**

---

### 6. Mega Evolution — `pokemonFormChanges` registry

Mega-evolved Pokemon's `formIndex` changes; `getPassiveAbilities(formIndex)` correctly resolves per-form passives via the species' `_passives` slot (set per-form during B1a init).

**Caveat:** B1a only set passives on `formIndex = 0` for each species. Mega forms (formIndex > 0) currently fall back to `[NONE, NONE, NONE]` via the `_passives !== null` check in `PokemonSpeciesForm.getPassiveAbilities()`. **This is a real gap** — ER mega forms with distinct innates won't display them.

**Action item (Phase B7 or C0 follow-up):**
- Extend `init-elite-redux-species.ts` to iterate `dump.species` entries with `formIndex > 0` (i.e., the mega/primal/regional forms) and call `setPassives()` on the corresponding `PokemonSpeciesForm` (not the base `PokemonSpecies`).
- Wire B5's `ER_FORM_CHANGE_REGISTRY` entries to the Pokemon's `getSpeciesForm(formIndex)` lookup chain.

---

### 7. Wonder Trade / Egg hatching — passive inheritance

Vanilla pokerogue: passives are bought-via-candy meta-progression, stored in `gameData.starterData[speciesId].passiveAttr`. They are species-keyed, not instance-keyed — hatching a Bulbasaur from an egg gives the same passive-unlock state as any Bulbasaur the player has.

**Behavior with 4 abilities:** The `passiveAttr` bitmask now encodes unlocked-state for 3 slots (per A12). Wonder Trade / egg hatching read the same starterData entry — works automatically.

**No changes needed.**

---

### 8. Gardevoir / Smeargle's Sketch / move learning

Doesn't touch abilities. **No changes.**

---

## Summary table

| Mechanic | Touches passives? | Action needed? |
|---|---|---|
| Fusion (base+fusion) | Base only | ⚠️ User choice — current behavior is Option A; documented options A/B/C |
| Transform / Imposter | No | ✅ No change (passives are meta-progression) |
| Trace | No | ✅ No change |
| Skill Swap | No | ✅ No change |
| Role Play / Gastro Acid / etc. | No | ✅ No change |
| Mega Evolution | Form-keyed passives broken | 🔧 Fix in dedicated task — extend B1a to set per-form passives |
| Wonder Trade / Egg hatching | Indirectly (via starterData) | ✅ No change |

## Conclusions

1. **No urgent fixes** for transform / trace / skill-swap family. The "passives are identity, not transferable" semantics is the right call.
2. **Mega Evolution per-form passives** are a real gap — surface this as a sub-task (B1c?). Estimated effort: ~30 min (extend init-elite-redux-species.ts to walk `dump.species.forms[]`).
3. **Fusion passive semantics** is a design question for the user. Current behavior (Option A — base species owns all 3 passives) is consistent with pokerogue's "base species drives identity" pattern, but ER may want Option B or C. Land the change only after the user picks an option.
