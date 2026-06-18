import { db } from '../db/client'
import { batch } from '../db/commands'
import { newId } from '../db/id'

export interface SeedResult {
  seeded: boolean
}

/**
 * Insert a small, coherent demo dataset covering every durable record type —
 * people (incl. the self row), an organization + affiliation, a project, tasks,
 * an interaction with participants, a document with a derived content chunk, a
 * memory linked to a person, a citation (evidence_ref) into that chunk, and a
 * tag. Everything is written in one `db_batch` transaction, ordered so each
 * foreign key resolves.
 *
 * No-op (returns `{ seeded: false }`) if the database already has people, so it
 * is safe to call on every startup until first-run setup (Plan 03/08) owns it.
 */
export async function seedDemoData(): Promise<SeedResult> {
  const existing = await db.selectFrom('people').select('id').limit(1).execute()
  if (existing.length > 0) {
    return { seeded: false }
  }

  const selfId = newId()
  const alexId = newId()
  const jordanId = newId()
  const orgId = newId()
  const affiliationId = newId()
  const projectId = newId()
  const projectPersonId = newId()
  const taskId = newId()
  const followUpTaskId = newId()
  const interactionId = newId()
  const participantId = newId()
  const documentId = newId()
  const chunkId = newId()
  const memoryId = newId()
  const memoryLinkId = newId()
  const evidenceId = newId()
  const tagId = newId()
  const taggingId = newId()

  await batch([
    db.insertInto('organizations').values({
      id: orgId,
      name: 'Northwind Labs',
      kind: 'company',
      domain: 'northwind.example',
    }),
    db.insertInto('people').values({
      id: selfId,
      fullName: 'You',
      isSelf: 1,
      summary: 'This is your own profile.',
    }),
    db.insertInto('people').values({
      id: alexId,
      fullName: 'Alex Rivera',
      preferredName: 'Alex',
      headline: 'Founder, Northwind Labs',
      primaryEmail: 'alex@northwind.example',
      relationshipStrength: 4,
      reconnectIntervalDays: 30,
      currentOrganizationId: orgId,
    }),
    db.insertInto('people').values({
      id: jordanId,
      fullName: 'Jordan Lee',
      headline: 'Product designer',
      relationshipStrength: 3,
    }),
    db.insertInto('affiliations').values({
      id: affiliationId,
      personId: alexId,
      organizationId: orgId,
      title: 'Founder',
      isCurrent: 1,
    }),
    db.insertInto('projects').values({
      id: projectId,
      name: 'Northwind partnership',
      status: 'active',
      summary: 'Explore a design partnership with Northwind Labs.',
    }),
    db.insertInto('projectPeople').values({
      id: projectPersonId,
      projectId,
      personId: alexId,
      role: 'sponsor',
    }),
    db.insertInto('tasks').values({
      id: taskId,
      title: 'Send Northwind proposal',
      status: 'open',
      priority: 1,
      projectId,
    }),
    db.insertInto('tasks').values({
      id: followUpTaskId,
      title: 'Follow up with Jordan on mockups',
      status: 'open',
    }),
    db.insertInto('documents').values({
      id: documentId,
      kind: 'note',
      title: 'Northwind kickoff notes',
      bodyText:
        'Kickoff call with Alex. We agreed to draft a partnership proposal and ' +
        'review initial mockups with Jordan next week.',
    }),
    db.insertInto('contentChunks').values({
      id: chunkId,
      recordType: 'document',
      recordId: documentId,
      chunkIndex: 0,
      text: 'We agreed to draft a partnership proposal.',
    }),
    db.insertInto('interactions').values({
      id: interactionId,
      kind: 'meeting',
      title: 'Northwind kickoff',
      bodyText: 'Discussed scope and timeline with Alex.',
      occurredAt: '2026-04-10T17:00:00.000Z',
    }),
    db.insertInto('interactionParticipants').values({
      id: participantId,
      interactionId,
      personId: alexId,
      role: 'attendee',
    }),
    db.insertInto('memories').values({
      id: memoryId,
      kind: 'fact',
      claim: 'Alex Rivera founded Northwind Labs.',
      confidence: 0.9,
    }),
    db.insertInto('memoryLinks').values({
      id: memoryLinkId,
      memoryId,
      recordType: 'person',
      recordId: alexId,
      role: 'subject',
    }),
    db.insertInto('evidenceRefs').values({
      id: evidenceId,
      subjectType: 'memory',
      subjectId: memoryId,
      chunkId,
      note: 'Stated during the kickoff call.',
    }),
    db.insertInto('tags').values({
      id: tagId,
      name: 'partnerships',
      color: '#b5651d',
    }),
    db.insertInto('taggings').values({
      id: taggingId,
      tagId,
      recordType: 'project',
      recordId: projectId,
    }),
  ])

  return { seeded: true }
}
