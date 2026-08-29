# M3-00C command/UI oracle extraction

## Authority and notation

This is a source extraction from the pinned TypeScript oracle git object
3b534099919efae827019d4a3f3c4ab0ecd6d67b. Every observation below is from
git show 3b534099919efae827019d4a3f3c4ab0ecd6d67b:<path>; the moving
worktree or a branch is not authority. The required M2 base for this worker is
7357166c19bdb5cf0e32c84b0f74f22e79d80798.

“Observed” means directly represented by the pinned source. “Proposed” means a
contract recommendation for M3 and is not a shared API freeze. “Gap” means
that this exact source pass does not establish the requested behavior. No
runtime, browser, Phaser, Vitest, Rust, Wasm, or benchmark execution is
represented here.

## 1. Raw keyboard path

The QWERTY device map defines the physical key constants, including letters,
digits, Enter/Escape, Space, arrows, Backspace, and the modifier/navigation
keys. [oracle: src/configs/inputs/cfg-keyboard-qwerty.ts:6-96 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The resolver first maps a keycode to a SettingKeyboard name and then maps that
setting to a Button. [oracle: src/configs/inputs/config-handler.ts:76-86 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b] The pinned default mapping is:

| Physical key | Resolved Button |
| --- | --- |
| Arrow Up / Down / Left / Right | UP / DOWN / LEFT / RIGHT |
| Enter | SUBMIT |
| Space | ACTION |
| Backspace | CANCEL |
| Escape | MENU |
| C / R / F / G / E / N / V | STATS / CYCLE_SHINY / CYCLE_FORM / CYCLE_GENDER / CYCLE_ABILITY / CYCLE_NATURE / CYCLE_TERA |
| A / D / S / W | alternate LEFT / RIGHT / DOWN / UP |
| M / X / Y / Z / T | alternate MENU / CANCEL / CYCLE_SHINY / ACTION / CYCLE_FORM |
| Shift | alternate STATS |
| Page Down / Page Up | SLOW_DOWN / SPEED_UP |
| Q | DEV_CUSTOM only when isDev; otherwise unmapped |

The physical-to-setting rows are the pinned default object; the
setting-to-button rows make the alternate-key resolution explicit. [oracle:
src/configs/inputs/cfg-keyboard-qwerty.ts:187-222,224-260,288-291 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The default object maps +, -, B, H, I, J, K, L, O, P, U, digits, Ctrl,
Delete, End, function keys, Home, Insert, quotation mark, Tab, tilde, bracket,
semicolon, comma, period, and slash keys to -1; Q is the only
development-conditional exception in that unmapped group. [oracle:
src/configs/inputs/cfg-keyboard-qwerty.ts:240-301 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Downstream, SUBMIT first calls processInput(SUBMIT) and falls back to ACTION
only when Submit is not consumed; Space is already ACTION and does not use
that fallback. Directional, Action, Cancel, Menu, Stats, and the cycle
buttons are dispatched from the input_down action table. [oracle:
src/ui-inputs.ts:89-113,141-153 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

### Held keys, browser repeat, and focus

Observed keyboard behavior is:

1. A mapped keydown emits one input_down, arms a per-button interval, and
   emits another input_down every 250 ms while the key remains armed.
2. A duplicate browser/native keydown for an already-held resolved Button is
   rejected by buttonLock; the source does not use an event.repeat branch in
   this path.
3. keyup emits input_up, removes the Button from the lock, and clears its
   interval. A printable key suppressed because a DOM text field had focus
   produces no game input on either edge.
4. A printable key whose game repeat was already armed stops emitting repeats
   when a DOM text field later takes focus, and the recorded keyup still clears
   the timer and lock.
5. Game/browser blur calls loseFocus, which clears all intervals, locks, and
   suppressed-printable tracking.

These behaviors are implemented by the 250 ms constant, keyboardKeyDown,
keyboardKeyUp, and focus cleanup. [oracle: src/inputs-controller.ts:29-39,
362-398,406-428,189-198,554-565 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The repeated event payload contains controller_type and button; it does not
contain a mode, cursor, or menu-instance value. [oracle:
src/inputs-controller.ts:379-395 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b] Therefore the pinned source
establishes browser-keydown de-duplication and timer repeat, but does not
establish a key-release fence at a submenu transition. Whether a held Space
may cross CommandRoot → MoveSelect and submit a move is an M3 contract gap;
it must not be inferred as proven parity from this static source alone.

## 2. CommandRoot

### Observed identity and geometry

The numeric command identities are FIGHT=0, BALL=1, POKEMON=2, RUN=3,
TERA=4, RESET=5, and SHIFT=6. SHIFT is documented as a triple+ active-ally
reposition and is not one of the four base command labels created in the root
handler. [oracle: src/enums/command.ts:1-15,
src/ui/handlers/command-ui-handler.ts:46-53 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The root command container is at (153,-38.7). The 2×2 base grid is:

| Cursor identity | Label position in the command container |
| --- | --- |
| FIGHT | (0,0) |
| BALL | (55.8,0) |
| POKEMON | (0,16) |
| RUN | (55.8,16) |

RESET is at (111.6,8), centered between the two grid rows. The Tera sprite is
at (-32,15). [oracle: src/ui/handlers/command-ui-handler.ts:55-87 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The cursor sprite is hidden for TERA; RESET uses cursor position (106.6,16),
and the ordinary cursor uses x=-5+(odd?56:0) and
y=8+(row>=2?16:0). [oracle:
src/ui/handlers/command-ui-handler.ts:356-383 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

### Directional graph

The exact directed navigation graph is:

    UP:
      POKEMON -> FIGHT
      RUN     -> BALL
      RESET   -> BALL

    DOWN:
      FIGHT -> POKEMON
      BALL  -> RUN
      RESET -> RUN

    LEFT:
      BALL -> FIGHT
      RUN  -> POKEMON
      RESET -> BALL
      FIGHT -> TERA       only when canTera
      POKEMON -> TERA     only when canTera

    RIGHT:
      FIGHT -> BALL
      POKEMON -> RUN
      TERA -> FIGHT
      BALL -> RESET
      RUN  -> RESET

All omitted edges return false; there is no root wrap. TERA is visible only
when the active field Pokémon is a player Pokémon, can Terastallize, and the
arena's Tera limit has not been consumed; if the cursor is Tera when the
option becomes unavailable, show moves it to FIGHT. [oracle:
src/ui/handlers/command-ui-handler.ts:218-327,337-345,171-195 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

### Action and cancel

Action on FIGHT opens FIGHT for the current field index; BALL opens the ball
mode; POKEMON opens PARTY in PartyUiMode.SWITCH for the commanding field index
with a null callback and FilterNonFainted; RUN submits the Run command; TERA
opens Fight with the Tera command; and RESET invokes the wave reset path.
[oracle: src/ui/handlers/command-ui-handler.ts:237-287 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Root cancel delegates to CommandPhase.cancel. At field index zero it has no
visible action; at a later field index it requeues every CommandPhase from
slot zero through that index and ends the current phase. [oracle:
src/phases/command-phase.ts:1995-2006 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

On root show, a Tera cursor is corrected to Fight if Tera is no longer
available. Otherwise a cursor on POKEMON is corrected to Fight and other
cursor values are retained. Command-phase reset logic additionally forces
Fight on first-turn/reset events when cursor memory is disabled, and whenever
the cursor is currently POKEMON. [oracle:
src/ui/handlers/command-ui-handler.ts:187-215,
src/phases/command-phase.ts:121-145 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

## 3. MoveSelect

### Grid, identity, and geometry

The move handler uses a numeric move-slot cursor. It renders the Pokémon's
maximum move-cell count, normally four and five when the pinned oracle grants
an extra slot. Cells are two per row. Four cells use row spacing 16 and
vertical shift 0; more than four use row spacing 12 and shift -8. Cursor
positions are x=13+(odd?114:0) and
y=-31+yShift+floor(cursor/2)*(rowSpacing-1). [oracle:
src/ui/handlers/fight-ui-handler.ts:344-369,509-535 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Every rendered cell starts as "-". A moveset entry replaces that text with
the move name; empty cells remain rendered placeholders rather than being
hidden. [oracle: src/ui/handlers/fight-ui-handler.ts:562-589 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

### Directional graph and submit

For cell count n, the exact directed graph is:

    UP:    i -> i-2  when i >= 2
    DOWN:  i -> i+2  when i+2 < n
    LEFT:  i -> i-1  when i is odd
    RIGHT: i -> i+1  when i is even and i+1 < n

There is no move-grid wrapping and no directional skip over a placeholder.
Action passes the numeric cursor to CommandPhase.handleCommand; the command
phase calls trySelectMove. An unusable move is rejected with an error unless
no move is usable, in which case the phase may choose Struggle. [oracle:
src/ui/handlers/fight-ui-handler.ts:264-316,
src/phases/command-phase.ts:1274-1310 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Fight show resets the cursor to slot zero when the Pokémon's summon turn count
is at most one; otherwise it restores the field-slot cursor (or the shared
cursor for field index zero). [oracle:
src/ui/handlers/fight-ui-handler.ts:187-203 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Move cancel returns to COMMAND for the same field index, except that the
mystery-encounter skip-to-fight condition suppresses the back-out. [oracle:
src/ui/handlers/fight-ui-handler.ts:278-285 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

## 4. TargetSelect

### Candidate topology

Target candidates are returned as live BattlerIndex values plus a multiple
flag. The pinned index enum is ATTACKER=-1, players 0,1, and enemies 2,3; the
binary selector therefore treats indices below BattlerIndex.ENEMY as the
player row and indices at or above it as the enemy row. [oracle:
src/enums/battler-index.ts:1-11, src/@types/move-target-set.ts:1-6 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

getMoveTargets maps user/party moves to the user, other/near-other moves to
opponents plus allies, enemy categories to opponents, ally categories to
allies, user-side categories to the user plus allies, and all/both-sides
categories to both sides. Spread categories set multiple; the result is then
adjusted for triple adjacency and filtered to active targets. Random-near-enemy
chooses from the opponent set using the battle RNG, and ATTACKER returns the
sentinel attacker index. [oracle:
src/data/moves/move-utils.ts:74-175 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The triple adjacency helper applies move-specific reachability before the
alive filter; its special cases include wing/center reach and the
FLYING/PULSE bypass. [oracle:
src/data/moves/move-utils.ts:177-210 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

### Directional graph, multiple targets, and selection restore

The target handler returns false for directional input on a multiple target
move. For a binary single-target move:

    UP:    player-side cursor -> first valid enemy-side target
    DOWN:  enemy-side cursor  -> first valid player-side target
    LEFT:  odd cursor -> cursor-1 only if that BattlerIndex is valid
    RIGHT: even cursor -> cursor+1 only if that BattlerIndex is valid

For a triple+ field, left/right traverse the sorted valid targets on the
cursor's current side without wrapping; Up jumps from the player side to the
first valid foe, and Down jumps from the foe side to the first valid ally.
The edge is rejected when the destination side or adjacent target is absent.
[oracle: src/ui/handlers/target-select-ui-handler.ts:89-181 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Action selects the current cursor for a single-target move and all candidates
for a multiple-target move. Cancel passes an empty target list to the callback.
The handler remembers the cursor by attacker field index; it resets a prior
cursor on first wave turn or after an ally target, and otherwise uses it when
still legal. A default target is accepted when it is present in the candidate
set. [oracle: src/ui/handlers/target-select-ui-handler.ts:38-87,89-100 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The cursor does not move a menu rectangle: setCursor resolves the selected
field Pokémon(s), highlights them, and animates their alpha/battle-info
objects. The oracle therefore supplies target topology and selected BattlerIndex
identity, not a separate target-grid pixel geometry. [oracle:
src/ui/handlers/target-select-ui-handler.ts:183-237 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Target cancel clears the turn command and requeues the same CommandPhase
through SelectTargetPhase; a successful target stores the selected target
array and only then relays the resolved own-slot command in co-op. [oracle:
src/phases/select-target-phase.ts:17-90,
src/phases/command-phase.ts:1355-1413 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

## 5. PartySelect and its option submenu

### Entry modes and visible entries

PartyUiMode.SWITCH is a voluntary, cancellable switch. FAINT_SWITCH is a
forced switch and cannot be cancelled. POST_BATTLE_SWITCH is cancellable.
[oracle: src/ui/handlers/party-ui-handler.ts:93-114 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The party screen creates a cancel button at (291,-16), creates one visible
party slot for each player-party entry, and calls setCursor(0) on every fresh
show. Faint or otherwise filtered entries are therefore rendered party
entries, not hidden navigation holes; the selection filter decides whether an
option is legal. [oracle:
src/ui/handlers/party-ui-handler.ts:360-404,440-479,1461-1491,
src/ui/handlers/party-ui-handler.ts:290-304 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The standard party slot x-coordinate is 9 for on-field entries and 143 for
bench entries. The y-coordinate is derived from field format and slot index:
bench rows start at -196 (minus 40 for double/triple) with step 28 (or 36 for
double/triple); triple active rows start at -160 with step 44; single/double
active rows use -148.5 plus the format-specific offset and step. [oracle:
src/ui/handlers/party-ui-handler.ts:2405-2436 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

### Main party graph

The normal cursor uses party indices 0..5 and cancel 6. The exact
non-item-mode vertical edges are:

    UP:
      0        -> 6
      i (1..5) -> i-1
      6        -> last party slot

    DOWN:
      i before last slot -> i+1
      last party slot    -> 6
      6                  -> 0

    LEFT:
      6 or a bench slot -> remembered left/on-field cursor
      active slot       -> no edge

    RIGHT:
      active slot with a bench -> remembered right/bench cursor, otherwise cancel 6
      bench slot               -> no edge

lastLeftPokemonCursor and lastRightPokemonCursor are updated from the current
side while navigating. Item-management mode has additional cursor 7 branches;
those are outside the M3 switch surfaces. [oracle:
src/ui/handlers/party-ui-handler.ts:1378-1458 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

### Option submenu

Action on a party Pokémon opens the option submenu; Action on cursor 6 invokes
the main cancel path when cancellation is allowed. The option submenu uses
only vertical navigation in switch modes, and Up/Down wrap from first to last
and last to first option. Left/Right are rejected except in item-management
modes. [oracle: src/ui/handlers/party-ui-handler.ts:1216-1262,
1293-1351,855-860 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The option list always appends PartyOption.CANCEL; when it is longer than nine
entries it inserts scroll-up/scroll-down entries. Cancel while the option
submenu is open only clears that submenu and returns to the party cursor.
[oracle: src/ui/handlers/party-ui-handler.ts:1182-1213,
1523-1561,1723-1745 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

For SWITCH, FAINT_SWITCH, and POST_BATTLE_SWITCH, a bench cursor with
cursor >= battlerCount receives SEND_OUT, or PASS_BATON when the relevant
baton condition applies; the common party options are then appended. In
triple+ voluntary switch, an active ally other than the commanding slot may
receive SHIFT. [oracle:
src/ui/handlers/party-ui-handler.ts:1747-1818 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Selecting SEND_OUT or PASS_BATON in voluntary SWITCH clears the option
submenu and submits Command.POKEMON with the numeric party cursor. In forced
and post-battle modes, the same options are delivered through the mode's
selection callback. [oracle:
src/ui/handlers/party-ui-handler.ts:1130-1177 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

### Filtering and cancel restoration

FilterNonFainted returns an error string for a fainted Pokémon and null for a
non-fainted one. A filtered option clears the option list, shows the error, and
does not invoke the switch callback. [oracle:
src/ui/handlers/party-ui-handler.ts:292-297,955-976,1042-1048 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

In voluntary SWITCH, the command handler opens Party with a null callback;
Party cancel therefore returns to COMMAND with the same field index. Because
Party show starts at cursor zero, the party cursor itself is not restored.
Command show preserves its prior root cursor except that POKEMON is changed to
FIGHT. [oracle: src/ui/handlers/command-ui-handler.ts:250-258,209-213,
src/ui/handlers/party-ui-handler.ts:440-479,1353-1375 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

In FAINT_SWITCH, allowCancel is false. Action on the main cancel cursor only
plays an error; the option submenu's own Cancel still closes that submenu
because its Cancel path is separate. [oracle:
src/ui/handlers/party-ui-handler.ts:1182-1195,1280-1282,1343-1350 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

## 6. Forced replacement and wrong-seat behavior

Player faint handling pushes SwitchPhase when there is at least one legal
off-field player Pokémon. [oracle: src/phases/faint-phase.ts:237-271 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b] A normal owner replacement opens
Party with FAINT_SWITCH, the affected field index, a callback, and
FilterNonFainted; a post-battle replacement uses POST_BATTLE_SWITCH. [oracle:
src/phases/switch-phase.ts:464-524,551-562 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

In co-op, the fixed field slot is retained rather than collapsed to slot zero,
and only the player who owns that field slot opens the replacement picker. The
partner watches the owner's relayed choice and does not open a local picker.
[oracle: src/phases/switch-phase.ts:119-146,404-416 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

At the command boundary, generated skips and partner-owned slots are handled
without asking the non-owner to choose: the non-local path executes queued
partner actions or auto-resolves, while the local slot waits for the reciprocal
barrier before its own command UI opens. [oracle:
src/phases/command-phase.ts:864-920 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

The voluntary-switch party filter also rejects a partner-owned Pokémon when
the picker is for a locally owned field slot. The same filter covers voluntary
and forced paths. [oracle:
src/ui/handlers/party-ui-handler.ts:925-953 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

For a relayed partner move, CommandPhase applies the already resolved target
array and does not enqueue the local interactive target selector. A local
owned move may enqueue SelectTargetPhase when it has multiple candidates and
is a spread selection. [oracle:
src/phases/command-phase.ts:1355-1389 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

If a co-op owner has no legal same-owner replacement, forced replacement closes
with a no-pick sentinel and leaves the slot empty rather than opening a picker
that cannot be completed. [oracle:
src/phases/switch-phase.ts:418-463 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

## 7. Submenu lifecycle and instance boundaries

The base handler stores a numeric mode, a numeric cursor, and an active flag;
its generic show activates and its generic clear deactivates the handler.
[oracle: src/ui/handlers/ui-handler.ts:8-28,40-73 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

UI mode changes increment an internal modeTransitionGeneration; on a mode
change the old handler is cleared and the new handler is shown with the
numeric setMode arguments. A same-mode call can reopen an inactive handler,
but the generation is an internal transition fence rather than a public menu
option identity. [oracle: src/ui/ui.ts:814-895 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

Observed submenu transitions are:

    CommandRoot --Fight--> MoveSelect
    MoveSelect  --Cancel--> CommandRoot
    CommandRoot --Pokemon--> PartySelect(SWITCH)
    PartySelect(SWITCH) --Cancel--> CommandRoot
    MoveSelect  --spread/multiple candidate--> TargetSelect
    TargetSelect --Cancel/empty target--> CommandPhase requeue -> CommandRoot

The transition calls carry mode, field index, command/move identity, callback,
and filters as ordinary arguments, but neither the input_down event nor the
handler cursor contains a stable submenu-instance ID. [oracle:
src/ui/handlers/command-ui-handler.ts:237-258,
src/ui/handlers/fight-ui-handler.ts:278-285,
src/phases/select-target-phase.ts:41-63,
src/inputs-controller.ts:379-395 @
3b534099919efae827019d4a3f3c4ab0ecd6d67b]

## 8. Proposed stable IDs and contract decisions (not frozen)

These are recommendations for the M3 contract layer, derived from the
observed numeric cursors and transitions above; they are intentionally not
production TypeScript or a shared API:

| Surface | Proposed stable option identity | Observed basis |
| --- | --- | --- |
| CommandRoot | command.fight, command.ball, command.pokemon, command.run, command.tera, command.reset | Numeric Command enum and root labels/geometry. [oracle: src/enums/command.ts:1-15, src/ui/handlers/command-ui-handler.ts:46-87 @ 3b534099919efae827019d4a3f3c4ab0ecd6d67b] |
| MoveSelect | move.slot.<fieldIndex>.<moveSlotIndex> | Move cursor is a two-column numeric slot and is remembered by field slot. [oracle: src/ui/handlers/fight-ui-handler.ts:187-203,344-369,509-535 @ 3b534099919efae827019d4a3f3c4ab0ecd6d67b] |
| TargetSelect | target.<fieldIndex>.<BattlerIndex> | Target candidates and remembered cursor are BattlerIndex values keyed by attacker field index. [oracle: src/ui/handlers/target-select-ui-handler.ts:38-100 @ 3b534099919efae827019d4a3f3c4ab0ecd6d67b] |
| PartySelect | party.slot.<partyIdentity>; use a snapshot-stable party identity rather than treating the display cursor as identity | The oracle renders party-array entries but passes numeric party slots to callbacks. [oracle: src/ui/handlers/party-ui-handler.ts:1461-1491,1139-1177 @ 3b534099919efae827019d4a3f3c4ab0ecd6d67b] |
| Party option submenu | party.option.<PartyOption> plus party.option.cancel | PartyOption is numeric and the option list is dynamic/scrollable. [oracle: src/ui/handlers/party-ui-handler.ts:185-226,1723-1745 @ 3b534099919efae827019d4a3f3c4ab0ecd6d67b] |

Proposed graph rules:

- Carry an explicit directed adjacency table per menu instance. Reject an
  absent/hidden/disabled destination without changing the selected identity.
  Preserve the oracle's no-wrap root, move, and target graphs; preserve the
  party main-list and party-option wrap edges as separate explicit rules.
  [oracle: src/ui/handlers/command-ui-handler.ts:289-327,
  src/ui/handlers/fight-ui-handler.ts:287-308,
  src/ui/handlers/target-select-ui-handler.ts:108-181,
  src/ui/handlers/party-ui-handler.ts:855-860,1395-1453 @
  3b534099919efae827019d4a3f3c4ab0ecd6d67b]
- Give each opened submenu a monotonically increasing instance token. Bind
  held-key repeat and submit to the token captured when the physical key_down
  was accepted; discard a repeat or submit whose token is stale. This is a
  proposed M3 guard, not an observed TS behavior. The need follows from the
  observed repeat payload carrying only a Button and the internal UI
  generation not being exposed to it. [oracle:
  src/inputs-controller.ts:379-395, src/ui/ui.ts:829-895 @
  3b534099919efae827019d4a3f3c4ab0ecd6d67b]
- Separate visible, disabled, and selectable state. The oracle hides
  unavailable Tera, renders empty move cells, renders filtered party entries,
  and reports filter errors only after option action; these states should not
  be collapsed into one implicit cursor rule. [oracle:
  src/ui/handlers/command-ui-handler.ts:187-195,
  src/ui/handlers/fight-ui-handler.ts:562-589,
  src/ui/handlers/party-ui-handler.ts:1461-1491,1042-1048 @
  3b534099919efae827019d4a3f3c4ab0ecd6d67b]
- Make cancellation destination part of the graph: MoveSelect and voluntary
  PartySelect return to the same field's CommandRoot; TargetSelect cancel
  requeues the command; forced PartySelect has no main cancel edge. Selection
  restoration should be keyed by stable option ID, while preserving the
  oracle's explicit reset conditions where parity is required. [oracle:
  src/ui/handlers/fight-ui-handler.ts:278-285,
  src/ui/handlers/party-ui-handler.ts:1280-1282,1353-1375,
  src/phases/select-target-phase.ts:59-63,
  src/ui/handlers/command-ui-handler.ts:209-213,
  src/ui/handlers/fight-ui-handler.ts:187-203 @
  3b534099919efae827019d4a3f3c4ab0ecd6d67b]
- Reject input for a non-owned co-op field slot before constructing a local
  menu instance. Forced replacement must be owner-only; a partner's resolved
  move/target must not open a selector on the watching client. [oracle:
  src/phases/switch-phase.ts:139-146,
  src/phases/command-phase.ts:1355-1389,
  src/ui/handlers/party-ui-handler.ts:925-953 @
  3b534099919efae827019d4a3f3c4ab0ecd6d67b]

## 9. Unresolved parity gaps

1. No stable option ID or public submenu-instance token is present in the
   pinned UI handler/input payload. The internal transition generation is not
   enough to prove stale held-input rejection. [oracle:
   src/ui/handlers/ui-handler.ts:8-28,44-55,
   src/inputs-controller.ts:379-395, src/ui/ui.ts:829-895 @
   3b534099919efae827019d4a3f3c4ab0ecd6d67b]
2. The exact static source does not prove the required physical Space
   key-down/key-up scenario across the asynchronous CommandRoot → MoveSelect
   transition. A dynamic browser result must not be fabricated from the timer
   code. [oracle: src/inputs-controller.ts:362-398,
   src/ui/handlers/command-ui-handler.ts:237-244,
   src/ui/handlers/fight-ui-handler.ts:264-277 @
   3b534099919efae827019d4a3f3c4ab0ecd6d67b]
3. Tera is hidden when unavailable, while move placeholders and filtered party
   entries remain visible and fail at different stages. M3 needs an explicit
   hidden/disabled/reject policy for any Rust-facing menu snapshot. [oracle:
   src/ui/handlers/command-ui-handler.ts:187-195,
   src/ui/handlers/fight-ui-handler.ts:562-589,
   src/ui/handlers/party-ui-handler.ts:955-976,1042-1048 @
   3b534099919efae827019d4a3f3c4ab0ecd6d67b]
4. Target topology is data-driven by move target category, live adjacency, and
   field arrangement; the selector has no independent pixel-grid geometry.
   The contract still needs to choose whether target IDs are BattlerIndex-only
   or include a stable field-slot/instance identity. [oracle:
   src/data/moves/move-utils.ts:74-175,177-210,
   src/ui/handlers/target-select-ui-handler.ts:139-181,183-237 @
   3b534099919efae827019d4a3f3c4ab0ecd6d67b]
5. Party show resets its cursor to zero, command show preserves most root
   cursors, move show restores by field slot after its first-turn rule, and
   target show restores only when the prior target remains legal. The shared
   contract must decide whether this observed restoration is authoritative or
   whether stable IDs should restore a prior selection after a snapshot change.
   [oracle: src/ui/handlers/party-ui-handler.ts:440-479,
   src/ui/handlers/command-ui-handler.ts:187-215,
   src/ui/handlers/fight-ui-handler.ts:187-203,
   src/ui/handlers/target-select-ui-handler.ts:74-87 @
   3b534099919efae827019d4a3f3c4ab0ecd6d67b]
6. Forced co-op replacement has an explicit no-legal-same-owner sentinel path
   that closes the picker and leaves the slot empty. The Rust contract must
   represent that terminal outcome instead of assuming every forced menu has a
   selectable replacement. [oracle:
   src/phases/switch-phase.ts:418-463 @
   3b534099919efae827019d4a3f3c4ab0ecd6d67b]

No parity numbers, fixture results, or runtime observations are claimed by
this extraction.
