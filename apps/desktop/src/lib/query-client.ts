import { QueryClient } from '@tanstack/react-query'

/** Shared TanStack Query client. Owns IPC/server-state caching and invalidation. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})
