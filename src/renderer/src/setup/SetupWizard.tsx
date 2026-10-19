import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Pencil, Store } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { z } from 'zod'
import type { SetupOptions } from '@shared/ipc/contract'
import { countryByCode, indianStateByCode } from '@shared/regions'
import { displayName, username } from '@shared/schemas/users'
import { PASSWORD_HINT, withConfirmedPassword } from '../auth/passwordFields'
import { useRefreshAuth } from '../auth/useAuth'
import { Alert, Button, Field, PasswordInput, Spinner, TextInput } from '../components/ui'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { cx } from '../lib/cx'
import { describeError, fieldErrorsFrom } from '../lib/describeError'
import {
  defaultStoreForm,
  detailsSchema,
  invoiceNumberPreview,
  receiptSchema,
  regionalSchema,
  taxSchema,
  toProfileInput,
  type StoreFormValues
} from './storeForm'
import {
  ReceiptFields,
  RegionalFields,
  StoreDetailsFields,
  TaxFields,
  type StoreFormLike
} from './StoreFields'

const accountSchema = withConfirmedPassword({ displayName, username })

interface AccountValues {
  displayName: string
  username: string
  password: string
  confirmPassword: string
}

type Draft = StoreFormValues & AccountValues

type StepId = 'store' | 'business' | 'tax' | 'receipt' | 'account' | 'review'

interface Step {
  id: StepId
  title: string
  description: string
  /** The fields this step edits, to send the main process's errors to the right step. */
  fields: readonly string[]
}

const STEPS: readonly Step[] = [
  {
    id: 'store',
    title: 'Store details',
    description: 'Printed on every receipt.',
    fields: [
      'name',
      'addressLine1',
      'addressLine2',
      'city',
      'countryCode',
      'regionCode',
      'postalCode',
      'phone',
      'email'
    ]
  },
  {
    id: 'business',
    title: 'Business and region',
    description: 'What you sell, the money you use, and your local time.',
    fields: ['businessTypeCode', 'currencyCode', 'timeZone']
  },
  {
    id: 'tax',
    title: 'Tax',
    description: 'You can change this later in Settings.',
    fields: ['gstRegistered', 'taxRegistrationNumber', 'pricesIncludeTax']
  },
  {
    id: 'receipt',
    title: 'Receipts',
    description: 'How bills are numbered and what they say.',
    fields: ['invoicePrefix', 'receiptHeader', 'receiptFooter']
  },
  {
    id: 'account',
    title: 'Your account',
    description:
      "You'll be the administrator: you add staff, change settings and approve sensitive actions.",
    fields: ['displayName', 'username', 'password', 'confirmPassword']
  },
  {
    id: 'review',
    title: 'Check and finish',
    description: 'Nothing is saved until you finish.',
    fields: []
  }
]

export interface SetupWizardProps {
  /**
   * 'new-store': first run, the store and its administrator.
   * 'store-only': the administrator exists already (data from before store setup).
   */
  mode: 'new-store' | 'store-only'
}

/**
 * First-run setup (M03-02, FR-001): a few short steps, each checked before
 * moving on, then a summary to check before anything is saved. Everything is
 * saved together in one request, so an interrupted setup leaves nothing
 * half-done. Works without internet access.
 */
export function SetupWizard({ mode }: SetupWizardProps): React.JSX.Element {
  const options = useIpcQuery('setup:get-options')
  const steps = STEPS.filter((step) => mode === 'new-store' || step.id !== 'account')
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState<Draft>(() => ({
    ...defaultStoreForm(),
    displayName: '',
    username: '',
    password: '',
    confirmPassword: ''
  }))
  const [stepErrors, setStepErrors] = useState<Record<string, string> | undefined>()
  const [error, setError] = useState<string | null>(null)
  const refreshAuth = useRefreshAuth()
  const queryClient = useQueryClient()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  useEffect(() => {
    document.title = `Set up StorePro · Step ${index + 1} of ${steps.length}`
    // Announce the new step and start reading from its heading (not on first load,
    // where the first field has focus).
    if (firstRender.current) firstRender.current = false
    else headingRef.current?.focus()
  }, [index, steps.length])

  const goTo = (id: StepId, errors?: Record<string, string>): void => {
    setStepErrors(errors)
    setIndex(steps.findIndex((s) => s.id === id))
  }
  const next = (values: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...values }))
    setStepErrors(undefined)
    setIndex((current) => Math.min(current + 1, steps.length - 1))
  }
  const back = (): void => {
    setStepErrors(undefined)
    setIndex((current) => Math.max(current - 1, 0))
  }

  /** Send the main process's (or the final check's) field errors back to their step. */
  const showErrors = (errors: Record<string, string>): void => {
    const plain = Object.fromEntries(
      Object.entries(errors).map(([path, message]) => [
        path.replace(/^(store|administrator)\./, ''),
        message
      ])
    )
    const target = steps.find((s) => s.fields.some((field) => field in plain))
    if (target) goTo(target.id, plain)
    else setError(Object.values(plain)[0] ?? 'Check the details and try again.')
  }

  const finish = async (): Promise<void> => {
    setError(null)
    const profile = toProfileInput(draft)
    if (!profile.ok) return showErrors(profile.errors)
    try {
      if (mode === 'new-store') {
        await invoke('setup:complete', {
          store: profile.input,
          administrator: {
            displayName: draft.displayName,
            username: draft.username,
            password: draft.password
          }
        })
        await refreshAuth({ forgetData: true })
      } else {
        await invoke('setup:complete-store', profile.input)
        await queryClient.invalidateQueries({ queryKey: ['store:get-profile'] })
      }
    } catch (failure) {
      const fields = fieldErrorsFrom(failure)
      if (fields && Object.keys(fields).length > 0) showErrors(fields)
      else setError(describeError(failure).message)
    }
  }

  const step = steps[index]
  if (!step) throw new Error(`No setup step ${index}`)

  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas px-4 py-8">
      <main className="w-full max-w-3xl">
        <p className="on-dark mb-6 inline-flex rounded-md bg-nav px-3 py-1.5 text-lg font-bold text-fg-inverse">
          StorePro
        </p>
        <div className="rounded-lg border border-divider bg-surface shadow-sm">
          <header className="border-b border-divider px-8 pt-7 pb-5">
            <h1 className="text-2xl font-semibold">
              {mode === 'new-store' ? 'Set up StorePro' : 'Finish setting up your store'}
            </h1>
            <p className="mt-1 text-fg-muted">
              {mode === 'new-store'
                ? 'A few details about your store, then you can start billing. It takes about two minutes and works offline.'
                : 'StorePro needs a few details about your store before billing can start.'}
            </p>
            <StepList steps={steps} current={index} />
          </header>
          <section aria-labelledby="setup-step-heading" className="px-8 py-6">
            <p className="text-sm font-medium text-fg-muted">
              Step {index + 1} of {steps.length}
            </p>
            <h2
              id="setup-step-heading"
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-semibold outline-none"
            >
              {step.title}
            </h2>
            <p className="mt-1 mb-5 text-fg-muted">{step.description}</p>
            {error && (
              <Alert tone="danger" title="Setup isn't finished">
                {error}
              </Alert>
            )}
            {!options.data ? (
              options.error ? (
                <Alert tone="danger">{describeError(options.error).message}</Alert>
              ) : (
                <Spinner label="Loading" />
              )
            ) : (
              <StepBody
                key={step.id}
                step={step.id}
                draft={draft}
                options={options.data}
                errors={stepErrors}
                isFirst={index === 0}
                onNext={next}
                onBack={back}
                onEdit={(id) => goTo(id)}
                onFinish={finish}
                mode={mode}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

function StepList({
  steps,
  current
}: {
  steps: readonly Step[]
  current: number
}): React.JSX.Element {
  return (
    <ol aria-label="Setup steps" className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {steps.map((step, i) => (
        <li
          key={step.id}
          aria-current={i === current ? 'step' : undefined}
          className={cx(
            'flex items-center gap-1.5',
            i === current ? 'font-semibold text-fg' : 'text-fg-muted'
          )}
        >
          <span
            aria-hidden
            className={cx(
              'flex size-5 items-center justify-center rounded-full border text-xs',
              i < current && 'border-success bg-success text-fg-inverse',
              i === current && 'border-2 border-accent text-accent',
              i > current && 'border-input'
            )}
          >
            {i < current ? <Check className="size-3" /> : i + 1}
          </span>
          {step.title}
          {i < current && <span className="sr-only">(done)</span>}
        </li>
      ))}
    </ol>
  )
}

interface StepBodyProps {
  step: StepId
  draft: Draft
  options: SetupOptions
  errors: Record<string, string> | undefined
  isFirst: boolean
  mode: SetupWizardProps['mode']
  onNext(values: Partial<Draft>): void
  onBack(): void
  onEdit(step: StepId): void
  onFinish(): Promise<void>
}

function StepBody(props: StepBodyProps): React.JSX.Element {
  const { step, draft, options } = props
  switch (step) {
    case 'store':
      return (
        <StepForm {...props} schema={detailsSchema}>
          {(form) => <StoreDetailsFields form={form} autoFocus countrySetsDefaults />}
        </StepForm>
      )
    case 'business':
      return (
        <StepForm {...props} schema={regionalSchema}>
          {(form) => <RegionalFields form={form} options={options} />}
        </StepForm>
      )
    case 'tax':
      return (
        <StepForm {...props} schema={taxSchema(draft)}>
          {(form) => <TaxFields form={form} />}
        </StepForm>
      )
    case 'receipt':
      return (
        <StepForm {...props} schema={receiptSchema}>
          {(form) => <ReceiptFields form={form} storeName={draft.name} />}
        </StepForm>
      )
    case 'account':
      return (
        <StepForm {...props} schema={accountSchema}>
          {(form) => <AccountFields form={form} />}
        </StepForm>
      )
    case 'review':
      return <Review {...props} />
  }
}

/** One step's form: its own schema, checked before moving on. */
function StepForm<S extends z.ZodType<unknown, Record<string, unknown>>>({
  schema,
  draft,
  errors,
  isFirst,
  onNext,
  onBack,
  children
}: StepBodyProps & { schema: S; children: (form: StoreFormLike) => ReactNode }): React.JSX.Element {
  const form = useForm({
    schema,
    initialValues: draft as z.input<S>,
    ...(errors ? { initialErrors: errors } : {}),
    // Keep everything the form holds: the country step also picks a currency and time zone.
    onSubmit: (): void => onNext(form.values as Partial<Draft>)
  })
  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(event)}>
      {children(form as unknown as StoreFormLike)}
      <StepButtons isFirst={isFirst} onBack={onBack}>
        <Button type="submit" variant="primary" icon={<ArrowRight />}>
          Continue
        </Button>
      </StepButtons>
    </form>
  )
}

function StepButtons({
  isFirst,
  onBack,
  children
}: {
  isFirst: boolean
  onBack(): void
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="mt-8 flex justify-between gap-3 border-t border-divider pt-5">
      {isFirst ? (
        <span />
      ) : (
        <Button icon={<ArrowLeft />} onClick={onBack}>
          Back
        </Button>
      )}
      {children}
    </div>
  )
}

function AccountFields({ form }: { form: StoreFormLike }): React.JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Your name"
        required
        hint="Shown on screen and in the audit log."
        error={form.errors['displayName']}
      >
        <TextInput {...form.field('displayName')} autoComplete="name" autoFocus />
      </Field>
      <Field
        label="Username"
        required
        hint="What you type to sign in. Letters, numbers, dots, dashes and underscores."
        error={form.errors['username']}
      >
        <TextInput {...form.field('username')} autoComplete="username" spellCheck={false} />
      </Field>
      <Field label="Password" required hint={PASSWORD_HINT} error={form.errors['password']}>
        <PasswordInput {...form.field('password')} autoComplete="new-password" />
      </Field>
      <Field label="Confirm password" required error={form.errors['confirmPassword']}>
        <PasswordInput {...form.field('confirmPassword')} autoComplete="new-password" />
      </Field>
    </div>
  )
}

/** Everything entered, by step, with a way back to each. */
function Review({
  draft,
  options,
  mode,
  onEdit,
  onBack,
  onFinish
}: StepBodyProps): React.JSX.Element {
  const [finishing, setFinishing] = useState(false)
  const india = draft.countryCode === 'IN'
  const currency = options.currencies.find((c) => c.currencyCode === draft.currencyCode)
  const businessType = options.businessTypes.find(
    (t) => t.businessTypeCode === draft.businessTypeCode
  )
  const region = india ? indianStateByCode(draft.regionCode)?.name : draft.regionCode
  const address = [
    draft.addressLine1,
    draft.addressLine2,
    draft.city,
    region,
    draft.postalCode,
    countryByCode(draft.countryCode)?.name
  ]
    .filter(Boolean)
    .join(', ')
  const sections: { step: StepId; rows: [string, string][] }[] = [
    {
      step: 'store',
      rows: [
        ['Store name', draft.name],
        ['Address', address],
        ['Phone', draft.phone],
        ['Email', draft.email || 'None']
      ]
    },
    {
      step: 'business',
      rows: [
        ['Business type', businessType?.name ?? draft.businessTypeCode],
        ['Currency', currency ? `${currency.name} (${currency.symbol})` : draft.currencyCode],
        ['Time zone', draft.timeZone.replaceAll('_', ' ')]
      ]
    },
    {
      step: 'tax',
      rows: [
        [
          india ? 'GST' : 'Tax',
          draft.gstRegistered === 'yes'
            ? `Registered: ${draft.taxRegistrationNumber.trim().toUpperCase()}`
            : 'Not registered'
        ],
        ['Prices', draft.pricesIncludeTax === 'yes' ? 'Include tax' : 'Tax added at billing']
      ]
    },
    {
      step: 'receipt',
      rows: [
        ['First invoice', invoiceNumberPreview(draft.invoicePrefix)],
        ['Message at the top', draft.receiptHeader.trim() || 'None'],
        ['Message at the bottom', draft.receiptFooter.trim() || 'None']
      ]
    },
    ...(mode === 'new-store'
      ? [
          {
            step: 'account' as const,
            rows: [['Administrator', `${draft.displayName} (${draft.username})`]] as [
              string,
              string
            ][]
          }
        ]
      : [])
  ]
  return (
    <div>
      <div className="grid gap-4">
        {sections.map((section) => {
          const title = STEPS.find((s) => s.id === section.step)?.title ?? ''
          return (
            <section
              key={section.step}
              aria-label={title}
              className="rounded-md border border-divider p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-semibold">{title}</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil />}
                  aria-label={`Change ${title.toLowerCase()}`}
                  onClick={() => onEdit(section.step)}
                >
                  Change
                </Button>
              </div>
              <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_1fr]">
                {section.rows.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-fg-muted">{label}</dt>
                    <dd className="break-words whitespace-pre-line">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>
      <StepButtons isFirst={false} onBack={onBack}>
        <Button
          variant="primary"
          icon={<Store />}
          loading={finishing}
          onClick={() => {
            setFinishing(true)
            void onFinish().finally(() => setFinishing(false))
          }}
        >
          Finish setup
        </Button>
      </StepButtons>
    </div>
  )
}
