import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Alert } from './alert'

export interface TaskCompletionFailure {
  taskId: string
  title: string
  action: 'complete' | 'reopen'
  message: string
}

interface TaskCompletionFeedbackContextValue {
  failures: readonly TaskCompletionFailure[]
  reportFailure: (failure: TaskCompletionFailure) => void
  clearFailure: (taskId: string) => void
}

const TaskCompletionFeedbackContext = createContext<TaskCompletionFeedbackContextValue | null>(null)

/** Keep completion failures alive when optimistic filtering temporarily removes their task row. */
export function TaskCompletionFeedbackProvider({ children }: { children: ReactNode }): ReactNode {
  const [failures, setFailures] = useState<TaskCompletionFailure[]>([])
  const reportFailure = useCallback((failure: TaskCompletionFailure): void => {
    setFailures((current) => [
      ...current.filter((candidate) => candidate.taskId !== failure.taskId),
      failure,
    ])
  }, [])
  const clearFailure = useCallback((taskId: string): void => {
    setFailures((current) => current.filter((failure) => failure.taskId !== taskId))
  }, [])
  const value = useMemo<TaskCompletionFeedbackContextValue>(
    () => ({ failures, reportFailure, clearFailure }),
    [clearFailure, failures, reportFailure],
  )

  return (
    <TaskCompletionFeedbackContext.Provider value={value}>
      {children}
    </TaskCompletionFeedbackContext.Provider>
  )
}

/** Render the scoped task completion failures as assertive, task-specific alerts. */
export function TaskCompletionFeedback(): ReactNode {
  const feedback = useTaskCompletionFeedback()
  if (!feedback || feedback.failures.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {feedback.failures.map((failure) => (
        <Alert key={failure.taskId} variant="error">
          Could not {failure.action} {failure.title}: {failure.message}
        </Alert>
      ))}
    </div>
  )
}

/** Access the nearest scoped completion feedback store, if a surface provides one. */
export function useTaskCompletionFeedback(): TaskCompletionFeedbackContextValue | null {
  return useContext(TaskCompletionFeedbackContext)
}
