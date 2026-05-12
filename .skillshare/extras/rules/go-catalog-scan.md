# Go — Catalog & Scan Domain

## Scan Intent

- **Project scan intent is authoritative.** Each project has a `scanIntent` (`code`, `assetPack`, `library`, `mixed`) that controls how references, unused files, and reference-lint are interpreted. Do not infer deletion safety from `usedBy.length === 0` or `references.length === 0`.
- For catalog items, use backend policy fields: `usageClassification`, `deleteUnusedAllowed`, and `lintApplicability`. UI filters, badges, drawers, actions, and custom filters must consume these fields instead of recomputing safe-unused state.
- `unusedFiles` means safe delete-unused candidates only. Advisory or not-applicable counts belong in `possiblyUnusedFiles` and `usageNotApplicableFiles`. Asset packs skip reference-dependent analysis; library, mixed, and partial-coverage code projects can show "possibly unused" but must not enable delete-unused.
- When project `scanIntent` changes, treat reference-dependent catalog state as stale and require a rescan before enabling unused/delete-unused behavior. Persist and compare scan-time intent where scan history or diff logic depends on unused transitions.

## Catalog Enrichment

- **Catalog enrichment queries must use the same provider/model keys as the write path.** `enrichCatalogOCR` and `enrichCatalogAITag` look up results by `engine_version` (provider+model). When agent mode writes `"agent:codex/default"` but the enrichment query uses `"openai-compat/gemma-4-e4b-it"`, results silently return empty — cards show success but no data. Both paths must call `resolveVLMProviderForFeature` to derive consistent keys.
- **Filter, enrichment, and facet scope must be identical for cross-table JOINs.** When a catalog query JOINs or EXISTS against `ai_tags`, `ocr_results`, or any per-model table, the WHERE filter, the `enrich*` display function, and the facet count query must all apply the same scope (cross-model or model-specific). A mismatch causes items to appear in filtered results without badges (enrichment misses them) or facet counts that don't match the actual filtered total.
