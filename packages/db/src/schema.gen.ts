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
  role: string | null
  startedOn: string | null
  endedOn: string | null
  isCurrent: Generated<number>
  notes: string | null
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
  content: string
  model: string | null
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
  chunkIndex: number
  text: string
  tokenCount: number | null
  contentHash: string | null
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

export interface DocumentProjects {
  id: string
  documentId: string
  projectId: string
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

export interface InteractionProjects {
  id: string
  interactionId: string
  projectId: string
  role: string | null
  createdAt: Generated<string>
}

export interface Interactions {
  id: string
  kind: Generated<string>
  title: string | null
  bodyText: string | null
  summary: string | null
  occurredAt: string | null
  endedAt: string | null
  location: string | null
  externalId: string | null
  originalPath: string | null
  originalUrl: string | null
  contentHash: string | null
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

export interface Organizations {
  id: string
  name: string
  kind: string | null
  domain: string | null
  location: string | null
  summary: string | null
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
  primaryEmail: string | null
  primaryPhone: string | null
  location: string | null
  isSelf: Generated<number>
  reconnectIntervalDays: number | null
  lastInteractionAt: string | null
  nextReconnectAt: string | null
  importantDatesJson: string | null
  summary: string | null
  notes: string | null
  currentOrganizationId: string | null
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

export interface ProjectTasks {
  id: string
  projectId: string
  taskId: string
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

export interface RelationshipStrengths {
  personId: SelectOnly<string | null>
  lastInteractionAt: SelectOnly<string | null>
  nextReconnectAt: SelectOnly<string | null>
  relationshipStrength: SelectOnly<number | null>
  recentInteractions: SelectOnly<number | null>
  daysSinceLast: SelectOnly<number | null>
  openTasks: SelectOnly<number | null>
}

export interface SchemaMeta {
  key: string
  value: string
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

export interface Taggings {
  id: string
  tagId: string
  recordType: string
  recordId: string
  createdAt: Generated<string>
}

export interface Tags {
  id: string
  name: string
  color: string | null
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
  createdAt: Generated<string>
  updatedAt: Generated<string>
  archivedAt: string | null
}

export interface Database {
  affiliations: Affiliations
  assetLinks: AssetLinks
  assets: Assets
  chatConversations: ChatConversations
  chatMessages: ChatMessages
  chunkEmbeddings: ChunkEmbeddings
  contentChunks: ContentChunks
  documentInteractions: DocumentInteractions
  documentOrganizations: DocumentOrganizations
  documentPeople: DocumentPeople
  documentProjects: DocumentProjects
  documents: Documents
  evidenceRefs: EvidenceRefs
  externalIdentities: ExternalIdentities
  interactionOrganizations: InteractionOrganizations
  interactionParticipants: InteractionParticipants
  interactionProjects: InteractionProjects
  interactions: Interactions
  memories: Memories
  memoryLinks: MemoryLinks
  organizations: Organizations
  people: People
  personEmails: PersonEmails
  personPhones: PersonPhones
  projectDocuments: ProjectDocuments
  projectInteractions: ProjectInteractions
  projectOrganizations: ProjectOrganizations
  projectPeople: ProjectPeople
  projectTasks: ProjectTasks
  projects: Projects
  relationshipStrengths: RelationshipStrengths
  schemaMeta: SchemaMeta
  settings: Settings
  sources: Sources
  taggings: Taggings
  tags: Tags
  taskDocuments: TaskDocuments
  taskInteractions: TaskInteractions
  taskOrganizations: TaskOrganizations
  taskPeople: TaskPeople
  tasks: Tasks
}
