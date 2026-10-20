import { TEST_STORE } from '@shared/test/stores'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, type IpcArgs, type IpcChannel, type RoleCode } from '@shared/ipc/contract'
import { isPermissionCode } from '@shared/permissions'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { useMigratedDb } from '../db/test/testDb'
import { createRealIpc } from './test/realHandlers'

/**
 * M06-06: restricted actions are refused by the main process itself, whatever
 * the renderer sends. Each test calls channels directly, as a tampered-with
 * renderer could.
 */

const PASSWORD = 'till-drawer-77'

const SAMPLE_VARIANT = {
  variantName: null,
  sku: null,
  unitCode: 'pcs',
  sellingPriceMinor: 4500,
  mrpMinor: null,
  costPriceMinor: null,
  reorderLevelMilli: null,
  barcodes: []
}

/** A valid request for every channel. A new channel must add one here, which brings it under these tests. */
const SAMPLE_INPUTS: { [C in IpcChannel]: IpcArgs<C> } = {
  'app:get-info': [],
  'app:get-startup-status': [],
  'log:write': [{ level: 'info', message: 'hello' }],
  'auth:get-state': [],
  'auth:sign-in': [{ username: 'owner', password: 'wrong-password' }],
  'auth:sign-out': [],
  'auth:lock': [],
  'auth:unlock': [{ password: 'wrong-password' }],
  'auth:change-password': [{ currentPassword: 'wrong-password', newPassword: 'brand-new-pass-9' }],
  'auth:approve-override': [{ permission: 'sale.void', username: 'owner', password: 'wrong' }],
  'users:list': [],
  'users:list-roles': [],
  'users:create': [
    { username: 'intruder', displayName: 'Intruder', roleCode: 'administrator', password: PASSWORD }
  ],
  'users:update': [{ userId: 1, displayName: 'Hijacked', roleCode: 'cashier' }],
  'users:set-active': [{ userId: 1, active: false }],
  'users:reset-password': [{ userId: 1, newPassword: 'taken-over-123' }],
  'audit:list': [{ person: 1 }],
  'audit:filter-options': [],
  'setup:get-options': [],
  'setup:complete': [
    {
      store: TEST_STORE,
      administrator: { username: 'second', displayName: 'Second', password: PASSWORD }
    }
  ],
  'setup:complete-store': [TEST_STORE],
  'store:get-profile': [],
  'store:update': [{ ...TEST_STORE, name: 'Hijacked Stores' }],
  'modules:list': [],
  'modules:set-enabled': [{ code: 'grocery', enabled: false }],
  'connectivity:get-status': [],
  'catalog:list-categories': [],
  'catalog:create-category': [{ name: 'Snacks' }],
  'catalog:rename-category': [{ categoryId: 1, name: 'Renamed' }],
  'catalog:set-category-active': [{ categoryId: 1, active: false }],
  'catalog:list-units': [],
  'catalog:create-unit': [{ unitCode: 'tray', name: 'Trays', allowsFraction: false }],
  'catalog:rename-unit': [{ unitCode: 'pcs', name: 'Units' }],
  'tax:list-classes': [],
  'tax:create-class': [{ name: 'GST 99%', rateBp: 9900, cessRateBp: 0 }],
  'tax:update-class': [{ taxClassId: 1, name: 'GST 0%', rateBp: 9000, cessRateBp: 0 }],
  'tax:set-class-active': [{ taxClassId: 1, active: false }],
  'pricing:get-settings': [],
  'pricing:update-policy': [{ roundingMinor: 1, maxDiscountBp: 10_000 }],
  'products:list': [{}],
  'products:get': [{ productId: 1 }],
  'products:create': [
    {
      name: 'Rogue product',
      categoryId: null,
      taxClassId: 1,
      hsnCode: null,
      tracksInventory: true,
      variants: [SAMPLE_VARIANT]
    }
  ],
  'products:update': [
    {
      productId: 1,
      name: 'Hijacked',
      categoryId: null,
      taxClassId: 1,
      hsnCode: null,
      tracksInventory: true
    }
  ],
  'products:add-variant': [{ productId: 1, ...SAMPLE_VARIANT, variantName: '5 kg' }],
  'products:update-variant': [{ variantId: 1, ...SAMPLE_VARIANT, sellingPriceMinor: 1 }],
  'products:set-active': [{ productId: 1, active: false }],
  'products:set-variant-active': [{ variantId: 1, active: false }],
  'products:find-by-barcode': [{ barcode: '8901234567890' }],
  'products:search': [{ query: 'rice' }],
  'inventory:list-reasons': [],
  'inventory:list': [{}],
  'inventory:movements': [{ variantId: 1 }],
  'inventory:adjust': [
    {
      reasonCode: 'opening_stock',
      notes: null,
      items: [{ variantId: 1, quantityDeltaMilli: 1000 }]
    }
  ],
  'inventory:reconcile': [
    {
      notes: null,
      items: [{ variantId: 1, countedMilli: 1000 }]
    }
  ],
  'inventory:list-adjustments': [{}],
  'payments:list-methods': [],
  'payments:create-method': [{ methodCode: 'wallet', name: 'Wallet', kind: 'other' }],
  'payments:update-method': [{ paymentMethodId: 1, name: 'Cash', kind: 'cash' }],
  'payments:set-method-active': [{ paymentMethodId: 1, active: false }],
  'sales:checkout': [
    {
      checkoutKey: 'checkout-key-001',
      lines: [{ variantId: 1, quantityMilli: 1000, unitPriceMinor: 4500 }],
      payments: [{ paymentMethodId: 1, amountMinor: 4500 }]
    }
  ],
  'sales:list': [{}],
  'sales:get': [{ saleId: 1 }],
  'sales:find-by-invoice': [{ invoiceNumber: 'INV-000001' }],
  'sales:void': [{ saleId: 1, reason: 'Duplicate entry' }],
  'sales:hold': [
    {
      label: 'Counter 1',
      items: [{ variantId: 1, quantityMilli: 1000, unitPriceOverrideMinor: 4500 }]
    }
  ],
  'sales:list-held': [],
  'sales:resume-held': [{ heldBillId: 1 }],
  'sales:discard-held': [{ heldBillId: 1 }],
  'printers:list': [],
  'printers:get-config': [],
  'printers:set-config': [
    {
      printerName: null,
      paperWidthMm: 80,
      printMode: 'driver',
      autoPrintReceipt: false,
      openCashDrawer: false
    }
  ],
  'printers:test-print': [],
  'receipts:preview': [{ saleId: 1 }],
  'receipts:print': [{ saleId: 1 }],
  'labels:preview': [{ variantId: 1 }],
  'labels:print': [{ variantId: 1 }],
  'grocery:get-weigh-barcode': [],
  'grocery:set-weigh-barcode': [{ enabled: true, weightPrefix: '20', pricePrefix: '21' }],
  'suppliers:list': [{}],
  'suppliers:create': [
    {
      name: 'Rogue Traders',
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      taxRegistrationNumber: null
    }
  ],
  'suppliers:update': [
    {
      supplierId: 1,
      name: 'Hijacked Traders',
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      taxRegistrationNumber: null
    }
  ],
  'suppliers:set-active': [{ supplierId: 1, active: false }],
  'purchases:list-orders': [{}],
  'purchases:get-order': [{ purchaseOrderId: 1 }],
  'purchases:save-order': [
    {
      supplierId: 1,
      notes: null,
      lines: [{ variantId: 1, quantityMilli: 1000, unitCostMinor: 100 }]
    }
  ],
  'purchases:confirm-order': [{ purchaseOrderId: 1 }],
  'purchases:cancel-order': [{ purchaseOrderId: 1 }],
  'purchases:close-order': [{ purchaseOrderId: 1 }],
  'purchases:delete-order': [{ purchaseOrderId: 1 }],
  'purchases:list-receipts': [{}],
  'purchases:get-receipt': [{ goodsReceiptId: 1 }],
  'purchases:save-receipt': [
    {
      supplierId: 1,
      purchaseOrderId: null,
      supplierInvoiceNumber: null,
      supplierInvoiceDate: null,
      lines: [{ variantId: 1, quantityMilli: 1000, unitCostMinor: 100 }],
      post: true
    }
  ],
  'purchases:post-receipt': [{ goodsReceiptId: 1 }],
  'purchases:delete-receipt': [{ goodsReceiptId: 1 }],
  'purchases:cost-history': [{ variantId: 1 }],
  'expenses:list-categories': [],
  'expenses:create-category': [{ name: 'Rogue category' }],
  'expenses:rename-category': [{ expenseCategoryId: 1, name: 'Renamed' }],
  'expenses:set-category-active': [{ expenseCategoryId: 1, active: false }],
  'expenses:list': [{}],
  'expenses:create': [
    {
      expenseCategoryId: 1,
      expenseDate: '2026-10-19',
      amountMinor: 100_00,
      paymentMethodId: 1,
      description: null
    }
  ],
  'expenses:update': [
    {
      expenseId: 1,
      expenseCategoryId: 1,
      expenseDate: '2026-10-19',
      amountMinor: 1,
      paymentMethodId: 1,
      description: null
    }
  ],
  'expenses:set-voided': [{ expenseId: 1, voided: true }],
  'customers:list': [{}],
  'customers:create': [
    { name: 'Rogue Customer', phone: null, email: null, address: null, taxRegistrationNumber: null }
  ],
  'customers:update': [
    {
      customerId: 1,
      name: 'Hijacked',
      phone: null,
      email: null,
      address: null,
      taxRegistrationNumber: null
    }
  ],
  'customers:set-active': [{ customerId: 1, active: false }],
  'customers:purchases': [{ customerId: 1 }],
}

describe('access control over IPC', () => {
  const getDb = useMigratedDb()

  async function storeWith(...roles: RoleCode[]) {
    const bed = createTestbed(getDb())
    const ipc = createRealIpc(bed)
    await ipc.invoke('setup:complete', { store: TEST_STORE, administrator: OWNER })
    for (const roleCode of roles) {
      await ipc.invoke('users:create', {
        username: roleCode.replace('_', '-'),
        displayName: roleCode,
        roleCode,
        password: PASSWORD
      })
    }
    await ipc.invoke('auth:sign-out')
    return { ...bed, ...ipc }
  }

  const send = (ipc: { send: (c: string, i?: unknown) => Promise<unknown> }, channel: IpcChannel) =>
    ipc.send(channel, SAMPLE_INPUTS[channel][0])

  it('requires every channel to declare a valid access rule', async () => {
    const { handlers } = await storeWith()
    for (const channel of IPC_CHANNELS) {
      const { access } = handlers[channel]
      expect(
        ['public', 'password-change', 'signed-in'].includes(access) || isPermissionCode(access),
        `${channel} declares ${access}`
      ).toBe(true)
    }
  })

  it('keeps the list of public channels short and deliberate', async () => {
    const { handlers } = await storeWith()
    expect(IPC_CHANNELS.filter((channel) => handlers[channel].access === 'public')).toEqual([
      'app:get-info',
      'app:get-startup-status',
      'log:write',
      'auth:get-state',
      'auth:sign-in',
      'auth:sign-out',
      'auth:lock',
      'auth:unlock',
      'setup:get-options',
      'setup:complete'
    ])
  })

  it('refuses every guarded channel when nobody is signed in', async () => {
    const ipc = await storeWith()
    for (const channel of IPC_CHANNELS) {
      if (ipc.handlers[channel].access === 'public') continue
      expect(await send(ipc, channel), channel).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED' }
      })
    }
  })

  it.each(['cashier', 'inventory_operator'] as const)(
    'refuses a %s every channel their role does not allow, and changes nothing',
    async (roleCode) => {
      const ipc = await storeWith(roleCode)
      await ipc.invoke('auth:sign-in', { username: roleCode.replace('_', '-'), password: PASSWORD })
      const allowed = new Set(ipc.roles.permissionsOf(roleCode))
      const refused: string[] = []
      for (const channel of IPC_CHANNELS) {
        const { access } = ipc.handlers[channel]
        if (!isPermissionCode(access) || allowed.has(access)) continue
        const result = await send(ipc, channel)
        expect(result, channel).toMatchObject({
          ok: false,
          error: { code: 'FORBIDDEN', details: { permission: access } }
        })
        refused.push(channel)
      }
      expect(refused).toContain('users:create')
      // Nothing was written: no new user, and the owner's account is untouched.
      expect(
        ipc.users
          .list()
          .map((u) => u.username)
          .sort()
      ).toEqual([roleCode.replace('_', '-'), 'owner'].sort())
      expect(ipc.users.findByUsername('owner')).toMatchObject({
        displayName: OWNER.displayName,
        active: true,
        mustChangePassword: false
      })
      expect(ipc.audit().filter((entry) => entry.action === 'access.denied').length).toBe(
        refused.length
      )
    }
  )

  it("refuses a manager anything that would reach an administrator's access", async () => {
    const ipc = await storeWith('manager')
    await ipc.invoke('auth:sign-in', { username: 'manager', password: PASSWORD })
    for (const channel of [
      'users:create',
      'users:update',
      'users:set-active',
      'users:reset-password'
    ] as const) {
      expect(await send(ipc, channel), channel).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' }
      })
    }
    // Managers can still manage the roles they hold themselves.
    await expect(
      ipc.invoke('users:create', {
        username: 'meena',
        displayName: 'Meena',
        roleCode: 'cashier',
        password: PASSWORD
      })
    ).resolves.toMatchObject({ roleCode: 'cashier' })
  })
})
