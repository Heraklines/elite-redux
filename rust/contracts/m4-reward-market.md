# M4 reward and market contract

## Scope decision

Two distinct surfaces remain distinct:

- Regular reward/shop implements free reward selection, skip, paid purchase, party targeting, reroll, and rarity locks.
- Biome market implements authority-generated stock, quantity, sold state, party targeting, and leave. It has no reroll or lock action because the pinned TypeScript oracle has none.

Combining the surfaces or adding reroll/lock to biome market is a contract violation.

## Content identity

The TypeScript oracle identifies modifiers by registry strings. `ModifierId` is an M4 contract-owned strongly typed numeric ID only when `RunContentPack` contains an explicit bijection to the pinned registry key. Canonical material carries both ID and run-content hash; diagnostics include the registry key. Unknown or mismatched mappings fail closed.

Only entries marked `Supported` in `m4-capability-manifest.json` may be generated. Pool generation does not silently skip an unsupported resolved callback result because that would change later RNG and slot identity.

## Regular reward/shop

Authority owns generation and emits ordered offers, stable offer IDs, exact tiers, lock state, prices, targets, and RNG audit in material. Replicas adopt these values without drawing.

Reroll:

- uses the frozen base cost and tier schedule from the oracle;
- validates affordability before any draw;
- preserves only the explicitly locked tiers;
- increments the reroll counter exactly once on success;
- regenerates the complete unlocked offer set in oracle draw order;
- commits payment and regenerated offers atomically.

Lock toggles do not draw RNG. Their owner, exact tier, option ID, and action ordinal are material. A lock action unsupported by the loaded Lock Capsule capability is rejected without mutation.

Purchase validates current surface, action ordinal, offer identity, exact price, affordability, target requirement, stack capacity, and modifier capability before mutation. Modifier application, money deduction, inventory mutation, and surface continuation/closure occur inside Rust in one atomic transaction. No external adapter returns an `accepted` result.

Immediate selected effects and selected persistent stacks are closed Rust mechanics. Callback-driven items, evolution/form items, fusion, TMs, remembered moves, berries/mints with unresolved generation, and any modifier requiring deferred Phaser phases are unsupported.

## Biome market

Authority produces at most 16 ordered stock entries using the captured oracle generator inputs and RNG sequence. Each stock entry has:

- stable stock ID and registry-key mapping;
- exact unit price;
- initial and remaining quantity;
- sold state;
- target requirement;
- generation audit.

A buy action validates the exact stock ID, remaining quantity, canonical price, affordability, target, and supported effect. The common Rust modifier applier runs before the staged money/stock mutation is made visible. Success decrements quantity, derives sold state, deducts money, advances the action ordinal, and keeps or closes the surface exactly as specified. Failure mutates nothing and draws nothing.

Leave closes the surface without drawing and installs the next frozen run control. There is no biome-market reroll or lock option.

## Money and prices

All selected price and reward formulas preserve the TypeScript `Number` operation and rounding order documented by the oracle. M4 selected fixtures exclude unresolved fractional co-op regular-shop prices and dynamic streak, challenge, merchant, notoriety, and balance callbacks. Encountering one is an unsupported-content failure, never truncation by convenience.

`Money` is a validated safe-integer newtype. Payment cannot underflow. Reward cannot overflow. The exact before and after balance is mutation evidence.

## Identity and duplicate behavior

Each action uses the central run operation grammar and a per-surface monotonically increasing action ordinal. Duplicate identical actions are idempotent. Reusing an ordinal for a different offer, target, price, lock state, or reroll request is a protocol violation.

## Required edge proofs

Hosted tests cover no-money purchase, sold stock, invalid target, stack cap, duplicate proposal, conflicting duplicate, stale ordinal, lock toggle without RNG, locked reroll, repeated successful shop buy, skip/leave, and authority/replica identical adoption.