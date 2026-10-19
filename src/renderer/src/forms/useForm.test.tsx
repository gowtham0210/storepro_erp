import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AppError } from '@shared/ipc/errors'
import { money, requiredText } from '@shared/validation'
import { Field } from '../components/ui/Field'
import { TextInput } from '../components/ui/TextInput'
import { useForm } from './useForm'

const schema = z.object({
  name: requiredText('the product name'),
  price: money('the selling price')
})

function ProductForm({
  onSubmit
}: {
  onSubmit: (values: z.output<typeof schema>) => Promise<void> | void
}) {
  const form = useForm({
    schema,
    initialValues: { name: '', price: '' },
    onSubmit: (v) => onSubmit(v)
  })
  return (
    <form noValidate onSubmit={(e) => void form.handleSubmit(e)}>
      <Field label="Name" error={form.errors['name']}>
        <TextInput {...form.field('name')} />
      </Field>
      <Field label="Price" error={form.errors['price']}>
        <TextInput {...form.field('price')} />
      </Field>
      <button type="submit">Save</button>
      <button
        type="button"
        onClick={() =>
          form.applyServerError(
            new AppError('VALIDATION_FAILED', 'invalid', [
              { path: 'price', message: 'Price is above MRP' }
            ])
          )
        }
      >
        Server error
      </button>
    </form>
  )
}

describe('useForm', () => {
  it('validates on submit, shows field errors and focuses the first problem', async () => {
    const onSubmit = vi.fn()
    render(<ProductForm onSubmit={onSubmit} />)
    await userEvent.click(screen.getByText('Save'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Enter the product name')).toBeTruthy()
    expect(screen.getByText('Enter the selling price')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  })

  it('focuses the first invalid field on screen, whatever order the code binds fields in', async () => {
    function OutOfOrder() {
      const form = useForm({ schema, initialValues: { name: '', price: '' }, onSubmit: vi.fn() })
      const price = form.field('price') // bound before name, rendered after it
      return (
        <form noValidate onSubmit={(e) => void form.handleSubmit(e)}>
          <TextInput aria-label="Name" {...form.field('name')} />
          <TextInput aria-label="Price" {...price} />
          <button type="submit">Save</button>
        </form>
      )
    }
    render(<OutOfOrder />)
    await userEvent.click(screen.getByText('Save'))
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  })

  it('checks a field when leaving it, and clears the error as soon as it is fixed', async () => {
    render(<ProductForm onSubmit={vi.fn()} />)
    const price = screen.getByLabelText('Price')
    await userEvent.type(price, '12.345')
    fireEvent.blur(price)
    expect(screen.getByText('Enter the selling price as an amount, e.g. 12.50')).toBeTruthy()
    await userEvent.type(price, '{Backspace}')
    expect(screen.queryByText(/as an amount/)).toBeNull()
  })

  it('submits the parsed domain values from the shared schema', async () => {
    const onSubmit = vi.fn()
    render(<ProductForm onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Name'), '  Toor Dal ')
    await userEvent.type(screen.getByLabelText('Price'), '165.50')
    await userEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Toor Dal', price: 16550 }))
  })

  it('puts server-side validation errors on the matching field', async () => {
    render(<ProductForm onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByText('Server error'))
    expect(screen.getByText('Price is above MRP')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Price'))
  })
})
