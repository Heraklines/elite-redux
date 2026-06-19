# The Bargain — unimplemented / parked deals

Tracking the Giratina "Seven Sins" bargain deals that are **not** live, so they
aren't forgotten. The bargain itself (the dedicated `ErBargainUiHandler` screen +
`TheBargainPhase`) ships in the Abyss every-10-waves slot, staging-gated.

See: `src/data/elite-redux/er-bargain-sins.ts`, `src/phases/the-bargain-phase.ts`,
`src/ui/handlers/er-bargain-ui-handler.ts`,
`locales/en/mystery-encounters/the-bargain-dialogue.json`.

## Live deals (the six offered)

Greed, Gluttony, Pride, Wrath, Envy, Sloth — all implemented in
`TheBargainPhase.applySin()`. Three of the seven sins are picked at random per
visit (`pickBargainSins`).

## Not live

### 1. Lust — implemented but DISABLED
- **Cost:** curse a random stat across the *whole* team.
- **Reward:** a black-shiny reroll on one chosen Pokémon.
- **Status:** fully coded (the `"lust"` case in `applySin`) but listed in
  `DISABLED_BARGAIN_SINS` in `er-bargain-sins.ts`, so it is never offered.
- **To re-enable:** remove `"lust"` from `DISABLED_BARGAIN_SINS`. It was parked
  because a free black-shiny reroll is a very strong / swingy reward that needs a
  balance decision before it goes live.

### 2. Seventh party slot + seal slot (parked — task #545)
- **Idea:** a deal that grants a temporary 7th party member and/or a "seal" slot.
- **Why parked:** needs cross-system save design. Party serialization assumes a
  max of 6 members everywhere; a 7th slot touches save/load, switch logic, the
  party UI, and run-restore. The reward mechanic is the complicated part, not the
  bargain UI.

### 3. Borrow-and-return two Pokémon (parked — task #546)
- **Idea:** borrow 2 strong Pokémon for a stretch of waves, then return them.
- **Why parked:** needs out-of-party serialization — storing the borrowed mons
  (and the obligation to return them) outside the 6-slot party, surviving save/
  load. Again, the reward bookkeeping is the blocker, not the deal screen.

## If/when we pick these back up
- Lust: cheapest — just a balance call, then drop it from `DISABLED_BARGAIN_SINS`
  and confirm the reward reads/plays well.
- 7th slot / borrow: both depend on a general "extra/out-of-party Pokémon"
  save substrate. Build that once and both deals (plus future ones) become cheap.
