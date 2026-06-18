import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveMemory,
  listCitationsForSubject,
  listEvidenceFromDocument,
  listMemoriesForRecord,
  listReconnectSuggestions,
  removeEvidenceRef,
  unlinkMemoryFromRecord,
  unlinkRecords,
  type LinkedRecord,
  type LinkRef,
} from '@local-brain/core'

/**
 * Memories, citations, and the Plan 05b correction mutations (unlink a record,
 * archive/unlink a memory, remove a wrong citation), plus relationship-intelligence
 * reads. Corrections touch links/memories that fan out across many detail pages,
 * the graph, and Today, so they invalidate broadly.
 */

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

export function useUnlinkRecord() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { a: LinkRef; b: LinkRef }) => unlinkRecords(vars.a, vars.b),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

/**
 * A ready-made unlink handler for a detail page: returns a callback that severs
 * the link between the page's record (`source`) and a linked record. Memory
 * links are corrected separately, so memory targets are ignored here.
 */
export function useUnlinkFrom(source: LinkRef): (record: LinkedRecord) => void {
  const unlink = useUnlinkRecord()
  return (record: LinkedRecord) => {
    if (record.kind === 'memory') return
    unlink.mutate({ a: source, b: { kind: record.kind, id: record.id } })
  }
}

export function useArchiveMemory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => archiveMemory(id),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useUnlinkMemory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { memoryId: string; recordType: string; recordId: string }) =>
      unlinkMemoryFromRecord(vars.memoryId, vars.recordType, vars.recordId),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useRemoveEvidenceRef() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => removeEvidenceRef(id),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useReconnectSuggestions(limit?: number) {
  return useQuery({
    queryKey: ['reconnect-suggestions', limit ?? null],
    queryFn: () => listReconnectSuggestions(limit !== undefined ? { limit } : {}),
  })
}
