import type { AuditLogService } from '../../audit/auditLogService'
import type { AuthService } from '../../auth/authService'
import type { BackupService } from '../../backup/backupService'
import type { CatalogService } from '../../catalog/catalogService'
import type { ProductImportService } from '../../catalog/productImportService'
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
import type { Logger } from '../../logging/logger'
import type { UserService } from '../../users/userService'
import type { HandlerMap } from '../serviceHost'
import { createAppHandlers, type AppHandlerDeps } from './app'
import { createAuditHandlers } from './audit'
import { createAuthHandlers } from './auth'
import { createBackupHandlers } from './backup'
import { createCatalogHandlers } from './catalog'
import { createConnectivityHandlers } from './connectivity'
import { createCustomerHandlers } from './customers'
import { createExpenseHandlers } from './expenses'
import { createImportHandlers } from './import'
import { createInventoryHandlers } from './inventory'
import { createLogHandlers } from './log'
import { createModuleHandlers } from './modules'
import { createPricingHandlers } from './pricing'
import { createPrintingHandlers } from './printing'
import { createPurchasingHandlers } from './purchasing'
import { createReportHandlers } from './reports'
import { createReturnHandlers } from './returns'
import { createSalesHandlers } from './sales'
import { createStoreHandlers } from './store'
import { createUserHandlers } from './users'

export interface HandlerDeps extends AppHandlerDeps {
  logger: Logger
  auth: AuthService
  users: UserService
  auditLog: AuditLogService
  store: StoreService
  modules: ModuleService
  connectivity: ConnectivityMonitor
  catalog: CatalogService
  products: ProductService
  imports: ProductImportService
  backups: BackupService
  pricing: PricingService
  inventory: InventoryService
  payments: PaymentService
  sales: SalesService
  printing: PrintingService
  suppliers: SupplierService
  purchases: PurchaseService
  expenses: ExpenseService
  customers: CustomerService
  returns: ReturnService
  reports: ReportService
}

export function createHandlers(deps: HandlerDeps): HandlerMap {
  return {
    ...createAppHandlers(deps),
    ...createLogHandlers(deps.logger.child('renderer')),
    ...createAuthHandlers(deps.auth),
    ...createUserHandlers(deps.users),
    ...createAuditHandlers(deps.auditLog),
    ...createStoreHandlers(deps.store),
    ...createModuleHandlers(deps.modules),
    ...createConnectivityHandlers(deps.connectivity),
    ...createCatalogHandlers(deps.catalog, deps.products),
    ...createImportHandlers(deps.imports),
    ...createBackupHandlers(deps.backups),
    ...createPricingHandlers(deps.pricing),
    ...createInventoryHandlers(deps.inventory),
    ...createSalesHandlers(deps.payments, deps.sales),
    ...createPrintingHandlers(deps.printing),
    ...createPurchasingHandlers(deps.suppliers, deps.purchases),
    ...createExpenseHandlers(deps.expenses),
    ...createCustomerHandlers(deps.customers),
    ...createReturnHandlers(deps.returns),
    ...createReportHandlers(deps.reports)
  }
}
