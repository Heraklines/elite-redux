# Battle AI - the "drastic leap": a Foul-Play-style depth-1 position evaluator

Status: implementing. Lands ONLY on the **experimental** AI profile
(`ErAiProfile.kind === "experimental"`), gated by the master switch + Elite/Hell
+ the A/B harness (`setErAiExperimentalMode` / `er.ai.experimentalPct`). The
shipped **standard** brain and every non-experimental trainer are untouched, so
the two can be played back-to-back and compared.

## What changes

The standard brain is **greedy**: it scores each move by the damage IT deals
this turn (real simulated damage + KO bonus, refined by Slices 1-4). It never
asks "what does the board look like AFTER the opponent replies?"

The experimental brain is **positional**: for each candidate move it builds the
resulting board one ply ahead - my move resolves, the opponent plays its best
reply - and scores that whole position with a hand-tuned evaluation. It then
picks the move whose worst-case resulting position is best (maximin / "safest
move"). This is exactly the structure of pmariglia's Foul Play / `showdown`
expectiminimax bot, at depth 1.

This is a genuinely different decision procedure, not a tweak. It makes the AI:
- value a KO that **also denies the opponent's turn** (KO while outspeeding, incl. via priority) far above an equal-damage move that doesn't;
- treat moves as **trades** (my HP/board vs theirs), so it won't throw its mon into a worse exchange;
- correctly **discount a slow move that will not execute** because it is KO'd first (replaces the ad-hoc `ER_SLOW_DOOMED_PENALTY` with the position outcome);
- only **set up / use status** when the resulting position - having eaten the opponent's free hit - still beats just attacking;
- weigh **whole-team** state (alive count, hazards, matchup), not just the active mon.

## Source we are copying (MIT)

pmariglia's hand-written evaluation + expectiminimax. The clean, fully-explicit
version is the legacy Python `showdown` repo (the modern `foul-play` bot moved to
MCTS in Rust; the eval constants are the same idea).

- Eval: `showdown/engine/evaluate.py` @ `375ae499ce543d3c124bec53cbba67c74848dad8`
  https://github.com/pmariglia/showdown/blob/375ae499ce543d3c124bec53cbba67c74848dad8/showdown/engine/evaluate.py
- Search (`get_payoff_matrix`, `pick_safest`): `showdown/engine/select_best_move.py` @ same commit.
- Refined constants (Rust): `pmariglia/poke-engine` `src/genx/evaluate.rs`, `src/search.rs`.

### Ported constants (`Scoring`)

| Term | Value | Note |
|---|---|---|
| Alive (per un-fainted mon) | **+75** | flat |
| HP | **+100 * (hp/maxHp)** | linear |
| Atk/Def/SpA/SpD boost (per stage) | **15** * diminishing | |
| Spe boost (per stage) | **25** * diminishing | speed weighted higher |
| Boost diminishing multiplier | stage -> {±1, ±2, ±2.5, ±3, ±3.15, ±3.3} | returns taper at 3-6 |
| Freeze / Sleep / Paralysis | -40 / -25 / -25 | |
| Toxic / Poison / Burn | -30 / -10 / -25 | |
| Stealth Rock | **-10 * aliveReserves** | scaled by how many switch-ins eat it |
| Spikes / Toxic Spikes (per layer) | **-7 * aliveReserves** | |
| Sticky Web | **-25** | counted once |
| Type-matchup | **±20 * effectiveness** | active vs active, both directions |

`evaluate()` is **zero-sum**: sum my side, subtract the opponent's side, add my
hazards-penalty-on-them minus their hazards-penalty-on-me, add the matchup term.
A positive score is good for the scoring mon. Each mon's contribution is clamped
`>= 0` before the alive bonus (a near-dead mon shouldn't read as a liability the
other side wants to preserve - per the Rust refinement).

## The PokeRogue adaptation (depth-1, no full simulator)

Foul Play has a complete forward engine (`poke-engine`) that mutates a cloned
state and enumerates probability branches. We do **not** - cloning/simulating a
full PokeRogue turn is out of scope. Depth-1 only needs the **post-turn HP /
faint / status** of two active mons, which we get directly from the existing
`getAttackDamage({simulated:true})` sim (the same fog-aware call the standard
brain already uses - the AI still does not read the player's unrevealed ability).

For each of the enemy's candidate moves `m` vs the chosen target `T`:

1. **My move outcome.** `myDmg = getAttackDamage(T, m)` (already computed by Slice 1). `T` faints if `myDmg >= T.hp`. Setup/hazard/status moves apply their modelled board change instead (see below).
2. **Turn order.** `iMoveFirst = threat.outspeeds || m.priority > 0` (priority folds into effective speed vs the active target).
3. **Opponent's maximin reply.** Their best move = the one that most lowers my position ≈ their highest-damage hit on my active (`worstIncomingDamage`, from `erAssessThreat`, fog-aware). Resolution:
   - `iMoveFirst` **and** `T` faints -> the opponent's active is KO'd before it acts: **no reply this turn** (its switch-in is not modelled at depth 1). This is the tempo win.
   - `iMoveFirst` and `T` survives -> opponent hits my active for `worstIncomingDamage`.
   - opponent first -> it hits my active first; if that KOs me, **my move never executes** (`myDmg` -> 0, no board change); otherwise I then hit `T`.
4. **Build the resulting position** (post-turn HP/faint for both actives, current boosts/status carried, my modelled board change applied, alive reserve counts, current hazards, matchup) and score it with `erEvalPosition`. That score IS the move's score.

Because the opponent's best reply is baked into every move's outcome, ranking
moves by this score already is the maximin pick. The existing **sharpness dial**
runs on top unchanged (Hell experimental = argmax; the A/B "alternate" mode still
toggles brains per wave).

### Move-effect modelling (v1 scope)

- **Attack moves:** damage + KO, precise. Secondary effects (status chance, self-boost) are **not** modelled in v1 - noted as a refinement.
- **Setup moves** (`MoveTarget.USER` + `StatStageChangeAttr`): credit the Foul-Play boost-value delta for the stages gained on my active; the opponent's free hit is modelled precisely, so the AI still refuses to set up into a KO.
- **Hazard moves** (`ER_HAZARD_MOVE_IDS`): add a layer to the opponent's side -> their hazard penalty (scaled by their reserves) improves my position.
- **Other status / non-damaging moves:** no board change modelled; evaluated as "I do nothing this turn, opponent gets its hit". This conservatively de-prioritises un-modelled status, which is acceptable for v1 (note: refine with status-infliction value).

### ER format: 4-5 abilities + innates, 5-8 moves

Foul Play assumes the standard 4-move / single-ability layout. ER does not - mons
carry up to ~8 moves and multiple abilities/innates. This needs **no structural
change**, for two reasons:

- **The position eval is format-agnostic.** It scores alive/HP/status/boosts/
  hazards/matchup - none of which depend on movepool size or how many abilities a
  mon has. The constants are per-mon, not per-move.
- **The search already iterates the full moveset.** My candidate loop runs over
  the whole `movePool` (whatever its length); the opponent's maximin reply
  (`erAssessThreat`) scans the opponent's entire `moveset` for its single hardest
  hit. Depth-1 cost is O(myMoves x oppMoves) damage sims = at most ~8x8 = 64
  cheap simulated calls per turn, comfortably inside the browser budget (the
  combinatorial blow-up that forces Foul Play to cap depth only bites at depth >=2).
- **Multi-ability / innate damage is already correct.** Damage, effective speed,
  type immunities and the matchup all flow through the live engine
  (`getAttackDamage` / `getEffectiveStat` / `getAttackTypeEffectiveness`), which
  applies every ER innate. The only approximation is the single `abilityRevealed`
  fog flag: with several innates, some may be revealed and some not, and we treat
  the mon's ability state as one bit. Acceptable for v1; a per-innate reveal model
  is a future refinement.

### Reserve / fog notes

Reserve value uses **alive counts** (visible) - my own bench by real alive count,
the opponent's by alive-count too (no peeking at unrevealed player sets/HP). HP of
benched mons is not read. This keeps the no-cheat principle of the existing
threat model while still valuing "don't lose your last mon" and scaling hazards.

## Files

- `src/data/elite-redux/er-enemy-ai.ts`: `ER_EVAL` constants, `erBoostValue`, `erStatusValue`, `erEvalMon`, `erEvalPosition`, the depth-1 combiner `erDepth1MoveScore`, and `worstIncomingDamage` added to `ErThreat`/`erAssessThreat`. All pure logic unit-tested.
- `src/field/pokemon.ts` `getNextMove`: when `erAi.kind === "experimental"`, build per-move outcomes and score via the combiner instead of the greedy transform.
- `test/tests/elite-redux/er-enemy-ai.test.ts`: eval + combiner tests.
- `src/dev-tools/test-suite/scenarios.ts`: an "experimental brain" scenario.

## Out of scope (future)

- Switch nodes in the depth-1 tree (Foul Play treats switches as moves); we keep the existing matchup-based switch logic in `enemy-command-phase.ts`, which the experimental profile already runs at the most aggressive threshold.
- Secondary-effect chance branches, volatiles (Substitute/Leech Seed), screens, weather/terrain, items in the eval.
- Depth >= 2 / true chance-node expectiminimax.
