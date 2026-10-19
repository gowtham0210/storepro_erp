import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempDir } from '../test/helpers'
import { createAppProtocolHandler, resolveAppAssetPath } from './appProtocol'
import { developmentCsp, PRODUCTION_CSP } from './csp'

// resolve() adds the drive letter on Windows, as the production code does.
const root = resolve('/opt/storepro/renderer')

describe('resolveAppAssetPath', () => {
  it('maps paths inside the renderer root', () => {
    expect(resolveAppAssetPath(root, 'app://storepro/assets/index-abc.js')).toBe(
      join(root, 'assets', 'index-abc.js')
    )
  })

  it('serves index.html for the root and for extension-less routes', () => {
    expect(resolveAppAssetPath(root, 'app://storepro/')).toBe(join(root, 'index.html'))
    expect(resolveAppAssetPath(root, 'app://storepro/sales/123')).toBe(join(root, 'index.html'))
  })

  it('rejects other hosts', () => {
    expect(resolveAppAssetPath(root, 'app://evil/index.html')).toBeNull()
  })

  it('never resolves outside the root, including encoded traversal', () => {
    // Dot segments are normalised by the URL parser and stay inside the root.
    expect(resolveAppAssetPath(root, 'app://storepro/%2e%2e/%2e%2e/secret.txt')).toBe(
      join(root, 'secret.txt')
    )
    // Encoded separators survive URL parsing and must be caught after decoding.
    expect(resolveAppAssetPath(root, 'app://storepro/..%2F..%2Fsecret.txt')).toBeNull()
    expect(resolveAppAssetPath(root, 'app://storepro/assets/..%2F..%2F..%2Fsecret.txt')).toBeNull()
  })

  it('never escapes the root for hostile input on any platform', () => {
    const hostile = [
      'app://storepro/..%5C..%5Csecret.txt', // backslash is a separator on Windows
      'app://storepro/assets/..%5C..%5C..%5Cwindows%5Cwin.ini',
      'app://storepro/C:/Windows/win.ini',
      'app://storepro/%2F%2Fserver%2Fshare%2Ffile.txt',
      'app://storepro/%5C%5Cserver%5Cshare%5Cfile.txt',
      'app://storepro/..%2f..%2f..%2fetc%2fpasswd',
      'app://storepro/%252e%252e%252fsecret.txt'
    ]
    for (const url of hostile) {
      const resolved = resolveAppAssetPath(root, url)
      expect(resolved === null || resolved.startsWith(root + sep), `${url} -> ${resolved}`).toBe(
        true
      )
    }
  })

  it('rejects malformed input', () => {
    expect(resolveAppAssetPath(root, 'app://storepro/%E0%A4%A.js')).toBeNull()
    expect(resolveAppAssetPath(root, 'app://storepro/a%00.js')).toBeNull()
    expect(resolveAppAssetPath(root, '::not a url')).toBeNull()
  })
})

describe('createAppProtocolHandler', () => {
  const tempDir = useTempDir()

  function setup() {
    const dir = tempDir()
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
    return createAppProtocolHandler(dir)
  }

  it('serves files with MIME type and security headers', async () => {
    const response = await setup()(new Request('app://storepro/assets/app.js'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/javascript')
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toBe('console.log(1)')
  })

  it('returns 404 for missing files and 405 for non-GET methods', async () => {
    const handler = setup()
    expect((await handler(new Request('app://storepro/missing.js'))).status).toBe(404)
    expect(
      (await handler(new Request('app://storepro/index.html', { method: 'POST' }))).status
    ).toBe(405)
  })
})

describe('PRODUCTION_CSP', () => {
  it('does not allow inline or eval scripts', () => {
    const scriptSrc = PRODUCTION_CSP.split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBe("script-src 'self'")
    expect(PRODUCTION_CSP).toContain("object-src 'none'")
  })
})

describe('developmentCsp', () => {
  it('relaxes only what the Vite dev server needs', () => {
    const csp = developmentCsp('http://localhost:5173')
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain("connect-src 'self' ws://localhost:5173")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('unsafe-eval')
  })
})
