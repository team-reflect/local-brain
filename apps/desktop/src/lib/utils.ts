import { type ClassValue, clsx } from 'clsx'
import { isAppError } from '@local-brain/core'
import { twMerge } from 'tailwind-merge'

/**
 * Merge conditional class names, de-duplicating conflicting Tailwind utilities
 * (the standard shadcn `cn` helper). Last-write-wins for clashing utilities.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * A human-readable message for any thrown value. A rejected IPC command surfaces
 * as an {@link import('@local-brain/core').AppError} (`{ kind, message }`), not an
 * `Error` instance, so `String(error)` would collapse to `[object Object]`; handle
 * both before falling back.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isAppError(error)) return error.message
  return String(error)
}
