#!/usr/bin/env python3
"""Train inexpensive candidate rankers on versioned ER combat-decision JSONL."""

from __future__ import annotations

import argparse
import gc
import hashlib
import heapq
import json
import math
import pickle
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.base import clone
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler

LGBMClassifier: Any = None
LGBMRanker: Any = None
_LIGHTGBM_IMPORT_ATTEMPTED = False

SUPPORTED_SCHEMA_VERSIONS = {3, 4}
SCHEMA_VERSION = 3
FEATURE_SCHEMA_VERSION = 2
TOKEN_GROUP_NAMES = ("actor", "targets", "destination", "field", "action")
EPSILON = 1e-9
ROLLOUT_POLICY = "epsilon-tree-v1"
SUCCESSFUL_ROLLOUT_OUTCOMES = {"victory", "max-waves"}
NON_POLICY_TARGET_SOURCES = {
    "smart-default-v1",
    "scripted",
    "forced-move",
    "first-usable",
    "tree-model-v1",
    "diagnostic-tree-v1",
    "epsilon-tree-v1",
    "engine-hardest-v1",
}


def record_policy_source(record: dict[str, Any]) -> str:
    return str(record.get("policySource", record.get("sourcePolicy", "unknown")))


def record_battle_id(record: dict[str, Any]) -> str | None:
    explicit = record.get("battleId")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    joint_action_id = record.get("jointActionId")
    if isinstance(joint_action_id, str) and ":" in joint_action_id:
        return joint_action_id.rsplit(":", 1)[0]
    return None


def is_policy_target(record: dict[str, Any]) -> bool:
    source = record_policy_source(record)
    if source in NON_POLICY_TARGET_SOURCES:
        return False
    explicit = record.get("policyTarget")
    return bool(explicit) if explicit is not None else True


def select_training_decisions(
    rollout_decisions: list[dict[str, Any]], diagnostic_source_imitation: bool
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    policy_decisions = [record for record in rollout_decisions if is_policy_target(record)]
    if policy_decisions:
        return policy_decisions, policy_decisions, False
    if diagnostic_source_imitation:
        return rollout_decisions, policy_decisions, True
    excluded = Counter(record_policy_source(record) for record in rollout_decisions)
    raise ValueError(f"no policy-target decisions remain after source filtering: {dict(excluded)}")


def load_optional_lightgbm() -> None:
    global LGBMClassifier, LGBMRanker, _LIGHTGBM_IMPORT_ATTEMPTED
    if _LIGHTGBM_IMPORT_ATTEMPTED:
        return
    _LIGHTGBM_IMPORT_ATTEMPTED = True
    try:
        from lightgbm import LGBMClassifier as classifier
        from lightgbm import LGBMRanker as ranker
    except ModuleNotFoundError:
        return
    LGBMClassifier = classifier
    LGBMRanker = ranker


def jsonl_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(file for file in path.rglob("*.jsonl") if file.is_file())


def dataset_schema_versions(decisions: list[dict[str, Any]]) -> tuple[int, int]:
    schema_versions = {int(record.get("schemaVersion", -1)) for record in decisions}
    feature_versions = {int(record.get("featureSchemaVersion", -1)) for record in decisions}
    if len(schema_versions) != 1 or not schema_versions.issubset(SUPPORTED_SCHEMA_VERSIONS):
        raise ValueError(f"dataset must contain one supported contract schema, found {sorted(schema_versions)}")
    if len(feature_versions) != 1 or min(feature_versions) < 1:
        raise ValueError(f"dataset must contain one positive feature schema, found {sorted(feature_versions)}")
    return schema_versions.pop(), feature_versions.pop()


def load_records(
    path: Path,
    require_terminals: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    decisions: list[dict[str, Any]] = []
    terminals: list[dict[str, Any]] = []
    for file in jsonl_files(path):
        with file.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                if record.get("schemaVersion") not in SUPPORTED_SCHEMA_VERSIONS:
                    raise ValueError(f"{file}:{line_number}: unsupported schema version")
                if record.get("kind") == "combat_decision":
                    validate_decision(record, file, line_number)
                    decisions.append(record)
                elif record.get("kind") in ("episode_terminal", "run_terminal"):
                    terminals.append(record)
                elif record.get("kind") in ("combat_auxiliary_decision", "combat_transition", "battle_terminal"):
                    continue
                else:
                    raise ValueError(f"{file}:{line_number}: unknown record kind")
    if not decisions:
        raise ValueError(f"no combat decisions found under {path}")
    dataset_schema_versions(decisions)
    validate_dataset(decisions, terminals, require_terminals=require_terminals)
    return decisions, terminals


def load_policy_trajectory_records(
    path: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    """Load ER policy rows with battle terminals when available, else legacy run terminals."""
    decisions: list[dict[str, Any]] = []
    run_terminals: list[dict[str, Any]] = []
    battle_terminals: list[dict[str, Any]] = []
    for file in jsonl_files(path):
        with file.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                if record.get("schemaVersion") not in SUPPORTED_SCHEMA_VERSIONS:
                    raise ValueError(f"{file}:{line_number}: unsupported schema version")
                kind = record.get("kind")
                if kind == "combat_decision":
                    validate_decision(record, file, line_number)
                    decisions.append(record)
                elif kind in ("episode_terminal", "run_terminal"):
                    run_terminals.append(record)
                elif kind == "battle_terminal":
                    battle_terminals.append(record)
                elif kind in ("combat_auxiliary_decision", "combat_transition"):
                    continue
                else:
                    raise ValueError(f"{file}:{line_number}: unknown record kind")
    if not decisions:
        raise ValueError(f"no combat decisions found under {path}")
    dataset_schema_versions(decisions)
    validate_dataset(decisions, [], require_terminals=False)
    if not battle_terminals:
        validate_dataset(decisions, run_terminals)
        return decisions, run_terminals, "episode"

    terminal_by_battle = {record_battle_id(record): record for record in battle_terminals}
    if None in terminal_by_battle or len(terminal_by_battle) != len(battle_terminals):
        raise ValueError("dataset contains missing or duplicate battle terminal ids")
    decisions_by_battle: dict[str, set[str]] = defaultdict(set)
    for decision in decisions:
        battle_id = record_battle_id(decision)
        if battle_id is None:
            raise ValueError(f"decision {decision['decisionId']} has no stable battle identity")
        decisions_by_battle[battle_id].add(decision["episodeId"])
    inconsistent = sorted(
        battle_id for battle_id, episodes in decisions_by_battle.items() if len(episodes) != 1
    )
    if inconsistent:
        raise ValueError(f"battle ids map to multiple episodes: {inconsistent}")
    mismatched = sorted(
        battle_id
        for battle_id, terminal in terminal_by_battle.items()
        if battle_id in decisions_by_battle
        and terminal.get("episodeId") not in decisions_by_battle[battle_id]
    )
    if mismatched:
        raise ValueError(f"battle terminal episode mismatch: {mismatched}")
    for identity in ("buildSha", "dexHash", "dictionaryHash"):
        values = {record.get(identity) for record in decisions + battle_terminals}
        if len(values) != 1 or None in values or "unknown" in values:
            raise ValueError(f"dataset must have one known {identity}, found {sorted(map(str, values))}")
    return decisions, battle_terminals, "battle"


def load_winner_policy_records(
    path: Path,
    max_policy_decisions: int | None = None,
    winner_scope: str = "run",
    battle_type: int | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int | str | None]]:
    """Load victorious run or battle policy targets without retaining the full corpus."""
    if max_policy_decisions is not None and max_policy_decisions < 1:
        raise ValueError("max policy decisions must be positive")
    if winner_scope not in ("run", "battle"):
        raise ValueError(f"unsupported winner scope {winner_scope}")
    files = jsonl_files(path)
    terminals: list[dict[str, Any]] = []
    battle_terminals: list[dict[str, Any]] = []
    input_decisions = 0
    for file in files:
        with file.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                if record.get("schemaVersion") not in SUPPORTED_SCHEMA_VERSIONS:
                    raise ValueError(f"{file}:{line_number}: unsupported schema version")
                if record.get("kind") == "combat_decision":
                    input_decisions += 1
                elif record.get("kind") in ("episode_terminal", "run_terminal"):
                    terminals.append(record)
                elif record.get("kind") == "battle_terminal":
                    battle_terminals.append(record)
                elif record.get("kind") in ("combat_auxiliary_decision", "combat_transition"):
                    continue
                else:
                    raise ValueError(f"{file}:{line_number}: unknown record kind")

    terminal_by_episode = {record["episodeId"]: record for record in terminals}
    if winner_scope == "run" and len(terminal_by_episode) != len(terminals):
        raise ValueError("dataset contains duplicate episode terminals")
    winning_episodes = {
        terminal["episodeId"]
        for terminal in terminals
        if terminal.get("outcome") in SUCCESSFUL_ROLLOUT_OUTCOMES
    }
    battle_terminal_by_id = {record.get("battleId"): record for record in battle_terminals}
    if winner_scope == "battle" and (
        None in battle_terminal_by_id or len(battle_terminal_by_id) != len(battle_terminals)
    ):
        raise ValueError("dataset contains missing or duplicate battle terminal ids")
    winning_battles = {
        battle_id
        for battle_id, terminal in battle_terminal_by_id.items()
        if terminal.get("outcome") == "victory"
    }
    decisions: list[dict[str, Any]] = []
    sampled: list[tuple[int, str, dict[str, Any]]] = []
    policy_target_decisions = 0
    matching_battle_type_policy_target_decisions = 0
    winning_policy_target_decisions = 0
    for file in files:
        with file.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                if record.get("kind") != "combat_decision":
                    continue
                if not is_policy_target(record):
                    continue
                policy_target_decisions += 1
                if battle_type is not None:
                    record_battle_type = record.get("observation", {}).get("battleType")
                    if record_battle_type is None:
                        raise ValueError(
                            f"{file}:{line_number}: battle-type filtering requires observation.battleType"
                        )
                    if record_battle_type != battle_type:
                        continue
                matching_battle_type_policy_target_decisions += 1
                if winner_scope == "run":
                    selected_winner = record.get("episodeId") in winning_episodes
                else:
                    battle_id = record_battle_id(record)
                    if battle_id is None:
                        raise ValueError(
                            f"{file}:{line_number}: battle winner selection requires a joint action id"
                        )
                    selected_winner = battle_id in winning_battles
                if not selected_winner:
                    continue
                winning_policy_target_decisions += 1
                validate_decision(record, file, line_number)
                if max_policy_decisions is None:
                    decisions.append(record)
                    continue
                priority = int.from_bytes(
                    hashlib.sha256(
                        f"{record_source_partition(record)}\0{record['decisionId']}".encode("utf-8")
                    ).digest()[:8],
                    "big",
                )
                entry = (-priority, record["decisionId"], record)
                if len(sampled) < max_policy_decisions:
                    heapq.heappush(sampled, entry)
                elif entry > sampled[0]:
                    heapq.heapreplace(sampled, entry)

    if max_policy_decisions is not None:
        decisions = [entry[2] for entry in sorted(sampled, key=lambda entry: entry[1])]

    if not decisions:
        raise ValueError("winner-only policy selection removed every combat decision")
    dataset_schema_versions(decisions)
    selected_episodes = {record["episodeId"] for record in decisions}
    selected_terminals = (
        [record for record in terminals if record["episodeId"] in selected_episodes]
        if winner_scope == "run"
        else []
    )
    validate_dataset(
        decisions,
        selected_terminals,
        require_terminals=winner_scope == "run",
    )
    selected_battles = {
        record_battle_id(record)
        for record in decisions
        if record_battle_id(record) is not None
    }
    return decisions, selected_terminals, {
        "winnerScope": winner_scope,
        "inputDecisions": input_decisions,
        "policyTargetDecisions": policy_target_decisions,
        "battleTypeFilter": battle_type,
        "matchingBattleTypePolicyTargetDecisions": matching_battle_type_policy_target_decisions,
        "winningPolicyTargetDecisions": winning_policy_target_decisions,
        "retainedDecisions": len(decisions),
        "maxPolicyDecisions": max_policy_decisions,
        "inputEpisodes": len({record["episodeId"] for record in terminals}),
        "inputRunTerminals": len(terminals),
        "winningEpisodes": len(winning_episodes),
        "retainedEpisodes": len(selected_episodes),
        "inputBattles": len(battle_terminals),
        "winningBattles": len(winning_battles),
        "retainedBattles": len(selected_battles),
    }


def validate_decision(record: dict[str, Any], file: Path, line_number: int) -> None:
    candidates = record.get("candidates", [])
    ids = [candidate.get("id") for candidate in candidates]
    chosen = record.get("chosenCandidateId")
    prefix = f"{file}:{line_number}"
    if record.get("candidateScope") != "combat-command":
        raise ValueError(f"{prefix}: unsupported candidate scope")
    if len(ids) != len(set(ids)):
        raise ValueError(f"{prefix}: duplicate candidate ids")
    if ids.count(chosen) != 1:
        raise ValueError(f"{prefix}: chosen label does not map exactly once")
    if not record.get("episodeId") or not record.get("decisionId"):
        raise ValueError(f"{prefix}: missing episode/decision identity")
    feature_rows = record.get("candidateFeatures", [])
    feature_ids = [row.get("candidateId") for row in feature_rows]
    if not isinstance(record.get("featureSchemaVersion"), int) or record["featureSchemaVersion"] < 1:
        raise ValueError(f"{prefix}: unsupported feature schema")
    if len(feature_ids) != len(ids) or len(set(feature_ids)) != len(ids) or set(feature_ids) != set(ids):
        raise ValueError(f"{prefix}: candidate features do not map one-to-one")
    if any(not row.get("values") or not all(math.isfinite(float(value)) for value in row["values"]) for row in feature_rows):
        raise ValueError(f"{prefix}: candidate features must be finite and non-empty")
    token_rows = record.get("candidateTokenGroups", [])
    token_ids = [row.get("candidateId") for row in token_rows]
    if len(token_ids) != len(ids) or len(set(token_ids)) != len(ids) or set(token_ids) != set(ids):
        raise ValueError(f"{prefix}: candidate token groups do not map one-to-one")
    for row in token_rows:
        groups = row.get("groups")
        if not isinstance(groups, dict) or set(groups) != set(TOKEN_GROUP_NAMES):
            raise ValueError(f"{prefix}: candidate token groups have an invalid role set")
        if not groups["action"]:
            raise ValueError(f"{prefix}: candidate action token group must not be empty")
        if any(
            not isinstance(groups[group], list)
            or any(not isinstance(token, str) or not token for token in groups[group])
            for group in TOKEN_GROUP_NAMES
        ):
            raise ValueError(f"{prefix}: candidate token groups must contain non-empty strings")
    for opponent in record.get("observation", {}).get("opponentActive", []):
        if any(opponent.get(field) is not None for field in ("hp", "maxHp", "stats", "effectiveStats")):
            raise ValueError(f"{prefix}: hidden opponent stats crossed the Battle Info visibility boundary")
        if any(not item.get("revealed") for item in opponent.get("heldItems") or []):
            raise ValueError(f"{prefix}: unrevealed opponent item crossed the Battle Info visibility boundary")
        if any(not ability.get("revealed") for ability in opponent.get("abilities", [])):
            raise ValueError(f"{prefix}: unrevealed opponent ability crossed the Battle Info visibility boundary")
    for opponent in record.get("observation", {}).get("opponentKnownParty", []):
        if any(opponent.get(field) is not None for field in ("hp", "maxHp", "hpRatio", "stats", "effectiveStats")):
            raise ValueError(f"{prefix}: live hidden opponent bench state crossed the Battle Info visibility boundary")
        if opponent.get("activeSlot") is not None:
            raise ValueError(f"{prefix}: known opponent bench entry is still marked active")
        if any(not item.get("revealed") for item in opponent.get("heldItems") or []):
            raise ValueError(f"{prefix}: unrevealed opponent bench item crossed the Battle Info visibility boundary")
        if any(not ability.get("revealed") for ability in opponent.get("abilities", [])):
            raise ValueError(f"{prefix}: unrevealed opponent bench ability crossed the Battle Info visibility boundary")
    if any(modifier.get("side") == "opponent" for modifier in record.get("observation", {}).get("modifiers", [])):
        raise ValueError(f"{prefix}: hidden opponent modifiers crossed the Battle Info visibility boundary")


def validate_dataset(
    decisions: list[dict[str, Any]],
    terminals: list[dict[str, Any]],
    require_terminals: bool = True,
) -> None:
    decision_ids = [record["decisionId"] for record in decisions]
    if len(decision_ids) != len(set(decision_ids)):
        raise ValueError("dataset contains duplicate decision ids")

    decision_episodes = Counter(record["episodeId"] for record in decisions)
    terminal_episodes = Counter(record.get("episodeId") for record in terminals)
    missing = sorted(set(decision_episodes) - set(terminal_episodes))
    extra = sorted(set(terminal_episodes) - set(decision_episodes))
    duplicated = sorted(episode for episode, count in terminal_episodes.items() if count != 1)
    if require_terminals and (missing or extra or duplicated):
        raise ValueError(
            "episode terminal mismatch: "
            f"missing={missing}, extra={extra}, non_unique={duplicated}"
        )

    for identity in ("buildSha", "dexHash", "dictionaryHash"):
        values = {record.get(identity) for record in decisions + terminals}
        if len(values) != 1 or None in values or "unknown" in values:
            raise ValueError(f"dataset must have one known {identity}, found {sorted(map(str, values))}")

    groups_by_episode: dict[str, set[str]] = defaultdict(set)
    partitions_by_episode: dict[str, set[str]] = defaultdict(set)
    for record in decisions + terminals:
        groups_by_episode[record["episodeId"]].add(record_split_group(record))
        partitions_by_episode[record["episodeId"]].add(record_source_partition(record))
    inconsistent = sorted(episode for episode, groups in groups_by_episode.items() if len(groups) != 1)
    if inconsistent:
        raise ValueError(f"episodes map to multiple split groups: {inconsistent}")
    inconsistent_partitions = sorted(
        episode for episode, partitions in partitions_by_episode.items() if len(partitions) != 1
    )
    if inconsistent_partitions:
        raise ValueError(f"episodes map to multiple source partitions: {inconsistent_partitions}")


def empty_dictionary_references() -> dict[str, set[Any]]:
    return {
        "moves": set(),
        "abilities": set(),
        "items": set(),
        "modifiers": set(),
        "speciesForms": set(),
        "battlerTags": set(),
        "arenaTags": set(),
        "positionalTags": set(),
        "relics": set(),
        "mechanicNamespaces": set(),
    }


def accumulate_dictionary_references(
    decision: dict[str, Any],
    references: dict[str, set[Any]],
) -> None:
    observation = decision["observation"]
    for pokemon in observation["selfParty"] + observation["opponentActive"] + observation.get("opponentKnownParty", []):
        references["speciesForms"].add(f'{int(pokemon["species"])}:{int(pokemon["form"])}')
        references["abilities"].update(int(value["abilityId"]) for value in pokemon.get("abilities", []))
        references["moves"].update(int(move["moveId"]) for move in pokemon.get("moves", []))
        held_items = pokemon.get("heldItems")
        if isinstance(held_items, list):
            references["items"].update(str(value["itemId"]) for value in held_items)
        references["battlerTags"].update(str(value["effectId"]) for value in pokemon.get("tags", []))
        references["mechanicNamespaces"].update(
            str(value["effectId"]).split(":", 1)[0]
            for value in pokemon.get("mechanics", [])
        )
    references["arenaTags"].update(str(value["effectId"]) for value in observation.get("fieldEffects", []))
    references["positionalTags"].update(
        str(value["effectId"]) for value in observation.get("positionalEffects", [])
    )
    references["mechanicNamespaces"].update(
        str(value["effectId"]).split(":", 1)[0]
        for value in observation.get("mechanics", [])
    )
    for modifier in observation.get("modifiers", []):
        references["modifiers"].add(str(modifier["modifierId"]))
        for field in modifier.get("state", []):
            if field.get("key") == "kind" and isinstance(field.get("value"), str):
                references["relics"].add(field["value"])
    references["moves"].update(
        int(candidate["moveId"])
        for candidate in decision["candidates"]
        if candidate.get("kind") == "move"
    )


def validate_data_dictionary_summary(
    path: Path,
    recorded_feature_schema_version: int,
    recorded_feature_counts: set[int],
    recorded_hashes: set[Any],
    references: dict[str, set[Any]],
    supplement_path: Path | None = None,
) -> dict[str, Any]:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    dictionary = json.loads(raw)
    if dictionary.get("schemaVersion") != 3:
        raise ValueError(f"unsupported combat data dictionary schema {dictionary.get('schemaVersion')}")
    features = dictionary.get("features")
    if (
        not isinstance(features, dict)
        or features.get("schemaVersion") != recorded_feature_schema_version
        or not isinstance(features.get("names"), list)
        or not features["names"]
        or any(not isinstance(name, str) or not name for name in features["names"])
        or len(set(features["names"])) != len(features["names"])
    ):
        raise ValueError("combat data dictionary has an invalid feature-name contract")
    if recorded_feature_counts != {len(features["names"])}:
        raise ValueError(
            f"feature-name dictionary width mismatch: records={sorted(recorded_feature_counts)}, "
            f"dictionary={len(features['names'])}"
        )
    if recorded_hashes != {digest}:
        raise ValueError(f"dictionary hash mismatch: records={sorted(map(str, recorded_hashes))}, file={digest}")

    supplement_coverage: dict[str, Any] = {
        "sha256": None,
        "items": 0,
        "modifiers": 0,
    }
    if supplement_path is not None:
        supplement_raw = supplement_path.read_bytes()
        supplement = json.loads(supplement_raw)
        if supplement.get("schemaVersion") != 1:
            raise ValueError(f"unsupported dictionary supplement schema {supplement.get('schemaVersion')}")
        if supplement.get("baseDictionarySha256") != digest:
            raise ValueError("dictionary supplement does not match the captured base dictionary")
        for section in ("items", "modifiers"):
            additions = supplement.get(section, {})
            if not isinstance(additions, dict):
                raise ValueError(f"dictionary supplement {section} must be an object")
            target = dictionary.setdefault(section, {})
            overlap = sorted(set(target) & set(additions))
            if overlap:
                raise ValueError(f"dictionary supplement attempts to replace existing {section}: {overlap}")
            target.update(additions)
            supplement_coverage[section] = len(additions)
        supplement_coverage["sha256"] = hashlib.sha256(supplement_raw).hexdigest()

    known_moves = {int(value) for value in dictionary.get("moves", {})}
    known_abilities = {int(value) for value in dictionary.get("abilities", {})}
    known_items = set(dictionary.get("items", {}))
    known_modifiers = set(dictionary.get("modifiers", {}))
    known_species_forms = set(dictionary.get("speciesForms", {}))
    known_battler_tags = set(dictionary.get("battlerTags", []))
    known_arena_tags = set(dictionary.get("arenaTags", []))
    known_positional_tags = set(dictionary.get("positionalTags", []))
    known_relics = set(dictionary.get("relics", {}))
    known_mechanic_namespaces = set(dictionary.get("mechanicNamespaces", []))
    missing = {
        "moves": sorted(references["moves"] - known_moves),
        "abilities": sorted(references["abilities"] - known_abilities),
        "items": sorted(references["items"] - known_items),
        "modifiers": sorted(references["modifiers"] - known_modifiers),
        "speciesForms": sorted(references["speciesForms"] - known_species_forms),
        "battlerTags": sorted(references["battlerTags"] - known_battler_tags),
        "arenaTags": sorted(references["arenaTags"] - known_arena_tags),
        "positionalTags": sorted(references["positionalTags"] - known_positional_tags),
        "relics": sorted(references["relics"] - known_relics),
        "mechanicNamespaces": sorted(references["mechanicNamespaces"] - known_mechanic_namespaces),
    }
    if any(missing.values()):
        raise ValueError(f"combat data dictionary misses recorded runtime ids: {missing}")
    return {
        "sha256": digest,
        "features": len(features["names"]),
        "moves": len(known_moves),
        "abilities": len(known_abilities),
        "items": len(known_items),
        "modifiers": len(known_modifiers),
        "speciesForms": len(known_species_forms),
        "battlerTags": len(known_battler_tags),
        "arenaTags": len(known_arena_tags),
        "positionalTags": len(known_positional_tags),
        "relics": len(known_relics),
        "mechanicNamespaces": len(known_mechanic_namespaces),
        "referencedMoves": len(references["moves"]),
        "referencedAbilities": len(references["abilities"]),
        "referencedItems": len(references["items"]),
        "referencedModifiers": len(references["modifiers"]),
        "referencedSpeciesForms": len(references["speciesForms"]),
        "referencedRelics": len(references["relics"]),
        "referencedMechanicNamespaces": len(references["mechanicNamespaces"]),
        "supplement": supplement_coverage,
    }


def validate_data_dictionary(
    path: Path,
    decisions: list[dict[str, Any]],
    supplement_path: Path | None = None,
) -> dict[str, Any]:
    _, recorded_feature_schema_version = dataset_schema_versions(decisions)
    references = empty_dictionary_references()
    for decision in decisions:
        accumulate_dictionary_references(decision, references)
    return validate_data_dictionary_summary(
        path,
        recorded_feature_schema_version,
        {
            len(row["values"])
            for decision in decisions
            for row in decision["candidateFeatures"]
        },
        {record.get("dictionaryHash") for record in decisions},
        references,
        supplement_path,
    )


def select_elite_rollouts(
    decisions: list[dict[str, Any]],
    terminals: list[dict[str, Any]],
    terminal_scope: str = "episode",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if terminal_scope not in ("episode", "battle"):
        raise ValueError(f"unsupported terminal scope {terminal_scope}")

    def identity(record: dict[str, Any]) -> str | None:
        return record.get("episodeId") if terminal_scope == "episode" else record_battle_id(record)

    terminal_by_identity = {identity(record): record for record in terminals}
    if None in terminal_by_identity or len(terminal_by_identity) != len(terminals):
        raise ValueError(f"dataset contains missing or duplicate {terminal_scope} terminals")
    rollout_identities = {
        identity(record) for record in decisions if record_policy_source(record) == ROLLOUT_POLICY
    }
    successful = {
        key
        for key in rollout_identities
        if key in terminal_by_identity
        and terminal_by_identity[key]["outcome"] in SUCCESSFUL_ROLLOUT_OUTCOMES
    }
    selected = [
        record
        for record in decisions
        if record_policy_source(record) != ROLLOUT_POLICY or identity(record) in successful
    ]
    if not selected:
        raise ValueError("elite rollout selection removed every decision")
    return selected, {
        "terminalScope": terminal_scope,
        "episodes": len(rollout_identities),
        "successfulEpisodes": len(successful),
        "successRate": len(successful) / len(rollout_identities) if rollout_identities else None,
        "decisionsBeforeSelection": len(decisions),
        "decisionsAfterSelection": len(selected),
    }


def active_mon(observation: dict[str, Any], slot: int) -> dict[str, Any]:
    for mon in observation["selfParty"]:
        if mon.get("activeSlot") == slot:
            return mon
    raise ValueError(f"no active self mon for slot {slot}")


def embedded_candidate_features(decision: dict[str, Any], candidate: dict[str, Any]) -> list[float]:
    by_id = {row["candidateId"]: row["values"] for row in decision["candidateFeatures"]}
    return [float(value) for value in by_id[candidate["id"]]]


def record_split_group(record: dict[str, Any]) -> str:
    explicit = record.get("splitGroupId")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    episode_id = record["episodeId"]
    legacy_pilot = re.fullmatch(r"pilot-(\d+)", episode_id)
    if legacy_pilot:
        return f"pilot-pair-{int(legacy_pilot.group(1)) // 2}"
    return episode_id


def record_source_partition(record: dict[str, Any]) -> str:
    explicit = record.get("sourcePartitionId")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    return record_split_group(record)


def make_rows(
    decisions: list[dict[str, Any]],
) -> tuple[np.ndarray, np.ndarray, list[str], list[str], list[str], list[str], list[int]]:
    first_features = decisions[0]["candidateFeatures"][0]["values"]
    feature_count = len(first_features)
    row_count = sum(len(decision["candidates"]) for decision in decisions)
    x_rows = np.empty((row_count, feature_count), dtype=np.float32)
    labels = np.empty(row_count, dtype=np.int8)
    decision_ids: list[str] = []
    episodes: list[str] = []
    split_groups: list[str] = []
    source_partitions: list[str] = []
    candidate_counts: list[int] = []
    row_index = 0
    for decision in decisions:
        candidates = decision["candidates"]
        features_by_id = {
            row["candidateId"]: row["values"]
            for row in decision["candidateFeatures"]
        }
        candidate_counts.append(len(candidates))
        for candidate in candidates:
            values = features_by_id[candidate["id"]]
            if len(values) != feature_count:
                raise ValueError(
                    f"dataset contains inconsistent feature counts: expected {feature_count}, got {len(values)}"
                )
            x_rows[row_index] = values
            labels[row_index] = int(candidate["id"] == decision["chosenCandidateId"])
            decision_ids.append(decision["decisionId"])
            episodes.append(decision["episodeId"])
            split_groups.append(record_split_group(decision))
            source_partitions.append(record_source_partition(decision))
            row_index += 1
    return (
        x_rows,
        labels,
        decision_ids,
        episodes,
        split_groups,
        source_partitions,
        candidate_counts,
    )


def split_groups(groups: list[str], seed: int) -> tuple[set[str], set[str]]:
    unique = sorted(set(groups))
    if len(unique) < 2:
        raise ValueError("at least two matchup groups are required for a leakage-safe split")
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)
    test_count = max(1, int(round(len(unique) * 0.34)))
    return set(unique[test_count:]), set(unique[:test_count])


def ordered_group_sizes(decision_ids: list[str]) -> list[int]:
    sizes: list[int] = []
    seen: set[str] = set()
    previous: str | None = None
    for decision_id in decision_ids:
        if decision_id != previous:
            if decision_id in seen:
                raise ValueError(f"candidate rows for decision {decision_id} are not contiguous")
            seen.add(decision_id)
            sizes.append(0)
            previous = decision_id
        sizes[-1] += 1
    return sizes


def row_weights(labels: np.ndarray, decision_ids: list[str]) -> np.ndarray:
    sizes = Counter(decision_ids)
    return np.asarray(
        [0.5 if label else 0.5 / max(1, sizes[decision_id] - 1) for label, decision_id in zip(labels, decision_ids)],
        dtype=np.float64,
    )


def ranking_metrics(scores: np.ndarray, labels: np.ndarray, decision_ids: list[str]) -> dict[str, float]:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, decision_id in enumerate(decision_ids):
        groups[decision_id].append(index)
    ranks: list[int] = []
    losses: list[float] = []
    for indices in groups.values():
        group_scores = scores[indices]
        group_labels = labels[indices]
        chosen = int(np.flatnonzero(group_labels == 1)[0])
        order = np.argsort(-group_scores, kind="stable")
        rank = int(np.flatnonzero(order == chosen)[0]) + 1
        ranks.append(rank)
        shifted = group_scores - np.max(group_scores)
        probabilities = np.exp(np.clip(shifted, -50, 50))
        probabilities /= probabilities.sum()
        losses.append(-math.log(max(EPSILON, float(probabilities[chosen]))))
    return {
        "decisions": len(groups),
        "top1": float(np.mean(np.asarray(ranks) <= 1)),
        "top3": float(np.mean(np.asarray(ranks) <= 3)),
        "mrr": float(np.mean(1 / np.asarray(ranks))),
        "candidateNll": float(np.mean(losses)),
    }


def heuristic_scores(decisions: list[dict[str, Any]]) -> list[float]:
    scores: list[float] = []
    for decision in decisions:
        for order, candidate in enumerate(decision["candidates"]):
            if candidate["kind"] != "move":
                value = -10.0
            else:
                actor = active_mon(decision["observation"], decision["actorSlot"])
                move = next(
                    (move for move in actor["moves"] if move["slot"] == candidate["moveSlot"]),
                    {"category": 2},
                )
                value = -1.0 if move["category"] == 2 else float(candidate.get("baseTypeMultiplier", 1))
            scores.append(value - order * 1e-9)
    return scores


def evaluate_named_scores(
    decisions: list[dict[str, Any]], scores: list[float]
) -> dict[str, float]:
    labels: list[int] = []
    decision_ids: list[str] = []
    for decision in decisions:
        for candidate in decision["candidates"]:
            labels.append(int(candidate["id"] == decision["chosenCandidateId"]))
            decision_ids.append(decision["decisionId"])
    if len(scores) != len(labels):
        raise ValueError("named score count does not match candidate row count")
    return ranking_metrics(np.asarray(scores), np.asarray(labels), decision_ids)


def load_generation_metrics(path: Path) -> dict[str, float | int]:
    results: list[dict[str, Any]] = []
    for file in sorted(path.rglob("result-*.json")) if path.is_dir() else []:
        results.append(json.loads(file.read_text(encoding="utf-8")))
    total_ms = sum(int(result.get("totalMs", 0)) for result in results)
    episodes: list[dict[str, Any]] = []
    for result in results:
        batch_results = result.get("results")
        if isinstance(batch_results, list):
            episodes.extend(entry for entry in batch_results if isinstance(entry, dict))
            continue
        # Compatibility with the original full-run result shape, where each wave
        # represented one independently recorded combat episode.
        waves = result.get("waves")
        if isinstance(waves, list):
            episodes.extend(entry for entry in waves if isinstance(entry, dict))

    total_episodes = len(episodes)
    total_turns = sum(int(episode.get("turns", 0)) for episode in episodes)
    total_combat_ms = sum(int(episode.get("combatMs", 0)) for episode in episodes)
    boot_samples = [int(episode.get("bootMs", 0)) for episode in episodes if "bootMs" in episode]
    if not boot_samples:
        boot_samples = [int(result.get("bootMs", 0)) for result in results if "bootMs" in result]
    return {
        "shards": len(results),
        "episodes": total_episodes,
        "turns": total_turns,
        "runnerComputeSeconds": total_ms / 1000,
        "parallelEngineWallSeconds": max((int(result.get("totalMs", 0)) for result in results), default=0) / 1000,
        "meanRunnerMsPerEpisode": total_ms / max(1, total_episodes),
        "meanCombatMsPerEpisode": total_combat_ms / max(1, total_episodes),
        "meanTurnsPerEpisode": total_turns / max(1, total_episodes),
        "meanBootMs": float(np.mean(boot_samples)) if boot_samples else 0.0,
    }


def leaf_node(value: float) -> dict[str, Any]:
    return {"feature": -1, "threshold": 0.0, "left": -1, "right": -1, "value": float(value)}


def hist_gradient_artifact(name: str, model: HistGradientBoostingClassifier, feature_count: int) -> dict[str, Any]:
    trees: list[list[dict[str, Any]]] = []
    for iteration in model._predictors:  # sklearn has no public neutral tree export for HGB.
        source = iteration[0].nodes
        nodes: list[dict[str, Any]] = []
        for node in source:
            if bool(node["is_leaf"]):
                nodes.append(leaf_node(float(node["value"])))
            else:
                if bool(node["is_categorical"]):
                    raise ValueError("categorical HGB splits are unsupported by the neutral runtime")
                nodes.append(
                    {
                        "feature": int(node["feature_idx"]),
                        "threshold": float(node["num_threshold"]),
                        "left": int(node["left"]),
                        "right": int(node["right"]),
                        "defaultLeft": bool(node["missing_go_to_left"]),
                    }
                )
        trees.append(nodes)
    return {
        "schemaVersion": 1,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "featureCount": feature_count,
        "modelName": name,
        "modelType": "sklearn_hist_gradient_boosting",
        "aggregation": "sum_logit",
        "baseScore": float(np.ravel(model._baseline_prediction)[0]),
        "trees": trees,
    }


def lightgbm_artifact(
    name: str,
    model: Any,
    feature_count: int,
    aggregation: str = "sum_logit",
) -> dict[str, Any]:
    dumped = model.booster_.dump_model()
    trees: list[list[dict[str, Any]]] = []

    def flatten(source: dict[str, Any], nodes: list[dict[str, Any]]) -> int:
        index = len(nodes)
        nodes.append(leaf_node(0.0))
        if "leaf_value" in source:
            nodes[index] = leaf_node(float(source["leaf_value"]))
            return index
        if source.get("decision_type") not in ("<=", "<"):
            raise ValueError(f"unsupported LightGBM decision type {source.get('decision_type')}")
        left = flatten(source["left_child"], nodes)
        right = flatten(source["right_child"], nodes)
        nodes[index] = {
            "feature": int(source["split_feature"]),
            "threshold": float(source["threshold"]),
            "left": left,
            "right": right,
            "defaultLeft": bool(source.get("default_left", True)),
        }
        return index

    for tree in dumped["tree_info"]:
        nodes: list[dict[str, Any]] = []
        flatten(tree["tree_structure"], nodes)
        trees.append(nodes)
    return {
        "schemaVersion": 1,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "featureCount": feature_count,
        "modelName": name,
        "modelType": "lightgbm",
        "aggregation": aggregation,
        "baseScore": 0.0,
        "trees": trees,
    }


def export_tree_artifact(name: str, model: Any, feature_count: int) -> dict[str, Any] | None:
    if isinstance(model, (RandomForestClassifier, ExtraTreesClassifier)):
        # Keep these as CPU baselines. Their literal JSON exports are hundreds of
        # megabytes and made every runner download the same non-selected models.
        return None
    if isinstance(model, HistGradientBoostingClassifier):
        return hist_gradient_artifact(name, model, feature_count)
    if LGBMRanker is not None and isinstance(model, LGBMRanker):
        return lightgbm_artifact(name, model, feature_count, "sum_raw")
    if LGBMClassifier is not None and isinstance(model, LGBMClassifier):
        return lightgbm_artifact(name, model, feature_count)
    return None


def artifact_scores(artifact: dict[str, Any], x: np.ndarray) -> np.ndarray:
    if artifact.get("schemaVersion") == 2:
        members = artifact["members"]
        member_scores = np.column_stack([artifact_scores(member, x) for member in members])
        means = np.asarray(artifact["memberMeans"], dtype=np.float64)
        scales = np.asarray(artifact["memberScales"], dtype=np.float64)
        weights = np.asarray(artifact["weights"], dtype=np.float64)
        return float(artifact["intercept"]) + ((member_scores - means) / scales) @ weights

    def tree_score(nodes: list[dict[str, Any]], row: np.ndarray) -> float:
        index = 0
        for _ in range(len(nodes) + 1):
            node = nodes[index]
            if "value" in node:
                return float(node["value"])
            value = float(row[node["feature"]])
            go_left = node.get("defaultLeft", True) if math.isnan(value) else value <= node["threshold"]
            index = node["left"] if go_left else node["right"]
        raise ValueError("neutral tree traversal exceeded node count")

    result = []
    for row in x:
        values = [tree_score(tree, row) for tree in artifact["trees"]]
        if artifact["aggregation"] == "mean":
            result.append(float(np.mean(values)))
        elif artifact["aggregation"] == "sum_logit":
            raw = artifact["baseScore"] + sum(values)
            result.append(1.0 / (1.0 + math.exp(-max(-50.0, min(50.0, raw)))))
        else:
            result.append(artifact["baseScore"] + sum(values))
    return np.asarray(result)


def fit_stacked_tree_ensemble(
    fitted_models: dict[str, tuple[Any, bool]],
    artifacts: dict[str, dict[str, Any]],
    x: np.ndarray,
    y: np.ndarray,
    decision_ids: list[str],
    source_partition_ids: list[str],
    train_mask: np.ndarray,
    test_mask: np.ndarray,
    weights: np.ndarray,
    model_name: str = "stacked_tree_ensemble",
) -> tuple[dict[str, Any], np.ndarray, float, list[str]] | None:
    member_names = sorted(name for name in fitted_models if name in artifacts)
    if len(member_names) < 2:
        return None

    positive_weight_mask = train_mask & (weights > 0)
    train_indices = np.flatnonzero(positive_weight_mask)
    if len(train_indices) == 0 or len(np.unique(y[train_indices])) < 2:
        return None
    train_partitions = np.asarray(source_partition_ids, dtype=object)[positive_weight_mask]
    fold_count = min(5, len(set(train_partitions)))
    if fold_count < 2:
        return None
    out_of_fold = np.zeros((len(train_indices), len(member_names)), dtype=np.float64)
    started = time.perf_counter()
    for fold_train, fold_validation in GroupKFold(n_splits=fold_count).split(
        train_indices,
        y[train_indices],
        groups=train_partitions,
    ):
        source_indices = train_indices[fold_train]
        validation_indices = train_indices[fold_validation]
        if len(np.unique(y[source_indices])) < 2:
            return None
        for member_index, name in enumerate(member_names):
            template, ranker = fitted_models[name]
            model = clone(template)
            if ranker:
                fold_decision_ids = [decision_ids[index] for index in source_indices]
                model.fit(
                    x[source_indices],
                    y[source_indices],
                    group=ordered_group_sizes(fold_decision_ids),
                    sample_weight=weights[source_indices],
                )
                scores = model.predict(x[validation_indices])
            else:
                model.fit(x[source_indices], y[source_indices], sample_weight=weights[source_indices])
                scores = model.predict_proba(x[validation_indices])[:, 1]
            out_of_fold[fold_validation, member_index] = scores

    scaler = StandardScaler().fit(out_of_fold)
    meta_model = LogisticRegression(max_iter=1000, random_state=0).fit(
        scaler.transform(out_of_fold),
        y[train_indices],
        sample_weight=weights[train_indices],
    )
    test_member_scores = np.column_stack([artifact_scores(artifacts[name], x[test_mask]) for name in member_names])
    test_scores = meta_model.decision_function(scaler.transform(test_member_scores))
    artifact = {
        "schemaVersion": 2,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "featureCount": int(x.shape[1]),
        "modelName": model_name,
        "modelType": "stacked_tree_ensemble",
        "members": [artifacts[name] for name in member_names],
        "memberMeans": scaler.mean_.tolist(),
        "memberScales": scaler.scale_.tolist(),
        "weights": meta_model.coef_[0].tolist(),
        "intercept": float(meta_model.intercept_[0]),
    }
    neutral_scores = artifact_scores(artifact, x[test_mask])
    parity_error = float(np.max(np.abs(test_scores - neutral_scores)))
    if parity_error > 1e-5:
        raise ValueError(f"stacked tree neutral artifact parity error {parity_error}")
    return artifact, test_scores, time.perf_counter() - started, member_names


def model_specs(seed: int) -> list[tuple[str, Any, bool, bool]]:
    load_optional_lightgbm()
    specs = [
        ("logistic", LogisticRegression(max_iter=1000, class_weight=None, random_state=seed), True, False),
        (
            "random_forest",
            RandomForestClassifier(n_estimators=250, min_samples_leaf=2, n_jobs=-1, random_state=seed),
            False,
            False,
        ),
        (
            "extra_trees",
            ExtraTreesClassifier(n_estimators=250, min_samples_leaf=2, n_jobs=-1, random_state=seed),
            False,
            False,
        ),
        ("hist_gradient_boosting", HistGradientBoostingClassifier(max_iter=200, random_state=seed), False, False),
    ]
    if LGBMClassifier is not None:
        specs.append(
            (
                "lightgbm",
                LGBMClassifier(
                    n_estimators=250,
                    learning_rate=0.04,
                    num_leaves=31,
                    n_jobs=-1,
                    random_state=seed,
                    verbosity=-1,
                ),
                False,
                False,
            )
        )
        specs.append(
            (
                "lightgbm_lambdarank",
                LGBMRanker(
                    objective="lambdarank",
                    n_estimators=300,
                    learning_rate=0.04,
                    num_leaves=31,
                    min_child_samples=20,
                    n_jobs=-1,
                    random_state=seed,
                    verbosity=-1,
                ),
                False,
                True,
            )
        )
    return specs


def outcome_weighted_model_specs(seed: int) -> list[tuple[str, Any]]:
    load_optional_lightgbm()
    specs: list[tuple[str, Any]] = [
        (
            "hist_gradient_boosting",
            HistGradientBoostingClassifier(max_iter=250, random_state=seed),
        )
    ]
    if LGBMClassifier is not None:
        specs.append(
            (
                "lightgbm",
                LGBMClassifier(
                    n_estimators=300,
                    learning_rate=0.04,
                    num_leaves=31,
                    n_jobs=-1,
                    random_state=seed,
                    verbosity=-1,
                ),
            )
        )
    return specs


def train(args: argparse.Namespace) -> dict[str, Any]:
    global SCHEMA_VERSION, FEATURE_SCHEMA_VERSION
    if not 0.0 <= args.loss_episode_weight <= 1.0:
        raise ValueError("loss episode weight must be between 0 and 1")
    if args.winner_only_policy and args.loss_episode_weight != 0:
        raise ValueError("winner-only policy training requires --loss-episode-weight 0")
    if args.max_policy_decisions is not None and not args.winner_only_policy:
        raise ValueError("--max-policy-decisions requires --winner-only-policy")
    if args.battle_type is not None and not args.winner_only_policy:
        raise ValueError("--battle-type requires --winner-only-policy")
    if args.winner_scope != "run" and not args.winner_only_policy:
        raise ValueError("--winner-scope requires --winner-only-policy")
    if args.behavior_cloning_only and args.winner_only_policy:
        raise ValueError("behavior-cloning-only and winner-only policy modes are mutually exclusive")
    winner_only_selection: dict[str, int | str | None] | None = None
    if args.winner_only_policy:
        all_decisions, terminals, winner_only_selection = load_winner_policy_records(
            args.data,
            args.max_policy_decisions,
            args.winner_scope,
            args.battle_type,
        )
    else:
        all_decisions, terminals = load_records(args.data, require_terminals=not args.behavior_cloning_only)
    SCHEMA_VERSION, FEATURE_SCHEMA_VERSION = dataset_schema_versions(all_decisions)
    dictionary_coverage = validate_data_dictionary(
        args.dictionary,
        all_decisions,
        args.dictionary_supplement,
    )
    rollout_decisions, rollout_selection = (
        select_elite_rollouts(all_decisions, terminals)
        if args.elite_rollouts
        else (
            all_decisions,
            {
                "episodes": 0,
                "successfulEpisodes": 0,
                "successRate": None,
                "decisionsBeforeSelection": len(all_decisions),
                "decisionsAfterSelection": len(all_decisions),
            },
        )
    )
    decisions, policy_decisions, diagnostic_only = select_training_decisions(
        rollout_decisions,
        bool(getattr(args, "diagnostic_source_imitation", False)),
    )
    decision_report = {
        "decisions": len(decisions),
        "inputDecisions": len(all_decisions),
        "excludedPolicyDecisions": len(rollout_decisions) - len(policy_decisions),
        "diagnosticSourceDecisions": len(decisions) if diagnostic_only else 0,
        "sourcePolicies": Counter(record_policy_source(record) for record in all_decisions),
        "policyTargetSources": Counter(record_policy_source(record) for record in policy_decisions),
        "diagnosticSourcePolicies": (
            Counter(record_policy_source(record) for record in decisions) if diagnostic_only else Counter()
        ),
        "formats": Counter(record["observation"]["format"] for record in decisions),
    }
    hashes = {
        key: sorted({record[key] for record in decisions})
        for key in ("buildSha", "dexHash", "dictionaryHash")
    }
    x, y, decision_ids, episodes, split_group_ids, source_partition_ids, candidate_counts = make_rows(decisions)
    train_partitions, test_partitions = split_groups(source_partition_ids, args.seed)
    train_mask = np.asarray([partition in train_partitions for partition in source_partition_ids])
    test_mask = np.asarray([partition in test_partitions for partition in source_partition_ids])
    train_episodes = {episode for episode, selected in zip(episodes, train_mask) if selected}
    test_episodes = {episode for episode, selected in zip(episodes, test_mask) if selected}
    weights = row_weights(y, decision_ids)
    terminal_by_episode = {terminal["episodeId"]: terminal for terminal in terminals}
    successful_rows = (
        np.ones(len(episodes), dtype=bool)
        if args.winner_only_policy
        else np.asarray(
            [
                terminal_by_episode.get(episode, {}).get("outcome") in SUCCESSFUL_ROLLOUT_OUTCOMES
                for episode in episodes
            ]
        )
    )
    outcome_weights = np.asarray(
        [
            1.0 if successful else (args.loss_episode_weight if episode in terminal_by_episode else 0.0)
            for episode, successful in zip(episodes, successful_rows)
        ],
        dtype=np.float64,
    )
    scaler = StandardScaler().fit(x[train_mask])

    test_decisions = [decision for decision in decisions if decision["episodeId"] in test_episodes]
    random_metrics = {
        "decisions": len(test_decisions),
        "top1": float(np.mean([1 / len(row["candidates"]) for row in test_decisions])),
        "top3": float(np.mean([min(3, len(row["candidates"])) / len(row["candidates"]) for row in test_decisions])),
        "mrr": float(
            np.mean([sum(1 / rank for rank in range(1, len(row["candidates"]) + 1)) / len(row["candidates"]) for row in test_decisions])
        ),
        "candidateNll": float(np.mean([math.log(len(row["candidates"])) for row in test_decisions])),
    }
    leaderboard: list[dict[str, Any]] = [
        {"model": "random_legal_expected", **random_metrics, "trainSeconds": 0.0, "modelBytes": 0},
        {
            "model": "smart_default_heuristic",
            **evaluate_named_scores(test_decisions, heuristic_scores(test_decisions)),
            "trainSeconds": 0.0,
            "modelBytes": 0,
        },
    ]
    del test_decisions, decisions, policy_decisions, rollout_decisions, all_decisions
    gc.collect()
    artifacts: dict[str, dict[str, Any]] = {}
    fitted_models: dict[str, tuple[Any, bool]] = {}
    for name, model, scale, ranker in model_specs(args.seed):
        train_x = scaler.transform(x[train_mask]) if scale else x[train_mask]
        test_x = scaler.transform(x[test_mask]) if scale else x[test_mask]
        started = time.perf_counter()
        if ranker:
            train_decision_ids = [
                decision_id for decision_id, selected in zip(decision_ids, train_mask) if selected
            ]
            model.fit(
                train_x,
                y[train_mask],
                group=ordered_group_sizes(train_decision_ids),
                sample_weight=weights[train_mask],
            )
        else:
            model.fit(train_x, y[train_mask], sample_weight=weights[train_mask])
        train_seconds = time.perf_counter() - started
        infer_started = time.perf_counter()
        scores = model.predict(test_x) if ranker else model.predict_proba(test_x)[:, 1]
        infer_seconds = time.perf_counter() - infer_started
        metrics = ranking_metrics(
            scores,
            y[test_mask],
            [decision_id for decision_id, selected in zip(decision_ids, test_mask) if selected],
        )
        artifact = export_tree_artifact(name, model, x.shape[1])
        parity_error = None
        if artifact is not None:
            neutral_scores = artifact_scores(artifact, x[test_mask])
            parity_error = float(np.max(np.abs(scores - neutral_scores)))
            if parity_error > 1e-5:
                raise ValueError(f"{name} neutral artifact parity error {parity_error}")
            artifacts[name] = artifact
            if scale:
                raise ValueError(f"deployable ensemble member {name} unexpectedly requires feature scaling")
            fitted_models[name] = (model, ranker)
        leaderboard.append(
            {
                "model": name,
                **metrics,
                "trainSeconds": train_seconds,
                "inferenceMsPerDecision": 1000 * infer_seconds / max(1, metrics["decisions"]),
                "modelBytes": len(pickle.dumps({"model": model, "scaler": scaler if scale else None})),
                "neutralArtifactMaxError": parity_error,
            }
        )

    stack = fit_stacked_tree_ensemble(
        fitted_models,
        artifacts,
        x,
        y,
        decision_ids,
        source_partition_ids,
        train_mask,
        test_mask,
        weights,
    )
    if stack is not None:
        artifact, scores, train_seconds, members = stack
        infer_started = time.perf_counter()
        neutral_scores = artifact_scores(artifact, x[test_mask])
        infer_seconds = time.perf_counter() - infer_started
        metrics = ranking_metrics(
            scores,
            y[test_mask],
            [decision_id for decision_id, selected in zip(decision_ids, test_mask) if selected],
        )
        parity_error = float(np.max(np.abs(scores - neutral_scores)))
        artifacts["stacked_tree_ensemble"] = artifact
        leaderboard.append(
            {
                "model": "stacked_tree_ensemble",
                **metrics,
                "members": members,
                "trainingObjective": "group-fold out-of-fold logistic stacking",
                "trainSeconds": train_seconds,
                "inferenceMsPerDecision": 1000 * infer_seconds / max(1, metrics["decisions"]),
                "modelBytes": len(json.dumps(artifact, separators=(",", ":")).encode("utf-8")),
                "neutralArtifactMaxError": parity_error,
            }
        )

    successful_test_mask = test_mask & successful_rows
    outcome_artifacts: dict[str, dict[str, Any]] = {}
    outcome_fitted_models: dict[str, tuple[Any, bool]] = {}
    policy_training_mask = (
        np.zeros_like(train_mask, dtype=bool)
        if diagnostic_only or args.behavior_cloning_only
        else train_mask & (outcome_weights > 0)
    )
    policy_training_partitions = {
        partition
        for partition, selected in zip(source_partition_ids, policy_training_mask)
        if selected
    }
    policy_training_reason: str | None = None
    if args.winner_only_policy:
        outcome_artifacts = dict(artifacts)
        winner_scope_label = f"{args.winner_scope}-victory-only"
        for row in leaderboard:
            if row["model"] not in outcome_artifacts:
                continue
            row["successfulEpisodeMetrics"] = {
                key: row[key]
                for key in ("decisions", "top1", "top3", "mrr", "candidateNll")
            }
            row["trainingObjective"] = (
                f"{winner_scope_label} behavior cloning; non-winning decisions excluded before fitting"
            )
    elif args.behavior_cloning_only:
        policy_training_reason = "behavior-cloning-only mode does not fit an outcome-weighted selector"
    elif diagnostic_only:
        policy_training_reason = "diagnostic source imitation cannot produce a trainable policy artifact"
    elif not policy_training_mask.any():
        policy_training_reason = "no successful policy-training rows are present in the training split"
    elif len(np.unique(y[policy_training_mask])) < 2:
        policy_training_reason = "successful policy-training rows do not contain both selected and rejected candidates"
    else:
        policy_prefix = "winner_only" if args.loss_episode_weight == 0 else "outcome_weighted"
        for base_name, model in outcome_weighted_model_specs(args.seed):
            name = f"{policy_prefix}_{base_name}"
            started = time.perf_counter()
            policy_weights = weights[policy_training_mask] * outcome_weights[policy_training_mask]
            model.fit(x[policy_training_mask], y[policy_training_mask], sample_weight=policy_weights)
            train_seconds = time.perf_counter() - started
            infer_started = time.perf_counter()
            scores = model.predict_proba(x[test_mask])[:, 1]
            infer_seconds = time.perf_counter() - infer_started
            metrics = ranking_metrics(
                scores,
                y[test_mask],
                [decision_id for decision_id, selected in zip(decision_ids, test_mask) if selected],
            )
            successful_metrics = (
                ranking_metrics(
                    model.predict_proba(x[successful_test_mask])[:, 1],
                    y[successful_test_mask],
                    [decision_id for decision_id, selected in zip(decision_ids, successful_test_mask) if selected],
                )
                if successful_test_mask.any()
                else None
            )
            artifact = export_tree_artifact(name, model, x.shape[1])
            if artifact is None:
                raise ValueError(f"{name} cannot be exported to the neutral runtime")
            neutral_scores = artifact_scores(artifact, x[test_mask])
            parity_error = float(np.max(np.abs(scores - neutral_scores)))
            if parity_error > 1e-5:
                raise ValueError(f"{name} neutral artifact parity error {parity_error}")
            artifacts[name] = artifact
            outcome_artifacts[name] = artifact
            outcome_fitted_models[name] = (model, False)
            leaderboard.append(
                {
                    "model": name,
                    **metrics,
                    "successfulEpisodeMetrics": successful_metrics,
                    "trainingObjective": (
                        "winner-only behavior cloning; losses excluded from policy fitting"
                        if args.loss_episode_weight == 0
                        else f"loss episodes weighted {args.loss_episode_weight}"
                    ),
                    "trainSeconds": train_seconds,
                    "inferenceMsPerDecision": 1000 * infer_seconds / max(1, metrics["decisions"]),
                    "modelBytes": len(pickle.dumps({"model": model, "scaler": None})),
                    "neutralArtifactMaxError": parity_error,
                }
            )

    stack_name = (
        "winner_only_stacked_tree_ensemble"
        if args.loss_episode_weight == 0
        else "outcome_weighted_stacked_tree_ensemble"
    )
    outcome_stack = fit_stacked_tree_ensemble(
        outcome_fitted_models,
        outcome_artifacts,
        x,
        y,
        decision_ids,
        source_partition_ids,
        train_mask,
        test_mask,
        weights * outcome_weights,
        stack_name,
    )
    if outcome_stack is not None:
        artifact, scores, train_seconds, members = outcome_stack
        infer_started = time.perf_counter()
        neutral_scores = artifact_scores(artifact, x[test_mask])
        infer_seconds = time.perf_counter() - infer_started
        parity_error = float(np.max(np.abs(scores - neutral_scores)))
        metrics = ranking_metrics(
            scores,
            y[test_mask],
            [decision_id for decision_id, selected in zip(decision_ids, test_mask) if selected],
        )
        successful_metrics = (
            ranking_metrics(
                artifact_scores(artifact, x[successful_test_mask]),
                y[successful_test_mask],
                [decision_id for decision_id, selected in zip(decision_ids, successful_test_mask) if selected],
            )
            if successful_test_mask.any()
            else None
        )
        artifacts[stack_name] = artifact
        outcome_artifacts[stack_name] = artifact
        leaderboard.append(
            {
                "model": stack_name,
                **metrics,
                "successfulEpisodeMetrics": successful_metrics,
                "members": members,
                "trainingObjective": (
                    "winner-only group-fold out-of-fold logistic stacking"
                    if args.loss_episode_weight == 0
                    else f"group-fold stacking with loss episodes weighted {args.loss_episode_weight}"
                ),
                "trainSeconds": train_seconds,
                "inferenceMsPerDecision": 1000 * infer_seconds / max(1, metrics["decisions"]),
                "modelBytes": len(json.dumps(artifact, separators=(",", ":")).encode("utf-8")),
                "neutralArtifactMaxError": parity_error,
            }
        )

    training_role = "diagnostic-imitation" if diagnostic_only else "policy-target"
    for artifact in artifacts.values():
        artifact["trainingRole"] = training_role

    learned_rows = [
        row for row in leaderboard if row["model"] in artifacts and row["model"] not in outcome_artifacts
    ]
    selected = (
        sorted(learned_rows, key=lambda row: (-row["top1"], row["candidateNll"], row["model"]))[0]["model"]
        if learned_rows
        else None
    )
    outcome_rows = [row for row in leaderboard if row["model"] in outcome_artifacts]
    outcome_selected = (
        sorted(
            outcome_rows,
            key=lambda row: (
                -(row["successfulEpisodeMetrics"] or row)["top1"],
                (row["successfulEpisodeMetrics"] or row)["candidateNll"],
                row["model"],
            ),
        )[0]["model"]
        if outcome_rows and successful_test_mask.any()
        else None
    )
    if outcome_rows and not successful_test_mask.any():
        policy_training_reason = "no successful policy-evaluation rows are present in the held-out split"
    if selected is None:
        selected = outcome_selected
    if selected is None:
        raise ValueError("training did not produce a selectable tree policy")
    if args.models_dir is not None:
        args.models_dir.mkdir(parents=True, exist_ok=True)
        for name, artifact in artifacts.items():
            (args.models_dir / f"{name}.json").write_text(json.dumps(artifact, separators=(",", ":")) + "\n", encoding="utf-8")
        (args.models_dir / "selected-model.json").write_text(
            json.dumps(artifacts[selected], separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        if outcome_selected is not None:
            (args.models_dir / "outcome-selected-model.json").write_text(
                json.dumps(outcome_artifacts[outcome_selected], separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
        elif (args.models_dir / "outcome-selected-model.json").exists():
            (args.models_dir / "outcome-selected-model.json").unlink()

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "metricScope": "offline imitation of the recorded source policy; not battle win rate",
        "trainingRole": training_role,
        "selectedBattlePolicy": selected,
        "selectedOutcomeWeightedPolicy": outcome_selected,
        "selectedPolicyFromSuccessfulEpisodes": outcome_selected,
        "selectedWinnerScopedPolicy": outcome_selected,
        "winnerOnlyScope": args.winner_scope if args.winner_only_policy else None,
        "lossEpisodeWeight": args.loss_episode_weight,
        "policyTraining": {
            "available": outcome_selected is not None,
            "reason": policy_training_reason,
            "selectionScope": args.winner_scope if args.winner_only_policy else "run-outcome-weighted",
            "candidateRows": int(policy_training_mask.sum()),
            "sourcePartitions": sorted(policy_training_partitions),
            "successfulTestRows": int(successful_test_mask.sum()),
            "selectedScopeTestRows": int(successful_test_mask.sum()),
        },
        "seed": args.seed,
        "data": {
            "decisions": decision_report["decisions"],
            "candidateRows": len(y),
            "episodes": len(set(episodes)),
            "successfulEpisodes": len({episode for episode, successful in zip(episodes, successful_rows) if successful}),
            "trainEpisodes": sorted(train_episodes),
            "testEpisodes": sorted(test_episodes),
            "trainSourcePartitions": sorted(train_partitions),
            "testSourcePartitions": sorted(test_partitions),
            "trainSplitGroups": sorted({group for group, selected in zip(split_group_ids, train_mask) if selected}),
            "testSplitGroups": sorted({group for group, selected in zip(split_group_ids, test_mask) if selected}),
            "meanCandidates": float(np.mean(candidate_counts)),
            "p95Candidates": float(np.percentile(candidate_counts, 95)),
            "inputDecisions": decision_report["inputDecisions"],
            "excludedPolicyDecisions": decision_report["excludedPolicyDecisions"],
            "diagnosticSourceDecisions": decision_report["diagnosticSourceDecisions"],
            "sourcePolicies": decision_report["sourcePolicies"],
            "policyTargetSources": decision_report["policyTargetSources"],
            "diagnosticSourcePolicies": decision_report["diagnosticSourcePolicies"],
            "formats": decision_report["formats"],
            "terminalOutcomes": Counter(record["outcome"] for record in terminals),
            "winnerOnlySelection": winner_only_selection,
            "identity": hashes,
            "dictionaryCoverage": dictionary_coverage,
        },
        "generation": load_generation_metrics(args.data),
        "rolloutSelection": rollout_selection,
        "leaderboard": sorted(leaderboard, key=lambda row: (-row["top1"], row["candidateNll"])),
    }
    return json.loads(json.dumps(report))


def markdown(report: dict[str, Any]) -> str:
    lines = [
        "# ER combat candidate baseline",
        "",
        "> These are offline imitation metrics against the recorded source policy, not battle win rates.",
        "> A model must still pass a fixed-seed real-engine gauntlet before any gameplay comparison.",
        (
            "> Diagnostic-only source imitation: these artifacts are baseline controllers and are forbidden policy teachers."
            if report["trainingRole"] == "diagnostic-imitation"
            else "> Policy fitting used only explicitly eligible policy-target records."
        ),
        "",
        f"Decisions: {report['data']['decisions']} across {report['data']['episodes']} episodes; "
        f"mean candidates: {report['data']['meanCandidates']:.2f}.",
        f"Generation: {report['generation']['shards']} runner shards, "
        f"{report['generation']['episodes']} battle episodes, "
        f"{report['generation']['meanRunnerMsPerEpisode']:.0f} runner ms/episode, "
        f"{report['generation']['meanCombatMsPerEpisode']:.0f} combat ms/episode.",
        (
            f"Exploratory rollouts: {report['rolloutSelection']['successfulEpisodes']}/"
            f"{report['rolloutSelection']['episodes']} reached their requested horizon; "
            f"{report['rolloutSelection']['decisionsAfterSelection']}/"
            f"{report['rolloutSelection']['decisionsBeforeSelection']} decisions retained."
        ),
        "",
        "| Model | Top-1 | Top-3 | MRR | Candidate NLL | Train s | ms/decision | Size KiB |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in report["leaderboard"]:
        lines.append(
            f"| {row['model']} | {row['top1']:.3f} | {row['top3']:.3f} | {row['mrr']:.3f} | "
            f"{row['candidateNll']:.3f} | {row['trainSeconds']:.2f} | "
            f"{row.get('inferenceMsPerDecision', 0):.3f} | {row['modelBytes'] / 1024:.1f} |"
        )
    outcome_rows = [row for row in report["leaderboard"] if row.get("successfulEpisodeMetrics")]
    if report["policyTraining"]["available"]:
        selection_label = (
            "Battle-victory"
            if report.get("winnerOnlyScope") == "battle"
            else "Successful-episode"
        )
        lines.extend(
            [
                "",
                f"{selection_label} policy selector: `{report['selectedWinnerScopedPolicy']}`. "
                f"Loss-episode decisions carry {report['lossEpisodeWeight']:.2f}x training weight.",
                "",
                f"| Policy model | {selection_label} Top-1 | {selection_label} NLL |",
                "| --- | ---: | ---: |",
            ]
        )
        for row in outcome_rows:
            metrics = row["successfulEpisodeMetrics"]
            lines.append(f"| {row['model']} | {metrics['top1']:.3f} | {metrics['candidateNll']:.3f} |")
    else:
        lines.extend(
            [
                "",
                f"Successful-episode policy unavailable: {report['policyTraining']['reason']}.",
            ]
        )
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path, required=True)
    parser.add_argument(
        "--dictionary-supplement",
        type=Path,
        help="hash-bound additions for runtime-generated ids omitted by a captured dictionary",
    )
    parser.add_argument("--report-json", type=Path, required=True)
    parser.add_argument("--report-md", type=Path, required=True)
    parser.add_argument("--models-dir", type=Path)
    parser.add_argument(
        "--behavior-cloning-only",
        action="store_true",
        help="fit all eligible human policy targets without requiring or inferring a run terminal",
    )
    parser.add_argument(
        "--elite-rollouts",
        action="store_true",
        help="retain epsilon-tree decisions only from episodes that reached their requested horizon",
    )
    parser.add_argument("--seed", type=int, default=20260728)
    parser.add_argument(
        "--loss-episode-weight",
        type=float,
        default=0.0,
        help="policy sample weight for losing episodes; zero keeps losses value/diagnostic-only",
    )
    parser.add_argument(
        "--winner-only-policy",
        action="store_true",
        help="stream-select victorious policy targets before fitting and train each tree family only once",
    )
    parser.add_argument(
        "--winner-scope",
        choices=("run", "battle"),
        default="run",
        help="victory boundary used by --winner-only-policy; defaults to completed-run victories",
    )
    parser.add_argument(
        "--max-policy-decisions",
        type=int,
        help="deterministic cap for winner-only CPU fitting; all source data remains available to neural training",
    )
    parser.add_argument(
        "--battle-type",
        type=int,
        choices=(0, 1, 3),
        help="optional BattleType filter for winner-only policy fitting (0 wild, 1 trainer, 3 mystery encounter)",
    )
    parser.add_argument(
        "--diagnostic-source-imitation",
        action="store_true",
        help="when no policy targets exist, train baseline-only artifacts from excluded sources without producing policy artifacts",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = train(args)
    args.report_json.parent.mkdir(parents=True, exist_ok=True)
    args.report_md.parent.mkdir(parents=True, exist_ok=True)
    args.report_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.report_md.write_text(markdown(report), encoding="utf-8")
    print(markdown(report))


if __name__ == "__main__":
    main()
