# Fusion Preview (DNA Splicers live preview)

Status: shipped to staging (#558-#561). Staging-tunable (panel geometry).

## What it is

When the player uses **DNA Splicers** and picks a base Pokemon, a live preview
panel appears on the right of the party screen. As the cursor moves over each
other party member, the panel shows what *that* fusion would be - the blended
two-tone sprite, the fused base stats, and the four fused abilities - before any
fusion is committed. The player can scan every combination, flip which mon is
the base, and confirm the **shown** combo.

## Interaction model (chosen: live overlay on the party menu)

The user picked "live overlay on the party menu" over a dedicated screen, so the
preview is hosted inside `PartyUiHandler`'s existing `PartyUiMode.SPLICE` flow
(the party list stays navigable). Everything is guarded behind
`fusionPreviewActive`, which is only ever true during SPLICE after a base is
locked - no other party mode is touched.

- **Lock the base:** pick a mon's `APPLY` option (existing SPLICE behavior) ->
  `startTransfer()` sets `transferCursor` and flips `fusionPreviewActive` on.
- **Vary the partner:** every `setCursor` change re-renders the preview for
  `(party[transferCursor], party[cursor])`. Hovering the base itself or the
  Cancel button shows a "move to another Pokemon" placeholder.
- **Switch (R / `Button.STATS`):** re-locks the base to the currently-hovered
  mon and drops the cursor onto the old base, so the same pair shows reversed and
  the player keeps varying from there ("locks the second as the first, vary the
  other side").
- **Confirm (A):** fuses the SHOWN combo directly - fires the existing splice
  `selectCallback(transferCursor, cursor)`, which is exactly base + hovered. No
  second options menu.
- **Back out (B):** `clearTransfer()` tears the preview down and returns to the
  first pick. Leaving the party (`clear()`) also tears it down.

## How the preview is computed (no fusion is committed)

`PlayerPokemon.fuse()` mutates the base, splices the partner out of the party,
and destroys it - unusable for a preview. Instead the panel keeps a **throwaway
clone** of the locked base (built once via `globalScene.addPlayerPokemon(...,
base)` as the dataSource - a `PokemonData` round-trip would pull a cyclic import)
and re-fuses *the clone* per partner by setting the eight `fusion*` fields the
way `fuse()` does, with none of its side effects. The clone is destroyed on
teardown and never enters the party.

- **Base stats:** raw `ceil((baseA[s] + baseB[s]) / 2)` per stat, computed
  straight from the two species forms (no held-item / vitamin contamination).
- **Types:** `clone.getTypes()` (base type1 + absorbed type2/type1).
- **Abilities (4):** `clone.getAbility()` + `clone.getPassiveAbilities()`, which
  resolve to `[base active, absorbed innate 0, base innate 1, absorbed innate 2]`
  = the ER rule "Pokemon 1 -> slots 1 & 3, Pokemon 2 (absorbed) -> slots 2 & 4".
- **Sprite:** `clone.loadAssets()` runs `updateFusionPalette`, producing the
  blended palette on the clone's sprite; the panel copies the sprite key +
  `spriteColors` / `fusionSpriteColors` onto its own pipeline-bound sprite. The
  load is async, race-guarded by a render token, and cached per partner id, so
  re-hovering a partner is instant and a stale load never overwrites.

## Files

- `src/ui/containers/fusion-preview-panel.ts` - the panel (clone lifecycle +
  pure data + async sprite + render). Geometry consts at the top are tunable.
- `src/ui/handlers/party-ui-handler.ts` - SPLICE hooks: `startTransfer`,
  `setCursor`, `processInput` (STATS), `processPartyActionInput` (A direct-fuse),
  `switchFusionOrder`, `updateFusionPreview`, `clearTransfer`, `clear`.
- `locales/en/party-ui-handler.json` - `fusionPreview*` strings.
- `src/dev-tools/test-suite/scenarios.ts` - "Fusion Preview (DNA Splicers) (#560)".

## Staging tuning knobs

Panel geometry (position/size/font rows) in `fusion-preview-panel.ts` consts
(`PANEL_W/H`, `SPRITE_*`, `STATS_*`, `ABIL_*`). Ability rows currently show
`1. Name` ... `4. Name`; could be tagged with the contributing mon. Types render
as text; could become type-icon sprites.
