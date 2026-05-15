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

### 2.1 Verification conventions

- **Devcontainer Go tests must use an executable temp directory.** The devcontainer mounts `/tmp` as tmpfs and it can behave like a noexec temp target for Go test binaries. When `go test` fails with `fork/exec /tmp/go-build... permission denied`, rerun inside the container with `GOTMPDIR=/workspace/tmp/go-tmp` and `GOCACHE=/workspace/tmp/go-cache` after creating those directories, instead of treating it as a code failure.

### 2.2 Captured AI Canvas conventions

- **Canvas upload tokens must survive chat retries and server restarts.** Canvas cards persist upload tokens in session state, so uploaded images used by VLM/OCR must be stored as persistent downloads and restored through `peekImageToolDownload`; in-memory-only temp files make later OCR fail with stale token errors.
- **Terminal canvas tool results must not be followed by model prose.** User-facing safe tools such as `extract_ocr_text` already produce the final answer surface. Suppress same-response LLM prose after these results, otherwise stale reasoning gets appended and can contradict the actual tool error.
- **Canvas OCR targets are mixed identity types.** Catalog images use `assetIds`, while uploaded canvas images use `cardIds`; composer target counts, prompt target descriptions, tool schema, and backend resolvers must all support both or OCR silently ignores uploads.
- **Canvas captures must render every image-card source.** Screenshot/export and AI snapshot code must collect rendered frames from both catalog asset cards and uploaded image cards through a shared image-frame marker, not asset-only selectors. Otherwise uploaded images are visible on the canvas but disappear from captures and AI visual context.
- **Normalize provider errors before presenting OCR results.** OpenAI-compatible backends may wrap useful failures inside JSON error bodies. Extract the provider `error.message` for per-image OCR output so the user sees the actionable cause instead of repeated raw transport payloads.
- **Canvas VLM repair loops must use deterministic compact follow-up prompts.** The first Canvas VLM round can include the full prompt, images, and canvas state, but later rounds must be built by backend code from the original user request, explicit loop reason, relevant card IDs/positions, compact tool results, and one precise next-step instruction. Do not append raw tool results, status narration, or broad plan prose; prompt payloads grow quickly and make local models drift into repeated focus/select calls instead of executing the requested canvas operation.
- **Canvas confirmation tools are not completion.** `focus_card`, `select_cards`, and `inspect_canvas` can be valid target-confirmation steps, but they must not satisfy manipulation requests by themselves. A multi-round Canvas flow must either resolve a specific target/layout uncertainty or call a concrete operation tool such as `resize_card`, `move_card`, or `arrange_cards`; otherwise local VLMs can loop forever on preparatory tools while the canvas never changes.
- **Canvas tool-use progress must be visible.** Backend repair/confirmation loops should emit concise stream status events for target confirmation, planning, and operation phases, and the frontend must render short, truncated labels in the cursor/status surface rather than the normal assistant transcript. Long backend status text can cover the canvas and make the cursor feel broken; invisible backend loops make the AI look stuck even when it is confirming targets correctly.
- **Canvas cursor labels are transient operation chrome.** AI cursor labels for dragging, resizing, confirming, or applying work must be cleared from a single completion path after all scheduled animations settle. Nested timers can update the cursor after the request finishes, so cleanup must account for projected animation duration, not only timers already queued.
- **Canvas fallback action parsers are compatibility layers.** When local models emit non-contract formats such as `call:`, `[action: ...]`, or `Action: ...`, parse only bounded observed shapes, normalize aliases through the registry schema, and keep the same safety/proposal guardrails. Target inference must use model-confirmed card IDs, explicit selection intent, or exact canvas metadata matches; do not add multilingual object synonym dictionaries in backend fallback code, because they only solve one prompt and can mis-target future requests. Do not promote loose text grammars into the prompt contract or execute unknown tools directly.
- **Visual emphasis requests require region actions, not prose.** Requests to circle, mark, highlight, point out, or "draw the key points" on any visual surface -- images, slides, PDFs, screenshots, charts, or UI captures -- must execute a region-bearing tool for each distinct target. If a repair loop discovers a missing visual mark, keep the repair state sticky and narrow the available tools to the exact marking tool until that action succeeds; otherwise local VLMs can waste the remaining loop budget on focus/prose and appear done without drawing anything.
- **Canvas AI contracts stay English-only.** Every AI-facing prompt, system prompt, follow-up/repair prompt, tool schema, tool argument, label, description, impact, stream status code, and action metadata must be English and structured, even when the user writes in another language. Define response formats that separate machine fields from display text, then localize only assistant prose and UI-visible status/reply strings at the display boundary through i18n/settings. Do not add hard-coded non-English intent, synonym, count/unit, or fallback phrase matching in Go or TypeScript; it turns one language into hidden business logic and makes other locales drift.
- **Canvas asset payloads must be self-contained.** AI-readable canvas snapshots and compact tool results must include file name, repo path, project, image format/dimensions/bytes, visual `url`/`thumbnailUrl`, AI tag summaries, OCR text when available, and stable IDs. Sending only IDs forces the model or frontend into extra lookups and makes image-description tasks fail after search/add tools.
- **Canvas tool loops need a terminal answer phase.** After tools have completed the state change, the loop must either let the model answer from compact results or emit a deterministic reply from structured tool results. Do not keep calling layout/focus tools just because no prose has been streamed; localized natural-language replies are the display layer, not part of the tool contract.
- **Keep intentional multilingual display data explicit.** Language names, OCR/language aliases, Unicode language detection regexes, and deliberate semantic loading phrase arrays such as `SEMANTIC_PHASES` may contain native-language text because the text itself is the data being displayed or matched. Do not use those exceptions for AI prompts, tool metadata, status codes, or intent routing.
- **Retain Canvas follow-up images only for visual repair.** Drop images from ordinary follow-up rounds after the first VLM call, but keep them for missing capture repair or explicit visual inspection/comparison requests. Always keeping images makes manipulation loops expensive; always dropping them prevents the model from correcting look-at-image failures.
- **Animate Canvas card motion outside React state until commit.** AI-driven card moves and drag previews should run on `requestAnimationFrame` with direct DOM `transform` updates, then commit `cards` state once at the end. Updating React state every animation step can re-render the Canvas with stale card coordinates and make images jitter or snap backward.
- **Run locale parity checks when requested locales should be complete.** When adding user-visible i18n keys for a surface that is already translated across locales, or when explicitly asked to fill the other languages, compare every locale against `en` and validate placeholder parity before finishing. Otherwise non-English users silently fall back to English or miss translated UI copy.

### 2.3 File size conventions

- **Keep source files under 1,000 lines.** Split files before they exceed 1,000 lines so code stays reviewable and navigable. If a file must exceed this limit for a specific reason, add a file-level comment explaining why the exception is necessary.

---

## 3. Quick links

| Resource | Path |
|----------|------|
| Design system spec | `DESIGN.md` |
| **UI rules (auto-loaded skill)** | `.claude/skills/design-system.md` |
| **Project rules** | `.claude/rules/` |
| Go domain packages | `internal/scanner`, `internal/lint` |
