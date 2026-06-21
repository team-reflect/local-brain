import { generateText } from 'ai'
import {
  getDailyBrief,
  getSelf,
  latestDailyBriefNote,
  listProjects,
  saveDailyBriefNote,
  type DailyBrief,
  type DailyBriefNote,
  type Project,
} from '@local-brain/core'
import { resolveLanguageModel } from './provider'

const DAILY_BRIEF_PROMPT_FINGERPRINT = 'today-daily-brief-v1'

function compactTask(task: DailyBrief['tasks']['open'][number]): Record<string, unknown> {
  return {
    title: task.title,
    status: task.status,
    dueAt: task.dueAt,
    scheduledFor: task.scheduledFor,
    priority: task.priority,
    bucket: task.bucket,
    assignees: task.assignees.map((person) => person.name),
  }
}

function compactProject(project: Project): Record<string, unknown> {
  return {
    name: project.name,
    status: project.status,
    kind: project.kind,
    summary: project.summary,
    targetDate: project.targetDate,
  }
}

function buildDailyBriefContext(brief: DailyBrief, projects: Project[], userName: string | null): string {
  return JSON.stringify(
    {
      date: brief.date,
      userName,
      counts: brief.counts,
      tasks: {
        overdue: brief.tasks.overdue.map(compactTask),
        today: brief.tasks.today.map(compactTask),
        soon: brief.tasks.soon.map(compactTask),
        open: brief.tasks.open.slice(0, 12).map(compactTask),
      },
      recentInteractions: brief.recentInteractions.map((interaction) => ({
        title: interaction.title,
        kind: interaction.kind,
        occurredAt: interaction.occurredAt,
      })),
      activeProjects: projects.map(compactProject),
    },
    null,
    2,
  )
}

function buildPrompt(brief: DailyBrief, projects: Project[], userName: string | null): string {
  return `Write today's Local Brain daily brief from this JSON context only.

Context:
${buildDailyBriefContext(brief, projects, userName)}

Output requirements:
- Markdown only.
- Keep it under 220 words.
- Start with a short paragraph, then use compact bullets.
- Highlight overdue/due-today work first, then useful recent context.
- Do not invent meetings, dates, people, or project details.
- If the context is sparse, say what is currently known and keep the brief short.`
}

export async function generateTodayDailyBrief(): Promise<DailyBriefNote> {
  const [{ model, label }, brief, projects, self] = await Promise.all([
    resolveLanguageModel(),
    getDailyBrief(),
    listProjects({ activeOnly: true, limit: 12 }),
    getSelf(),
  ])
  const { text } = await generateText({
    model,
    system:
      'You write concise, grounded operating briefs for a private local personal CRM. Use only the supplied context.',
    prompt: buildPrompt(brief, projects, self?.preferredName ?? self?.fullName ?? null),
    maxOutputTokens: 700,
    temperature: 0.2,
  })
  const content = text.trim()
  if (!content) throw new Error('The provider returned an empty daily brief.')

  await saveDailyBriefNote({
    date: brief.date,
    title: `Daily brief - ${brief.date}`,
    content,
    model: label,
    promptFingerprint: DAILY_BRIEF_PROMPT_FINGERPRINT,
    metadata: { counts: brief.counts },
  })

  const saved = await latestDailyBriefNote(brief.date)
  if (!saved) throw new Error('The generated daily brief could not be loaded after saving.')
  return saved
}
