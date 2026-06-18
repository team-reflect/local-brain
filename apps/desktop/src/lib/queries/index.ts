/**
 * TanStack Query hooks over the `@local-brain/core` domain actions, split by
 * area. Components import from `../lib/queries`; this barrel re-exports every
 * hook so call sites are unaffected by the file split. Mutations invalidate the
 * affected lists so the UI stays consistent.
 */
export * from './records'
export * from './corrections'
export * from './ingest'
export * from './search'
export * from './chat'
export * from './settings'
export * from './embeddings'
