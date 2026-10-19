import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '../components/ui/Dialog'
import { comboFromEvent, normaliseCombo, worksWhileTyping } from './keys'
import {
  ShortcutProvider,
  ShortcutScope,
  useActiveShortcuts,
  useShortcut
} from './ShortcutProvider'

const key = (init: Partial<KeyboardEventInit> & { key: string; code?: string }) =>
  ({
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    code: '',
    ...init
  }) as KeyboardEvent

describe('combo parsing', () => {
  it('normalises hand-written combos', () => {
    expect(normaliseCombo('shift+ctrl+k')).toBe('Ctrl+Shift+K')
    expect(normaliseCombo('f12')).toBe('F12')
    expect(normaliseCombo('Ctrl++')).toBe('Ctrl++')
    expect(normaliseCombo('ctrl+,')).toBe('Ctrl+,')
    expect(normaliseCombo('esc')).toBe('Escape')
    expect(() => normaliseCombo('Hyper+K')).toThrow()
  })

  it('reads combos from events using the physical key for letters and digits', () => {
    expect(comboFromEvent(key({ key: 'k', code: 'KeyK', ctrlKey: true }))).toBe('Ctrl+K')
    expect(comboFromEvent(key({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('Shift+1')
    expect(comboFromEvent(key({ key: '1', code: 'Numpad1', ctrlKey: true }))).toBe('Ctrl+1')
    expect(comboFromEvent(key({ key: '?', code: 'Slash', shiftKey: true }))).toBe('?')
    expect(comboFromEvent(key({ key: 'F12', code: 'F12' }))).toBe('F12')
    expect(comboFromEvent(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull()
  })

  it('lets only non-text combos through while typing', () => {
    expect(worksWhileTyping('F12')).toBe(true)
    expect(worksWhileTyping('Ctrl+S')).toBe(true)
    expect(worksWhileTyping('Escape')).toBe(true)
    expect(worksWhileTyping('K')).toBe(false)
    expect(worksWhileTyping('Shift+K')).toBe(false)
  })
})

function Harness({ onGlobal, onScreen }: { onGlobal: () => void; onScreen: () => void }) {
  const [dialog, setDialog] = useState(false)
  useShortcut('F12', onGlobal, { description: 'Pay' })
  useShortcut('K', onGlobal, { description: 'Plain key' })
  return (
    <>
      <input aria-label="Barcode" />
      <button onClick={() => setDialog(true)}>Open</button>
      <ShortcutScope name="Screen">
        <Screen onScreen={onScreen} />
      </ShortcutScope>
      <Dialog open={dialog} onClose={() => setDialog(false)} title="Modal">
        <p>Inside</p>
      </Dialog>
      <HelpList />
    </>
  )
}

function Screen({ onScreen }: { onScreen: () => void }) {
  useShortcut('Ctrl+S', onScreen, { description: 'Save' })
  return null
}

function HelpList() {
  const active = useActiveShortcuts()
  return <output aria-label="active">{active.map((s) => `${s.layer}:${s.combo}`).join(',')}</output>
}

describe('ShortcutProvider', () => {
  function setup() {
    const onGlobal = vi.fn()
    const onScreen = vi.fn()
    render(
      <ShortcutProvider>
        <Harness onGlobal={onGlobal} onScreen={onScreen} />
      </ShortcutProvider>
    )
    return { onGlobal, onScreen }
  }

  it('runs global and screen shortcuts', () => {
    const { onGlobal, onScreen } = setup()
    fireEvent.keyDown(window, { key: 'F12', code: 'F12' })
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(onGlobal).toHaveBeenCalledTimes(1)
    expect(onScreen).toHaveBeenCalledTimes(1)
  })

  it('does not steal plain keys from text fields, but F-keys still work there', () => {
    const { onGlobal } = setup()
    const input = screen.getByLabelText('Barcode')
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK' })
    expect(onGlobal).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'F12', code: 'F12' })
    expect(onGlobal).toHaveBeenCalledTimes(1)
  })

  it('suspends background shortcuts while a modal dialog is open', () => {
    const { onGlobal, onScreen } = setup()
    fireEvent.click(screen.getByText('Open'))
    fireEvent.keyDown(window, { key: 'F12', code: 'F12' })
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(onGlobal).not.toHaveBeenCalled()
    expect(onScreen).not.toHaveBeenCalled()
  })

  it('lists the active shortcuts with their layer', () => {
    setup()
    expect(screen.getByLabelText('active').textContent).toBe(
      'Screen:Ctrl+S,Everywhere:F12,Everywhere:K'
    )
  })
})
