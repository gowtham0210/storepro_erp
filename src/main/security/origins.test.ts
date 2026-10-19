import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, isAllowedOrigin, isSafeExternalUrl, originOf } from './origins'

describe('originOf', () => {
  it('handles the custom app scheme', () => {
    expect(originOf('app://storepro/index.html')).toBe(APP_ORIGIN)
  })

  it('keeps the port for the dev server', () => {
    expect(originOf('http://localhost:5173/src/main.tsx')).toBe('http://localhost:5173')
  })

  it('returns null for unparseable or host-less URLs', () => {
    expect(originOf('not a url')).toBeNull()
    expect(originOf('file:///C:/Windows/system32')).toBeNull()
    expect(originOf('')).toBeNull()
  })
})

describe('isAllowedOrigin', () => {
  it('accepts only listed origins', () => {
    expect(isAllowedOrigin('app://storepro/sales', [APP_ORIGIN])).toBe(true)
    expect(isAllowedOrigin('app://other/index.html', [APP_ORIGIN])).toBe(false)
    expect(isAllowedOrigin('https://storepro.example', [APP_ORIGIN])).toBe(false)
    expect(isAllowedOrigin('http://localhost:5174', ['http://localhost:5173'])).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('allows plain https links only', () => {
    expect(isSafeExternalUrl('https://example.com/help')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(false)
    expect(isSafeExternalUrl('file:///C:/Windows/notepad.exe')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('https://user:pass@example.com')).toBe(false)
  })
})
