use er_ai::m9e_standard_attack_score::standard_attack_score;

#[test]
fn knockout_bonus_uses_raw_damage_and_weights_accuracy() {
    assert_eq!(standard_attack_score(60, 100, 50, 50).to_bits(), 522.5_f64.to_bits());
    assert_eq!(standard_attack_score(49, 100, 50, 100).to_bits(), 36.75_f64.to_bits());
    assert_eq!(standard_attack_score(50, 100, 50, 50).to_bits(), 518.75_f64.to_bits());
}

#[test]
fn zero_damage_and_always_hit_preserve_source_boundaries() {
    for hp in [0, 1, u32::MAX] {
        for accuracy in [i16::MIN, 0, 1, 50, 100, i16::MAX] {
            assert_eq!(standard_attack_score(0, 0, hp, accuracy).to_bits(), 0.0_f64.to_bits());
        }
    }
    for accuracy in [i16::MIN, -1, 0, 100, 101, i16::MAX] {
        assert_eq!(standard_attack_score(1, 0, 1, accuracy).to_bits(), 1075.0_f64.to_bits());
    }
}

#[test]
fn damage_not_base_power_controls_non_knockout_ranking() {
    assert_eq!(standard_attack_score(46, 400, 400, 100).to_bits(), 8.625_f64.to_bits());
    assert_eq!(standard_attack_score(13, 400, 400, 100).to_bits(), 2.4375_f64.to_bits());
    assert!(standard_attack_score(46, 400, 400, 100) > standard_attack_score(13, 400, 400, 100));
}

#[test]
fn all_remote_pinned_javascript_cases_match_binary64_bits() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::var("M9E_STANDARD_SCORE_ORACLE")?;
    let raw = std::fs::read_to_string(path)?;
    assert!(raw.len() < 262_144);
    let mut count = 0;
    for line in raw.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        assert_eq!(fields.len(), 5);
        let damage = fields[0].parse::<u32>()?;
        let max_hp = fields[1].parse::<u32>()?;
        let hp = fields[2].parse::<u32>()?;
        let accuracy = fields[3].parse::<i16>()?;
        let expected = u64::from_str_radix(fields[4], 16)?;
        assert_eq!(standard_attack_score(damage, max_hp, hp, accuracy).to_bits(), expected, "{line}");
        count += 1;
    }
    assert_eq!(count, 1280);
    Ok(())
}
