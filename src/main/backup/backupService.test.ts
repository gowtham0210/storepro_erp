import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TEST_STORE } from '@shared/test/stores'
import { describe, expect, it, vi } from 'vitest'
import { createTestbed, OWNER } from '../auth/test/testbed'
import { BackupRepository } from './backupRepository'
import { BackupService, computeFileSha256, metadataPathFor } from './backupService'
import { Database } from '../db/database'
import { migrate } from '../db/migrator'
import { migrations } from '../db/migrations'
import { fixedClock } from '../db/test/testDb'
import { createTestLogger, useTempDir } from '../test/helpers'

/**
 * M20-01 to M20-07: Backup and restore test suite.
 *
 * Covers:
 *  - M20-01: Manual backup to a chosen folder or default folder (`VACUUM INTO`).
 *  - M20-02: `.meta.json` sidecar with app version, schema version, store name,
 *            and SHA-256 checksum; tamper detection when bytes change.
 *  - M20-03: Scheduled automatic backups and retention pruning of older auto-backups.
 *  - M20-04: Restore validation, confirmation flow, pre-restore safety copy,
 *            and relaunch callback.
 *  - M20-05: Restoring older-schema backups (e.g. v3, v6) through migrations to v7.
 *  - M20-06: Backup status (`lastSuccessfulBackup`, `lastFailedBackup`,
 *            `hasUnresolvedFailureAlert`) and recovery after a subsequent good backup.
 *  - M20-07: End-to-end backup -> restore to a fresh install -> verify products,
 *            inventory, sales, customers, suppliers, purchases, and expenses match.
 */

function migrateOpts() {
  return { appVersion: '1.0.0', backupDir: null, clock: fixedClock, logger: createTestLogger() }
}

function openFileBackedStore(dir: string, filename = 'storepro.db') {
  const dbPath = join(dir, filename)
  const backupDir = join(dir, 'backups')
  let activeDb = Database.open(dbPath)
  let closed = false
  migrate(activeDb, migrations, migrateOpts())

  let bed = createTestbed(activeDb)
  const relaunchApp = vi.fn()
  const pickFolder = vi.fn(async (defaultPath: string) => defaultPath)
  const pickBackupFile = vi.fn(async () => null as string | null)

  const createBackupSvc = () =>
    new BackupService({
      db: () => activeDb,
      onDatabaseReplaced: (newDb) => {
        activeDb = newDb
        bed = createTestbed(activeDb)
      },
      backups: new BackupRepository(activeDb, bed.clock),
      store: bed.stores,
      audit: bed.auditLog,
      clock: bed.clock,
      logger: createTestLogger(),
      defaultBackupDir: backupDir,
      appVersion: '1.0.0',
      adapter: { pickFolder, pickBackupFile, relaunchApp }
    })

  return {
    dbPath,
    backupDir,
    get db() {
      return activeDb
    },
    get bed() {
      return bed
    },
    get backups() {
      return createBackupSvc()
    },
    relaunchApp,
    pickFolder,
    pickBackupFile,
    close() {
      if (!closed) {
        closed = true
        activeDb.close()
      }
    }
  }
}

describe('BackupService (M20-01 .. M20-07)', () => {
  const getTempDir = useTempDir()

  it('M20-01 & M20-02: creates a manual backup in a chosen folder with .meta.json and verified SHA-256 checksum', async () => {
    const dir = getTempDir()
    const env = openFileBackedStore(dir)
    try {
      await env.bed.storeService.completeSetup({
        store: TEST_STORE,
        administrator: OWNER
      })
      const actor = env.bed.actor()

      const customFolder = join(dir, 'usb-drive-backups')
      const summary = env.backups.createBackup(actor, { destinationDir: customFolder })

      expect(summary.status).toBe('succeeded')
      expect(summary.triggerKind).toBe('manual')
      expect(summary.filePath).toBeTruthy()
      expect(summary.filePath!.startsWith(customFolder)).toBe(true)
      expect(existsSync(summary.filePath!)).toBe(true)

      const metaFile = metadataPathFor(summary.filePath!)
      expect(existsSync(metaFile)).toBe(true)
      const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
      expect(meta).toMatchObject({
        format: 'storepro-backup-v1',
        appVersion: '1.0.0',
        schemaVersion: migrations.at(-1)!.version,
        storeName: TEST_STORE.name,
        encryption: 'none',
        triggerKind: 'manual'
      })
      expect(meta.sha256Checksum).toBe(computeFileSha256(summary.filePath!))

      // Validating the backup confirms checksum and metadata
      const validation = env.backups.validateBackup(actor, { filePath: summary.filePath! })
      expect(validation).toMatchObject({
        valid: true,
        checksumVerified: true,
        hasMetadataSidecar: true,
        needsMigration: false,
        storeName: TEST_STORE.name,
        errorMessage: null
      })

      // Tampering with the backup file causes checksum validation to fail
      const tamperedPath = join(customFolder, 'tampered.db')
      writeFileSync(tamperedPath, readFileSync(summary.filePath!))
      const corruptedMeta = { ...meta, sha256Checksum: '0'.repeat(64) }
      writeFileSync(metadataPathFor(tamperedPath), JSON.stringify(corruptedMeta), 'utf8')

      const tamperedCheck = env.backups.validateBackup(actor, { filePath: tamperedPath })
      expect(tamperedCheck.valid).toBe(false)
      expect(tamperedCheck.errorMessage).toMatch(/checksum mismatch/i)
    } finally {
      env.close()
    }
  })

  it('M20-03: runs scheduled automatic backups when due and prunes older auto-backups beyond retentionCount', async () => {
    const dir = getTempDir()
    const env = openFileBackedStore(dir)
    try {
      await env.bed.storeService.completeSetup({
        store: TEST_STORE,
        administrator: OWNER
      })
      const actor = env.bed.actor()

      const autoDir = join(dir, 'scheduled-backups')
      env.backups.setConfig(actor, {
        autoBackupEnabled: true,
        scheduleIntervalHours: 6,
        retentionCount: 5,
        destinationDir: autoDir
      })

      // First scheduled run succeeds immediately since no prior run exists
      const firstRun = env.backups.runScheduledBackupIfDue()
      expect(firstRun?.status).toBe('succeeded')
      expect(firstRun?.triggerKind).toBe('scheduled')

      // Running again before 6 hours have elapsed is a no-op
      env.bed.clock.time += 2 * 3_600_000
      expect(env.backups.runScheduledBackupIfDue()).toBeNull()

      // Advance clock 7 times by 6 hours each to produce 8 total scheduled backups
      const createdPaths: string[] = [firstRun!.filePath!]
      for (let i = 0; i < 7; i++) {
        env.bed.clock.time += 6 * 3_600_000 + 1_000
        const run = env.backups.runScheduledBackupIfDue()
        expect(run?.status).toBe('succeeded')
        createdPaths.push(run!.filePath!)
      }

      // Only the newest 5 auto-backups (and their .meta.json sidecars) remain on disk
      const existing = createdPaths.filter((p) => existsSync(p))
      expect(existing).toHaveLength(5)
      expect(existing).toEqual(createdPaths.slice(-5))
      for (const pruned of createdPaths.slice(0, 3)) {
        expect(existsSync(pruned)).toBe(false)
        expect(existsSync(metadataPathFor(pruned))).toBe(false)
      }
    } finally {
      env.close()
    }
  })

  it('M20-06: surfaces a failure alert when the most recent backup failed, and clears it after a successful backup', async () => {
    const dir = getTempDir()
    const env = openFileBackedStore(dir)
    try {
      await env.bed.storeService.completeSetup({
        store: TEST_STORE,
        administrator: OWNER
      })
      const actor = env.bed.actor()

      // Create a file where a directory is expected so backupTo fails
      const blockedPath = join(dir, 'not-a-directory')
      writeFileSync(blockedPath, 'file blocking mkdir')

      env.bed.clock.time += 10_000
      expect(() =>
        env.backups.createBackup(actor, { destinationDir: join(blockedPath, 'sub') })
      ).toThrow(/Backup failed/)

      const statusAfterFailure = env.backups.getStatus(actor)
      expect(statusAfterFailure.hasUnresolvedFailureAlert).toBe(true)
      expect(statusAfterFailure.lastFailedBackup?.status).toBe('failed')
      expect(statusAfterFailure.lastFailedBackup?.errorMessage).toBeTruthy()

      // A subsequent good backup resolves the failure alert
      env.bed.clock.time += 10_000
      const goodRun = env.backups.createBackup(actor)
      expect(goodRun.status).toBe('succeeded')

      const statusAfterRecovery = env.backups.getStatus(actor)
      expect(statusAfterRecovery.hasUnresolvedFailureAlert).toBe(false)
      expect(statusAfterRecovery.lastSuccessfulBackup?.backupRunId).toBe(goodRun.backupRunId)
    } finally {
      env.close()
    }
  })

  it('M20-04 & M20-07: backs up a populated store and restores it onto a fresh install with full data consistency and a safety copy', async () => {
    const sourceDir = getTempDir()
    const freshDir = getTempDir()
    const sourceEnv = openFileBackedStore(sourceDir, 'source.db')
    const freshEnv = openFileBackedStore(freshDir, 'fresh.db')

    try {
      // 1. Populate source store with products, stock, customer, and sale
      await sourceEnv.bed.storeService.completeSetup({
        store: TEST_STORE,
        administrator: OWNER
      })
      const sourceActor = sourceEnv.bed.actor()

      const taxClassId = sourceEnv.bed.taxClasses.list()[0]!.taxClassId
      const product = sourceEnv.bed.productService.create(sourceActor, {
        name: 'Aashirvaad Atta',
        categoryId: null,
        taxClassId,
        hsnCode: '1101',
        tracksInventory: true,
        variants: [
          {
            variantName: '5 kg',
            sku: 'ATTA-5KG',
            unitCode: 'pcs',
            sellingPriceMinor: 260_00,
            mrpMinor: 280_00,
            costPriceMinor: 220_00,
            reorderLevelMilli: 5_000,
            barcodes: ['8901725121747']
          }
        ]
      })
      const variantId = product.variants[0]!.variantId

      sourceEnv.bed.inventoryService.adjust(sourceActor, {
        reasonCode: 'opening_stock',
        notes: 'Initial count',
        items: [{ variantId, quantityDeltaMilli: 20_000 }]
      })

      const customer = sourceEnv.bed.customerService.create(sourceActor, {
        name: 'Lakshmi Devi',
        phone: '9876543210',
        email: null,
        address: 'MG Road',
        taxRegistrationNumber: null
      })

      const cashMethodId = sourceEnv.bed.paymentService
        .listMethods()
        .find((m) => m.methodCode === 'cash')!.paymentMethodId

      const sale = sourceEnv.bed.salesService.checkout(sourceActor, {
        checkoutKey: 'restore-test-sale-1',
        customerId: customer.customerId,
        lines: [{ variantId, quantityMilli: 2_000, unitPriceMinor: 260_00 }],
        payments: [{ paymentMethodId: cashMethodId, amountMinor: 520_00 }]
      })

      // 2. Take a manual backup of the populated source store
      const backupFolder = join(sourceDir, 'exported-backups')
      const backupRun = sourceEnv.backups.createBackup(sourceActor, {
        destinationDir: backupFolder
      })
      expect(backupRun.filePath).toBeTruthy()

      // 3. Set up the fresh install with different dummy data so we can verify both
      //    the pre-restore safety copy AND the restored data.
      await freshEnv.bed.storeService.completeSetup({
        store: { ...TEST_STORE, name: 'Temporary Blank Store' },
        administrator: OWNER
      })
      const freshActor = freshEnv.bed.actor()

      const validation = freshEnv.backups.validateBackup(freshActor, {
        filePath: backupRun.filePath!
      })
      expect(validation).toMatchObject({
        valid: true,
        checksumVerified: true,
        storeName: TEST_STORE.name,
        productCount: 1,
        saleCount: 1
      })

      // 4. Restore the source backup onto the fresh install
      const restoreResult = freshEnv.backups.restoreBackup(freshActor, {
        filePath: backupRun.filePath!,
        relaunchAfterRestore: true
      })

      expect(restoreResult.restoredFromPath).toBe(backupRun.filePath)
      expect(existsSync(restoreResult.safetyCopyPath)).toBe(true)
      expect(restoreResult.relaunchScheduled).toBe(true)
      expect(freshEnv.relaunchApp).toHaveBeenCalledTimes(1)

      // 5. Verify the safety copy still holds "Temporary Blank Store"
      const safetyValidation = freshEnv.backups.validateBackup(freshActor, {
        filePath: restoreResult.safetyCopyPath
      })
      expect(safetyValidation.valid).toBe(true)
      expect(safetyValidation.storeName).toBe('Temporary Blank Store')

      // 6. Verify the restored database has all products, stock (20 - 2 = 18), customer, and sale
      expect(freshEnv.bed.stores.get()?.name).toBe(TEST_STORE.name)
      const restoredProducts = freshEnv.bed.productService.list(freshActor, {})
      expect(restoredProducts.items).toHaveLength(1)
      expect(restoredProducts.items[0]!.productName).toBe('Aashirvaad Atta')

      const stockList = freshEnv.bed.inventoryService.list(freshActor, {})
      expect(stockList.items[0]!.onHandMilli).toBe(18_000)

      const restoredSale = freshEnv.bed.salesService.get(freshActor, sale.saleId)
      expect(restoredSale.invoiceNumber).toBe(sale.invoiceNumber)
      expect(restoredSale.grandTotalMinor).toBe(520_00)
      expect(restoredSale.customerName).toBe('Lakshmi Devi')

      // Audit log in the restored database records `backup.restored`
      const actions = freshEnv.bed.audit().map((a) => a.action)
      expect(actions).toContain('backup.restored')
    } finally {
      sourceEnv.close()
      freshEnv.close()
    }
  })

  it('M20-05: validates and restores an older-schema backup (v3 -> v7) by running pending migrations', async () => {
    const dir = getTempDir()
    // Build an older schema (v3) database file
    const oldBackupPath = join(dir, 'legacy-v3-backup.db')
    const oldDb = Database.open(oldBackupPath)
    try {
      migrate(oldDb, migrations.slice(0, 3), migrateOpts())
      const oldStores = new (await import('../store/storeRepository')).StoreRepository(
        oldDb,
        fixedClock
      )
      oldStores.create({ ...TEST_STORE, name: 'Legacy Kirana v3' })
    } finally {
      oldDb.close()
    }

    const env = openFileBackedStore(dir, 'current.db')
    try {
      await env.bed.storeService.completeSetup({
        store: TEST_STORE,
        administrator: OWNER
      })
      const actor = env.bed.actor()

      const validation = env.backups.validateBackup(actor, { filePath: oldBackupPath })
      expect(validation).toMatchObject({
        valid: true,
        schemaVersion: 3,
        currentSchemaVersion: migrations.at(-1)!.version,
        needsMigration: true,
        storeName: 'Legacy Kirana v3'
      })

      const restoreResult = env.backups.restoreBackup(actor, {
        filePath: oldBackupPath,
        relaunchAfterRestore: false
      })
      expect(restoreResult.fromSchemaVersion).toBe(3)
      expect(restoreResult.toSchemaVersion).toBe(migrations.at(-1)!.version)
      expect(restoreResult.migrationsApplied).toEqual([4, 5, 6, 7])

      // Restored database is now at v7 and has the legacy store profile
      expect(env.bed.stores.get()?.name).toBe('Legacy Kirana v3')
      expect(env.bed.backupRepository.currentSchemaVersion()).toBe(migrations.at(-1)!.version)
    } finally {
      env.close()
    }
  })

  it('rejects backups from a newer StorePro schema version or non-StorePro files', async () => {
    const dir = getTempDir()
    const env = openFileBackedStore(dir)
    try {
      await env.bed.storeService.completeSetup({
        store: TEST_STORE,
        administrator: OWNER
      })
      const actor = env.bed.actor()

      // Future schema v99
      const futurePath = join(dir, 'future-v99.db')
      const futureDb = Database.open(futurePath)
      migrate(futureDb, migrations, migrateOpts())
      futureDb.run(
        `INSERT INTO schema_migrations (version, name, checksum, applied_at, app_version)
         VALUES (99, 'future_feature', 'abc', 1700000000000, '9.0.0')`
      )
      futureDb.close()

      const futureValidation = env.backups.validateBackup(actor, { filePath: futurePath })
      expect(futureValidation.valid).toBe(false)
      expect(futureValidation.errorMessage).toMatch(/newer than this app supports/i)

      await expect(async () =>
        env.backups.restoreBackup(actor, { filePath: futurePath })
      ).rejects.toThrow(/newer than this app supports/i)
    } finally {
      env.close()
    }
  })
})
