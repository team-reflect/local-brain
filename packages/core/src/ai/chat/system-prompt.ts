import type { Project } from '../../domains/projects/getters'

/**
 * System prompt builder for Local Brain chat. Includes today's date, active
 * project vocabulary so the model never has to guess project names, and
 * grounding rules that steer it toward tool use before answering.
 */

const MAX_PROJECTS_IN_PROMPT = 30
const MAX_SUMMARY_CHARS = 200

export interface ChatSystemPromptInput {
  today: string
  projects: Project[]
}

function projectLine(p: Project): string {
  let line = `- ${p.name}`
  if (p.status) line += ` [${p.status}]`
  if (p.targetDate) line += ` (target: ${p.targetDate})`
  if (p.summary) {
    const summary =
      p.summary.length > MAX_SUMMARY_CHARS ? `${p.summary.slice(0, MAX_SUMMARY_CHARS)}…` : p.summary
    line += `\n  ${summary}`
  }
  return line
}

export function buildChatSystemPrompt({ today, projects }: ChatSystemPromptInput): string {
  const lines: string[] = [
    'You are Local Brain, a private personal CRM and memory assistant.',
    `Today's date is ${today}.`,
    '',
    'Local Brain stores information about people, organizations, projects, tasks, documents, and interactions — all private and local.',
    '',
    'Grounding rules:',
    '- Use search_records to look up relevant documents and interactions before answering topic questions.',
    '- Use list_projects to answer questions about project statuses, progress, or deadlines.',
    '- Ground answers only in what the tools return. If records do not cover the question, say so directly.',
    '- Do not use outside knowledge or invent facts. Be concise and direct.',
    '- Answer in concise markdown — prefer short paragraphs and bullet lists over long prose.',
  ]

  const active = projects
    .filter((p) => p.archivedAt === null && p.completedOn === null)
    .slice(0, MAX_PROJECTS_IN_PROMPT)

  if (active.length > 0) {
    lines.push('', 'Active projects:')
    for (const p of active) {
      lines.push(projectLine(p))
    }
  }

  return lines.join('\n')
}
