import { useQuery } from '@tanstack/react-query'
import { getModelStatus } from '@local-brain/core'

/** The model-boundary status used by extraction and settings diagnostics. */
export function useModelStatus() {
  return useQuery({ queryKey: ['model-status'], queryFn: getModelStatus })
}
