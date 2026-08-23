#!/usr/bin/env python3
"""Curate audited contract-v4 episodes without exposing production records."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, BinaryIO, Iterable


SPLIT_SEED = "er-human-telemetry-split-v1"
CURATION_SEED = "er-contract-v4-curation-v1"
SPLITS = ("train", "validation", "test")
TOKEN_GROUPS = ("actor", "targets", "destination", "field", "action")
MAX_UPLOAD_SHARD_UNCOMPRESSED_BYTES = 128 * 1024 * 1024


@dataclass(frozen=True)
class CurationConfig:
    max_policy_per_source: int = 512
    max_policy_per_lineage: int = 1024
    max_state_action_repeats: int = 2
    wild_keep_rate: float = 0.25


@dataclass
class EpisodeMeta:
    episode_id: str
    source_id: str
    split: str
    lineage_hash: str
    roster_hash: str | None
    roster_members: frozenset[str]
    hard_quarantined: bool
    completed_outcome_eligible: bool
    run_outcome: str | None
    decision_identity: tuple[str, str, str] | None
    policy_candidates: list["PolicyMeta"] = field(default_factory=list)


@dataclass(frozen=True)
class PolicyMeta:
    episode_id: str
    decision_id: str
    source_id: str
    split: str
    lineage_hash: str
    identity: tuple[str, str, str]
    state_hash: str
    action_hash: str
    rank: str
    priority: int
    strata: tuple[str, ...]
    battle_outcome: str | None
    run_outcome: str | None


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def source_split(source_id: str) -> str:
    digest = hashlib.sha256(f"{SPLIT_SEED}:{source_id}".encode()).digest()
    bucket = int.from_bytes(digest[:4], "big") / 2**32
    return "train" if bucket < 0.7 else "validation" if bucket < 0.85 else "test"


def deterministic_fraction(value: str) -> float:
    digest = hashlib.sha256(f"{CURATION_SEED}:{value}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def record_identity(record: dict[str, Any]) -> tuple[str, str, str]:
    return tuple(str(record.get(name) or "") for name in ("buildSha", "dexHash", "dictionaryHash"))


def candidate_model_input(candidate_id: str, decision: dict[str, Any]) -> dict[str, Any]:
    features = {row["candidateId"]: row for row in decision["candidateFeatures"]}[candidate_id]
    groups = {row["candidateId"]: row for row in decision["candidateTokenGroups"]}[candidate_id]["groups"]
    return {
        "values": features["values"],
        "presence": features.get("presence"),
        "tokens": {name: sorted(groups[name]) for name in TOKEN_GROUPS},
    }


def model_input_identity(decision: dict[str, Any]) -> tuple[str, str, bool]:
    candidate_inputs = {
        candidate["id"]: candidate_model_input(candidate["id"], decision)
        for candidate in decision["candidates"]
    }
    canonical = [json.dumps(value, sort_keys=True, separators=(",", ":")) for value in candidate_inputs.values()]
    state_hash = sha256("\n".join(sorted(canonical)))
    chosen = json.dumps(
        candidate_inputs[decision["chosenCandidateId"]],
        sort_keys=True,
        separators=(",", ":"),
    )
    return state_hash, sha256(chosen), len(set(canonical)) != len(canonical)


def mon_signature(mon: dict[str, Any], *, core: bool) -> str:
    moves = sorted(int(move.get("moveId", -1)) for move in mon.get("moves", []))
    abilities = sorted(
        (
            int(ability.get("abilityId", -1)),
            str(ability.get("source", "")),
            int(ability.get("slot", -1) if ability.get("slot") is not None else -1),
        )
        for ability in mon.get("abilities", [])
    )
    base = {
        "species": int(mon.get("species", -1)),
        "form": int(mon.get("form", -1)),
        "originalSpecies": int(mon.get("originalSpecies", -1)),
        "originalForm": int(mon.get("originalForm", -1)),
        "moves": moves,
        "abilities": abilities,
    }
    if not core:
        base["items"] = sorted(
            (
                str(item.get("itemId", "")),
                int(item.get("stackCount", 0)),
                int(item.get("virtualStackCount", 0)),
            )
            for item in (mon.get("heldItems") or [])
        )
        base["nativeTypes"] = sorted(int(value) for value in mon.get("nativeTypes", []))
    return json.dumps(base, sort_keys=True, separators=(",", ":"))


def roster_fingerprints(decisions: list[dict[str, Any]]) -> tuple[str | None, frozenset[str]]:
    if not decisions:
        return None, frozenset()
    first = min(
        decisions,
        key=lambda row: (
            int(row.get("observation", {}).get("wave", 0)),
            int(row.get("observation", {}).get("turn", 0)),
            str(row.get("decisionId", "")),
        ),
    )
    party = first.get("observation", {}).get("selfParty", [])
    exact_members = sorted(mon_signature(mon, core=False) for mon in party)
    core_members = frozenset(mon_signature(mon, core=True) for mon in party)
    return (sha256("\n".join(exact_members)) if exact_members else None), core_members


def battle_id(joint_action_id: Any) -> str | None:
    if not isinstance(joint_action_id, str) or ":" not in joint_action_id:
        return None
    return joint_action_id.rsplit(":", 1)[0]


def decision_strata(decision: dict[str, Any], difficulty: str) -> tuple[int, tuple[str, ...]]:
    observation = decision.get("observation", {})
    candidates = decision.get("candidates", [])
    chosen = next((row for row in candidates if row.get("id") == decision.get("chosenCandidateId")), {})
    battle_type = int(observation.get("battleType", -1))
    format_value = int(observation.get("format", 1))
    wave = int(observation.get("wave", 0))
    boss = any(int(mon.get("boss", {}).get("segments", 0)) > 1 for mon in observation.get("opponentActive", []))
    transformed = bool(chosen.get("tera")) or any(
        mon.get("transformation", {}).get("formChanged")
        or mon.get("transformation", {}).get("terastallized")
        for mon in observation.get("selfParty", [])
    )
    targeting = format_value > 1 and chosen.get("kind") == "move"
    high_branching = len(candidates) >= 8
    strata = {
        "wild" if battle_type == 0 else "trainer",
        f"difficulty-{difficulty}",
        f"format-{format_value}",
        "switch" if chosen.get("kind") == "switch" else f"action-{chosen.get('kind', 'unknown')}",
    }
    if wave >= 100:
        strata.add("late")
    if boss:
        strata.add("boss")
    if transformed:
        strata.add("transformation")
    if targeting:
        strata.add("targeting")
    if high_branching:
        strata.add("high-branching")
    if observation.get("mechanics") or observation.get("fieldEffects") or observation.get("positionalEffects"):
        strata.add("dynamic-mechanic")
    rare = boss or transformed or targeting or high_branching or chosen.get("kind") == "switch" or wave >= 100
    priority = 0 if rare else 2 if battle_type == 0 else 1
    return priority, tuple(sorted(strata))


def iter_episodes(path: Path) -> Iterable[dict[str, Any]]:
    opener = gzip.open if path.suffix == ".gz" else Path.open
    open_args = {"mode": "rt", "encoding": "utf-8"} if path.suffix == ".gz" else {"mode": "r", "encoding": "utf-8"}
    with opener(path, **open_args) as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            episode = json.loads(line)
            if not isinstance(episode, dict):
                raise ValueError(f"episode line {line_number} is not an object")
            yield episode


def analyze_episode(episode: dict[str, Any], exclusions: Counter[str]) -> EpisodeMeta:
    episode_id = str(episode.get("episodeId") or "")
    source_id = str(episode.get("sourcePartitionId") or "")
    if not episode_id or not source_id:
        raise ValueError("private episode export omitted stable identities")
    split = source_split(source_id)
    if episode.get("split") != split:
        raise ValueError("private episode export disagrees with source-account split")
    envelope = episode.get("envelope", {})
    seed = str(envelope.get("seed") or "")
    if not seed:
        raise ValueError("private episode export omitted run seed")
    decisions = episode.get("decisions", [])
    roster_hash, roster_members = roster_fingerprints(decisions)
    transition_by_decision: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for transition in episode.get("transitions", []):
        for decision_id in transition.get("decisionIds", []):
            transition_by_decision[str(decision_id)].append(transition)
    terminal_outcomes = {
        str(terminal.get("battleId")): str(terminal.get("outcome"))
        for terminal in episode.get("battleTerminals", [])
    }
    run_terminals = episode.get("runTerminals", [])
    run_outcome = str(run_terminals[0].get("outcome")) if len(run_terminals) == 1 else None
    identities = Counter(record_identity(decision) for decision in decisions if decision.get("kind") == "combat_decision")
    decision_identity = max(identities.items(), key=lambda item: (item[1], item[0]))[0] if identities else None
    meta = EpisodeMeta(
        episode_id=episode_id,
        source_id=source_id,
        split=split,
        lineage_hash=sha256(f"lineage:{seed}"),
        roster_hash=roster_hash,
        roster_members=roster_members,
        hard_quarantined=bool(episode.get("result", {}).get("hardQuarantined")),
        completed_outcome_eligible=bool(episode.get("result", {}).get("completedOutcomeEligible")),
        run_outcome=run_outcome,
        decision_identity=decision_identity,
    )
    difficulty = str(envelope.get("difficulty") or "unknown")
    for decision in decisions:
        if decision.get("kind") != "combat_decision":
            exclusions["non_decision_record"] += 1
            continue
        if decision.get("policySource") != "human-v1" or decision.get("policyTarget") is not True:
            exclusions["non_human_policy_target"] += 1
            continue
        if len(decision.get("candidates", [])) <= 1:
            exclusions["one_legal_action"] += 1
            continue
        transitions = transition_by_decision.get(str(decision.get("decisionId")), [])
        if len(transitions) != 1:
            exclusions["aborted_or_ambiguous_commitment"] += 1
            continue
        if transitions[0].get("battleTerminal") in {"abort", "invalid"}:
            exclusions["invalid_terminal_commitment"] += 1
            continue
        try:
            state_hash, action_hash, indistinguishable = model_input_identity(decision)
        except (KeyError, TypeError, ValueError):
            exclusions["invalid_model_input"] += 1
            continue
        if indistinguishable:
            exclusions["indistinguishable_candidates"] += 1
            continue
        identity = record_identity(decision)
        if any(not value for value in identity):
            exclusions["missing_contract_identity"] += 1
            continue
        priority, strata = decision_strata(decision, difficulty)
        decision_id = str(decision["decisionId"])
        meta.policy_candidates.append(
            PolicyMeta(
                episode_id=episode_id,
                decision_id=decision_id,
                source_id=source_id,
                split=split,
                lineage_hash=meta.lineage_hash,
                identity=identity,
                state_hash=state_hash,
                action_hash=action_hash,
                rank=sha256(f"rank:{decision_id}"),
                priority=priority,
                strata=strata,
                battle_outcome=terminal_outcomes.get(battle_id(decision.get("jointActionId"))),
                run_outcome=run_outcome,
            )
        )
    return meta


def cross_split_duplicates(episodes: list[EpisodeMeta]) -> tuple[set[str], set[str]]:
    lineage_splits: dict[str, set[str]] = defaultdict(set)
    roster_splits: dict[str, set[str]] = defaultdict(set)
    for episode in episodes:
        lineage_splits[episode.lineage_hash].add(episode.split)
        if episode.roster_hash:
            roster_splits[episode.roster_hash].add(episode.split)
    exact_conflicts = {
        episode.episode_id
        for episode in episodes
        if len(lineage_splits[episode.lineage_hash]) > 1
        or (episode.roster_hash is not None and len(roster_splits[episode.roster_hash]) > 1)
    }

    inverted: dict[str, list[int]] = defaultdict(list)
    for index, episode in enumerate(episodes):
        if len(episode.roster_members) >= 3:
            for member in episode.roster_members:
                inverted[member].append(index)
    pair_overlap: Counter[tuple[int, int]] = Counter()
    for indices in inverted.values():
        if len(indices) > 200:
            continue
        for left_offset, left in enumerate(indices):
            for right in indices[left_offset + 1 :]:
                if episodes[left].split != episodes[right].split:
                    pair_overlap[(left, right)] += 1
    near_conflicts: set[str] = set()
    for (left, right), overlap in pair_overlap.items():
        left_members = episodes[left].roster_members
        right_members = episodes[right].roster_members
        required = max(3, math.ceil(0.8 * min(len(left_members), len(right_members))))
        if overlap >= required and overlap / max(len(left_members), len(right_members)) >= 2 / 3:
            near_conflicts.add(episodes[left].episode_id)
            near_conflicts.add(episodes[right].episode_id)
    return exact_conflicts, near_conflicts


def select_policy(
    episodes: list[EpisodeMeta],
    config: CurationConfig,
    exclusions: Counter[str],
) -> tuple[dict[tuple[str, str], PolicyMeta], tuple[str, str, str], set[str]]:
    identities: Counter[tuple[str, str, str]] = Counter(
        candidate.identity for episode in episodes for candidate in episode.policy_candidates
    )
    if not identities:
        raise ValueError("no policy candidates were found")
    selected_identity = max(identities.items(), key=lambda item: (item[1], item[0]))[0]
    exact_conflicts, near_conflicts = cross_split_duplicates(episodes)
    candidates: list[PolicyMeta] = []
    for episode in episodes:
        if episode.hard_quarantined:
            exclusions["hard_quarantined_episode"] += len(episode.policy_candidates)
            continue
        if episode.episode_id in exact_conflicts:
            exclusions["cross_split_lineage_or_exact_roster"] += len(episode.policy_candidates)
            continue
        if episode.episode_id in near_conflicts:
            exclusions["cross_split_near_duplicate_roster"] += len(episode.policy_candidates)
            continue
        for candidate in episode.policy_candidates:
            if candidate.identity != selected_identity:
                exclusions["non_selected_contract_identity"] += 1
                continue
            candidates.append(candidate)

    by_state: dict[str, list[PolicyMeta]] = defaultdict(list)
    for candidate in candidates:
        by_state[candidate.state_hash].append(candidate)
    deduplicated: list[PolicyMeta] = []
    for rows in by_state.values():
        if len({row.split for row in rows}) > 1:
            exclusions["cross_split_model_input"] += len(rows)
            continue
        labels = {row.action_hash for row in rows}
        if len(labels) > 1:
            exclusions["conflicting_human_labels"] += len(rows)
            continue
        ordered = sorted(rows, key=lambda row: row.rank)
        deduplicated.extend(ordered[: config.max_state_action_repeats])
        exclusions["duplicate_state_action_cap"] += max(0, len(ordered) - config.max_state_action_repeats)

    sampled: list[PolicyMeta] = []
    for candidate in deduplicated:
        rare = candidate.priority == 0
        if "wild" in candidate.strata and not rare and deterministic_fraction(candidate.decision_id) >= config.wild_keep_rate:
            exclusions["trivial_wild_downsample"] += 1
            continue
        sampled.append(candidate)

    source_counts: Counter[str] = Counter()
    lineage_counts: Counter[str] = Counter()
    selected: dict[tuple[str, str], PolicyMeta] = {}
    for candidate in sorted(sampled, key=lambda row: (row.priority, row.rank)):
        if source_counts[candidate.source_id] >= config.max_policy_per_source:
            exclusions["per_source_cap"] += 1
            continue
        if lineage_counts[candidate.lineage_hash] >= config.max_policy_per_lineage:
            exclusions["per_lineage_cap"] += 1
            continue
        selected[(candidate.episode_id, candidate.decision_id)] = candidate
        source_counts[candidate.source_id] += 1
        lineage_counts[candidate.lineage_hash] += 1
    return selected, selected_identity, exact_conflicts | near_conflicts


class DeterministicGzipWriter:
    def __init__(self, path: Path, max_uncompressed_bytes: int = MAX_UPLOAD_SHARD_UNCOMPRESSED_BYTES) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.base_path = path
        self.max_uncompressed_bytes = max_uncompressed_bytes
        self.files: list[dict[str, Any]] = []
        self.path: Path
        self.raw: BinaryIO
        self.compressed: gzip.GzipFile
        self.records = 0
        self.uncompressed_bytes = 0
        self._open()

    def _part_path(self, index: int) -> Path:
        if index == 0:
            return self.base_path
        suffix = ".jsonl.gz"
        if not self.base_path.name.endswith(suffix):
            raise ValueError("curated shard path must end in .jsonl.gz")
        stem = self.base_path.name[: -len(suffix)]
        return self.base_path.with_name(f"{stem}-part-{index:05d}{suffix}")

    def _open(self) -> None:
        self.path = self._part_path(len(self.files))
        self.raw = self.path.open("wb")
        self.compressed = gzip.GzipFile(filename="", mode="wb", fileobj=self.raw, mtime=0)
        self.records = 0
        self.uncompressed_bytes = 0

    def _close_part(self) -> None:
        self.compressed.close()
        self.raw.close()
        self.files.append(
            {
                "name": self.path.name,
                "sha256": file_sha256(self.path),
                "bytes": self.path.stat().st_size,
                "records": self.records,
            }
        )

    def write(self, record: dict[str, Any]) -> None:
        payload = f"{json.dumps(record, sort_keys=True, separators=(',', ':'))}\n".encode()
        if len(payload) > self.max_uncompressed_bytes:
            raise ValueError("one curated record exceeds the configured upload shard size")
        if self.records and self.uncompressed_bytes + len(payload) > self.max_uncompressed_bytes:
            self._close_part()
            self._open()
        self.compressed.write(payload)
        self.records += 1
        self.uncompressed_bytes += len(payload)

    def close(self) -> list[dict[str, Any]]:
        self._close_part()
        return self.files


def materialize(
    path: Path,
    private_out: Path,
    episodes: list[EpisodeMeta],
    selected: dict[tuple[str, str], PolicyMeta],
    selected_identity: tuple[str, str, str],
    team_conflicts: set[str],
) -> tuple[list[dict[str, Any]], dict[str, Counter[str]], Counter[str], Counter[str]]:
    writers: dict[tuple[str, str], DeterministicGzipWriter] = {}
    for split in SPLITS:
        for dataset in ("policy-all", "policy-battle-wins", "policy-run-wins", "critic-all-outcomes"):
            writers[(dataset, split)] = DeterministicGzipWriter(private_out / f"{dataset}-{split}.jsonl.gz")
    episode_by_id = {episode.episode_id: episode for episode in episodes}
    selected_by_episode: dict[str, dict[str, PolicyMeta]] = defaultdict(dict)
    for (episode_id, decision_id), candidate in selected.items():
        selected_by_episode[episode_id][decision_id] = candidate
    strata_counts = {split: Counter() for split in SPLITS}
    policy_sources: Counter[str] = Counter()
    critic_sources: Counter[str] = Counter()
    for episode in iter_episodes(path):
        episode_id = str(episode["episodeId"])
        meta = episode_by_id[episode_id]
        selected_rows = selected_by_episode.get(episode_id, {})
        for decision in episode.get("decisions", []):
            decision_id = str(decision.get("decisionId"))
            candidate = selected_rows.get(decision_id)
            if candidate is None:
                continue
            writers[("policy-all", meta.split)].write(decision)
            policy_sources[f"{meta.split}:{meta.source_id}"] += 1
            for stratum in candidate.strata:
                strata_counts[meta.split][stratum] += 1
            if candidate.battle_outcome == "victory":
                writers[("policy-battle-wins", meta.split)].write(decision)
            if candidate.run_outcome == "victory":
                writers[("policy-run-wins", meta.split)].write(decision)
        if (
            meta.completed_outcome_eligible
            and not meta.hard_quarantined
            and meta.episode_id not in team_conflicts
            and meta.decision_identity == selected_identity
        ):
            writers[("critic-all-outcomes", meta.split)].write(episode)
            critic_sources[f"{meta.split}:{meta.source_id}"] += 1
    files = [descriptor for writer in writers.values() for descriptor in writer.close()]
    return files, strata_counts, policy_sources, critic_sources


def dataset_record_count(files: list[dict[str, Any]], dataset: str, split: str) -> int:
    prefix = f"{dataset}-{split}"
    return sum(
        int(row["records"])
        for row in files
        if row["name"] == f"{prefix}.jsonl.gz" or row["name"].startswith(f"{prefix}-part-")
    )


def count_sources(counts: Counter[str], split: str) -> int:
    return sum(1 for key, value in counts.items() if value > 0 and key.startswith(f"{split}:"))


def curate(path: Path, private_out: Path, report_path: Path, config: CurationConfig) -> dict[str, Any]:
    exclusions: Counter[str] = Counter()
    episodes = [analyze_episode(episode, exclusions) for episode in iter_episodes(path)]
    selected, identity, team_conflicts = select_policy(episodes, config, exclusions)
    files, strata, policy_sources, critic_sources = materialize(
        path,
        private_out,
        episodes,
        selected,
        identity,
        team_conflicts,
    )
    config_payload = {
        "maxPolicyPerSource": config.max_policy_per_source,
        "maxPolicyPerLineage": config.max_policy_per_lineage,
        "maxStateActionRepeats": config.max_state_action_repeats,
        "wildKeepRate": config.wild_keep_rate,
    }
    manifest_core = {
        "contractVersion": 4,
        "featureSchemaVersion": 4,
        "identity": {"buildSha": identity[0], "dexHash": identity[1], "dictionaryHash": identity[2]},
        "curationConfig": config_payload,
        "files": sorted(files, key=lambda row: row["name"]),
    }
    dataset_id = sha256(json.dumps(manifest_core, sort_keys=True, separators=(",", ":")))[:24]
    manifest = {"datasetId": dataset_id, **manifest_core}
    private_out.joinpath("manifest.json").write_text(
        f"{json.dumps(manifest, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )
    policy_counts = Counter(candidate.split for candidate in selected.values())
    critic_counts = {
        split: dataset_record_count(files, "critic-all-outcomes", split)
        for split in SPLITS
    }
    report = {
        "reportVersion": 1,
        "gate": "contract-v4-source-lineage-curation",
        "passed": all(policy_counts[split] > 0 for split in SPLITS),
        "privacy": {"rawIdentifiersIncluded": False, "rawRecordsIncluded": False},
        "datasetId": dataset_id,
        "identity": manifest_core["identity"],
        "curationConfig": config_payload,
        "episodesScanned": len(episodes),
        "policy": {
            split: {
                "decisions": policy_counts[split],
                "sources": count_sources(policy_sources, split),
                "strata": dict(sorted(strata[split].items())),
            }
            for split in SPLITS
        },
        "critic": {
            split: {"episodes": critic_counts[split], "sources": count_sources(critic_sources, split)}
            for split in SPLITS
        },
        "excluded": dict(sorted(exclusions.items())),
        "files": manifest_core["files"],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(f"{json.dumps(report, indent=2, sort_keys=True)}\n", encoding="utf-8")
    if not report["passed"]:
        raise RuntimeError("curated policy split is empty")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--episodes", type=Path, required=True)
    parser.add_argument("--private-out", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--max-policy-per-source", type=int, default=512)
    parser.add_argument("--max-policy-per-lineage", type=int, default=1024)
    parser.add_argument("--max-state-action-repeats", type=int, default=2)
    parser.add_argument("--wild-keep-rate", type=float, default=0.25)
    args = parser.parse_args()
    if args.max_policy_per_source < 1 or args.max_policy_per_lineage < 1 or args.max_state_action_repeats < 1:
        parser.error("all curation caps must be positive")
    if not 0 < args.wild_keep_rate <= 1:
        parser.error("wild keep rate must be in (0, 1]")
    return args


def main() -> None:
    args = parse_args()
    report = curate(
        args.episodes,
        args.private_out,
        args.report,
        CurationConfig(
            max_policy_per_source=args.max_policy_per_source,
            max_policy_per_lineage=args.max_policy_per_lineage,
            max_state_action_repeats=args.max_state_action_repeats,
            wild_keep_rate=args.wild_keep_rate,
        ),
    )
    print(json.dumps({"datasetId": report["datasetId"], "policy": report["policy"], "critic": report["critic"]}))


if __name__ == "__main__":
    main()
