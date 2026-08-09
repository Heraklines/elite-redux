# PokéRogue Redux Rust kernel M3 UI navigation contract

Status: normative once the G6 contract-freeze commit is accepted.

The pinned TypeScript evidence is
`docs/plans/rust-kernel/m3-command-ui-oracle.md`. M3 intentionally narrows that
UI to the supported battle slice and strengthens menu-instance and Cancel
restoration semantics required by the M3 specifications. Those deliberate
differences are listed here; workers may not make additional approximations.

## Stable identity, never cursor position

M3 battle menus identify selection with `MenuOptionId`. A numeric vector index
is renderer/storage detail and is never command identity.

```rust
pub struct MenuInstanceId(SafeU53);

pub enum NavigationDirection {
    Up,
    Down,
    Left,
    Right,
}

pub struct MenuNavigationEdge {
    pub from: MenuOptionId,
    pub direction: NavigationDirection,
    pub to: MenuOptionId,
}

pub struct MenuNavigation {
    pub selected_option_id: MenuOptionId,
    pub edges: Vec<MenuNavigationEdge>,
}

pub struct MenuOptionLayout {
    pub option_id: MenuOptionId,
    pub row: u16,
    pub column: u16,
    pub page: u16,
}
```

The canonical wire form uses a validated sorted `Vec`, not a JSON object keyed
by a Rust struct. Edges are unique by `(from, direction)` and serialize sorted
by option ID, then `Up`, `Down`, `Left`, `Right`. Implementations may build a
private `BTreeMap` index without changing serialization.

Every edge endpoint and selected option must exist. An edge may not target a
hidden option. Missing edges mean that direction leaves selection unchanged;
the generic reducer never guesses wrapping or grid geometry. Disabled visible
options remain navigation endpoints but reject activation. Hidden options are
absent from layout and navigation.

`MenuOptionLayout` is immutable renderer geometry. It does not drive input.
Changing layout without changing edges cannot change mechanics.

## Stable option and control grammar

The exact option IDs are:

```text
command/fight
command/switch
move/{pokemonId}/slot/{moveSlot}
target/{player|enemy}/{position}
party/{pokemonId}/slot/{partySlot}
party/cancel
party-option/send-out
party-option/cancel
```

Numeric components are canonical unsigned decimal. IDs are derived from typed
actors/slots and never labels, translated text, vector offsets, or legacy flat
BattlerIndex values.

Command-window control IDs are:

```text
battle/{battle}/wave/{wave}/turn/{turn}/control/player/{position}/seat/{seat}/{kind}
```

`kind` is one of `command`, `move`, `target`, `party`, or
`party-option/{partySlot}`. Replacement control IDs append
`/control/{replacement|party-option/{partySlot}}` to the exact pinned
REPLACEMENT operation ID. A logical menu reconstruction retains its control ID
but receives a fresh menu instance.

## Closed battle menu kinds

The M3 logical stack supports:

- `CommandRoot`;
- `MoveSelect`;
- `TargetSelect`;
- `PartySelect`;
- `PartyOptionSelect`;
- `ReplacementSelect`;
- `Waiting`;
- `Complete`.

Command root exposes only Fight and Switch. The party option submenu exposes
only Send Out and Cancel. Ball, Run, Tera, Reset, Shift, Baton Pass, item
management, capture, and flee are absent rather than disabled fallbacks.

## Exact command-root graph

The reduced root preserves the oracle positions of FIGHT and POKEMON/Switch:

| Option | Row | Column | Initially selected |
| --- | ---: | ---: | --- |
| `command/fight` | 0 | 0 | yes |
| `command/switch` | 1 | 0 | no |

Its complete edge set is:

```text
command/fight  + Down -> command/switch
command/switch + Up   -> command/fight
```

Every other directional input is a no-op. There is no wrap. Action/Submit on
Fight opens MoveSelect; Action/Submit on Switch opens PartySelect. Cancel is
disabled.

## Exact four-slot move graph

M3 always renders exactly four move cells in a two-column grid. Empty slots are
visible disabled placeholders with stable slot IDs; navigation never skips
them. The complete edge set is:

```text
slot 0 + Right -> slot 1
slot 0 + Down  -> slot 2
slot 1 + Left  -> slot 0
slot 1 + Down  -> slot 3
slot 2 + Up    -> slot 0
slot 2 + Right -> slot 3
slot 3 + Up    -> slot 1
slot 3 + Left  -> slot 2
```

There is no wrap. A present move with zero usable PP is visible but disabled.
An unsupported or empty move cannot activate. Fresh first-summon selection is
slot zero; otherwise the actor/field-slot remembered move is restored when it
remains present, falling back to slot zero.

A move whose supported target set is one implicit fixed target commits
directly. A move requiring a choice opens TargetSelect. A supported multiple-
target move opens TargetSelect with `multiple = true`; Action submits the
complete canonical candidate set.

## Exact target graph

Target identities are `FieldSlot`, not oracle `BattlerIndex` values. Candidate
targets are live, legal, adjacency-filtered slots sorted player side then enemy
side, each by position.

For `multiple = true`, every direction is a no-op and Action submits all
candidates. For binary single-target menus, the complete edge rule is:

```text
Up:    selected player slot -> lowest-position candidate enemy slot
Down:  selected enemy slot  -> lowest-position candidate player slot
Left:  odd position         -> same-side position-1 when that candidate exists
Right: even position        -> same-side position+1 when that candidate exists
```

All omitted or unavailable destinations are no-ops; there is no wrap. Selection
uses a legal requested default, then a still-legal remembered enemy target,
then the lowest-position enemy candidate, then the first canonical candidate.

## Exact party and replacement graphs

Party options contain every actual party member in ascending `PartyIndex` plus
the visible `party/cancel` node. Fainted, already-active, partner-owned, or
otherwise illegal entries remain visible but disabled. Fresh entry selects the
lowest party index, matching the oracle's fresh-show reset.

Let `first`, `last`, and `previous`/`next` refer to the actual ascending party
options, excluding Cancel. The vertical edges are:

```text
Up:    first -> cancel; every other party option -> previous; cancel -> last
Down:  every party option before last -> next; last -> cancel; cancel -> first
```

The party control retains `last_left_option_id` and
`last_right_option_id`. They initialize to the lowest active option and lowest
bench option respectively; when no such group exists, the corresponding value
is Cancel. Entering an active or bench option updates that group's remembered
identity. After each accepted traversal, `er-game` materializes the next exact
concrete edge vector without changing `MenuInstanceId`:

```text
Left:  a bench option or Cancel -> remembered active option, when one exists
Right: an active option -> remembered bench option, otherwise Cancel
```

All other Left/Right inputs are no-ops. This preserves the oracle's party-column
memory while keeping the generic reducer limited to traversing explicit edges.

Action on an enabled party member opens `PartyOptionSelect`; it does not submit
a switch directly. That submenu contains Send Out followed by Cancel. Up and
Down both wrap between the two options; Left and Right are no-ops. Selecting
Send Out submits the typed switch/replacement. Selecting Cancel or pressing the
Cancel button restores the exact parent party menu and selected party option in
a new menu instance.

In voluntary `PartySelect`, Send Out produces the current command window's
`BattleCommandProposalV1` containing `BattleCommand::Switch`. In
`ReplacementSelect`, it produces a
`BattleReplacementProposalV1` with `ReplacementSelection::Selected` and the
exact pinned REPLACEMENT operation ID. Neither path invokes a resolver directly.

The replacement control copies the stored faint occurrence's `source` and
`pokemon` as its typed source and actor. Plan/projection validation reconstructs
the complete REPLACEMENT operation ID from that source plus the plan battle,
field, and seat coordinates; a syntactically plausible prefix with the correct
control suffix is rejected when any coordinate differs.

Voluntary PartySelect has enabled main Cancel. ReplacementSelect renders the
same main Cancel node disabled. If an owner has no legal same-owner replacement,
no unfinishable menu is installed: the stored occurrence is resolved as
`NoLegalReplacement`, its slot remains empty, and the next stored control or
outcome is installed.

## Cancel restoration

The M3 specification deliberately strengthens the pinned handler behavior:

```text
TargetSelect      -> exact previous MoveSelect and selected move
MoveSelect        -> exact previous CommandRoot and selected Fight
PartySelect       -> exact previous CommandRoot and selected Switch
PartyOptionSelect -> exact parent Party/Replacement selection
ReplacementSelect -> disabled
CommandRoot        -> disabled
```

For a replacement parent, the exact restoration includes the copied stored
faint actor and source-pinned decision operation in addition to owner, field
slot, selected party option, and immutable menu graph.

The pinned TypeScript target Cancel requeues CommandRoot, and its voluntary
party return corrects POKEMON to FIGHT. M3 uses the explicit restoration rules
above because the user-supplied M3 contract requires Target -> Move and exact
previous-option restoration. These are versioned contract decisions, not
claims about unmodified TypeScript behavior.

Every Cancel restoration allocates a new `MenuInstanceId`.

## Raw key, repeat, seat, and instance policy

The representative physical mapping is frozen to:

| Physical key | Logical button |
| --- | --- |
| Arrow Up / Down / Left / Right | Up / Down / Left / Right |
| Enter | Submit, with Action fallback only when Submit is unconsumed |
| Space | Action |
| Backspace | Cancel |

The existing configurable M2 binding shape may retain additional keys, but M3
acceptance campaigns use only this table. A mapped keydown emits one press and
arms a repeat every exactly 250 virtual milliseconds. Duplicate keydown for an
already-held logical button is rejected. Keyup emits release and clears the
held logical-button record, lock, and repeat. Blur atomically clears pressed/
suppressed inputs, held logical buttons, locks, and repeat timers without
submitting; focus emits no phantom press.

`MenuInstanceId` is allocated monotonically from the owning seat's
`GameRuntime` allocator for every logical menu replacement, including forward
transitions and Cancel restoration. Every seat allocator starts at one during
the deterministic byte-equal initial-plan projection. TURN/REPLACEMENT
material then installs the authority-issued complete plan plus the exact next
high-water mark for every seat. Between material boundaries an endpoint
consumes only its local seat's allocator. A submitted command/replacement
proposal carries its current menu ID; successful authority admission checked-
advances that seat's high-water mark before constructing the next material
plan. Material receivers install the same resulting marks. Regression,
overflow, or cross-seat allocation is a protocol/invariant failure.

IDs are unique within a seat, and all input locks/repeats/stale checks key them
with the owning seat. Equal numeric IDs on different seats are unrelated.

Each accepted physical keydown, held lock, and repeat timer retains the
instance that received it. After a transition, an old-instance press/repeat is
stale and cannot move or submit the new menu; only a fresh keydown after release
may act. Endpoint-local menu navigation may change only that endpoint's kernel
digest until the next authoritative plan; it never changes mechanical state.

Wrong-seat rejection occurs before local menu lookup or intent construction.
Only the owner receives a command/replacement picker; a partner receives
Waiting and observes the admitted proposal. A relayed move already contains its
typed target and never opens an interactive target selector on the watcher.

## Reducer boundary and validation

The generic UI reducer owns only exact edge traversal, disabled/hidden submit
rejection, stable selection projection, and conversion of accepted Action/
Cancel to a private typed `UiIntent`. `er-game` owns graph construction,
party-column memory, submenu history, semantic option lookup, command
collection, and control changes. `er-battle` owns no UI behavior. Neither a
renderer nor a test may inject `UiIntent` externally.

Each graph validates unique non-empty option IDs, unique edge keys, existing
endpoints, visible selected/target options, stable layout identity, unique
visible geometry, sorted serialization, legal actor/seat/field/operation
identity, and exact menu-instance ownership.

Hosted tests cover every graph and no-op edge, disabled and hidden entries,
party memory, both option-submenu exits, all Cancel restorations, held Action,
250 ms repeat, browser duplicate keydown, wrong-seat input, stale instances,
and blur between keydown/keyup.
