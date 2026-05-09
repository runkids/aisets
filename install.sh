#!/usr/bin/env sh
set -eu

REPO="${AISETS_REPO:-runkids/aisets}"
BINARY_NAME="aisets"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
INSTALL_OCR_ENGINE="${INSTALL_OCR_ENGINE:-ask}"

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

should_install_tesseract() {
  case "$INSTALL_OCR_ENGINE" in
    1|true|TRUE|yes|YES|y|Y) return 0 ;;
    0|false|FALSE|no|NO|n|N)
      echo "Skipping OCR engine install because INSTALL_OCR_ENGINE=$INSTALL_OCR_ENGINE"
      return 1
      ;;
    ask|ASK|"") ;;
    *)
      echo "Invalid INSTALL_OCR_ENGINE value: $INSTALL_OCR_ENGINE. Use ask, 1, or 0." >&2
      exit 1
      ;;
  esac

  if [ -r /dev/tty ]; then
    printf "Install local OCR engine dependency (Tesseract) for image text search? [Y/n] " >/dev/tty
    read answer </dev/tty || answer=""
    case "$answer" in
      n|N|no|NO|No)
        echo "Skipping OCR engine install. OCR cache build will stay disabled until tesseract is installed."
        return 1
        ;;
    esac
    return 0
  fi

  echo "Skipping OCR engine install because no interactive terminal is available. Re-run with INSTALL_OCR_ENGINE=1 to install it." >&2
  return 1
}

install_tesseract() {
  if command -v tesseract >/dev/null 2>&1; then
    echo "OCR engine already installed: $(command -v tesseract)"
    return
  fi

  if ! should_install_tesseract; then
    return
  fi

  echo "Installing OCR engine dependency: tesseract"
  case "$os" in
    darwin)
      if ! command -v brew >/dev/null 2>&1; then
        echo "Homebrew is required to install tesseract automatically on macOS." >&2
        echo "Install Homebrew, then run: brew install tesseract" >&2
        echo "Or re-run this installer with INSTALL_OCR_ENGINE=0 to skip OCR." >&2
        exit 1
      fi
      brew install tesseract
      ;;
    linux)
      if command -v apt-get >/dev/null 2>&1; then
        run_privileged apt-get update
        run_privileged apt-get install -y tesseract-ocr
      elif command -v dnf >/dev/null 2>&1; then
        run_privileged dnf install -y tesseract
      elif command -v yum >/dev/null 2>&1; then
        run_privileged yum install -y tesseract
      elif command -v zypper >/dev/null 2>&1; then
        run_privileged zypper install -y tesseract-ocr
      elif command -v pacman >/dev/null 2>&1; then
        run_privileged pacman -Sy --noconfirm tesseract
      elif command -v apk >/dev/null 2>&1; then
        run_privileged apk add --no-cache tesseract-ocr
      else
        echo "No supported Linux package manager found for installing tesseract." >&2
        echo "Install tesseract manually, or re-run with INSTALL_OCR_ENGINE=0 to skip OCR." >&2
        exit 1
      fi
      ;;
  esac

  if command -v tesseract >/dev/null 2>&1; then
    echo "Installed OCR engine: $(command -v tesseract)"
  else
    echo "Tesseract install finished but tesseract is still not on PATH." >&2
    exit 1
  fi
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

install_tesseract

echo "Installed $($INSTALL_DIR/$BINARY_NAME version) to $INSTALL_DIR/$BINARY_NAME"
