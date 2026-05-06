<p align="center">
  <img src="ui/public/brand/asset-studio-logo.png" alt="Asset Studio" width="392" />
</p>

# Asset Studio

Asset Studio is a local-first asset management tool for multi-project workspaces.

It runs as a pure Go CLI binary and opens a localhost UI. Release builds download
the UI bundle from GitHub Releases and cache it locally, following the same
distribution model as Skillshare.

## Development

```bash
go build -o bin/asset-studio ./cmd/asset-studio
./bin/asset-studio ui /path/to/project --no-open
```

For UI development:

```bash
cd ui
pnpm install
pnpm run dev
```

The Go server runs on `127.0.0.1:19520` by default. Use `--port` to bind a
different port. Vite proxies `/api` to it.

## Devcontainer

```bash
make devc
ui /workspace
```

`make devc` starts the devcontainer and enters a shell. Inside the container,
`ui` starts the Go API with Air hot reload and the Vite UI. Browser/app-window
opening is best-effort inside the container; if no opener exists, use the printed
`http://127.0.0.1:5174` URL from the host browser.

## Commands

```bash
asset-studio ui [projectPaths...] [--port PORT] [--app]
asset-studio ui once [projectPaths...] [--port PORT]
asset-studio ui stop [--port PORT]
asset-studio version [--json]
asset-studio projects [--json]
asset-studio projects add [projectPaths...] [--json]
asset-studio projects rename --id ID --name NAME [--json]
asset-studio projects remove --id ID [--json]
asset-studio settings get [--json]
asset-studio settings export [--output file.json] [--json]
asset-studio settings import file.json [--json]
asset-studio settings reset-database --confirm RESET [--json]
asset-studio scan [projectPaths...] [--json]
asset-studio scans list [--json]
asset-studio scans diff --base ID --target ID [--json]
asset-studio optimize estimate [assetIds...] [--json]
asset-studio optimize script [assetIds...] [--json]
asset-studio pre-check [filePaths...] [--json]
asset-studio actions rename preview --asset-id ID --target-path PATH [--json]
asset-studio actions merge-duplicates preview --asset-id ID --preferred-path PATH [--json]
asset-studio actions delete-unused preview --asset-id ID [--json]
asset-studio actions apply --preview preview.json [--json]
```

`--json` can be used before the command or after command arguments for AI/native automation.
`asset-studio ui` starts or reuses a background UI server and opens it in the default
browser. Use `--app` to open a desktop-style app window when Chrome, Edge, Brave, or
Chromium is available. Use `asset-studio ui once` for the foreground server behavior used
by Docker, Air, and long-running process managers. Use `asset-studio ui stop` to stop the
background server for a port. `--base-path` keeps the same reverse-proxy hosting behavior
as the Go-served UI.

## Safety

File-changing operations use preview/apply APIs. Apply revalidates the source
files before writing and rejects stale previews. CLI apply accepts preview JSON
from a file or stdin via `--preview -`.
