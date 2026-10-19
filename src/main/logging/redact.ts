// Over-matching is acceptable here: a wrongly masked field only costs some log detail.
const SENSITIVE_KEY =
  /pass(word|code)?|^pin$|pin_?code|secret|token|credential|authorization|cookie|api[-_]?key/i
const MAX_DEPTH = 6
const MAX_STRING_LENGTH = 2000

export const REDACTED = '[REDACTED]'

/**
 * Prepare a value for logging: masks fields whose names look sensitive,
 * serialises errors, truncates long strings and breaks cycles.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet())
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`
      : value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return String(value)
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[MaxDepth]'
  seen.add(value)

  if (value instanceof Error) {
    const serialised: Record<string, unknown> = { name: value.name, message: value.message }
    if (value.stack) serialised['stack'] = value.stack
    if (value.cause !== undefined) serialised['cause'] = redactValue(value.cause, depth + 1, seen)
    return serialised
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, seen))

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(entry, depth + 1, seen)
  }
  return result
}
