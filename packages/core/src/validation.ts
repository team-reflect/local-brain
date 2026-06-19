import type { AppError } from './errors'

/**
 * Write-boundary validation.
 *
 * Domain `validators.ts` reject inputs the SQLite schema cannot — a `NOT NULL`
 * column still accepts an empty string, and nothing in the DB knows a document
 * needs a title *or* a body. A {@link ValidationError} is a structured
 * {@link AppError} (`kind: 'validation'`), so a caller — UI or CLI — can branch
 * on `error.kind` instead of matching message strings.
 */
export class ValidationError extends Error implements AppError {
  readonly kind = 'validation'

  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/** Trim a value and require it to be non-empty, or throw with a field label. */
export function requireText(label: string, value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed.length === 0) {
    throw new ValidationError(`${label} is required`)
  }
  return trimmed
}
