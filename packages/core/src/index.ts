/* eslint-disable max-lines -- the public API barrel; grows one block per domain */
export { type AppError, type AppErrorKind, isAppError, toAppError } from './errors'
export { ValidationError, requireText } from './validation'
// Field normalization shared by the write boundary, extraction matching, and the
// CLI's Rust twin.
export {
  normalizeName,
  normalizeEmail,
  normalizeDomain,
  squish,
  trimToNull,
} from './text/normalize'
export { type IpcBridge, setBridge, getBridge } from './ipc/bridge'
export { call } from './ipc/invoke'
export { appVersion, type AppInfo } from './ipc/commands'
export {
  cliInstall,
  cliStatus,
  cliUninstall,
  type CliInstallState,
  type CliStatus,
} from './ipc/cli'
export {
  skillInstall,
  skillStatus,
  skillUninstall,
  type SkillInstallState,
  type SkillStatus,
} from './ipc/skill'
export {
  readTextFile,
  readTextFolder,
  type FileImport,
  type FolderScan,
  type SkippedFile,
} from './ipc/fs'

// Database access layer
export { db } from './db/client'
export { execute, executeRaw, batch, type DbStatement } from './db/commands'
export { newId } from './db/id'
export { nowIso, localDateString } from './db/time'

// People
export {
  listPeople,
  getPerson,
  getSelf,
  listPersonAffiliations,
  listPersonEmails,
  listPersonPhones,
  type Person,
  type PersonAffiliation,
  type PersonEmail,
  type PersonPhone,
  type ListPeopleOptions,
} from './domains/people/getters'
export {
  createPerson,
  updatePerson,
  archivePerson,
  type NewPerson,
  type PersonPatch,
} from './domains/people/setters'

// Projects
export {
  listProjects,
  getProject,
  type Project,
  type ListProjectsOptions,
} from './domains/projects/getters'
export {
  getProjectIntelligence,
  type ProjectAiNote,
  type ProjectExtractedFact,
  type ProjectIntelligence,
  type ProjectMemory,
  type ProjectTag,
} from './domains/projects/intelligence'
export {
  createProject,
  updateProject,
  completeProject,
  archiveProject,
  type NewProject,
  type ProjectPatch,
} from './domains/projects/setters'
export {
  listOpenSuggestions,
  type CurationSuggestion,
  type SuggestionLink,
  type SuggestionPayload,
} from './domains/suggestions/getters'
export {
  acceptSuggestion,
  dismissSuggestion,
  type AcceptedSuggestion,
} from './domains/suggestions/setters'

// Tasks
export {
  listTasks,
  getTask,
  listTaskAssignees,
  listAllTaskAssignees,
  TASK_PERSON_ROLE_ASSIGNEE,
  type Task,
  type ListTasksOptions,
  type TaskAssignee,
} from './domains/tasks/getters'
export {
  createTask,
  updateTask,
  completeTask,
  archiveTask,
  type NewTask,
  type TaskPatch,
} from './domains/tasks/setters'

// Documents
export {
  listDocuments,
  getDocument,
  type Document,
  type ListDocumentsOptions,
} from './domains/documents/getters'
export {
  createDocument,
  updateDocument,
  archiveDocument,
  type NewDocument,
  type DocumentPatch,
} from './domains/documents/setters'

// Interactions
export {
  listInteractions,
  getInteraction,
  listInteractionParticipants,
  listInteractionParticipantRows,
  type Interaction,
  type InteractionParticipant,
  type InteractionParticipantRow,
  type ListInteractionsOptions,
} from './domains/interactions/getters'
export {
  createInteraction,
  updateInteraction,
  archiveInteraction,
  type NewInteraction,
  type InteractionPatch,
  type InteractionParticipantInput,
} from './domains/interactions/setters'

// Assets
export {
  getAsset,
  getAssetDetail,
  listAssetLinkedRecords,
  type Asset,
  type AssetText,
  type AssetDetail,
} from './domains/assets/getters'

// Organizations
export {
  listOrganizations,
  getOrganization,
  listOrganizationProfiles,
  type Organization,
  type OrganizationProfile,
  type ListOrganizationsOptions,
} from './domains/organizations/getters'
export {
  createOrganization,
  updateOrganization,
  archiveOrganization,
  type NewOrganization,
  type OrganizationPatch,
} from './domains/organizations/setters'

// Import sources and external identities
export {
  listSources,
  getSourceBySlug,
  listExternalIdentitiesForRecord,
  listExternalIdentitySummariesForRecord,
  listRecordProvenanceForRecord,
  getExternalIdentity,
  type Source,
  type ExternalIdentity,
  type ExternalIdentitySummary,
  type RecordProvenanceSummary,
} from './domains/sources/getters'

// Memories
export {
  listMemories,
  getMemory,
  listMemoriesForRecord,
  type Memory,
  type ListMemoriesOptions,
} from './domains/memories/getters'
export {
  updateMemory,
  archiveMemory,
  unlinkMemoryFromRecord,
  linkMemoryToRecord,
  type MemoryPatch,
} from './domains/memories/setters'

// Linked records (the typed join-table neighborhood of a record)
export { type LinkedRecord, type RecordKind } from './domains/relations/types'
export {
  getPersonLinks,
  getOrganizationLinks,
  getProjectLinks,
  getTaskLinks,
  getDocumentLinks,
  getInteractionLinks,
  type PersonLinks,
  type OrganizationLinks,
  type ProjectLinks,
  type TaskLinks,
  type DocumentLinks,
  type InteractionLinks,
} from './domains/relations/getters'
export { unlinkRecords, type LinkRef, type LinkableKind } from './domains/relations/setters'

// Citations / evidence
export {
  listCitationsForSubject,
  listEvidenceFromDocument,
  type Citation,
  type CitingRecord,
} from './domains/citations/getters'
export {
  updateEvidenceRef,
  removeEvidenceRef,
  type EvidencePatch,
} from './domains/citations/setters'

// Chat (Ask)
export {
  listConversations,
  getConversation,
  listMessages,
  type ChatConversation,
  type ChatMessage,
  type ChatRole,
  type ChatStatus,
} from './domains/chat/getters'
export {
  createChatId,
  createConversation,
  appendChatMessage,
  archiveConversation,
  type NewChatConversation,
  type NewChatMessage,
} from './domains/chat/setters'

// Relationship intelligence (derived recency and strength from interactions/tasks)
export {
  recomputeRelationshipIntelligence,
  recomputeAllRelationships,
  type RecomputeOptions,
} from './domains/relationships/recompute'
export {
  relationshipStrength,
  addDays,
  daysBetween,
  STRENGTH_WINDOW_DAYS,
  type RelationshipSignals,
} from './domains/relationships/strength'

// Quick search (command palette)
export { quickSearch } from './search/getters'

// Retrieval (the one shared FTS5 retrieve() contract + global search)
export {
  retrieve,
  globalSearch,
  toMatchQuery,
  toLikePattern,
  lexicalScore,
  recencyScore,
  combineScore,
  RECENCY_HALF_LIFE_DAYS,
  RETRIEVABLE_SOURCE_KINDS,
  type RetrievalMode,
  type RetrievalResult,
  type RetrievedChunk,
  type RetrieveOptions,
  type SourceRecordType as RetrievalSourceType,
  type SearchHit,
  type SearchOptions,
  type RankInputs,
} from './retrieval'

// Brains (the top-level workspace picker: registry + runtime switching)
export {
  activeBrain,
  createBrain,
  forgetBrain,
  listBrains,
  openBrain,
  renameBrain,
  revealBrain,
  setBrainColor,
  BRAIN_COLOR_IDS,
  DEFAULT_BRAIN_COLOR,
  brainColorSchema,
  brainInfoSchema,
  brainInfoListSchema,
  type BrainColor,
  type BrainInfo,
} from './domains/brains'

// Embeddings (local semantic search: sqlite-vec + fastembed, desktop runtime)
export {
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSIONS,
  embedStatusSchema,
  byteProgressSchema,
  isEmbedReady,
  embedStatus,
  embedEnsure,
  embedTexts,
  embedApply,
  embedDelete,
  embedClear,
  semanticHits,
  fuseRanked,
  KNN_CANDIDATES,
  MAX_COSINE_DISTANCE,
  RRF_K,
  backfillEmbeddings,
  clearEmbeddings,
  countPending,
  pruneOrphanEmbeddings,
  getEmbeddingsStatus,
  isEmbeddingsEnabled,
  setEmbeddingsEnabled,
  getBackfillError,
  setBackfillError,
  getLastBackfillAttemptDay,
  setLastBackfillAttemptDay,
  EMBEDDINGS_ENABLED_KEY,
  EMBEDDINGS_BACKFILL_ERROR_KEY,
  EMBEDDINGS_LAST_BACKFILL_ATTEMPT_DAY_KEY,
  type EmbedStatus,
  type ByteProgress,
  type EmbeddedChunkInput,
  type BackfillOptions,
  type BackfillProgress,
  type BackfillResult,
  type EmbeddingsStatus,
} from './embeddings'

// Settings (typed key/value store backing the model boundary and storage path)
export {
  getSetting,
  getSettingRaw,
  listSettings,
  setSetting,
  deleteSetting,
  type SettingEntry,
} from './domains/settings'
export {
  getModelSettings,
  setAiProvidersState,
  updateAiProvidersState,
  setModelProviderSetting,
  setModelModelSetting,
  MODEL_PROVIDER_KEY,
  MODEL_MODEL_KEY,
  MODEL_AI_PROVIDERS_KEY,
  MODEL_DEFAULT_AI_PROVIDER_KEY,
  aiProviderConfigSchema,
  aiProvidersSchema,
  defaultAiProviderIdSchema,
  type ModelSettings,
  type AiProviderConfig,
} from './domains/settings/model'

// Native storage path + keychain bindings (Plan 08)
export {
  databasePath,
  keychainSet,
  keychainGet,
  keychainHas,
  keychainDelete,
} from './ipc/storage'

// Destructive-operation maintenance (hard delete + derived-index rebuild)
export {
  hardDeleteRecord,
  rebuildSearchIndexes,
  type DeletableKind,
} from './domains/maintenance'

// AI: BYOK model boundary and model-backed extractor
export {
  setModelProvider,
  getModelProvider,
  getModelStatus,
  ModelUnavailableError,
  createModelExtractor,
  extractJsonObject,
  createAnthropicProvider,
  createOpenAiProvider,
  createGoogleProvider,
  createConfiguredProvider,
  buildAnthropicBody,
  readAnthropicText,
  buildOpenAiBody,
  buildGoogleBody,
  readGoogleText,
  AI_PROVIDERS,
  aiProvider,
  aiProviderIdSchema,
  aiModelLabel,
  modelContextWindow,
  DEFAULT_CONTEXT_WINDOW,
  apiKeyHint,
  aiKeySecretName,
  defaultAiProvider,
  withAiProviderAdded,
  withAiProviderRemoved,
  validateApiKey,
  KEY_HINT_LENGTH,
  type ModelProvider,
  type ModelRequest,
  type ModelMessage,
  type ModelCompletion,
  type ModelUsage,
  type ModelStatus,
  type AnthropicOptions,
  type OpenAiOptions,
  type GoogleOptions,
  type AiProviderId,
  type AiProviderInfo,
  type AiModelOption,
  type AiProvidersState,
  type ApiKeyValidation,
} from './ai'

// Agent report endpoints (daily brief, plan-day, changes, waiting items)
export {
  getDailyBrief,
  planDay,
  getWaitingItems,
  getChangesSince,
  OPEN_TASK_STATUSES,
  type DailyBrief,
  type DailyBriefOptions,
  type BriefTask,
  type BriefInteraction,
  type TaskBucket,
  type PlanDayOptions,
  type ChangedRecord,
} from './reports'
export {
  DAILY_BRIEF_NOTE_KIND,
  DAILY_BRIEF_SUBJECT_TYPE,
  latestDailyBriefNote,
  saveDailyBriefNote,
  type DailyBriefNote,
  type SaveDailyBriefNoteInput,
} from './reports/daily-brief-note'

// Ingestion (paste/import → document/interaction + chunks + links)
export { normalizeText, chunkText, type Chunk, type ChunkOptions } from './ingest/chunk'
export { contentHash } from './ingest/hash'
export {
  ingestDocument,
  ingestInteraction,
  type IngestResult,
  type IngestLinks,
  type IngestDocumentInput,
  type IngestInteractionInput,
} from './ingest/ingest'
export {
  markForExtraction,
  setExtractionHandler,
  type ExtractionHandler,
} from './ingest/extraction-queue'

// Extraction (model output contracts + deterministic merge/apply pipeline)
export {
  MEMORY_KINDS,
  parseExtractionResult,
  validateExtraction,
  extractionResultSchema,
  type MemoryKind,
  type ExtractionResult,
  type ExtractionResultInput,
  type ExtractedPerson,
  type ExtractedOrganization,
  type ExtractedAffiliation,
  type ExtractedProject,
  type ExtractedTask,
  type ExtractedMemory,
  type ExtractedEvidence,
  type MemorySubject,
} from './extraction/contracts'
export {
  matchPerson,
  matchOrganization,
  matchProject,
  type PersonCandidate,
  type OrganizationCandidate,
  type ProjectCandidate,
} from './extraction/match'
export {
  findDates,
  findEmails,
  selectChunks,
  buildExtractionContext,
  type ExtractionContext,
  type ContextChunk,
  type DateHint,
  type SourceRecordType,
} from './extraction/preprocess'
export {
  applyExtraction,
  type ApplyOptions,
  type ApplySource,
  type ApplySummary,
  type Suggestion,
} from './extraction/apply'
export {
  setExtractor,
  getExtractor,
  runExtraction,
  installExtractionPipeline,
  type Extractor,
} from './extraction/extractor'

// Knowledge graph
export {
  getGraph,
  type Graph,
  type GraphNode,
  type GraphEdge,
  type GraphNodeKind,
  type GraphEdgeKind,
} from './graph/getters'

// Seed / demo data
export { seedDemoData, type SeedResult } from './seed/seed'

// Chat AI: read-only tools and system prompt builder
export { buildChatTools, type ChatTools } from './ai/chat/tools'
export { buildChatSystemPrompt, type ChatSystemPromptInput } from './ai/chat/system-prompt'
