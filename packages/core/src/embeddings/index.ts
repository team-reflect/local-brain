export {
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSIONS,
  embedStatusSchema,
  byteProgressSchema,
  isEmbedReady,
  type EmbedStatus,
  type ByteProgress,
} from './model'
export {
  embedStatus,
  embedDatabaseIdentity,
  embeddingDatabaseIdentitiesEqual,
  isEmbeddingDatabaseIdentityCurrent,
  embedEnsure,
  embedTexts,
  embedApply,
  embedDelete,
  embedClear,
  type EmbeddedChunkInput,
  type EmbeddingDatabaseIdentity,
} from './commands'
export {
  semanticHits,
  fuseRanked,
  KNN_CANDIDATES,
  MAX_COSINE_DISTANCE,
  RRF_K,
  type SemanticHitOptions,
} from './semantic'
export {
  backfillEmbeddings,
  clearEmbeddings,
  countPending,
  countOrphanEmbeddings,
  pruneOrphanEmbeddings,
  type BackfillOptions,
  type BackfillProgress,
  type BackfillResult,
} from './pipeline'
export {
  getEmbeddingsStatus,
  isEmbeddingsEnabled,
  setEmbeddingsEnabled,
  getBackfillError,
  setBackfillError,
  getLastBackfillAttemptDay,
  setLastBackfillAttemptDay,
  EMBEDDINGS_ENABLED_KEY,
  EMBEDDINGS_BACKFILL_ERROR_KEY,
  EMBEDDINGS_LAST_BACKFILL_ATTEMPT_DAY_KEY,
  type EmbeddingsStatus,
} from './status'
