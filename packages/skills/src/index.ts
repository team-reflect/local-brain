/**
 * Local agent skill definitions for Local Brain.
 *
 * The Local Brain skill content lives under `skills/` at the repo root (the
 * agent-readable docs). This module is the typed registry the desktop and
 * tooling use to enumerate available skills and locate their docs.
 */
export interface SkillManifest {
  /** Stable skill id, e.g. `brain`. */
  id: string
  /** Human-readable skill name. */
  name: string
  /** One-line description of when an agent should reach for this skill. */
  description: string
  /** Path to the skill doc, relative to the repo root. */
  docPath: string
}

export const SKILLS: readonly SkillManifest[] = [
  {
    id: 'brain',
    name: 'Local Brain',
    description:
      "Read from and write to the user's Local Brain (a local SQLite personal CRM) through the `brain` CLI and its `brain --json contract`: remember people/meetings/notes/tasks, search records, import provider data, and produce daily briefs and todo lists.",
    docPath: 'skills/brain/SKILL.md',
  },
  {
    id: 'brain-backfill',
    name: 'Local Brain Backfill',
    description:
      'Run source-led first-run or large historical Local Brain imports from Gmail/GWS, Granola, WhatsApp, Reflect notes, Calendar, contacts, and other personal data sources.',
    docPath: 'skills/brain-backfill/SKILL.md',
  },
]
