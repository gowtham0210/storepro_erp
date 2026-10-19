import { useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { type ReactNode } from 'react'
import type { z } from 'zod'
import { useCan } from '../auth/permissions'
import { Alert, Button, Card, PageHeader, useToast } from '../components/ui'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'
import {
  ReceiptFields,
  RegionalFields,
  StockFields,
  StoreDetailsFields,
  TaxFields,
  type StoreFormLike
} from '../setup/StoreFields'
import {
  detailsSchema,
  receiptSchema,
  regionalSchema,
  stockSchema,
  storeFormFrom,
  taxSchema,
  toProfileInput,
  type StoreFormValues
} from '../setup/storeForm'
import { useStore } from '../store/storeContext'

/**
 * M03-04, FR-002: the store's details, tax, receipts and stock policy. Each
 * section saves on its own, so changing the receipt footer can't undo an
 * unsaved address. Roles without `settings.edit` see the values read-only.
 */
export default function SettingsPage(): React.JSX.Element {
  const profile = useStore()
  const canEdit = useCan()('settings.edit')
  const options = useIpcQuery('setup:get-options')
  const current = storeFormFrom(profile)

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your store's details, tax and receipts. Changes apply to new bills; bills already printed keep what they showed."
      />
      {!canEdit && (
        <Alert tone="info" title="Read only">
          You can see the store settings, but only an administrator can change them.
        </Alert>
      )}
      <div className="mt-4 grid gap-6">
        <Section
          title="Store details"
          description="Printed at the top of every receipt."
          schema={detailsSchema}
          current={current}
          canEdit={canEdit}
        >
          {(form) => <StoreDetailsFields form={form} />}
        </Section>
        <Section
          title="Business and region"
          description="The currency can't change once the store has made a sale."
          schema={regionalSchema}
          current={current}
          canEdit={canEdit}
        >
          {(form) =>
            options.data ? (
              <RegionalFields form={form} options={options.data} />
            ) : (
              <p className="text-fg-muted">Loading…</p>
            )
          }
        </Section>
        <Section
          title="Tax"
          description="How GST appears on bills. Tax rates for products are set with each product."
          schema={taxSchema(current)}
          current={current}
          canEdit={canEdit}
        >
          {(form) => <TaxFields form={form} />}
        </Section>
        <Section
          title="Receipts"
          description="Invoice numbers continue from the last bill when the prefix changes."
          schema={receiptSchema}
          current={current}
          canEdit={canEdit}
        >
          {(form) => <ReceiptFields form={form} storeName={profile.name} />}
        </Section>
        <Section
          title="Stock"
          description="What billing does when the system shows an item as out of stock."
          schema={stockSchema}
          current={current}
          canEdit={canEdit}
        >
          {(form) => <StockFields form={form} />}
        </Section>
      </div>
    </>
  )
}

function Section<S extends z.ZodType<unknown, Record<string, unknown>>>({
  title,
  description,
  schema,
  current,
  canEdit,
  children
}: {
  title: string
  description: string
  schema: S
  current: StoreFormValues
  canEdit: boolean
  children: (form: StoreFormLike) => ReactNode
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const form = useForm({
    schema,
    initialValues: current as z.input<S>,
    onSubmit: async (): Promise<void> => {
      // This section's values on top of everything else as saved.
      const profile = toProfileInput({ ...current, ...(form.values as Partial<StoreFormValues>) })
      if (!profile.ok) {
        toast.error(Object.values(profile.errors)[0] ?? 'Check the details and try again.')
        return
      }
      try {
        const saved = await invoke('store:update', profile.input)
        queryClient.setQueryData(['store:get-profile'], saved)
        toast.success(`${title} saved.`)
      } catch (failure) {
        if (!form.applyServerError(failure)) toast.error(describeError(failure).message)
      }
    }
  })
  const changed = JSON.stringify({ ...current, ...form.values }) !== JSON.stringify(current)
  return (
    <Card title={title}>
      <p className="mb-4 text-fg-muted">{description}</p>
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)}>
        <fieldset disabled={!canEdit} className="contents">
          <legend className="sr-only">{title}</legend>
          {children(form as unknown as StoreFormLike)}
        </fieldset>
        {canEdit && (
          <div className="mt-5 flex items-center justify-end gap-3">
            {changed && <span className="text-sm text-fg-muted">Unsaved changes</span>}
            <Button
              type="submit"
              variant="primary"
              icon={<Save />}
              loading={form.submitting}
              disabled={!changed}
            >
              Save {title.toLowerCase()}
            </Button>
          </div>
        )}
      </form>
    </Card>
  )
}
