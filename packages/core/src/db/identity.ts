import { z } from 'zod'
import { type AppError } from '../errors'
import { call } from '../ipc/invoke'

const databaseIdentitySchema = z.object({
  databasePath: z.string().min(1),
  generation: z.number().int().nonnegative(),
})

/** Exact path + ABA-safe connection generation for the open brain. */
export type DatabaseIdentity = z.infer<typeof databaseIdentitySchema>

/** Capture the connection an asynchronous read/write workflow must remain bound to. */
export function activeDatabaseIdentity(): Promise<DatabaseIdentity> {
  return call('active_database_identity', {}, databaseIdentitySchema)
}

/** Compare both the database path and ABA-safe connection generation. */
export function databaseIdentitiesEqual(
  left: DatabaseIdentity,
  right: DatabaseIdentity,
): boolean {
  return left.databasePath === right.databasePath && left.generation === right.generation
}

/** Fail a workflow before it can expose or persist results from a switched brain. */
export async function assertActiveDatabaseIdentity(
  expected: DatabaseIdentity,
): Promise<void> {
  const current = await activeDatabaseIdentity()
  if (databaseIdentitiesEqual(expected, current)) return
  const error: AppError = {
    kind: 'stale',
    message: 'The active brain changed while this operation was in flight.',
  }
  throw error
}

/** Convert an identity into the paired optional arguments accepted by native DB commands. */
export function expectedDatabaseArgs(identity: DatabaseIdentity): {
  expectedDatabasePath: string
  expectedGeneration: number
} {
  return {
    expectedDatabasePath: identity.databasePath,
    expectedGeneration: identity.generation,
  }
}
