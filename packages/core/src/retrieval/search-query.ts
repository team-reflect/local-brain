/**
 * Parse the small search grammar used by the desktop palette and CLI.
 *
 * `#slug` tokens are exact tag filters. Everything else remains ordinary free
 * text so tags with spaces are still discoverable through plain tag-name search.
 *
 * Mirrored in Rust by `parse_search_query` in apps/cli/src/commands/read.rs —
 * keep the two grammars in sync.
 */
export interface ParsedSearchQuery {
  /** Free text left for FTS, name/title LIKE, asset search, and tag-name search. */
  text: string
  /** Lower-cased tag slugs/names from `#tag` tokens, ANDed by callers. */
  tagFilters: readonly string[]
}

const TAG_FILTER = /^#([\p{L}\p{N}][\p{L}\p{N}_/-]*)$/u

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const text: string[] = []
  const tags = new Set<string>()

  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const match = TAG_FILTER.exec(token)
    if (match) {
      tags.add(match[1]!.toLowerCase())
    } else {
      text.push(token)
    }
  }

  return { text: text.join(' '), tagFilters: [...tags] }
}
