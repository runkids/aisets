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
./bin/asset-studio ui --no-open /path/to/project
```

For UI development:

```bash
cd ui
pnpm install
pnpm run dev
```

The Go server runs on `127.0.0.1:19520`. Vite proxies `/api` to it.

## Devcontainer

```bash
make devc
ui /workspace
```

`make devc` starts the devcontainer and enters a shell. Inside the container,
`ui` starts the Go API with Air hot reload and the Vite UI.

## Commands

```bash
asset-studio ui [projectPaths...]
asset-studio version
```

## Safety

File-changing operations use preview/apply APIs. Apply revalidates the source
files before writing and rejects stale previews.
