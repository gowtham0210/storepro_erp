import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Pencil, Plus, Save } from 'lucide-react'
import { useState } from 'react'
import type { PricingSettings, TaxClassSummary } from '@shared/ipc/contract'
import { formatMoney } from '@shared/money'
import { ROUNDING_STEPS } from '@shared/pricing'
import { pricingPolicySchema, taxClassInputSchema } from '@shared/schemas/pricing'
import { formatRate } from '@shared/tax'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  NumberInput,
  Select,
  Spinner,
  TextInput,
  useCurrency,
  useToast,
  type Column
} from '../components/ui'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'

/** "18%" → "18": a rate as the percentage field shows it. */
function percentText(rateBp: number): string {
  return formatRate(rateBp).replace('%', '')
}

function numberBinding(binding: ReturnType<ReturnType<typeof useForm>['field']>) {
  const { value, onChange, ...rest } = binding
  return { ...rest, value, onValueChange: (next: string) => onChange({ target: { value: next } }) }
}

const REGIME_TEXT: Record<PricingSettings['regime'], string> = {
  gst: 'GST is charged as CGST and SGST, each half the rate, plus any cess.',
  single: 'One sales tax is charged at each product’s rate.',
  none: 'The store isn’t registered for tax, so bills charge no tax. Rates are kept for when it is.'
}

/** M10-01: the tax rates products choose from. */
export function TaxRatesSection({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  const taxClasses = useIpcQuery('tax:list-classes')
  const settings = useIpcQuery('pricing:get-settings')
  const queryClient = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<TaxClassSummary | 'new' | null>(null)
  const reload = () => queryClient.invalidateQueries({ queryKey: ['tax:list-classes'] })

  const toggle = async (taxClass: TaxClassSummary): Promise<void> => {
    try {
      await invoke('tax:set-class-active', {
        taxClassId: taxClass.taxClassId,
        active: !taxClass.active
      })
      toast.success(`${taxClass.name} was ${taxClass.active ? 'archived' : 'restored'}.`)
      await reload()
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  const columns: Column<TaxClassSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (t) => (
        <span>
          {t.name} {!t.active && <Badge>Archived</Badge>}
        </span>
      )
    },
    { id: 'rate', header: 'Rate', align: 'right', cell: (t) => formatRate(t.rateBp) },
    {
      id: 'cess',
      header: 'Cess',
      align: 'right',
      cell: (t) => (t.cessRateBp === 0 ? '–' : formatRate(t.cessRateBp))
    },
    { id: 'products', header: 'Products', align: 'right', cell: (t) => t.productCount },
    ...(canEdit
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'right' as const,
            cell: (t: TaxClassSummary) => (
              <span className="inline-flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil />}
                  aria-label={`Edit ${t.name}`}
                  onClick={() => setEditing(t)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={t.active ? <Archive /> : <ArchiveRestore />}
                  aria-label={`${t.active ? 'Archive' : 'Restore'} ${t.name}`}
                  onClick={() => void toggle(t)}
                >
                  {t.active ? 'Archive' : 'Restore'}
                </Button>
              </span>
            )
          }
        ]
      : [])
  ]

  return (
    <Card
      title="Tax rates"
      actions={
        canEdit ? (
          <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>
            Add tax rate
          </Button>
        ) : undefined
      }
    >
      <p className="mb-2 text-fg-muted">
        Each product has one of these. A changed rate applies to the next bill; past bills keep the
        tax they charged.
      </p>
      {settings.data && (
        <p className="mb-4 text-sm text-fg-subtle">{REGIME_TEXT[settings.data.regime]}</p>
      )}
      {taxClasses.error ? (
        <Alert tone="danger">{describeError(taxClasses.error).message}</Alert>
      ) : (
        <DataTable
          caption="Tax rates"
          columns={columns}
          rows={taxClasses.data ?? []}
          getRowId={(t) => t.taxClassId}
          loading={taxClasses.isPending}
          density="compact"
        />
      )}
      {editing && (
        <TaxRateDialog
          taxClass={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </Card>
  )
}

function TaxRateDialog({
  taxClass,
  onClose,
  onSaved
}: {
  taxClass: TaxClassSummary | null
  onClose: () => void
  onSaved: () => Promise<unknown>
}): React.JSX.Element {
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    schema: taxClassInputSchema,
    initialValues: {
      name: taxClass?.name ?? '',
      rateBp: taxClass ? percentText(taxClass.rateBp) : '',
      cessRateBp: taxClass ? percentText(taxClass.cessRateBp) : '0'
    },
    onSubmit: async (values) => {
      setError(null)
      try {
        if (taxClass)
          await invoke('tax:update-class', { taxClassId: taxClass.taxClassId, ...values })
        else await invoke('tax:create-class', values)
        toast.success(`${values.name} was saved.`)
        await onSaved()
        onClose()
      } catch (failure) {
        if (!form.applyServerError(failure)) setError(describeError(failure).message)
      }
    }
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={taxClass ? `Edit ${taxClass.name}` : 'Add tax rate'}
      description={
        taxClass && taxClass.productCount > 0
          ? `${taxClass.productCount} products use this rate. A new rate applies to their next bill.`
          : undefined
      }
      closeOnBackdrop={false}
    >
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name" required hint="E.g. GST 18%" error={form.errors['name']}>
          <TextInput {...form.field('name')} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tax rate" required hint="GST in India" error={form.errors['rateBp']}>
            <NumberInput {...numberBinding(form.field('rateBp'))} decimals={2} suffix="%" />
          </Field>
          <Field label="Cess" hint="On top of GST, if any" error={form.errors['cessRateBp']}>
            <NumberInput {...numberBinding(form.field('cessRateBp'))} decimals={2} suffix="%" />
          </Field>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={<Save />} loading={form.submitting}>
            Save tax rate
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** M10-04, M10-05: bill rounding and how much a cashier may discount. */
export function PricingPolicySection({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  const settings = useIpcQuery('pricing:get-settings')
  return (
    <Card title="Rounding and discounts">
      <p className="mb-4 text-fg-muted">
        How bill totals are rounded, and the most a cashier can take off a bill without a manager’s
        approval.
      </p>
      {settings.error ? (
        <Alert tone="danger">{describeError(settings.error).message}</Alert>
      ) : !settings.data ? (
        <Spinner label="Loading" />
      ) : (
        <PolicyForm settings={settings.data} canEdit={canEdit} />
      )}
    </Card>
  )
}

function PolicyForm({
  settings,
  canEdit
}: {
  settings: PricingSettings
  canEdit: boolean
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const currency = useCurrency()
  const initial = {
    roundingMinor: String(settings.roundingMinor),
    maxDiscountBp: percentText(settings.maxDiscountBp)
  }
  const form = useForm({
    schema: pricingPolicySchema,
    initialValues: initial,
    onSubmit: async (policy) => {
      try {
        const saved = await invoke('pricing:update-policy', policy)
        queryClient.setQueryData(['pricing:get-settings'], saved)
        toast.success('Rounding and discounts saved.')
      } catch (failure) {
        if (!form.applyServerError(failure)) toast.error(describeError(failure).message)
      }
    }
  })
  const changed = JSON.stringify(form.values) !== JSON.stringify(initial)
  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(event)}>
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Rounding and discounts</legend>
        <Field
          label="Round bill totals"
          hint="The difference is printed as round-off."
          error={form.errors['roundingMinor']}
        >
          <Select
            {...form.field('roundingMinor')}
            options={ROUNDING_STEPS.map((step) => ({
              value: String(step),
              label: step === 1 ? 'Not rounded' : `To the nearest ${formatMoney(step, currency)}`
            }))}
          />
        </Field>
        <Field
          label="Discount limit"
          hint="Of a bill’s total before discounts. More needs a manager."
          error={form.errors['maxDiscountBp']}
        >
          <NumberInput {...numberBinding(form.field('maxDiscountBp'))} decimals={2} suffix="%" />
        </Field>
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
            Save rounding and discounts
          </Button>
        </div>
      )}
    </form>
  )
}
