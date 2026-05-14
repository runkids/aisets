# React / TypeScript — AI Canvas

## Card Type Integration Checklist

- **New card types must participate in all canvas systems.** Adding a card `kind` (e.g. `upload`) requires updates across every canvas subsystem — not just rendering. Checklist:
  1. **Type union:** add to `CanvasCard` in `aiCanvasState.ts`, with `normalizeCard` + `cardDisplayName` branches
  2. **Rendering:** add `XxxCardBody` in `canvasCards.tsx` + branch in `AICanvasStage.tsx`
  3. **Layer system:** `hideCards` filter must include the new kind if it shows visual content (`isImageCard` guard)
  4. **Compact mode:** compact flag must apply if the new kind is image-like
  5. **Resize:** `onResize` callback must include the new kind if resizable (use `isImageCard`)
  6. **Comment connectors:** `commentConnectors` useMemo anchor map must include the new kind if commentable
  7. **Comment overlay:** use `useCommentOverlay` hook if the card supports annotations
  8. **Selection bounds:** `cardLayoutMetrics` compact height must include the new kind
  9. **Border tone:** add case in `cardTone()` in `canvasUtils.tsx`
  10. **Entry animation:** `CardShell` animates all new cards via `isNewCard` — no per-kind work needed
  11. **Snapshot serialization:** `serializeCanvasSnapshot` in `canvasChat.ts` must serialize kind-specific fields (e.g. `uploadToken`)
  12. **Backend chat:** `handleCanvasChat` must resolve the new card's data (e.g. upload token → image path) and `buildCanvasUserPrompt` must describe it

  Missing any subsystem causes silent bugs: cards that vanish on layer toggle, can't receive comments, don't resize, etc.

## Type Guards and Constants

- **Card kind checks use `isImageCard` type guard.** Replace scattered `card.kind === "asset" || card.kind === "upload"` with `isImageCard(card)` from `canvasUtils.tsx`. When adding a new image-like card kind, update `isImageCard` once instead of hunting 6+ call sites. The function also serves as a TypeScript type guard (`card is AssetCanvasCard | UploadCanvasCard`).
- **`@aisets` mention tag/regex are shared constants.** `AI_MENTION_TAG`, `AI_MENTION_COMMENT_RE`, `AI_MENTION_COMMENT_RE_G` in `canvasUtils.tsx` are the single source of truth. The composer, comment overlay, and chat handler all derive from these — never hardcode `"@aisets"` or `/@aisets/` inline.

## Comment Overlay

- **Comment overlay logic uses `useCommentOverlay` hook.** `AssetCardBody` and `UploadCardBody` both support Figma-style region annotations. The shared `useCommentOverlay` hook in `canvasCards.tsx` encapsulates region drawing, pending comment form, `@aisets` mention suggestion, and comment composer styling. Do not duplicate this logic per card body — any new commentable card type hooks into it.
- **`CommentRegionButtons` is the shared overlay renderer.** Pinned comment region overlays (colored rectangles with click-to-select) are rendered by `CommentRegionButtons`. New card bodies that display comment regions import this component instead of reimplementing the overlay loop.
- **Cards with comment overlays need `overflow-visible`.** Comment overlays (the pending form, `@aisets` suggestion popup) render outside the card's bounding box. If `CardShell` uses `overflow-hidden`, overlays are clipped. Use `overflow-visible` for image-like cards that support comments.
- **Comment annotations don't scale with canvas zoom.** The comment composer form and annotation markers use `scale(1/canvasScale)` via `transform-origin: top left` so they stay readable at any zoom level. The underlying region highlight (percentage-based rectangle) does scale with the image.

## Upload Cards

- **Upload card images use the full-quality preview endpoint.** Display `/api/image-tools/preview/{token}` as the `<img>` src, with `thumbnailDataUrl` as the fallback `onerror` source. The thumbnail is a compressed base64 data URL (~80px) used only during token expiry or initial load — never as the primary display.
- **Upload card tokens follow the imageToolDownloads pattern.** Backend `storeImageToolDownload` stores temp file metadata with a 1-hour TTL token. Frontend creates `UploadCanvasCard` with `{token, thumbnailDataUrl, fileName, uploadWidth, uploadHeight}`. Canvas chat resolves tokens via `peekImageToolDownload` to get the temp file path for VLM.

## Event Handlers

- **Paste handlers use ref pattern for stable closure.** Document-level paste/keyboard listeners registered in `useEffect` with `[]` deps must access mutable state through a ref (`cardsRef.current = cards`) instead of closing over state directly. This avoids re-registering listeners on every state change and prevents stale closure bugs.
- **Entry animation: cache Date in useState initializer.** `CardShell` uses `useState(() => Date.now() - Date.parse(card.createdAt) < 1000)` to determine if a card is new. The arrow-function initializer runs once per mount — never re-evaluate `Date.parse` on every render. This matters because `cards.map(...)` re-renders all cards on any card array change.

## Canvas Tool System

- **Safe vs confirmation tools.** Canvas tools in `canvasToolRegistry` are either `Safe: true` (executed immediately, result fed back to LLM) or `Safe: false` (creates a proposal card for user approval). Layout tools (`move_card`, `arrange_cards`) are safe; destructive tools or tools that modify assets require confirmation.
- **AI-generated comments are distinguished by `isAi` flag.** When the AI creates a comment via `create_comment` tool, set `isAi: true` on the `CommentCanvasCard`. This drives the purple border tone (`border-g-purple/50`) to visually distinguish AI annotations from user annotations (`border-g-amber/50`).
