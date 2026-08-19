#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
rm -f rust-lite-builder.zip
zip -q rust-lite-builder.zip config.json rust-lite-builder.html rust-lite-builder.css rust-lite-builder.js server.js
echo "[ok] $ROOT/rust-lite-builder.zip"
