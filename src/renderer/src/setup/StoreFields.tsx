import type { SetupOptions } from '@shared/ipc/contract'
import { COUNTRIES, countryByCode, INDIAN_STATES } from '@shared/regions'
import { INVOICE_PREFIX_MAX } from '@shared/schemas/store'
import { canonicalTimeZone, timeZoneOffsetMs } from '@shared/storeTime'
import { Field, RadioGroup, Select, TextArea, TextInput, type SelectOption } from '../components/ui'
import type { FieldBinding } from '../forms/useForm'
import { invoiceNumberPreview } from './storeForm'

/** What the field groups need from a form made with useForm(). */
export interface StoreFormLike {
  values: Record<string, unknown>
  errors: Record<string, string>
  field(name: string): FieldBinding
  setValue(name: string, value: unknown): void
}

function value(form: StoreFormLike, name: string): string {
  return String(form.values[name] ?? '')
}

function formatOffset(ms: number): string {
  const sign = ms < 0 ? '−' : '+'
  const minutes = Math.abs(ms) / 60_000
  return `UTC${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

let timeZones: SelectOption[] | null = null

/** Every time zone this computer knows, labelled with its current UTC offset. */
function timeZoneOptions(current: string): SelectOption[] {
  // Current names only ("Asia/Kolkata", not "Asia/Calcutta"), each once, in order.
  timeZones ??= [...new Set(Intl.supportedValuesOf('timeZone').map(canonicalTimeZone))]
    .sort()
    .map((zone) => ({
      value: zone,
      label: `${zone.replaceAll('_', ' ')} (${formatOffset(timeZoneOffsetMs(Date.now(), zone))})`
    }))
  return timeZones.some((option) => option.value === current) || current === ''
    ? timeZones
    : [{ value: current, label: current }, ...timeZones]
}

/** Name, address and contact details (FR-001). */
export function StoreDetailsFields({
  form,
  autoFocus = false,
  countrySetsDefaults = false
}: {
  form: StoreFormLike
  autoFocus?: boolean
  /** In setup, choosing a country also picks its currency and time zone. Never in Settings. */
  countrySetsDefaults?: boolean
}): React.JSX.Element {
  const india = value(form, 'countryCode') === 'IN'
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Store name"
        required
        hint="As printed at the top of receipts."
        error={form.errors['name']}
        className="sm:col-span-2"
      >
        <TextInput {...form.field('name')} autoComplete="organization" autoFocus={autoFocus} />
      </Field>
      <Field label="Country" required error={form.errors['countryCode']}>
        <Select
          {...form.field('countryCode')}
          onChange={(event) => {
            const country = countryByCode(event.target.value)
            form.setValue('countryCode', event.target.value)
            form.setValue('regionCode', '')
            if (country && countrySetsDefaults) {
              form.setValue('currencyCode', country.currencyCode)
              form.setValue('timeZone', country.defaultTimeZone)
            }
          }}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
        />
      </Field>
      <Field label="Phone number" required error={form.errors['phone']}>
        <TextInput {...form.field('phone')} type="tel" autoComplete="tel" />
      </Field>
      <Field
        label="Street address"
        required
        error={form.errors['addressLine1']}
        className="sm:col-span-2"
      >
        <TextInput {...form.field('addressLine1')} autoComplete="address-line1" />
      </Field>
      <Field label="Address line 2" error={form.errors['addressLine2']} className="sm:col-span-2">
        <TextInput {...form.field('addressLine2')} autoComplete="address-line2" />
      </Field>
      <Field label="City or town" required error={form.errors['city']}>
        <TextInput {...form.field('city')} autoComplete="address-level2" />
      </Field>
      {india ? (
        <Field
          label="State"
          required
          hint="Decides how GST is split on bills."
          error={form.errors['regionCode']}
        >
          <Select
            {...form.field('regionCode')}
            placeholder="Choose the state"
            options={INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }))}
          />
        </Field>
      ) : (
        <Field label="State or region" error={form.errors['regionCode']}>
          <TextInput {...form.field('regionCode')} autoComplete="address-level1" />
        </Field>
      )}
      <Field
        label={india ? 'PIN code' : 'Postal code'}
        required={india}
        error={form.errors['postalCode']}
      >
        <TextInput
          {...form.field('postalCode')}
          inputMode={india ? 'numeric' : undefined}
          autoComplete="postal-code"
        />
      </Field>
      <Field
        label="Email"
        hint="Optional. Printed on receipts if given."
        error={form.errors['email']}
      >
        <TextInput {...form.field('email')} type="email" autoComplete="email" />
      </Field>
    </div>
  )
}

/** Business type, currency and time zone. */
export function RegionalFields({
  form,
  options,
  currencyLocked = false
}: {
  form: StoreFormLike
  options: SetupOptions
  /** After the first sale the currency can't change. */
  currencyLocked?: boolean
}): React.JSX.Element {
  return (
    <div className="grid gap-4">
      <RadioGroup
        legend="What kind of store is it?"
        name="businessTypeCode"
        value={value(form, 'businessTypeCode')}
        onChange={(code) => form.setValue('businessTypeCode', code)}
        error={form.errors['businessTypeCode']}
        options={options.businessTypes.map((type) => ({
          value: type.businessTypeCode,
          label: type.name,
          disabled: !type.available,
          description: type.available ? undefined : 'Coming in a later version'
        }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Currency"
          required
          hint={currencyLocked ? "Can't change after the first sale." : undefined}
          error={form.errors['currencyCode']}
        >
          <Select
            {...form.field('currencyCode')}
            disabled={currencyLocked}
            options={options.currencies.map((c) => ({
              value: c.currencyCode,
              label: `${c.name} (${c.symbol})`
            }))}
          />
        </Field>
        <Field
          label="Time zone"
          required
          hint="Decides which day a late-night sale belongs to."
          error={form.errors['timeZone']}
        >
          <Select {...form.field('timeZone')} options={timeZoneOptions(value(form, 'timeZone'))} />
        </Field>
      </div>
    </div>
  )
}

/** GST registration and how prices are entered (FR-001 "tax configuration"). */
export function TaxFields({ form }: { form: StoreFormLike }): React.JSX.Element {
  const india = value(form, 'countryCode') === 'IN'
  const registered = value(form, 'gstRegistered') === 'yes'
  return (
    <div className="grid gap-5">
      <RadioGroup
        legend={india ? 'Is the store registered for GST?' : 'Is the store registered for tax?'}
        name="gstRegistered"
        value={value(form, 'gstRegistered')}
        onChange={(answer) => form.setValue('gstRegistered', answer)}
        error={form.errors['gstRegistered']}
        inline
        options={[
          {
            value: 'yes',
            label: 'Yes',
            description: india ? 'Bills show GST and the GSTIN' : undefined
          },
          { value: 'no', label: 'No', description: 'Bills show no tax' }
        ]}
      />
      {registered && (
        <Field
          label={india ? 'GSTIN' : 'Tax registration number'}
          required
          hint={india ? '15 characters, e.g. 27AAPFU0939F1ZV. Printed on every bill.' : undefined}
          error={form.errors['taxRegistrationNumber']}
        >
          <TextInput
            {...form.field('taxRegistrationNumber')}
            autoCapitalize="characters"
            maxLength={30}
            className="uppercase"
          />
        </Field>
      )}
      <RadioGroup
        legend="Do the prices you enter include tax?"
        name="pricesIncludeTax"
        value={value(form, 'pricesIncludeTax')}
        onChange={(answer) => form.setValue('pricesIncludeTax', answer)}
        options={[
          {
            value: 'yes',
            label: 'Yes, prices include tax',
            description: 'Like MRP: the price on the shelf is what the customer pays.'
          },
          {
            value: 'no',
            label: 'No, tax is added at billing',
            description: 'The bill adds tax on top of each price.'
          }
        ]}
      />
    </div>
  )
}

/** Invoice numbers and the receipt's own text, with a preview. */
export function ReceiptFields({
  form,
  storeName
}: {
  form: StoreFormLike
  storeName: string
}): React.JSX.Element {
  const header = value(form, 'receiptHeader').trim()
  const footer = value(form, 'receiptFooter').trim()
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
      <div className="grid content-start gap-4">
        <Field
          label="Invoice number prefix"
          required
          hint={`Up to ${INVOICE_PREFIX_MAX} letters or numbers. The first bill will be ${invoiceNumberPreview(value(form, 'invoicePrefix'))}.`}
          error={form.errors['invoicePrefix']}
        >
          <TextInput
            {...form.field('invoicePrefix')}
            maxLength={INVOICE_PREFIX_MAX}
            className="uppercase"
          />
        </Field>
        <Field
          label="Message at the top"
          hint="Optional, e.g. opening hours."
          error={form.errors['receiptHeader']}
        >
          <TextArea {...form.field('receiptHeader')} rows={2} maxLength={300} />
        </Field>
        <Field
          label="Message at the bottom"
          hint="Optional, e.g. “Thank you! Visit again.” or your return policy."
          error={form.errors['receiptFooter']}
        >
          <TextArea {...form.field('receiptFooter')} rows={3} maxLength={300} />
        </Field>
      </div>
      <figure aria-label="Receipt preview" className="self-start">
        <div className="rounded-md border border-input bg-surface p-4 font-mono text-xs leading-relaxed text-fg shadow-sm">
          <p className="text-center font-bold">{storeName || 'Your store'}</p>
          {header && <p className="text-center whitespace-pre-line">{header}</p>}
          <p className="mt-2 border-t border-dashed border-input pt-2">
            Bill: {invoiceNumberPreview(value(form, 'invoicePrefix'))}
          </p>
          <p className="text-fg-muted">… items and totals …</p>
          {footer && (
            <p className="mt-2 border-t border-dashed border-input pt-2 text-center whitespace-pre-line">
              {footer}
            </p>
          )}
        </div>
        <figcaption className="mt-2 text-center text-sm text-fg-muted">Preview</figcaption>
      </figure>
    </div>
  )
}

/** What happens at billing when the system thinks an item is out of stock. */
export function StockFields({ form }: { form: StoreFormLike }): React.JSX.Element {
  return (
    <RadioGroup
      legend="When an item's stock reaches zero"
      name="allowNegativeStock"
      value={value(form, 'allowNegativeStock')}
      onChange={(answer) => form.setValue('allowNegativeStock', answer)}
      hint="Stock counts can lag behind the shelf, for example when a delivery hasn't been entered yet."
      options={[
        {
          value: 'no',
          label: 'Stop the sale',
          description: 'The cashier can only bill what the system shows in stock.'
        },
        {
          value: 'yes',
          label: 'Allow the sale',
          description: 'Stock goes below zero until the delivery or a stock count corrects it.'
        }
      ]}
    />
  )
}
