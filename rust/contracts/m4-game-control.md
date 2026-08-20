# M4 game-control contract

## Closed control vocabulary

```rust
pub enum GameControl {
    Battle(BattleControl),
    MoveLearn(MoveLearnControl),
    RewardShop(RewardShopControl),
    BiomeMarket(BiomeMarketControl),
    Crossroads(CrossroadsControl),
    BiomeSelect(BiomeSelectControl),
    Waiting(WaitingControl),
    Complete(RunOutcome),
}

pub struct SeatControlPlan {
    pub seat: SeatId,
    pub owner: bool,
    pub control_id: ControlId,
    pub menu_instance_id: MenuInstanceId,
    pub actionable_after: PresentationBarrier,
    pub control: GameControl,
}

pub struct GameControlPlan {
    pub schema_version: u32,
    pub seats: Vec<SeatControlPlan>,
    pub next_control_id: ControlId,
    pub next_menu_instance_id: MenuInstanceId,
}
```

Only the authoritative owner control is actionable. Watchers receive the same logical surface as a non-actionable projection. Control identity is authority material, not renderer state.

## Shared menu model

The stable graph types move from the battle-specific module to `er-types::ui_menu`. `LogicalMenu` owns stable option IDs, enabled state, explicit directional edges, cancel behavior, and optional noncanonical layout. `BattleMenu` is a temporary compile-time alias only; new code uses `LogicalMenu`.

Every logical surface replacement allocates a new `MenuInstanceId`, including target overlays and returning to a prior surface. A held key, repeat timer, or delayed browser repeat is bound to the menu instance that received the original keydown. It cannot act on a later instance.

Every physical keydown affects at most one logical menu instance. One external input is reduced, then internal work runs to quiescence before the next external input.

## Stable option identities

Required option identity forms:

```text
learn/candidate/{moveId}
learn/replace/{pokemonId}/{moveSlot}
learn/undo
learn/cancel
reward/free/{offerId}/{modifierId}
reward/shop/{offerId}/{modifierId}
reward/reroll
reward/check-team
reward/manage-items
reward/lock/{tier}
reward/skip
party/{partyIndex}/pokemon/{pokemonId}
party/cancel
market/{stockId}/{modifierId}
market/leave
crossroads/stay
crossroads/leave
biome/{routeNodeId}/{biomeId}
```

Ordinal, row, column, display text, and locale are never semantic identity.

## Raw-key policies

The production driver accepts physical keydown, keyup, focus, blur, and virtual-time events only. Representative campaigns cannot invoke semantic surface actions, proposals, wave advance, or battle creation.

- Move-learning lists use their oracle-frozen bounded or wrapping graph for each exact submode.
- Regular reward/shop uses the explicit two-dimensional graph generated into material.
- Biome market uses a bounded four-column graph over visible stock.
- Crossroads is `Stay` then `MoveOn`, with cancel mapped to `MoveOn` only where the captured oracle surface specifies it.
- Biome selection is a bounded horizontal graph; cancel is disabled.
- Party targeting uses stable roster index plus Pokémon ID.

Disabled options remain focusable only when the captured oracle specifies that behavior. Submitting one returns a typed rejection and leaves the menu unchanged.

## Presentation barrier

Material application installs the exact logical control before presentation settlement. `controlInstalled` may be receipted when that control exists. Human input remains blocked while a `BlocksHumanInput` presentation is pending. Presentation failure never rolls back mechanics and never silently unlocks the surface.

## Forbidden external seams

M4 mode never emits causal UI intent, material-apply, or control-projection effects. It never accepts external `UiIntent`, `MaterialApplied`, or `ControlProjected`. Simulator, Wasm glue, browser, and tests cannot report canonical work as successful.