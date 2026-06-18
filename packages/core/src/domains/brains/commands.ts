import { z } from 'zod'
import { call } from '../../ipc/invoke'
import {
  type BrainColor,
  type BrainInfo,
  brainInfoListSchema,
  brainInfoSchema,
} from './schema'

/**
 * Typed IPC bindings for the brain picker. Rust owns the durable registry
 * (`brains.json`) and the connection swap; these wrappers validate every
 * response so the UI never touches the bridge directly.
 */

const voidSchema = z.unknown()

/** Every known brain, newest-opened first. */
export function listBrains(): Promise<BrainInfo[]> {
  return call('list_brains', {}, brainInfoListSchema)
}

/** The currently open brain. */
export function activeBrain(): Promise<BrainInfo> {
  return call('active_brain', {}, brainInfoSchema)
}

/**
 * Open an existing brain database and make it active. Rejects (leaving the
 * current brain intact) when the path is missing or not a brain database.
 */
export function openBrain(path: string): Promise<BrainInfo> {
  return call('open_brain', { path }, brainInfoSchema)
}

/**
 * Create a new brain at an absolute `path` (which must not already exist) and
 * open it. `name` defaults to a value derived from the path.
 */
export function createBrain(path: string, name?: string): Promise<BrainInfo> {
  return call('create_brain', { path, name: name ?? null }, brainInfoSchema)
}

/** Rename a brain in the catalogue. */
export function renameBrain(path: string, name: string): Promise<BrainInfo> {
  return call('rename_brain', { path, name }, brainInfoSchema)
}

/** Set a brain's identity color. */
export function setBrainColor(path: string, color: BrainColor): Promise<BrainInfo> {
  return call('set_brain_color', { path, color }, brainInfoSchema)
}

/** Drop a brain from the catalogue (does not delete the file). Returns the rest. */
export function forgetBrain(path: string): Promise<BrainInfo[]> {
  return call('forget_brain', { path }, brainInfoListSchema)
}

/** Reveal a brain's database file in the OS file manager (best effort). */
export async function revealBrain(path: string): Promise<void> {
  await call('reveal_brain', { path }, voidSchema)
}
