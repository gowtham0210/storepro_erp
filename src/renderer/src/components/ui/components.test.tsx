import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ShortcutProvider } from '../../shortcuts/ShortcutProvider'
import { Button } from './Button'
import { ConfirmProvider, useConfirm, type ConfirmOptions } from './ConfirmDialog'
import { DataTable, type Column } from './DataTable'
import { Field } from './Field'
import { Money, TotalDisplay } from './Money'
import { NumberInput, sanitizeNumberText, stepValue } from './NumberInput'
import { TextInput } from './TextInput'
import { ToastProvider, useToast } from './Toast'

describe('Button', () => {
  it('names icon-only buttons and exposes shortcuts', () => {
    render(<Button aria-label="Print receipt" icon={<svg />} shortcut="F9" />)
    const button = screen.getByRole('button', { name: /Print receipt/ })
    expect(button.getAttribute('aria-keyshortcuts')).toBe('F9')
  })

  it('blocks repeat clicks while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Pay
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Pay' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Field', () => {
  it('wires label, hint and error to the control', () => {
    render(
      <Field label="Selling price" hint="Including GST" error="Enter the selling price" required>
        <TextInput />
      </Field>
    )
    const input = screen.getByLabelText(/Selling price/)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-required')).toBe('true')
    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['Including GST', 'Enter the selling price'])
  })
})

describe('NumberInput', () => {
  it('only accepts characters that can form a valid number', () => {
    expect(sanitizeNumberText('12.5', 2, false)).toBe('12.5')
    expect(sanitizeNumberText('1,250.50', 2, false)).toBe('1250.50')
    expect(sanitizeNumberText('12.505', 2, false)).toBeNull()
    expect(sanitizeNumberText('12a', 2, false)).toBeNull()
    expect(sanitizeNumberText('-3', 0, false)).toBeNull()
    expect(sanitizeNumberText('-3', 0, true)).toBe('-3')
  })

  it('steps without float noise and keeps whole numbers whole', () => {
    expect(stepValue('10', 1, 0, undefined)).toBe('11')
    expect(stepValue('0.1', 0.2, 3, undefined)).toBe('0.3')
    expect(stepValue('2.5', 1, 3, undefined)).toBe('3.5')
    expect(stepValue('0', -1, 0, 0)).toBe('0')
  })

  it('ignores invalid keystrokes and supports arrow keys', async () => {
    function Harness() {
      const [value, setValue] = useState('1')
      return (
        <NumberInput
          aria-label="Qty"
          value={value}
          onValueChange={setValue}
          decimals={3}
          step={1}
        />
      )
    }
    render(<Harness />)
    const input = screen.getByLabelText('Qty') as HTMLInputElement
    await userEvent.type(input, 'x')
    expect(input.value).toBe('1')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('2')
  })
})

describe('Money', () => {
  it('formats rupees with Indian grouping and aligned digits', () => {
    render(<Money minor={12345678} />)
    expect(screen.getByText('₹1,23,456.78').className).toContain('tabular')
  })

  it('labels the total region', () => {
    render(<TotalDisplay label="Total to pay" minor={50000} />)
    expect(screen.getByRole('region', { name: 'Total to pay' }).textContent).toContain('₹500.00')
  })
})

describe('Toasts', () => {
  function Trigger({ fire }: { fire: (t: ReturnType<typeof useToast>) => void }) {
    const toast = useToast()
    return <button onClick={() => fire(toast)}>Fire</button>
  }

  it('announces errors assertively and keeps them until dismissed', async () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger fire={(t) => t.error('Printer not responding')} />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Fire'))
    expect(screen.getByRole('alert').textContent).toContain('Printer not responding')
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('alert').textContent).toContain('Printer not responding')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.getByRole('alert').textContent).toBe('')
    vi.useRealTimers()
  })

  it('dismisses success messages on their own', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger fire={(t) => t.success('Bill saved')} />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Fire'))
    expect(screen.getByRole('status').textContent).toContain('Bill saved')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('status').textContent).toBe('')
    vi.useRealTimers()
  })
})

describe('ConfirmDialog', () => {
  function Harness({
    options,
    onResult
  }: {
    options: ConfirmOptions
    onResult: (ok: boolean) => void
  }) {
    const confirm = useConfirm()
    return <button onClick={async () => onResult(await confirm(options))}>Ask</button>
  }

  function setup(tone: 'danger' | 'default') {
    const onResult = vi.fn()
    render(
      <ShortcutProvider>
        <ConfirmProvider>
          <Harness
            onResult={onResult}
            options={{
              title: 'Void bill?',
              description: 'Stock goes back.',
              confirmLabel: 'Void bill',
              tone
            }}
          />
        </ConfirmProvider>
      </ShortcutProvider>
    )
    fireEvent.click(screen.getByText('Ask'))
    return onResult
  }

  it('puts focus on Cancel for destructive actions', () => {
    setup('danger')
    expect(document.activeElement?.textContent).toBe('Cancel')
    expect(screen.getByRole('button', { name: 'Void bill' })).toBeTruthy()
  })

  it('resolves true on confirm and false on cancel', async () => {
    const onResult = setup('danger')
    await userEvent.click(screen.getByRole('button', { name: 'Void bill' }))
    expect(onResult).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByText('Ask'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onResult).toHaveBeenLastCalledWith(false)
  })
})

describe('DataTable', () => {
  interface Row {
    id: number
    name: string
  }
  const columns: Column<Row>[] = [
    { id: 'name', header: 'Name', sortable: true, cell: (r) => r.name }
  ]
  const rows = [
    { id: 1, name: 'Rice' },
    { id: 2, name: 'Dal' },
    { id: 3, name: 'Oil' }
  ]

  it('moves between rows with the arrow keys and activates with Enter', () => {
    const onRowActivate = vi.fn()
    render(
      <DataTable
        caption="Items"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onRowActivate={onRowActivate}
      />
    )
    const [first, second] = screen.getAllByRole('row').slice(1)
    expect(first?.tabIndex).toBe(0)
    expect(second?.tabIndex).toBe(-1)
    first?.focus()
    fireEvent.keyDown(first!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second!, { key: 'Enter' })
    expect(onRowActivate).toHaveBeenCalledWith(rows[1])
  })

  it('announces sort state on the header', () => {
    render(
      <DataTable
        caption="Items"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={{ columnId: 'name', direction: 'descending' }}
        onSortChange={() => {}}
      />
    )
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('descending')
  })

  it('shows the empty state and a skeleton while loading', () => {
    const { rerender } = render(
      <DataTable
        caption="Items"
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        empty={<p>No items yet</p>}
      />
    )
    expect(screen.getByText('No items yet')).toBeTruthy()
    rerender(
      <DataTable caption="Items" columns={columns} rows={[]} getRowId={(r) => r.id} loading />
    )
    expect(screen.getByRole('status').textContent).toBe('Loading')
  })
})
