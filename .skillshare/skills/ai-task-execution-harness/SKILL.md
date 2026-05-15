---
name: ai-task-execution-harness
description: Build, debug, and harden AI task-execution workflows that must call tools accurately across native OpenAI-style tool calling, Codex/Claude Code/Pi-style CLI agents, and local LLMs on mid-range machines. Use when designing or fixing prompts, tool schemas, action-block fallbacks, validation matrices, VLM image grounding, canvas/file/tool orchestration, AI harnesses, or recurring test-improve-learn loops where AI must execute multi-step tasks reliably instead of answering with prose.
---

# AI Task Execution Harness

Use this skill to turn AI execution quality into an engineering loop: define the exact tool contract, test one real task at a time, fix the product path, and capture the rule that prevents the same failure from returning.

## Operating Loop

1. Define a fixed validation matrix before editing. Each case must include the user request, required tool sequence, forbidden behavior, and visible UI or data result.
2. Run exactly one case at a time. Clear prior chat/input state before sending the next request so previous model text does not bias the result.
3. For every AI execution case, validate both provider classes before marking it pass: one local/OpenAI-compatible LLM run and one agent CLI run such as Codex CLI. The same user request, selected target, and expected tool/UI result must pass on both paths.
4. Observe the real behavior, not only unit tests. Confirm the model called the right tool, passed the right args, and the UI consumed the result correctly.
5. If either provider class fails, diagnose the cause at the contract boundary: prompt, tool schema, model transport, parser, execution result, UI event handling, or visual coordinate transform.
6. Write or update a focused harness test that reproduces the failure. Native tool calls and CLI/action-block output must both be covered when both paths exist.
7. Make the smallest product fix. Do not add language-specific fallback, test-only shortcuts, or hidden intent dictionaries.
8. Re-run the same failed case on the failed provider first, then re-run the other provider to catch regressions. Only then move to the next matrix case.
9. Extract the lesson into prompt rules, schema descriptions, tests, or this skill when the failure reveals a reusable pattern.

## Project Workflow Guardrails

- Before editing a repo, read the local agent/project instructions such as `AGENTS.md` and `CLAUDE.md`, then detect the stack from manifests, lockfiles, build configs, and container files. Do not assume the package manager, test runner, hot-reload path, or verification command from memory.
- Prefer the repository's documented toolchain and container workflow. For Aisets, run relevant Go, pnpm, build, and smoke checks inside the devcontainer/Docker environment unless the user explicitly asks for a host-only check.
- Keep fixes surgical. Every changed line should map to the current failing case, a focused regression test, or a durable rule; do not add speculative configuration, broad fallback logic, or adjacent refactors while repairing AI tool behavior.
- Define success criteria before live validation: expected tool sequence, forbidden behavior, UI/data result, and provider class. Finish only after the relevant project command and the live or harness case have been verified.
- Keep commits scoped and in English. Before committing, run the repo's formatter/linter/test path that applies to the touched stack, and never bypass hooks with `--no-verify`.

## Repeated-Failure Discipline

- Do not keep retrying the same live prompt without new evidence. After one failed rerun, form a concrete hypothesis. After two failed reruns, stop live retrying and collect execution evidence before changing anything else.
- Capture the actual request and streaming response for the failing case. Save the browser request body, replay it with `curl -N`, and inspect NDJSON events, `action_result`, `proposal`, text output, and final `loopStats`.
- Keep all live-validation artifacts out of the repo root. Write screenshots, request bodies, NDJSON replays, network dumps, and state snapshots under an ignored case directory such as `tmp/canvas-validation/<case>-<provider>/`. Do not leave `q*.json`, `.ndjson`, `.png`, or `.md` evidence files beside source files.
- Treat `loopStats` as the primary state-machine trace. Check `reason`, `nextReason`, tool source, native tool count, action count, invalid action issues, selected skill IDs, and executed tool sequence before guessing at prompt fixes.
- Verify the code that is serving the browser is the code you changed. If the app runs in Docker, devcontainer, Air, Vite proxy, or another reload layer, run focused tests/builds in that same environment and check hot reload logs before trusting live behavior.
- When Aisets Go checks run inside the devcontainer, avoid `/tmp` for Go test binaries. If `go test` reports `fork/exec /tmp/go-build... permission denied`, create `/workspace/tmp/go-tmp` and `/workspace/tmp/go-cache`, then rerun with `GOTMPDIR=/workspace/tmp/go-tmp GOCACHE=/workspace/tmp/go-cache`.
- For Aisets backend handler changes, assume the dev server reloads immediately unless trace evidence shows old code or hot reload errors. If hot reload is broken, rebuild the serving binary and restart only the service that needs it. Do not restart reflexively between every backend edit.
- When validating a URL-backed canvas/session, clear both the saved DB session state and browser `sessionStorage` before each case. URL session loading can overwrite local cleanup on reload and reintroduce old uploads, selected cards, comments, or chat history.
- When a repair loop discovers missing work, keep that repair state sticky until the required concrete action succeeds. Do not let an intermediate invalid/focus/prose response downgrade the state back to a generic repair reason.
- When a multi-step canvas loop has already executed state-changing tools, inspect whether the next prompt is using projected current state rather than the original request snapshot. A stale snapshot can make the model correctly call the missing later tool while using outdated geometry from before `resize_card`, `move_card`, `arrange_cards`, or layer changes.
- If a model output is blocked for safety or validation, include the blocked reason in compact tool results so the next loop has actionable feedback.
- Promote every repeated live failure into a deterministic harness case before broadening the fix. The harness should reproduce the observed bad sequence, not an idealized version of the failure.
- Only resume live testing when the evidence points to a changed contract or changed code path: schema, prompt, parser, validator, execution state machine, UI event handler, or serving binary.

## Prompt Contract

- Keep AI-facing prompts, tool names, tool descriptions, action metadata, status codes, labels, and internal reasoning in English.
- Localize only final assistant prose or UI-visible strings after tool execution, based on the user or app language setting.
- Do not hardcode non-English synonyms, units, counters, fallback phrases, or intent dictionaries. If a non-English user message cannot be safely classified, widen the available English tool set instead of guessing language-specific intent.
- Separate machine fields from display fields. Tool params should contain stable IDs, enums, numbers, booleans, and structured objects; UI text should come from i18n or final response generation.
- Define operation patterns as tool chains, not prose preferences. Example: `search_assets -> add_assets_to_canvas -> arrange_cards`.
- For professional photo staging requests, treat the assistant as a photographer/art director operating on all visible canvas images unless narrowed by the user. The validation pattern is `focus_card/select_cards -> inspect_canvas when composition is uncertain -> resize_card/arrange_cards/align/distribute/bring_cards_to_front as needed -> optional mirror_image/rotate_image variants when they improve the composition -> capture_canvas or capture_viewport`; capture is terminal after real layout work that covers the visible images, never the first action. The assistant may use scale and z-index/front layering to create depth, hierarchy, and editorial rhythm; mirroring and rotation are optional art-direction tools for a small number of deliberate variants, not a KPI. Do not rotate, mirror, duplicate, or transform images merely to show capability; arbitrary transforms are a failure even if the tool sequence looks rich. A rigid equal-size grid is also a failure unless the user asked for one. If a shortcut generates the task, keep the visible default prompt localized but send a structured skill ID such as `photo-staging` so the backend does not rely on non-English keyword fallback. The final visible reply must explain the staging concept and rationale.
- For VLM grounding, explicitly state the coordinate frame, origin, scale, target tightness, and whether the box is relative to an image, card, viewport, or canvas.
- When a user asks to mark, circle, highlight, point to, or correct a visible area, the prompt must require a region-bearing tool call plus a short visible explanation. Prose alone is a failure.
- Apply that rule to every visual surface, not only canvas images. Slide decks, PDFs, screenshots, charts, UI captures, and presentation "draw the key points" requests also need region-bearing actions for the visible areas being emphasized. If the current tool surface cannot edit or annotate that medium, return a proposal or explicit limitation instead of pretending prose has drawn the mark.
- For small visual targets, require the region to enclose the target object itself, not the host object or nearby context that helps describe it. The box should not expand to the surrounding hair, headband, sign, clothing, card, label, or container unless that surrounding object is the requested target.
- For precise visual annotations, do not rely on the model's bounding box as the final truth. Treat the model box as a semantic estimate, then snap or verify it against the original selected image with structured visual cues such as target description and target color. Prefer candidate components and scoring over "union all matching pixels", because nearby same-color regions can pull the marker away from the small target.
- For requests with multiple distinct targets, require one region-bearing action per target. A single oversized box that covers both a small object and unrelated text is a failure even if the comment text is correct.
- Treat a visible text word, phrase, line, or OCR string as one target unless the user explicitly asks for per-character or per-token annotations. If a CLI agent splits one text phrase into several comments that refine to the same region, dedupe or repair it into one text-region action.
- When repairing a missing visual mark, keep the repair reason sticky and narrow the available native tools/action-block instructions to the exact region-bearing tool that can finish the missing mark. Do not leave focus, inspect, search, layout, or prose-only tools available in that repair round unless they are required to identify the target; otherwise smaller local VLMs can burn every remaining loop on non-completing actions.

## Tool Contract

- Maintain one canonical registry for tools. Derive native tool schemas, action-block docs, compact prompt text, validation, and frontend event handling from the same definitions whenever possible.
- Support two transport paths:
  - Native tool calling for OpenAI-compatible and other providers that accept JSON schemas.
  - Text action blocks for Codex CLI, Claude Code, Pi-style agents, and local adapters that return prose.
- Keep native and action-block parameter names identical. A harness should be able to run the same case against both paths.
- For Codex CLI and other text agents, prefer a strict bracket line protocol over asking for raw JSON when the agent repeatedly returns prose. Example: `[action: create_comment]` followed by `anchorCardId`, `text`, `regionX`, `regionY`, `regionWidth`, `regionHeight`, `visualCueTargetDescription`, and `visualCueColorHex` lines. The parser should normalize this into the same canonical params used by native tools.
- CLI action-block parsers must tolerate common structured-value shapes without weakening validation: comma/newline-delimited strings for string arrays, and inline JSON arrays/objects such as `positions: [{"cardId":"a","x":0,"y":0}]`. Normalize first, then validate against the canonical schema before execution.
- Mark safety clearly: safe tools execute immediately; destructive or file-writing tools create proposals unless the user explicitly confirms.
- Include optional update fields when the UI can apply partial changes. Example: `update_comment` should accept `text` and/or `region`, not require text when the user only corrects a marker.
- Return execution results in the same shape the frontend needs. If a UI update depends on `region`, include `region` in the `action_result`.
- Treat streamed tool execution status as per-tool state, not whole-chat state. After each `action_result`, clear the visible tool status; if the next loop is still running, the next `thinking`, `status`, or `focus` event must set a fresh status so the UI does not look stuck on the previous tool.
- Treat state-changing canvas tool results as the source of truth for later loop context. Maintain a projected canvas snapshot from `resize_card`, `move_card`, `arrange_cards`, `align_cards`, `distribute_cards`, `duplicate_cards`, `remove_cards`, and layer-order results, and build follow-up prompts from that projected state. If the only missing operation is non-geometric, narrow the next round to that operation instead of letting the model re-plan prior geometry from stale state.
- Treat unknown, invalid, or missing tool calls as repairable model-output errors. If a CLI/text agent says "done", "already", or otherwise claims completion without an executable action block on an action-required turn, do not render that as success; feed a compact repair prompt that allows only tool calls/action blocks.
- For multi-step chains, later tools may be completed from earlier structured tool results when the model understood the operation but omitted derivable fields. Example: after `extract_ocr_text`, a `copy_asset` action with only `assetIds` can be completed into `perAssetDestPaths` from OCR text. This must be based on prior tool results and canonical IDs, not language-specific keyword fallback.
- Any filename derived from OCR or visible text must be sanitized as a filename, not treated as a path. Replace path separators/control characters, preserve intentional directories only when they are clearly separate from the OCR text, and dedupe repeated names before creating the proposal.

## Harness Design

- Build a deterministic provider/harness that can script model responses, native tool calls, and action-block text.
- Assert on events and side effects, not just response text. Check `action_result`, `proposal`, `focus`, generated cards, preview events, and final visible reply.
- Cover both happy paths and model mistakes:
  - text-only answer when a tool call is required
  - text-only false completion claim from a CLI agent
  - partial tool chain
  - invalid args
  - native empty response
  - unsupported native tool
  - fallback action block parsing
  - non-JSON bracket action blocks normalized into canonical params
  - frontend event contract mismatch
- Keep each regression test tied to one observed failure. Broad matrix tests should verify routing/tool availability; behavior tests should verify actual execution.
- Include prompt-size tests for all-tool or compact mode so local LLM support does not regress into unusable context bloat.
- For visual tasks, test coordinate normalization separately from model quality. Pixel-based boxes, normalized boxes, card scaling, and viewport zoom should all resolve to the same image-relative region.
- For multi-loop layout tasks, test projected-state continuity separately from model quality. Script a response sequence such as `focus_card -> resize_card -> move_card -> bring_cards_to_front` and assert that each follow-up prompt sees the updated card width, position, and layer order before the next tool is requested.
- For small-object annotation regressions, include a fixture with a small target and a nearby same-color distractor. The test should prove the refinement chooses the target component, not a broad union or the larger distractor.
- Keep live validation evidence per provider. A useful note is: provider, request, selected card, observed tool sequence, observed UI result, pass/fail, and exact follow-up if the case failed.

## Local LLM And CLI Compatibility

- Assume many enterprise users will run local VLMs on mid-range machines, including 16GB memory systems. Keep prompts compact, gate tool families when safe, and attach only the images needed for the current case.
- Prefer selected/original image attachments over full-canvas screenshots for object and text grounding. Use canvas screenshots for layout context only.
- For a single selected image, consider adding a lightweight coordinate-grid image plus the plain original when region accuracy matters.
- Avoid huge history dumps. Follow-up prompts should include compact tool results, completed tool names, current canvas state snippets, and the original user request.
- Codex, Claude Code, Pi-style agents, and local CLI adapters may not support native JSON schema tools. They still need the same complete tool list and response format through English action-block instructions.
- Never treat local LLM support as a lower-capability fallback. If a workflow is required, provide the CLI path with the same tool coverage and tests.
- Keep image detail configurable or explicit. Use higher detail only for visual grounding tasks that need it.

## Code Structure

- Split large AI orchestration files by responsibility before they become unmaintainable:
  - prompt construction
  - tool registry and schemas
  - action parsing and normalization
  - execution and proposal handling
  - follow-up/repair loop
  - visual/image helpers
  - harness fixtures
- Avoid 1000+ line files as a default shape. If a file is already large, make new work in cohesive helper files instead of extending the central file.
- Keep language detection, tool classification, prompt generation, and UI localization as separate modules. Mixing them creates hidden fallback behavior.
- Prefer shared helpers for cross-tool concepts like image regions, target IDs, and proposal safety. Do not implement the same coordinate or parser logic per tool.
- Every changed line should map to a validation case or durable rule.

## Failure Review

When a case fails, classify it before fixing:

- **Model chose prose instead of a tool:** strengthen required tool choice, action-block format, operation patterns, and repair loop.
- **Model chose the wrong tool:** check skill-family routing, available tool set, and whether the user request was over-gated.
- **Model passed wrong args:** improve schema descriptions, required fields, examples, and validation error feedback.
- **Tool executed but UI did not change:** fix event result shape or frontend action handler.
- **Tool executed but later geometry regressed:** check whether the backend follow-up prompt, compact state, and frontend validation are reading a projected current canvas state. Do not patch this with language-specific intent rules; fix the state projection or narrow the next loop to the single missing tool.
- **Region/box is wrong:** verify image attachment order, coordinate frame prompt, normalization, anchor lookup, scale handling, and whether the model saw the original image or only a viewport screenshot.
- **Local/CLI works differently from native:** compare native tool schema with action-block prompt and parser. The two contracts should be behaviorally equivalent.
- **Fix looks test-specific:** remove deterministic fallback and make the model contract clearer instead.

## Done Criteria

- The original failing case passes live or through the closest available harness.
- The fixed matrix case has a regression test.
- Local/OpenAI-compatible and agent CLI paths are both covered live or by the closest deterministic harness when the feature supports both.
- No AI-facing prompt or schema introduces hardcoded non-English fallback behavior.
- Tool results contain the fields needed by the UI.
- Prompt size remains reasonable for local LLM use.
- A durable lesson is captured in code, tests, docs, or this skill.
