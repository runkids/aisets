#!/usr/bin/env sh
set -eu

REPO="${AISETS_REPO:-runkids/aisets}"
BINARY_NAME="aisets"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$os" in
  darwin|linux) ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to run: $*" >&2
    exit 1
  fi
  sudo "$@"
}

release_json="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")" || {
  echo "No GitHub release found for ${REPO}. Create the GitHub repo and publish a release first, or set AISETS_REPO=owner/name for a different repo." >&2
  exit 1
}
latest="$(printf '%s\n' "$release_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
if [ -z "$latest" ]; then
  echo "GitHub latest release response did not include tag_name." >&2
  exit 1
fi
version="${latest#v}"
archive="${BINARY_NAME}_${version}_${os}_${arch}.tar.gz"
url="https://github.com/${REPO}/releases/download/${latest}/${archive}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${url}"
curl -fsSL "$url" -o "$tmp/$archive"
tar xzf "$tmp/$archive" -C "$tmp"

if [ ! -d "$INSTALL_DIR" ]; then
  run_privileged mkdir -p "$INSTALL_DIR"
fi

if [ -w "$INSTALL_DIR" ]; then
  install -m 0755 "$tmp/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
else
  run_privileged install -m 0755 "$tmp/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
fi

echo "Installed $($INSTALL_DIR/$BINARY_NAME version) to $INSTALL_DIR/$BINARY_NAME"
