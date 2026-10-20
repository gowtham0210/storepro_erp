import { useQuery } from '@tanstack/react-query'
import { UserPlus, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import type { CustomerSummary } from '@shared/ipc/contract'
import { Alert, Button, Dialog, Field, TextInput } from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { useSettled } from '../lib/useSettled'
import { useCan } from '../auth/permissions'
import { CustomerDialog } from './CustomerDialog'

export interface PickedCustomer {
  customerId: number
  name: string
}

/** M17-02: the customer on the bill, with a way to choose or clear one. Billing works without one. */
export function CustomerBar({
  customer,
  onChoose,
  onClear
}: {
  customer: PickedCustomer | null
  onChoose: () => void
  onClear: () => void
}): React.JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="Customer on this bill"
      role="group"
    >
      <UserRound aria-hidden className="size-5 text-fg-muted" />
      <span className="text-fg-muted">Customer:</span>
      <span className="font-medium">{customer ? customer.name : 'Walk-in customer'}</span>
      <Button size="sm" onClick={onChoose}>
        {customer ? 'Change customer' : 'Add customer'}
      </Button>
      {customer && (
        <Button
          size="sm"
          variant="ghost"
          icon={<X />}
          aria-label={`Remove ${customer.name} from this bill`}
          onClick={onClear}
        >
          Remove
        </Button>
      )}
    </div>
  )
}

/** M17-02: find a customer by name or phone, or add one without leaving the bill. */
export function CustomerPickerDialog({
  onPick,
  onClose
}: {
  onPick: (customer: PickedCustomer) => void
  onClose: () => void
}): React.JSX.Element {
  const canAdd = useCan()('customer.manage')
  const [text, setText] = useState('')
  const query = useSettled(text.trim())
  const [adding, setAdding] = useState(false)
  const results = useQuery({
    queryKey: ['customers:list', 'picker', query],
    queryFn: () => invoke('customers:list', { search: query, status: 'active', limit: 20 })
  })
  const items: CustomerSummary[] = results.data?.items ?? []

  return (
    <>
      <Dialog
        open={!adding}
        onClose={onClose}
        title="Choose a customer"
        description="Search by name or phone number. The bill can also go to a walk-in customer without one."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            {canAdd && (
              <Button icon={<UserPlus />} onClick={() => setAdding(true)}>
                Add new customer
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Search customers">
            <TextInput
              type="search"
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                const first = items[0]
                if (first) onPick({ customerId: first.customerId, name: first.name })
              }}
            />
          </Field>
          {results.error ? (
            <Alert tone="danger">{describeError(results.error).message}</Alert>
          ) : (
            <ul
              aria-label="Matching customers"
              className="max-h-64 divide-y divide-border-subtle overflow-auto rounded-md border border-border-subtle"
            >
              {items.length === 0 ? (
                <li className="px-3 py-2 text-sm text-fg-muted">
                  {results.isPending
                    ? 'Searching…'
                    : query
                      ? 'No customers match.'
                      : 'No customers yet.'}
                </li>
              ) : (
                items.map((c) => (
                  <li key={c.customerId}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted"
                      onClick={() => onPick({ customerId: c.customerId, name: c.name })}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-sm text-fg-muted">{c.phone ?? c.email ?? ''}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </Dialog>
      {adding && (
        <CustomerDialog
          onClose={() => setAdding(false)}
          onSaved={(saved) => onPick({ customerId: saved.customerId, name: saved.name })}
        />
      )}
    </>
  )
}
