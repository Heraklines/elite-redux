"""Compare actual old/new checkpoint preimages on the runner; bounded metadata only."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAIRS = Path(os.environ["RUNNER_TEMP"]) / "m9e-cost-pairs"
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-cost-comparison"


def need(value, message):
    if not value:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def changes(left, right, path, result):
    if type(left) is type(right) and left == right:
        return
    if isinstance(left, dict) and isinstance(right, dict) and left.keys() == right.keys():
        for key in sorted(left):
            changes(left[key], right[key], path + "/" + key.replace("~", "~0").replace("/", "~1"), result)
    elif isinstance(left, list) and isinstance(right, list) and len(left) == len(right):
        for index, (old, new) in enumerate(zip(left, right, strict=True)):
            changes(old, new, path + "/" + str(index), result)
    else:
        old, new = canonical(left), canonical(right)
        result.append(dict(path=path, old_type=type(left).__name__, new_type=type(right).__name__,
                           old_bytes=len(old), new_bytes=len(new), old_sha256=sha(old), new_sha256=sha(new)))
        need(len(result) <= 128, "bounded complete difference list")


def main():
    inputs = json.loads((ROOT / "scripts/ci/m9e_cost_snapshot_inputs.json").read_bytes())
    summaries = {}
    summary_facts = {}
    for cohort in inputs["cohorts"]:
        name = cohort["name"]
        raw = (PAIRS / (name + "-summary") / "summary.json").read_bytes()
        need(0 < len(raw) <= 16384, "bounded cohort summary")
        summary = json.loads(raw)
        need(summary["status"] == "passed" and summary["cohort"] == name
             and summary["cohort_sha"] == cohort["source_sha"]
             and summary["source_sha"] == os.environ["GITHUB_SHA"]
             and summary["run_id"] == os.environ["GITHUB_RUN_ID"]
             and summary["run_attempt"] == os.environ["GITHUB_RUN_ATTEMPT"]
             and summary["tests"] == dict(passed=1, failed=0, skipped=0), "same-run successful whole cohorts")
        summaries[name] = summary
        summary_facts[name] = dict(bytes=len(raw), sha256=sha(raw), cohort_sha=cohort["source_sha"])
    records = []
    for checkpoint in ("title", "mode", "starter", "active"):
        documents = {}
        facts = {}
        for name in ("old", "new"):
            expected = summaries[name]["snapshots"][checkpoint]
            path = PAIRS / (name + "-packet") / (checkpoint + ".json")
            need(path.is_file() and not path.is_symlink() and path.stat().st_size == expected["bytes"], "actual snapshot bytes")
            raw = path.read_bytes()
            need(sha(raw) == expected["sha256"], "actual snapshot source hash")
            value = json.loads(raw)
            need(canonical(value) == raw, "exact canonical checkpoint")
            documents[name], facts[name] = value, expected
        differences = []
        changes(documents["old"], documents["new"], "", differences)
        records.append(dict(checkpoint=checkpoint, files=facts, differences=differences))
    report = dict(status="observed", source_sha=os.environ["GITHUB_SHA"], run_id=os.environ["GITHUB_RUN_ID"],
                  run_attempt=os.environ["GITHUB_RUN_ATTEMPT"], source_sha256=sha(Path(__file__).read_bytes()),
                  summaries=summary_facts, checkpoints=records,
                  qualification="All differences enumerated without normalization; independent audit pending; no timing qualification")
    raw = canonical(report) + b"\n"
    need(len(raw) <= 65536, "bounded complete comparison")
    OUT.mkdir(exist_ok=False)
    (OUT / "comparison.json").write_bytes(raw)


if __name__ == "__main__":
    main()
