/** Optional stricter aggregate detail budget for a factual Chat turn. */
export interface ChatRecordDetailBudget {
  /** Factual turns deliberately allow one aggregate detail batch. */
  maxCalls: 1
  maxRecords: number
  maxTotalChars: number
}

interface AbsoluteRecordDetailLimits {
  maxRecords: number
  maxTotalChars: number
}

export interface ChatReadBudget {
  maxRecords: number
  maxTotalChars: number
  reserveDiscoveryCall: () => void
  reserveRecordDetailCall: () => void
}

/** One closure-backed budget shared by every read tool execution in a turn. */
export function createChatReadBudget(
  recordDetails: ChatRecordDetailBudget | undefined,
  absolute: AbsoluteRecordDetailLimits,
): ChatReadBudget {
  let discoveryCalls = 0
  let recordDetailCalls = 0
  return {
    maxRecords: Math.min(recordDetails?.maxRecords ?? absolute.maxRecords, absolute.maxRecords),
    maxTotalChars: Math.min(
      recordDetails?.maxTotalChars ?? absolute.maxTotalChars,
      absolute.maxTotalChars,
    ),
    reserveDiscoveryCall(): void {
      if (discoveryCalls >= 2) {
        throw new Error(
          'This turn has already used its two discovery calls. Load the most promising records already returned, then answer from them.',
        )
      }
      discoveryCalls += 1
    },
    reserveRecordDetailCall(): void {
      if (recordDetailCalls >= (recordDetails?.maxCalls ?? Number.POSITIVE_INFINITY)) {
        throw new Error(
          'This turn has already loaded its record-detail batch. Answer from those records instead of loading more sources.',
        )
      }
      recordDetailCalls += 1
    },
  }
}
