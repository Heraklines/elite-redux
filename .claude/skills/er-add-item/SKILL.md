---
name: er-add-item
description: "Add a new held item / modifier to Elite Redux PokeRogue with FULL wiring: registry, save persistence, coop, icons (er-assets + jsDelivr pin), pools, trainer/biome distribution, and the mandatory verification ladder. Use whenever adding or modifying an ER item."
---

# er-add-item — the complete ER held-item wiring checklist

Built from the audited gem/reactive-item template + the tactical-items batch
(Expert Belt / Covert Cloak / Red Card / Eject Button, 2026-07-16). Items that
skip ANY numbered step here have shipped broken before (vanishing on reload,
blank icons, coop desyncs). Do them all, in order, then run the ladder.

## 0. Template files (read before writing code)

- `src/data/elite-redux/er-tactical-items.ts` — the CURRENT config-driven item
  module (class + factory + hooks). Extend it unless the item family is huge.
- `src/data/elite-redux/er-reactive-items.ts` / `er-elemental-gems.ts` — the
  original audited templates (single-use on-hit; damage-calc consumable).
- `test/tests/elite-redux/er-item-save-persistence.test.ts` — the round-trip
  test every new class/kind extends.

## 1. The item class + factory (er-tactical-items.ts pattern)

- Subclass `PokemonHeldItemModifier` (or extend the existing kind union).
- **`getArgs()` MUST append every custom ctor field** (`[...super.getArgs(), kind]`)
  — this is what round-trips on save/load. Ctor order: `(type, pokemonId,
  <custom...>, stackCount)` — `ModifierData.toModifier` calls
  `ctor(type, ...args, stackCount)`.
- `matchType`, `clone`, `apply() → true` (effects fire at engine hooks),
  `getMaxHeldItemCount()` (usually 1).
- `getIcon(forSummary)`: for a STANDALONE er-assets texture, copy the gem
  layout exactly — holder mini-icon via `addPokemonIcon(pokemon,-2,10,0,0.5)`,
  then the item sprite at (16,16) scale 0.5 origin (0,0.5). Without the holder
  icon you can't tell whose item it is (the original gem bug).
- Factory: `new PokemonHeldItemModifierType("", textureKey, ctor)` then
  **PIN `type.id` to the registry key** (`ER_EXPERT_BELT`). Un-pinned id=""
  → `typeId=""` in ModifierData → **silently dropped on reload** from every
  off-pool grant path (loot, events, trainer grants). Also `defineProperty`
  name, `getDescription`, and `setTier` (undefined tier = blank ball sprite in
  the reward UI).

## 2. Registry + persistence (BOTH halves required)

1. `src/modifier/modifier-type.ts` → add `ER_<NAME>: () => erXItemType(kind)`
   to `modifierTypeInitObj`. The key MUST equal the pinned `type.id`.
2. `src/data/elite-redux/er-persistent-modifiers.ts` → register the CLASS in
   `ER_PERSISTENT_MODIFIER_CLASSES`. The save loader resolves
   `Modifier[className] ?? resolveErModifierClass(className)`; missing entry =
   item vanishes on Continue AND coop heals drop it (the modifier
   reconciliation uses the same lookup).
3. Coop rides free once 1+2 are done — but a `PersistentModifier` constructed
   with a blank type id **throws at construction** (audit invariant), so any
   new producer path must go through the pinned factory.

## 3. Icons (four copies + a pin bump — miss one and staging shows a blank)

Sources: ER ROM decomp `vendor/elite-redux/source/graphics/items/icons/*.png`
(24x24, direct copy) → PokeAPI sprites repo (`sprites/items/` and
`sprites/items/gen9/`) → PokeSprite. Downscale >32px art with an
alpha-weighted box filter (see scratchpad resize-cloak.mjs pattern).

1. Push to **`Heraklines/er-assets`** repo `images/items/er/er_<name>.png`
   (GitHub Contents API works; the repo is too big to clone quickly).
2. **Bump the pinned er-assets commit** in `deploy/cloudflare/_redirects`
   (every line) to the new er-assets HEAD — staging/prod serve images via
   jsDelivr AT THAT PIN; without the bump the deploy 404s the new icons.
3. Copy into local `assets/images/items/er/` (vite dev publicDir).
4. Copy into local `../er-assets/images/items/er/` (the render harness + tier-2
   pixel tools read THIS checkout via `ASSET_ROOTS`).
5. `src/loading-scene.ts` → `.loadImage("er_<name>", "items/er")`.

## 4. Engine hook (pick the audited chokepoint; never invent a new one)

- Attacker damage modifier → `Pokemon.getAttackDamage` beside `erTryApplyGem`
  (`typeMultiplier` is in scope for effectiveness checks). Passive boosts apply
  on simulated calcs too; consumables must gate on `!simulated`.
- Struck-holder proc → `MoveEffectPhase.applyOnTargetEffects` beside
  `erApplyReactiveOnHit` (has user/target/hitResult/dealsDamage; gate
  multi-hit with `user.turnData.hitsLeft > 1`).
- Secondary-effect suppression → `Move.getMoveChance` `!selfEffect` branch
  (beside Shield Dust) + the held-item flinch check in move-effect-phase.
- Forced switches → mirror `ForceSwitchOutAttr`: player choice =
  `SwitchPhase(SwitchType.SWITCH, idx, true, true)`; forced random =
  `SwitchSummonPhase(FORCE_SWITCH, idx, slotIndex, false, playerBool)` with the
  **coop #811 own-bench pool restriction** for player mons.
- EVERY consumable proc gates on: holder alive (`isActive(true)`),
  `PreventItemUseAbAttr` on opponents (As One), `erIsHeldItemDisabled`
  (Embargo-class), then `removeModifier` + `updateModifiers` + a
  `battleData.lostItems.push({typeId})` tap (Fetch move rebuild) + a message.

## 5. Distribution (per maintainer ruling — ASK if not specified)

- Player random rewards: `src/modifier/init-modifier-pools.ts` weighted entry
  in the tier's pool. Match neighbor weights (utility ~2-4, staples ~3-7).
  "1 per team" = weight-function returning 0 when any party mon already holds
  one (see `hasMaximumBalls` pattern).
- Shop-only: `er-biome-economy.ts` `signature` arrays (thematic biomes), NOT
  the pools.
- Enemy-side: `er-trainer-item-map.ts` if ER trainers natively carry it (find
  the GBA id in `vendor/.../include/constants/items.h`, base
  LAST_MISC_ITEM_INDEX=250) + `er-biome-item-flavor.ts` pools for on-mon biome
  flavor.
- Showdown: `showdown-item-pool.ts` if competitively sane.

## 6. Verification ladder (ALL FIVE, in order — no skipping)

1. **tsc**: `npx tsc --noEmit` — zero NEW errors vs baseline (compare count +
   confirm none in touched files; baseline drifts, measure same-tree).
2. **Persistence test**: extend `er-item-save-persistence.test.ts` — registry
   class check, pinned-id check, full `reload()` round-trip preserving every
   custom field. The kind-loop pattern auto-covers config-driven batches.
3. **Behavior test**: `test/tests/elite-redux/er-tactical-items.test.ts`
   pattern — GameManager, `startingHeldItems([{name:"ER_X"}])` /
   `enemyHeldItems`, real turns. WATCH TYPE IMMUNITIES in fixtures (a Normal
   move can't proc anything on a Gengar — burned us twice).
4. **Headless harness**: `node scripts/run-scenario.mjs @spec.json --no-miss
   --no-crit` with an A/B pair (item vs control, same seed). Gotchas: player
   level = `run.level` (NOT `start.level`); low waves BST-cap-swap pinned
   enemies; modal SwitchPhase prompts hang the runner (cover those via the
   vitest test instead); ER innate kits (Let's Roll etc.) pollute naive
   fixtures — pick inert species.
5. **Visual render**: the `battle-tactical-items` recipe in
   `test/tools/render-ui-page.test.ts` (field + `modifierBars: true`) — add
   the new item to a bar recipe, render, and EYEBALL the PNG (crop+zoom the
   corners). `unresolved []` + the icon visibly correct on the right side's
   bar = pass. Missing from `../er-assets` = `__MISSING` box.

## 7. Ship

Commit code + baseline + `_redirects` pin together (icons are already on the
er-assets remote from step 3.1). Push `feat/elite-redux-port`, deploy staging
via `gh workflow run deploy-staging.yml --ref feat/elite-redux-port -R
Heraklines/elite-redux`. Never prod without explicit permission.
