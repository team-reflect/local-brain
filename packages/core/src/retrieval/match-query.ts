/**
 * Turn arbitrary user text into a safe FTS5 `MATCH` expression.
 *
 * FTS5 query syntax is full of operators (`AND`, `OR`, `NEAR`, `*`, `:`, `"`,
 * `^`, `-`, `(`, `)`). Passing raw user input straight to `MATCH` both risks a
 * syntax error and lets a stray quote change the query's meaning. We tokenize to
 * pure alphanumeric (Unicode-aware) terms, so the resulting expression can never
 * contain an operator we did not intend, then AND the terms together. The final
 * term gets a `*` prefix so type-ahead matches partial words.
 *
 * Returns `null` when the input has no searchable tokens (caller should treat
 * that as "no query" rather than running an empty `MATCH`).
 */
export function toMatchQuery(
  raw: string,
  options: { prefixLast?: boolean; op?: 'and' | 'or' } = {},
): string | null {
  const prefixLast = options.prefixLast ?? true
  const op = options.op ?? 'and'
  const tokens = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu)
  if (!tokens || tokens.length === 0) return null
  const last = tokens.length - 1
  // Tokens are pure alphanumerics, so no FTS operator can survive — safe to embed.
  // `and` (implicit space) favours precision for the palette; `or` favours recall
  // for question-style retrieval where stopwords ("who", "what") shouldn't gate.
  const terms = tokens.map((token, index) => (prefixLast && index === last ? `${token}*` : token))
  return terms.join(op === 'or' ? ' OR ' : ' ')
}

/** A LIKE pattern (`%term%`) that escapes the LIKE wildcards in user input. */
export function toLikePattern(raw: string): string | null {
  const needle = raw.trim()
  if (!needle) return null
  const escaped = needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  return `%${escaped}%`
}
