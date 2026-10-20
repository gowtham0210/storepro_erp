import { DEFAULT_CURRENCY } from '@shared/money'
import { CatalogRepository } from '../../catalog/catalogRepository'
import { CatalogService } from '../../catalog/catalogService'
import { ProductRepository } from '../../catalog/productRepository'
import { ProductService } from '../../catalog/productService'
import { TaxClassRepository } from '../../catalog/taxClassRepository'
import type { Database } from '../../db/database'
import { InventoryRepository } from '../../inventory/inventoryRepository'
import { InventoryService } from '../../inventory/inventoryService'
import { PaymentRepository } from '../../payments/paymentRepository'
import { PaymentService } from '../../payments/paymentService'
import { PricingService } from '../../pricing/pricingService'
import { PrinterRepository } from '../../printing/printerRepository'
import { PrintingService } from '../../printing/printingService'
import { PurchaseRepository } from '../../purchasing/purchaseRepository'
import { PurchaseService } from '../../purchasing/purchaseService'
import { SupplierRepository } from '../../purchasing/supplierRepository'
import { SupplierService } from '../../purchasing/supplierService'
import { SalesRepository } from '../../sales/salesRepository'
import { SalesService } from '../../sales/salesService'
import { AuditLog } from '../../audit/auditLog'
import { AuditLogReader } from '../../audit/auditLogReader'
import { AuditLogService } from '../../audit/auditLogService'
import { createTestLogger } from '../../test/helpers'
import { ModuleRepository } from '../../modules/moduleRepository'
import { ModuleService } from '../../modules/moduleService'
import { StoreRepository } from '../../store/storeRepository'
import { StoreService } from '../../store/storeService'
import { UserRepository } from '../../users/userRepository'
import { UserService } from '../../users/userService'
import type { Actor } from '../access'
import { AuthService } from '../authService'
import { LoginThrottle } from '../loginThrottle'
import { OverrideGrants } from '../overrideGrants'
import { PasswordHasher } from '../passwords'
import { RoleRepository } from '../roleRepository'

/** Cheap scrypt parameters for tests; production uses DEFAULT_PARAMS (ln=17). */
export const TEST_HASH_PARAMS = { ln: 10, r: 8, p: 1 }

export interface Testbed {
  auth: AuthService
  userService: UserService
  users: UserRepository
  roles: RoleRepository
  overrides: OverrideGrants
  throttle: LoginThrottle
  hasher: PasswordHasher
  clock: { time: number; now(): number }
  auditLog: AuditLog
  auditLogService: AuditLogService
  storeService: StoreService
  stores: StoreRepository
  moduleService: ModuleService
  taxClasses: TaxClassRepository
  catalog: CatalogRepository
  products: ProductRepository
  catalogService: CatalogService
  productService: ProductService
  pricingService: PricingService
  inventory: InventoryRepository
  inventoryService: InventoryService
  payments: PaymentRepository
  paymentService: PaymentService
  sales: SalesRepository
  salesService: SalesService
  printers: PrinterRepository
  printingService: PrintingService
  supplierRepository: SupplierRepository
  supplierService: SupplierService
  purchaseRepository: PurchaseRepository
  purchaseService: PurchaseService
  /** The signed-in user as the service host resolves them for a request. */
  actor(): Actor
  audit: () => {
    action: string
    user_id: number | null
    approved_by_user_id: number | null
    entity_id: number | null
    details: string | null
  }[]
}

export function createTestbed(db: Database, hashParams = TEST_HASH_PARAMS): Testbed {
  const clock = { time: Date.UTC(2026, 9, 19, 4, 30), now: () => clock.time }
  const audit = new AuditLog(db, clock)
  const users = new UserRepository(db, clock)
  const roles = new RoleRepository(db, clock)
  const overrides = new OverrideGrants(clock)
  const hasher = new PasswordHasher(hashParams)
  const throttle = new LoginThrottle(db, clock)
  const auth = new AuthService({
    db,
    users,
    roles,
    overrides,
    hasher,
    throttle,
    audit,
    logger: createTestLogger()
  })
  const userService = new UserService({ db, users, roles, hasher, throttle, audit })
  const stores = new StoreRepository(db, clock)
  const taxClasses = new TaxClassRepository(db, clock)
  const storeService = new StoreService({ db, store: stores, taxClasses, auth, audit })
  const catalog = new CatalogRepository(db, clock)
  const products = new ProductRepository(db, clock)
  const inventory = new InventoryRepository(db, clock)
  const payments = new PaymentRepository(db, clock)
  const sales = new SalesRepository(db, clock, payments)
  const printers = new PrinterRepository(db, clock)
  const moduleService = new ModuleService({ db, modules: new ModuleRepository(db, clock), audit })
  const pricingService = new PricingService({ db, store: stores, taxClasses, audit })
  const inventoryService = new InventoryService({ db, inventory, store: stores, audit })
  const paymentService = new PaymentService({ db, payments, audit })
  const salesService = new SalesService({
    db,
    sales,
    payments: paymentService,
    pricing: pricingService,
    inventory: inventoryService,
    store: stores,
    audit
  })
  const printingService = new PrintingService({
    db,
    printers,
    sales,
    products,
    store: stores,
    modules: moduleService,
    audit
  })
  const supplierRepository = new SupplierRepository(db, clock)
  const purchaseRepository = new PurchaseRepository(db, clock)
  return {
    supplierRepository,
    supplierService: new SupplierService({ db, suppliers: supplierRepository, audit }),
    purchaseRepository,
    purchaseService: new PurchaseService({
      db,
      purchases: purchaseRepository,
      suppliers: supplierRepository,
      audit,
      currency: () => stores.get()?.currency ?? DEFAULT_CURRENCY
    }),
    taxClasses,
    catalog,
    products,
    inventory,
    payments,
    sales,
    printers,
    catalogService: new CatalogService({ db, catalog, taxClasses, audit }),
    pricingService,
    inventoryService,
    paymentService,
    salesService,
    printingService,
    productService: new ProductService({
      db,
      products,
      catalog,
      taxClasses,
      audit,
      currency: () => stores.get()?.currency ?? DEFAULT_CURRENCY,
      weighBarcodeConfig: () =>
        moduleService.isEnabled('grocery')
          ? printers.getWeighBarcodeSettings()
          : { enabled: false, weightPrefix: '20', pricePrefix: '21' }
    }),
    auth,
    userService,
    users,
    roles,
    overrides,
    throttle,
    hasher,
    clock,
    auditLog: audit,
    auditLogService: new AuditLogService(new AuditLogReader(db, clock)),
    storeService,
    stores,
    moduleService,
    actor: () => {
      const actor = auth.authorize('signed-in')
      if (!actor) throw new Error('authorize returned no actor')
      return actor
    },
    audit: () =>
      db.all(
        `SELECT action, user_id, approved_by_user_id, entity_id, details
         FROM audit_logs ORDER BY audit_log_id`
      )
  }
}

export const OWNER = { username: 'owner', displayName: 'Ravi Kumar', password: 'counter-top-42' }
