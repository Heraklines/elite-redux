# Showdown Mode - PvP battles with mon wagering (design)

Maintainer directive (2026-07-03, verbatim requirements): "lets do a showdown mode, ppl will
also be able to bet their shinies or any mon. they can set the ante ahead of time, either its
a normal mon or a mon of at least a certain cost, or at least a certain shiny tier. if you
lose you lose what you bet permanently, and vice versa. all the mon selection will be through
starter select, ofc we'd have to slightly modify it so ppl can choose fully evolved mons and
megas (only one per teaam for now) and choose from all moves that pokemon can learn as well
as choose an item"

Priority note: CO-OP REMAINS THE PRIORITY LANE ("we will keep doing coop, i want this more
then showdown"). Showdown work never blocks a live co-op fix.

## Why this is cheap: what transfers from co-op + ghosts

| Piece | Source | Reuse |
|---|---|---|
| Transport (WebRTC + signaling + TURN), lobby, pairing, invites | co-op P6 / LIVE-A | verbatim |
| Host-authoritative engine (one sim, one renderer) | co-op M3/M4 | verbatim |
| Command relay (human command applied verbatim on the other engine) | co-op LIVE-C | needs an ENEMY-SLOT variant |
| Decline -> AI fallback (AFK/disconnect timer for free) | #693 fix | verbatim |
| Per-turn checkpoint + checksum + resync | #684/#798 | verbatim |
| Live event stream w/ identity resolution | #796 fix | verbatim |
| Enemy party from a SERIALIZED PLAYER TEAM (items included) | ghost trainers (#217/#537) | the enemy-side shortcut |
| "All learnable moves" legality set | Learner's Shroom #404 | verbatim for the move picker |
| Evolution-stage / form navigation | #240 + dex form nav | for evolved-form pick |

What showdown DROPS from co-op (where most desync pain lived): shops, rotation, MEs,
acquisition sharing, party adopts, account crediting, waves, save/resume.

## The ante (wager) system

- The CHALLENGE carries the ante terms; ACCEPTING the challenge = agreeing to them. Terms
  are one of three tiers, set ahead of time by the challenger:
  1. NORMAL: any mon.
  2. COST FLOOR: a mon whose starter cost is >= N (challenger picks N).
  3. SHINY FLOOR: a mon of at least shiny tier T (challenger picks T; includes black-shiny
     as the top tier).
- Before team building, EACH player designates their staked mon. BOTH clients independently
  validate the opponent's serialized stake against the agreed terms (cost/tier read from the
  serialized data + local species tables). Invalid stake -> challenge voided before battle.
- Stakes are LOCKED once the battle starts (no backing out; a mid-battle disconnect counts
  as a loss after the decline-fallback timer plays out the battle).
- Result: the loser PERMANENTLY loses the staked mon; the winner GAINS it.

### What "losing a mon permanently" means in account terms

Account ownership is dexData/starterData bits, so the transfer is bit-level and precise:
- NORMAL stake: the species' caughtAttr bits for the staked VARIANT are cleared on the loser
  and OR'd into the winner (seenAttr stays - you still saw it). If the loser stakes their
  only variant of the species, they lose the starter entirely.
- SHINY stake: only the staked shiny tier's attr bits (+ erShinyLab look, if that specific
  look was staked) transfer. Lower tiers the loser separately owns stay.
- Candies do NOT transfer (they are account progress, not the mon). abilityAttr for the
  staked variant transfers.
- Guard rails: cannot stake a species that is in EITHER player's active saved run; cannot
  stake your last remaining usable starter; black-shiny transfer respects the 1-per-team
  rule on the winner's side automatically (it is an unlock, not a party mon).

### Trust model (stated plainly)

The battle is host-authoritative: the host's machine runs the sim, so a modified client
could cheat. v1 mitigations, consistent with the existing account trust model (ghosts,
cloud saves are already client-pushed):
- Both clients independently validate the stake legality.
- END-OF-BATTLE HANDSHAKE: both clients sign the outcome (winner + staked mon ids + final
  checksum); if the signatures disagree, the bet is VOID (no transfer) and both keep their
  mons. A cheater can at worst void a bet, never steal.
- The transfer executes on BOTH clients from the signed outcome (loser clears bits, winner
  ORs bits) and force-pushes saves (#389 path). Server-side judging is future work.

## Team builder (starter-select variant)

- Entry: co-op lobby -> "Showdown" challenge -> terms -> accept -> stake designation ->
  team builder.
- 6 mons (fewer allowed), from mons the player OWNS (species + variant + shiny tier owned).
- EVOLVED FORMS: pick the line in the grid, then choose ANY evolution stage (reuse the
  branched-evolution picker UX); MEGAS selectable - HARD CAP one mega per team (v1).
- MOVES: pick 4 from the mon's FULL legality set (level-up + TM + tutor + egg - the
  Learner's Shroom computation). No future-level restriction: showdown mons are flat-level.
- ITEM: one held item per mon from a curated competitive list (resist berries, ward stones,
  type items, Loaded Dice, Lucky Heart, Omni Gem, choice-style ER items...). One item, no
  stacks, v1.
- STATS: flat level 100 both sides; IVs = the account's best-recorded dexIvs for the
  species; nature = any the account has unlocked for it. Luck/shiny FX render but give no
  battle bonus (no run economy to boost).

## Battle

- 6v6 SINGLES v1 (doubles later). Host-authoritative: the guest's team is reconstructed on
  the host's ENEMY side via the ghost-trainer path (held items included); the guest drives
  those enemy slots over the relay (enemy-slot commandRequest variant); decline fallback ->
  AI plays for a disconnected/AFK player until the timer resolves the match.
- Perspective v1: both screens render the HOST's perspective (guest sees its team top-side).
  A battler-index flip in the replay present layer is the v2 polish (the identity-carrying
  events make it safe).
- No catching, no fleeing, no bag items mid-battle, no exp/money. Win = opponent's 6 all
  fainted. The result handshake fires from the shared final checkpoint.

## Player presentation (maintainer requirement, 2026-07-03)

"make sure that in showdown battles the trainer sprites that appear match the users ghost
customization presets... their fx, lines, etc" - each player appears to their opponent
EXACTLY as their GHOST TRAINER does:
- Trainer CLASS + SPRITE from the player's ghost customization (the #424 varied-class system).
- Account NAME with the player's animated name-FX preset (#727-#733 module - already cached
  frame-loop, reusable on the VS/battle surface).
- Custom LINES: the ghost's intro / victory / defeat dialogue plays at the corresponding
  showdown moments.
- Shiny Lab looks/FX on their mons render exactly as on their own screen (the #785 sync).
The serialized challenge payload therefore carries the ghost-presentation block (class,
sprite key, name-FX preset, lines) alongside the team - reuse the ghost serializer, do not
invent a second format.

## Build order (subtasks)

S1 lobby challenge + ante terms protocol + stake designation/validation/lock
S2 team builder variant (evolved forms + mega cap + full-move picker + item picker)
S3 battle core (team exchange -> ghost-path enemy reconstruction -> enemy-slot command
   relay -> flat-level battle -> end detection)
S4 result handshake + bit-level ante transfer + void-on-mismatch + save force-push
S5 duo-harness probes: full showdown across two engines; transfer assertions both
   directions; illegal-stake rejection; disconnect-mid-battle -> decline path -> loss
S6 polish: stake display during battle, victory/transfer ceremony screen, log markers,
   ghost-preset presentation (trainer sprite/class + name-FX + custom lines + VS splash)
