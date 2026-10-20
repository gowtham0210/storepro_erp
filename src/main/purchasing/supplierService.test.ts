import { beforeEach, describe, expect, it } from 'vitest'
import type { SupplierInput } from '@shared/ipc/contract'
import type { Testbed } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'
import { rejection, setUpStore } from '../test/store'

const EMPTY: Omit<SupplierInput, 'name'> = {
  contactPerson: null,
  phone: null,
  email: null,
  address: null,
  taxRegistrationNumber: null
}

describe('SupplierService (M15-01)', () => {
  const getDb = useMigratedDb()
  let bed: Awaited<ReturnType<typeof setUpStore>>

  beforeEach(async () => {
    bed = await setUpStore(getDb())
  })

  const create = (bed_: Testbed, name: string, extra: Partial<SupplierInput> = {}) =>
    bed_.supplierService.create(bed_.actor(), { name, ...EMPTY, ...extra })

  it('adds, lists and finds suppliers, newest details first-class and audited', () => {
    const created = create(bed, 'Sri Balaji Traders', {
      contactPerson: 'Balaji',
      phone: '98400 12345',
      taxRegistrationNumber: '33AAAAA0000A1Z5'
    })
    expect(created).toMatchObject({
      name: 'Sri Balaji Traders',
      contactPerson: 'Balaji',
      active: true,
      documentCount: 0
    })
    create(bed, 'Anand Wholesale')

    const page = bed.supplierService.list(bed.actor())
    expect(page.total).toBe(2)
    expect(page.items.map((s) => s.name)).toEqual(['Anand Wholesale', 'Sri Balaji Traders'])

    expect(bed.supplierService.list(bed.actor(), { search: 'balaji' }).items).toHaveLength(1)
    expect(bed.supplierService.list(bed.actor(), { search: '98400' }).items).toHaveLength(1)
    // Wildcard characters are matched literally.
    expect(bed.supplierService.list(bed.actor(), { search: '%' }).items).toHaveLength(0)

    expect(bed.audit().filter((e) => e.action === 'supplier.created')).toHaveLength(2)
  })

  it('rejects a second supplier with the same name, ignoring case', async () => {
    create(bed, 'Anand Wholesale')
    const error = await rejection(() => create(bed, 'ANAND wholesale'))
    expect(error.code).toBe('CONFLICT')
    expect(error.message).toContain('Anand Wholesale')
  })

  it('records what changed when a supplier is edited, and nothing when it is not', () => {
    const { supplierId } = create(bed, 'Anand Wholesale')
    const actor = bed.actor()
    const before = bed.audit().length

    bed.supplierService.update(actor, { supplierId, name: 'Anand Wholesale', ...EMPTY })
    expect(bed.audit()).toHaveLength(before)

    const updated = bed.supplierService.update(actor, {
      supplierId,
      name: 'Anand Wholesale',
      ...EMPTY,
      phone: '044 2345 6789'
    })
    expect(updated.phone).toBe('044 2345 6789')
    const entry = bed.audit().findLast((e) => e.action === 'supplier.updated')
    expect(JSON.parse(entry?.details ?? '{}')).toMatchObject({
      changes: { phone: { from: null, to: '044 2345 6789' } }
    })
  })

  it('archives and restores suppliers, hiding archived ones by default', async () => {
    const { supplierId } = create(bed, 'Anand Wholesale')
    const actor = bed.actor()

    expect(bed.supplierService.setActive(actor, { supplierId, active: false }).active).toBe(false)
    expect(bed.supplierService.list(actor).items).toHaveLength(0)
    expect(bed.supplierService.list(actor, { status: 'archived' }).items).toHaveLength(1)
    expect(bed.supplierService.list(actor, { status: 'all' }).items).toHaveLength(1)

    const error = await rejection(() => create(bed, 'Anand Wholesale'))
    expect(error.message).toContain('Restore it')

    expect(bed.supplierService.setActive(actor, { supplierId, active: true }).active).toBe(true)
    expect(bed.audit().map((e) => e.action)).toEqual(
      expect.arrayContaining(['supplier.archived', 'supplier.restored'])
    )
  })

  it('lets an inventory operator manage suppliers but not a cashier see them', async () => {
    await bed.signInAs('inventory_operator')
    const { supplierId } = create(bed, 'Anand Wholesale')
    expect(bed.supplierService.list(bed.actor()).items).toHaveLength(1)

    await bed.signInAs('cashier')
    expect((await rejection(() => bed.supplierService.list(bed.actor()))).code).toBe('FORBIDDEN')
    expect((await rejection(() => create(bed, 'Rogue'))).code).toBe('FORBIDDEN')
    expect(
      (
        await rejection(() =>
          bed.supplierService.setActive(bed.actor(), { supplierId, active: false })
        )
      ).code
    ).toBe('FORBIDDEN')
  })
})
