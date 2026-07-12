/**
 * The serializable error contract shared with Rust.
 *
 * Rust `#[tauri::command]` handlers return `Result<T, AppError>`, where `AppError`
 * serializes as `{ kind, message }` with a camelCase `kind` discriminant (see
 * `apps/desktop/src-tauri/src/error.rs`). The frontend branches on `error.kind`
 * instead of parsing error strings.
 */
export type AppErrorKind =
  | 'io'
  | 'notFound'
  | 'traversal'
  | 'noDatabase'
  | 'parse'
  | 'auth'
  | 'network'
  | 'stale'
  // Raised in TypeScript at the domain write boundary (see `validation.ts`);
  // Rust never emits it, but the contract is shared so the UI can branch on it.
  | 'validation'
  | 'unknown'

export interface AppError {
  kind: AppErrorKind
  message: string
}

/** A cheap structural guard for values that already match the AppError contract. */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string' &&
    typeof (value as { kind: unknown }).kind === 'string'
  )
}

/**
 * Coerce any thrown value into an {@link AppError}. A rejected IPC command already
 * carries the contract; everything else collapses to an `unknown` error so callers
 * can still branch on `kind` without crashing on a non-Error throw.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error
  }
  if (error instanceof Error) {
    return { kind: 'unknown', message: error.message }
  }
  if (typeof error === 'string') {
    return { kind: 'unknown', message: error }
  }
  return { kind: 'unknown', message: 'unknown error' }
}
