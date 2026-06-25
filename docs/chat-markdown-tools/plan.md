# Chat Markdown & Tools — Implementation Plan

## Goals

1. Render settled assistant responses as safe markdown.
2. Hide the standalone `Thinking...` row once streaming content or tool activity is visible.
3. Polite pinned auto-scroll: follow the stream when at bottom, stop when user scrolls up.
4. Inject Local Brain project context into the chat system prompt.
5. Add read-only AI SDK tools: `search_records`, `list_projects`.
6. Port Reflect Open tool-call chip UX: spinner while pending, icon + label + count when settled.

## Architecture

### packages/core/src/ai/chat/

| File | Purpose |
|---|---|
| `tools.ts` | `buildChatTools()` — two read-only AI SDK v6 tools |
| `system-prompt.ts` | `buildChatSystemPrompt({ today, projects })` |

Tools call existing getters (`retrieve`, `listProjects`) and return concise JSON results.
System prompt lists active projects and gives grounding rules.

### apps/desktop/src/lib/ai/ask-transport.ts (updated)

- Load projects at start of each turn via `listProjects`.
- Build system prompt with `buildChatSystemPrompt`.
- Pass `tools: buildChatTools()` and `maxSteps: 20` to `streamText`.
- Remove static pre-retrieval (model now searches via tool).

### apps/desktop/src/components/chat/

| File | Purpose |
|---|---|
| `chat-markdown.tsx` | react-markdown + remark-gfm, no raw HTML, Tailwind-styled |
| `chat-tool-chip.tsx` | Compact chips: spinner while pending, icon + label + count settled |

### apps/desktop/src/surfaces/ask.tsx (updated)

- `streamingMessageId`: last message's id when `status === 'streaming'`.
- `showThinking`: true only while submitted or streaming with no visible content yet.
- `MessageList`: scroll container with `pinnedRef` auto-scroll logic.
- Per-part rendering: user bubble (right), tool chips, markdown (settled) / plain text (streaming last part).

## Dependencies Added

- `apps/desktop`: `react-markdown`, `remark-gfm`
- `packages/core`: `ai` (already in pnpm store)

## Tests

| Test file | Covers |
|---|---|
| `packages/core/src/ai/chat/system-prompt.test.ts` | prompt includes date, projects, grounding rules |
| `apps/desktop/src/lib/ai/ask-transport.test.ts` | tools passed to streamText, projects loaded |
| `apps/desktop/src/surfaces/ask.dom.test.tsx` | markdown renders, Thinking hidden, tool chip renders |
| `apps/desktop/src/components/chat/chat-tool-chip.test.tsx` | pending/settled chips for search and list_projects |
