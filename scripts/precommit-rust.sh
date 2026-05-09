#!/usr/bin/env sh
set -eu

staged_rust_changes=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '(^|/).+\.rs$|Cargo\.(toml|lock)$' || true)

if [ -z "$staged_rust_changes" ]; then
  exit 0
fi

echo "pre-commit: Rust changes detected"
echo "$staged_rust_changes"

echo "pre-commit: running cargo fmt --check"
cargo fmt --manifest-path tools/imgtools/Cargo.toml -- --check

echo "pre-commit: running cargo clippy"
cargo clippy --manifest-path tools/imgtools/Cargo.toml -- -D warnings

echo "pre-commit: running cargo test"
cargo test --manifest-path tools/imgtools/Cargo.toml
