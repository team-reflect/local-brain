import { z } from 'zod'
import { call } from './invoke'

/**
 * Typed bindings for the Rust safe file-read primitives (Plan 04b). The UI
 * (Plan 04c) calls these to read user-selected text/markdown files, then passes
 * the returned `contents` to `ingestDocument` / `ingestInteraction`, which
 * normalizes and re-hashes the text for the authoritative dedupe check.
 */

const fileImportSchema = z.object({
  path: z.string(),
  contents: z.string(),
  contentHash: z.string(),
  byteLen: z.number().int().nonnegative(),
  kind: z.string(),
})

export type FileImport = z.infer<typeof fileImportSchema>

const skippedFileSchema = z.object({
  path: z.string(),
  reason: z.string(),
})

export type SkippedFile = z.infer<typeof skippedFileSchema>

const folderScanSchema = z.object({
  root: z.string(),
  files: z.array(fileImportSchema),
  skipped: z.array(skippedFileSchema),
  importedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
})

export type FolderScan = z.infer<typeof folderScanSchema>

/** Read one user-selected text/markdown file. Throws an AppError on failure. */
export function readTextFile(path: string): Promise<FileImport> {
  return call('read_text_file', { path }, fileImportSchema)
}

/** Scan a user-selected folder for importable text/markdown files. */
export function readTextFolder(path: string): Promise<FolderScan> {
  return call('read_text_folder', { path }, folderScanSchema)
}
