# Aisets — Project Instructions

> Project-level context for Claude Code. Loaded automatically on every session in this repo.

---

## 1. What this project is

Aisets is a Go-backed local web tool for auditing image / asset hygiene in a codebase: scan, detect duplicates, find unused, optimize, lint. The UI is a Vite + React + TypeScript + Tailwind/CVA application under `ui/` consumed by the Go binary under `cmd/` + `internal/`.

| Layer | Tech | Path |
|-------|------|------|
| CLI / server | Go | `cmd/`, `internal/` |
| Web UI | React + TypeScript + Tailwind + CVA | `ui/src/` |
| Styling | CSS custom properties + Tailwind `@theme` + CVA | `ui/src/styles/`, `ui/src/components/ui/` |

---

## 2. Rules

All stack-specific rules and conventions live in `.skillshare/extras/rules/` and are synced to `.claude/rules/` automatically.

| Rule file | Scope |
|-----------|-------|
| `react-i18n.md` | i18n code-first, CJK punctuation, key hygiene, locale scope, fallbacks |
| `react-ui-components.md` | UI primitives, layout patterns, settings, Rail, drawer, toast, icons, feature refactors |
| `react-data-patterns.md` | Filtering, facets, virtual scroll, lazy load, React Query, portals, effect dependencies |
| `react-streaming.md` | NDJSON streaming, background activities, navigation badges |
| `react-canvas.md` | Canvas card integration checklist, type guards, comment overlay, upload cards, event handlers |
| `go-conventions.md` | General Go, testing, file splitting, struct vs DB, derived fields |
| `go-sqlite.md` | Read/write pools, batch TX, query optimization, SQL patterns |
| `go-catalog-scan.md` | Scan intent, catalog enrichment, batch/detail parity |
| `go-ai-vlm.md` | AI tags, OCR, VLM backend, embeddings, i18n backfill, quality gates |
| `go-imageproc.md` | imgtools-first, SVG resvg, HEIC goheif, vlm-normalize fallback |
| `rust-imgtools.md` | CLI integration tests, svg-to-png, Go wrapper, CI |
| `commit-verification.md` | Devcontainer, UI/backend commit checklists, CI, air hot-reload |

### 2.1 Captured AI Canvas conventions

- **Canvas upload tokens must survive chat retries and server restarts.** Canvas cards persist upload tokens in session state, so uploaded images used by VLM/OCR must be stored as persistent downloads and restored through `peekImageToolDownload`; in-memory-only temp files make later OCR fail with stale token errors.
- **Terminal canvas tool results must not be followed by model prose.** User-facing safe tools such as `extract_ocr_text` already produce the final answer surface. Suppress same-response LLM prose after these results, otherwise stale reasoning gets appended and can contradict the actual tool error.
- **Canvas OCR targets are mixed identity types.** Catalog images use `assetIds`, while uploaded canvas images use `cardIds`; composer target counts, prompt target descriptions, tool schema, and backend resolvers must all support both or OCR silently ignores uploads.
- **Normalize provider errors before presenting OCR results.** OpenAI-compatible backends may wrap useful failures inside JSON error bodies. Extract the provider `error.message` for per-image OCR output so the user sees the actionable cause instead of repeated raw transport payloads.

### 2.2 File size conventions

- **Keep source files under 1,000 lines.** Split files before they exceed 1,000 lines so code stays reviewable and navigable. If a file must exceed this limit for a specific reason, add a file-level comment explaining why the exception is necessary.

---

## 3. Quick links

| Resource | Path |
|----------|------|
| Design system spec | `DESIGN.md` |
| **UI rules (auto-loaded skill)** | `.claude/skills/design-system.md` |
| **Project rules** | `.claude/rules/` |
| Go domain packages | `internal/scanner`, `internal/lint` |
