import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import {
  archiveTask,
  completeTask,
  createProject,
  createTask,
  getAssetDetail,
  getDocument,
  getDocumentLinks,
  getGraph,
  getInteraction,
  getInteractionEventDetail,
  getInteractionLinks,
  getOrganization,
  getOrganizationLinks,
  getPerson,
  getPersonLinks,
  getProject,
  getProjectLinks,
  getSelf,
  getTask,
  getTaskLinks,
  listExternalIdentitySummariesForRecord,
  listAllTaskAssignees,
  listInteractionParticipants,
  listInteractions,
  listOrganizationProfiles,
  listOrganizations,
  listPeople,
  listPersonAffiliations,
  listPersonEmails,
  listPersonPhones,
  listRecordProvenanceForRecord,
  listProjects,
  listTasks,
  setTaskCompleted,
  updateTask,
  type LinkedTask,
  type ListTasksOptions,
  type NewProject,
  type NewTask,
  type SearchHit,
  type Task,
  type TaskPatch,
} from '@local-brain/core'
import { PALETTE_SEARCH_QUERY_KEY } from './search'

/**
 * Read hooks for the typed records and their linked-record neighborhoods, plus
 * the two task mutations. Components read data through these, never the bridge or
 * SQL directly.
 */

/** Input accepted by the reversible task-completion mutation. */
export interface SetTaskCompletedInput {
  id: string
  completed: boolean
}

interface SetTaskCompletedCallbacks {
  onError?: (error: Error, input: SetTaskCompletedInput) => void
}

interface QuerySnapshot {
  queryKey: QueryKey
  data: unknown
}

interface TaskLinkedNeighborhood {
  tasks: LinkedTask[]
}

const TASK_LINK_OWNER_KEYS = new Set(['person', 'organization', 'project', 'document', 'interaction'])

function isTaskLinkedNeighborhoodKey(queryKey: QueryKey): boolean {
  return queryKey.length === 3 && queryKey[2] === 'links' && TASK_LINK_OWNER_KEYS.has(String(queryKey[0]))
}

function completionStatus(completed: boolean): 'done' | 'open' {
  return completed ? 'done' : 'open'
}

function optimisticTask(task: Task, input: SetTaskCompletedInput, changedAt: string): Task {
  return {
    ...task,
    status: completionStatus(input.completed),
    completedAt: input.completed ? changedAt : null,
    updatedAt: changedAt,
  }
}

function optimisticTaskList(
  tasks: Task[],
  queryKey: QueryKey,
  input: SetTaskCompletedInput,
  changedAt: string,
): Task[] {
  const options = queryKey[1]
  const filteredStatus =
    typeof options === 'object' && options !== null && 'status' in options
      ? (options as ListTasksOptions).status
      : undefined
  const nextStatus = completionStatus(input.completed)

  return tasks.flatMap((task) => {
    if (task.id !== input.id) return [task]
    if (filteredStatus !== undefined && filteredStatus !== nextStatus) return []
    return [optimisticTask(task, input, changedAt)]
  })
}

function optimisticLinkedNeighborhood(
  value: TaskLinkedNeighborhood,
  input: SetTaskCompletedInput,
): TaskLinkedNeighborhood {
  const status = completionStatus(input.completed)
  return {
    ...value,
    tasks: value.tasks.map((task) =>
      task.id === input.id ? { ...task, status, subtitle: status } : task,
    ),
  }
}

function optimisticSearchResults(results: SearchHit[], input: SetTaskCompletedInput): SearchHit[] {
  const status = completionStatus(input.completed)
  return results.map((hit) =>
    hit.kind === 'task' && hit.id === input.id ? { ...hit, subtitle: status } : hit,
  )
}

function completionSnapshots(queryClient: QueryClient, id: string): QuerySnapshot[] {
  const entries = [
    ...queryClient.getQueriesData({ queryKey: ['tasks'] }),
    ...queryClient.getQueriesData({ queryKey: ['task', id], exact: true }),
    ...queryClient.getQueriesData({
      predicate: (query) => isTaskLinkedNeighborhoodKey(query.queryKey),
    }),
    ...queryClient.getQueriesData({ queryKey: PALETTE_SEARCH_QUERY_KEY }),
  ]
  return entries.map(([queryKey, data]) => ({ queryKey, data }))
}

async function cancelTaskViews(queryClient: QueryClient, id: string): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ['tasks'] }),
    queryClient.cancelQueries({ queryKey: ['task', id], exact: true }),
    queryClient.cancelQueries({
      predicate: (query) => isTaskLinkedNeighborhoodKey(query.queryKey),
    }),
    queryClient.cancelQueries({ queryKey: PALETTE_SEARCH_QUERY_KEY }),
  ])
}

async function invalidateTaskViews(queryClient: QueryClient, id?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    ...(id ? [queryClient.invalidateQueries({ queryKey: ['task', id] })] : []),
    queryClient.invalidateQueries({
      predicate: (query) => isTaskLinkedNeighborhoodKey(query.queryKey),
    }),
    queryClient.invalidateQueries({ queryKey: ['graph'] }),
    queryClient.invalidateQueries({ queryKey: PALETTE_SEARCH_QUERY_KEY }),
  ])
}

function applyOptimisticCompletion(
  queryClient: QueryClient,
  snapshots: QuerySnapshot[],
  input: SetTaskCompletedInput,
): void {
  const changedAt = new Date().toISOString()
  for (const snapshot of snapshots) {
    const [scope, keyId] = snapshot.queryKey
    if (scope === 'tasks' && Array.isArray(snapshot.data)) {
      queryClient.setQueryData(
        snapshot.queryKey,
        optimisticTaskList(snapshot.data as Task[], snapshot.queryKey, input, changedAt),
      )
    } else if (scope === 'task' && keyId === input.id && snapshot.data) {
      queryClient.setQueryData(
        snapshot.queryKey,
        optimisticTask(snapshot.data as Task, input, changedAt),
      )
    } else if (isTaskLinkedNeighborhoodKey(snapshot.queryKey) && snapshot.data) {
      queryClient.setQueryData(
        snapshot.queryKey,
        optimisticLinkedNeighborhood(snapshot.data as TaskLinkedNeighborhood, input),
      )
    } else if (scope === PALETTE_SEARCH_QUERY_KEY[0] && Array.isArray(snapshot.data)) {
      queryClient.setQueryData(
        snapshot.queryKey,
        optimisticSearchResults(snapshot.data as SearchHit[], input),
      )
    }
  }
}

export function useSelf() {
  return useQuery({ queryKey: ['self'], queryFn: () => getSelf().then((p) => p ?? null) })
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => listPeople() })
}

export function usePerson(id: string) {
  return useQuery({ queryKey: ['person', id], queryFn: () => getPerson(id).then((p) => p ?? null) })
}

export function usePersonEmails(id: string) {
  return useQuery({ queryKey: ['person', id, 'emails'], queryFn: () => listPersonEmails(id) })
}

export function usePersonPhones(id: string) {
  return useQuery({ queryKey: ['person', id, 'phones'], queryFn: () => listPersonPhones(id) })
}

export function usePersonAffiliations(id: string) {
  return useQuery({
    queryKey: ['person', id, 'affiliations'],
    queryFn: () => listPersonAffiliations(id),
  })
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => listProjects() })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NewProject) => createProject(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['graph'] }),
      ])
    },
  })
}

/** Create a task and refresh every task-discovery surface after it commits. */
export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NewTask) => createTask(input),
    onSuccess: async (_id, input) => {
      await Promise.all([
        invalidateTaskViews(queryClient),
        ...(input.projectId
          ? [queryClient.invalidateQueries({ queryKey: ['project', input.projectId, 'links'] })]
          : []),
      ])
    },
  })
}

export function useProject(id: string) {
  return useQuery({ queryKey: ['project', id], queryFn: () => getProject(id).then((p) => p ?? null) })
}

export function useTasks(options: ListTasksOptions = {}) {
  return useQuery({ queryKey: ['tasks', options], queryFn: () => listTasks(options) })
}

export function useTask(id: string) {
  return useQuery({ queryKey: ['task', id], queryFn: () => getTask(id).then((t) => t ?? null) })
}

export function useUpdateTask(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: TaskPatch) => updateTask(id, patch),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['task', id] }),
        queryClient.invalidateQueries({ queryKey: ['task', id, 'links'] }),
        queryClient.invalidateQueries({ queryKey: ['task-assignees'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project'] }),
        queryClient.invalidateQueries({ queryKey: ['graph'] }),
      ])
    },
  })
}

export function useInteractions(limit?: number) {
  return useQuery({
    queryKey: ['interactions', limit ?? null],
    queryFn: () => listInteractions(limit !== undefined ? { limit } : {}),
  })
}

export function useInteraction(id: string) {
  return useQuery({
    queryKey: ['interaction', id],
    queryFn: () => getInteraction(id).then((i) => i ?? null),
  })
}

export function useInteractionParticipants(id: string) {
  return useQuery({
    queryKey: ['interaction', id, 'participants'],
    queryFn: () => listInteractionParticipants(id),
  })
}

export function useInteractionEventDetail(id: string) {
  return useQuery({
    queryKey: ['interaction', id, 'event-detail'],
    queryFn: () => getInteractionEventDetail(id).then((eventDetail) => eventDetail ?? null),
  })
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => getDocument(id).then((d) => d ?? null),
  })
}

export function useAssetDetail(id: string) {
  return useQuery({
    queryKey: ['asset', id],
    queryFn: () => getAssetDetail(id).then((asset) => asset ?? null),
  })
}

export function useCompleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => completeTask(id),
    onSuccess: (_count, id) => invalidateTaskViews(queryClient, id),
  })
}

/**
 * Reversibly complete or reopen a task with immediate cache feedback.
 * Failed writes restore every optimistically changed cache before refetching.
 */
export function useSetTaskCompleted(callbacks: SetTaskCompletedCallbacks = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, completed }: SetTaskCompletedInput) => setTaskCompleted(id, completed),
    onMutate: async (input) => {
      await cancelTaskViews(queryClient, input.id)
      const snapshots = completionSnapshots(queryClient, input.id)
      applyOptimisticCompletion(queryClient, snapshots, input)
      return { snapshots }
    },
    onError: (error, input, context) => {
      for (const snapshot of context?.snapshots ?? []) {
        queryClient.setQueryData(snapshot.queryKey, snapshot.data)
      }
      callbacks.onError?.(error, input)
    },
    onSettled: async (_data, _error, input) => {
      await invalidateTaskViews(queryClient, input.id)
    },
  })
}

export function useArchiveTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => archiveTask(id),
    onSuccess: (_count, id) => invalidateTaskViews(queryClient, id),
  })
}

/** All task assignees across all tasks. Returns a Map<taskId, {id, name}[]> when loaded. */
export function useAllTaskAssignees() {
  return useQuery({
    queryKey: ['task-assignees'],
    queryFn: () => listAllTaskAssignees(),
    select: (rows) => {
      const map = new Map<string, { taskId: string; personId: string; personName: string }[]>()
      for (const row of rows) {
        const list = map.get(row.taskId) ?? []
        list.push(row)
        map.set(row.taskId, list)
      }
      return map
    },
  })
}

export function useOrganizations() {
  return useQuery({ queryKey: ['organizations'], queryFn: () => listOrganizations() })
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: ['organization', id],
    queryFn: () => getOrganization(id).then((o) => o ?? null),
  })
}

export function useOrganizationProfiles(id: string) {
  return useQuery({
    queryKey: ['organization', id, 'profiles'],
    queryFn: () => listOrganizationProfiles(id),
  })
}

export function useExternalIdentities(recordType: string, recordId: string) {
  return useQuery({
    queryKey: [recordType, recordId, 'external-identities'],
    queryFn: () => listExternalIdentitySummariesForRecord(recordType, recordId),
  })
}

export function useRecordProvenance(recordType: string, recordId: string) {
  return useQuery({
    queryKey: [recordType, recordId, 'provenance'],
    queryFn: () => listRecordProvenanceForRecord(recordType, recordId),
  })
}

// Linked-record neighborhoods
export function usePersonLinks(id: string) {
  return useQuery({ queryKey: ['person', id, 'links'], queryFn: () => getPersonLinks(id) })
}

export function useOrganizationLinks(id: string) {
  return useQuery({ queryKey: ['organization', id, 'links'], queryFn: () => getOrganizationLinks(id) })
}

export function useProjectLinks(id: string) {
  return useQuery({ queryKey: ['project', id, 'links'], queryFn: () => getProjectLinks(id) })
}

export function useTaskLinks(id: string) {
  return useQuery({ queryKey: ['task', id, 'links'], queryFn: () => getTaskLinks(id) })
}

export function useDocumentLinks(id: string) {
  return useQuery({ queryKey: ['document', id, 'links'], queryFn: () => getDocumentLinks(id) })
}

export function useInteractionLinks(id: string) {
  return useQuery({ queryKey: ['interaction', id, 'links'], queryFn: () => getInteractionLinks(id) })
}

// Graph
export function useGraph() {
  return useQuery({ queryKey: ['graph'], queryFn: getGraph })
}
