import { z } from 'zod'
import { call } from '../../ipc/invoke'
import {
  type BrainColor,
  type BrainInfo,
  activeBrainSchema,
  brainInfoListSchema,
  brainInfoSchema,
} from './schema'

/**
 * Typed IPC bindings for the brain picker. Rust owns the durable registry
 * (a dedicated `registry.sqlite` database) and the connection swap; these
 * wrappers validate every response so the UI never touches the bridge directly.
 */

const voidSchema = z.unknown()

/** Every known brain, newest-opened first. */
export function listBrains(): Promise<BrainInfo[]> {
  return call('list_brains', {}, brainInfoListSchema)
}

/** The currently open brain. */
export function activeBrain(): Promise<BrainInfo | null> {
  return call('active_brain', {}, activeBrainSchema)
}

/**
 * Open or bootstrap a brain root folder and make it active. Rejects (leaving the
 * current brain intact) when the path is a file or cannot be opened.
 */
export function openBrain(rootPath: string): Promise<BrainInfo> {
  return call('open_brain', { rootPath }, brainInfoSchema)
}

/**
 * Create/bootstrap a brain root folder and open it. `name` defaults to a value
 * derived from the root folder.
 */
export function createBrain(rootPath: string, name?: string): Promise<BrainInfo> {
  return call('create_brain', { rootPath, name: name ?? null }, brainInfoSchema)
}

/** Rename a brain in the catalogue. */
export function renameBrain(rootPath: string, name: string): Promise<BrainInfo> {
  return call('rename_brain', { rootPath, name }, brainInfoSchema)
}

/** Set a brain's identity color. */
export function setBrainColor(rootPath: string, color: BrainColor): Promise<BrainInfo> {
  return call('set_brain_color', { rootPath, color }, brainInfoSchema)
}

/** Drop a brain from the catalogue (does not delete the folder). Returns the rest. */
export function forgetBrain(rootPath: string): Promise<BrainInfo[]> {
  return call('forget_brain', { rootPath }, brainInfoListSchema)
}

/** Reveal a brain's root folder in the OS file manager (best effort). */
export async function revealBrain(rootPath: string): Promise<void> {
  await call('reveal_brain', { rootPath }, voidSchema)
}
