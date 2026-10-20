import { beforeEach, describe, expect, it } from 'vitest'
import type { ExpenseInput } from '@shared/ipc/contract'
import { useMigratedDb } from '../db/test/testDb'
import { rejection, setUpStore } from '../test/store'

describe('ExpenseService (M18)', () => {
  const getDb = useMigratedDb()
  let bed: Awaited<ReturnType<typeof setUpStore>>
  let rentId: number
  let electricityId: number
  let cashId: number
  let upiId: number

  const expense = (overrides: Partial<ExpenseInput> = {}): ExpenseInput => ({
    expenseCategoryId: rentId,
    expenseDate: '2026-10-05',
    amountMinor: 1_200_000,
    paymentMethodId: cashId,
    description: null,
    ...overrides
  })

  beforeEach(async () => {
    bed = await setUpStore(getDb())
    const categories = bed.expenseService.listCategories(bed.actor())
    rentId = categories.find((c) => c.name === 'Rent')!.expenseCategoryId
    electricityId = categories.find((c) => c.name === 'Electricity')!.expenseCategoryId
    const methods = bed.paymentService.listMethods()
    cashId = methods.find((m) => m.kind === 'cash')!.paymentMethodId
    upiId = methods.find((m) => m.kind === 'upi')!.paymentMethodId
  })

  describe('categories', () => {
    it('starts with the seeded categories, and adds, renames and archives them', async () => {
      const actor = bed.actor()
      expect(bed.expenseService.listCategories(actor).map((c) => c.name)).toEqual([
        'Electricity',
        'Maintenance',
        'Other',
        'Rent',
        'Salaries',
        'Transport'
      ])

      const added = bed.expenseService.createCategory(actor, { name: 'Packaging' })
      expect(added).toMatchObject({ name: 'Packaging', active: true, expenseCount: 0 })

      const renamed = bed.expenseService.renameCategory(actor, {
        expenseCategoryId: added.expenseCategoryId,
        name: 'Packing material'
      })
      expect(renamed.name).toBe('Packing material')

      const error = await rejection(() =>
        bed.expenseService.createCategory(actor, { name: 'rent' })
      )
      expect(error.code).toBe('CONFLICT')

      bed.expenseService.setCategoryActive(actor, {
        expenseCategoryId: added.expenseCategoryId,
        active: false
      })
      // Archived categories sort last and cannot take new expenses.
      const listed = bed.expenseService.listCategories(actor)
      expect(listed.at(-1)).toMatchObject({ name: 'Packing material', active: false })
      expect(
        (
          await rejection(() =>
            bed.expenseService.record(
              actor,
              expense({ expenseCategoryId: added.expenseCategoryId })
            )
          )
        ).message
      ).toContain('archived')

      expect(bed.audit().map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'expense_category.created',
          'expense_category.updated',
          'expense_category.archived'
        ])
      )
    })
  })

  describe('expenses (M18-01)', () => {
    it('records an expense with who, when, how it was paid, and audits it', () => {
      const actor = bed.actor()
      const saved = bed.expenseService.record(
        actor,
        expense({ description: 'October shop rent', paymentMethodId: upiId })
      )
      expect(saved).toMatchObject({
        categoryName: 'Rent',
        expenseDate: '2026-10-05',
        amountMinor: 1_200_000,
        paymentMethodName: 'UPI',
        description: 'October shop rent',
        recordedByName: 'Ravi Kumar',
        voided: false
      })
      const entry = bed.audit().findLast((e) => e.action === 'expense.recorded')
      expect(JSON.parse(entry?.details ?? '{}')).toMatchObject({
        category: 'Rent',
        amount: '₹12,000.00',
        paymentMethod: 'UPI',
        date: '2026-10-05'
      })
      expect(bed.expenseService.listCategories(actor).find((c) => c.name === 'Rent')).toMatchObject(
        { expenseCount: 1 }
      )
    })

    it('rejects a missing category or payment method, and an archived payment method', async () => {
      const actor = bed.actor()
      expect(
        (
          await rejection(() =>
            bed.expenseService.record(actor, expense({ expenseCategoryId: 999 }))
          )
        ).code
      ).toBe('VALIDATION_FAILED')
      expect(
        (await rejection(() => bed.expenseService.record(actor, expense({ paymentMethodId: 999 }))))
          .code
      ).toBe('VALIDATION_FAILED')

      bed.paymentService.setMethodActive(actor, { paymentMethodId: upiId, active: false })
      expect(
        (
          await rejection(() =>
            bed.expenseService.record(actor, expense({ paymentMethodId: upiId }))
          )
        ).message
      ).toContain('archived')
    })

    it('edits an expense and records exactly what changed', async () => {
      const actor = bed.actor()
      const saved = bed.expenseService.record(actor, expense())
      const before = bed.audit().length

      // Saving without a change writes nothing.
      bed.expenseService.update(actor, { expenseId: saved.expenseId, ...expense() })
      expect(bed.audit()).toHaveLength(before)

      const updated = bed.expenseService.update(actor, {
        expenseId: saved.expenseId,
        ...expense({ expenseCategoryId: electricityId, amountMinor: 450_000 })
      })
      expect(updated).toMatchObject({ categoryName: 'Electricity', amountMinor: 450_000 })
      const entry = bed.audit().findLast((e) => e.action === 'expense.updated')
      expect(JSON.parse(entry?.details ?? '{}').changes).toEqual({
        category: { from: 'Rent', to: 'Electricity' },
        amount: { from: '₹12,000.00', to: '₹4,500.00' }
      })
    })

    it('lets an existing expense keep a category or payment method archived since', () => {
      const actor = bed.actor()
      const saved = bed.expenseService.record(actor, expense())
      bed.expenseService.setCategoryActive(actor, { expenseCategoryId: rentId, active: false })
      const updated = bed.expenseService.update(actor, {
        expenseId: saved.expenseId,
        ...expense({ description: 'Corrected note' })
      })
      expect(updated.description).toBe('Corrected note')
    })

    it('voids and restores an expense, leaving it out of totals but never deleting it', async () => {
      const actor = bed.actor()
      const keep = bed.expenseService.record(actor, expense({ amountMinor: 100_000 }))
      const mistake = bed.expenseService.record(actor, expense({ amountMinor: 700_000 }))
      expect(bed.expenseService.list(actor).totalMinor).toBe(800_000)

      const voided = bed.expenseService.setVoided(actor, {
        expenseId: mistake.expenseId,
        voided: true
      })
      expect(voided.voided).toBe(true)
      expect(bed.expenseService.list(actor)).toMatchObject({ total: 1, totalMinor: 100_000 })
      expect(bed.expenseService.list(actor, { status: 'voided' }).items[0]?.expenseId).toBe(
        mistake.expenseId
      )
      // Showing everything still totals only what counts.
      expect(bed.expenseService.list(actor, { status: 'all' })).toMatchObject({
        total: 2,
        totalMinor: 100_000
      })

      expect(
        (
          await rejection(() =>
            bed.expenseService.update(actor, { expenseId: mistake.expenseId, ...expense() })
          )
        ).code
      ).toBe('CONFLICT')

      bed.expenseService.setVoided(actor, { expenseId: mistake.expenseId, voided: false })
      expect(bed.expenseService.list(actor).totalMinor).toBe(800_000)
      expect(bed.audit().map((e) => e.action)).toEqual(
        expect.arrayContaining(['expense.voided', 'expense.restored'])
      )
      expect(keep.voided).toBe(false)
    })
  })

  describe('list and totals (M18-02)', () => {
    beforeEach(() => {
      const actor = bed.actor()
      bed.expenseService.record(
        actor,
        expense({ expenseDate: '2026-09-30', amountMinor: 50_000, description: 'Tea for staff' })
      )
      bed.expenseService.record(
        actor,
        expense({ expenseDate: '2026-10-01', amountMinor: 1_200_000 })
      )
      bed.expenseService.record(
        actor,
        expense({
          expenseCategoryId: electricityId,
          expenseDate: '2026-10-10',
          amountMinor: 450_050,
          paymentMethodId: upiId
        })
      )
      bed.expenseService.record(
        actor,
        expense({
          expenseCategoryId: electricityId,
          expenseDate: '2026-10-31',
          amountMinor: 10_000
        })
      )
    })

    it('lists newest first with the total of everything that matches, across pages', () => {
      const actor = bed.actor()
      const page = bed.expenseService.list(actor, { limit: 2 })
      expect(page.items.map((e) => e.expenseDate)).toEqual(['2026-10-31', '2026-10-10'])
      expect(page.total).toBe(4)
      expect(page.totalMinor).toBe(50_000 + 1_200_000 + 450_050 + 10_000)
      expect(bed.expenseService.list(actor, { limit: 2, offset: 2 }).items).toHaveLength(2)
    })

    it('filters by date range, inclusive at both ends', () => {
      const actor = bed.actor()
      const october = bed.expenseService.list(actor, { from: '2026-10-01', to: '2026-10-31' })
      expect(october.total).toBe(3)
      expect(october.totalMinor).toBe(1_200_000 + 450_050 + 10_000)
      expect(bed.expenseService.list(actor, { from: '2026-10-10', to: '2026-10-10' }).total).toBe(1)
      expect(bed.expenseService.list(actor, { to: '2026-09-30' }).total).toBe(1)
    })

    it('rejects a range that ends before it starts', async () => {
      expect(
        (
          await rejection(() =>
            bed.expenseService.list(bed.actor(), { from: '2026-10-31', to: '2026-10-01' })
          )
        ).code
      ).toBe('VALIDATION_FAILED')
    })

    it('filters by category, payment method and words', () => {
      const actor = bed.actor()
      expect(bed.expenseService.list(actor, { categoryId: electricityId })).toMatchObject({
        total: 2,
        totalMinor: 460_050
      })
      expect(bed.expenseService.list(actor, { paymentMethodId: upiId }).total).toBe(1)
      expect(bed.expenseService.list(actor, { search: 'tea' }).total).toBe(1)
      expect(bed.expenseService.list(actor, { search: 'electric' }).total).toBe(2)
      expect(bed.expenseService.list(actor, { search: '%' }).total).toBe(0)
    })
  })

  it('needs the expense permissions: view for the list, manage to change anything', async () => {
    const owner = bed.actor()
    bed.expenseService.record(owner, expense())

    await bed.signInAs('cashier')
    expect((await rejection(() => bed.expenseService.list(bed.actor()))).code).toBe('FORBIDDEN')
    expect((await rejection(() => bed.expenseService.record(bed.actor(), expense()))).code).toBe(
      'FORBIDDEN'
    )

    await bed.signInAs('manager')
    expect(bed.expenseService.list(bed.actor()).total).toBe(1)
    bed.expenseService.record(bed.actor(), expense({ amountMinor: 5000 }))

    // Inventory operators do not hold the expense permissions.
    await bed.signInAs('inventory_operator')
    expect((await rejection(() => bed.expenseService.list(bed.actor()))).code).toBe('FORBIDDEN')
  })
})
