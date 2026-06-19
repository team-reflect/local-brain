/**
 * Local agent skill definitions for Local Brain.
 *
 * The `brain` skill content lives in `skills/brain/SKILL.md` at the repo root
 * (the agent-readable doc). This module is the typed registry the desktop and
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
      "Read from and write to the user's Local Brain (a local SQLite personal CRM) through the `brain` CLI: remember people/meetings/notes/tasks, search records, and produce daily briefs and reconnect follow-ups.",
    docPath: 'skills/brain/SKILL.md',
  },
]
