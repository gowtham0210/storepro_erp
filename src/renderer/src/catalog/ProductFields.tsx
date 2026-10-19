import type { CategorySummary, TaxClassSummary, UnitInfo } from '@shared/ipc/contract'
import { formatRate } from '@shared/tax'
import { Field, NumberInput, RadioGroup, Select, TextArea, TextInput } from '../components/ui'
import type { FieldBinding } from '../forms/useForm'
import { useStore } from '../store/storeContext'

/** The parts of useForm the fields need, whatever the form's schema. */
export interface FormLike {
  values: Record<string, unknown>
  errors: Record<string, string>
  field: (name: string) => FieldBinding
  setValue: (name: string, value: unknown) => void
}

function numberField(form: FormLike, name: string) {
  const { value, onChange, ...rest } = form.field(name)
  return { ...rest, value, onValueChange: (next: string) => onChange({ target: { value: next } }) }
}

export function taxClassLabel(taxClass: TaxClassSummary): string {
  const rate = formatRate(taxClass.rateBp)
  const cess = taxClass.cessRateBp > 0 ? ` + ${formatRate(taxClass.cessRateBp)} cess` : ''
  return taxClass.name.includes(rate) && !cess ? taxClass.name : `${taxClass.name} (${rate}${cess})`
}

/** What applies to every pack size of the product. */
export function ProductFields({
  form,
  categories,
  taxClasses,
  current
}: {
  form: FormLike
  categories: readonly CategorySummary[]
  taxClasses: readonly TaxClassSummary[]
  /** The product's saved category and tax class, offered even if archived. */
  current?: { categoryId: number | null; taxClassId: number }
}): React.JSX.Element {
  const categoryOptions = categories
    .filter((c) => c.active || c.categoryId === current?.categoryId)
    .map((c) => ({
      value: String(c.categoryId),
      label: c.active ? c.name : `${c.name} (archived)`
    }))
  const taxOptions = taxClasses
    .filter((t) => t.active || t.taxClassId === current?.taxClassId)
    .map((t) => ({
      value: String(t.taxClassId),
      label: t.active ? taxClassLabel(t) : `${taxClassLabel(t)} (archived)`
    }))
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Product name" required error={form.errors['name']} className="sm:col-span-2">
        <TextInput {...form.field('name')} autoFocus />
      </Field>
      <Field label="Category" error={form.errors['categoryId']}>
        <Select {...form.field('categoryId')} placeholder="No category" options={categoryOptions} />
      </Field>
      <Field
        label="Tax rate"
        required
        hint="GST charged on this product."
        error={form.errors['taxClassId']}
      >
        <Select
          {...form.field('taxClassId')}
          placeholder="Choose a tax rate"
          options={taxOptions}
        />
      </Field>
      <Field
        label="HSN code"
        hint="4, 6 or 8 digits, printed on GST invoices."
        error={form.errors['hsnCode']}
      >
        <TextInput {...form.field('hsnCode')} inputMode="numeric" spellCheck={false} />
      </Field>
      <RadioGroup
        legend="Stock"
        name="tracksInventory"
        inline
        value={String(form.values['tracksInventory'] ?? 'yes')}
        onChange={(answer) => form.setValue('tracksInventory', answer)}
        error={form.errors['tracksInventory']}
        options={[
          { value: 'yes', label: 'Track stock' },
          { value: 'no', label: "Don't track", description: 'Services, carry bags' }
        ]}
      />
    </div>
  )
}

/** One pack size: its unit, prices, codes and low-stock level. */
export function VariantFields({
  form,
  units,
  unitLocked,
  showName = true
}: {
  form: FormLike
  units: readonly UnitInfo[]
  /** The item has history, so its unit can't change. */
  unitLocked?: boolean
  showName?: boolean
}): React.JSX.Element {
  const { symbol, minorUnits: decimals } = useStore().currency
  const unit = units.find((u) => u.unitCode === form.values['unitCode'])
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showName && (
        <Field
          label="Pack size"
          hint="E.g. 500 g or 1 kg. Leave empty if the product has only one."
          error={form.errors['variantName']}
        >
          <TextInput {...form.field('variantName')} />
        </Field>
      )}
      <Field
        label="Unit"
        required
        hint={unitLocked ? "Can't change after the item has been sold or stocked." : undefined}
        error={form.errors['unitCode']}
      >
        <Select
          {...form.field('unitCode')}
          disabled={unitLocked}
          options={units.map((u) => ({
            value: u.unitCode,
            label: `${u.name} (${u.unitCode})${u.allowsFraction ? ', sold in fractions' : ''}`
          }))}
        />
      </Field>
      <Field
        label="Selling price"
        required
        hint={unit ? `Per ${unit.unitCode}.` : undefined}
        error={form.errors['sellingPriceMinor']}
      >
        <NumberInput
          {...numberField(form, 'sellingPriceMinor')}
          decimals={decimals}
          prefix={symbol}
        />
      </Field>
      <Field
        label="MRP"
        hint="Printed maximum retail price, if any."
        error={form.errors['mrpMinor']}
      >
        <NumberInput {...numberField(form, 'mrpMinor')} decimals={decimals} prefix={symbol} />
      </Field>
      <Field
        label="Cost price"
        hint="What you pay the supplier, for margins."
        error={form.errors['costPriceMinor']}
      >
        <NumberInput {...numberField(form, 'costPriceMinor')} decimals={decimals} prefix={symbol} />
      </Field>
      <Field
        label="Low-stock level"
        hint="Listed as low on stock at or below this."
        error={form.errors['reorderLevelMilli']}
      >
        <NumberInput
          {...numberField(form, 'reorderLevelMilli')}
          decimals={unit?.allowsFraction ? 3 : 0}
          {...(unit ? { suffix: unit.unitCode } : {})}
        />
      </Field>
      <Field
        label="Barcodes"
        hint="Scan or type each one; separate several with commas."
        error={form.errors['barcodes']}
        className="sm:col-span-2"
      >
        <TextArea {...form.field('barcodes')} rows={2} spellCheck={false} />
      </Field>
      <Field
        label="SKU"
        hint="Your own item code. Leave empty and StorePro assigns one."
        error={form.errors['sku']}
      >
        <TextInput {...form.field('sku')} spellCheck={false} />
      </Field>
    </div>
  )
}
