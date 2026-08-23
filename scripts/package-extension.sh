#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "JSON.parse(require('fs').readFileSync('$project_root/manifest.json')).version")"
output_dir="$project_root/dist"
archive="$output_dir/snread-$version.zip"

mkdir -p "$output_dir"
rm -f "$archive"

cd "$project_root"
zip -q -r "$archive" \
  manifest.json \
  _locales \
  assets/fonts \
  assets/icons \
  src \
  -x '.DS_Store' '*/.DS_Store' '*/README.md' \
     'assets/icons/icon-512.png' 'assets/icons/icon.svg' 'assets/icons/mark.svg'

echo "Created $archive"
