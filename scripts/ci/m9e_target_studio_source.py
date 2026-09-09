"""Remote immutable named targeting-source inspection; no source import/game execution."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.request

PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
BRANCH = "codex/m9e-target-studio-source-20260909"
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-target-studio-source"
FILES = {
    "runtime-capabilities.ts": "735410d9d1ef266c3147a1c1724a5958ee52a7b8",
    "rule-ab-attrs.ts": "8964b9ea41f0f8ed3280316f562cb3484bb8b7be",
    "compile-ability-blueprint.ts": "83ecbea20880149fe8b209cea2e9864aed40d794",
    "runtime-components.ts": "800cbcfe0b18777c9457fb5cb163930b3532c84f",
}
PREFIX = "src/data/elite-redux/ability-studio/"

def require(value, message):
    if not value:
        raise RuntimeError(message)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def main():
    started = time.monotonic()
    require(os.environ.get("GITHUB_REPOSITORY") == "Heraklines/elite-redux"
            and os.environ.get("GITHUB_REF") == "refs/heads/" + BRANCH
            and os.environ.get("GITHUB_EVENT_NAME") == "push", "exact source branch/event")
    require(not OUT.exists(), "fresh source output")
    OUT.mkdir()
    receipt = dict(schema_version=1,status="failed",oracle_sha=PIN,
                   source_sha=os.environ["GITHUB_SHA"],run_id=os.environ["GITHUB_RUN_ID"],
                   run_attempt=os.environ["GITHUB_RUN_ATTEMPT"],branch=BRANCH,event="push",
                   qualification="source inspection only; excerpt scope explicitly recorded",files=[])
    try:
        all_parts=[]
        found=set()
        for name, oid in FILES.items():
            require(time.monotonic()-started < 180, "shared source bound")
            request=urllib.request.Request(f"https://api.github.com/repos/Heraklines/elite-redux/git/blobs/{oid}",
                headers={"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
                         "User-Agent":"m9e-target-studio-source","Authorization":"Bearer "+os.environ["GITHUB_TOKEN"]})
            try:
                with urllib.request.build_opener(NoRedirect).open(request,timeout=30) as response:
                    require(response.status == 200,"source HTTP status")
                    body=response.read((2<<20)+1)
                require(len(body) <= 2<<20,"source API bound")
            except Exception:
                raise RuntimeError("bounded immutable source read failed") from None
            value=json.loads(body)
            require(value.get("sha")==oid and value.get("encoding")=="base64"
                    and type(value.get("size")) is int and 0 < value["size"] <= 1<<20,"source metadata")
            raw=base64.b64decode("".join(value["content"].splitlines()),validate=True)
            require(len(raw)==value["size"] and hashlib.sha1(f"blob {len(raw)}\0".encode()+raw).hexdigest()==oid,"source blob identity")
            lines=raw.decode("utf-8").splitlines(keepends=True)
            declarations=[(i,line.rstrip()) for i,line in enumerate(lines)
                          if re.match(r"^(?:export )?(?:abstract )?(?:class|function|const|interface|type) [A-Za-z_]",line)]
            selected=set(range(min(35,len(lines))))
            selected.update(i for i,_ in declarations)
            methods=[]
            for wanted in ("AbilityStudioRuntimeCapabilityAbAttr","AbilityStudioSourceAbilityAbAttr"):
                hits=[i for i,line in enumerate(lines) if re.match(r"^export class "+wanted+r"\b",line)]
                require(len(hits)<=1,"unique named source class")
                for start in hits:
                    ends=[i for i in range(start+1,len(lines)) if re.match(r"^}\s*$",lines[i])]
                    require(ends and ends[0]-start <= 500,"bounded complete named class")
                    end=ends[0];selected.update(range(start,end+1));found.add(wanted)
                    methods.append(dict(name=wanted,start=start+1,end=end+1))
            included_full=len(raw)<=12288
            if included_full:
                selected=set(range(len(lines)))
            excerpt=("\nFILE "+PREFIX+name+"\n"+"".join(f"{i+1:05d}: {lines[i]}" for i in sorted(selected))).encode()
            require(len(excerpt)<=24576,"one named source excerpt bound")
            all_parts.append(excerpt)
            receipt["files"].append(dict(path=PREFIX+name,git_blob=oid,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),
                included_full=included_full,selected_lines=[i+1 for i in sorted(selected)],methods=methods,
                excerpt_bytes=len(excerpt),excerpt_sha256=hashlib.sha256(excerpt).hexdigest()))
        require(found=={"AbilityStudioRuntimeCapabilityAbAttr","AbilityStudioSourceAbilityAbAttr"},"both actual studio classes found")
        excerpt=b"".join(all_parts)
        require(len(excerpt)<=49152,"aggregate source excerpt bound")
        (OUT/"source-excerpt.txt").write_bytes(excerpt)
        receipt.update(status="passed",excerpt_bytes=len(excerpt),excerpt_sha256=hashlib.sha256(excerpt).hexdigest(),elapsed_seconds=time.monotonic()-started)
        receipt["source_hashes"]={path:hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path in (
            "scripts/ci/m9e_target_studio_source.py",".github/workflows/m9e-target-studio-source.yml")}
    except Exception as error:
        receipt["failure"]=str(error)[:512] if isinstance(error,RuntimeError) else "bounded source inspection failed"
    finally:
        encoded=(json.dumps(receipt,sort_keys=True,separators=(",",":"))+"\n").encode()
        require(len(encoded)<=16384,"compact source receipt bound")
        (OUT/"receipt.json").write_bytes(encoded)
    require(receipt["status"]=="passed","source inspection failed; inspect bounded receipt")

if __name__=="__main__":
    main()
