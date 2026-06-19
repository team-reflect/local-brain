# Chat Markdown & Tools — Status

## Current status: DONE

## Completed steps

- [x] Plan written
- [x] Dependencies installed (ai → core, react-markdown + remark-gfm → desktop)
- [x] `packages/core/src/ai/chat/tools.ts` created (`buildChatTools`: search_records, list_projects)
- [x] `packages/core/src/ai/chat/system-prompt.ts` created (`buildChatSystemPrompt`)
- [x] `packages/core/src/index.ts` updated
- [x] `ask-transport.ts` updated (tools, stopWhen, loadChatContext)
- [x] `chat-markdown.tsx` created (react-markdown + remark-gfm, no raw HTML)
- [x] `chat-tool-chip.tsx` created (pending/settled chips)
- [x] `ask.tsx` updated (markdown, tool chips, scroll pin, Thinking fix)
- [x] Tests written (system-prompt.test.ts, ask-transport.test.ts, ask.dom.test.tsx, chat-tool-chip.test.tsx)
- [x] `pnpm check` passes (typecheck + lint + 199+115 tests)
- [x] `pnpm --filter @local-brain/desktop build` passes
- [x] Tests pass (all 314 tests)
- [x] PR opened

## Blockers

None.
