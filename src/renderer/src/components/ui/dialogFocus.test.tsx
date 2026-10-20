import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShortcutProvider } from '../../shortcuts/ShortcutProvider'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { NumberInput } from './NumberInput'
import { Select } from './Select'
import { TextInput } from './TextInput'

/**
 * A browser opens a modal dialog by focusing its first focusable element when no
 * element carries the `autofocus` attribute, and React's `autoFocus` prop doesn't
 * set that attribute (it runs while the dialog is still closed, where focus can't
 * land). That left every dialog focused on its Close button: type a cash amount,
 * press Enter, and the dialog closed instead of taking the payment. jsdom doesn't
 * do either of those things, so this test acts like the browser.
 */
describe('where focus lands when a dialog opens', () => {
  const original = HTMLDialogElement.prototype.showModal
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
      this.querySelector<HTMLElement>('button')?.focus()
    }
  })
  afterEach(() => {
    HTMLDialogElement.prototype.showModal = original
  })

  it('goes to the field that asked for it, not the Close button', () => {
    render(
      <ShortcutProvider>
        <Dialog open onClose={() => {}} title="Take payment">
          <label>
            Method
            <TextInput aria-label="Reference" />
          </label>
          <TextInput aria-label="Cash tendered" autoFocus />
        </Dialog>
      </ShortcutProvider>
    )
    expect(screen.getByLabelText('Cash tendered')).toBe(document.activeElement)
  })

  it('works for every kind of control a dialog autofocuses', () => {
    const kinds: [string, React.ReactElement][] = [
      ['number', <NumberInput aria-label="Amount" value="" onValueChange={() => {}} autoFocus />],
      ['select', <Select aria-label="Kind" options={[{ value: 'a', label: 'A' }]} autoFocus />],
      ['button', <Button autoFocus>Start next bill</Button>]
    ]
    for (const [, control] of kinds) {
      const { unmount } = render(
        <ShortcutProvider>
          <Dialog open onClose={() => {}} title="Dialog">
            {control}
          </Dialog>
        </ShortcutProvider>
      )
      const target = document.querySelector<HTMLElement>('[data-autofocus]')
      expect(target).not.toBeNull()
      expect(target).toBe(document.activeElement)
      unmount()
    }
  })

  it('prefers an explicit initial focus element over an autofocus field', () => {
    const ref = { current: null as HTMLInputElement | null }
    render(
      <ShortcutProvider>
        <Dialog open onClose={() => {}} title="Dialog" initialFocusRef={ref}>
          <TextInput aria-label="Other" autoFocus />
          <input aria-label="Chosen" ref={ref} />
        </Dialog>
      </ShortcutProvider>
    )
    expect(screen.getByLabelText('Chosen')).toBe(document.activeElement)
  })

  it('leaves the first control focused when nothing asked for focus', () => {
    render(
      <ShortcutProvider>
        <Dialog open onClose={() => {}} title="Dialog">
          <TextInput aria-label="Name" />
        </Dialog>
      </ShortcutProvider>
    )
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
  })

  describe('and where it goes when the dialog closes', () => {
    function Harness({ moveFocus = false }: { moveFocus?: boolean }): React.JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <ShortcutProvider>
          <button onClick={() => setOpen(true)}>Open it</button>
          <input aria-label="Elsewhere" />
          {open && (
            <Dialog
              open
              onClose={() => {
                setOpen(false)
                if (moveFocus)
                  document.querySelector<HTMLElement>('[aria-label="Elsewhere"]')?.focus()
              }}
              title="A dialog"
            >
              <TextInput aria-label="Field" autoFocus />
            </Dialog>
          )}
        </ShortcutProvider>
      )
    }

    it('comes back to what had it, even though the dialog is removed rather than closed', async () => {
      const user = userEvent.setup()
      render(<Harness />)
      screen.getByRole('button', { name: 'Open it' }).focus()
      await user.keyboard('{Enter}')
      expect(screen.getByLabelText('Field')).toBe(document.activeElement)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByRole('button', { name: 'Open it' })).toBe(document.activeElement)
    })

    it('leaves focus alone when the page has already put it somewhere on purpose', async () => {
      const user = userEvent.setup()
      render(<Harness moveFocus />)
      screen.getByRole('button', { name: 'Open it' }).focus()
      await user.keyboard('{Enter}')
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.getByLabelText('Elsewhere')).toBe(document.activeElement)
    })
  })
})
