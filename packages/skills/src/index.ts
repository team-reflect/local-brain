/**
 * Local agent skill definitions for Local Brain.
 *
 * Foundation ships only the package shell and the skill metadata contract. The
 * actual `brain` skill content (when to add documents vs interactions, citation
 * and duplicate-avoidance rules, query-before-write guidance, daily-automation
 * recipes) is authored in Plan 07 alongside the CLI.
 */
export interface SkillManifest {
  /** Stable skill id, e.g. `brain`. */
  id: string
  /** Human-readable skill name. */
  name: string
  /** One-line description of when an agent should reach for this skill. */
  description: string
}

export const SKILLS: readonly SkillManifest[] = []
