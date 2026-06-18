import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addMessage,
  archiveTask,
  completeTask,
  createConversation,
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
  ingestDocument,
  ingestInteraction,
  listCitationsForSubject,
  listConversations,
  listEvidenceFromDocument,
  listInteractionParticipants,
  listInteractions,
  listMemoriesForRecord,
  listMessages,
  listOrganizations,
  listPeople,
  listProjects,
  listTasks,
  quickSearch,
  seedDemoData,
  type IngestDocumentInput,
  type IngestInteractionInput,
  type ListTasksOptions,
  type NewChatMessage,
} from '@local-brain/core'

/**
 * TanStack Query hooks over the `@local-brain/core` domain actions. Components
 * read data through these, never the bridge or SQL directly. Mutations
 * invalidate the affected lists so the UI stays consistent.
 */

/** Seed demo data once on first run, then refresh queries if anything was inserted. */
export function useEnsureSeed(): void {
  const queryClient = useQueryClient()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void seedDemoData()
      .then((result) => {
        if (result.seeded) void queryClient.invalidateQueries()
      })
      .catch(() => {
        /* surfaced by the data queries themselves */
      })
  }, [queryClient])
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

// Organizations
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

// Memories + citations
export function useMemoriesForRecord(recordType: string, recordId: string) {
  return useQuery({
    queryKey: ['memories', recordType, recordId],
    queryFn: () => listMemoriesForRecord(recordType, recordId),
  })
}

export function useCitationsForSubject(subjectType: string, subjectId: string) {
  return useQuery({
    queryKey: ['citations', subjectType, subjectId],
    queryFn: () => listCitationsForSubject(subjectType, subjectId),
  })
}

export function useEvidenceFromDocument(documentId: string) {
  return useQuery({
    queryKey: ['document', documentId, 'evidence'],
    queryFn: () => listEvidenceFromDocument(documentId),
  })
}

// Graph
export function useGraph() {
  return useQuery({ queryKey: ['graph'], queryFn: getGraph })
}

// Ingestion (paste/import). On success we invalidate broadly because a new
// document/interaction touches many lists (links, graph, search, Today).
export function useIngestDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: IngestDocumentInput) => ingestDocument(input),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useIngestInteraction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: IngestInteractionInput) => ingestInteraction(input),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

// Quick search (command palette record results)
export function useQuickSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['quick-search', trimmed],
    queryFn: () => quickSearch(trimmed),
    enabled: trimmed.length > 0,
  })
}

// Chat (Ask)
export function useConversations() {
  return useQuery({ queryKey: ['conversations'], queryFn: listConversations })
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['messages', conversationId ?? null],
    queryFn: () => (conversationId ? listMessages(conversationId) : Promise.resolve([])),
    enabled: conversationId !== undefined,
  })
}

export function useCreateConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string | null) => createConversation(title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  })
}

export function useAddMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: NewChatMessage) => addMessage(message),
    onSuccess: (_id, message) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', message.conversationId] })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}
