// Real-SQLite round-trip tests for the Plan 05a extraction apply pipeline.
//
// Split out of integration.test.mjs to keep each file focused; both share the
// in-memory SQLite harness in ./sqlite-harness.mjs. This file is .mjs for the
// same reason: it leans on the node:sqlite-backed bridge.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyExtraction,
  createPerson,
  createProject,
  getInteractionLinks,
  getPersonLinks,
  getTaskLinks,
  ingestDocument,
  ingestInteraction,
  listCitationsForSubject,
  listMemories,
  listMemoriesForRecord,
  listPeople,
  listProjects,
  listTasks,
  parseExtractionResult,
  runExtraction,
  setExtractor,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('05a extraction apply (real SQLite golden round-trip)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
    setExtractor(null)
  })

  it('turns a meeting into people, an org, an existing project link, a task, and a cited memory', async () => {
    const meeting = await ingestInteraction({
      kind: 'meeting',
      title: 'Northwind kickoff',
      bodyText:
        'Alex Rivera founded Northwind Labs and pitched the partnership proposal. Dana Scully attended.',
    })
    await createProject({ name: 'Northwind Partnership', status: 'active' })

    // A hand-authored result standing in for model output (the contract a model
    // must produce). Refs link entities before any database ids exist.
    const result = parseExtractionResult({
      people: [
        { ref: 'p_alex', fullName: 'Alex Rivera', primaryEmail: 'alex@northwind.com', headline: 'Founder' },
        { ref: 'p_dana', fullName: 'Dana Scully' },
      ],
      organizations: [{ ref: 'o_nw', name: 'Northwind Labs', domain: 'northwind.com' }],
      affiliations: [{ personRef: 'p_alex', organizationRef: 'o_nw', title: 'Founder', isCurrent: true }],
      projects: [{ ref: 'pr_part', name: 'Northwind Partnership', status: 'active' }],
      tasks: [
        {
          ref: 't_prop',
          title: 'Send the partnership proposal',
          status: 'open',
          dueAt: '2026-07-01',
          projectRef: 'pr_part',
          personRefs: ['p_alex'],
          organizationRefs: ['o_nw'],
          evidence: [{ chunkIndex: 0 }],
        },
      ],
      memories: [
        {
          kind: 'fact',
          claim: 'Alex Rivera founded Northwind Labs.',
          confidence: 0.9,
          subjects: [{ ref: 'p_alex', role: 'subject' }, { ref: 'o_nw' }],
          evidence: [{ chunkIndex: 0 }, { chunkIndex: 9 }], // chunk 9 does not exist
        },
      ],
    })

    const summary = await applyExtraction({ recordType: 'interaction', recordId: meeting.id }, result)
    expect(summary.people.created).toBe(2)
    expect(summary.organizations.created).toBe(1)
    expect(summary.projects.created).toBe(0)
    expect(summary.projects.matched).toBe(1)
    expect(summary.tasks.created).toBe(1)
    expect(summary.affiliations.created).toBe(1)
    expect(summary.memories.created).toBe(1)
    expect(summary.evidence.created).toBe(2) // task chunk 0 + memory chunk 0
    expect(summary.evidence.unresolved).toBe(1) // memory chunk 9

    const people = await listPeople()
    expect(people.map((p) => p.fullName).sort()).toEqual(['Alex Rivera', 'Dana Scully'])
    const alex = people.find((p) => p.fullName === 'Alex Rivera')

    const alexLinks = await getPersonLinks(alex.id)
    expect(alexLinks.organizations.map((o) => o.title)).toEqual(['Northwind Labs'])
    expect(alexLinks.interactions.map((i) => i.title)).toEqual(['Northwind kickoff'])
    expect(alexLinks.tasks.map((t) => t.title)).toEqual(['Send the partnership proposal'])

    const meetingLinks = await getInteractionLinks(meeting.id)
    expect(meetingLinks.organizations.map((o) => o.title)).toEqual(['Northwind Labs'])
    expect(meetingLinks.projects.map((p) => p.title)).toEqual(['Northwind Partnership'])
    expect(meetingLinks.tasks.map((t) => t.title)).toEqual(['Send the partnership proposal'])

    const task = (await listTasks())[0]
    expect(task.originInteractionId).toBe(meeting.id)
    const taskLinks = await getTaskLinks(task.id)
    expect(taskLinks.projects.map((p) => p.title)).toEqual(['Northwind Partnership'])
    expect(taskLinks.people.map((p) => p.title)).toEqual(['Alex Rivera'])
    const taskCitations = await listCitationsForSubject('task', task.id)
    expect(taskCitations).toHaveLength(1)
    expect(taskCitations[0].sourceType).toBe('interaction')

    const memoriesAboutAlex = await listMemoriesForRecord('person', alex.id)
    expect(memoriesAboutAlex.map((m) => m.claim)).toEqual(['Alex Rivera founded Northwind Labs.'])
    const memoryId = memoriesAboutAlex[0].id
    const fromSource = await listMemoriesForRecord('interaction', meeting.id)
    expect(fromSource.map((m) => m.id)).toContain(memoryId)
    const citations = await listCitationsForSubject('memory', memoryId)
    expect(citations).toHaveLength(1)
    expect(citations[0].quote).toContain('partnership proposal')
  })

  it('merges against an existing person and is idempotent on re-apply', async () => {
    const existing = await createPerson({ fullName: 'Alex Rivera', primaryEmail: 'alex@northwind.com' })
    const doc = await ingestDocument({ title: 'Note', bodyText: 'Alex notes.' })
    const result = parseExtractionResult({
      // Different display name, same email -> must merge onto the existing row.
      people: [{ ref: 'p1', fullName: 'Alexander Rivera', primaryEmail: 'ALEX@northwind.com' }],
      memories: [{ kind: 'preference', claim: 'Alex prefers async updates.', subjects: [{ ref: 'p1' }] }],
    })

    const first = await applyExtraction({ recordType: 'document', recordId: doc.id }, result)
    expect(first.people.created).toBe(0)
    expect(first.people.matched).toBe(1)
    expect(first.memories.created).toBe(1)
    expect(await listPeople()).toHaveLength(1)
    expect((await getPersonLinks(existing)).documents.map((d) => d.title)).toEqual(['Note'])

    const second = await applyExtraction({ recordType: 'document', recordId: doc.id }, result)
    expect(second.people.matched).toBe(1)
    expect(second.memories.created).toBe(0)
    expect(second.memories.duplicate).toBe(1)
    expect(second.links.created).toBe(0) // doc + memory links already exist
    expect(await listMemories()).toHaveLength(1)
  })

  it('holds low-confidence entities back as suggestions', async () => {
    const doc = await ingestDocument({ title: 'Tipsheet', bodyText: 'Rumored hire.' })
    const result = parseExtractionResult({
      people: [{ ref: 'p_low', fullName: 'Maybe Person', confidence: 0.2 }],
      // A confident, subject-less memory: nothing it depends on was gated.
      memories: [{ claim: 'A confident fact.', confidence: 0.95 }],
    })
    const summary = await applyExtraction({ recordType: 'document', recordId: doc.id }, result, {
      minConfidence: 0.6,
    })

    expect(summary.suggestions.map((s) => s.label)).toContain('Maybe Person')
    expect(summary.people.created).toBe(0)
    expect(await listPeople()).toHaveLength(0)
    // The confident memory still lands; it doesn't depend on the gated person.
    expect(summary.memories.created).toBe(1)
    expect(await listMemories()).toHaveLength(1)
    expect(await listMemoriesForRecord('document', doc.id)).toHaveLength(1)
  })

  it('suggests unmatched projects instead of creating project rows', async () => {
    const doc = await ingestDocument({ title: 'Topic note', bodyText: 'Discussed an emerging Alpha Launch.' })
    const result = parseExtractionResult({
      projects: [{ ref: 'pr_alpha', name: 'Alpha Launch', confidence: 0.95 }],
    })

    const summary = await applyExtraction({ recordType: 'document', recordId: doc.id }, result)

    expect(summary.projects.created).toBe(0)
    expect(summary.projects.matched).toBe(0)
    expect(summary.suggestions.map((s) => s.label)).toEqual(['Alpha Launch'])
    expect(await listProjects()).toHaveLength(0)
  })

  it('holds a task back when a referenced person or project was gated out', async () => {
    const doc = await ingestDocument({ title: 'Tipsheet', bodyText: 'Rumored task.' })
    // High confidence itself, but every dependency is below threshold.
    const result = parseExtractionResult({
      people: [{ ref: 'p_low', fullName: 'Maybe Owner', confidence: 0.2 }],
      projects: [{ ref: 'pr_low', name: 'Maybe Project', confidence: 0.2 }],
      tasks: [
        { ref: 't_dep', title: 'Do the rumored thing', confidence: 0.95,
          projectRef: 'pr_low', personRefs: ['p_low'], evidence: [{ chunkIndex: 0 }] },
      ],
    })
    const summary = await applyExtraction({ recordType: 'document', recordId: doc.id }, result, {
      minConfidence: 0.6,
    })

    // The gated person/project become suggestions, and so does the dependent task
    // rather than landing without its owner/project (or any partial evidence).
    expect(summary.suggestions.map((s) => s.label).sort()).toEqual([
      'Do the rumored thing', 'Maybe Owner', 'Maybe Project',
    ])
    expect(summary.tasks.created).toBe(0)
    expect(await listTasks()).toHaveLength(0)
    expect(summary.evidence.created).toBe(0)
  })

  it('holds a memory back when its subject was gated out', async () => {
    const doc = await ingestDocument({ title: 'Tipsheet', bodyText: 'Rumored fact.' })
    // High confidence claim, but its only subject was gated out.
    const result = parseExtractionResult({
      people: [{ ref: 'p_low', fullName: 'Maybe Person', confidence: 0.2 }],
      memories: [
        { claim: 'A fact about a maybe person.', confidence: 0.95, subjects: [{ ref: 'p_low' }] },
      ],
    })
    const summary = await applyExtraction({ recordType: 'document', recordId: doc.id }, result, {
      minConfidence: 0.6,
    })

    expect(summary.suggestions.map((s) => s.label).sort()).toEqual([
      'A fact about a maybe person.', 'Maybe Person',
    ])
    expect(summary.memories.created).toBe(0)
    expect(await listMemories()).toHaveLength(0)
    expect(await listMemoriesForRecord('document', doc.id)).toHaveLength(0)
  })

  it('runs the pipeline through the extractor seam only when one is registered', async () => {
    const doc = await ingestDocument({ title: 'Standup', bodyText: 'Ship the docs.' })

    // No extractor configured (the Plan 06 default): a no-op, never an error.
    setExtractor(null)
    expect(await runExtraction('document', doc.id)).toBeNull()

    // A registered extractor receives the deterministic context and its output
    // is validated and applied.
    setExtractor((context) => ({
      tasks: [{ ref: 't1', title: `Follow up on ${context.source.title}`, evidence: [{ chunkIndex: 0 }] }],
    }))
    const summary = await runExtraction('document', doc.id)
    expect(summary.tasks.created).toBe(1)
    expect((await listTasks()).map((t) => t.title)).toEqual(['Follow up on Standup'])
    setExtractor(null)
  })
})
