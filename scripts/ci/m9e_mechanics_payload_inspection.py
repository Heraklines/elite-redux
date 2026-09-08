"""Remote, read-only inspection of selected published mechanics payloads."""
import hashlib
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / 'rust/fixtures/m9/engineering/game-content-bundle-v2.json'
raw = path.read_bytes()
expected = '9afce9fd3bc6e05e2159f19e8578ff64fc342b8a5974bec5f15648b0799d74d2'
assert len(raw) == 16325821 and hashlib.sha256(raw).hexdigest() == expected
battle = json.loads(raw)['battle']
selected = [36, 38, 71, 72, 165, 202, 394, 409, 413, 577, 613]
rows = []
for index in selected:
    move = battle['moves'][index]
    assert move['id'] == index
    programs = []
    for program_id in move['mechanic_programs']:
        assert type(program_id) is int
        programs.append(battle['programs'][program_id])
    rows.append({'move': move, 'programs': programs})
result = {
    'status': 'observed', 'scope': 'published payload inspection only; no behavior qualification',
    'source_sha': os.environ['GITHUB_SHA'], 'run_id': os.environ['GITHUB_RUN_ID'],
    'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'bundle_sha256': expected,
    'oracle_sha': battle['oracle_sha'],
    'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'selected_ids': selected, 'rows': rows,
}
encoded = (json.dumps(result, separators=(',', ':')) + '\n').encode()
assert 0 < len(encoded) <= 32768
output = Path(os.environ['RUNNER_TEMP']) / 'm9e-mechanics-inspection'
output.mkdir(exist_ok=False)
(output / 'summary.json').write_bytes(encoded)
print(json.dumps({'status': result['status'], 'moves': len(rows), 'bytes': len(encoded)}))
