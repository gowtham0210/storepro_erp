/**
 * Per-device UI preferences in localStorage. Storage can be unavailable or
 * corrupt, so reads fall back to the default and writes never throw.
 */
export function readPreference<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T
): T {
  try {
    const raw = localStorage.getItem(`storepro.${key}`)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    return isValid(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function writePreference(key: string, value: unknown): void {
  try {
    localStorage.setItem(`storepro.${key}`, JSON.stringify(value))
  } catch {
    // A preference that cannot be saved is not worth interrupting the user for.
  }
}
