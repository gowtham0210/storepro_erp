/**
 * Turn what a cashier types into a safe FTS5 query that matches every word as
 * a prefix: `toor dal 1k` → `"toor"* "dal"* "1k"*`.
 *
 * Raw input must never be passed to MATCH: characters such as `-`, `"`, `*`,
 * `:` and words like OR/NOT are query syntax, so "SKU-123" would be a syntax
 * error. Tokens are split the same way the unicode61 tokenizer splits text.
 * Returns null when the input has nothing searchable.
 */
export function buildPrefixMatchQuery(input: string, maxTerms = 8): string | null {
  const tokens = input
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .slice(0, maxTerms)
  if (tokens.length === 0) return null
  return tokens.map((token) => `"${token}"*`).join(' ')
}
