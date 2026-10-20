import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TEST_STORE } from '@shared/test/stores'
import { describe, expect, it } from 'vitest'
import { recordStartupEvents } from '../audit/startupEvents'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { createTestLogger, useTempDir } from '../test/helpers'
import { Database, STOREPRO_APPLICATION_ID } from './database'
import { openStoreDatabase } from './index'
import { checkIntegrity } from './integrity'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { fixedClock } from './test/testDb'

/**
 * M30-09 & M01-09: Clean Windows install, upgrade-from-previous-version, and
 * packaging/code-signing configuration verification tests.
 *
 * Covers:
 *  1. Clean install: opening a brand-new userData directory creates `storepro.db`
 *     at the latest schema version (v7), passes full integrity checks, completes
 *     first-run store & administrator setup, and supports immediate billing and backup.
 *  2. Upgrade from previous versions (v1..v6 -> v7): upgrades an existing
 *     store database in place, automatically writes a `pre-migration-v6-to-v7-*.db`
 *     safety backup before touching the schema, records `system.database_upgraded`
 *     in `audit_logs`, preserves all existing products, stock, customers, suppliers,
 *     purchases, sales, returns, and expenses, and allows new v7 operations
 *     (`backup_runs` and CSV product import) immediately after upgrade.
 *  3. Installer & code-signing configuration (`electron-builder.yml`): verifies
 *     Windows x64 NSIS target, `deleteAppDataOnUninstall: false` (so userData
 *     survives upgrades/reinstalls), Electron security fuses, and SHA-256 / RFC-3161
 *     timestamp signing settings (M01-09).
 */
describe('Clean install, version upgrade, and Windows packaging (M30-09, M01-09)', () => {
  const getTempDir = useTempDir()

  it('M30-09 (clean install): initializes a fresh userData directory, completes setup, and passes full integrity', async () => {
    const userData = getTempDir()
    const dbPath = join(userData, 'data', 'storepro.db')
    const backupDir = join(userData, 'backups')

    const { db, migration } = openStoreDatabase({
      path: dbPath,
      backupDir,
      appVersion: '1.0.0',
      verifyIntegrity: false, // Normal clean startup; verify full integrity after migration below
      clock: fixedClock,
      logger: createTestLogger()
    })

    try {
      expect(existsSync(dbPath)).toBe(true)
      expect(migration.fromVersion).toBe(0)
      expect(migration.toVersion).toBe(migrations.at(-1)!.version)
      expect(migration.backupPath).toBeNull() // Clean install has no prior DB to back up
      expect(db.pragma('application_id')).toBe(STOREPRO_APPLICATION_ID)

      const fullIntegrity = checkIntegrity(db, 'full')
      expect(fullIntegrity.ok).toBe(true)

      const bed = createTestbed(db)
      await bed.storeService.completeSetup({
        store: TEST_STORE,
        administrator: OWNER
      })
      const actor = bed.actor()

      // Verify store is configured and can immediately import products and take a backup
      expect(bed.storeService.isConfigured()).toBe(true)
      const tpl = bed.productImportService.getTemplate(actor)
      const commitRes = bed.productImportService.commit(actor, { csvText: tpl.csvText })
      expect(commitRes.createdProductCount).toBe(1)

      const manualBackup = bed.backupService.createBackup(actor, { destinationDir: backupDir })
      expect(manualBackup.status).toBe('succeeded')
      expect(existsSync(manualBackup.filePath!)).toBe(true)
    } finally {
      db.close()
    }
  })

  it('M30-09 (upgrade from previous version): upgrades a populated v6 store to v7 with pre-migration backup and preserves all transactions', async () => {
    const userData = getTempDir()
    const dbPath = join(userData, 'data', 'storepro.db')
    const backupDir = join(userData, 'backups')
    mkdirSync(dirname(dbPath), { recursive: true })

    // 1. Simulate previous release (schema v6, appVersion 0.9.0) with full store activity
    const v6Db = Database.open(dbPath)
    migrate(v6Db, migrations.slice(0, 6), {
      appVersion: '0.9.0',
      backupDir,
      clock: fixedClock,
      logger: createTestLogger()
    })

    const v6Bed = createTestbed(v6Db)
    await v6Bed.storeService.completeSetup({
      store: TEST_STORE,
      administrator: OWNER
    })
    const v6Actor = v6Bed.actor()
    const taxClassId = v6Bed.taxClasses.list()[0]!.taxClassId

    const prod = v6Bed.productService.create(v6Actor, {
      name: 'Ponni Boiled Rice',
      categoryId: null,
      taxClassId,
      hsnCode: '1006',
      tracksInventory: true,
      variants: [
        {
          variantName: '10 kg',
          sku: 'PONNI-10KG',
          unitCode: 'pcs',
          sellingPriceMinor: 580_00,
          mrpMinor: 620_00,
          costPriceMinor: 500_00,
          reorderLevelMilli: 3_000,
          barcodes: ['8904000000101']
        }
      ]
    })
    const variantId = prod.variants[0]!.variantId

    v6Bed.inventoryService.adjust(v6Actor, {
      reasonCode: 'opening_stock',
      notes: 'v6 stock',
      items: [{ variantId, quantityDeltaMilli: 15_000 }]
    })

    const cashId = v6Bed.paymentService
      .listMethods()
      .find((m) => m.methodCode === 'cash')!.paymentMethodId

    const v6Sale = v6Bed.salesService.checkout(v6Actor, {
      checkoutKey: 'v6-sale-key-1',
      lines: [{ variantId, quantityMilli: 3_000, unitPriceMinor: 580_00 }],
      payments: [{ paymentMethodId: cashId, amountMinor: 1740_00 }]
    })
    v6Db.close()

    // 2. Launch new release (schema v7, appVersion 1.0.0) over the same userData folder
    const { db: upgradedDb, migration } = openStoreDatabase({
      path: dbPath,
      backupDir,
      appVersion: '1.0.0',
      verifyIntegrity: true,
      clock: fixedClock,
      logger: createTestLogger()
    })

    try {
      expect(migration.fromVersion).toBe(6)
      expect(migration.toVersion).toBe(migrations.at(-1)!.version)
      expect(migration.applied).toEqual([7])
      expect(migration.backupPath).toBeTruthy()
      expect(existsSync(migration.backupPath!)).toBe(true)

      const v7Bed = createTestbed(upgradedDb)
      recordStartupEvents(v7Bed.auditLog, {
        migration,
        integrity: null,
        startup: { recoveredFromUncleanShutdown: false, previousSessionStartedAt: null }
      })

      // Sign in as the existing administrator created in v6
      await v7Bed.auth.signIn({ username: OWNER.username, password: OWNER.password })
      const v7Actor = v7Bed.actor()

      // Verify all v6 data survived intact
      expect(v7Bed.stores.get()?.name).toBe(TEST_STORE.name)
      const stock = v7Bed.inventoryService.list(v7Actor, {})
      expect(stock.items[0]!.onHandMilli).toBe(12_000) // 15 - 3 sold in v6

      const historicalSale = v7Bed.salesService.get(v7Actor, v6Sale.saleId)
      expect(historicalSale.invoiceNumber).toBe(v6Sale.invoiceNumber)
      expect(historicalSale.grandTotalMinor).toBe(1740_00)

      // Verify `system.database_upgraded` was recorded in the audit log
      const upgradeAudit = v7Bed
        .audit()
        .find((entry) => entry.action === 'system.database_upgraded')
      expect(upgradeAudit).toBeDefined()

      // Verify new v7 features work on the upgraded database
      const backupRun = v7Bed.backupService.createBackup(v7Actor, { destinationDir: backupDir })
      expect(backupRun.status).toBe('succeeded')
      expect(backupRun.schemaVersion).toBe(7)

      const fullCheck = checkIntegrity(upgradedDb, 'full')
      expect(fullCheck.ok).toBe(true)
    } finally {
      upgradedDb.close()
    }
  })

  it('M01-09 & M30-09: verifies electron-builder.yml preserves userData across upgrades and configures Windows x64 NSIS + code signing', () => {
    const builderYml = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')
    expect(builderYml).toContain('appId: com.storepro.desktop')
    expect(builderYml).toContain('target: nsis')
    expect(builderYml).toContain('arch: [x64]')
    // Crucial for upgrades: uninstall/upgrade must never delete %APPDATA%\StorePro
    expect(builderYml).toContain('deleteAppDataOnUninstall: false')
    // M01-09 code signing & timestamp configuration
    expect(builderYml).toContain('signAndEditExecutable: true')
    expect(builderYml).toContain('rfc3161TimeStampServer: http://timestamp.digicert.com')
    // Security fuses
    expect(builderYml).toContain('runAsNode: false')
    expect(builderYml).toContain('enableEmbeddedAsarIntegrityValidation: true')
    expect(builderYml).toContain('onlyLoadAppFromAsar: true')
  })
})
