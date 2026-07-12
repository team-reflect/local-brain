import type { Selectable } from 'kysely'
import type {
  AiNotes,
  ExtractedFacts,
  InteractionTranscripts,
  OrganizationProfiles,
} from '@local-brain/db'
import { db } from '../../db/client'
import { getAssetDetail } from '../../domains/assets/getters'
import { getDocument } from '../../domains/documents/getters'
import {
  getInteraction,
  getInteractionEventDetail,
  listInteractionParticipantRows,
  listInteractionParticipants,
} from '../../domains/interactions/getters'
import { getMemory } from '../../domains/memories/getters'
import { getOrganization } from '../../domains/organizations/getters'
import {
  getPerson,
  listPersonAffiliations,
  listPersonEmails,
  listPersonPhones,
} from '../../domains/people/getters'
import { getProject } from '../../domains/projects/getters'
import { getTask, listTaskAssignees } from '../../domains/tasks/getters'
import type { SourceRecordType } from '../../retrieval/retrieve'
import { cleanMetadata, parseJsonField } from './record-summary-metadata'
import { isAiNoteAnchorVisible, isVisibleArchived } from './record-visibility'

export interface RecordSummary {
  title: string | null
  date: string | null
  metadata: Record<string, unknown>
}

type AiNote = Selectable<AiNotes>
type ExtractedFact = Selectable<ExtractedFacts>
type InteractionTranscript = Selectable<InteractionTranscripts>
type OrganizationProfile = Selectable<OrganizationProfiles>

async function getAiNote(id: string): Promise<AiNote | undefined> {
  return db.selectFrom('aiNotes').selectAll().where('id', '=', id).executeTakeFirst()
}

async function getExtractedFact(id: string): Promise<ExtractedFact | undefined> {
  return db.selectFrom('extractedFacts').selectAll().where('id', '=', id).executeTakeFirst()
}

async function getInteractionTranscript(id: string): Promise<InteractionTranscript | undefined> {
  return db.selectFrom('interactionTranscripts').selectAll().where('id', '=', id).executeTakeFirst()
}

async function getOrganizationProfile(id: string): Promise<OrganizationProfile | undefined> {
  return db.selectFrom('organizationProfiles').selectAll().where('id', '=', id).executeTakeFirst()
}

async function personSummary(id: string): Promise<RecordSummary | undefined> {
  const [person, emails, phones, affiliations] = await Promise.all([
    getPerson(id),
    listPersonEmails(id),
    listPersonPhones(id),
    listPersonAffiliations(id),
  ])
  if (!person || !isVisibleArchived(person)) return undefined

  return {
    title: person.fullName,
    date: person.lastInteractionAt ?? person.updatedAt,
    metadata: cleanMetadata({
      preferredName: person.preferredName,
      headline: person.headline,
      summary: person.summary,
      notes: person.notes,
      primaryEmail: person.primaryEmail,
      primaryPhone: person.primaryPhone,
      location: person.location,
      city: person.city,
      region: person.region,
      country: person.country,
      timezone: person.timezone,
      linkedinUrl: person.linkedinUrl,
      website: person.website,
      isSelf: Boolean(person.isSelf),
      currentOrganizationId: person.currentOrganizationId,
      currentTitle: person.currentTitle,
      currentDepartment: person.currentDepartment,
      roleFamily: person.roleFamily,
      seniority: person.seniority,
      lastInteractionAt: person.lastInteractionAt,
      relationshipStrength: person.relationshipStrength,
      emails: emails.map((email) => ({
        email: email.email,
        label: email.label,
        isPrimary: Boolean(email.isPrimary),
      })),
      phones: phones.map((phone) => ({
        phone: phone.phone,
        label: phone.label,
        isPrimary: Boolean(phone.isPrimary),
      })),
      affiliations: affiliations.map((affiliation) => ({
        organizationId: affiliation.organizationId,
        organizationName: affiliation.organizationName,
        title: affiliation.title,
        department: affiliation.department,
        role: affiliation.role,
        startedOn: affiliation.startedOn,
        endedOn: affiliation.endedOn,
        isCurrent: Boolean(affiliation.isCurrent),
        isPrimary: Boolean(affiliation.isPrimary),
      })),
      createdAt: person.createdAt,
      updatedAt: person.updatedAt,
    }),
  }
}

async function organizationSummary(id: string): Promise<RecordSummary | undefined> {
  const organization = await getOrganization(id)
  if (!organization || !isVisibleArchived(organization)) return undefined
  return {
    title: organization.name,
    date: organization.updatedAt,
    metadata: cleanMetadata({
      kind: organization.kind,
      domain: organization.domain,
      headline: organization.headline,
      summary: organization.summary,
      website: organization.website,
      industry: organization.industry,
      location: organization.location,
      hqCity: organization.hqCity,
      hqRegion: organization.hqRegion,
      hqCountry: organization.hqCountry,
      notes: organization.notes,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    }),
  }
}

async function organizationProfileSummary(id: string): Promise<RecordSummary | undefined> {
  const profile = await getOrganizationProfile(id)
  if (!profile) return undefined
  const organization = await getOrganization(profile.organizationId)
  if (!organization || !isVisibleArchived(organization)) return undefined
  return {
    title: profile.oneLineDescription ?? profile.canonicalName ?? organization.name,
    date: profile.researchedAt ?? profile.updatedAt,
    metadata: cleanMetadata({
      organizationId: profile.organizationId,
      organizationName: organization.name,
      canonicalName: profile.canonicalName,
      website: profile.website,
      category: profile.category,
      whyItMatters: profile.whyItMatters,
      offerings: parseJsonField(profile.offeringsJson),
      notablePeople: parseJsonField(profile.notablePeopleJson),
      suggestedTags: parseJsonField(profile.suggestedTagsJson),
      reviewFlags: parseJsonField(profile.reviewFlagsJson),
      sourceUrls: parseJsonField(profile.sourceUrlsJson),
      model: profile.model,
      promptFingerprint: profile.promptFingerprint,
      researchedAt: profile.researchedAt,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    }),
  }
}

async function projectSummary(id: string): Promise<RecordSummary | undefined> {
  const project = await getProject(id)
  if (!project || !isVisibleArchived(project)) return undefined
  return {
    title: project.name,
    date: project.targetDate ?? project.updatedAt,
    metadata: cleanMetadata({
      status: project.status,
      kind: project.kind,
      summary: project.summary,
      notes: project.notes,
      startedOn: project.startedOn,
      targetDate: project.targetDate,
      completedOn: project.completedOn,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }),
  }
}

async function taskSummary(id: string): Promise<RecordSummary | undefined> {
  const [task, assignees] = await Promise.all([getTask(id), listTaskAssignees(id)])
  if (!task || !isVisibleArchived(task)) return undefined
  return {
    title: task.title,
    date: task.dueAt ?? task.scheduledFor ?? task.updatedAt,
    metadata: cleanMetadata({
      status: task.status,
      priority: task.priority,
      description: task.description,
      projectId: task.projectId,
      dueAt: task.dueAt,
      scheduledFor: task.scheduledFor,
      completedAt: task.completedAt,
      originDocumentId: task.originDocumentId,
      originInteractionId: task.originInteractionId,
      sourceRecordType: task.sourceRecordType,
      sourceRecordId: task.sourceRecordId,
      assignees,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }),
  }
}

async function documentSummary(id: string): Promise<RecordSummary | undefined> {
  const document = await getDocument(id)
  if (!document || !isVisibleArchived(document)) return undefined
  return {
    title: document.title,
    date: document.occurredAt ?? document.authoredAt ?? document.updatedAt,
    metadata: cleanMetadata({
      kind: document.kind,
      summary: document.summary,
      mimeType: document.mimeType,
      originalPath: document.originalPath,
      originalUrl: document.originalUrl,
      contentHash: document.contentHash,
      authoredAt: document.authoredAt,
      occurredAt: document.occurredAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }),
  }
}

async function interactionSummary(id: string): Promise<RecordSummary | undefined> {
  const [interaction, participants, participantRows, eventDetail] = await Promise.all([
    getInteraction(id),
    listInteractionParticipants(id),
    listInteractionParticipantRows(id),
    getInteractionEventDetail(id),
  ])
  if (!interaction || !isVisibleArchived(interaction)) return undefined
  const participantById = new Map(participants.map((person) => [person.id, person]))

  return {
    title: interaction.title,
    date: interaction.occurredAt ?? interaction.updatedAt,
    metadata: cleanMetadata({
      kind: interaction.kind,
      summary: interaction.summary,
      occurredAt: interaction.occurredAt,
      endedAt: interaction.endedAt,
      durationSeconds: interaction.durationSeconds,
      location: interaction.location,
      externalId: interaction.externalId,
      originalPath: interaction.originalPath,
      originalUrl: interaction.originalUrl,
      contentHash: interaction.contentHash,
      metadata: parseJsonField(interaction.metadataJson),
      participants: participantRows.map((row) => {
        const person = row.personId ? participantById.get(row.personId) : undefined
        return {
          personId: row.personId,
          name: person?.fullName ?? row.displayName ?? row.handle,
          role: row.role,
          handle: row.handle,
          displayName: row.displayName,
        }
      }),
      event: eventDetail,
      createdAt: interaction.createdAt,
      updatedAt: interaction.updatedAt,
    }),
  }
}

async function interactionTranscriptSummary(id: string): Promise<RecordSummary | undefined> {
  const transcript = await getInteractionTranscript(id)
  if (!transcript) return undefined
  const interaction = await getInteraction(transcript.interactionId)
  if (!interaction || !isVisibleArchived(interaction)) return undefined

  return {
    title: interaction.title,
    date: interaction.occurredAt ?? transcript.transcribedAt ?? transcript.updatedAt,
    metadata: cleanMetadata({
      interactionId: transcript.interactionId,
      interactionKind: interaction.kind,
      interactionTitle: interaction.title,
      interactionOccurredAt: interaction.occurredAt,
      format: transcript.format,
      language: transcript.language,
      recordingUrl: transcript.recordingUrl,
      storagePath: transcript.storagePath,
      sourceId: transcript.sourceId,
      sourceExternalId: transcript.sourceExternalId,
      transcribedBy: transcript.transcribedBy,
      transcribedAt: transcript.transcribedAt,
      contentHash: transcript.contentHash,
      metadata: parseJsonField(transcript.metadataJson),
      createdAt: transcript.createdAt,
      updatedAt: transcript.updatedAt,
    }),
  }
}

async function aiNoteSummary(id: string): Promise<RecordSummary | undefined> {
  const note = await getAiNote(id)
  if (!note || !(await isAiNoteAnchorVisible(note))) return undefined
  return {
    title: note.title,
    date: note.generatedAt ?? note.updatedAt,
    metadata: cleanMetadata({
      kind: note.kind,
      interactionId: note.interactionId,
      documentId: note.documentId,
      subjectType: note.subjectType,
      subjectId: note.subjectId,
      contentFormat: note.contentFormat,
      model: note.model,
      promptFingerprint: note.promptFingerprint,
      sourceId: note.sourceId,
      metadata: parseJsonField(note.metadataJson),
      generatedAt: note.generatedAt,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }),
  }
}

async function extractedFactSummary(id: string): Promise<RecordSummary | undefined> {
  const fact = await getExtractedFact(id)
  if (!fact || !isVisibleArchived(fact)) return undefined
  return {
    title: fact.key,
    date: fact.observedAt ?? fact.updatedAt,
    metadata: cleanMetadata({
      subjectType: fact.subjectType,
      subjectId: fact.subjectId,
      key: fact.key,
      valueText: fact.valueText,
      valueJson: parseJsonField(fact.valueJson),
      confidence: fact.confidence,
      sourceRecordType: fact.sourceRecordType,
      sourceRecordId: fact.sourceRecordId,
      sourceExcerpt: fact.sourceExcerpt,
      observedAt: fact.observedAt,
      model: fact.model,
      promptFingerprint: fact.promptFingerprint,
      metadata: parseJsonField(fact.metadataJson),
      createdAt: fact.createdAt,
      updatedAt: fact.updatedAt,
    }),
  }
}

async function memorySummary(id: string): Promise<RecordSummary | undefined> {
  const memory = await getMemory(id)
  if (!memory || !isVisibleArchived(memory)) return undefined
  return {
    title: memory.claim,
    date: memory.validFrom ?? memory.updatedAt,
    metadata: cleanMetadata({
      kind: memory.kind,
      claim: memory.claim,
      confidence: memory.confidence,
      validFrom: memory.validFrom,
      validTo: memory.validTo,
      promotedFromFactId: memory.promotedFromFactId,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    }),
  }
}

async function assetSummary(id: string): Promise<RecordSummary | undefined> {
  const detail = await getAssetDetail(id)
  if (!detail) return undefined
  return {
    title: detail.asset.originalFilename ?? detail.asset.storagePath,
    date: detail.asset.updatedAt,
    metadata: cleanMetadata({
      kind: detail.asset.kind,
      mimeType: detail.asset.mimeType,
      byteSize: detail.asset.byteSize,
      contentHash: detail.asset.contentHash,
      storagePath: detail.asset.storagePath,
      originalFilename: detail.asset.originalFilename,
      originalPath: detail.asset.originalPath,
      originalUrl: detail.asset.originalUrl,
      width: detail.asset.width,
      height: detail.asset.height,
      text: detail.text,
      linkedRecords: detail.linkedRecords,
      createdAt: detail.asset.createdAt,
      updatedAt: detail.asset.updatedAt,
    }),
  }
}

export function recordSummary(
  recordType: SourceRecordType,
  recordId: string,
): Promise<RecordSummary | undefined> {
  switch (recordType) {
    case 'person':
      return personSummary(recordId)
    case 'organization':
      return organizationSummary(recordId)
    case 'organization_profile':
      return organizationProfileSummary(recordId)
    case 'project':
      return projectSummary(recordId)
    case 'task':
      return taskSummary(recordId)
    case 'document':
      return documentSummary(recordId)
    case 'interaction':
      return interactionSummary(recordId)
    case 'interaction_transcript':
      return interactionTranscriptSummary(recordId)
    case 'ai_note':
      return aiNoteSummary(recordId)
    case 'extracted_fact':
      return extractedFactSummary(recordId)
    case 'memory':
      return memorySummary(recordId)
    case 'asset':
      return assetSummary(recordId)
  }
}
