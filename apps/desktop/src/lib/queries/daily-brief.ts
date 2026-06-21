import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { latestDailyBriefNote, localDateString } from '@local-brain/core'
import { generateTodayDailyBrief } from '../ai/daily-brief'

export function useDailyBriefNote(date = localDateString()) {
  return useQuery({
    queryKey: ['daily-brief-note', date],
    queryFn: () => latestDailyBriefNote(date).then((note) => note ?? null),
  })
}

export function useGenerateDailyBrief(date = localDateString()) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: generateTodayDailyBrief,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['daily-brief-note', date] })
    },
  })
}
