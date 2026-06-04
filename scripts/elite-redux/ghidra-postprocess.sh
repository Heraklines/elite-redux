#!/usr/bin/env bash
# Wait for Ghidra import (java pid) to complete, then run the post-script
# in a NEW analyzeHeadless invocation to dump strings + functions.
#
# Usage: bash scripts/elite-redux/ghidra-postprocess.sh

set -eu
cd "$(dirname "$0")/../.."

GHIDRA=vendor/elite-redux/tools/ghidra_11.0.3_PUBLIC/support/analyzeHeadless
PROJECT_DIR=vendor/elite-redux/ghidra-project
PROJECT_NAME=ER

# Wait for any running java to exit.
while tasklist 2>/dev/null | grep -q "java.exe"; do
  echo "[postprocess] waiting for Ghidra to finish..."
  sleep 60
done

echo "[postprocess] Ghidra import complete, running post-script..."

# Process the existing project's binary to dump strings + functions.
"$GHIDRA" "$PROJECT_DIR" "$PROJECT_NAME" \
  -process er-v2.65.3b.gba \
  -postScript scripts/elite-redux/ghidra_dump_strings.py \
  -scriptPath scripts/elite-redux/ \
  -noanalysis \
  2>&1 | tail -30

echo "[postprocess] Done. Output files in vendor/elite-redux/rom-extracted/"
ls -la vendor/elite-redux/rom-extracted/ghidra-*.txt 2>/dev/null || echo "  (no files yet — script may need more time)"
