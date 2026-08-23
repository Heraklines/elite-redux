use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use er_canonical::{canonical_bytes, fixture_digest};
use er_content::abilities::AbilityDefinition;
use er_content::moves::MoveDefinition;
use er_content::pack::TypeChart;
use er_content::pack::m5_pack::{
    BATTLE_CONTENT_PACK_SCHEMA_VERSION_V2, BattleContentPackV2, BespokeEntryV1,
    ClassificationEntryV1, ClassificationKind, ClassificationManifestV1, HeldItemDefinitionV2,
};
use er_content::species::SpeciesDefinition;
use er_mechanics::MechanicsProgramV1;
use er_types::SafeU53;
use er_types::mechanics::{MechanicSourceId, MechanicSourceKind};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SOURCE_CATALOG_VERSION: u32 = 1;
const CLASSIFICATION_VERSION: u32 = 1;
const BESPOKE_VERSION: u32 = 1;

#[derive(Debug, Error)]
enum CompilerError {
    #[error(
        "usage: er-content-compiler --source-catalog <json> --content <json> --classification <json> --bespoke <json> --output <json> --report <json>"
    )]
    Usage,
    #[error("duplicate CLI argument {0}")]
    DuplicateArgument(String),
    #[error("missing CLI argument {0}")]
    MissingArgument(&'static str),
    #[error("failed to read {path}: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("source catalog version must be 1")]
    SourceCatalogVersion,
    #[error("classification manifest version must be 1")]
    ClassificationVersion,
    #[error("bespoke manifest version must be 1")]
    BespokeVersion,
    #[error("source catalog oracle SHA is invalid")]
    OracleSha,
    #[error("source catalog numeric identity is unresolved")]
    UnresolvedCatalogId,
    #[error("source catalog contains duplicate identity")]
    DuplicateCatalogIdentity,
    #[error("classification manifest contains duplicate identity")]
    DuplicateClassification,
    #[error("classification closure differs from source catalog: missing={missing}, extra={extra}")]
    ClassificationClosure { missing: usize, extra: usize },
    #[error("compiled pack is invalid: {0}")]
    InvalidPack(#[from] er_content::pack::m5_pack::BattlePackLoadError),
    #[error("canonical JSON failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
    #[error("failed to create output directory {path}: {source}")]
    CreateDirectory {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to write {path}: {source}")]
    Write {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

#[derive(Debug)]
struct Args {
    source_catalog: PathBuf,
    content: PathBuf,
    classification: PathBuf,
    bespoke: PathBuf,
    output: PathBuf,
    report: PathBuf,
}

impl Args {
    fn parse() -> Result<Self, CompilerError> {
        let mut values = BTreeMap::new();
        let mut arguments = env::args().skip(1);
        while let Some(key) = arguments.next() {
            if !key.starts_with("--") {
                return Err(CompilerError::Usage);
            }
            let value = arguments.next().ok_or(CompilerError::Usage)?;
            if values.insert(key.clone(), value).is_some() {
                return Err(CompilerError::DuplicateArgument(key));
            }
        }
        if values.len() != 6 {
            return Err(CompilerError::Usage);
        }
        Ok(Self {
            source_catalog: take_path(&mut values, "--source-catalog")?,
            content: take_path(&mut values, "--content")?,
            classification: take_path(&mut values, "--classification")?,
            bespoke: take_path(&mut values, "--bespoke")?,
            output: take_path(&mut values, "--output")?,
            report: take_path(&mut values, "--report")?,
        })
    }
}

fn take_path(
    values: &mut BTreeMap<String, String>,
    key: &'static str,
) -> Result<PathBuf, CompilerError> {
    values
        .remove(key)
        .map(PathBuf::from)
        .ok_or(CompilerError::MissingArgument(key))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CatalogNumericEntry {
    numeric_id: Option<SafeU53>,
    #[serde(default)]
    enum_name: String,
    #[serde(default)]
    member: String,
    #[serde(default)]
    initializer: Option<String>,
    #[serde(default)]
    ordinal: usize,
    #[serde(default)]
    source: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CatalogRegistryEntry {
    key: String,
    #[serde(default)]
    initializer: String,
    #[serde(default)]
    source: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SourceCatalog {
    schema_version: u32,
    oracle_sha: String,
    moves: Vec<CatalogNumericEntry>,
    abilities: Vec<CatalogNumericEntry>,
    modifier_types: Vec<CatalogRegistryEntry>,
    statuses: Vec<CatalogNumericEntry>,
    weather: Vec<CatalogNumericEntry>,
    terrain: Vec<CatalogNumericEntry>,
    battler_tags: Vec<CatalogNumericEntry>,
    arena_tags: Vec<CatalogNumericEntry>,
    positional_tags: Vec<CatalogNumericEntry>,
    #[serde(flatten)]
    remaining: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClassificationInput {
    schema_version: u32,
    entries: Vec<ClassificationEntryV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BespokeInput {
    schema_version: u32,
    entries: Vec<BespokeEntryV1>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ContentInput {
    species: Vec<Option<SpeciesDefinition>>,
    moves: Vec<Option<MoveDefinition>>,
    abilities: Vec<Option<AbilityDefinition>>,
    held_items: Vec<HeldItemDefinitionV2>,
    programs: Vec<Option<MechanicsProgramV1>>,
    type_chart: TypeChart,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct CompilerReport {
    schema_version: u32,
    oracle_sha: String,
    source_catalog_digest: String,
    content_hash: String,
    source_count: usize,
    compiled_count: usize,
    bespoke_count: usize,
    unsupported_count: usize,
    unclassified_count: usize,
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, CompilerError> {
    fs::read(path).map_err(|source| CompilerError::Read {
        path: path.to_owned(),
        source,
    })
}

fn read_json<T>(path: &Path) -> Result<T, CompilerError>
where
    T: for<'de> Deserialize<'de>,
{
    let bytes = read_bytes(path)?;
    serde_json::from_slice(&bytes).map_err(|source| CompilerError::Json {
        path: path.to_owned(),
        source,
    })
}

fn numeric_source(
    kind: MechanicSourceKind,
    entry: &CatalogNumericEntry,
) -> Result<MechanicSourceId, CompilerError> {
    let id = entry.numeric_id.ok_or(CompilerError::UnresolvedCatalogId)?;
    Ok(MechanicSourceId::numeric(kind, id))
}

fn insert_source(
    sources: &mut BTreeSet<MechanicSourceId>,
    source: MechanicSourceId,
) -> Result<(), CompilerError> {
    if sources.insert(source) {
        Ok(())
    } else {
        Err(CompilerError::DuplicateCatalogIdentity)
    }
}

fn catalog_sources(catalog: &SourceCatalog) -> Result<BTreeSet<MechanicSourceId>, CompilerError> {
    let mut sources = BTreeSet::new();
    for entry in &catalog.moves {
        insert_source(
            &mut sources,
            numeric_source(MechanicSourceKind::Move, entry)?,
        )?;
    }
    for entry in &catalog.abilities {
        let id = entry.numeric_id.ok_or(CompilerError::UnresolvedCatalogId)?;
        insert_source(
            &mut sources,
            MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, id),
        )?;
        insert_source(
            &mut sources,
            MechanicSourceId::numeric(MechanicSourceKind::PassiveAbility, id),
        )?;
    }
    for entry in &catalog.modifier_types {
        insert_source(
            &mut sources,
            MechanicSourceId::registry(MechanicSourceKind::HeldItem, entry.key.clone()),
        )?;
    }
    for (kind, entries) in [
        (MechanicSourceKind::MajorStatus, &catalog.statuses),
        (MechanicSourceKind::Weather, &catalog.weather),
        (MechanicSourceKind::Terrain, &catalog.terrain),
        (MechanicSourceKind::BattlerTag, &catalog.battler_tags),
        (MechanicSourceKind::ArenaTag, &catalog.arena_tags),
        (MechanicSourceKind::PositionalTag, &catalog.positional_tags),
    ] {
        for entry in entries {
            insert_source(&mut sources, numeric_source(kind, entry)?)?;
        }
    }
    Ok(sources)
}

fn validate_classification_closure(
    expected: &BTreeSet<MechanicSourceId>,
    entries: &[ClassificationEntryV1],
) -> Result<(), CompilerError> {
    let mut actual = BTreeSet::new();
    for entry in entries {
        if !actual.insert(entry.subject.clone()) {
            return Err(CompilerError::DuplicateClassification);
        }
    }
    let missing = expected.difference(&actual).count();
    let extra = actual.difference(expected).count();
    if missing == 0 && extra == 0 {
        Ok(())
    } else {
        Err(CompilerError::ClassificationClosure { missing, extra })
    }
}

fn write_canonical(path: &Path, value: &impl Serialize) -> Result<(), CompilerError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| CompilerError::CreateDirectory {
            path: parent.to_owned(),
            source,
        })?;
    }
    let mut bytes = canonical_bytes(value)?;
    bytes.push(b'\n');
    fs::write(path, bytes).map_err(|source| CompilerError::Write {
        path: path.to_owned(),
        source,
    })
}

fn compile(args: &Args) -> Result<(), CompilerError> {
    let catalog_bytes = read_bytes(&args.source_catalog)?;
    let catalog: SourceCatalog =
        serde_json::from_slice(&catalog_bytes).map_err(|source| CompilerError::Json {
            path: args.source_catalog.clone(),
            source,
        })?;
    if catalog.schema_version != SOURCE_CATALOG_VERSION {
        return Err(CompilerError::SourceCatalogVersion);
    }
    if catalog.oracle_sha.len() != 40
        || !catalog
            .oracle_sha
            .bytes()
            .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
    {
        return Err(CompilerError::OracleSha);
    }
    let source_catalog_value: serde_json::Value =
        serde_json::from_slice(&catalog_bytes).map_err(|source| CompilerError::Json {
            path: args.source_catalog.clone(),
            source,
        })?;
    let source_catalog_digest = format!("sha256:{}", fixture_digest(&source_catalog_value)?);
    let expected_sources = catalog_sources(&catalog)?;

    let mut classifications: ClassificationInput = read_json(&args.classification)?;
    if classifications.schema_version != CLASSIFICATION_VERSION {
        return Err(CompilerError::ClassificationVersion);
    }
    classifications
        .entries
        .sort_by(|left, right| left.subject.cmp(&right.subject));
    validate_classification_closure(&expected_sources, &classifications.entries)?;

    let bespoke: BespokeInput = read_json(&args.bespoke)?;
    if bespoke.schema_version != BESPOKE_VERSION {
        return Err(CompilerError::BespokeVersion);
    }
    let content: ContentInput = read_json(&args.content)?;

    let mut pack = BattleContentPackV2 {
        schema_version: BATTLE_CONTENT_PACK_SCHEMA_VERSION_V2,
        oracle_sha: catalog.oracle_sha.clone(),
        source_catalog_digest: source_catalog_digest.clone(),
        content_hash: String::new(),
        species: content.species,
        moves: content.moves,
        abilities: content.abilities,
        held_items: content.held_items,
        programs: content.programs,
        classifications: ClassificationManifestV1(classifications.entries),
        bespoke: bespoke.entries,
        type_chart: content.type_chart,
    };
    pack.content_hash = pack.compute_content_hash()?;
    pack.validate()?;

    let compiled_count = pack
        .classifications
        .0
        .iter()
        .filter(|entry| entry.kind == ClassificationKind::Compiled)
        .count();
    let bespoke_count = pack
        .classifications
        .0
        .iter()
        .filter(|entry| entry.kind == ClassificationKind::Bespoke)
        .count();
    let unsupported_count = pack
        .classifications
        .0
        .iter()
        .filter(|entry| entry.kind == ClassificationKind::Unsupported)
        .count();
    let report = CompilerReport {
        schema_version: 1,
        oracle_sha: catalog.oracle_sha,
        source_catalog_digest,
        content_hash: pack.content_hash.clone(),
        source_count: expected_sources.len(),
        compiled_count,
        bespoke_count,
        unsupported_count,
        unclassified_count: 0,
    };
    write_canonical(&args.output, &pack)?;
    write_canonical(&args.report, &report)?;
    Ok(())
}

fn main() -> Result<(), CompilerError> {
    let args = Args::parse()?;
    compile(&args)
}
