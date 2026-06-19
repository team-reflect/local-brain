import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveTask,
  completeTask,
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
  listInteractionParticipants,
  listInteractions,
  listOrganizations,
  listPeople,
  listProjects,
  listTasks,
  type ListTasksOptions,
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

export function useProject(id: string) {
  return useQuery({ queryKey: ['project', id], queryFn: () => getProject(id).then((p) => p ?? null) })
}

export function useTasks(options: ListTasksOptions = {}) {
  return useQuery({ queryKey: ['tasks', options], queryFn: () => listTasks(options) })
}

export function useTask(id: string) {
  return useQuery({ queryKey: ['task', id], queryFn: () => getTask(id).then((t) => t ?? null) })
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
