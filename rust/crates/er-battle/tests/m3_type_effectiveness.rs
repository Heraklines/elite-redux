use std::error::Error;
use std::fmt::{Display, Formatter};

use er_battle::type_effectiveness::{
    EffectivenessClass, EffectivenessMultiplier, TypeEffectivenessError, compose_type_multipliers,
    resolve_type_effectiveness,
};
use er_content::pack::{TypeChartError, selected_type_chart};
use er_state::pokemon::TypingValidationError;
use er_types::battle_model::{PokemonType, PokemonTyping, SingleTypeMultiplier};
use serde_json::Value;

const TYPE_NATIVE_IMMUNITY_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/type-native-immunity.json");
const TYPE_RESISTANCE_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/type-resistance.json");
const TYPE_WEAKNESS_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/type-weakness.json");

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

#[derive(Debug)]
enum FixtureError {
    MissingField,
    WrongShape,
    UnsupportedType,
}

impl Display for FixtureError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::MissingField => "missing fixture field",
            Self::WrongShape => "fixture field has the wrong shape",
            Self::UnsupportedType => "fixture contains an unsupported type",
        };
        write!(formatter, "invalid type-effectiveness fixture: {message}")
    }
}

impl Error for FixtureError {}

fn fixture_field<'a>(value: &'a Value, name: &'static str) -> Result<&'a Value, FixtureError> {
    value.get(name).ok_or(FixtureError::MissingField)
}

fn fixture_type(value: &str) -> Result<PokemonType, FixtureError> {
    match value {
        "NORMAL" => Ok(PokemonType::Normal),
        "FIRE" => Ok(PokemonType::Fire),
        "WATER" => Ok(PokemonType::Water),
        "ELECTRIC" => Ok(PokemonType::Electric),
        "GRASS" => Ok(PokemonType::Grass),
        "ICE" => Ok(PokemonType::Ice),
        "FIGHTING" => Ok(PokemonType::Fighting),
        "POISON" => Ok(PokemonType::Poison),
        "GROUND" => Ok(PokemonType::Ground),
        "FLYING" => Ok(PokemonType::Flying),
        "PSYCHIC" => Ok(PokemonType::Psychic),
        "BUG" => Ok(PokemonType::Bug),
        "ROCK" => Ok(PokemonType::Rock),
        "GHOST" => Ok(PokemonType::Ghost),
        "DRAGON" => Ok(PokemonType::Dragon),
        "DARK" => Ok(PokemonType::Dark),
        "STEEL" => Ok(PokemonType::Steel),
        "FAIRY" => Ok(PokemonType::Fairy),
        "STELLAR" => Ok(PokemonType::Stellar),
        _ => Err(FixtureError::UnsupportedType),
    }
}

fn fixture_defender_typing(document: &str) -> TestResult<PokemonTyping> {
    let root: Value = serde_json::from_str(document)?;
    let initial = fixture_field(&root, "initial_state")?;
    let canonical = fixture_field(initial, "canonical")?;
    let battle = fixture_field(canonical, "battle")?;
    let enemy_party = fixture_field(battle, "enemy_party")?
        .as_array()
        .ok_or(FixtureError::WrongShape)?;
    let enemy = enemy_party.first().ok_or(FixtureError::WrongShape)?;
    let types = fixture_field(enemy, "types")?;
    let primary = fixture_field(types, "primary")?
        .as_str()
        .ok_or(FixtureError::WrongShape)?;
    let secondary = match fixture_field(types, "secondary")? {
        Value::Null => None,
        value => Some(
            value
                .as_str()
                .ok_or(FixtureError::WrongShape)
                .and_then(fixture_type)?,
        ),
    };
    Ok(PokemonTyping {
        primary: fixture_type(primary)?,
        secondary,
    })
}

fn typing(primary: PokemonType, secondary: Option<PokemonType>) -> PokemonTyping {
    PokemonTyping { primary, secondary }
}

#[test]
fn selected_fixtures_match_native_immunity_resistance_and_weakness() -> TestResult {
    let chart = selected_type_chart();
    assert_eq!(
        chart.multiplier(PokemonType::Electric, PokemonType::Ground),
        SingleTypeMultiplier::Zero
    );
    assert_eq!(
        chart.multiplier(PokemonType::Electric, PokemonType::Grass),
        SingleTypeMultiplier::Half
    );
    assert_eq!(
        chart.multiplier(PokemonType::Electric, PokemonType::Water),
        SingleTypeMultiplier::Two
    );

    let immune_typing = fixture_defender_typing(TYPE_NATIVE_IMMUNITY_FIXTURE)?;
    let immune = resolve_type_effectiveness(&chart, PokemonType::Electric, &immune_typing)?;
    assert_eq!(immune.multiplier, EffectivenessMultiplier::Zero);
    assert_eq!(immune.class(), EffectivenessClass::Immune);
    assert!(immune.is_immune());
    assert!(!immune.allows_follow_up_resolution());

    let resistant_typing = fixture_defender_typing(TYPE_RESISTANCE_FIXTURE)?;
    let resistant = resolve_type_effectiveness(&chart, PokemonType::Electric, &resistant_typing)?;
    assert_eq!(resistant.multiplier, EffectivenessMultiplier::Half);
    assert_eq!(resistant.class(), EffectivenessClass::Resistant);
    assert!(resistant.is_resistant());
    assert!(!resistant.is_super_effective());

    let weak_typing = fixture_defender_typing(TYPE_WEAKNESS_FIXTURE)?;
    let weak = resolve_type_effectiveness(&chart, PokemonType::Electric, &weak_typing)?;
    assert_eq!(weak.multiplier, EffectivenessMultiplier::Two);
    assert_eq!(weak.class(), EffectivenessClass::SuperEffective);
    assert!(weak.is_weak());
    assert!(weak.is_super_effective());
    assert!(weak.allows_follow_up_resolution());
    Ok(())
}

#[test]
fn closed_multiplier_values_cover_neutral_zero_quarter_half_two_and_four() -> TestResult {
    let chart = selected_type_chart();

    let neutral = resolve_type_effectiveness(
        &chart,
        PokemonType::Normal,
        &typing(PokemonType::Normal, None),
    )?;
    assert_eq!(neutral.multiplier, EffectivenessMultiplier::One);
    assert!(neutral.is_neutral());
    assert_eq!(neutral.multiplier.ratio(), (1, 1));

    let immune = resolve_type_effectiveness(
        &chart,
        PokemonType::Electric,
        &typing(PokemonType::Ground, None),
    )?;
    assert_eq!(immune.multiplier.ratio(), (0, 1));

    let quarter = resolve_type_effectiveness(
        &chart,
        PokemonType::Grass,
        &typing(PokemonType::Grass, Some(PokemonType::Poison)),
    )?;
    assert_eq!(quarter.multiplier, EffectivenessMultiplier::Quarter);
    assert!(quarter.is_resistant());
    assert_eq!(quarter.multiplier.exponent(), Some(-2));

    let half =
        resolve_type_effectiveness(&chart, PokemonType::Fire, &typing(PokemonType::Water, None))?;
    assert_eq!(half.multiplier, EffectivenessMultiplier::Half);
    assert!(half.is_resistant());

    let two = resolve_type_effectiveness(
        &chart,
        PokemonType::Electric,
        &typing(PokemonType::Water, None),
    )?;
    assert_eq!(two.multiplier, EffectivenessMultiplier::Two);
    assert!(two.is_weak());
    assert!(two.is_super_effective());

    let four = resolve_type_effectiveness(
        &chart,
        PokemonType::Grass,
        &typing(PokemonType::Water, Some(PokemonType::Ground)),
    )?;
    assert_eq!(four.multiplier, EffectivenessMultiplier::Four);
    assert_eq!(four.multiplier.ratio(), (4, 1));
    assert!(four.is_weak());
    assert!(four.is_super_effective());
    Ok(())
}

#[test]
fn dual_type_composition_is_order_independent_without_intermediate_rounding() -> TestResult {
    let chart = selected_type_chart();
    let first = resolve_type_effectiveness(
        &chart,
        PokemonType::Grass,
        &typing(PokemonType::Water, Some(PokemonType::Ground)),
    )?;
    let second = resolve_type_effectiveness(
        &chart,
        PokemonType::Grass,
        &typing(PokemonType::Ground, Some(PokemonType::Water)),
    )?;
    assert_eq!(first, second);
    assert_eq!(first.multiplier, EffectivenessMultiplier::Four);

    let quarter = resolve_type_effectiveness(
        &chart,
        PokemonType::Grass,
        &typing(PokemonType::Grass, Some(PokemonType::Poison)),
    )?;
    let reversed_quarter = resolve_type_effectiveness(
        &chart,
        PokemonType::Grass,
        &typing(PokemonType::Poison, Some(PokemonType::Grass)),
    )?;
    assert_eq!(quarter, reversed_quarter);
    assert_eq!(
        reversed_quarter.multiplier,
        EffectivenessMultiplier::Quarter
    );

    assert_eq!(
        compose_type_multipliers(SingleTypeMultiplier::Half, Some(SingleTypeMultiplier::Half)),
        Some(EffectivenessMultiplier::Quarter)
    );
    assert_eq!(
        compose_type_multipliers(SingleTypeMultiplier::Two, Some(SingleTypeMultiplier::Two)),
        Some(EffectivenessMultiplier::Four)
    );
    assert_eq!(
        compose_type_multipliers(SingleTypeMultiplier::Zero, Some(SingleTypeMultiplier::Two)),
        Some(EffectivenessMultiplier::Zero)
    );
    Ok(())
}

#[test]
fn malformed_or_unsupported_selected_inputs_fail_closed() -> TestResult {
    let chart = selected_type_chart();

    let duplicate = typing(PokemonType::Grass, Some(PokemonType::Grass));
    assert!(matches!(
        resolve_type_effectiveness(&chart, PokemonType::Electric, &duplicate),
        Err(TypeEffectivenessError::InvalidDefenderTyping(
            TypingValidationError::DuplicateType {
                pokemon_type: PokemonType::Grass
            }
        ))
    ));

    let stellar = typing(PokemonType::Stellar, None);
    assert!(matches!(
        resolve_type_effectiveness(&chart, PokemonType::Electric, &stellar),
        Err(TypeEffectivenessError::InvalidDefenderTyping(
            TypingValidationError::StellarUnsupported { .. }
        ))
    ));

    let stellar_secondary = typing(PokemonType::Normal, Some(PokemonType::Stellar));
    assert!(matches!(
        resolve_type_effectiveness(&chart, PokemonType::Electric, &stellar_secondary),
        Err(TypeEffectivenessError::InvalidDefenderTyping(
            TypingValidationError::StellarUnsupported { .. }
        ))
    ));

    assert!(matches!(
        resolve_type_effectiveness(
            &chart,
            PokemonType::Stellar,
            &typing(PokemonType::Normal, None)
        ),
        Err(TypeEffectivenessError::UnsupportedAttackType {
            attack: PokemonType::Stellar
        })
    ));
    assert!(matches!(
        resolve_type_effectiveness(
            &chart,
            PokemonType::Water,
            &typing(PokemonType::Normal, None)
        ),
        Err(TypeEffectivenessError::UnsupportedAttackType {
            attack: PokemonType::Water
        })
    ));

    let mut malformed_chart = selected_type_chart();
    let entry = malformed_chart
        .entries
        .first_mut()
        .ok_or(FixtureError::WrongShape)?;
    entry.multiplier = SingleTypeMultiplier::One;
    assert!(matches!(
        resolve_type_effectiveness(
            &malformed_chart,
            PokemonType::Electric,
            &typing(PokemonType::Ground, None)
        ),
        Err(TypeEffectivenessError::InvalidChart(
            TypeChartError::NeutralEntry { index: 0 }
        ))
    ));
    Ok(())
}
