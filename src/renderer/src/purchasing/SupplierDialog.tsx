import { useQueryClient } from '@tanstack/react-query'
import type { SupplierSummary } from '@shared/ipc/contract'
import { supplierInputSchema } from '@shared/schemas/purchasing'
import { Alert, Button, Dialog, Field, TextArea, TextInput, useToast } from '../components/ui'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'

export async function refreshSuppliers(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all(
    ['suppliers:list', 'purchases:list-orders', 'purchases:list-receipts'].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] })
    )
  )
}

/** M15-01: add a supplier, or change one's details. */
export function SupplierDialog({
  supplier,
  onClose,
  onSaved
}: {
  supplier?: SupplierSummary | undefined
  onClose: () => void
  /** Called with the saved supplier, e.g. to choose it on a purchase form. */
  onSaved?: ((saved: SupplierSummary) => void) | undefined
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const form = useForm({
    schema: supplierInputSchema,
    initialValues: {
      name: supplier?.name ?? '',
      contactPerson: supplier?.contactPerson ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
      address: supplier?.address ?? '',
      taxRegistrationNumber: supplier?.taxRegistrationNumber ?? ''
    },
    onSubmit: async (values) => {
      try {
        const saved = supplier
          ? await invoke('suppliers:update', { supplierId: supplier.supplierId, ...values })
          : await invoke('suppliers:create', values)
        toast.success(`${saved.name} was ${supplier ? 'updated' : 'added'}.`)
        await refreshSuppliers(queryClient)
        onSaved?.(saved)
        onClose()
      } catch (failure) {
        if (!form.applyServerError(failure)) toast.error(describeError(failure).message)
      }
    }
  })
  const { errors } = form
  const formError = Object.keys(errors).length > 0

  return (
    <Dialog
      open
      onClose={onClose}
      title={supplier ? 'Edit supplier' : 'Add supplier'}
      description="The people you buy stock from. Only the name is required."
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={form.submitting}
            onClick={() => void form.handleSubmit()}
          >
            {supplier ? 'Save changes' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {formError && <Alert tone="danger">Check the highlighted fields and try again.</Alert>}
        <Field label="Supplier name" required error={errors.name}>
          <TextInput {...form.field('name')} maxLength={120} autoFocus />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Contact person" error={errors.contactPerson}>
            <TextInput {...form.field('contactPerson')} maxLength={80} />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <TextInput {...form.field('phone')} type="tel" maxLength={30} />
          </Field>
          <Field label="Email" error={errors.email}>
            <TextInput {...form.field('email')} type="email" maxLength={120} />
          </Field>
          <Field
            label="GSTIN or tax number"
            hint="Printed on their bills"
            error={errors.taxRegistrationNumber}
          >
            <TextInput {...form.field('taxRegistrationNumber')} maxLength={30} />
          </Field>
        </div>
        <Field label="Address" error={errors.address}>
          <TextArea {...form.field('address')} rows={3} maxLength={300} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
