//! Complete typed M7 economy surface: registry, inventory, currency, rewards, markets, modifiers, and co-op picks.
use std::collections::{BTreeMap, BTreeSet};

use er_state::m7_state::PokemonStateV5;
use er_types::battle_ids::PokemonId;
use er_types::{InventoryItemId, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const ECONOMY_REGISTRY_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EconomyItemKindV1 {
    Consumable,
    Held,
    Persistent,
    Relic,
    Currency,
    Key,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EconomyTargetV1 {
    None,
    PartyPokemon,
    Party,
    Run,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum EconomyEffectV1 {
    Heal { points: u32 },
    Money { amount: u64 },
    AddPersistent { registry_key: String, stacks: u32 },
    AddRelic { registry_key: String },
    NoImmediateEffect,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyRegistryEntryV1 {
    pub item: InventoryItemId,
    pub registry_key: String,
    pub kind: EconomyItemKindV1,
    pub target: EconomyTargetV1,
    pub maximum_stack: u32,
    pub tier: u8,
    pub effect: EconomyEffectV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum EconomyErrorV1 {
    #[error("economy registry entry is malformed or duplicated")]
    Registry,
    #[error("inventory quantity is insufficient or would overflow")]
    Inventory,
    #[error("currency balance is insufficient or would overflow")]
    Currency,
    #[error("reward or market identity is stale")]
    Offer,
    #[error("target is missing, fainted, or incompatible")]
    Target,
    #[error("co-op interaction identity conflicts")]
    InteractionConflict,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyContentRegistryV1 {
    pub schema_version: u32,
    pub entries: Vec<EconomyRegistryEntryV1>,
}

impl EconomyContentRegistryV1 {
    pub fn new(mut entries: Vec<EconomyRegistryEntryV1>) -> Result<Self, EconomyErrorV1> {
        entries.sort_by_key(|entry| entry.item);
        if entries.is_empty()
            || entries.windows(2).any(|pair| pair[0].item >= pair[1].item)
            || entries.iter().any(|entry| {
                entry.registry_key.is_empty()
                    || entry.maximum_stack == 0
                    || entry.tier == 0
                    || matches!(entry.kind, EconomyItemKindV1::Relic)
                        && !matches!(entry.effect, EconomyEffectV1::AddRelic { .. })
            })
        {
            return Err(EconomyErrorV1::Registry);
        }
        Ok(Self {
            schema_version: ECONOMY_REGISTRY_SCHEMA_VERSION_V1,
            entries,
        })
    }

    pub fn entry(&self, item: InventoryItemId) -> Option<&EconomyRegistryEntryV1> {
        self.entries
            .binary_search_by_key(&item, |entry| entry.item)
            .ok()
            .and_then(|index| self.entries.get(index))
    }

    pub fn entry_by_key(&self, key: &str) -> Option<&EconomyRegistryEntryV1> {
        self.entries.iter().find(|entry| entry.registry_key == key)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InventoryLedgerV1 {
    pub quantities: BTreeMap<InventoryItemId, u32>,
}

impl InventoryLedgerV1 {
    pub fn add(
        &mut self,
        registry: &EconomyContentRegistryV1,
        item: InventoryItemId,
        count: u32,
    ) -> Result<u32, EconomyErrorV1> {
        let definition = registry.entry(item).ok_or(EconomyErrorV1::Registry)?;
        let current = self.quantities.get(&item).copied().unwrap_or(0);
        let next = current
            .checked_add(count)
            .ok_or(EconomyErrorV1::Inventory)?;
        if next > definition.maximum_stack {
            return Err(EconomyErrorV1::Inventory);
        }
        self.quantities.insert(item, next);
        Ok(next)
    }

    pub fn remove(&mut self, item: InventoryItemId, count: u32) -> Result<u32, EconomyErrorV1> {
        let current = self.quantities.get(&item).copied().unwrap_or(0);
        let next = current
            .checked_sub(count)
            .ok_or(EconomyErrorV1::Inventory)?;
        if next == 0 {
            self.quantities.remove(&item);
        } else {
            self.quantities.insert(item, next);
        }
        Ok(next)
    }

    pub fn transfer(
        &mut self,
        destination: &mut Self,
        registry: &EconomyContentRegistryV1,
        item: InventoryItemId,
        count: u32,
    ) -> Result<(), EconomyErrorV1> {
        let before_source = self.clone();
        let before_destination = destination.clone();
        if self
            .remove(item, count)
            .and_then(|_| destination.add(registry, item, count).map(|_| ()))
            .is_err()
        {
            *self = before_source;
            *destination = before_destination;
            return Err(EconomyErrorV1::Inventory);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrencyLedgerV1 {
    pub balances: BTreeMap<String, u64>,
}

impl CurrencyLedgerV1 {
    pub fn credit(&mut self, currency: String, amount: u64) -> Result<u64, EconomyErrorV1> {
        if currency.is_empty() {
            return Err(EconomyErrorV1::Currency);
        }
        let current = self.balances.get(&currency).copied().unwrap_or(0);
        let next = current
            .checked_add(amount)
            .ok_or(EconomyErrorV1::Currency)?;
        if next > SafeU53::MAX.get() {
            return Err(EconomyErrorV1::Currency);
        }
        self.balances.insert(currency, next);
        Ok(next)
    }

    pub fn debit(&mut self, currency: &str, amount: u64) -> Result<u64, EconomyErrorV1> {
        let current = self.balances.get(currency).copied().unwrap_or(0);
        let next = current
            .checked_sub(amount)
            .ok_or(EconomyErrorV1::Currency)?;
        self.balances.insert(currency.to_owned(), next);
        Ok(next)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RewardCandidateV1 {
    pub item: InventoryItemId,
    pub weight: u32,
    pub price: u64,
    pub tier: u8,
}

pub fn generate_reward_offers_v1(
    candidates: &[RewardCandidateV1],
    count: usize,
    draws: &[u64],
    locked_tiers: &BTreeSet<u8>,
) -> Result<Vec<RewardCandidateV1>, EconomyErrorV1> {
    if count > draws.len() || candidates.iter().any(|candidate| candidate.weight == 0) {
        return Err(EconomyErrorV1::Offer);
    }
    let mut pool = candidates.to_vec();
    let mut offers = Vec::new();
    for draw in draws.iter().take(count) {
        let eligible = pool
            .iter()
            .enumerate()
            .filter(|(_, candidate)| {
                locked_tiers.is_empty() || locked_tiers.contains(&candidate.tier)
            })
            .collect::<Vec<_>>();
        let total = eligible.iter().try_fold(0_u64, |total, (_, candidate)| {
            total
                .checked_add(u64::from(candidate.weight))
                .ok_or(EconomyErrorV1::Offer)
        })?;
        if total == 0 {
            return Err(EconomyErrorV1::Offer);
        }
        let mut cursor = draw % total;
        let selected = eligible
            .into_iter()
            .find_map(|(index, candidate)| {
                let weight = u64::from(candidate.weight);
                if cursor < weight {
                    Some(index)
                } else {
                    cursor -= weight;
                    None
                }
            })
            .ok_or(EconomyErrorV1::Offer)?;
        offers.push(pool.remove(selected));
    }
    Ok(offers)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketStockV1 {
    pub stock_id: String,
    pub item: InventoryItemId,
    pub unit_price: u64,
    pub remaining: u32,
}

pub fn buy_market_stock_v1(
    currency: &mut CurrencyLedgerV1,
    currency_key: &str,
    stock: &mut MarketStockV1,
    offered_price: u64,
) -> Result<(), EconomyErrorV1> {
    if stock.stock_id.is_empty() || stock.remaining == 0 || offered_price != stock.unit_price {
        return Err(EconomyErrorV1::Offer);
    }
    currency.debit(currency_key, stock.unit_price)?;
    stock.remaining = stock
        .remaining
        .checked_sub(1)
        .ok_or(EconomyErrorV1::Offer)?;
    Ok(())
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RerollLockStateV1 {
    pub reroll_count: u32,
    pub locked_tiers: BTreeSet<u8>,
}

impl RerollLockStateV1 {
    pub fn reroll_cost(&self, base_cost: u64) -> Result<u64, EconomyErrorV1> {
        base_cost
            .checked_mul(u64::from(self.reroll_count) + 1)
            .ok_or(EconomyErrorV1::Currency)
    }

    pub fn commit_reroll(&mut self) -> Result<u32, EconomyErrorV1> {
        self.reroll_count = self
            .reroll_count
            .checked_add(1)
            .ok_or(EconomyErrorV1::Currency)?;
        Ok(self.reroll_count)
    }

    pub fn toggle_lock(&mut self, tier: u8, lock: bool) -> bool {
        if lock {
            self.locked_tiers.insert(tier)
        } else {
            self.locked_tiers.remove(&tier)
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersistentModifierV1 {
    pub instance_id: String,
    pub registry_key: String,
    pub stacks: u32,
    pub target: Option<PokemonId>,
    pub mechanics: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersistentModifierStoreV1 {
    pub modifiers: Vec<PersistentModifierV1>,
}

impl PersistentModifierStoreV1 {
    pub fn add(
        &mut self,
        modifier: PersistentModifierV1,
        maximum_stack: u32,
    ) -> Result<(), EconomyErrorV1> {
        if modifier.instance_id.is_empty()
            || modifier.registry_key.is_empty()
            || modifier.stacks == 0
        {
            return Err(EconomyErrorV1::Registry);
        }
        if let Some(existing) = self.modifiers.iter_mut().find(|existing| {
            existing.registry_key == modifier.registry_key && existing.target == modifier.target
        }) {
            let next = existing
                .stacks
                .checked_add(modifier.stacks)
                .ok_or(EconomyErrorV1::Inventory)?;
            if next > maximum_stack {
                return Err(EconomyErrorV1::Inventory);
            }
            existing.stacks = next;
        } else {
            if modifier.stacks > maximum_stack {
                return Err(EconomyErrorV1::Inventory);
            }
            self.modifiers.push(modifier);
            self.modifiers
                .sort_by(|left, right| left.instance_id.cmp(&right.instance_id));
        }
        Ok(())
    }

    pub fn remove(&mut self, instance_id: &str, stacks: u32) -> Result<(), EconomyErrorV1> {
        let index = self
            .modifiers
            .iter()
            .position(|modifier| modifier.instance_id == instance_id)
            .ok_or(EconomyErrorV1::Inventory)?;
        let next = self.modifiers[index]
            .stacks
            .checked_sub(stacks)
            .ok_or(EconomyErrorV1::Inventory)?;
        if next == 0 {
            self.modifiers.remove(index);
        } else {
            self.modifiers[index].stacks = next;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelicStateV1 {
    pub owned: BTreeSet<String>,
    pub counters: BTreeMap<String, u64>,
}

impl RelicStateV1 {
    pub fn acquire(&mut self, key: String) -> bool {
        !key.is_empty() && self.owned.insert(key)
    }

    pub fn increment(&mut self, key: &str, amount: u64) -> Result<u64, EconomyErrorV1> {
        if !self.owned.contains(key) {
            return Err(EconomyErrorV1::Registry);
        }
        let current = self.counters.get(key).copied().unwrap_or(0);
        let next = current
            .checked_add(amount)
            .ok_or(EconomyErrorV1::Inventory)?;
        self.counters.insert(key.to_owned(), next);
        Ok(next)
    }
}

pub fn apply_party_target_effect_v1(
    party: &mut [PokemonStateV5],
    target: PokemonId,
    effect: &EconomyEffectV1,
) -> Result<(), EconomyErrorV1> {
    let pokemon = party
        .iter_mut()
        .find(|pokemon| pokemon.id == target)
        .ok_or(EconomyErrorV1::Target)?;
    match effect {
        EconomyEffectV1::Heal { points } if pokemon.hp > 0 => {
            pokemon.hp = pokemon
                .hp
                .checked_add(*points)
                .unwrap_or(pokemon.max_hp)
                .min(pokemon.max_hp);
            Ok(())
        }
        EconomyEffectV1::NoImmediateEffect => Ok(()),
        _ => Err(EconomyErrorV1::Target),
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyInteractionV1 {
    pub operation_id: String,
    pub fingerprint: String,
    pub choice: i64,
    pub data: Vec<i64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EconomyInteractionAdmissionV1 {
    Admitted,
    Duplicate,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EconomyInteractionLedgerV1 {
    admitted: BTreeMap<String, EconomyInteractionV1>,
}

impl EconomyInteractionLedgerV1 {
    pub fn admit(
        &mut self,
        interaction: EconomyInteractionV1,
    ) -> Result<EconomyInteractionAdmissionV1, EconomyErrorV1> {
        if interaction.operation_id.is_empty() || interaction.fingerprint.is_empty() {
            return Err(EconomyErrorV1::InteractionConflict);
        }
        if let Some(existing) = self.admitted.get(&interaction.operation_id) {
            return if existing == &interaction {
                Ok(EconomyInteractionAdmissionV1::Duplicate)
            } else {
                Err(EconomyErrorV1::InteractionConflict)
            };
        }
        self.admitted
            .insert(interaction.operation_id.clone(), interaction);
        Ok(EconomyInteractionAdmissionV1::Admitted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(value: u64) -> InventoryItemId {
        InventoryItemId::new(SafeU53::new(value).expect("item"))
    }

    fn registry() -> EconomyContentRegistryV1 {
        EconomyContentRegistryV1::new(vec![EconomyRegistryEntryV1 {
            item: item(1),
            registry_key: "potion".to_owned(),
            kind: EconomyItemKindV1::Consumable,
            target: EconomyTargetV1::PartyPokemon,
            maximum_stack: 10,
            tier: 1,
            effect: EconomyEffectV1::Heal { points: 20 },
        }])
        .expect("registry")
    }

    #[test]
    fn content_registry_and_inventory_transitions_fail_closed() {
        let registry = registry();
        assert_eq!(
            registry.entry_by_key("potion").map(|entry| entry.item),
            Some(item(1))
        );
        let mut source = InventoryLedgerV1::default();
        let mut target = InventoryLedgerV1::default();
        assert_eq!(source.add(&registry, item(1), 3), Ok(3));
        assert!(source.transfer(&mut target, &registry, item(1), 2).is_ok());
        assert_eq!(source.quantities.get(&item(1)), Some(&1));
        assert_eq!(target.quantities.get(&item(1)), Some(&2));
        let before = source.clone();
        assert_eq!(source.remove(item(1), 2), Err(EconomyErrorV1::Inventory));
        assert_eq!(source, before);
    }

    #[test]
    fn currency_rewards_and_market_stock_are_checked() {
        let candidates = vec![
            RewardCandidateV1 {
                item: item(1),
                weight: 1,
                price: 10,
                tier: 1,
            },
            RewardCandidateV1 {
                item: item(2),
                weight: 3,
                price: 20,
                tier: 2,
            },
        ];
        assert_eq!(
            generate_reward_offers_v1(&candidates, 1, &[1], &BTreeSet::new()).expect("offers")[0]
                .item,
            item(2)
        );
        let mut currency = CurrencyLedgerV1::default();
        currency.credit("money".to_owned(), 100).expect("credit");
        let mut stock = MarketStockV1 {
            stock_id: "market/1".to_owned(),
            item: item(1),
            unit_price: 25,
            remaining: 2,
        };
        buy_market_stock_v1(&mut currency, "money", &mut stock, 25).expect("buy");
        assert_eq!(currency.balances.get("money"), Some(&75));
        assert_eq!(stock.remaining, 1);
    }

    #[test]
    fn rerolls_modifiers_and_relics_preserve_identity() {
        let mut reroll = RerollLockStateV1::default();
        assert_eq!(reroll.reroll_cost(10), Ok(10));
        assert_eq!(reroll.commit_reroll(), Ok(1));
        assert!(reroll.toggle_lock(3, true));
        let mut modifiers = PersistentModifierStoreV1::default();
        modifiers
            .add(
                PersistentModifierV1 {
                    instance_id: "m1".to_owned(),
                    registry_key: "luck".to_owned(),
                    stacks: 1,
                    target: None,
                    mechanics: BTreeMap::new(),
                },
                2,
            )
            .expect("modifier");
        assert_eq!(modifiers.modifiers.len(), 1);
        let mut relics = RelicStateV1::default();
        assert!(relics.acquire("seal".to_owned()));
        assert!(!relics.acquire("seal".to_owned()));
        assert_eq!(relics.increment("seal", 2), Ok(2));
    }

    #[test]
    fn coop_economy_interactions_are_idempotent_and_conflicts_fail() {
        let mut ledger = EconomyInteractionLedgerV1::default();
        let interaction = EconomyInteractionV1 {
            operation_id: "reward/1".to_owned(),
            fingerprint: "hash-a".to_owned(),
            choice: 0,
            data: vec![1],
        };
        assert_eq!(
            ledger.admit(interaction.clone()),
            Ok(EconomyInteractionAdmissionV1::Admitted)
        );
        assert_eq!(
            ledger.admit(interaction),
            Ok(EconomyInteractionAdmissionV1::Duplicate)
        );
        assert_eq!(
            ledger.admit(EconomyInteractionV1 {
                operation_id: "reward/1".to_owned(),
                fingerprint: "hash-b".to_owned(),
                choice: 1,
                data: Vec::new(),
            }),
            Err(EconomyErrorV1::InteractionConflict)
        );
        assert_eq!(
            apply_party_target_effect_v1(
                &mut [],
                PokemonId::ZERO,
                &EconomyEffectV1::Heal { points: 1 },
            ),
            Err(EconomyErrorV1::Target)
        );
    }
}
