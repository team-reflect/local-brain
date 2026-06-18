import { backupDatabase, databasePath, writeFileAtomic, type BackupInfo } from '../../ipc/storage'
import { assembleExport, type BrainExport } from './export'

/**
 * Backup & export orchestration (Plan 08). TypeScript decides what to write;
 * Rust performs the consistent SQLite snapshot and the atomic file write.
 *
 * Product states for the UI (architecture: use product language, not storage
 * jargon).
 */
export type BackupState = 'idle' | 'backedUp' | 'exporting' | 'offline' | 'needsReview' | 'backupFailed'

/** Create a verified SQLite backup at `dest`. Throws (UI shows `backupFailed`). */
export function createBackup(dest: string): Promise<BackupInfo> {
  return backupDatabase(dest)
}

export interface ExportResult {
  path: string
  bytes: number
  snapshot: BrainExport
}

/** Assemble the JSON export and write it atomically to `dest`. */
export async function exportToFile(dest: string): Promise<ExportResult> {
  const snapshot = await assembleExport()
  const json = JSON.stringify(snapshot, null, 2)
  const bytes = await writeFileAtomic(dest, json)
  return { path: dest, bytes, snapshot }
}

/** A sensible default backup path next to the live database, timestamped. */
export async function defaultBackupPath(stamp: string): Promise<string> {
  const dbPath = await databasePath()
  const dir = dbPath.replace(/[^/\\]+$/, '')
  return `${dir}brain-backup-${stamp}.sqlite`
}

export async function defaultExportPath(stamp: string): Promise<string> {
  const dbPath = await databasePath()
  const dir = dbPath.replace(/[^/\\]+$/, '')
  return `${dir}brain-export-${stamp}.json`
}
