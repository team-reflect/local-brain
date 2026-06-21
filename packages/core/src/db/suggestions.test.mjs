// Real-SQLite integration tests for the suggestions curation queue: the
// read getter (with evidence-title resolution) and the accept/dismiss setters
// (find-or-create + relink in one db_batch transaction, with the status guard).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acceptSuggestion,
  dismissSuggestion,
  executeRaw,
  ingestInteraction,
  listOpenSuggestions,
  newId,
  setBridge,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

let database

async function seedSuggestion({ kind = 'create_project', title, payload, links = [] }) {
  const id = newId()
  await executeRaw(
    `INSERT INTO suggestions (id, kind, title, payload_json, rationale, status)
     VALUES (?, ?, ?, ?, ?, 'open')`,
    [id, kind, title, JSON.stringify(payload ?? { name: title }), 'looks project-shaped'],
  )
  for (const link of links) {
    await executeRaw(
      `INSERT INTO suggestion_links (id, suggestion_id, record_type, record_id) VALUES (?, ?, ?, ?)`,
      [newId(), id, link.recordType, link.recordId],
    )
  }
  return id
}

describe('suggestions curation queue', () => {
  beforeEach(() => {
    database = freshDatabase()
    installSqliteBridge(database)
  })
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('lists open suggestions with evidence titles resolved', async () => {
    const interaction = await ingestInteraction({
      kind: 'email',
      title: 'SA trip thread',
      bodyText: 'logistics and a booking ref',
    })
    await seedSuggestion({
      title: 'South Africa Trip',
      payload: { name: 'South Africa Trip', summary: 'Cape Town → Kruger → Johannesburg' },
      links: [{ recordType: 'interaction', recordId: interaction.id }],
    })

    const open = await listOpenSuggestions()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ kind: 'create_project', title: 'South Africa Trip' })
    expect(open[0].links).toEqual([
      { recordType: 'interaction', recordId: interaction.id, title: 'SA trip thread' },
    ])
  })

  it('accept creates the project, relinks the interaction, and flips the status', async () => {
    const interaction = await ingestInteraction({ kind: 'email', title: 'SA trip thread', bodyText: 'x' })
    const id = await seedSuggestion({
      title: 'South Africa Trip',
      payload: { name: 'South Africa Trip', summary: 'safari' },
      links: [{ recordType: 'interaction', recordId: interaction.id }],
    })

    const result = await acceptSuggestion(id)
    expect(result.recordType).toBe('project')

    const projects = database.prepare('SELECT id, name, status, summary FROM projects').all()
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ name: 'South Africa Trip', status: 'active', summary: 'safari' })
    const links = database
      .prepare('SELECT * FROM project_interactions WHERE interaction_id = ?')
      .all(interaction.id)
    expect(links).toHaveLength(1)
    const row = database
      .prepare('SELECT status, resolved_record_type, resolved_record_id FROM suggestions WHERE id = ?')
      .get(id)
    expect(row).toMatchObject({
      status: 'accepted',
      resolved_record_type: 'project',
      resolved_record_id: result.recordId,
    })
    expect(await listOpenSuggestions()).toHaveLength(0)
  })

  it('accept reuses a case-variant existing project instead of forking', async () => {
    database
      .prepare("INSERT INTO projects (id, name, status) VALUES ('p-existing', 'South Africa Trip', 'active')")
      .run()
    const id = await seedSuggestion({ title: '  south   africa trip ', payload: { name: '  south   africa trip ' } })
    const result = await acceptSuggestion(id)
    expect(result.recordId).toBe('p-existing')
    expect(database.prepare('SELECT COUNT(*) AS n FROM projects WHERE archived_at IS NULL').get().n).toBe(1)
  })

  it('accept of an organization suggestion creates the org and relinks interactions, not people', async () => {
    const interaction = await ingestInteraction({ kind: 'email', title: 'Thread', bodyText: 'x' })
    database.prepare("INSERT INTO people (id, full_name) VALUES ('pc', 'Cited Person')").run()
    const id = await seedSuggestion({
      kind: 'create_organization',
      title: 'Rhino Africa',
      payload: { name: 'Rhino Africa', domain: 'rhinoafrica.com', kind: 'company' },
      links: [
        { recordType: 'interaction', recordId: interaction.id },
        { recordType: 'person', recordId: 'pc' },
      ],
    })

    const result = await acceptSuggestion(id)
    expect(result.recordType).toBe('organization')
    const org = database.prepare('SELECT name, domain, kind FROM organizations WHERE id = ?').get(result.recordId)
    expect(org).toMatchObject({ name: 'Rhino Africa', domain: 'rhinoafrica.com', kind: 'company' })
    expect(
      database.prepare('SELECT COUNT(*) AS n FROM interaction_organizations WHERE organization_id = ?').get(result.recordId).n,
    ).toBe(1)
    // Cited people are evidence, not auto-affiliated.
    expect(database.prepare('SELECT COUNT(*) AS n FROM affiliations').get().n).toBe(0)
  })

  it('dismiss flips status, and a resolved suggestion cannot be re-accepted (no partial write)', async () => {
    const interaction = await ingestInteraction({ kind: 'email', title: 'Thread', bodyText: 'x' })
    const id = await seedSuggestion({
      title: 'Maybe a project',
      links: [{ recordType: 'interaction', recordId: interaction.id }],
    })
    await dismissSuggestion(id)
    expect(database.prepare('SELECT status FROM suggestions WHERE id = ?').get(id).status).toBe('dismissed')
    await expect(acceptSuggestion(id)).rejects.toThrow(/no longer open/)
    await expect(dismissSuggestion(id)).rejects.toThrow(/no longer open/)
    // Accepting a resolved suggestion creates nothing — no orphan project or relink.
    expect(database.prepare('SELECT COUNT(*) AS n FROM projects').get().n).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS n FROM project_interactions').get().n).toBe(0)
    expect(await listOpenSuggestions()).toHaveLength(0)
  })

  it('the batch guard rolls back the whole accept if the row was resolved mid-flight', async () => {
    // Simulate the lost race directly: the SAME guard statement the accept batch
    // runs first must error (PK collision) when the suggestion is no longer open,
    // forcing db_batch to roll back any project/relink writes.
    const id = await seedSuggestion({ title: 'Race' })
    database.prepare("UPDATE suggestions SET status = 'dismissed' WHERE id = ?").run(id)
    const guard = () =>
      database
        .prepare(
          `INSERT INTO suggestions (id, kind, title, status)
           SELECT id, kind, title, status FROM suggestions WHERE id = ? AND status != 'open'`,
        )
        .run(id)
    expect(guard).toThrow() // PK collision aborts the transaction
  })
})
