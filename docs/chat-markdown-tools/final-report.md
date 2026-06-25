# Chat Markdown & Tools — Final Report

## PR

- **URL**: https://github.com/maccman/local-brain/pull/74
- **Branch**: `codex/local-brain-chat-markdown-tools`
- **Base**: `master` at `21feb6b1b33e984012c72cf1800bd0d3a031c067`
- **Head**: `b043411531bc888f68481b91e1a2cbe536ce58a9`

## Summary

Five distinct improvements shipped in one commit:

### 1. Markdown rendering for settled assistant messages
`react-markdown` + `remark-gfm` added to `apps/desktop`. New component `chat-markdown.tsx` uses custom Tailwind-styled element overrides; raw HTML rendering is never enabled so inline `<script>` and similar content is always escaped as plain text. Streaming text still renders as a plain `whitespace-pre-wrap` div on the final part to avoid costly re-parsing on every delta; all prior parts in the same turn and all messages in reloaded conversations render as markdown.

### 2. Thinking indicator fix
`showThinking` is now `true` only when `status === 'submitted'` OR when `status === 'streaming'` AND the last assistant message has no visible parts yet (no non-empty text, no tool-type parts). As soon as the model produces any output the indicator disappears.

### 3. Polite pinned scroll
`MessageList` tracks a `pinnedRef` (starts `true`). On every render where pinned is true, the scroll container jumps to `scrollHeight`. An `onScroll` handler sets pinned to `true` when the user is within 48 px of the bottom and `false` when they scroll up — so scrolling up to re-read is never fought.

### 4. Project context in system prompt
`buildChatSystemPrompt({ today, projects })` (`packages/core/src/ai/chat/system-prompt.ts`) injects active projects (name, status, summary, target date) into the prompt so the model knows the vocabulary before making any tool calls. `ask-transport.ts` calls `listProjects({ limit: 30 })` at the start of every turn via `loadChatContext()`.

### 5. Read-only AI SDK tools + tool chips
`buildChatTools()` (`packages/core/src/ai/chat/tools.ts`) returns two tools:
- **`search_records`**: calls `retrieve(query, { mode: 'hybrid' })` — FTS5 + semantic
- **`list_projects`**: calls `listProjects({ status?, limit })` — all active projects

The transport passes `stopWhen: stepCountIs(20)` for up to twenty tool round-trips (AI SDK v6 removed `maxSteps` in favour of `stopWhen`).

`chat-tool-chip.tsx` renders compact chips: inline spinner while the state is `input-streaming` or `input-available`, then icon + label + count once `output-available`. Tool call/result parts are stored in `uiMessageJson` and survive conversation reload.

## Verification

```
git diff --check origin/master...HEAD   → clean (no whitespace errors)

pnpm check                               → typecheck + lint + tests
  @local-brain/core   34 test files, 199 tests — all pass
  @local-brain/desktop 24 test files, 115 tests — all pass

pnpm --filter @local-brain/desktop build → ✓ built in 2.01s
```

No Rust files changed; no cargo gates needed.

## New test files

| File | Tests |
|---|---|
| `packages/core/src/ai/chat/system-prompt.test.ts` | 8 — date, project list, grounding rules, archived/completed exclusion |
| `apps/desktop/src/components/chat/chat-tool-chip.test.tsx` | 15 — pending/settled chips, count labeling, unknown tool fallback |
| `apps/desktop/src/surfaces/ask.dom.test.tsx` | 10 (was 1) — markdown, Thinking logic, streaming vs settled, tool chips, reload |
| `apps/desktop/src/lib/ai/ask-transport.test.ts` | 2 (updated) — project context load, tools passed to streamText |

## Caveats

- The static pre-retrieval pass (chunks injected into the system prompt) is removed; the model now searches via `search_records` when needed. First-turn latency may be slightly higher for questions whose answers are in documents, but the model can now search iteratively and is grounded in project names from turn 1.
- Scroll tests are omitted from the unit suite (DOM tests cannot easily exercise scroll geometry with jsdom). Scroll behaviour is covered by the implementation logic and readable in `ask.tsx:MessageList`.
- `react-markdown` adds ~70 kB gzip to the bundle (part of the 388 kB total). No code-splitting was done as it was out of scope.
