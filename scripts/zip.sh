#!/usr/bin/env bash
# Builds dist/paceline-<version>.zip with a top-level paceline/ folder, ready to unzip into
# Sauce's SauceMods folder. Only the files a teammate needs go in.
set -euo pipefail

cd "$(dirname "$0")/.."
root=$(pwd)

version=$(node -p "require('./manifest.json').version")
out="dist/paceline-${version}.zip"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/paceline" dist
cp manifest.json README.md "$stage/paceline/"
cp -R pages "$stage/paceline/pages"
find "$stage" -name .DS_Store -delete

rm -f "$out"
(cd "$stage" && zip -r -q -X "$root/$out" paceline)

echo "Built $out"
