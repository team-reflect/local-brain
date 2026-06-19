import type { ReactNode } from 'react'
import { Section } from '../../components/section'

export function SkillsSettings(): ReactNode {
  return (
    <Section title="Skills">
      <div className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>
          The <code className="font-mono text-foreground">brain</code> CLI is the supported agent
          interface — it reads and writes this same database from a terminal, with the app open or
          closed. It ships bundled with the app as a sidecar binary.
        </p>
        <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
          <div>brain search "northwind" --json</div>
          <div>brain today --json</div>
          <div>brain add interaction --kind meeting --title "…" --text-file ./notes.md --json</div>
        </div>
        <p>
          The agent skill lives at{' '}
          <code className="font-mono text-foreground">skills/brain/SKILL.md</code>; point Codex (or
          another local agent) at it to teach safe read/write behavior. Sidecar detection and a
          one-click PATH install land with packaging in Plan 09.
        </p>
      </div>
    </Section>
  )
}
