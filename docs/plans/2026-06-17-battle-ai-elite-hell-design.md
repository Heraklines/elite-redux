# Design: a drastically smarter Elite/Hell battle AI

**Date:** 2026-06-17
**Status:** Design — pending review, then sliced implementation
**Scope:** Make the enemy AI a much harder, genuinely *smart* opponent on the
Elite and Hell difficulties only. Youngster/Ace (the "vanilla" difficulties)
keep stock PokeRogue behavior byte-for-byte.

---

## 1. Goals & constraints

**Goal.** On Elite/Hell, enemy trainers and bosses should play close to how a
strong human plays: pick the move that actually does the most relevant work
(real damage / secured KO / correct setup), switch to real counters, use the
field (hazards, weather, Tera) well, and coordinate in doubles — with *no*
deliberate self-sabotage on Hell.

**Hard constraints (from the maintainer):**
- **Elite + Hell only.** Youngster/Ace and all wild-only encounters keep vanilla
  AI. The vanilla code path must remain reachable and unchanged.
- **No in-battle items.** ER has no battle-item system for either side — there is
  no enemy `Command.ITEM`. Drop all "trainer heals / Full Restore / X-item"
  ideas. (This stays true unless an item system is added later.)
- **Fully reversible.** A single switch (the "AI profile") flips the whole thing
  back to stock. No irreversible rewrites of core combat.
- **2.65 dex is authoritative** (CLAUDE.md): the AI reasons over live move/ability
  data; it must not hardcode balance assumptions that contradict the dex.
- **Every observable combat change ships a dev-suite scenario** (CLAUDE.md
  standing rule) plus a vitest where unit-testable.

**Determinism dial (decided):**
- **Hell = fully optimal** — remove the deliberate "slide-down to a worse move"
  entirely; it always plays its best evaluated move.
- **Elite = near-optimal** — keep a small misplay chance for unpredictability.
- Sharpness is a **per-difficulty balance knob** so the exact feel is tunable
  from the editor without a rebuild.

---

## 2. How the AI works today (grounded map)

All file:line refs are against the current `feat/elite-redux-port`.

### 2.1 There is only one good brain
`EnemyPokemon` assigns AI type in its constructor:
`pokemon.ts:7920` → `this.aiType = boss || this.hasTrainer() ? AiType.SMART : AiType.SMART_RANDOM`.
Enum: `src/enums/ai-type.ts` (`RANDOM`, `SMART_RANDOM`, `SMART`). `RANDOM` is
never assigned in-game. So **every trainer/boss already uses the top tier
(`SMART`)** — "harder AI" cannot come from a new tier; it must come from a
better scorer and/or better inputs.

### 2.2 Move selection — `EnemyPokemon.getNextMove()` (`pokemon.ts:8037`)
1. **Move queue / Encore** short-circuits (`:8040`, `:8069`).
2. **KO filter (`:8093`–`8136`)** — the *only* place real damage is computed:
   simulates `getAttackDamage({ simulated: true, ignoreAbility: !revealed })`
   (`:8119`) against each player target; if any non-status move's damage `>= hp`,
   the pool is **restricted to those KO moves** (`:8134`).
3. **Scoring (`:8143`–`8213`)** — for the remaining pool, each move's score is
   `getUserBenefitScore + getTargetBenefitScore × (ally ? -1 : 1)` (`:8162`),
   and for attack moves it is multiplied by **type effectiveness** and **×1.5
   STAB** (`:8181`–`8200`). The attack benefit itself
   (`AttackMove.getTargetBenefitScore`, `move.ts:1480`) is a crude proxy:
   `floor(effectivePower / 5)` ± an effectiveness term — **no real damage, no
   read of the target's actual Def/SpDef/HP.** The code even comments
   `// could make smarter by checking opponent def/spdef` (`:8211`).
4. **Selection (`:8216`–`8244`)** — sort by score, then:
   - `SMART_RANDOM` (`:8223`): 5/8 keep best, 3/8 step to next-best, repeat.
   - `SMART` (`:8228`): step-down probability scales with how *close* the two
     scores are — **up to ~50% chance to take a worse move.** This is deliberate
     handicapping.
5. **Target choice** — `getNextTargets` (`:8277`) does a **weighted-random** pick
   among targets (not argmax), TBS as weights (`:8291`–`8355`).

### 2.3 Switching — `EnemyCommandPhase.start()` (`enemy-command-phase.ts:32`)
Each turn a trainer mon may switch *before* moving (`:58`–`88`): it averages
`getMatchupScore` over the opposing field, compares the best benched mon's score
× a `switchMultiplier` (anti-spam decay, `:70`) against `matchupScore ×
(isBoss ? 2 : 3)` (`:72`). Replacement chosen by
`Trainer.getNextSummonIndex` (`trainer.ts:665`).
- `getMatchupScore` (`pokemon.ts:3567`): `(atkScore + defScore) × min(hpDiffRatio,1)`.
  `atkScore` **averages** the effectiveness of all damaging moves
  (`~:3623`, flagged "excessively simplistic") — one 4× move is diluted by weak
  coverage.
- **Hazard awareness is inconsistent:** applied for proactive switches
  (`forSwitch=true`, `trainer.ts:641`) but **omitted** for faint replacements
  (`faint-phase.ts:186`–`198`, cursor `-1`) and move/ability-forced switches
  (`ab-attrs.ts:6298`–`6314`) — so the AI can drop a 4×-Rocks-weak mon into its
  own hazards after a KO.

### 2.4 Inputs (already strong; not the bottleneck)
- Movesets: `ai-moveset-gen.ts:generateMoveset` (`:1086`). Trainers/bosses draw
  egg + TM pools (`:1101`–`1112`), get weighting tweaks (`:395`–`411`, `:1132`),
  forced STAB/signature. ER curated rosters bypass generation with hand-authored
  4-move sets (`er-trainer-runtime-hook.ts:479`–`483`).
- IVs/natures: vanilla trainers get rising IV floors (`pokemon.ts:7905`); ER
  rosters use authored/perfect IVs + natures (`er-trainer-runtime-hook.ts:476`).
- Difficulty scaling: levels (`battle.ts:getLevelForWave`, Hell rescale
  `er-run-difficulty.ts:65`–`85`), BST caps (`er-trainer-runtime-hook.ts:862`),
  cadence (`er-battle-frequency.ts`). All editor-tunable via `er-balance-knobs.ts`.

**Conclusion.** The inputs are already hard. The *brain* is the bottleneck: it
ranks by a power/effectiveness proxy instead of real damage, throws games on
purpose, switches on a diluted matchup metric, and is hazard-blind on forced
swaps. That is what we fix — for Elite/Hell only.

---

## 3. Architecture: a difficulty-gated "AI profile"

### 3.1 Principle
Introduce one resolved object, the **AI profile**, derived from the run
difficulty. Core combat calls into ER logic only when the profile is active;
otherwise it takes the exact vanilla branch. This bounds blast radius (casual
modes untouched) and makes the feature reversible (profile off → stock).

```
ErAiProfile {
  active: boolean;          // false for youngster/ace and non-ER battles
  sharpness: number;        // 0..1; 1 = always best move (Hell), <1 = some noise (Elite)
  useRealDamage: boolean;   // real damage scoring vs vanilla proxy
  smartSwitching: boolean;  // counter-aware, hazard-aware switching
  hazardAwareForcedSwitch: boolean;
  doublesCoordination: boolean;
  smartTera: boolean;
}
```

Resolved once per battle (or memoized per enemy) from
`er-run-difficulty.ts` (`getErDifficulty()`), e.g. `hell` → all-on + sharpness 1,
`elite` → all-on + sharpness ~0.85, else → `{ active: false }`.

### 3.2 New module
**`src/data/elite-redux/er-enemy-ai.ts`** — owns:
- `resolveErAiProfile(): ErAiProfile` (reads difficulty + knobs).
- Pure scoring helpers (unit-testable, no globals where avoidable):
  `scoreAttackByRealDamage(...)`, `chooseMoveIndex(scores, sharpness, rng)`,
  `betterMatchupScore(self, opp)`, `rankSwitchTargets(...)`,
  `scoreDoublesTargeting(...)`, `shouldTeraNow(...)`.
- Each helper takes data in and returns a number/decision, so the bulk is
  testable without spinning a full battle.

### 3.3 Surgical hooks (minimal edits to core)
Every edit is `if (profile.active) { erPath } else { vanillaPath }`, vanilla
left identical:
- `pokemon.ts:getNextMove` — when active, (a) score attacks via real expected
  damage, (b) select with `chooseMoveIndex(sharpness)` instead of the slide-down.
- `pokemon.ts:getMatchupScore` *or* the switch caller — use `betterMatchupScore`
  when active (don't globally replace `getMatchupScore`; many call sites depend
  on its current shape — branch at the switch decision instead).
- `enemy-command-phase.ts` — when active, use the tuned switch threshold +
  counter-aware logic.
- `faint-phase.ts` / `ab-attrs.ts` forced-switch calls — thread `forSwitch=true`
  (hazard-aware) when active.
- `getNextTargets` / doubles — when active, focus-fire + ally-safety.

### 3.4 Tuning surface
New balance knobs in `er-balance-knobs.ts` (editor-tunable, revalidated, safe
defaults), e.g.:
- `er.ai.sharpness` → `{ elite: 0.85, hell: 1.0 }`
- `er.ai.switchThreshold` → `{ elite: 2.0, hell: 1.5 }` (down from 3/2)
- `er.ai.realDamageScoring` → `{ elite: true, hell: true }`
Invalid/out-of-range values fall back to defaults (existing knob contract), so a
bad edit can never break a build.

### 3.5 Reuse, don't rebuild
Real-damage scoring reuses the existing `getAttackDamage({ simulated: true })`
already called in the KO filter (`pokemon.ts:8119`) — no new damage engine, and
the same ability-reveal fog (`ignoreAbility: !revealed`) so the AI doesn't cheat
with hidden info.

---

## 4. Improvement catalog → implementation slices

Each slice is independently shippable, scenario-tested, and reversible.

### Slice 1 — Move brain + determinism dial (biggest single jump)
- **Real expected damage**: rank attacks by simulated damage as a % of the
  target's current HP (vs the target's actual bulk), reusing the KO-filter sim.
- **Accuracy-weighting**: multiply by accuracy; prefer a *reliable* KO over a
  bigger unreliable hit.
- **KO awareness extended**: keep the OHKO short-circuit; additionally prefer the
  move that secures the fastest guaranteed KO given the speed order.
- **Determinism**: `chooseMoveIndex` honors `sharpness` — Hell never slides down;
  Elite slides rarely.
- **Self-targeted / status / setup** keep vanilla benefit scores in this slice
  (refined in Slice 3) but are correctly compared against real-damage attack
  scores on the same scale.
- *Acceptance:* against a bulky target, the AI picks the higher-damage neutral
  move over a weak "super-effective" one; on Hell it never throws; existing
  vanilla path unchanged on Ace.

### Slice 2 — Switching brain
- **Better matchup metric** (`betterMatchupScore`): best single damaging move (not
  average) + defensive typing + speed/HP, used at the switch decision only.
- **Tuned thresholds** (knob) so Elite/Hell switch to real counters more readily,
  still anti-spam-damped.
- **Hazard-aware forced/faint replacements**: thread `forSwitch=true`.
- **Never switch into a guaranteed KO**; prefer **pivot moves** (U-turn/Volt
  Switch/Teleport) when they both damage and reposition.
- *Acceptance:* AI brings in a hard counter on a clear bad matchup; doesn't send a
  Rocks-weak mon into its own Stealth Rock after a faint.

### Slice 3 — Field & strategy
- **Hazards**: set Rocks/Spikes early when the player has a big healthy bench;
  value removal when hazard-pressured.
- **Setup-sweep gating**: Swords Dance / Quiver Dance etc. only when the active
  mon is safe (can't be OHKO'd, opponent can't meaningfully threaten) *and* setup
  plausibly enables a sweep.
- **Weather/terrain + ability synergy**, **own held-item awareness** (Choice lock,
  Life Orb, pinch berries), **don't lock/charge into a likely switch**.
- **Secondary-effect valuation** in context (faster-mon flinch, status that
  flips a matchup).

### Slice 4 — Tera & doubles
- **Smart Tera timing** (defensive survive vs offensive KO) where `shouldTera`
  fires (`enemy-command-phase.ts:93`).
- **Doubles coordination**: focus-fire to secure KOs, don't Earthquake a
  non-immune ally, redirection/Protect/Fake-Out/Intimidate-lead synergy.

### Later / explicitly out of scope for v1
- Predicting the player's switch (mind-games) — high complexity, do last if at all.
- Battle-item usage — **out** (no item system).

---

## 5. Test plan

- **Vitests** (`test/tests/elite-redux/`): the pure helpers — `chooseMoveIndex`
  (sharpness 1 ⇒ always index 0; <1 ⇒ bounded noise), `scoreAttackByRealDamage`
  ordering vs bulk, `betterMatchupScore` counter selection, hazard-aware switch
  ranking, doubles ally-safety. These don't need a full battle.
- **Dev-suite scenarios** (`src/dev-tools/test-suite/scenarios.ts`), per the
  standing rule — drawn from real winning hell-mode ghost teams where a long
  fight is needed:
  - "Hell AI: real-damage KO pick" — bulky target where the proxy would mis-pick.
  - "Hell AI: never throws" — a clear best move; AI must always take it.
  - "Elite AI: switch to counter" — bad active matchup, counter on the bench.
  - "AI: hazard-aware replacement" — Rocks up, Rocks-weak benched mon not chosen.
  - "Doubles: no self-Earthquake / focus-fire KO."
- **Regression guard:** an Ace-difficulty scenario asserting behavior is
  unchanged (profile inactive).

---

## 6. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Casual modes become miserable | Hard gate: profile inactive for youngster/ace and wild — vanilla path byte-for-byte. |
| Core-combat destabilization (every battle reads this code) | All edits behind `if (profile.active)`; vanilla untouched; ship slice by slice. |
| Performance (real-damage sim per move per turn) | Sim is already run in the KO filter; cap to the candidate pool; memoize per turn. Profile-gated so casual modes pay nothing. |
| AI "cheating" with hidden info | Reuse the existing ability-reveal fog (`ignoreAbility: !revealed`); no peeking at unrevealed player items/abilities. |
| Over-tuning / too brutal | Sharpness + thresholds are editor knobs; revert = flip the profile. |
| Concurrent-agent churn in shared files | Touch core files surgically with explicit-path commits; keep logic in `er-enemy-ai.ts`. |

---

## 7. Sequencing

1. **Foundation:** `er-enemy-ai.ts` + `resolveErAiProfile` + knobs + the
   `getNextMove` hook seam (no behavior change yet; profile resolves, vanilla
   path still taken) + a vitest that the profile is inactive off-hard-modes.
2. **Slice 1** (move brain + determinism) — playtest on staging.
3. **Slice 2** (switching) — playtest.
4. **Slice 3** (field/strategy) — playtest.
5. **Slice 4** (Tera/doubles) — playtest.

Each step: push to `feat`, staging-deploy, scenarios added, maintainer playtests
before the next slice. Production is never touched without explicit approval.

---

## 8. Open questions for review
- Knob defaults: are `elite=0.85 / hell=1.0` sharpness and `elite=2.0 / hell=1.5`
  switch thresholds the right starting feel?
- Should Slice 1 alone go to staging for a feel-check before committing to 2–4?
- Any species/move interactions in ER 2.65 where "optimal" play is degenerate
  (e.g. a stall loop) that we should explicitly cap?
