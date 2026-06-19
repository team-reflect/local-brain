import type { ReactNode } from 'react'
import { Section } from '../../components/section'

export function GeneralSettings(): ReactNode {
  return (
    <Section title="General">
      <p className="text-sm text-muted-foreground">
        Local Brain is a private, local-first personal CRM and knowledge base. Use the sidebar
        sections to browse your people, projects, tasks, and the records that connect them, or
        press <kbd className="font-mono text-foreground">⌘K</kbd> to search and run commands.
      </p>
    </Section>
  )
}
