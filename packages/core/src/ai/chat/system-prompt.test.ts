import { describe, expect, it } from 'vitest'
import { buildChatSystemPrompt } from './system-prompt'
import type { Project } from '../../domains/projects/getters'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Atlas',
    status: 'active',
    kind: null,
    summary: null,
    notes: null,
    startedOn: null,
    targetDate: null,
    completedOn: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    archivedAt: null,
    ...overrides,
  }
}

describe('buildChatSystemPrompt', () => {
  it("includes today's date", () => {
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', projects: [] })
    expect(prompt).toContain("Today's date is 2026-06-19")
  })

  it('includes grounding rules', () => {
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', projects: [] })
    expect(prompt).toContain('search_records')
    expect(prompt).toContain('get_records')
    expect(prompt).toContain('load structured details and bounded grounding chunks')
    expect(prompt).toContain('list_projects')
    expect(prompt.toLowerCase()).toContain('do not use outside knowledge or invent facts')
  })

  it('lists active project names and statuses', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Atlas', status: 'active' }),
      makeProject({ id: 'p2', name: 'Mercury', status: 'paused' }),
    ]
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', projects })
    expect(prompt).toContain('Atlas')
    expect(prompt).toContain('[active]')
    expect(prompt).toContain('Mercury')
    expect(prompt).toContain('[paused]')
  })

  it('includes project summary when present', () => {
    const projects = [makeProject({ name: 'Atlas', summary: 'Revamp the data pipeline.' })]
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', projects })
    expect(prompt).toContain('Revamp the data pipeline.')
  })

  it('includes target date when present', () => {
    const projects = [makeProject({ name: 'Atlas', targetDate: '2026-12-31' })]
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', projects })
    expect(prompt).toContain('target: 2026-12-31')
  })

  it('excludes archived projects', () => {
    const projects = [
      makeProject({ name: 'Atlas', archivedAt: null }),
      makeProject({ id: 'p2', name: 'OldProject', archivedAt: '2025-01-01T00:00:00Z' }),
    ]
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', projects })
    expect(prompt).toContain('Atlas')
    expect(prompt).not.toContain('OldProject')
  })

  it('excludes completed projects', () => {
    const projects = [
      makeProject({ name: 'Atlas', completedOn: null }),
      makeProject({ id: 'p2', name: 'DoneProject', completedOn: '2025-06-01' }),
    ]
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', projects })
    expect(prompt).toContain('Atlas')
    expect(prompt).not.toContain('DoneProject')
  })

  it('omits the projects section when no active projects', () => {
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', projects: [] })
    expect(prompt).not.toContain('Active projects:')
  })
})
