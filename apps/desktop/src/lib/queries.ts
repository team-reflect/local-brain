import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveTask,
  completeTask,
  getDocument,
  getInteraction,
  getPerson,
  getProject,
  getSelf,
  getTask,
  listInteractionParticipants,
  listInteractions,
  listPeople,
  listProjects,
  listTasks,
  seedDemoData,
  type ListTasksOptions,
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
  return useQuery({ queryKey: ['self'], queryFn: getSelf })
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => listPeople() })
}

export function usePerson(id: string) {
  return useQuery({ queryKey: ['person', id], queryFn: () => getPerson(id) })
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => listProjects() })
}

export function useProject(id: string) {
  return useQuery({ queryKey: ['project', id], queryFn: () => getProject(id) })
}

export function useTasks(options: ListTasksOptions = {}) {
  return useQuery({ queryKey: ['tasks', options], queryFn: () => listTasks(options) })
}

export function useTask(id: string) {
  return useQuery({ queryKey: ['task', id], queryFn: () => getTask(id) })
}

export function useInteractions(limit?: number) {
  return useQuery({
    queryKey: ['interactions', limit ?? null],
    queryFn: () => listInteractions(limit !== undefined ? { limit } : {}),
  })
}

export function useInteraction(id: string) {
  return useQuery({ queryKey: ['interaction', id], queryFn: () => getInteraction(id) })
}

export function useInteractionParticipants(id: string) {
  return useQuery({
    queryKey: ['interaction', id, 'participants'],
    queryFn: () => listInteractionParticipants(id),
  })
}

export function useDocument(id: string) {
  return useQuery({ queryKey: ['document', id], queryFn: () => getDocument(id) })
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
