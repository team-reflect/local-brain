import { z } from 'zod'
import { call } from './invoke'

/**
 * Typed bindings for the Plan 08 native storage path + keychain primitives.
 *
 * Rust owns the durable connection and the OS keychain. Provider keys flow only
 * through `keychain*` — never a settings row.
 */

/** The resolved durable database path (diagnostics). */
export function databasePath(): Promise<string> {
  return call('database_path', {}, z.string())
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
