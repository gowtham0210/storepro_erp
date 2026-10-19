/**
 * In production the renderer is served from a custom privileged scheme rather
 * than file://, so it gets a real origin, CSP response headers, and no access
 * to the rest of the filesystem (Electron security checklist, item 18).
 */
export const APP_SCHEME = 'app'
export const APP_HOST = 'storepro'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
export const APP_ENTRY_URL = `${APP_ORIGIN}/`

/**
 * `scheme://host[:port]` for a URL, or null when it cannot be parsed.
 *
 * Node's URL parser reports an opaque "null" origin for non-special schemes
 * such as app://, so the origin is assembled from protocol and host instead.
 */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!parsed.host) return null
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

export function isAllowedOrigin(url: string, allowedOrigins: readonly string[]): boolean {
  const origin = originOf(url)
  return origin !== null && allowedOrigins.includes(origin)
}

/** Only plain https links may be handed to the system browser. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
  } catch {
    return false
  }
}
