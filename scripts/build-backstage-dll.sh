#!/usr/bin/env bash
# Build the BackstageInjection DLL from the Rust crate for Windows x64 using the
# windows-gnu target. Cross-compiles on Linux (CI / Docker) and works on Windows.
#
# Requirements:
#   - cargo + the x86_64-pc-windows-gnu target installed (rustup target add ...)
#   - gcc-mingw-w64-x86-64 (provides x86_64-w64-mingw32-gcc; cc uses it to build
#     the bundled MinHook C source and link the payload)

set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

CRATE_DIR="${BACKSTAGE_CRATE_DIR:-BackstageInjection-Rust}"
OUT_DIR="${BACKSTAGE_OUT_DIR:-Overlord-Server/dist-clients}"
TARGET="x86_64-pc-windows-gnu"
DLL_NAME="BackstageInjection.x64.dll"

if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: cargo not found. Install a Rust toolchain (rustup)."
  exit 1
fi

if ! rustup target list --installed 2>/dev/null | grep -qx "$TARGET"; then
  echo "ERROR: target not installed: $TARGET"
  echo "Install it with: rustup target add $TARGET"
  exit 1
fi

if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
  echo "ERROR: cross compiler not found: x86_64-w64-mingw32-gcc"
  echo "Install mingw-w64 (e.g. apt install gcc-mingw-w64-x86-64)."
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Building randomized Rust BackstageInjection DLL ($TARGET) ..."
BACKSTAGE_LOADER_SEED="${BACKSTAGE_FRESH:-$(date +%s%N)}" \
  cargo build --release --target "$TARGET" --manifest-path "$CRATE_DIR/Cargo.toml"

SRC_DLL="$CRATE_DIR/target/$TARGET/release/BackstageInjection.dll"
if [ ! -f "$SRC_DLL" ]; then
  echo "ERROR: expected built DLL at $SRC_DLL"
  exit 1
fi

cp -f "$SRC_DLL" "$OUT_DIR/$DLL_NAME"
echo "Built: $OUT_DIR/$DLL_NAME"
ls -la "$OUT_DIR/$DLL_NAME"

echo "Done."