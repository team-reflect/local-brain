import { z } from 'zod'
import { call } from './invoke'

/**
 * Typed bindings for the Plan 08 native storage + keychain primitives.
 *
 * Rust owns the durable connection, atomic file writes, and the OS keychain;
 * TypeScript decides *what* to back up/export and assembles the JSON. Provider
 * keys flow only through `keychain*` — never a settings row.
 */

const backupInfoSchema = z.object({
  path: z.string(),
  schemaVersion: z.number().int(),
  sizeBytes: z.number().int().nonnegative(),
})

export type BackupInfo = z.infer<typeof backupInfoSchema>

/** The resolved durable database path (diagnostics / backup defaults). */
export function databasePath(): Promise<string> {
  return call('database_path', {}, z.string())
}

/** Make a consistent, verified, atomically-published SQLite backup at `dest`. */
export function backupDatabase(dest: string): Promise<BackupInfo> {
  return call('backup_database', { dest }, backupInfoSchema)
}

/** Atomically write a generated artifact (e.g. the JSON export) to `dest`. */
export function writeFileAtomic(dest: string, contents: string): Promise<number> {
  return call('write_file_atomic', { dest, contents }, z.number())
}

// Tauri commands that return `()` serialize as JSON `null`; accept and discard it.
const voidSchema = z.unknown()

/** Store (or replace) a provider key in the OS keychain. */
export async function keychainSet(account: string, secret: string): Promise<void> {
  await call('keychain_set', { account, secret }, voidSchema)
}

/** Read a provider key from the keychain (null when none is stored). */
export function keychainGet(account: string): Promise<string | null> {
  return call('keychain_get', { account }, z.string().nullable())
}

/** Whether a provider key is stored for the account. */
export function keychainHas(account: string): Promise<boolean> {
  return call('keychain_has', { account }, z.boolean())
}

/** Delete a provider key from the keychain. */
export async function keychainDelete(account: string): Promise<void> {
  await call('keychain_delete', { account }, voidSchema)
}
