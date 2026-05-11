#!/usr/bin/env bash
set -euo pipefail

if [[ "${HOME:-}" != "/home/developer" ]] || [ ! -d /workspace ] || [ ! -f /workspace/go.mod ]; then
  echo "Refusing to run: expected aisets devcontainer context." >&2
  exit 1
fi

cd /workspace
/workspace/.devcontainer/start-dev.sh

echo "▸ Building imgtools (Rust) ..."
make imgtools-install

echo "▸ Building aisets binary ..."
make build

echo "▸ Installing UI dependencies ..."
(cd /workspace/ui && CI=true pnpm install --frozen-lockfile)

touch "$HOME/.devcontainer-initialized"

/workspace/.devcontainer/start-dev.sh
