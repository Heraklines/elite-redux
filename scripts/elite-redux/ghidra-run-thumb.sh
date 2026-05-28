#!/usr/bin/env bash
# Run Ghidra headless analyzer with Thumb-mode pre-script + string/function
# post-script. The Thumb pre-script sets TMode=1 on the whole ROM range
# BEFORE auto-analysis, which dramatically reduces "Unable to resolve
# constructor" warnings that previously caused the run to grind for hours.
#
# Usage: bash scripts/elite-redux/ghidra-run-thumb.sh

set -eu
cd "$(dirname "$0")/../.."

GHIDRA=vendor/elite-redux/tools/ghidra_11.0.3_PUBLIC/support/analyzeHeadless
PROJECT_DIR=vendor/elite-redux/ghidra-project
PROJECT_NAME=ER
ROM=vendor/elite-redux/rom-extracted/er-v2.65.3b.gba

echo "[ghidra-run-thumb] Starting headless analysis with Thumb pre-script..."
"$GHIDRA" "$PROJECT_DIR" "$PROJECT_NAME" \
  -import "$ROM" \
  -loader BinaryLoader \
  -loader-baseAddr 0x08000000 \
  -processor "ARM:LE:32:v4t" \
  -scriptPath scripts/elite-redux/ \
  -preScript ghidra_set_thumb_mode.py \
  -postScript ghidra_dump_strings.py \
  2>&1 | tail -200

echo "[ghidra-run-thumb] Done. Output files:"
ls -la vendor/elite-redux/rom-extracted/ghidra-*.txt 2>/dev/null || echo "  (no files yet)"
