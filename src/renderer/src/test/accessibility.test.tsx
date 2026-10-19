import { screen } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { renderApp } from './renderApp'

/**
 * Automated WCAG checks (axe-core) on the real shell and every component.
 * jsdom has no layout, so colour contrast is checked separately: in
 * styles/contrast.test.ts (tokens) and against the running app.
 */
async function violations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
    },
    rules: { 'color-contrast': { enabled: false } }
  })
  return results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`
  )
}

describe('accessibility', () => {
  it('the app shell has no axe violations', async () => {
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    expect(await violations()).toEqual([])
  })

  it('the component gallery has no axe violations', async () => {
    renderApp('/dev/components')
    await screen.findByRole('heading', { level: 1, name: 'Components' }, { timeout: 5000 })
    expect(await violations()).toEqual([])
  })
})
