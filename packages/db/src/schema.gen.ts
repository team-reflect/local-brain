/* eslint-disable max-lines -- generated; grows with the migration set */
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with `pnpm --filter @local-brain/db db:codegen`, which replays
 * crates/brain-schema/migrations into an in-memory SQLite database and
 * introspects it. The drift check in scripts/check-drift.mjs (run by
 * `pnpm test`) fails if this file is stale.
 */
import type { ColumnType } from 'kysely'

/**
 * A column SQLite fills in when omitted (DEFAULT values, e.g. created_at):
 * optional on insert, always present on select. Mirrors kysely-codegen.
 */
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>

export type SelectOnly<T> = ColumnType<T, never, never>

export interface Affiliations {
  id: string
  personId: string
  organizationId: string
  title: string | null
  department: string | null
  role: string | null
  roleFamily: string | null
  seniority: string | null
  startedOn: string | null
  endedOn: string | null
  isCurrent: Generated<number>
  isPrimary: Generated<number>
  evidenceRefId: string | null
  notes: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface AiNotes {
  id: string
  kind: Generated<string>
  interactionId: string | null
  documentId: string | null
  subjectType: string | null
  subjectId: string | null
  title: string | null
  content: string
  contentFormat: Generated<string>
  model: string | null
  promptFingerprint: string | null
  sourceId: string | null
  metadataJson: string | null
  generatedAt: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface AssetLinks {
  id: string
  assetId: string
  recordType: string
  recordId: string
  role: string | null
  caption: string | null
  sortOrder: number | null
  createdAt: Generated<string>
}

export interface AssetSearch {
  assetId: string
  title: string
  subtitle: string | null
  metadataText: string | null
  linkText: string | null
  bodyText: string | null
  updatedAt: Generated<string>
}

export interface AssetSearchSource {
  assetId: SelectOnly<string | null>
  title: SelectOnly<number | null>
  subtitle: SelectOnly<number | null>
  metadataText: SelectOnly<number | null>
  linkText: SelectOnly<number | null>
  bodyText: SelectOnly<string | null>
  updatedAt: SelectOnly<string | null>
}

export interface AssetTexts {
  assetId: string
  text: string
  textSource: Generated<string>
  contentHash: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface Assets {
  id: string
  kind: Generated<string>
  mimeType: string | null
  byteSize: number
  contentHash: string
  storagePath: string
  originalFilename: string | null
  originalPath: string | null
  originalUrl: string | null
  width: number | null
  height: number | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface ChatConversations {
  id: string
  title: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface ChatMessages {
  id: string
  conversationId: string
  role: string
  contentText: Generated<string>
  uiMessageJson: string
  model: string | null
  status: Generated<string>
  error: string | null
  createdAt: Generated<string>
}

export interface ChunkEmbeddings {
  id: number
  chunkId: string
  contentHash: string
  modelId: string
  createdAt: Generated<string>
}

export interface ContentChunks {
  id: string
  recordType: string
  recordId: string
  sourceRecordType: string | null
  sourceRecordId: string | null
  chunkIndex: number
  text: string
  tokenCount: number | null
  contentHash: string | null
  citationLabel: string | null
  createdAt: Generated<string>
}

export interface DocumentInteractions {
  id: string
  documentId: string
  interactionId: string
  role: string | null
  createdAt: Generated<string>
}

export interface DocumentOrganizations {
  id: string
  documentId: string
  organizationId: string
  role: string | null
  createdAt: Generated<string>
}

export interface DocumentPeople {
  id: string
  documentId: string
  personId: string
  role: string | null
  createdAt: Generated<string>
}

export interface Documents {
  id: string
  kind: string | null
  title: string | null
  bodyText: string | null
  summary: string | null
  mimeType: string | null
  originalPath: string | null
  originalUrl: string | null
  contentHash: string | null
  authoredAt: string | null
  occurredAt: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface EvidenceRefs {
  id: string
  subjectType: string
  subjectId: string
  chunkId: string
  quoteStart: number | null
  quoteEnd: number | null
  note: string | null
  createdAt: Generated<string>
}

export interface ExternalIdentities {
  id: string
  entityType: string
  entityId: string
  sourceId: string
  kind: Generated<string>
  externalId: string
  url: string | null
  metadataJson: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface ExtractedFacts {
  id: string
  subjectType: string
  subjectId: string
  key: string
  valueText: string | null
  valueJson: string | null
  confidence: number | null
  sourceRecordType: string | null
  sourceRecordId: string | null
  sourceExcerpt: string | null
  observedAt: string | null
  model: string | null
  promptFingerprint: string | null
  metadataJson: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface InteractionEventBookings {
  interactionId: string
  bookingType: string | null
  confirmationReference: string | null
  bookingChannel: string | null
  providerName: string | null
  partyCount: number | null
  guestCount: number | null
  contactJson: string | null
  costJson: string | null
  cancellationPolicyJson: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface InteractionEventDetails {
  interactionId: string
  subtype: Generated<string>
  status: string | null
  startLocalAt: string | null
  startTimezone: string | null
  endLocalAt: string | null
  endTimezone: string | null
  isAllDay: Generated<number>
  venueName: string | null
  address: string | null
  providerName: string | null
  providerRecordKind: string | null
  sourceCompleteness: string | null
  needsReviewReason: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface InteractionEventFlightSegments {
  interactionId: string
  segmentIndex: number
  carrierName: string | null
  carrierCode: string | null
  flightNumber: string | null
  serviceClass: string | null
  originCode: string | null
  originName: string | null
  originTimezone: string | null
  destinationCode: string | null
  destinationName: string | null
  destinationTimezone: string | null
  departureLocalAt: string | null
  arrivalLocalAt: string | null
  departureAt: string | null
  arrivalAt: string | null
  durationMinutes: number | null
  confirmationReference: string | null
  ticketNumbersJson: string | null
  passengersJson: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface InteractionEventLodgingStays {
  interactionId: string
  propertyName: string | null
  checkInLocalAt: string | null
  checkOutLocalAt: string | null
  nights: number | null
  roomCount: number | null
  roomsJson: string | null
  guestsJson: string | null
  benefitsJson: string | null
  policiesJson: string | null
  arrivalNotes: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface InteractionOrganizations {
  id: string
  interactionId: string
  organizationId: string
  role: string | null
  createdAt: Generated<string>
}

export interface InteractionParticipants {
  id: string
  interactionId: string
  personId: string | null
  role: string | null
  handle: string | null
  normalizedHandle: string | null
  displayName: string | null
  sourceId: string | null
  createdAt: Generated<string>
}

export interface InteractionTranscripts {
  id: string
  interactionId: string
  rawText: string
  format: Generated<string>
  language: string | null
  segmentsJson: string | null
  recordingUrl: string | null
  storagePath: string | null
  sourceId: string | null
  sourceExternalId: string | null
  transcribedBy: string | null
  transcribedAt: string | null
  contentHash: string | null
  metadataJson: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface Interactions {
  id: string
  kind: Generated<string>
  title: string | null
  bodyText: string | null
  summary: string | null
  occurredAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  location: string | null
  externalId: string | null
  originalPath: string | null
  originalUrl: string | null
  contentHash: string | null
  metadataJson: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface Memories {
  id: string
  kind: Generated<string>
  claim: string
  confidence: number | null
  validFrom: string | null
  validTo: string | null
  promotedFromFactId: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface MemoryLinks {
  id: string
  memoryId: string
  recordType: string
  recordId: string
  role: string | null
  createdAt: Generated<string>
}

export interface OrganizationProfiles {
  id: string
  organizationId: string
  model: string | null
  promptFingerprint: string | null
  canonicalName: string | null
  website: string | null
  oneLineDescription: string | null
  category: string | null
  whyItMatters: string | null
  offeringsJson: string | null
  notablePeopleJson: string | null
  suggestedTagsJson: string | null
  reviewFlagsJson: string | null
  sourceUrlsJson: string | null
  rawEnrichmentJson: string | null
  researchedAt: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface Organizations {
  id: string
  name: string
  kind: string | null
  domain: string | null
  headline: string | null
  summary: string | null
  website: string | null
  industry: string | null
  location: string | null
  hqCity: string | null
  hqRegion: string | null
  hqCountry: string | null
  notes: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface People {
  id: string
  fullName: string
  preferredName: string | null
  headline: string | null
  summary: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  location: string | null
  city: string | null
  region: string | null
  country: string | null
  timezone: string | null
  linkedinUrl: string | null
  website: string | null
  importantDatesJson: string | null
  notes: string | null
  isSelf: Generated<number>
  currentTitle: string | null
  currentDepartment: string | null
  currentOrganizationId: string | null
  roleFamily: string | null
  seniority: string | null
  lastInteractionAt: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface PersonEmails {
  id: string
  personId: string
  email: string
  normalizedEmail: string
  label: string | null
  isPrimary: Generated<number>
  sourceId: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface PersonPhones {
  id: string
  personId: string
  phone: string
  normalizedPhone: string
  label: string | null
  isPrimary: Generated<number>
  sourceId: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface ProjectDocuments {
  id: string
  projectId: string
  documentId: string
  role: string | null
  createdAt: Generated<string>
}

export interface ProjectInteractions {
  id: string
  projectId: string
  interactionId: string
  role: string | null
  createdAt: Generated<string>
}

export interface ProjectOrganizations {
  id: string
  projectId: string
  organizationId: string
  role: string | null
  createdAt: Generated<string>
}

export interface ProjectPeople {
  id: string
  projectId: string
  personId: string
  role: string | null
  createdAt: Generated<string>
}

export interface Projects {
  id: string
  name: string
  status: Generated<string>
  kind: string | null
  summary: string | null
  notes: string | null
  startedOn: string | null
  targetDate: string | null
  completedOn: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface RecordProvenance {
  id: string
  recordType: string
  recordId: string
  provenanceKind: Generated<string>
  sourceId: string | null
  externalIdentityId: string | null
  originalPath: string | null
  originalUrl: string | null
  importedAt: string | null
  model: string | null
  promptFingerprint: string | null
  metadataJson: string | null
  createdAt: Generated<string>
}

export interface RelationshipStrengths {
  personId: SelectOnly<string | null>
  lastInteractionAt: SelectOnly<string | null>
  relationshipStrength: SelectOnly<number | null>
  recentInteractions: SelectOnly<number | null>
  daysSinceLast: SelectOnly<number | null>
  openTasks: SelectOnly<number | null>
}

export interface SchemaMeta {
  key: string
  value: string
  updatedAt: Generated<string>
}

export interface Settings {
  key: string
  valueJson: string
  updatedAt: Generated<string>
}

export interface Sources {
  id: string
  slug: string
  name: string
  description: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface SuggestionLinks {
  id: string
  suggestionId: string
  recordType: string
  recordId: string
  role: string | null
  createdAt: Generated<string>
}

export interface Suggestions {
  id: string
  kind: string
  title: string
  payloadJson: string | null
  rationale: string | null
  status: Generated<string>
  resolvedRecordType: string | null
  resolvedRecordId: string | null
  createdAt: Generated<string>
  resolvedAt: string | null
}

export interface Taggings {
  id: string
  tagId: string
  recordType: string
  recordId: string
  sourceId: string | null
  createdAt: Generated<string>
}

export interface Tags {
  id: string
  name: string
  slug: string | null
  color: string | null
  description: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
}

export interface TaskDocuments {
  id: string
  taskId: string
  documentId: string
  role: string | null
  createdAt: Generated<string>
}

export interface TaskInteractions {
  id: string
  taskId: string
  interactionId: string
  role: string | null
  createdAt: Generated<string>
}

export interface TaskOrganizations {
  id: string
  taskId: string
  organizationId: string
  role: string | null
  createdAt: Generated<string>
}

export interface TaskPeople {
  id: string
  taskId: string
  personId: string
  role: string | null
  createdAt: Generated<string>
}

export interface Tasks {
  id: string
  title: string
  description: string | null
  status: Generated<string>
  priority: number | null
  projectId: string | null
  dueAt: string | null
  scheduledFor: string | null
  completedAt: string | null
  originDocumentId: string | null
  originInteractionId: string | null
  sourceRecordType: string | null
  sourceRecordId: string | null
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface Database {
  affiliations: Affiliations
  aiNotes: AiNotes
  assetLinks: AssetLinks
  assetSearch: AssetSearch
  assetSearchSource: AssetSearchSource
  assetTexts: AssetTexts
  assets: Assets
  chatConversations: ChatConversations
  chatMessages: ChatMessages
  chunkEmbeddings: ChunkEmbeddings
  contentChunks: ContentChunks
  documentInteractions: DocumentInteractions
  documentOrganizations: DocumentOrganizations
  documentPeople: DocumentPeople
  documents: Documents
  evidenceRefs: EvidenceRefs
  externalIdentities: ExternalIdentities
  extractedFacts: ExtractedFacts
  interactionEventBookings: InteractionEventBookings
  interactionEventDetails: InteractionEventDetails
  interactionEventFlightSegments: InteractionEventFlightSegments
  interactionEventLodgingStays: InteractionEventLodgingStays
  interactionOrganizations: InteractionOrganizations
  interactionParticipants: InteractionParticipants
  interactionTranscripts: InteractionTranscripts
  interactions: Interactions
  memories: Memories
  memoryLinks: MemoryLinks
  organizationProfiles: OrganizationProfiles
  organizations: Organizations
  people: People
  personEmails: PersonEmails
  personPhones: PersonPhones
  projectDocuments: ProjectDocuments
  projectInteractions: ProjectInteractions
  projectOrganizations: ProjectOrganizations
  projectPeople: ProjectPeople
  projects: Projects
  recordProvenance: RecordProvenance
  relationshipStrengths: RelationshipStrengths
  schemaMeta: SchemaMeta
  settings: Settings
  sources: Sources
  suggestionLinks: SuggestionLinks
  suggestions: Suggestions
  taggings: Taggings
  tags: Tags
  taskDocuments: TaskDocuments
  taskInteractions: TaskInteractions
  taskOrganizations: TaskOrganizations
  taskPeople: TaskPeople
  tasks: Tasks
}
