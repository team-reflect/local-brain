export { type AppError, type AppErrorKind, isAppError, toAppError } from './errors'
export { type IpcBridge, setBridge, getBridge } from './ipc/bridge'
export { call } from './ipc/invoke'
export { appVersion, type AppInfo } from './ipc/commands'

// Database access layer
export { db } from './db/client'
export { execute, batch, type DbStatement } from './db/commands'
export { newId } from './db/id'
export { nowIso } from './db/time'

// People
export { listPeople, getPerson, getSelf, type Person, type ListPeopleOptions } from './domains/people/getters'
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
  createProject,
  updateProject,
  completeProject,
  archiveProject,
  type NewProject,
  type ProjectPatch,
} from './domains/projects/setters'

// Tasks
export { listTasks, getTask, type Task, type ListTasksOptions } from './domains/tasks/getters'
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
  type Interaction,
  type InteractionParticipant,
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

// Organizations
export {
  listOrganizations,
  getOrganization,
  type Organization,
  type ListOrganizationsOptions,
} from './domains/organizations/getters'
export {
  createOrganization,
  updateOrganization,
  archiveOrganization,
  type NewOrganization,
  type OrganizationPatch,
} from './domains/organizations/setters'

// Memories
export {
  listMemories,
  getMemory,
  listMemoriesForRecord,
  type Memory,
  type ListMemoriesOptions,
} from './domains/memories/getters'

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

// Citations / evidence
export {
  listCitationsForSubject,
  listEvidenceFromDocument,
  type Citation,
  type CitingRecord,
} from './domains/citations/getters'

// Chat (Ask)
export {
  listConversations,
  getConversation,
  listMessages,
  type ChatConversation,
  type ChatMessage,
} from './domains/chat/getters'
export {
  createConversation,
  addMessage,
  archiveConversation,
  type NewChatMessage,
} from './domains/chat/setters'

// Quick search (command palette)
export { quickSearch } from './search/getters'

// Knowledge graph
export {
  getGraph,
  type Graph,
  type GraphNode,
  type GraphEdge,
  type GraphNodeKind,
} from './graph/getters'

// Seed / demo data
export { seedDemoData, type SeedResult } from './seed/seed'
