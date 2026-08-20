use er_state::pokemon_v2::{Iv, PermanentStatBonuses};

#[test]
fn progression_value_rejects_unknown_fields() {
    let decoded = serde_json::from_str::<PermanentStatBonuses>(
        r#"{"hp":0,"attack":0,"defense":0,"special_attack":0,"special_defense":0,"speed":0,"extra":1}"#,
    );
    assert!(decoded.is_err());
}

#[test]
fn progression_value_does_not_reconstruct_missing_fields() {
    let decoded = serde_json::from_str::<PermanentStatBonuses>(r#"{"hp":0}"#);
    assert!(decoded.is_err());
}

#[test]
fn iv_domain_is_fail_closed() {
    assert!(Iv::new(31).is_ok());
    assert!(Iv::new(32).is_err());
}
