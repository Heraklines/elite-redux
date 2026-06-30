# Ghost Trainer FX - design

Status: implemented (2026-07-01). Player-facing cosmetic effects for the ER Ghost
Trainer feature: an **entrance** (how a ghost trainer arrives on the field) and an
**aura** (an FX overlay around the trainer sprite during the encounter). Players
unlock them by spending achievement points in the Ghost Trainer Editor, then the
equipped picks ride on every ghost their runs publish so OTHER players see them.

## Catalog (`src/data/elite-redux/er-trainer-fx.ts`)

Two read-only registries; ids are stable (they drive the owned-bit index and must
never be reordered). Labels are mirrored in `locales/en/ghost-trainer-fx.json`.

### Entrances (6) - each maps to a `GhostApproachEffect` consumed by the entrance tween

| id | label | cost (AP) | approach |
| --- | --- | --- | --- |
| `riseFromGround` | Rise From Ground | 700 | `riseFromGround` |
| `fogMaterialize` | Fog Materialize | 700 | `fogMaterialize` |
| `flashIn` | Flash In | 700 | `flashIn` |
| `shadowStep` | Shadow Step | 500 | `fromShadow` |
| `descendFromAbove` | Descend From Above | 500 | `fromAbove` |
| `reverseDissolve` | Reverse Dissolve | 500 | `reverseDissolve` |

### Auras (8) - each id is an existing AROUND shader id (`er-shiny-lab-fx.ts`)

| id | label | cost (AP) |
| --- | --- | --- |
| `smoke` | Smoke | 1000 |
| `embers` | Embers | 1000 |
| `frost` | Frost | 1000 |
| `shadowaura` | Shadow Aura | 1000 |
| `goldenglow` | Golden Glow | 1250 |
| `holyrays` | Holy Rays | 1250 |
| `cosmos` | Cosmos | 1250 |
| `sparkstorm` | Spark Storm | 1250 |

## Currency: spendable achievement points (AP)

The game's first achievement-point sink. There is **no stored AP total**: the
spendable balance is derived live as `earnedScore` (sum of `score` over unlocked
achievements) minus a persisted `spentAchvPoints` counter
(`game-data.ts:getSpendableAchvPoints` / `spendAchvPoints`). Spending NEVER mutates
`achvUnlocks` - it only increments the spent counter and re-saves. Purchases are
permanent; the editor checks affordability before spending so AP can never go
negative and a locked effect is never granted for free.

## Save struct (`TrainerFxSaveData`, on the SYSTEM save)

Modeled on `ErShinyLabSaveData` (owned bitsets + equipped indexes). Stored under the
abbreviated key `$tfx` (`game-data.ts`), sanitized on load.

```
interface TrainerFxSaveData {
  e?: number[];  // owned entrance bitset (bit index = TRAINER_ENTRANCE_EFFECTS index)
  a?: number[];  // owned aura bitset
  le?: number;   // equipped entrance: 0 = none, else registry index + 1
  la?: number;   // equipped aura:     0 = none, else registry index + 1
}
```

`sanitizeTrainerFxSaveData` clamps the bitsets to bytes and the equipped indexes to
the valid range, and **drops an equipped pick the player does not actually own** (so a
tampered local save can't equip a locked effect).

## Serialization round-trip (the FX reach other players)

The equipped picks are folded onto `GhostTrainerProfile` (the cosmetic blob that
publishes with every ghost), NOT onto the wire as raw catalog ids:

- entrance -> `profile.approach` (a `GhostApproachEffect`)
- aura -> `profile.aura` (an AROUND id) + `profile.showAuraInBattle = true`

Path another player decodes (identical to every other profile field):

```
editor buildProfile() fold
  -> sanitizeGhostProfile()                 (publish, er-ghost-teams.ts)
  -> JSON.stringify / JSON.parse            (worker `runs.presentation` blob)
  -> sanitizeGhostProfile()                 (encounter, er-ghost-teams.ts)
  -> markTrainerAsGhost(): trainer.erGhostApproach / trainer.erGhostAura
```

`sanitizeGhostProfile` clamps `approach` to the known `GhostApproachEffect` enum
(dropping `default`/unknown) and `aura` to the known AROUND id whitelist
(`isKnownTrainerAuraId`), so an untrusted peer cannot smuggle an arbitrary entrance
or aura. Regression: `test/tests/elite-redux/er-trainer-fx-serialization.test.ts`
(engine-free) proves the FX survive the round-trip AND that a bogus aura + unknown
approach are dropped to none/default.

## Apply on encounter

- **Entrance**: `encounter-phase.ts` builds a per-trainer tween via
  `buildTrainerEntranceTween(enemyTrainer, enemyTrainer.erGhostApproach, arrival)`.
  Every effect pre-positions the trainer to a custom start state then settles it to
  the SAME final state the vanilla `+300` slide produces, so the downstream
  reveal/summon logic is unaffected. A non-ghost trainer (no `erGhostApproach`) keeps
  the vanilla slide.
- **Aura**: once the trainer is revealed, `trainer.applyErGhostAuraFx()` builds an
  `ErTrainerAuraFx` overlay (one per visible sub-sprite) that re-renders the AROUND
  shader around the trainer's field sprite, reusing the exact Shiny Lab pixel pipeline
  (`ErShinyLabSpriteFxOverlay`). It is a child of the Trainer container, so it
  inherits position/scale/alpha and tears down with the trainer (no leaks). No-op
  unless the uploader equipped an aura with `showAuraInBattle`.

## Editor UX (`src/ui/handlers/ghost-trainer-editor-ui-handler.ts`)

Two new rows below the dialogue rows: **ENTRANCE EFFECT** and **AURA EFFECT**.

- The spendable AP balance is shown top-right of the header (refreshes after a buy).
- LEFT/RIGHT browse the effect list (a leading "None" entry unequips).
- A LOCKED effect is greyed and shows its AP cost. Pressing A BUYS it
  (`spendAchvPoints` -> sets the owned bit -> auto-equips, mirroring the Shiny Lab buy
  flow with a `se/buy` sound; an unaffordable buy plays an error and changes nothing).
- An OWNED effect equips/unequips for free on A (the equipped pick is highlighted in
  the accent colour). The equipped index is written to the draft and folded into the
  published profile on PUBLISH; it is also persisted to `TrainerFxSaveData.le/la` so
  the editor re-seeds the picks next time.
- A live preview pane re-plays the equipped entrance every ~3s and holds the equipped
  aura around the player's chosen trainer sprite. It is lightweight and fail-closed:
  if the sprite/texture is missing, the static panel is shown and no FX are attached;
  the overlay + replay timer are torn down on every rebuild and on clear (no leaks).

## Testing

- `test/tests/elite-redux/er-trainer-fx-serialization.test.ts` - engine-free
  round-trip + anti-tamper clamp + local-save round-trip + locale-mirror gate.
- `test/tools/render-ui-page.test.ts` recipe `ghost-trainer-editor` renders the screen
  (the new rows + AP balance) for the golden-image harness.
- Dev test-suite `(note)` entry "Ghost Trainer FX: entrance + aura (editor)" tells the
  team to buy/equip in the editor and verify on a ghost encounter (the effects are set
  on OTHER players' ghosts, so they aren't forceable in a single battle).
