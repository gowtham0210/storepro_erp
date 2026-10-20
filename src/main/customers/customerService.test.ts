import { beforeEach, describe, expect, it } from 'vitest'
import type { CustomerInput } from '@shared/ipc/contract'
import { insertReturn, insertSale, insertVoid } from '../db/dev/builders'
import { useMigratedDb } from '../db/test/testDb'
import { rejection, setUpStore, taxClassId, variant } from '../test/store'

const NONE: Omit<CustomerInput, 'name'> = {
  phone: null,
  email: null,
  address: null,
  taxRegistrationNumber: null
}

describe('CustomerService (M17)', () => {
  const getDb = useMigratedDb()
  let bed: Awaited<ReturnType<typeof setUpStore>>

  const add = (name: string, extra: Partial<CustomerInput> = {}) =>
    bed.customerService.create(bed.actor(), { name, ...NONE, ...extra })

  beforeEach(async () => {
    bed = await setUpStore(getDb())
  })

  describe('records (M17-01)', () => {
    it('adds, lists and finds customers, newest details first-class and audited', () => {
      const created = add('Meena Sundar', { phone: '+919840012345', email: 'meena@example.com' })
      expect(created).toMatchObject({
        name: 'Meena Sundar',
        phone: '+919840012345',
        active: true,
        saleCount: 0,
        lastPurchaseAt: null
      })
      add('Arjun Rao')

      const page = bed.customerService.list(bed.actor())
      expect(page.items.map((c) => c.name)).toEqual(['Arjun Rao', 'Meena Sundar'])
      expect(bed.audit().filter((e) => e.action === 'customer.created')).toHaveLength(2)
    })

    it('finds a customer by name, email or any way of typing their phone', () => {
      add('Meena Sundar', { phone: '+919840012345', email: 'meena@example.com' })
      add('Arjun Rao', { phone: '9444400000' })
      const find = (search: string) =>
        bed.customerService.list(bed.actor(), { search }).items.map((c) => c.name)

      expect(find('meena')).toEqual(['Meena Sundar'])
      expect(find('example.com')).toEqual(['Meena Sundar'])
      expect(find('98400 12345')).toEqual(['Meena Sundar'])
      expect(find('(94444) 00000')).toEqual(['Arjun Rao'])
      expect(find('+91 98400')).toEqual(['Meena Sundar'])
      // Words never match every phone, and wildcards are literal.
      expect(find('zzz')).toEqual([])
      expect(find('%')).toEqual([])
    })

    it('treats one phone number as one customer, however it was typed', async () => {
      const first = add('Meena Sundar', { phone: '+919840012345' })
      const error = await rejection(() => add('Someone Else', { phone: '+919840012345' }))
      expect(error.code).toBe('CONFLICT')
      expect(error.message).toContain('Meena Sundar')

      // Another customer can have no phone at all, as many as needed.
      add('Walk-in A')
      add('Walk-in B')

      const other = add('Arjun Rao', { phone: '9444400000' })
      const clash = await rejection(() =>
        bed.customerService.update(bed.actor(), {
          customerId: other.customerId,
          name: 'Arjun Rao',
          ...NONE,
          phone: '+919840012345'
        })
      )
      expect(clash.message).toContain('Meena Sundar')

      // Keeping your own number is fine.
      bed.customerService.update(bed.actor(), {
        customerId: first.customerId,
        name: 'Meena S.',
        ...NONE,
        phone: '+919840012345'
      })
    })

    it('records what changed, and nothing when nothing did', () => {
      const { customerId } = add('Meena Sundar')
      const actor = bed.actor()
      const before = bed.audit().length

      bed.customerService.update(actor, { customerId, name: 'Meena Sundar', ...NONE })
      expect(bed.audit()).toHaveLength(before)

      const updated = bed.customerService.update(actor, {
        customerId,
        name: 'Meena Sundar',
        ...NONE,
        taxRegistrationNumber: '33AAAAA0000A1Z5'
      })
      expect(updated.taxRegistrationNumber).toBe('33AAAAA0000A1Z5')
      const entry = bed.audit().findLast((e) => e.action === 'customer.updated')
      expect(JSON.parse(entry?.details ?? '{}')).toMatchObject({
        changes: { taxRegistrationNumber: { from: null, to: '33AAAAA0000A1Z5' } }
      })
    })

    it('archives and restores, hiding archived customers by default', () => {
      const { customerId } = add('Meena Sundar')
      const actor = bed.actor()
      expect(bed.customerService.setActive(actor, { customerId, active: false }).active).toBe(false)
      expect(bed.customerService.list(actor).items).toHaveLength(0)
      expect(bed.customerService.list(actor, { status: 'archived' }).items).toHaveLength(1)
      expect(bed.customerService.list(actor, { status: 'all' }).items).toHaveLength(1)
      expect(bed.customerService.setActive(actor, { customerId, active: true }).active).toBe(true)
      expect(bed.audit().map((e) => e.action)).toEqual(
        expect.arrayContaining(['customer.archived', 'customer.restored'])
      )
    })

    it('lets a cashier add and look up customers, but not an inventory operator see them', async () => {
      await bed.signInAs('cashier')
      const created = bed.customerService.create(bed.actor(), { name: 'Walk-up', ...NONE })
      expect(bed.customerService.list(bed.actor()).items).toHaveLength(1)
      expect(created.name).toBe('Walk-up')

      await bed.signInAs('inventory_operator')
      expect((await rejection(() => bed.customerService.list(bed.actor()))).code).toBe('FORBIDDEN')
    })
  })

  describe('purchase history (M17-03)', () => {
    let soapId: number
    let customerId: number
    let sale1: { saleId: number; saleItemIds: number[] }

    beforeEach(() => {
      const actor = bed.actor()
      soapId = bed.productService.create(actor, {
        name: 'Neem Soap',
        categoryId: null,
        taxClassId: taxClassId(bed, 'GST 5%'),
        hsnCode: null,
        tracksInventory: true,
        variants: [variant({ sku: 'SOAP', sellingPriceMinor: 5000 })]
      }).variants[0]!.variantId
      customerId = add('Meena Sundar').customerId
      const db = getDb()
      const line = { variantId: soapId, quantityMilli: 2000, unitPriceMinor: 5000 }
      sale1 = insertSale(db, {
        invoiceNumber: 'INV000001',
        cashierId: 1,
        customerId,
        completedAt: Date.UTC(2026, 9, 10),
        lines: [line],
        payments: [{ methodCode: 'cash', amountMinor: 10_000 }]
      })
      insertSale(db, {
        invoiceNumber: 'INV000002',
        cashierId: 1,
        customerId,
        completedAt: Date.UTC(2026, 9, 12),
        lines: [{ ...line, quantityMilli: 1000 }],
        payments: [{ methodCode: 'cash', amountMinor: 5000 }]
      })
      // Someone else's sale, and a walk-in, are not this customer's.
      insertSale(db, {
        invoiceNumber: 'INV000003',
        cashierId: 1,
        completedAt: Date.UTC(2026, 9, 13),
        lines: [line],
        payments: [{ methodCode: 'cash', amountMinor: 10_000 }]
      })
    })

    it('lists their invoices newest first with what they spent', () => {
      const history = bed.customerService.purchases(bed.actor(), { customerId })
      expect(history).toMatchObject({
        customerName: 'Meena Sundar',
        total: 2,
        totalSpentMinor: 15_000
      })
      expect(history.items.map((i) => i.invoiceNumber)).toEqual(['INV000002', 'INV000001'])
      expect(history.items[1]).toMatchObject({
        grandTotalMinor: 10_000,
        returnedMinor: 0,
        lineCount: 1,
        isVoided: false
      })
      const list = bed.customerService.list(bed.actor()).items[0]
      expect(list).toMatchObject({ saleCount: 2, lastPurchaseAt: Date.UTC(2026, 9, 12) })
    })

    it('shows refunds against an invoice and takes them off what was spent', () => {
      insertReturn(getDb(), {
        returnNumber: 'CN000001',
        saleId: sale1.saleId,
        userId: 1,
        items: [
          { saleItemId: sale1.saleItemIds[0]!, quantityMilli: 1000, creditAmountMinor: 5000 }
        ],
        refunds: [{ methodCode: 'cash', amountMinor: 5000 }]
      })
      const history = bed.customerService.purchases(bed.actor(), { customerId })
      expect(history.items.find((i) => i.invoiceNumber === 'INV000001')?.returnedMinor).toBe(5000)
      expect(history.totalSpentMinor).toBe(10_000)
    })

    it('keeps voided invoices on the list but out of the totals', () => {
      insertVoid(getDb(), sale1.saleId, 1)
      const history = bed.customerService.purchases(bed.actor(), { customerId })
      expect(history.items.find((i) => i.invoiceNumber === 'INV000001')?.isVoided).toBe(true)
      expect(history.total).toBe(2)
      expect(history.totalSpentMinor).toBe(5000)
      expect(bed.customerService.list(bed.actor()).items[0]?.saleCount).toBe(1)
    })

    it('pages through invoices', () => {
      const second = bed.customerService.purchases(bed.actor(), { customerId, limit: 1, offset: 1 })
      expect(second.items.map((i) => i.invoiceNumber)).toEqual(['INV000001'])
      expect(second.total).toBe(2)
      expect(second.totalSpentMinor).toBe(15_000)
    })

    it('needs permission to see sales as well as customers', async () => {
      await bed.signInAs('cashier')
      expect(bed.customerService.purchases(bed.actor(), { customerId }).total).toBe(2)
    })
  })
})
