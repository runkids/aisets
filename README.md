<p align="center">
  <img src="./ui/public/brand/aisets-logo.png" alt="Aisets" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://github.com/runkids/aisets/releases"><img src="https://img.shields.io/github/v/release/runkids/aisets" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue" alt="Platform">
  <a href="https://goreportcard.com/report/github.com/runkids/aisets"><img src="https://goreportcard.com/badge/github.com/runkids/aisets" alt="Go Report Card"></a>
  <a href="https://deepwiki.com/runkids/aisets"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

<p align="center">
  <a href="https://github.com/runkids/aisets/stargazers"><img src="https://img.shields.io/github/stars/runkids/aisets?style=social" alt="Star on GitHub"></a>
</p>

<p align="center">
  <strong>Local-first asset hygiene for multi-project workspaces.</strong><br>
  Scan, deduplicate, lint, optimize, AI-tag & clean up image assets — all from a single CLI binary with a localhost UI.
</p>

<p align="center">
  <img src=".github/assets/readme-browse.png" alt="Aisets asset browser with AI tags, OCR state, optimization status, and project facets" width="960">
</p>

<p align="center">
  <a href="#installation">Install</a> •
  <a href="#product-tour">Product Tour</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#commands">Commands</a> •
  <a href="#development">Development</a>
</p>

## Why Aisets

Every codebase accumulates image debt: duplicates nobody notices, 4 MB PNGs that should be AVIF, unused assets that survive every refactor, inconsistent naming that breaks imports. Manual cleanup doesn't scale.

Aisets fixes this:

- **One scan, full picture** — duplicates, near-duplicates, unused files, lint issues, optimization opportunities, all in one pass
- **AI-powered tagging & OCR** — auto-categorize assets, extract image text, translate tags, and build semantic search indexes
- **Custom asset workflows** — save reusable filters for large images, cleanup candidates, OCR text, AI categories, tags, duplicates, and more
- **Safe actions** — rename, merge duplicates, delete unused files with preview/apply workflow. Nothing changes until you confirm
- **Multi-project aware** — manage assets across repos with project-type-aware analysis (code project, asset pack, library, mixed)
- **Local & private** — single Go binary, SQLite database, no cloud, no telemetry. Your assets never leave your machine

## Product Tour

| Track workspace health                                                                                                                                                                              | Search by meaning, not filenames                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src=".github/assets/readme-projects.png" alt="Aisets Projects view showing scanned assets, optimization opportunities, lint findings, duplicates, OCR, AI tags, and GPS metadata" width="480"> | <img src=".github/assets/readme-command-palette.png" alt="Aisets command palette showing semantic matches for elderly salesperson fraud" width="480"> |

| Turn metadata into reusable workflows                                                                                                                                    | Audit tags and categories                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src=".github/assets/readme-custom-filters.png" alt="Aisets custom filters combining size, OCR, AI category, AI tag, duplicate, and optimization rules" width="480"> | <img src=".github/assets/readme-tags.png" alt="Aisets tag manager showing AI-generated categories and tag coverage across assets" width="480"> |

| Compare similar images side by side                                                                                                | Estimate optimization work                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src=".github/assets/readme-duplicates.png" alt="Aisets duplicate analysis comparing similar PNG and WebP assets" width="480"> | <img src=".github/assets/readme-optimize.png" alt="Aisets optimization view with critical size findings, format conversion, and resize recommendations" width="480"> |

| Check one-off images before import                                                                                                              | Tune AI, OCR, embeddings, and agent CLIs                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src=".github/assets/readme-image-tools.png" alt="Aisets image tools view for checking images before adding them to a project" width="480"> | <img src=".github/assets/readme-ai-settings.png" alt="Aisets AI settings with local LLM, embedding model, agent CLI, tagging, OCR, and semantic indexing controls" width="480"> |

## Installation

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/runkids/aisets/main/install.sh | sh
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/runkids/aisets/main/install.ps1 -UseB | iex
```

Update to the latest version anytime:

```bash
aisets update
```

## Quick Start

```bash
# Add a project and open the UI
aisets ui /path/to/your/project

# Or scan from the CLI
aisets scan /path/to/your/project --json
```

The UI opens at `http://127.0.0.1:5174`. Use `--app` to launch a desktop-style window (Chrome/Edge/Brave).

## Features

### AI Asset Browser

Browse assets with the metadata that usually lives in separate tools:

- AI categories, tags, descriptions, scene signals, and translated labels
- OCR status and searchable image text from VLM or local OCR
- EXIF metadata, GPS privacy signals, image dimensions, file size, format, alpha, and animation
- Project, extension, status, category, custom filter, and optimization facets
- Virtualized grids and lists for large asset catalogs

### Semantic Search & Custom Filters

Use `⌘ P` to jump across pages, assets, saved filters, and semantic results. Aisets can search by natural language over category, tags, descriptions, and OCR text.

Custom Filters turn asset metadata into reusable workflows:

| Workflow                    | Example rules                                               |
| --------------------------- | ----------------------------------------------------------- |
| **Huge optimizable assets** | size >= 1 MB + optimizable                                  |
| **Images with OCR text**    | OCR ready + OCR text matches                                |
| **AI category review**      | category contains Social Issues, Food, UI, Screenshot, etc. |
| **Cleanup candidates**      | duplicate OR near-duplicate OR optimizable                  |

### Scan & Detect

| Feature              | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| **Exact duplicates** | BLAKE3 content hashing identifies 100% identical files across projects               |
| **Near-duplicates**  | Perceptual hashing (dHash) finds visually similar images, including flipped variants |
| **Unused assets**    | Reference tracking across JS/TS/CSS/HTML to find assets no code imports              |
| **Image metadata**   | Dimensions, format, alpha channel, animation, EXIF data extraction                   |
| **Scan diff**        | Compare two scans to see what changed over time                                      |
| **Scan profiles**    | Fast (metadata + duplicates) or Full (+ references, near-duplicates, optimization)   |

### Lint

9 built-in rules catch common asset issues in your codebase:

| Rule                   | Severity | What it catches                                            |
| ---------------------- | -------- | ---------------------------------------------------------- |
| `large-inline-import`  | Critical | `?raw` / `?inline` imports over 10 KB bloating your bundle |
| `missing-lazy-loading` | Warning  | Large `<img>` without `loading="lazy"` or `fetchpriority`  |
| `missing-dimensions`   | Warning  | `<img>` without width/height causing CLS                   |
| `bg-content-image`     | Warning  | Large raster in CSS `background-image` (can't lazy-load)   |
| `no-responsive-image`  | Info     | Raster images over 100 KB without `srcset`                 |
| `svg-as-img`           | Info     | SVG via `<img>` tag (no CSS/animation control)             |
| `img-as-background`    | Info     | Large decorative `<img alt="">` better as CSS background   |
| `duplicate-asset`      | Warning  | Identical files that should be consolidated                |
| `exif-gps-privacy`     | Advisory | Images that still contain GPS metadata                     |

### Optimize

Estimate savings and generate conversion scripts:

- **Format conversion** — PNG → AVIF/WebP, JPEG → AVIF, GIF recompress
- **SVG minification** — via svgo or built-in
- **Resize oversized rasters** — configurable max dimensions
- **7 built-in strategies** — fully customizable thresholds, quality, speed
- **Script generation** — export a bash script using ffmpeg, cwebp, avifenc, gifsicle, or built-in imgtools
- **Preview before apply** — see estimated savings before any file changes

### AI Tagging & OCR

Auto-categorize images and extract text using vision language models:

- **AI Tags** — category, descriptive tags, scene type, face detection, language detection, location estimation
- **AI OCR** — extract text from images via VLM, with 20+ language support
- **Local Tesseract OCR** — offline text extraction for bulk processing
- **Multi-provider** — Ollama, OpenAI-compatible APIs, or agent CLIs (Claude, Codex, Gemini, Cursor, Copilot & more)
- **Semantic search** — build embeddings over tags, descriptions, categories, and OCR text
- **i18n tags** — AI-generated tags are translated across all 5 supported languages
- **Content-hash dedup** — identical images share AI results, no redundant API calls

### Actions

Safe file operations with preview/apply workflow:

| Action               | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| **Rename**           | Move/rename an asset and update all code references     |
| **Merge duplicates** | Keep one copy, redirect all references, delete the rest |
| **Delete unused**    | Remove confirmed unused assets (code-project only)      |

Every action generates a preview first. Apply revalidates source files and rejects stale previews.

### Pre-Check

Verify files before adding them to your project:

- Detect exact and near-duplicate matches against the existing catalog
- Flag naming issues (spaces, uppercase, special characters)
- Suggest optimizations before the file lands in your repo

### Project Types

Choose a project type to control how Aisets interprets usage and safety:

| Type             | Unused detection             | Delete-unused          | Lint     |
| ---------------- | ---------------------------- | ---------------------- | -------- |
| **Code project** | Full reference tracking      | Enabled (with preview) | Full     |
| **Asset pack**   | N/A (assets used externally) | Disabled               | Skipped  |
| **Library**      | "Possibly unused" only       | Disabled               | Advisory |
| **Mixed**        | "Possibly unused" only       | Conditional            | Advisory |

## Commands

```
aisets ui [paths...] [--port PORT] [--app]     Open the UI (background daemon)
aisets ui once [paths...]                       Foreground server (Docker/CI)
aisets ui stop [--port PORT]                    Stop background server
aisets scan [paths...] [--json]                 Scan projects
aisets scans list [--json]                      List scan history
aisets scans diff --base ID --target ID         Compare two scans
aisets pre-check [files...] [--json]            Check files before adding
aisets optimize estimate [ids...] [--json]      Estimate optimization savings
aisets optimize script [ids...] [--json]        Generate optimization script
aisets actions rename preview ...               Preview a rename
aisets actions merge-duplicates preview ...      Preview a duplicate merge
aisets actions delete-unused preview ...         Preview unused deletion
aisets actions apply --preview file.json        Apply a previewed action
aisets projects [add|remove|rename|list]        Manage projects
aisets settings [get|export|import|reset-*]     Manage settings
aisets update [--dry-run] [--force]             Self-update to latest release
aisets version [--json]                         Show version
```

All commands support `--json` for AI agent and automation integration.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                     CLI (Go)                           │
│  cmd/aisets — UI server, scan, actions, pre-check      │
├────────────────────────────────────────────────────────┤
│                  Internal Packages                     │
│  scanner · lint · optimize · actions · agent · ocr     │
│  imageproc · precheck · version · uidist · config      │
├──────────────┬─────────────────────────────────────────┤
│ imgtools     │            SQLite (WAL)                 │
│ (Rust)       │  Catalogs, scans, AI results, settings  │
│ resvg, image │  Read pool (4) + Write pool (1)         │
└──────────────┴─────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│                    UI (React + TypeScript)              │
│  Vite · Tailwind · CVA · @tanstack/react-virtual       │
│  Browse · Duplicates · Lint · Optimize · Tags · Scans  │
│  NDJSON streaming · Virtual scrolling · Dark/Light     │
└────────────────────────────────────────────────────────┘
```

- **Go backend** — single binary, embedded or downloaded UI, NDJSON streaming for real-time scan progress
- **Rust imgtools** — image probing, hashing, format conversion, SVG rasterization (resvg). Falls back to Go when unavailable
- **SQLite WAL** — concurrent reads during writes, separated read/write pools
- **React UI** — virtual scrolling for 10k+ assets, faceted filtering, keyboard-driven command palette

## Development

```bash
# Build the CLI
go build -o bin/aisets ./cmd/aisets
./bin/aisets ui /path/to/project --no-open

# UI development (Vite + HMR)
cd ui && pnpm install && pnpm run dev
```

The Go server runs on `127.0.0.1:19520` by default. Vite proxies `/api` to it.

### Sharing & Remote Access

Share the dashboard over the network or internet. Pick the method that fits your setup:

**Quick tunnel** — no config, public URL in seconds:

```bash
aisets ui --host 0.0.0.0 --no-open

# ngrok
ngrok http 19520

# Cloudflare (no account needed for temporary tunnels)
cloudflared tunnel --url http://localhost:19520
```

**Cloudflare with custom domain** — persistent tunnel:

```bash
cloudflared tunnel create aisets
cloudflared tunnel route dns aisets assets.example.com
cloudflared tunnel run --url http://localhost:19520 aisets
```

**Reverse proxy (sub-path)** — host alongside other services on the same domain:

```bash
aisets ui --base-path /aisets --host 0.0.0.0 --no-open
# or: AISETS_UI_BASE_PATH=/aisets aisets ui --host 0.0.0.0 --no-open
```

```nginx
# Nginx
location /aisets/ {
    proxy_pass http://127.0.0.1:19520;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

```
# Caddy
handle_path /aisets/* {
    reverse_proxy 127.0.0.1:19520
}
```

> **Note:** The dashboard reads files from the host filesystem. Anyone with the URL can browse scanned project assets.

### Devcontainer

```bash
make devc        # Start devcontainer and enter shell
ui /workspace    # Start Go API (Air hot reload) + Vite UI
```

Open `http://127.0.0.1:5174` from the host browser.

### Rust imgtools

```bash
cd tools/imgtools
cargo build --release
```

### Running Tests

```bash
go test ./...                              # Go tests
pnpm --dir ui test                         # UI tests
cargo test --manifest-path tools/imgtools/Cargo.toml  # Rust tests
```

## Safety

File-changing operations use a preview/apply model. Apply revalidates source files before writing and rejects stale previews. CLI accepts preview JSON from a file or stdin via `--preview -`.

## License

[MIT](LICENSE) © Willie
