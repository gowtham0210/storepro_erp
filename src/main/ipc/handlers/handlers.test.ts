import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/contract'
import type { AuditLogService } from '../../audit/auditLogService'
import type { AuthService } from '../../auth/authService'
import type { CatalogService } from '../../catalog/catalogService'
import type { ProductService } from '../../catalog/productService'
import type { CustomerService } from '../../customers/customerService'
import type { ExpenseService } from '../../expenses/expenseService'
import type { InventoryService } from '../../inventory/inventoryService'
import type { PaymentService } from '../../payments/paymentService'
import type { PricingService } from '../../pricing/pricingService'
import type { PrintingService } from '../../printing/printingService'
import type { PurchaseService } from '../../purchasing/purchaseService'
import type { SupplierService } from '../../purchasing/supplierService'
import type { ReportService } from '../../reports/reportService'
import type { ReturnService } from '../../returns/returnService'
import type { SalesService } from '../../sales/salesService'
import type { ConnectivityMonitor } from '../../connectivity/connectivityMonitor'
import type { ModuleService } from '../../modules/moduleService'
import type { StoreService } from '../../store/storeService'
import { createTestLogger } from '../../test/helpers'
import type { UserService } from '../../users/userService'
import { createIpcHarness } from '../test/harness'
import { createHandlers } from '.'

function setup() {
  const logger = createTestLogger()
  const appInfo = {
    name: 'StorePro',
    version: '1.0.0',
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
    versions: { electron: '44', chrome: '152', node: '24' }
  }
  const startup = {
    recoveredFromUncleanShutdown: true,
    previousSessionStartedAt: '2026-10-19T04:00:00.000Z'
  }
  // Auth and user handlers delegate to services with their own tests; only the
  // app and log handlers are exercised here.
  const handlers = createHandlers({
    logger,
    getAppInfo: () => appInfo,
    getStartupStatus: () => startup,
    auth: {} as AuthService,
    users: {} as UserService,
    auditLog: {} as AuditLogService,
    store: {} as StoreService,
    modules: {} as ModuleService,
    connectivity: {} as ConnectivityMonitor,
    catalog: {} as CatalogService,
    products: {} as ProductService,
    pricing: {} as PricingService,
    inventory: {} as InventoryService,
    payments: {} as PaymentService,
    sales: {} as SalesService,
    printing: {} as PrintingService,
    suppliers: {} as SupplierService,
    purchases: {} as PurchaseService,
    expenses: {} as ExpenseService,
    customers: {} as CustomerService,
    returns: {} as ReturnService,
    reports: {} as ReportService
  })
  const { invoke } = createIpcHarness(handlers)
  return { handlers, logger, appInfo, startup, invoke }
}

describe('IPC handlers', () => {
  it('provide a handler for every channel in the contract', () => {
    expect(Object.keys(setup().handlers).sort()).toEqual([...IPC_CHANNELS].sort())
  })

  it('return app info and startup status, before anyone signs in', async () => {
    const { invoke, appInfo, startup } = setup()
    expect(await invoke('app:get-info')).toEqual(appInfo)
    expect(await invoke('app:get-startup-status')).toEqual(startup)
  })

  it('write renderer log entries at the requested level', async () => {
    const { invoke, logger } = setup()
    await invoke('log:write', {
      level: 'warn',
      message: 'Printer offline',
      context: { port: 'USB1' }
    })
    expect(logger.warn).toHaveBeenCalledWith('Printer offline', { port: 'USB1' })
  })

  it('validate renderer log input', () => {
    const { input } = setup().handlers['log:write']
    expect(input.safeParse({ level: 'info', message: 'ok' }).success).toBe(true)
    expect(input.safeParse({ level: 'trace', message: 'ok' }).success).toBe(false)
    expect(input.safeParse({ level: 'info', message: '' }).success).toBe(false)
    expect(input.safeParse({ level: 'info', message: 'x'.repeat(2001) }).success).toBe(false)
  })

  it('accept no input for the app channels', () => {
    const { handlers } = setup()
    expect(handlers['app:get-info'].input.safeParse(undefined).success).toBe(true)
    expect(handlers['app:get-info'].input.safeParse({ sneaky: true }).success).toBe(false)
  })
})
