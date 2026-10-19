import { Ban, PackagePlus, Printer, ScanBarcode, Search, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { z } from 'zod'
import { AppError, ERROR_CODES } from '@shared/ipc/errors'
import { money, quantity, requiredText } from '@shared/validation'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Kbd,
  Money,
  NumberInput,
  PageHeader,
  Quantity,
  Select,
  Spinner,
  TextInput,
  TotalDisplay,
  useConfirm,
  useToast,
  type Column,
  type SortState
} from '../../components/ui'
import { useForm } from '../../forms/useForm'
import { describeError } from '../../lib/describeError'
import { ShortcutScope, useShortcut } from '../../shortcuts/ShortcutProvider'

/**
 * Every design-system component in one place, for design review and manual
 * accessibility checks. Development builds only.
 */
export default function ComponentGallery(): React.JSX.Element {
  return (
    <ShortcutScope name="Component gallery">
      <PageHeader
        title="Components"
        description="The StorePro design system. Development builds only."
        actions={<Badge tone="info">M23</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <ButtonsSection />
        <FeedbackSection />
        <FormSection />
        <TotalsSection />
        <TableSection />
        <DialogSection />
        <ErrorCopySection />
      </div>
    </ShortcutScope>
  )
}

function Row({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

function ButtonsSection(): React.JSX.Element {
  const [loading, setLoading] = useState(false)
  return (
    <Card title="Buttons">
      <div className="space-y-4">
        <Row>
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon={<Trash2 />}>
            Delete
          </Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row>
          <Button size="sm">Small</Button>
          <Button>Medium</Button>
          <Button size="lg" variant="primary" shortcut="F12">
            Pay
          </Button>
          <Button aria-label="Print receipt" icon={<Printer />} />
        </Row>
        <Row>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true)
              setTimeout(() => setLoading(false), 1500)
            }}
          >
            Save with loading state
          </Button>
          <span className="text-fg-muted">
            Hints: <Kbd>F2</Kbd> <Kbd>Ctrl+S</Kbd> <Kbd>Esc</Kbd>
          </span>
        </Row>
      </div>
    </Card>
  )
}

function FeedbackSection(): React.JSX.Element {
  const toast = useToast()
  return (
    <Card title="Feedback">
      <div className="space-y-4">
        <Row>
          <Badge tone="success">Paid</Badge>
          <Badge tone="warning">Low stock</Badge>
          <Badge tone="danger">Voided</Badge>
          <Badge tone="info">Held</Badge>
          <Badge>Draft</Badge>
          <Spinner label="Loading products" />
        </Row>
        <Alert tone="success" title="Backup complete">
          Saved to D:\StorePro backups at 6:02 pm.
        </Alert>
        <Alert
          tone="warning"
          title="Printer not found"
          action={<Button size="sm">Choose printer</Button>}
        >
          The bill was saved. Connect the printer to print it.
        </Alert>
        <Alert tone="danger" title="Couldn't save the purchase">
          Some quantities are missing. Fill them in and try again.
        </Alert>
        <Row>
          <Button size="sm" onClick={() => toast.success('Bill INV-000123 saved and printed.')}>
            Success toast
          </Button>
          <Button size="sm" onClick={() => toast.info('3 items are below their reorder level.')}>
            Info toast
          </Button>
          <Button size="sm" onClick={() => toast.warning('Printer is low on paper.')}>
            Warning toast
          </Button>
          <Button
            size="sm"
            onClick={() =>
              toast.error('The receipt printer is not responding. The bill was saved.', {
                title: "Couldn't print"
              })
            }
          >
            Error toast
          </Button>
        </Row>
      </div>
    </Card>
  )
}

/** A demo form using the same shared validation helpers the main process uses. */
const demoProductSchema = z.object({
  name: requiredText('the product name', 120),
  category: z.string().min(1, 'Choose a category'),
  price: money('the selling price'),
  openingStock: quantity('the opening stock', { allowsFraction: true })
})

function FormSection(): React.JSX.Element {
  const toast = useToast()
  const form = useForm({
    schema: demoProductSchema,
    initialValues: { name: '', category: '', price: '', openingStock: '1' },
    onSubmit: async (product) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      if (product.name.toLowerCase() === 'duplicate') {
        // What a VALIDATION_FAILED response from the main process looks like.
        form.applyServerError(
          new AppError('VALIDATION_FAILED', 'invalid', [
            { path: 'name', message: 'A product with this name exists' }
          ])
        )
        return
      }
      toast.success(`${product.name} added at ₹${(product.price / 100).toFixed(2)}.`)
      form.reset()
    }
  })
  useShortcut('Ctrl+Enter', () => void form.handleSubmit(), {
    description: 'Save the demo product'
  })

  const { ref: priceRef, value: price, name: priceName, onBlur: priceBlur } = form.field('price')
  const {
    ref: stockRef,
    value: stock,
    name: stockName,
    onBlur: stockBlur
  } = form.field('openingStock')

  return (
    <Card title="Form (shared Zod schema)">
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        <Field
          label="Product name"
          required
          error={form.errors['name']}
          hint='Type "duplicate" to see a server error.'
        >
          <TextInput {...form.field('name')} autoComplete="off" />
        </Field>
        <Field label="Category" required error={form.errors['category']}>
          <Select
            {...form.field('category')}
            placeholder="Choose a category"
            options={[
              { value: 'staples', label: 'Staples' },
              { value: 'snacks', label: 'Snacks' },
              { value: 'household', label: 'Household' }
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Selling price" required error={form.errors['price']}>
            <NumberInput
              ref={priceRef}
              name={priceName}
              value={price}
              onBlur={priceBlur}
              onValueChange={(value) => form.setValue('price', value)}
              decimals={2}
              prefix="₹"
            />
          </Field>
          <Field
            label="Opening stock"
            error={form.errors['openingStock']}
            hint="Arrow keys change it by 1."
          >
            <NumberInput
              ref={stockRef}
              name={stockName}
              value={stock}
              onBlur={stockBlur}
              onValueChange={(value) => form.setValue('openingStock', value)}
              decimals={3}
              step={1}
              min={0}
              suffix="kg"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-3">
          <Button onClick={form.reset}>Clear</Button>
          <Button
            type="submit"
            variant="primary"
            icon={<PackagePlus />}
            loading={form.submitting}
            shortcut="Ctrl+Enter"
          >
            Add product
          </Button>
        </div>
      </form>
    </Card>
  )
}

function TotalsSection(): React.JSX.Element {
  return (
    <Card title="Billing totals">
      <div className="space-y-4">
        <TotalDisplay
          label="Total to pay"
          minor={123456}
          breakdown={[
            { label: 'Subtotal', minor: 129956 },
            { label: 'Discount', minor: -6500 },
            { label: 'GST (included)', minor: 5879 }
          ]}
        />
        <p className="text-fg-muted">
          Quantities: <Quantity milli={1250} unit="kg" />, <Quantity milli={3000} unit="pcs" />.
          Amounts: <Money minor={4550} />, <Money minor={12345678} />.
        </p>
      </div>
    </Card>
  )
}

interface DemoItem {
  id: number
  name: string
  sku: string
  stockMilli: number
  priceMinor: number
  low: boolean
}

const DEMO_ITEMS: DemoItem[] = [
  {
    id: 1,
    name: 'Sona Masoori Rice (loose)',
    sku: 'RICE-LOOSE',
    stockMilli: 82_500,
    priceMinor: 6000,
    low: false
  },
  {
    id: 2,
    name: 'Toor Dal 1 kg',
    sku: 'DAL-TOOR-1',
    stockMilli: 4000,
    priceMinor: 16500,
    low: true
  },
  {
    id: 3,
    name: 'Neem Soap 100 g',
    sku: 'SOAP-100',
    stockMilli: 36_000,
    priceMinor: 4500,
    low: false
  },
  {
    id: 4,
    name: 'Groundnut Oil 1 L',
    sku: 'OIL-GN-1',
    stockMilli: 2000,
    priceMinor: 21000,
    low: true
  }
]

function TableSection(): React.JSX.Element {
  const [sort, setSort] = useState<SortState | null>({ columnId: 'name', direction: 'ascending' })
  const [selected, setSelected] = useState<DemoItem | null>(null)
  const [loading, setLoading] = useState(false)
  const rows = [...DEMO_ITEMS].sort((a, b) => {
    if (!sort) return 0
    const dir = sort.direction === 'ascending' ? 1 : -1
    if (sort.columnId === 'price') return (a.priceMinor - b.priceMinor) * dir
    return a.name.localeCompare(b.name) * dir
  })
  const columns: Column<DemoItem>[] = [
    { id: 'name', header: 'Product', sortable: true, cell: (row) => row.name },
    { id: 'sku', header: 'SKU', cell: (row) => <span className="text-fg-muted">{row.sku}</span> },
    {
      id: 'stock',
      header: 'Stock',
      align: 'right',
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          {row.low && <Badge tone="warning">Low</Badge>}
          <Quantity milli={row.stockMilli} />
        </span>
      )
    },
    {
      id: 'price',
      header: 'Price',
      align: 'right',
      sortable: true,
      cell: (row) => <Money minor={row.priceMinor} />
    }
  ]
  return (
    <Card
      title="Data table"
      flush
      actions={
        <Button size="sm" onClick={() => setLoading((value) => !value)}>
          {loading ? 'Show rows' : 'Show loading'}
        </Button>
      }
    >
      <div className="space-y-4 p-5">
        <p className="text-fg-muted">
          Tab into the table, then use ↑ ↓ Home End, and Enter to open a row.
        </p>
        <DataTable
          caption="Demo products"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
          onRowActivate={setSelected}
          loading={loading}
        />
        <DataTable
          caption="Empty demo"
          columns={columns}
          rows={[]}
          getRowId={(row) => row.id}
          density="compact"
          empty={
            <EmptyState
              icon={<Search />}
              title="No products match “xyz”"
              description="Check the spelling, or search by SKU or barcode."
            />
          }
        />
      </div>
      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        description={selected?.sku}
        footer={
          <Button variant="primary" onClick={() => setSelected(null)} autoFocus>
            Done
          </Button>
        }
      >
        {selected && (
          <dl className="grid grid-cols-2 gap-2">
            <dt className="text-fg-muted">Price</dt>
            <dd>
              <Money minor={selected.priceMinor} />
            </dd>
            <dt className="text-fg-muted">Stock</dt>
            <dd>
              <Quantity milli={selected.stockMilli} />
            </dd>
          </dl>
        )}
      </Dialog>
    </Card>
  )
}

function DialogSection(): React.JSX.Element {
  const confirm = useConfirm()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [barcode, setBarcode] = useState('')
  return (
    <Card title="Dialogs">
      <Row>
        <Button icon={<ScanBarcode />} onClick={() => setOpen(true)}>
          Open dialog
        </Button>
        <Button
          variant="danger"
          icon={<Ban />}
          onClick={async () => {
            const ok = await confirm({
              title: 'Void bill INV-000123?',
              description:
                'The ₹1,234.56 sale is cancelled and its 5 items go back into stock. This cannot be undone.',
              confirmLabel: 'Void bill',
              tone: 'danger'
            })
            if (ok) toast.success('Bill INV-000123 voided.')
          }}
        >
          Void bill (confirm)
        </Button>
      </Row>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add item by barcode"
        description="Scan or type the barcode."
        closeOnBackdrop={false}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false)
                toast.info(`Looked up ${barcode || 'nothing'}.`)
              }}
            >
              Add item
            </Button>
          </>
        }
      >
        <Field label="Barcode">
          <TextInput
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            autoFocus
            inputMode="numeric"
          />
        </Field>
      </Dialog>
    </Card>
  )
}

function ErrorCopySection(): React.JSX.Element {
  return (
    <Card title="Error messages">
      <div className="space-y-3">
        {ERROR_CODES.map((code) => {
          const { title, message } = describeError(new AppError(code, 'internal detail'))
          return (
            <Alert key={code} tone="danger" title={title}>
              {message} <span className="text-sm opacity-80">({code})</span>
            </Alert>
          )
        })}
      </div>
    </Card>
  )
}
