import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Check, Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import type { CategorySummary, UnitInfo } from '@shared/ipc/contract'
import { categoryName, unitCode, unitName } from '@shared/schemas/catalog'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  RadioGroup,
  TextInput,
  useToast,
  type Column
} from '../components/ui'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'

/** M09-01: product categories. Archived ones stay on their products. */
export function CategoriesDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const canManage = useCan()('product.manage')
  const categories = useIpcQuery('catalog:list-categories')
  const queryClient = useQueryClient()
  const toast = useToast()
  const [renaming, setRenaming] = useState<number | null>(null)
  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['catalog:list-categories'] }),
      queryClient.invalidateQueries({ queryKey: ['products:list'] })
    ])

  const add = useForm({
    schema: z.object({ name: categoryName }),
    initialValues: { name: '' },
    onSubmit: async ({ name }) => {
      try {
        await invoke('catalog:create-category', { name })
        toast.success(`${name} was added.`)
        add.reset()
        await reload()
      } catch (failure) {
        if (!add.applyServerError(failure)) toast.error(describeError(failure).message)
      }
    }
  })

  const toggle = async (category: CategorySummary): Promise<void> => {
    try {
      await invoke('catalog:set-category-active', {
        categoryId: category.categoryId,
        active: !category.active
      })
      toast.success(`${category.name} was ${category.active ? 'archived' : 'restored'}.`)
      await reload()
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  const columns: Column<CategorySummary>[] = [
    {
      id: 'name',
      header: 'Category',
      cell: (c) =>
        renaming === c.categoryId ? (
          <RenameCategory
            category={c}
            onDone={async () => {
              setRenaming(null)
              await reload()
            }}
          />
        ) : (
          <span>
            {c.name} {!c.active && <Badge>Archived</Badge>}
          </span>
        )
    },
    { id: 'count', header: 'Products', align: 'right', cell: (c) => c.productCount },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'right' as const,
            cell: (c: CategorySummary) =>
              renaming === c.categoryId ? null : (
                <span className="inline-flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil />}
                    aria-label={`Rename ${c.name}`}
                    onClick={() => setRenaming(c.categoryId)}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={c.active ? <Archive /> : <ArchiveRestore />}
                    aria-label={`${c.active ? 'Archive' : 'Restore'} ${c.name}`}
                    onClick={() => void toggle(c)}
                  >
                    {c.active ? 'Archive' : 'Restore'}
                  </Button>
                </span>
              )
          }
        ]
      : [])
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Categories"
      description="Group products for searching and reports. Archiving a category keeps it on its products."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {canManage && (
        <form
          noValidate
          onSubmit={(event) => void add.handleSubmit(event)}
          className="mb-4 flex items-end gap-3"
        >
          <Field label="New category" error={add.errors['name']} className="flex-1">
            <TextInput {...add.field('name')} autoFocus />
          </Field>
          <Button type="submit" icon={<Plus />} loading={add.submitting}>
            Add
          </Button>
        </form>
      )}
      {categories.error ? (
        <Alert tone="danger">{describeError(categories.error).message}</Alert>
      ) : (
        <DataTable
          caption="Categories"
          columns={columns}
          rows={categories.data ?? []}
          getRowId={(c) => c.categoryId}
          loading={categories.isPending}
          density="compact"
          empty={<p className="px-4 py-6 text-center text-fg-muted">No categories yet.</p>}
        />
      )}
    </Dialog>
  )
}

function RenameCategory({
  category,
  onDone
}: {
  category: CategorySummary
  onDone: () => Promise<unknown>
}): React.JSX.Element {
  const toast = useToast()
  const form = useForm({
    schema: z.object({ name: categoryName }),
    initialValues: { name: category.name },
    onSubmit: async ({ name }) => {
      try {
        await invoke('catalog:rename-category', { categoryId: category.categoryId, name })
        await onDone()
      } catch (failure) {
        if (!form.applyServerError(failure)) toast.error(describeError(failure).message)
      }
    }
  })
  return (
    <form
      noValidate
      onSubmit={(event) => void form.handleSubmit(event)}
      className="flex items-start gap-2"
    >
      <Field label={`New name for ${category.name}`} hideLabel error={form.errors['name']}>
        <TextInput {...form.field('name')} autoFocus />
      </Field>
      <Button type="submit" size="sm" icon={<Check />} loading={form.submitting}>
        Save
      </Button>
      <Button size="sm" variant="ghost" icon={<X />} onClick={() => void onDone()}>
        Cancel
      </Button>
    </form>
  )
}

/** M09-01: units of measure. Codes and fraction rules are fixed once created. */
export function UnitsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const canManage = useCan()('product.manage')
  const units = useIpcQuery('catalog:list-units')
  const queryClient = useQueryClient()
  const toast = useToast()
  const [renaming, setRenaming] = useState<string | null>(null)
  const reload = () => queryClient.invalidateQueries({ queryKey: ['catalog:list-units'] })

  const add = useForm({
    schema: z.object({
      unitCode,
      name: unitName,
      allowsFraction: z.enum(['yes', 'no']).transform((v) => v === 'yes')
    }),
    initialValues: { unitCode: '', name: '', allowsFraction: 'no' },
    onSubmit: async (unit) => {
      try {
        await invoke('catalog:create-unit', unit)
        toast.success(`${unit.name} was added.`)
        add.reset()
        await reload()
      } catch (failure) {
        if (!add.applyServerError(failure)) toast.error(describeError(failure).message)
      }
    }
  })

  const columns: Column<UnitInfo>[] = [
    { id: 'code', header: 'Code', cell: (u) => <span className="font-mono">{u.unitCode}</span> },
    {
      id: 'name',
      header: 'Name',
      cell: (u) =>
        renaming === u.unitCode ? (
          <RenameUnit
            unit={u}
            onDone={async () => {
              setRenaming(null)
              await reload()
            }}
          />
        ) : (
          u.name
        )
    },
    {
      id: 'fraction',
      header: 'Fractions',
      cell: (u) => (u.allowsFraction ? 'Yes, e.g. 1.25' : 'Whole numbers only')
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'right' as const,
            cell: (u: UnitInfo) =>
              renaming === u.unitCode ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil />}
                  aria-label={`Rename ${u.name}`}
                  onClick={() => setRenaming(u.unitCode)}
                >
                  Rename
                </Button>
              )
          }
        ]
      : [])
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Units"
      description="How items are measured. Units sold by weight or volume allow fractions, such as 1.25 kg."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {canManage && (
        <form
          noValidate
          onSubmit={(event) => void add.handleSubmit(event)}
          className="mb-4 grid gap-3 sm:grid-cols-[8rem_1fr]"
        >
          <Field label="Code" hint="E.g. tray" error={add.errors['unitCode']}>
            <TextInput {...add.field('unitCode')} spellCheck={false} />
          </Field>
          <Field label="Name" hint="E.g. Trays" error={add.errors['name']}>
            <TextInput {...add.field('name')} />
          </Field>
          <div className="sm:col-span-2">
            <RadioGroup
              legend="Quantities"
              name="allowsFraction"
              inline
              value={String(add.values.allowsFraction)}
              onChange={(value) => add.setValue('allowsFraction', value)}
              options={[
                { value: 'no', label: 'Whole numbers only' },
                { value: 'yes', label: 'Fractions allowed' }
              ]}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" icon={<Plus />} loading={add.submitting}>
              Add unit
            </Button>
          </div>
        </form>
      )}
      {units.error ? (
        <Alert tone="danger">{describeError(units.error).message}</Alert>
      ) : (
        <DataTable
          caption="Units"
          columns={columns}
          rows={units.data ?? []}
          getRowId={(u) => u.unitCode}
          loading={units.isPending}
          density="compact"
        />
      )}
    </Dialog>
  )
}

function RenameUnit({
  unit,
  onDone
}: {
  unit: UnitInfo
  onDone: () => Promise<unknown>
}): React.JSX.Element {
  const toast = useToast()
  const form = useForm({
    schema: z.object({ name: unitName }),
    initialValues: { name: unit.name },
    onSubmit: async ({ name }) => {
      try {
        await invoke('catalog:rename-unit', { unitCode: unit.unitCode, name })
        await onDone()
      } catch (failure) {
        if (!form.applyServerError(failure)) toast.error(describeError(failure).message)
      }
    }
  })
  return (
    <form
      noValidate
      onSubmit={(event) => void form.handleSubmit(event)}
      className="flex items-start gap-2"
    >
      <Field label={`New name for ${unit.name}`} hideLabel error={form.errors['name']}>
        <TextInput {...form.field('name')} autoFocus />
      </Field>
      <Button type="submit" size="sm" icon={<Check />} loading={form.submitting}>
        Save
      </Button>
      <Button size="sm" variant="ghost" icon={<X />} onClick={() => void onDone()}>
        Cancel
      </Button>
    </form>
  )
}
