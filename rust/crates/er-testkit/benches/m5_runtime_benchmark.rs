use std::time::{Duration, Instant};

use er_battle::mechanics::{ActiveMechanicSource, collect_mechanic_sources};
use er_types::SafeU53;
use er_types::battle_ids::PokemonId;
use er_types::mechanics::{MechanicScope, MechanicSourceId, MechanicSourceKind, SourceOrdinal};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe benchmark id")
}

#[test]
fn generated_pack_load_100_times_stays_below_ceiling() {
    let started = Instant::now();
    let mut checksum = 0usize;
    for _ in 0..100 {
        let pack = er_content::pack::selected_m5_bootstrap_pack().expect("generated pack");
        checksum ^= pack.classifications.0.len();
        checksum ^= pack.programs.len();
    }
    std::hint::black_box(checksum);
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "100 generated pack loads exceeded 15 seconds"
    );
}

#[test]
fn deterministic_source_collection_100000_times_stays_below_ceiling() {
    let pack = er_content::pack::selected_m5_bootstrap_pack().expect("generated pack");
    let active = vec![ActiveMechanicSource {
        source: MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, safe(22)),
        scope: MechanicScope::Pokemon {
            pokemon: PokemonId::new(safe(100)),
        },
        side: None,
        field_position: None,
        source_ordinal: SourceOrdinal::ZERO,
    }];
    let started = Instant::now();
    let mut checksum = 0usize;
    for _ in 0..100_000 {
        let ordered = collect_mechanic_sources(&pack, active.clone()).expect("ordered sources");
        checksum ^= ordered.len();
    }
    std::hint::black_box(checksum);
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "100000 source collections exceeded 5 seconds"
    );
}
