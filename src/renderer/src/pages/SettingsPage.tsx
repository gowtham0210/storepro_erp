import { useQueryClient } from '@tanstack/react-query'
import { Power, PowerOff, Save } from 'lucide-react'
import { type ReactNode } from 'react'
import type { z } from 'zod'
import { useCan } from '../auth/permissions'
import type { ModuleState } from '@shared/ipc/contract'
import {
  Alert,
  Badge,
  Button,
  Card,
  PageHeader,
  Spinner,
  useConfirm,
  useToast
} from '../components/ui'
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
import { PricingPolicySection, TaxRatesSection } from '../pricing/PricingSettings'
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
        <TaxRatesSection canEdit={canEdit} />
        <PricingPolicySection canEdit={canEdit} />
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
        <ModulesSection canEdit={canEdit} />
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

/** M04: the store's modules. Switching one off hides its screens; its data stays. */
function ModulesSection({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  const modules = useIpcQuery('modules:list')
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()

  const toggle = async (module: ModuleState): Promise<void> => {
    if (module.enabled) {
      const ok = await confirm({
        title: `Switch ${module.name} off?`,
        description: `Its screens will be hidden from everyone. Nothing is deleted: switching it back on brings everything back as it was.`,
        confirmLabel: 'Switch off'
      })
      if (!ok) return
    }
    try {
      const updated = await invoke('modules:set-enabled', {
        code: module.code,
        enabled: !module.enabled
      })
      queryClient.setQueryData(['modules:list'], updated)
      // The store profile carries the enabled modules that navigation uses.
      await queryClient.invalidateQueries({ queryKey: ['store:get-profile'] })
      toast.success(`${module.name} is switched ${module.enabled ? 'off' : 'on'}.`)
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  return (
    <Card title="Modules">
      <p className="mb-4 text-fg-muted">
        Features for your kind of store, on top of billing, stock and reports, which every store
        has.
      </p>
      {modules.error ? (
        <Alert tone="danger">{describeError(modules.error).message}</Alert>
      ) : !modules.data ? (
        <Spinner label="Loading modules" />
      ) : (
        <ul className="divide-y divide-divider rounded-md border border-divider">
          {modules.data.map((module) => (
            <li key={module.code} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{module.name}</span>
                  {module.enabled ? (
                    <Badge tone="success">On</Badge>
                  ) : module.availability === 'planned' ? (
                    <Badge>
                      {module.plannedFor ? `Coming in ${module.plannedFor}` : 'Coming later'}
                    </Badge>
                  ) : (
                    <Badge>Off</Badge>
                  )}
                </div>
                <p className="text-fg-muted">{module.description}</p>
                {module.locked && module.availability !== 'planned' && (
                  <p className="mt-1 text-sm text-fg-subtle">{module.locked}</p>
                )}
              </div>
              {canEdit && module.locked === null && (
                <Button
                  size="sm"
                  icon={module.enabled ? <PowerOff /> : <Power />}
                  aria-label={`${module.enabled ? 'Switch off' : 'Switch on'} ${module.name}`}
                  onClick={() => void toggle(module)}
                >
                  {module.enabled ? 'Switch off' : 'Switch on'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
