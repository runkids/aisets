#!/usr/bin/env sh
set -eu

staged_go_changes=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '(^|/).+\.go$|^go\.mod$|^go\.sum$' || true)

if [ -z "$staged_go_changes" ]; then
  echo "pre-commit: no Go changes; skipping go vet/test"
  exit 0
fi

echo "pre-commit: Go changes detected"
echo "$staged_go_changes"

echo "pre-commit: running go vet ./..."
go vet ./...

echo "pre-commit: running go test ./..."
go test ./...
