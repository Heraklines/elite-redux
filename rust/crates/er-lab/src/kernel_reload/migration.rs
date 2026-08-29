use std::collections::{BTreeMap, VecDeque};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::types::KernelReloadErrorV1;

pub type SnapshotMigrationFnV1 = fn(&[u8]) -> Result<Vec<u8>, String>;

#[derive(Clone, Debug)]
pub struct KernelSnapshotMigrationEdgeV1 {
    pub migration_id: String,
    pub from_schema: u32,
    pub to_schema: u32,
    pub maximum_output_bytes: usize,
    pub migrate: SnapshotMigrationFnV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotMigrationEvidenceV1 {
    pub migration_id: String,
    pub from_schema: u32,
    pub to_schema: u32,
    pub input_sha256: String,
    pub output_sha256: String,
    pub output_bytes: usize,
}

#[derive(Clone, Debug, Default)]
pub struct SnapshotMigrationRegistryV1 {
    edges: Vec<KernelSnapshotMigrationEdgeV1>,
}

impl SnapshotMigrationRegistryV1 {
    pub fn register(
        &mut self,
        edge: KernelSnapshotMigrationEdgeV1,
    ) -> Result<(), KernelReloadErrorV1> {
        if edge.migration_id.is_empty()
            || edge.from_schema == 0
            || edge.to_schema <= edge.from_schema
            || edge.maximum_output_bytes == 0
            || self.edges.iter().any(|existing| {
                existing.migration_id == edge.migration_id
                    || (existing.from_schema == edge.from_schema
                        && existing.to_schema == edge.to_schema)
            })
        {
            return Err(KernelReloadErrorV1::Migration(
                "invalid or duplicate migration edge".to_owned(),
            ));
        }
        self.edges.push(edge);
        self.edges.sort_by(|left, right| {
            (left.from_schema, left.to_schema, &left.migration_id).cmp(&(
                right.from_schema,
                right.to_schema,
                &right.migration_id,
            ))
        });
        Ok(())
    }

    pub fn migrate(
        &self,
        input: &[u8],
        from_schema: u32,
        to_schema: u32,
    ) -> Result<(Vec<u8>, Vec<SnapshotMigrationEvidenceV1>), KernelReloadErrorV1> {
        if from_schema == to_schema {
            return Ok((input.to_vec(), Vec::new()));
        }
        let path = self.unique_path(from_schema, to_schema)?;
        let mut bytes = input.to_vec();
        let mut evidence = Vec::with_capacity(path.len());
        for edge_index in path {
            let edge = &self.edges[edge_index];
            let input_sha256 = sha256(&bytes);
            let first = (edge.migrate)(&bytes).map_err(KernelReloadErrorV1::Migration)?;
            let second = (edge.migrate)(&bytes).map_err(KernelReloadErrorV1::Migration)?;
            if first != second || first.is_empty() || first.len() > edge.maximum_output_bytes {
                return Err(KernelReloadErrorV1::Migration(
                    "migration is nondeterministic, empty, or oversized".to_owned(),
                ));
            }
            evidence.push(SnapshotMigrationEvidenceV1 {
                migration_id: edge.migration_id.clone(),
                from_schema: edge.from_schema,
                to_schema: edge.to_schema,
                input_sha256,
                output_sha256: sha256(&first),
                output_bytes: first.len(),
            });
            bytes = first;
        }
        Ok((bytes, evidence))
    }

    fn unique_path(
        &self,
        from_schema: u32,
        to_schema: u32,
    ) -> Result<Vec<usize>, KernelReloadErrorV1> {
        let mut queue = VecDeque::from([(from_schema, Vec::<usize>::new())]);
        let mut paths = Vec::new();
        let mut visits = BTreeMap::<u32, usize>::new();
        while let Some((schema, path)) = queue.pop_front() {
            if path.len() > 8 {
                continue;
            }
            if schema == to_schema {
                paths.push(path);
                if paths.len() > 1 {
                    return Err(KernelReloadErrorV1::Migration(
                        "ambiguous migration route".to_owned(),
                    ));
                }
                continue;
            }
            let count = visits.entry(schema).or_default();
            *count += 1;
            if *count > 8 {
                continue;
            }
            for (index, edge) in self.edges.iter().enumerate() {
                if edge.from_schema == schema
                    && edge.to_schema <= to_schema
                    && !path.contains(&index)
                {
                    let mut next = path.clone();
                    next.push(index);
                    queue.push_back((edge.to_schema, next));
                }
            }
        }
        paths.into_iter().next().ok_or_else(|| {
            KernelReloadErrorV1::Migration("no compatible migration route".to_owned())
        })
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
