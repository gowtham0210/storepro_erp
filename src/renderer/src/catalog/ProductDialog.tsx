import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, History, PackagePlus, Pencil, Plus, Save } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import type { ProductDetail, VariantDetail } from '@shared/ipc/contract'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Money,
  Quantity,
  Spinner,
  useConfirm,
  useToast,
  type Column
} from '../components/ui'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'
import { useStore } from '../store/storeContext'
import { ProductFields, VariantFields, type FormLike } from './ProductFields'
import {
  emptyProductForm,
  emptyVariantForm,
  productFormFrom,
  productFormSchema,
  variantFormFrom,
  variantFormSchema,
  withoutVariantPrefix
} from './productForm'

/** Every query that shows products; refreshed after any change. */
export async function refreshProducts(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all(
    [
      'products:list',
      'products:get',
      'catalog:list-categories',
      'tax:list-classes',
      'inventory:list'
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))
  )
}

function useReferenceData() {
  const categories = useIpcQuery('catalog:list-categories')
  const taxClasses = useIpcQuery('tax:list-classes')
  const units = useIpcQuery('catalog:list-units')
  const error = categories.error ?? taxClasses.error ?? units.error
  const ready = categories.data && taxClasses.data && units.data
  return {
    error,
    data: ready
      ? { categories: categories.data, taxClasses: taxClasses.data, units: units.data }
      : null
  }
}

/** M09-06: a new product with its first pack size, in one form. */
export function NewProductDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (product: ProductDetail) => void
}): React.JSX.Element {
  const reference = useReferenceData()
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Add product"
      description="You can add more pack sizes, such as 500 g and 1 kg, after saving."
      closeOnBackdrop={false}
    >
      {reference.error ? (
        <Alert tone="danger">{describeError(reference.error).message}</Alert>
      ) : !reference.data ? (
        <Spinner label="Loading" />
      ) : (
        <NewProductForm {...reference.data} onClose={onClose} onCreated={onCreated} />
      )}
    </Dialog>
  )
}

function NewProductForm({
  categories,
  taxClasses,
  units,
  onClose,
  onCreated
}: NonNullable<ReturnType<typeof useReferenceData>['data']> & {
  onClose: () => void
  onCreated: (product: ProductDetail) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { minorUnits } = useStore().currency
  const [error, setError] = useState<string | null>(null)
  const schema = z.intersection(productFormSchema, variantFormSchema(minorUnits, units))
  const defaultTax = taxClasses.find((t) => t.active)?.taxClassId
  const form = useForm({
    schema,
    initialValues: { ...emptyProductForm(defaultTax), ...emptyVariantForm() },
    onSubmit: async (values) => {
      setError(null)
      const { name, categoryId, taxClassId, hsnCode, tracksInventory, ...variant } = values
      try {
        const product = await invoke('products:create', {
          name,
          categoryId,
          taxClassId,
          hsnCode,
          tracksInventory,
          variants: [variant]
        })
        toast.success(`${product.name} was added.`)
        await refreshProducts(queryClient)
        onCreated(product)
      } catch (failure) {
        if (!form.applyServerError(withoutVariantPrefix(failure)))
          setError(describeError(failure).message)
      }
    }
  })
  const formLike = form as unknown as FormLike
  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      <section aria-labelledby="new-product-details" className="space-y-3">
        <h3 id="new-product-details" className="font-semibold">
          Product
        </h3>
        <ProductFields form={formLike} categories={categories} taxClasses={taxClasses} />
      </section>
      <section aria-labelledby="new-product-price" className="space-y-3">
        <h3 id="new-product-price" className="font-semibold">
          Price and codes
        </h3>
        <VariantFields form={formLike} units={units} />
      </section>
      <div className="flex justify-end gap-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" icon={<Plus />} loading={form.submitting}>
          Add product
        </Button>
      </div>
    </form>
  )
}

/** A product's details and pack sizes. Read-only without `product.manage`. */
export function ProductDialog({
  productId,
  onClose
}: {
  productId: number
  onClose: () => void
}): React.JSX.Element {
  const product = useIpcQuery('products:get', { productId })
  const reference = useReferenceData()
  const error = product.error ?? reference.error
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={product.data ? product.data.name : 'Product'}
      closeOnBackdrop={false}
    >
      {error ? (
        <Alert tone="danger">{describeError(error).message}</Alert>
      ) : !product.data || !reference.data ? (
        <Spinner label="Loading" />
      ) : (
        <ProductEditor product={product.data} {...reference.data} onClose={onClose} />
      )}
    </Dialog>
  )
}

type VariantDialogState = { kind: 'add' } | { kind: 'edit'; variant: VariantDetail } | null

function ProductEditor({
  product,
  categories,
  taxClasses,
  units,
  onClose
}: NonNullable<ReturnType<typeof useReferenceData>['data']> & {
  product: ProductDetail
  onClose: () => void
}): React.JSX.Element {
  const can = useCan()
  const canManage = can('product.manage')
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [variantDialog, setVariantDialog] = useState<VariantDialogState>(null)
  const initial = productFormFrom(product)
  const form = useForm({
    schema: productFormSchema,
    initialValues: initial,
    onSubmit: async (values) => {
      setError(null)
      try {
        await invoke('products:update', { productId: product.productId, ...values })
        toast.success(`${values.name} was saved.`)
        await refreshProducts(queryClient)
      } catch (failure) {
        if (!form.applyServerError(failure)) setError(describeError(failure).message)
      }
    }
  })
  const changed = JSON.stringify(form.values) !== JSON.stringify(initial)

  const run = async (action: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await action()
      toast.success(done)
      await refreshProducts(queryClient)
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  const toggleProduct = async (): Promise<void> => {
    if (product.active) {
      const ok = await confirm({
        title: `Archive ${product.name}?`,
        description:
          "It won't be offered for billing or purchases any more. Past bills and stock history keep it, and you can restore it later.",
        confirmLabel: 'Archive',
        tone: 'danger'
      })
      if (!ok) return
    }
    await run(
      () =>
        invoke('products:set-active', { productId: product.productId, active: !product.active }),
      `${product.name} was ${product.active ? 'archived' : 'restored'}.`
    )
  }

  const toggleVariant = async (variant: VariantDetail): Promise<void> =>
    run(
      () =>
        invoke('products:set-variant-active', {
          variantId: variant.variantId,
          active: !variant.active
        }),
      `${variant.variantName ?? product.name} was ${variant.active ? 'archived' : 'restored'}.`
    )

  const unitName = (code: string) => units.find((u) => u.unitCode === code)?.unitCode ?? code
  const columns: Column<VariantDetail>[] = [
    {
      id: 'size',
      header: 'Pack size',
      cell: (v) => (
        <div>
          <span className="font-medium">{v.variantName ?? 'Standard'}</span>
          {!v.active && (
            <>
              {' '}
              <Badge>Archived</Badge>
            </>
          )}
          <div className="text-sm text-fg-muted">
            {v.sku}
            {v.barcodes.length > 0 && ` · ${v.barcodes.join(', ')}`}
          </div>
        </div>
      )
    },
    {
      id: 'price',
      header: 'Price',
      align: 'right',
      cell: (v) => (
        <div>
          <Money minor={v.sellingPriceMinor} />
          <span className="text-fg-muted"> / {unitName(v.unitCode)}</span>
          {v.mrpMinor !== null && (
            <div className="text-sm text-fg-muted">
              MRP <Money minor={v.mrpMinor} />
            </div>
          )}
        </div>
      )
    },
    {
      id: 'stock',
      header: 'In stock',
      align: 'right',
      cell: (v) =>
        v.onHandMilli === null ? (
          <span className="text-fg-muted">Not tracked</span>
        ) : (
          <Quantity milli={v.onHandMilli} unit={v.unitCode} />
        )
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'right' as const,
            cell: (v: VariantDetail) => (
              <span className="inline-flex flex-wrap justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil />}
                  aria-label={`Edit ${v.variantName ?? 'pack size'}`}
                  onClick={() => setVariantDialog({ kind: 'edit', variant: v })}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={v.active ? <Archive /> : <ArchiveRestore />}
                  aria-label={`${v.active ? 'Archive' : 'Restore'} ${v.variantName ?? 'pack size'}`}
                  onClick={() => void toggleVariant(v)}
                >
                  {v.active ? 'Archive' : 'Restore'}
                </Button>
              </span>
            )
          }
        ]
      : [])
  ]

  return (
    <div className="space-y-6">
      {!product.active && (
        <Alert tone="warning" title="Archived">
          This product can't be billed or bought. Restore it to sell it again.
        </Alert>
      )}
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <fieldset disabled={!canManage} className="contents">
          <legend className="sr-only">Product details</legend>
          <ProductFields
            form={form as unknown as FormLike}
            categories={categories}
            taxClasses={taxClasses}
            current={product}
          />
        </fieldset>
        {canManage && (
          <div className="flex items-center justify-end gap-3">
            {changed && <span className="text-sm text-fg-muted">Unsaved changes</span>}
            <Button
              type="submit"
              variant="primary"
              icon={<Save />}
              loading={form.submitting}
              disabled={!changed}
            >
              Save product
            </Button>
          </div>
        )}
      </form>
      <section aria-labelledby="pack-sizes" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="pack-sizes" className="font-semibold">
            Pack sizes and prices
          </h3>
          {canManage && (
            <Button
              size="sm"
              icon={<PackagePlus />}
              onClick={() => setVariantDialog({ kind: 'add' })}
            >
              Add pack size
            </Button>
          )}
        </div>
        <DataTable
          caption={`Pack sizes of ${product.name}`}
          columns={columns}
          rows={product.variants}
          getRowId={(v) => v.variantId}
          density="compact"
        />
      </section>
      <div className="flex flex-wrap justify-between gap-3 border-t border-divider pt-4">
        <span className="flex gap-2">
          {can('audit.view') && (
            <Button
              variant="ghost"
              icon={<History />}
              onClick={() => void navigate(`/audit?entity=product:${product.productId}`)}
            >
              History
            </Button>
          )}
          {canManage && (
            <Button
              variant="ghost"
              icon={product.active ? <Archive /> : <ArchiveRestore />}
              onClick={() => void toggleProduct()}
            >
              {product.active ? 'Archive product' : 'Restore product'}
            </Button>
          )}
        </span>
        <Button onClick={onClose}>Close</Button>
      </div>
      {variantDialog && (
        <VariantDialog
          product={product}
          variant={variantDialog.kind === 'edit' ? variantDialog.variant : null}
          units={units}
          onClose={() => setVariantDialog(null)}
        />
      )}
    </div>
  )
}

/** M09-04, M09-09: add a pack size, or change one, including its prices. */
function VariantDialog({
  product,
  variant,
  units,
  onClose
}: {
  product: ProductDetail
  variant: VariantDetail | null
  units: Parameters<typeof variantFormSchema>[1]
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { minorUnits } = useStore().currency
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    schema: variantFormSchema(minorUnits, units),
    initialValues: variant ? variantFormFrom(variant, minorUnits) : emptyVariantForm(),
    onSubmit: async (values) => {
      setError(null)
      try {
        if (variant)
          await invoke('products:update-variant', { variantId: variant.variantId, ...values })
        else await invoke('products:add-variant', { productId: product.productId, ...values })
        toast.success(variant ? 'Pack size saved.' : 'Pack size added.')
        await refreshProducts(queryClient)
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
      size="lg"
      title={
        variant
          ? `Edit ${variant.variantName ?? product.name}`
          : `Add a pack size of ${product.name}`
      }
      description={
        variant
          ? 'New prices apply to the next bill. Bills already made keep their prices.'
          : undefined
      }
      closeOnBackdrop={false}
    >
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <VariantFields
          form={form as unknown as FormLike}
          units={units}
          unitLocked={variant?.hasHistory ?? false}
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={<Save />} loading={form.submitting}>
            {variant ? 'Save pack size' : 'Add pack size'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
