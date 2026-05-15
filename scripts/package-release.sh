#!/usr/bin/env bash
set -euo pipefail

version="${VERSION:-dev}"
version="${version#v}"
goos="${GOOS:-$(go env GOOS)}"
goarch="${GOARCH:-$(go env GOARCH)}"
out_dir="${OUT_DIR:-dist/release}"

host_goos="$(go env GOOS)"
host_goarch="$(go env GOARCH)"
if [[ "$host_goos" != "$goos" || "$host_goarch" != "$goarch" ]]; then
  echo "release packaging requires a native runner: requested ${goos}/${goarch}, got ${host_goos}/${host_goarch}" >&2
  exit 1
fi

case "$goos" in
  linux|darwin|windows) ;;
  *) echo "unsupported GOOS: $goos" >&2; exit 1 ;;
esac
case "$goarch" in
  amd64|arm64) ;;
  *) echo "unsupported GOARCH: $goarch" >&2; exit 1 ;;
esac

mkdir -p "$out_dir"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
pkg_dir="$work_dir/package"
mkdir -p "$pkg_dir"

exe_suffix=""
archive_ext="tar.gz"
if [[ "$goos" == "windows" ]]; then
  exe_suffix=".exe"
  archive_ext="zip"
fi

asset_name="aisets_${version}_${goos}_${goarch}.${archive_ext}"
archive_path="$out_dir/$asset_name"

cargo build --release --manifest-path tools/imgtools/Cargo.toml

CGO_ENABLED="${CGO_ENABLED:-0}" go build \
  -ldflags "-s -w -X main.version=${version}" \
  -o "$pkg_dir/aisets${exe_suffix}" \
  ./cmd/aisets

cp "tools/imgtools/target/release/aisets-imgtools${exe_suffix}" "$pkg_dir/aisets-imgtools${exe_suffix}"

"$pkg_dir/aisets${exe_suffix}" version >/dev/null
"$pkg_dir/aisets-imgtools${exe_suffix}" version >/dev/null

rm -f "$archive_path"
if [[ "$goos" == "windows" ]]; then
  pkg_win="$(cygpath -w "$pkg_dir")"
  archive_win="$(cygpath -w "$archive_path")"
  powershell.exe -NoProfile -Command "Compress-Archive -Path '${pkg_win}\\*' -DestinationPath '${archive_win}' -Force"
else
  tar -C "$pkg_dir" -czf "$archive_path" .
fi

printf '%s\n' "$archive_path"
