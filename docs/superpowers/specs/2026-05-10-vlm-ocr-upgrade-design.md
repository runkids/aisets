# #20 VLM-OCR Upgrade

**Date**: 2026-05-10
**Status**: Approved
**Scope**: `internal/server/`, `internal/config/`, `internal/ocr/`, `ui/src/components/settings/`, `ui/src/`, i18n locales
**Depends on**: #23 LLM Provider Architecture (completed), #26 AI Auto-Tagging (completed)

## Problem

Tesseract CLI OCR has poor accuracy on code screenshots, complex layouts, mixed-language text, and non-Latin scripts. It requires a separate binary installation and language pack downloads. Users who already have an LLM provider configured (Ollama/LM Studio) should be able to use a vision model for significantly better text extraction — one VLM call replaces Tesseract's multi-mode fallback pipeline.

## Solution

Add a VLM-based OCR engine that runs alongside the existing Tesseract OCR:

- **AI Settings page** gets a new "AI OCR" card (next to "AI 標記") with its own Run/Stop button
- **VLM results override Tesseract results** — catalog queries prefer `engine_name='vlm'` over `'tesseract-cli'`
- **Tesseract stays untouched** — users without an LLM provider still have offline OCR in the Scanning section
- **Language detection** included in both VLM-OCR and AI Tag results

## Architecture

```
Settings → AI page:
┌─────────────────────────────────┐
│ AI Settings (Provider/Model)    │
├─────────────────────────────────┤
│ AI 標記 (existing)              │
├─────────────────────────────────┤
│ AI OCR (NEW)                    │
│ desc: 使用視覺模型辨識圖片中的 │
│ 文字，準確度優於傳統 OCR        │
│                  [▶ 執行 AI OCR] │
└─────────────────────────────────┘

Settings → Scanning page:
┌─────────────────────────────────┐
│ Tesseract OCR (unchanged)       │
└─────────────────────────────────┘
```

### Result Priority

Catalog enrichment query (`enrichCatalogOCR`) changes from single-row lookup to priority-based:

```sql
SELECT * FROM ocr_results
WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND status = 'ready'
ORDER BY CASE engine_name WHEN 'vlm' THEN 0 ELSE 1 END
LIMIT 1
```

If a VLM result exists, it wins. Otherwise Tesseract result is used. Downstream search, filters, and Drawer read the same `text`/`normalized_text` fields — zero changes needed.

## Data Model

### `ocr_results` table — no schema change

VLM-OCR writes to the existing `ocr_results` table with:

| Field | VLM value |
|-------|-----------|
| `engine_name` | `"vlm"` |
| `engine_version` | `"{provider}/{model}"` (e.g. `"openai-compat/gemma-4-e4b-it"`) |
| `settings_hash` | Hash of `prompt_version + model_name` |
| `text` | Raw extracted text (preserving layout) |
| `normalized_text` | Lowercased, whitespace-normalized |
| `languages_json` | `["eng","zho"]` — detected by VLM |
| `text_status` | `"available"` or `"empty"` |
| `mode` | `"vlm"` |
| `attempts` | `1` |

Cache key: `content_hash + hash_algorithm + 'vlm' + engine_version + settings_hash`. Same content + same model + same prompt version → cache hit.

### `ai_tags` table — add `languages_json` column

```sql
ALTER TABLE ai_tags ADD COLUMN languages_json TEXT NOT NULL DEFAULT '[]';
```

AI Tag prompt gains a `"languages"` field. Stored alongside category/tags/description.

## VLM Prompts

### VLM-OCR Prompt

```
PromptVersion = "aisets-vlm-ocr-v1"
```

```
Analyze this image and respond with a JSON object:
- "text": all visible text exactly as it appears, preserving original layout, line breaks, indentation and formatting. If the image contains code, preserve indentation exactly. Empty string if no text is visible.
- "languages": array of ISO 639-3 language codes detected in the text (e.g. ["eng"], ["zho", "eng"]). Empty array if no text.

Respond ONLY with valid JSON, no markdown or explanation.
```

### AI Tag Prompt — updated

```
PromptVersion = "aisets-tag-v2"  (bumped from v1)
```

```
Analyze this image and respond with a JSON object containing:
- "category": one of "icon", "photo", "screenshot", "diagram", "illustration", "pattern", "logo", "banner"
- "tags": array of 3-8 descriptive tags in lowercase kebab-case
- "description": one sentence describing the image content
- "languages": array of ISO 639-3 language codes for any visible text (e.g. ["eng"]). Empty array if no text.

Respond ONLY with valid JSON, no markdown or explanation.
```

Bumping `PromptVersion` to `v2` invalidates all v1 cache entries — next AI Tag run re-analyzes everything with the new prompt.

## Processing Pipeline

### Endpoint

`POST /api/ai/ocr/run` — NDJSON stream, identical format to `/api/ai/tag/run`:

```json
{"type": "start", "counts": {"queued": 100, "processed": 0, "ready": 0, "failed": 0, "skipped": 0, "cacheHit": 0}}
{"type": "progress", "assetId": "abc", "repoPath": "src/logo.png", "status": "ready", "counts": {...}}
{"type": "done", "counts": {...}}
```

### Handler — `internal/server/vlm_ocr_handlers.go`

Follows `aitag_handlers.go` pattern exactly:

1. Validate `LLMEnabled`, `LLMProvider`, `LLMVisionModel`
2. Load catalog, filter eligible items (same as AI Tag: supported formats, not animated, has dimensions, ≤20MB)
3. Check cache: `ocr_results` with matching content_hash + engine='vlm' + engine_version + settings_hash + status=ready → skip
4. Deduplicate by content hash (process once, copy to all items with same hash)
5. For each item:
   a. `prepareImageForVLM(localPath, ext)` — AVIF/SVG → PNG, others with correct MIME
   b. Call `s.llmProvider.Chat(ctx, req)` with OCR prompt
   c. Parse JSON → extract text + languages
   d. Compute `normalized_text` via `ocr.NormalizeText()`
   e. Determine `text_status`: empty text → `"empty"`, otherwise `"available"`
   f. Upsert `ocr_results` with engine_name='vlm'
6. Stream progress as NDJSON

### Format Support (broader than Tesseract)

| Format | Tesseract | VLM-OCR |
|--------|-----------|---------|
| PNG/JPG/WebP | ✅ | ✅ |
| AVIF | ❌ | ✅ (convert to PNG) |
| SVG | ❌ | ✅ (rasterize to PNG) |
| GIF (static) | ❌ | ✅ |

Uses existing `prepareImageForVLM()` from `aitag_handlers.go`.

## Frontend

### Activity State Machine — `ui/src/vlmOcrActivity.ts`

Copy of `aiTagActivity.ts` with renamed types: `VLMOcrActivityState`, `VLMOcrActivityAction`, etc. Same phases: idle → saving → running → stopping → done/stopped/error. Includes `currentFile` for progress display.

### AI Settings Page — new Card

Third card in AISection after "AI 標記":

- Card header: `ScanText` icon + "AI OCR"
- FieldRow with label + description explaining VLM-OCR benefits
- Run/Stop button + progress text + current file path
- Disabled when vision model not selected
- Layout identical to AI Tag card (FieldRow + `align="start"` + right-aligned controls)

### AppTopbar ActivityDropdown

Add VLM-OCR activity indicator alongside existing OCR and AI Tag indicators. Icon: `ScanText`.

### Props Threading

`App.tsx`:
- New `useReducer` for `vlmOcrActivity`
- New `onStartVLMOcr`, `onStopVLMOcr` callbacks
- Pass to `SettingsView` → `AISection`
- Pass activity state to `AppTopbar`

`AISection.tsx`:
- Accepts `vlmOcrActivity`, `onStartVLMOcr`, `onStopVLMOcr` props
- Renders third Card with progress text component

### Clear Cache

Existing "清除 OCR 快取" button calls `DELETE FROM ocr_results` — clears both Tesseract and VLM results. No change needed.

## API

### New endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ai/ocr/run` | Run VLM-OCR, NDJSON stream |

### Modified behavior

| Endpoint | Change |
|----------|--------|
| `GET /api/catalog/items` | OCR enrichment prefers engine='vlm' over 'tesseract-cli' |

## i18n

New keys (zh-TW examples):

```
settings.vlmOcrGroup: "AI OCR"
settings.vlmOcrDescription: "使用視覺模型辨識圖片中的文字，準確度優於傳統 OCR，適合程式碼截圖、複雜排版與多語混排"
settings.vlmOcrRun: "執行 AI OCR"
settings.vlmOcrStop: "停止"
settings.vlmOcrStopping: "正在停止…"
settings.vlmOcrSaving: "儲存設定中…"
settings.vlmOcrDone: "完成（{{ready}} 已辨識、{{skipped}} 已略過、{{cacheHit}} 快取命中）"
settings.vlmOcrStopped: "已停止"
settings.vlmOcrFailed: "辨識失敗"
activity.vlmOcrTitle: "AI OCR"
activity.vlmOcrRunning: "正在辨識…"
activity.vlmOcrDone: "辨識完成"
```

All 5 locales (zh-TW, en, ja, ko, zh-CN).

## Scope Exclusions

- **No changes to Scanning → OCR section** — Tesseract stays as-is
- **No new Settings UI for VLM-OCR options** — uses existing AI provider/vision model
- **No concurrent VLM calls** — single worker, same as AI Tag
- **No batch continuation** — single run processes all eligible items (unlike Tesseract's multi-batch)
- **No OCR confidence score from VLM** — VLM doesn't produce confidence; field left as 0

## Testing

- Go: handler test with mock LLM provider, verify `ocr_results` upsert with engine='vlm'
- Go: catalog enrichment test verifying VLM result takes priority over Tesseract
- Go: AI Tag prompt version bump test verifying cache invalidation
- Go: `ai_tags` migration test for new `languages_json` column
- Frontend: build passes, activity state machine unit tests
