"""Bounded remote diagnostic only; no current runtime qualification or local full logs."""
import ast
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.request
import zipfile

REPO = "Heraklines/elite-redux"
FAILED_RUN = 34357474087
FAILED_JOB = 102485707309
ARTIFACT = 10107723496
EXPECTED_ARCHIVE_BYTES = 258840
EXPECTED_SOURCE = "0e0f07d0081a4b604b880796b905c4919958eac1"
OUT = Path(os.environ["RUNNER_TEMP"])/"m9e-summary-diagnostic"
OUT.mkdir()
result = {"status":"failed","source_sha":os.environ["GITHUB_SHA"],"run_id":os.environ["GITHUB_RUN_ID"],"failed_run":FAILED_RUN,"failed_job":FAILED_JOB,"artifact_id":ARTIFACT,"runtime_qualification":False}
def require(ok, message):
    if not ok:
        raise RuntimeError(message)
def digest(data):
    return hashlib.sha256(data).hexdigest()
def get(path, maximum):
    request = urllib.request.Request("https://api.github.com/repos/"+REPO+path,headers={"Authorization":"Bearer "+os.environ["GH_TOKEN"],"User-Agent":"m9e-bounded-diagnostic"})
    with urllib.request.urlopen(request,timeout=45) as response:
        raw = response.read(maximum+1)
    require(len(raw)<=maximum,"remote diagnostic bound")
    return raw
try:
    metadata=json.loads(get(f"/actions/artifacts/{ARTIFACT}",16384))
    require(metadata["size_in_bytes"]==EXPECTED_ARCHIVE_BYTES and metadata["workflow_run"]["id"]==FAILED_RUN and metadata["workflow_run"]["head_sha"]==EXPECTED_SOURCE,"exact inspected artifact identity")
    archive=get(f"/actions/artifacts/{ARTIFACT}/zip",EXPECTED_ARCHIVE_BYTES)
    require(len(archive)==EXPECTED_ARCHIVE_BYTES,"exact archive size")
    if metadata.get("digest"):
        require(metadata["digest"]=="sha256:"+digest(archive),"API archive digest")
    with zipfile.ZipFile(io.BytesIO(archive)) as data:
        members=[entry for entry in data.infolist() if entry.filename=="_temp/m9e-feedback/full/full-summary.json"]
        require(len(members)==1 and members[0].file_size==145285,"exact full summary member")
        raw=data.read(members[0])
    full=json.loads(raw)
    require(full["product_sha"]==EXPECTED_SOURCE and full["tests"]["executed"]==732 and full["tests"]["passed"]==732 and full["tests"]["failed"]==0,"actual failed-run native evidence")
    result["failed_full_summary_sha256"]=digest(raw)
    result["ordinary_tests_passed"]=732
    log=get(f"/actions/jobs/{FAILED_JOB}/logs",1048576)
    result["remote_job_log_bytes"]=len(log)
    lines=log.decode(errors="replace").splitlines()
    errors=[line for line in lines if "RuntimeError:" in line or "Traceback" in line or 'raise RuntimeError("native compact summary' in line]
    result["failure_lines"]=[line[-500:] for line in errors[-6:]]
    require(any("native compact summary exceeds 16 KiB after bounded projection" in line for line in errors),"actual failing compact-size exception required")
    source=Path("scripts/ci/m9e_feedback.py").read_bytes()
    result["feedback_sha256"]=digest(source)
    module=ast.parse(source)
    loops=[node for node in ast.walk(module) if isinstance(node,ast.For) and isinstance(node.target,ast.Name) and node.target.id=="key" and isinstance(node.iter,ast.Tuple) and any(isinstance(element,ast.Constant) and element.value=="native_target_timing_ms" for element in node.iter.elts)]
    require(len(loops)==1,"one actual compact projection tuple")
    corrected=list(ast.literal_eval(loops[0].iter))
    original=["native_target_timing_ms","required_native_target_counts","build_only_targets","timing_ms","current_cost_probe"]
    added=["standard_score_oracle","party_xp_oracle","phase_xp_oracle","held_xp_oracle","phase_tree_oracle","phase_tree_queries_oracle","starter_pokerus_oracle"]
    require(corrected==original+added,"only exact additional oracle references")
    def project(keys):
        projected=copy.deepcopy(full)
        projected["evidence"]=[{"file":"full-summary.json","sha256":digest(raw)}]
        projected["plan"]={"file":"plan.json","sha256":"07ee0b8baa10d7db7f83d4cc010f05677c75538e99e9266234260f688588a2a2"}
        for key in keys:
            if key in projected:
                projected[key]={"file":"full-summary.json","sha256":digest(raw)}
        return projected,(json.dumps(projected,indent=2)+"\n").encode()
    old,old_bytes=project(original)
    fixed,fixed_bytes=project(corrected)
    require(len(old_bytes)>16000 and len(fixed_bytes)<=16000,"real old failure and corrected unchanged cap")
    recovered=copy.deepcopy(fixed)
    for key in added:
        if key in recovered:
            require(recovered[key]=={"file":"full-summary.json","sha256":digest(raw)},"exact retained-evidence reference")
            recovered[key]=full[key]
    require(recovered==old,"all omitted data losslessly resolves; every other field unchanged")
    result.update(status="passed",old_projected_bytes=len(old_bytes),fixed_projected_bytes=len(fixed_bytes),bound=16000,complete_backing_summary_unchanged=True,lossless_reference_roundtrip=True)
except Exception as error:
    result["error"]=type(error).__name__+": "+str(error)[:1000]
finally:
    output=(json.dumps(result,sort_keys=True,indent=2)+"\n").encode()
    require(len(output)<=8192,"compact diagnosis only")
    (OUT/"summary.json").write_bytes(output)
raise SystemExit(0 if result["status"]=="passed" else 1)
