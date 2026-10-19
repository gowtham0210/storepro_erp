const BASE_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
  'frame-src': ["'none'"],
  'worker-src': ["'self'"]
} satisfies Record<string, string[]>

type Directives = Record<keyof typeof BASE_DIRECTIVES, string[]>

function serialise(directives: Directives): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

export const PRODUCTION_CSP = serialise(BASE_DIRECTIVES)

/**
 * The Vite dev server injects inline scripts (React Fast Refresh preamble),
 * inline styles, and opens a WebSocket for HMR. Never used in packaged builds.
 */
export function developmentCsp(devServerOrigin: string): string {
  const wsOrigin = devServerOrigin.replace(/^http/, 'ws')
  return serialise({
    ...BASE_DIRECTIVES,
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'connect-src': ["'self'", wsOrigin]
  })
}
