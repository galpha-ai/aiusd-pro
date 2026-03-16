#!/usr/bin/env bash
# Publish aiusd-pro skill to ClawHub
# Usage: bash scripts/clawhub-publish.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$ROOT/package.json').version")
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Copy SKILL.md only (aiusd-pro has no sub-skill files)
cp "$ROOT/SKILL.md" "$TMPDIR/SKILL.md"

echo "Publishing aiusd-pro v${VERSION} to ClawHub..."
clawhub publish "$TMPDIR" \
  --slug aiusd-pro \
  --name "AIUSD Pro" \
  --version "$VERSION" \
  --tags latest

echo "Done."
