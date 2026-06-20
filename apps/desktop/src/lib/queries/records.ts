import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveTask,
  completeTask,
  createProject,
  getAssetDetail,
  getDocument,
  getDocumentLinks,
  getGraph,
  getInteraction,
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
  listAllTaskAssignees,
  listInteractionParticipants,
  listInteractions,
  listOrganizations,
  listPeople,
  listProjects,
  listTasks,
  updateTask,
  type ListTasksOptions,
  type NewProject,
  type TaskPatch,
} from '@local-brain/core'

/**
 * Read hooks for the typed records and their linked-record neighborhoods, plus
 * the two task mutations. Components read data through these, never the bridge or
 * SQL directly.
 */

export function useSelf() {
  return useQuery({ queryKey: ['self'], queryFn: () => getSelf().then((p) => p ?? null) })
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => listPeople() })
}

export function usePerson(id: string) {
  return useQuery({ queryKey: ['person', id], queryFn: () => getPerson(id).then((p) => p ?? null) })
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useArchiveTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => archiveTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
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
