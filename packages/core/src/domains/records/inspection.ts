import type { Selectable } from 'kysely'
import type {
  Affiliations,
  AiNotes,
  AssetLinks,
  ContentChunks,
  EvidenceRefs,
  ExternalIdentities,
  ExtractedFacts,
  InteractionParticipants,
  InteractionTranscripts,
  MemoryLinks,
  OrganizationProfiles,
  PersonEmails,
  PersonPhones,
  RecordProvenance,
  Tags,
} from '@local-brain/db'
import { db } from '../../db/client'
import type { RecordKind } from '../relations/types'

export type RecordInspectionKind =
  | RecordKind
  | 'organization_profile'
  | 'interaction_transcript'
  | 'ai_note'
  | 'extracted_fact'
  | 'memory'

export type RecordAffiliation = Selectable<Affiliations>
export type RecordAiNote = Selectable<AiNotes>
export type RecordAssetLink = Selectable<AssetLinks>
export type RecordContentChunk = Selectable<ContentChunks>
export type RecordEvidenceRef = Selectable<EvidenceRefs>
export type RecordExternalIdentity = Selectable<ExternalIdentities>
export type RecordExtractedFact = Selectable<ExtractedFacts>
export type RecordInteractionParticipant = Selectable<InteractionParticipants>
export type RecordInteractionTranscript = Selectable<InteractionTranscripts>
export type RecordMemoryLink = Selectable<MemoryLinks>
export type RecordOrganizationProfile = Selectable<OrganizationProfiles>
export type RecordPersonEmail = Selectable<PersonEmails>
export type RecordPersonPhone = Selectable<PersonPhones>
export type RecordProvenanceEntry = Selectable<RecordProvenance>

export interface RecordRelationshipSummary {
  personId: string | null
  lastInteractionAt: string | null
  relationshipStrength: number | null
  recentInteractions: number | null
  daysSinceLast: number | null
  openTasks: number | null
}

export interface RecordTagging extends Selectable<Tags> {
  taggingId: string
  sourceId: string | null
  taggedAt: string
}

export interface RecordInspection {
  personEmails: RecordPersonEmail[]
  personPhones: RecordPersonPhone[]
  affiliations: RecordAffiliation[]
  relationshipSummary: RecordRelationshipSummary | null
  organizationProfiles: RecordOrganizationProfile[]
  interactionParticipants: RecordInteractionParticipant[]
  interactionTranscripts: RecordInteractionTranscript[]
  externalIdentities: RecordExternalIdentity[]
  provenance: RecordProvenanceEntry[]
  tags: RecordTagging[]
  extractedFacts: RecordExtractedFact[]
  aiNotes: RecordAiNote[]
  contentChunks: RecordContentChunk[]
  evidenceRefs: RecordEvidenceRef[]
  memoryLinks: RecordMemoryLink[]
  assetLinks: RecordAssetLink[]
}

const EMPTY_INSPECTION: RecordInspection = {
  personEmails: [],
  personPhones: [],
  affiliations: [],
  relationshipSummary: null,
  organizationProfiles: [],
  interactionParticipants: [],
  interactionTranscripts: [],
  externalIdentities: [],
  provenance: [],
  tags: [],
  extractedFacts: [],
  aiNotes: [],
  contentChunks: [],
  evidenceRefs: [],
  memoryLinks: [],
  assetLinks: [],
}

export async function getRecordInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordInspection> {
  const [
    personEmails,
    personPhones,
    affiliations,
    relationshipSummary,
    organizationProfiles,
    interactionParticipants,
    interactionTranscripts,
    externalIdentities,
    provenance,
    tags,
    extractedFacts,
    aiNotes,
    contentChunks,
    evidenceRefs,
    memoryLinks,
    assetLinks,
  ] = await Promise.all([
    listPersonEmailsForInspection(recordType, recordId),
    listPersonPhonesForInspection(recordType, recordId),
    listAffiliationsForInspection(recordType, recordId),
    getRelationshipSummaryForInspection(recordType, recordId),
    listOrganizationProfilesForInspection(recordType, recordId),
    listInteractionParticipantsForInspection(recordType, recordId),
    listInteractionTranscriptsForInspection(recordType, recordId),
    listExternalIdentitiesForInspection(recordType, recordId),
    listProvenanceForInspection(recordType, recordId),
    listTagsForInspection(recordType, recordId),
    listExtractedFactsForInspection(recordType, recordId),
    listAiNotesForInspection(recordType, recordId),
    listContentChunksForInspection(recordType, recordId),
    listEvidenceRefsForInspection(recordType, recordId),
    listMemoryLinksForInspection(recordType, recordId),
    listAssetLinksForInspection(recordType, recordId),
  ])

  return {
    ...EMPTY_INSPECTION,
    personEmails,
    personPhones,
    affiliations,
    relationshipSummary,
    organizationProfiles,
    interactionParticipants,
    interactionTranscripts,
    externalIdentities,
    provenance,
    tags,
    extractedFacts,
    aiNotes,
    contentChunks,
    evidenceRefs,
    memoryLinks,
    assetLinks,
  }
}

function listPersonEmailsForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordPersonEmail[]> {
  if (recordType !== 'person') return Promise.resolve([])
  return db
    .selectFrom('personEmails')
    .selectAll()
    .where('personId', '=', recordId)
    .orderBy('isPrimary', 'desc')
    .orderBy('email', 'asc')
    .execute()
}

function listPersonPhonesForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordPersonPhone[]> {
  if (recordType !== 'person') return Promise.resolve([])
  return db
    .selectFrom('personPhones')
    .selectAll()
    .where('personId', '=', recordId)
    .orderBy('isPrimary', 'desc')
    .orderBy('phone', 'asc')
    .execute()
}

function listAffiliationsForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordAffiliation[]> {
  if (recordType === 'person') {
    return db
      .selectFrom('affiliations')
      .selectAll()
      .where('personId', '=', recordId)
      .orderBy('isCurrent', 'desc')
      .orderBy('isPrimary', 'desc')
      .orderBy('createdAt', 'desc')
      .execute()
  }
  if (recordType === 'organization') {
    return db
      .selectFrom('affiliations')
      .selectAll()
      .where('organizationId', '=', recordId)
      .orderBy('isCurrent', 'desc')
      .orderBy('isPrimary', 'desc')
      .orderBy('createdAt', 'desc')
      .execute()
  }
  return Promise.resolve([])
}

function getRelationshipSummaryForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordRelationshipSummary | null> {
  if (recordType !== 'person') return Promise.resolve(null)
  return db
    .selectFrom('relationshipStrengths')
    .select([
      'personId',
      'lastInteractionAt',
      'relationshipStrength',
      'recentInteractions',
      'daysSinceLast',
      'openTasks',
    ])
    .where('personId', '=', recordId)
    .executeTakeFirst()
    .then((row) => row ?? null)
}

function listOrganizationProfilesForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordOrganizationProfile[]> {
  if (recordType !== 'organization') return Promise.resolve([])
  return db
    .selectFrom('organizationProfiles')
    .selectAll()
    .where('organizationId', '=', recordId)
    .orderBy('researchedAt', 'desc')
    .orderBy('createdAt', 'desc')
    .execute()
}

function listInteractionParticipantsForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordInteractionParticipant[]> {
  if (recordType !== 'interaction') return Promise.resolve([])
  return db
    .selectFrom('interactionParticipants')
    .selectAll()
    .where('interactionId', '=', recordId)
    .orderBy('createdAt', 'asc')
    .execute()
}

function listInteractionTranscriptsForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordInteractionTranscript[]> {
  if (recordType !== 'interaction') return Promise.resolve([])
  return db
    .selectFrom('interactionTranscripts')
    .selectAll()
    .where('interactionId', '=', recordId)
    .orderBy('createdAt', 'asc')
    .execute()
}

function listExternalIdentitiesForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordExternalIdentity[]> {
  return db
    .selectFrom('externalIdentities')
    .selectAll()
    .where('entityType', '=', recordType)
    .where('entityId', '=', recordId)
    .orderBy('createdAt', 'asc')
    .execute()
}

function listProvenanceForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordProvenanceEntry[]> {
  return db
    .selectFrom('recordProvenance')
    .selectAll()
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .orderBy('createdAt', 'asc')
    .execute()
}

function listTagsForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordTagging[]> {
  return db
    .selectFrom('taggings')
    .innerJoin('tags', 'tags.id', 'taggings.tagId')
    .where('taggings.recordType', '=', recordType)
    .where('taggings.recordId', '=', recordId)
    .orderBy('tags.name', 'asc')
    .select([
      'tags.id',
      'tags.name',
      'tags.slug',
      'tags.color',
      'tags.description',
      'tags.createdAt',
      'tags.updatedAt',
      'taggings.id as taggingId',
      'taggings.sourceId as sourceId',
      'taggings.createdAt as taggedAt',
    ])
    .execute()
}

function listExtractedFactsForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordExtractedFact[]> {
  return db
    .selectFrom('extractedFacts')
    .selectAll()
    .where('subjectType', '=', recordType)
    .where('subjectId', '=', recordId)
    .where('archivedAt', 'is', null)
    .orderBy('createdAt', 'desc')
    .execute()
}

function listAiNotesForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordAiNote[]> {
  if (recordType === 'document') {
    return db
      .selectFrom('aiNotes')
      .selectAll()
      .where('documentId', '=', recordId)
      .orderBy('createdAt', 'desc')
      .execute()
  }
  if (recordType === 'interaction') {
    return db
      .selectFrom('aiNotes')
      .selectAll()
      .where('interactionId', '=', recordId)
      .orderBy('createdAt', 'desc')
      .execute()
  }
  return db
    .selectFrom('aiNotes')
    .selectAll()
    .where('subjectType', '=', recordType)
    .where('subjectId', '=', recordId)
    .orderBy('createdAt', 'desc')
    .execute()
}

function listContentChunksForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordContentChunk[]> {
  return db
    .selectFrom('contentChunks')
    .selectAll()
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .orderBy('chunkIndex', 'asc')
    .execute()
}

function listEvidenceRefsForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordEvidenceRef[]> {
  return db
    .selectFrom('evidenceRefs')
    .selectAll()
    .where('subjectType', '=', recordType)
    .where('subjectId', '=', recordId)
    .orderBy('createdAt', 'asc')
    .execute()
}

function listMemoryLinksForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordMemoryLink[]> {
  return db
    .selectFrom('memoryLinks')
    .selectAll()
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .orderBy('createdAt', 'asc')
    .execute()
}

function listAssetLinksForInspection(
  recordType: RecordInspectionKind,
  recordId: string,
): Promise<RecordAssetLink[]> {
  if (recordType === 'asset') {
    return db
      .selectFrom('assetLinks')
      .selectAll()
      .where('assetId', '=', recordId)
      .orderBy('sortOrder', 'asc')
      .orderBy('createdAt', 'asc')
      .execute()
  }
  return db
    .selectFrom('assetLinks')
    .selectAll()
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .orderBy('sortOrder', 'asc')
    .orderBy('createdAt', 'asc')
    .execute()
}
