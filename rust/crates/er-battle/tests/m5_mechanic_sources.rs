use er_battle::mechanics::{
    ActiveMechanicSource, MechanicSourceError, MechanicSourceRank, order_active_sources,
};
use er_types::SafeU53;
use er_types::battle_ids::{BattleSide, PokemonId};
use er_types::mechanics::{MechanicScope, MechanicSourceId, MechanicSourceKind, SourceOrdinal};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture id")
}

fn source(kind: MechanicSourceKind, id: u64, position: u8, ordinal: u32) -> ActiveMechanicSource {
    ActiveMechanicSource {
        source: MechanicSourceId::numeric(kind, safe(id)),
        scope: MechanicScope::Pokemon {
            pokemon: PokemonId::new(safe(id + 100)),
        },
        side: Some(BattleSide::Player),
        field_position: Some(position),
        source_ordinal: SourceOrdinal::new(ordinal),
    }
}

#[test]
fn active_then_passive_then_item_order_is_stable() {
    let ordered = order_active_sources(vec![
        source(MechanicSourceKind::HeldItem, 7, 0, 0),
        source(MechanicSourceKind::PassiveAbility, 25, 0, 1),
        source(MechanicSourceKind::ActiveAbility, 22, 0, 0),
    ])
    .expect("ordered sources");
    let ranks: Vec<_> = ordered
        .iter()
        .map(|entry| MechanicSourceRank::from(entry.source.kind))
        .collect();
    assert_eq!(
        ranks,
        vec![
            MechanicSourceRank::ActiveAbility,
            MechanicSourceRank::PassiveAbility,
            MechanicSourceRank::HeldItem,
        ]
    );
}

#[test]
fn duplicate_active_source_fails_closed() {
    let same = source(MechanicSourceKind::ActiveAbility, 22, 0, 0);
    assert_eq!(
        order_active_sources(vec![same.clone(), same]),
        Err(MechanicSourceError::DuplicateActiveSource)
    );
}
