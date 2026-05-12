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
| `react-ui-components.md` | UI primitives, layout patterns, settings, Rail, drawer, toast, icons |
| `react-data-patterns.md` | Filtering, facets, virtual scroll, lazy load, React Query, portals |
| `react-streaming.md` | NDJSON streaming, background activities, navigation badges |
| `go-conventions.md` | General Go, testing, file splitting, struct vs DB, derived fields |
| `go-sqlite.md` | Read/write pools, batch TX, query optimization, SQL patterns |
| `go-catalog-scan.md` | Scan intent, catalog enrichment, batch/detail parity |
| `go-ai-vlm.md` | AI tags, OCR, VLM backend, embeddings, i18n backfill, quality gates |
| `go-imageproc.md` | imgtools-first, SVG resvg, HEIC goheif, vlm-normalize fallback |
| `rust-imgtools.md` | CLI integration tests, svg-to-png, Go wrapper, CI |
| `commit-verification.md` | Devcontainer, UI/backend commit checklists, CI, air hot-reload |

---

## 3. Quick links

| Resource | Path |
|----------|------|
| Design system spec | `DESIGN.md` |
| **UI rules (auto-loaded skill)** | `.claude/skills/design-system.md` |
| **Project rules** | `.claude/rules/` |
| Go domain packages | `internal/scanner`, `internal/lint` |
