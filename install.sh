#!/usr/bin/env sh
set -eu

REPO="runkids/asset-studio"
BINARY_NAME="asset-studio"
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

latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" | sed 's#.*/tag/##')"
version="${latest#v}"
archive="${BINARY_NAME}_${version}_${os}_${arch}.tar.gz"
url="https://github.com/${REPO}/releases/download/${latest}/${archive}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${url}"
curl -fsSL "$url" -o "$tmp/$archive"
tar xzf "$tmp/$archive" -C "$tmp"

if [ -w "$INSTALL_DIR" ]; then
  install -m 0755 "$tmp/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
else
  sudo install -m 0755 "$tmp/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
fi

echo "Installed $($INSTALL_DIR/$BINARY_NAME version) to $INSTALL_DIR/$BINARY_NAME"
