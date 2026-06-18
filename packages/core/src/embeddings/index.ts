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
  embedEnsure,
  embedTexts,
  embedApply,
  embedDelete,
  embedClear,
  type EmbeddedChunkInput,
} from './commands'
export {
  semanticHits,
  fuseRanked,
  KNN_CANDIDATES,
  MAX_COSINE_DISTANCE,
  RRF_K,
} from './semantic'
export {
  backfillEmbeddings,
  clearEmbeddings,
  countPending,
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
  EMBEDDINGS_ENABLED_KEY,
  EMBEDDINGS_BACKFILL_ERROR_KEY,
  type EmbeddingsStatus,
} from './status'
