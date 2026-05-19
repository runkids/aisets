<p align="center">
  <img src="./ui/public/brand/aisets-logo.png" alt="Aisets" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://github.com/runkids/aisets/releases"><img src="https://img.shields.io/github/v/release/runkids/aisets" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue" alt="Platform">
  <a href="https://deepwiki.com/runkids/aisets"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

<p align="center">
  <a href="https://github.com/runkids/aisets/stargazers"><img src="https://img.shields.io/github/stars/runkids/aisets?style=social" alt="Star on GitHub"></a>
</p>

<p align="center">
  <strong>The local-first image library auditor.</strong><br>
  Drop in any folder of assets — find duplicates, optimize sizes, search by meaning, and stage them on an AI canvas.
</p>

<p align="center">
  <a href="#ai-canvas">AI Canvas</a> •
  <a href="#features">Features</a> •
  <a href="#install">Install</a> •
  <a href="#product-tour">Tour</a>
</p>

## AI Canvas

Asset review as a shared visual workspace, not a list of files. Ask an agent to gather related images, compare candidates, zoom into details, arrange evidence, mark what matters, capture the board, and explain the decision — so cleanup, design review, and content audits become easier to trust.

<p align="center">
  <a href=".github/assets/readme-ai-canvas-toy-shop-demo.mp4">
    <img src=".github/assets/readme-ai-canvas-toy-shop-demo.gif" alt="AI Canvas staging cute image assets into a toy-shop composition with Codex CLI" width="960">
  </a>
</p>

<p align="center">
  <a href=".github/assets/readme-ai-canvas-toy-shop-demo.mp4"><strong>Watch the full AI Canvas demo</strong></a>
</p>

## Features

### Audit & cleanup

- **Duplicate detection** — exact and visually-similar groups across any folder hierarchy.
- **Safe optimization** — preview savings before converting; spot oversized rasters, heavy GIFs, missing responsive variants, and high-impact format conversions.
- **Unused-file detection** — for code projects, find assets nothing references, with project-type awareness so asset packs and libraries are not misjudged.
- **Preview → confirm → apply** — every destructive action is reviewable; apply rechecks files so stale previews are rejected.

### AI metadata

- **AI tagging** — categories, descriptive tags, scene hints, face/language signals, and translated labels.
- **AI OCR** — extract text from screenshots, memes, product shots, documents, and mixed-language images.
- **Semantic search** — find images by intent ("login screen", "receipt photo", "old hero banner"), not just filenames.
- **Content-aware filters** — combine size, OCR text, AI category, tags, duplicate status, and optimization potential into reusable filters.

### AI Canvas

- **Visual workspace** — gather, compare, mark, and stage assets on an infinite canvas.
- **Agent-driven layout** — ask Codex CLI, Claude Code, Pi, Cursor, Gemini, or Copilot CLI to arrange assets, annotate regions, and create variants.
- **Reviewable output** — capture the board as evidence for cleanup, design review, or content audits.

### Local-first by design

- **Runs on your machine** — your assets never leave unless you explicitly point AI at an external provider.
- **Bring your own AI** — local OpenAI-compatible runtimes (Ollama, LM Studio), installed agent CLIs, or compatible cloud providers.
- **No login, no telemetry, no SaaS lock-in.**

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/runkids/aisets/main/install.sh | sh
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/runkids/aisets/main/install.ps1 -UseB | iex
```

## Quick Start

```bash
# Open the dashboard on the default local port (19520)
aisets ui

# Or choose a port; Aisets remembers it for later UI commands
aisets ui --port 3003

# Stop the remembered UI instance
aisets ui stop

# Stop a specific port explicitly
aisets ui stop --port 3003
```

The dashboard opens locally in your browser. If you start it with a custom `--port`, later `aisets ui` and `aisets ui stop` commands reuse that remembered local UI instance unless you pass another `--port`.

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

### Update & Uninstall

```bash
# Update anytime
aisets update

# Uninstall the CLI
sudo rm -f /usr/local/bin/aisets

# Optional: remove local data and cache
rm -rf ~/.local/share/aisets ~/.cache/aisets
```

If you installed to a custom `INSTALL_DIR`, remove `aisets` from that directory instead of `/usr/local/bin`.

## Product Tour

| Track workspace health                                                                                                                                                                              | Search by meaning, not filenames                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src=".github/assets/readme-projects.png" alt="Aisets Projects view showing scanned assets, optimization opportunities, lint findings, duplicates, OCR, AI tags, and GPS metadata" width="480"> | <img src=".github/assets/readme-command-palette.png" alt="Aisets command palette showing semantic matches for elderly salesperson fraud" width="480"> |

| Compare similar images side by side                                                                                                | Estimate optimization work                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src=".github/assets/readme-duplicates.png" alt="Aisets duplicate analysis comparing similar PNG and WebP assets" width="480"> | <img src=".github/assets/readme-optimize.png" alt="Aisets optimization view with critical size findings, format conversion, and resize recommendations" width="480"> |

<details>
<summary><strong>More screenshots</strong> — custom filters, tag manager, image tools, AI settings</summary>

<br>

| Turn metadata into reusable workflows                                                                                                                                    | Audit tags and categories                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src=".github/assets/readme-custom-filters.png" alt="Aisets custom filters combining size, OCR, AI category, AI tag, duplicate, and optimization rules" width="480"> | <img src=".github/assets/readme-tags.png" alt="Aisets tag manager showing AI-generated categories and tag coverage across assets" width="480"> |

| Check one-off images before import                                                                                                              | Tune local AI and agent CLIs                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src=".github/assets/readme-image-tools.png" alt="Aisets image tools view for checking images before adding them to a project" width="480"> | <img src=".github/assets/readme-ai-settings.png" alt="Aisets AI settings with local LLM, embedding model, agent CLI, tagging, OCR, and semantic indexing controls" width="480"> |

</details>

## License

[MIT](LICENSE) © Willie
