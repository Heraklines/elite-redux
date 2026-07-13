#!/usr/bin/env bash
#
# SPDX-FileCopyrightText: 2024-2026 Pagefault Games
# SPDX-License-Identifier: AGPL-3.0-only
#
# Nightly co-op public-UI campaign entry point. ALL nightly logic lives here on the
# feature branch; the main-branch launcher workflow only checks out a ref and runs this
# script, so nothing but a thin scheduler ever lands on main.
#
# Expects a GitHub Actions environment (GITHUB_ENV, GITHUB_RUN_ID, GH_TOKEN).
#   COOP_UI_CAMPAIGN_WAVES (optional, default 30)
# Node + pnpm (via corepack) must already be on PATH.
set -euo pipefail

# The nightly is a STAGING soak: target the isolated P33 staging workers authoritatively so a
# cron run always hits the right workers, regardless of how the main-branch launcher wired vars.
export COOP_UI_API_ORIGIN="https://er-save-api-staging.heraklines.workers.dev"
export COOP_UI_SIGNAL_ORIGIN="https://er-coop-api-staging.heraklines.workers.dev"
: "${GITHUB_ENV:?GITHUB_ENV is required (run under GitHub Actions)}"

echo "::group::Staging health precheck"
SIG=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "$COOP_UI_SIGNAL_ORIGIN/coop/health" || echo 000)
API=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "$COOP_UI_API_ORIGIN/account/info" || echo 000)
echo "signal /coop/health -> $SIG ; save /account/info -> $API"
if ! { [ "$SIG" = "200" ] && [ "$API" != "000" ] && [ "$API" != "404" ] && [ "$API" -lt 500 ]; }; then
  echo "::warning title=Staging unhealthy::signal=$SIG save=$API - skipping the nightly campaign (no doomed run)."
  exit 0
fi
echo "::endgroup::"

echo "::group::Install dependencies"
corepack enable
pnpm install --frozen-lockfile
echo "::endgroup::"

echo "::group::Public-driver boundary checks"
node test/browser/coop-public-ui/check-public-boundary.mjs
node test/browser/coop-public-ui/check-campaign-boundary.mjs
echo "::endgroup::"

echo "::group::Resolve exact production asset SHA"
COOP_BROWSER_ASSET_SHA="$(gh api repos/Heraklines/er-assets/commits/main --jq .sha)"
echo "$COOP_BROWSER_ASSET_SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo "Invalid er-assets SHA"; exit 1; }
export COOP_BROWSER_ASSET_SHA
echo "::endgroup::"

echo "::group::Build and seal the exact-SHA browser bundle"
COOP_BROWSER_OUT_DIR=dist-coop-public-ui \
VITE_BYPASS_LOGIN=0 \
VITE_BYPASS_TUTORIAL=0 \
VITE_COOP_SERVER_URL="$COOP_UI_SIGNAL_ORIGIN" \
VITE_COOP_SIGNALING_PROTOCOL=p33 \
VITE_SERVER_URL="$COOP_UI_API_ORIGIN" \
  pnpm exec vite build --mode beta --config test/browser/coop-public-ui/vite.config.mjs
COOP_BROWSER_DIST=dist-coop-public-ui \
COOP_BROWSER_API_ORIGIN="$COOP_UI_API_ORIGIN" \
VITE_COOP_SERVER_URL="$COOP_UI_SIGNAL_ORIGIN" \
  node scripts/prepare-coop-browser-artifact.mjs
echo "::endgroup::"

echo "::group::Install Chrome + provision an isolated account pair"
pnpm exec puppeteer browsers install chrome
node test/browser/coop-public-ui/provision-accounts.mjs
# provision-accounts.mjs appends the masked credential pair to $GITHUB_ENV; load it here.
set -a
# shellcheck disable=SC1090
source "$GITHUB_ENV"
set +a
echo "::endgroup::"

echo "::group::Drive the nightly campaign (loud-fail mode, no auto-first)"
COOP_UI_BASE_URL=http://127.0.0.1:4175/?coopdebug=1 \
COOP_UI_BROWSER_DIST=dist-coop-public-ui \
COOP_UI_ASSET_DIR=assets \
COOP_UI_EXPECTED_API_ORIGIN="$COOP_UI_API_ORIGIN" \
COOP_UI_EXPECTED_SIGNAL_ORIGIN="$COOP_UI_SIGNAL_ORIGIN" \
COOP_UI_ACCOUNT_MODE=register \
COOP_UI_CAMPAIGN_MODE=nightly \
COOP_UI_CAMPAIGN_WAVES="${COOP_UI_CAMPAIGN_WAVES:-30}" \
COOP_UI_ACTION_DELAY_MS=70 \
COOP_UI_SETTLE_DELAY_MS=300 \
NODE_OPTIONS=--max-old-space-size=4096 \
  node test/browser/coop-public-ui/run-campaign.mjs
echo "::endgroup::"
