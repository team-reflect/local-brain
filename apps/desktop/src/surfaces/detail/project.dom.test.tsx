// @vitest-environment jsdom
import { useState, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ProjectDetail } from './project'
import { installFakeBridge, renderWithProviders } from '../../test/utils'

interface ProjectRow {
  id: string
  name: string
  summary: string | null
  status: string
  target_date: string | null
  completed_on: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  kind: string | null
  notes: string | null
  started_on: string | null
}

const projectRow: ProjectRow = {
  id: 'pr1',
  name: 'Launch',
  summary: 'Ship the first version',
  status: 'active',
  target_date: null,
  completed_on: null,
  archived_at: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  kind: null,
  notes: null,
  started_on: null,
}

const secondProjectRow = {
  ...projectRow,
  id: 'pr2',
  name: 'Second project',
  summary: 'A different project',
}

const taskRow = {
  id: 't1',
  title: 'Send deck',
  description: 'Draft for Alex',
  status: 'open',
  priority: null,
  project_id: 'pr1',
  due_at: null,
  scheduled_for: null,
  completed_at: null,
  origin_document_id: null,
  origin_interaction_id: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  archived_at: null,
}

function installProjectBridge(overrides: Partial<ProjectRow> = {}): void {
  const row = { ...projectRow, ...overrides }
  installFakeBridge({
    query: (sql, params) => {
      if (sql.includes('from "projects"') && sql.includes('where "id" = ?')) {
        return params[0] === 'pr2' ? [secondProjectRow] : [row]
      }
      if (sql.includes('from "tasks"') && sql.includes('where "id" = ?')) return [taskRow]
      if (sql.includes('from "tasks"') && sql.includes('"tasks"."project_id" = ?')) {
        return [{
          id: 't1',
          title: 'Send deck',
          status: 'open',
          dueAt: null,
          scheduledFor: null,
          priority: null,
        }]
      }
      if (sql.includes('from "people"') && sql.includes('inner join "project_people"')) {
        return [{ id: 'p1', title: 'Ada Lovelace', subtitle: 'advisor' }]
      }
      if (sql.includes('from "tags"') && sql.includes('inner join "taggings"')) {
        return [{ id: 'tag1', name: 'launch', slug: 'launch', color: '#4f46e5', description: 'Launch work' }]
      }
      if (sql.includes('from "memories"') && sql.includes('inner join "memory_links"')) {
        return [
          {
            id: 'm1',
            kind: 'decision',
            claim: 'Launch should stay invite-only.',
            confidence: 0.86,
            valid_from: null,
            valid_to: null,
            promoted_from_fact_id: null,
            created_at: '2026-06-03T00:00:00.000Z',
            updated_at: '2026-06-03T00:00:00.000Z',
            archived_at: null,
          },
        ]
      }
      if (sql.includes('from "extracted_facts"')) {
        return [
          {
            id: 'f1',
            subject_type: 'project',
            subject_id: 'pr1',
            key: 'risk',
            value_text: 'Credential review is the launch blocker.',
            value_json: null,
            confidence: 0.72,
            source_record_type: 'interaction',
            source_record_id: 'i1',
            source_excerpt: 'Credential review still needs a security pass.',
            observed_at: '2026-06-02',
            model: null,
            prompt_fingerprint: null,
            metadata_json: null,
            created_at: '2026-06-03T00:00:00.000Z',
            updated_at: '2026-06-03T00:00:00.000Z',
            archived_at: null,
          },
        ]
      }
      if (sql.includes('from "ai_notes"')) {
        return [
          {
            id: 'a1',
            kind: 'risk',
            interaction_id: null,
            document_id: null,
            subject_type: 'project',
            subject_id: 'pr1',
            title: 'Launch risks',
            content: 'Credential work and onboarding copy need one more pass.',
            content_format: 'markdown',
            model: 'test-model',
            prompt_fingerprint: null,
            source_id: null,
            metadata_json: null,
            generated_at: '2026-06-04T00:00:00.000Z',
            created_at: '2026-06-04T00:00:00.000Z',
            updated_at: '2026-06-04T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "evidence_refs"')) {
        return [
          {
            id: 'e1',
            note: 'Kickoff call',
            quote: 'We agreed to keep launch invite-only.',
            sourceType: 'interaction',
            sourceId: 'i1',
            sourceTitle: 'Launch kickoff',
          },
        ]
      }
      if (sql.includes('from "projects"') && !sql.includes('inner join')) return [row]
      return []
    },
  })
}

function ProjectSwitcher(): ReactNode {
  const [id, setId] = useState('pr1')
  return (
    <>
      <button type="button" onClick={() => setId('pr2')}>
        Switch project
      </button>
      <ProjectDetail id={id} />
    </>
  )
}

describe('ProjectDetail task drawer', () => {
  it('opens linked project tasks in a drawer and closes back to the project', async () => {
    installProjectBridge()
    renderWithProviders(<ProjectDetail id="pr1" />)

    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeDefined()
    fireEvent.click(screen.getByText('Send deck').closest('button')!)

    expect(await screen.findByText('Draft for Alex')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Close task details' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull())
    expect(screen.getByRole('heading', { name: 'Launch' })).toBeDefined()
  })

  it('does not open the task drawer for non-task linked records', async () => {
    installProjectBridge()
    renderWithProviders(<ProjectDetail id="pr1" />)

    fireEvent.click((await screen.findByText('Ada Lovelace')).closest('button')!)

    expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull()
  })

  it('closes an open task drawer when navigating to another project', async () => {
    installProjectBridge()
    renderWithProviders(<ProjectSwitcher />)

    fireEvent.click((await screen.findByText('Send deck')).closest('button')!)
    expect(await screen.findByRole('button', { name: 'Close task details' })).toBeDefined()

    fireEvent.click(screen.getByText('Switch project').closest('button')!)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull())
    expect(await screen.findByRole('heading', { name: 'Second project' })).toBeDefined()
  })

  it('shows project notes without the project knowledge block', async () => {
    installProjectBridge({ notes: 'Keep launch narrow and evidence-backed.' })
    renderWithProviders(<ProjectDetail id="pr1" />)

    expect(await screen.findByText('Keep launch narrow and evidence-backed.')).toBeDefined()
    expect(screen.queryByText('Knowledge')).toBeNull()
    expect(screen.queryByText('Launch should stay invite-only.')).toBeNull()
    expect(screen.queryByText('Credential review is the launch blocker.')).toBeNull()
    expect(screen.queryByText('Launch risks')).toBeNull()
  })
})
