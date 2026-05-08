---
name: capture-lessons
description: >
  Capture lessons learned from the current session and persist them into CLAUDE.md and
  .skillshare/skills/design-system/SKILL.md. Use this skill whenever the user says
  "更新規範", "記取經驗", "update rules", "update SKILL", "寫進 CLAUDE.md",
  or after a debugging session where new project conventions were discovered.
  Also use proactively when a bug fix reveals a pattern that should become a rule.
globs:
  - "CLAUDE.md"
  - ".skillshare/skills/design-system/SKILL.md"
---

# Capture Lessons

Turn hard-won debugging insights into durable project rules so the same mistake never happens twice.

## When to use

- After fixing a bug that revealed a missing convention
- When the user explicitly asks to update rules / CLAUDE.md / SKILL
- After a `/simplify` review surfaces a systemic pattern

## Process

### 1. Extract lessons from the session

Scan the conversation for:

- **Bugs fixed** — what broke, why, and the non-obvious root cause
- **Patterns discovered** — conventions that weren't documented but should be
- **User corrections** — things the user had to point out more than once

For each lesson, distill it to: **rule** (what to do/avoid) + **why** (the concrete failure it prevents).

### 2. Check existing rules for duplicates

Before writing anything:

1. Read `CLAUDE.md` sections 2.1 (React/TS) and 2.2 (Go)
2. Read `.skillshare/skills/design-system/SKILL.md` section 4 (Component rules table)
3. If the lesson is already covered, skip it
4. If an existing rule is incomplete, update it rather than adding a duplicate

### 3. Decide where each rule goes

| Rule type | Destination |
|-----------|-------------|
| Project-wide convention (applies to all contributors) | `CLAUDE.md` § 2.1 or § 2.2 |
| UI component pattern (styling, layout, interaction) | `SKILL.md` § 4 rules table |
| Both (convention with a UI-specific manifestation) | Both files |

### 4. Write the rules

**CLAUDE.md format** — bold lead sentence + explanation:
```markdown
- **Rule name:** Explanation of what to do and why. Specific enough to act on.
```

**SKILL.md format** — table row in section 4:
```markdown
| **Rule name** | Explanation of what goes wrong without this rule. |
```

**Writing guidelines:**
- Lead with the action, not the history ("Always X" not "We learned that X")
- Include the failure mode ("otherwise Y breaks silently")
- Be specific enough that someone unfamiliar with the session can follow the rule
- Don't reference ticket numbers, dates, or session context — rules outlive their origin

### 5. Apply edits

Use the Edit tool to append rules to the correct section in each file. Don't rewrite existing content — only add or update.

### 6. Verify no regressions

After editing:
- Confirm CLAUDE.md is valid markdown (no broken tables, no orphaned bullets)
- Confirm SKILL.md table rows have the correct `| **name** | description |` format
- Read back the edited sections to verify placement

## Examples of good rules (from this project)

```markdown
# CLAUDE.md
- **Query key normalizers must include all filter params.** When adding a new filter
  param to a `CatalogXxxParams` type and passing it to a React Query hook, also add
  the field to the corresponding `normalizeCatalogXxxParams` function in `queries.ts`.
  The normalizer builds the query key — omitting a param means the cache key won't
  change when the filter changes, silently returning stale data.
```

```markdown
# SKILL.md table row
| **Query key normalizers** | Adding a filter param to `CatalogXxxParams` → also add
  it to `normalizeCatalogXxxParams` in `queries.ts`. Omitting it means the React Query
  cache key won't change, silently returning stale data. |
```

## Anti-patterns to avoid

- Don't write rules that only apply to one specific file or function — those belong in code comments
- Don't write aspirational rules ("we should consider...") — only rules backed by actual failures
- Don't add rules the user didn't validate — if unsure, ask before writing
- Don't remove or rewrite existing rules unless they're factually wrong
