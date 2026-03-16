#!/usr/bin/env bash
# Build a temporary directory for uploading to ClawHub.
#
# ClawHub CLI token auth is currently broken (github.com/openclaw/clawhub#72),
# so we build the upload folder and publish manually via https://clawhub.ai/upload.
#
# Usage:
#   bash scripts/clawhub-publish.sh
#
# After running, upload the printed directory at https://clawhub.ai/upload.
# Once the CLI auth issue is resolved, uncomment the clawhub publish line below.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$ROOT/package.json').version")
OUTDIR="$ROOT/clawhub-upload"

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

cp "$ROOT/SKILL.md" "$OUTDIR/SKILL.md"

echo "ClawHub upload directory ready: $OUTDIR"
echo "Version: $VERSION"
echo ""
echo "Next steps:"
echo "  1. Go to https://clawhub.ai/upload"
echo "  2. Select folder: $OUTDIR"
echo "  3. Fill in version: $VERSION"
echo "  4. Publish"
echo ""
echo "To clean up after publishing: rm -rf $OUTDIR"

# Uncomment when CLI auth is fixed:
# npx -y clawhub publish "$OUTDIR" \
#   --slug aiusd-pro \
#   --name "AIUSD Pro" \
#   --version "$VERSION" \
#   --tags latest \
#   --registry https://www.clawhub.ai
