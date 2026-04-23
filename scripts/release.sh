#!/usr/bin/env bash
# Cuts a release of Third Eye:
#   1. checks the working tree is clean and on main
#   2. checks CHANGELOG.md already has a section for the new version
#      (write the notes BEFORE running this script — that's the only
#      manual step beyond running the script itself)
#   3. bumps the version field in root, client/, and server/ package.json
#   4. commits + tags + pushes
#   5. .github/workflows/release.yml then publishes the GitHub Release
#      page automatically using the matching CHANGELOG section as notes
#
# Usage: ./scripts/release.sh 2.1.0
set -euo pipefail

ver="${1:-}"
if [[ -z "$ver" ]]; then
  echo "usage: $0 X.Y.Z"
  exit 1
fi
if ! [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must be a bare semver triple (e.g. 2.1.0), got: $ver"
  exit 1
fi

cd "$(dirname "$0")/.."

# Refuse to release from anywhere but a clean main checkout — the GitHub
# Action triggers on tag push, and tags should always reference main.
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "must be on main (currently on $branch)"
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree is dirty — commit or stash first"
  git status --short
  exit 1
fi

# CHANGELOG section is the single source of truth for release notes.
if ! grep -q "^## \[${ver}\]" CHANGELOG.md; then
  echo "CHANGELOG.md is missing '## [${ver}] — YYYY-MM-DD' — write the notes first"
  exit 1
fi

# Make sure we're not re-tagging an existing version.
if git rev-parse "v${ver}" >/dev/null 2>&1; then
  echo "tag v${ver} already exists locally"
  exit 1
fi

# Bump version in all three package.json files (no other side effects).
for f in package.json client/package.json server/package.json; do
  sed -i.bak -E 's/("version"[[:space:]]*:[[:space:]]*")[^"]+(")/\1'"${ver}"'\2/' "$f"
  rm "${f}.bak"
done

git add package.json client/package.json server/package.json
git commit -m "v${ver}"
git tag -a "v${ver}" -m "v${ver}"
git push origin main --follow-tags

echo
echo "✓ pushed v${ver}"
echo "  GitHub Action will publish the Release page in ~30s:"
echo "  https://github.com/fien-atone/third-eye/releases/tag/v${ver}"
