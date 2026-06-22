import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import { updateConversationTitle } from '@local-brain/core'

const TITLE_MAX_LENGTH = 48
const CONTEXT_MAX_LENGTH = 1_200
const genericTitles = new Set(['chat', 'conversation', 'new chat', 'new conversation', 'untitled'])

const conversationTitleSchema = z.object({
  title: z.string(),
})

function clipContext(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > CONTEXT_MAX_LENGTH ? `${compact.slice(0, CONTEXT_MAX_LENGTH - 3)}...` : compact
}

function stripSurroundingQuotes(value: string): string {
  let next = value.trim()
  while (
    next.length >= 2 &&
    ((next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'")) ||
      (next.startsWith('`') && next.endsWith('`')))
  ) {
    next = next.slice(1, -1).trim()
  }
  return next
}

export function sanitizeGeneratedConversationTitle(value: string): string | null {
  let title = stripSurroundingQuotes(value.replace(/\s+/g, ' '))
    .replace(/[.!?:;,]+$/g, '')
    .trim()
  if (title.length > TITLE_MAX_LENGTH) {
    title = title.slice(0, TITLE_MAX_LENGTH).trim().replace(/[.!?:;,]+$/g, '').trim()
  }
  if (!title || genericTitles.has(title.toLowerCase())) return null
  return title
}

export async function generateConversationTitle({
  assistantText,
  model,
  userText,
}: {
  assistantText: string
  model: LanguageModel
  userText: string
}): Promise<string | null> {
  const user = clipContext(userText)
  if (!user) return null
  const assistant = clipContext(assistantText)
  const prompt = [
    'Create a concise sidebar title for this chat.',
    '',
    'Rules:',
    '- 2 to 5 words',
    `- max ${TITLE_MAX_LENGTH} characters`,
    '- no quotes',
    '- no trailing punctuation',
    '- do not use generic words like chat or conversation',
    '- prefer specific people, projects, or tasks when present',
    '',
    'User message:',
    user,
    '',
    'Assistant answer:',
    assistant || '(none)',
  ].join('\n')

  const { output } = await generateText({
    model,
    output: Output.object({ schema: conversationTitleSchema }),
    prompt,
    maxOutputTokens: 64,
    temperature: 0,
  })
  return sanitizeGeneratedConversationTitle(output.title)
}

export function generateAndPersistConversationTitle({
  assistantText,
  conversationId,
  model,
  onUpdated,
  userText,
}: {
  assistantText: string
  conversationId: string
  model: LanguageModel
  onUpdated?: ((conversationId: string) => void) | undefined
  userText: string
}): void {
  void (async () => {
    try {
      const title = await generateConversationTitle({ assistantText, model, userText })
      if (!title) return
      const count = await updateConversationTitle(conversationId, title)
      if (count > 0) onUpdated?.(conversationId)
    } catch {
      // Sidebar titles are best-effort metadata; chat persistence should never depend on them.
    }
  })()
}
