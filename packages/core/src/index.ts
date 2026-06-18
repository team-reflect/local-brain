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

// Seed / demo data
export { seedDemoData, type SeedResult } from './seed/seed'
