import { useQueryClient } from '@tanstack/react-query'
import type { CustomerSummary } from '@shared/ipc/contract'
import { customerInputSchema } from '@shared/schemas/customers'
import { Alert, Button, Dialog, Field, TextArea, TextInput, useToast } from '../components/ui'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'

export async function refreshCustomers(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all(
    ['customers:list', 'customers:purchases'].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] })
    )
  )
}

/** M17-01: add a customer, or change one's details. Only the name is required. */
export function CustomerDialog({
  customer,
  onClose,
  onSaved
}: {
  customer?: CustomerSummary | undefined
  onClose: () => void
  onSaved?: ((saved: CustomerSummary) => void) | undefined
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const form = useForm({
    schema: customerInputSchema,
    initialValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      taxRegistrationNumber: customer?.taxRegistrationNumber ?? ''
    },
    onSubmit: async (values) => {
      try {
        const saved = customer
          ? await invoke('customers:update', { customerId: customer.customerId, ...values })
          : await invoke('customers:create', values)
        toast.success(`${saved.name} was ${customer ? 'updated' : 'added'}.`)
        await refreshCustomers(queryClient)
        onSaved?.(saved)
        onClose()
      } catch (failure) {
        if (!form.applyServerError(failure)) toast.error(describeError(failure).message)
      }
    }
  })
  const { errors } = form

  return (
    <Dialog
      open
      onClose={onClose}
      title={customer ? 'Edit customer' : 'Add customer'}
      description="Only the name is required. A phone number identifies one customer."
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={form.submitting}
            onClick={() => void form.handleSubmit()}
          >
            {customer ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {Object.keys(errors).length > 0 && (
          <Alert tone="danger">Check the highlighted fields and try again.</Alert>
        )}
        <Field label="Customer name" required error={errors.name}>
          <TextInput {...form.field('name')} maxLength={120} autoFocus />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Phone" error={errors.phone}>
            <TextInput {...form.field('phone')} type="tel" maxLength={30} />
          </Field>
          <Field label="Email" error={errors.email}>
            <TextInput {...form.field('email')} type="email" maxLength={120} />
          </Field>
        </div>
        <Field
          label="GSTIN or tax number"
          hint="For invoices to a business"
          error={errors.taxRegistrationNumber}
        >
          <TextInput {...form.field('taxRegistrationNumber')} maxLength={30} />
        </Field>
        <Field label="Address" error={errors.address}>
          <TextArea {...form.field('address')} rows={3} maxLength={300} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
