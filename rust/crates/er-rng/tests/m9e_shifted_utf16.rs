use std::error::Error;

use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::{BattleRngState, RngRuntime};
use er_types::SafeU53;
use er_types::battle_ids::{TurnIndex, WaveIndex};
use serde_json::Value;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded reference value")
}
fn oracle() -> Result<Value, Box<dyn Error>> {
    let bytes = std::fs::read(std::env::var("M9E_RNG_ORACLE_PATH")?)?;
    assert!(bytes.len() < 65_536);
    let value: Value = serde_json::from_slice(&bytes)?;
    assert_eq!(value["commit"], "a9965625f49cf366584f454556b039e06e8adad6");
    assert_eq!(value["schema_version"], 1);
    Ok(value)
}

#[test]
fn shifted_utf16_speed_shuffle_matches_pinned_phaser_and_restores_outer_rng()
-> Result<(), Box<dyn Error>> {
    let oracle = oracle()?;
    let cases = oracle["shuffle"]
        .as_array()
        .ok_or("shuffle cases missing")?;
    assert_eq!(cases.len(), 30);
    for case in cases {
        let mut runtime = RngRuntime::from_run_seed("outer-unchanged");
        let before = runtime.run_state();
        let mut values = (0_u64..8).collect::<Vec<_>>();
        runtime.speed_order_shuffle(
            &mut values,
            case["seed"].as_str().ok_or("seed missing")?,
            TurnIndex::new(safe(case["turn"].as_u64().ok_or("turn missing")?))?,
        )?;
        assert_eq!(serde_json::to_value(values)?, case["values"], "case={case}");
        assert_eq!(runtime.run_state(), before);
        assert!(runtime.seed_offset_context().is_none() && runtime.seed_override().is_none());
        assert_eq!(runtime.audit_entries().len(), 7);
    }
    Ok(())
}

#[test]
fn shifted_utf16_battle_draws_and_initialization_match_pinned_phaser() -> Result<(), Box<dyn Error>>
{
    let oracle = oracle()?;
    let cases = oracle["battle"].as_array().ok_or("battle cases missing")?;
    assert_eq!(cases.len(), 21);
    for case in cases {
        let mut runtime = RngRuntime::from_run_seed("outer-unchanged");
        let before = runtime.run_state();
        runtime.install_battle_state(BattleRngState::new(
            case["seed"].as_str().ok_or("seed missing")?,
            TurnIndex::new(safe(case["turn"].as_u64().ok_or("turn missing")?))?,
        ))?;
        let mut values = Vec::new();
        for _ in 0..8 {
            values.push(
                runtime
                    .battle_rand_seed_int(
                        safe(100),
                        SafeU53::ZERO,
                        RngReason::Accuracy,
                        RngCallsiteId::accuracy(),
                    )?
                    .get(),
            );
        }
        assert_eq!(serde_json::to_value(values)?, case["values"], "case={case}");
        let state = runtime
            .battle_state()
            .and_then(|battle| battle.saved_substream.as_ref())
            .ok_or("cached substream missing")?;
        assert_eq!(serde_json::to_value(state)?, case["state"], "case={case}");
        assert_eq!(runtime.run_state(), before);
        assert!(runtime.seed_override().is_none());
        assert_eq!(runtime.audit_entries().len(), 8);
    }
    let cases = oracle["initialize"]
        .as_array()
        .ok_or("initialization cases missing")?;
    assert_eq!(cases.len(), 18);
    for case in cases {
        let mut runtime = RngRuntime::from_run_seed("outer-unchanged");
        let before = runtime.run_state();
        let battle = runtime.initialize_battle(
            case["seed"].as_str().ok_or("seed missing")?,
            WaveIndex::new(safe(case["wave"].as_u64().ok_or("wave missing")?))?,
        )?;
        assert_eq!(
            battle.battle_seed,
            case["battle_seed"]
                .as_str()
                .ok_or("expected seed missing")?
        );
        assert_eq!(runtime.run_state(), before);
        assert!(runtime.seed_offset_context().is_none() && runtime.seed_override().is_none());
        assert_eq!(runtime.audit_entries().len(), 16);
    }
    Ok(())
}
