import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  ) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const css = readFileSync(join(import.meta.dirname, 'theme.css'), 'utf8')
const tokens = Object.fromEntries(
  [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/g)].map(([, name, hex]) => [name, hex])
) as Record<string, string>

/** [foreground, background] pairs actually used together in the UI. */
const TEXT_PAIRS: [string, string][] = [
  ['fg', 'surface'],
  ['fg', 'canvas'],
  ['fg', 'surface-muted'],
  ['fg-muted', 'surface'],
  ['fg-muted', 'canvas'],
  ['fg-muted', 'surface-muted'],
  ['fg-subtle', 'surface'],
  ['fg-subtle', 'canvas'],
  ['fg-subtle', 'surface-muted'],
  ['fg-inverse', 'accent'],
  ['fg-inverse', 'accent-hover'],
  ['fg-inverse', 'danger'],
  ['fg-inverse', 'danger-hover'],
  ['fg-inverse', 'success'],
  ['accent', 'surface'],
  ['accent-fg', 'accent-soft'],
  ['success', 'surface'],
  ['success-fg', 'success-soft'],
  ['warning', 'surface'],
  ['warning-fg', 'warning-soft'],
  ['danger', 'surface'],
  ['danger-fg', 'danger-soft'],
  ['nav-fg', 'nav'],
  ['nav-fg', 'nav-hover'],
  ['nav-fg-active', 'nav-active'],
  ['nav-fg-muted', 'nav'],
  ['fg-inverse', 'nav']
]

/** Non-text UI: control boundaries and focus indicators (WCAG 1.4.11). */
const UI_PAIRS: [string, string][] = [
  ['input', 'surface'],
  ['input', 'canvas'],
  ['focus', 'surface'],
  ['focus', 'canvas'],
  ['focus', 'accent-soft'],
  ['focus-on-dark', 'nav'],
  ['focus-on-dark', 'nav-active'],
  ['accent', 'surface'],
  ['danger', 'surface']
]

describe('design token contrast', () => {
  it.each(TEXT_PAIRS)('text %s on %s meets 4.5:1', (fg, bg) => {
    expect(tokens[fg], fg).toBeDefined()
    expect(tokens[bg], bg).toBeDefined()
    expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(UI_PAIRS)('control %s on %s meets 3:1', (fg, bg) => {
    expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3)
  })
})
