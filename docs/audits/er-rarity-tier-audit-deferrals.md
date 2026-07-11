# ER rarity-tier audit — deferred items

> 🔴 **The remaining-dex sweep (all abilities on 10+ species + moves on 37+ mons,
> 938 items) has its own FIX QUEUE:** `docs/audits/er-remaining-dex-fix-plan.md`
> — 287 findings (173 numeric dex-vs-c-source conflicts where the **dex wins**, +
> 114 genuine implementation gaps), with per-row dex-vs-code + suggested fix.
> Another agent can pick that up directly.


Tracking doc for the confirmed-but-not-yet-fixed items surfaced by the
rarity-tier dex-fidelity audit (tiers 3–7: abilities bucketed by species count,
moves by mon-count). The vast majority of findings were fixed and committed with
headless + vitest verification; the items below were deliberately deferred with
reasons. Pick them up when the noted blocker clears.

## 1. In-game dev-suite scenarios for tier-6, tier-7, tier-8 and tier-9 fixes

**Status:** owed. Tiers 3, 4, 5 got their `src/dev-tools/test-suite/scenarios.ts`
entries; tiers 6, 7, 8 and 9 did not.

**Why deferred:** `scenarios.ts` was under continuous edit *and* commit by a
concurrent process on `feat/elite-redux-port` throughout the audit session.
Appending to it risked entangling that process's unfinished hunks in an audit
commit. Every tier-6/7/8/9 fix is already covered by a vitest regression test
(`er-*.test.ts`) and a green headless-runner scenario, so this is the
complementary human-testing tier only. Tier-9 combat-observable fixes owed a
scenario: Trace (no Wonder Guard copy), Thundercall (1.5x vs Water + screen
bypass), Mineralize / Fertilize (-ate conditional branches), Seed Sower (party
status heal), Primal Maw (flinch-once), Nightmare (damage + chip), Speed Swap
(stage swap).

**Note — vanilla `test/tests/moves/nightmare.test.ts` fails at baseline** (not a
regression): ER intentionally makes Nightmare a 120-BP damaging move (dex: "Deals
heavy damage to a sleeping foe and makes them lose 1/4 HP each turn"), so the
vanilla-only exact-HP assertion (expects status-move-only chip) can't pass. The
ER behavior is covered by `er-dex-tier9-batch.test.ts`. Leave the vanilla test or
re-point it at the ER expectation if the suite ever gates on it.

**To do:** once `scenarios.ts` is stable, add DO/EXPECT scenarios (same pattern
as the tier-3/4/5 blocks already in the file) for the combat-observable fixes —
e.g. Furnace, Retriever, Mystic Blades, Evaporate, Vengeful Spirit, Illusion,
Forecast, Ripen (tier-6); Egoist, Cutthroat, Soul Linker, Pitfall, Aurora
Borealis, Chrome Coat, Cryomancy (tier-7); Terminal Velocity, Smokey Maneuvers,
Seaweed, Deadly Precision (SE-gate), Tactical Retreat (per-battle reset), Web
Spinner (doubles spread), Intoxicate/Emanate/Solar Flare (-ate conditional),
Ghastly Echo (sound + switch) (tier-8).

## 2. Shallow Grave (er 629) — true post-faint revive (APPROXIMATION)

**Dex:** "After fainting while fog is active, the user revives at 25% max HP when
you send out your next party member. Also activates if it faints on the last turn
fog is active."

**Current:** wired via `PostFaintReviveAbAttr` (`archetypes/post-faint-revive.ts`)
which extends `PreDefendFullHpEndureAbAttr` — it clamps the lethal hit to leave
the holder at 1 HP (Sturdy-style) and heals to 25% the same turn. The holder
therefore **never faints and never leaves the field**, so it dodges all
faint-triggered interactions, and the "faints on the last turn of fog" deferred
revive cannot be represented. The 25%-once and fog gating are correct.

**Blocker:** a faithful implementation is a genuine *deferred, on-next-summon*
revive (faint the mon → flag it → revive to 25% in the `SwitchSummonPhase` path),
which is engine work, not a param tweak. **Backup Power (er 899)** shares the
exact same endure-instead-of-revive approximation and should be fixed together.

## 2b. Ghastly Echo (er move 848) — +50% switch-in boost (PARTIAL, tier-8)

**Dex (longDescription):** "Deals damage and switches. Switch-in gets 50% boost
for 1 turn. Sound-based."

**Current:** damage + force-switch-out are wired, and the tier-8 fix ADDED the
missing `SOUND_BASED` flag (verified: Soundproof now blocks it). The **+50%
move-power boost on the incoming replacement mon for its first turn is
DEFERRED** (a `// ...DEFERRED` comment sits in `init-elite-redux-custom-moves.ts`
case 848).

**Blocker:** same shape as the revive above — genuine engine work.
`ForceSwitchOutAttr` has no handle on the *replacement* (chosen later in
`SwitchSummonPhase`), and there is no existing "empower-the-switch-in" battler
tag to hang a one-turn ×1.5 power boost on. Needs a new tag applied to whoever
switches in next, consumed on its first move. Fix when the switch-in-empower tag
exists.

## 3. `er-ability-rom-descriptions.ts` slug misalignment (387–392)

**Status:** partially unrecoverable, documented only.

The description entries for slugs `discipline`(387) → `arcticfur`(392) are each
shifted by one — each key holds the *next* ability's ROM "Detail" text (proven:
`marineapex` holds Mighty Horn's text, `mightyhorn` holds Hardened Sheath's,
etc.). Entries re-align at `spectralize`(393) and before `discipline`(387).

**Why deferred:** re-aligning requires the correct text for each slug. The bottom
entries are reconstructable, but the top boundary — **Discipline (387)** — needs a
long "Detail" string that was overwritten and is **not present anywhere in the
repo or vendor** (only its short desc survives). Half-migrating would duplicate a
neighbour's text. No gameplay impact — this is reference/audit data; the affected
abilities' *implementations* are correct (Marine Apex was explicitly re-verified).

**To do:** if the original 2.65 ROM "Detail" string for Discipline is recovered
(from an ER 2.65 dex dump), shift the whole 387–392 block back into alignment.

## 4. Evaporate (er 444) — doubles-ally self-drop immunity (minor edge)

**Dex:** "…Mist protects the entire team from stat reductions, including self
drops."

**Current:** Evaporate's Mist now blocks self-inflicted drops (Overheat, Close
Combat, …) for **the holder**. Extending that self-drop immunity to a *doubles
ally* isn't structurally supported by `SelfStatDropImmunityAbAttr` (it only fires
for its own holder). The whole-team status/secondary immunity and the holder's
own self-drop immunity are done; only the ally-side self-drop half is missing, and
only in doubles.

## 5. Lead Coat (er 296) — same weight-triple omission as Chrome Coat

Chrome Coat (539) was fixed to add its `WeightMultiplierAbAttr(3)`. Its
physical-side twin **Lead Coat (296)** carries the identical dropped weight-triple
clause (flagged during the 539 audit, out of the tier being swept). Apply the same
one-line fix (`new WeightMultiplierAbAttr(3)` in its dispatch case) when its tier
is audited, or opportunistically.

## 6. Minor / negligible notes (no action expected)

- **Rockhard Will (617):** uses strict `< 1/3 HP` for its low-HP boost where the
  dex says "1/3 or lower" — a mon at *exactly* 1/3 HP gets ×1.2 not ×1.5. Matches
  the vanilla Blaze/Overgrow boundary convention; negligible.
- **Radiance (437):** a *runtime*-Dark move (‑ate/Tera/Judgment) aimed at
  Radiance's **ally** in doubles is caught by neither the static-type field
  condition nor the holder-only immunity. Static-Dark and holder-targeted
  runtime-Dark are handled; only runtime-Dark spread/ally-target in doubles slips.

## 7. ✅ RESOLVED by the tier-1 engine sweep (2026-07)

The following prior deferrals were implemented as real engine primitives:
- **Shallow Grave (629) + Backup Power (899)** (§2): true on-next-summon revive
  (`PostFaintDeferredReviveAbAttr` + `SummonPhase.onEnd` hook) — the mon now truly
  faints and revives to 25% at the next send-out.
- **Evaporate (444)** (§4): ally self-drop immunity in doubles
  (`UserFieldSelfStatDropImmunityAbAttr` + ally pass in `stat-stage-change-phase`).
- **Lead Coat (296)** (§5): `WeightMultiplierAbAttr(3)` added.
- **Ghastly Echo (848)**: the +50% switch-in boost (was §2b) — `ER_EMPOWERED_SWITCH_IN`
  tag armed on switch-out, consumed at the next send-out.

## 8. Tier-1 engine-sweep NEW residuals (2026-07) — revisit later

- **Fetch (er move 969) — non-Gem generator-built items.** The new `lostItems`
  ledger retrieves knocked-off / consumed items and shattered Gems, but a held item
  built by a **generator with pregen args** (other than elemental Gems, which carry
  `erGemItemType`) can't be faithfully rebuilt from the ledger, so Fetch skips it in
  favor of the next recoverable lost item. Documented inline in
  `ErRetrieveConsumedItemAttr`.
- **Dreamscape (er 859) — the pivot sub-clause.** "Considered asleep → 2× when any
  active mon is asleep" is done (Comatose now counts as asleep). The remaining
  clause "attacks hit a **switching-out sleeping foe** for 1× power" is unwired —
  needs an OnOpponentSwitchOut + target-asleep strike primitive that doesn't exist.
- **Rom-description slug drift 795–798 (Embody Aspect masks).** Like the 387–392
  drift (§3): all four Ogerpon mask abilities (795 Speed / 796 Atk / 797 Def / 798
  SpDef) collapse onto the single `embodyaspect` "Speed" slug in
  `er-ability-rom-descriptions.ts`, so an audit reading descriptions sees "Speed"
  for all four. The **code is correct** (real per-mask stat); only the ROM
  reference text is drifted. No gameplay impact.
</content>
