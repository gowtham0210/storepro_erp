import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { APP_HOST } from './origins'
import { PRODUCTION_CSP } from './csp'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
}

/**
 * Map an app:// request URL to a file inside `rootDir`, or null when the URL
 * targets another host or escapes the root (path traversal).
 *
 * Paths without a file extension fall back to index.html so client-side
 * routes survive a reload.
 */
export function resolveAppAssetPath(rootDir: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.host !== APP_HOST) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null
  if (pathname === '/' || extname(pathname) === '') pathname = '/index.html'

  const root = resolve(rootDir)
  const filePath = resolve(root, `.${pathname}`)
  return filePath.startsWith(root + sep) ? filePath : null
}

/** Builds the `protocol.handle` callback that serves the bundled renderer. */
export function createAppProtocolHandler(rootDir: string): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 })
    }
    const filePath = resolveAppAssetPath(rootDir, request.url)
    if (filePath === null) return new Response(null, { status: 404 })

    let body: Buffer
    try {
      body = await readFile(filePath)
    } catch {
      return new Response(null, { status: 404 })
    }
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': PRODUCTION_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache'
      }
    })
  }
}
