import type { CategorySummary, TaxClassSummary, UnitInfo } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import type { AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import type { Database } from '../db/database'
import type { CatalogRepository } from './catalogRepository'
import type { TaxClassRepository } from './taxClassRepository'

export interface CatalogServiceDeps {
  db: Database
  catalog: CatalogRepository
  taxClasses: TaxClassRepository
  audit: AuditLog
}

export function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, [{ path, message }])
}

/**
 * The catalogue's reference data (M09-01): categories and units of measure,
 * and the tax classes products choose from. Categories are archived, never
 * deleted, so products filed under them keep their history.
 */
export class CatalogService {
  constructor(private readonly deps: CatalogServiceDeps) {}

  listCategories(actor: Actor): CategorySummary[] {
    assertCan(actor, 'product.view')
    return this.deps.catalog.listCategories()
  }

  createCategory(actor: Actor, { name }: { name: string }): CategorySummary {
    assertCan(actor, 'product.manage')
    const { db, catalog, audit } = this.deps
    const categoryId = db.transaction(() => {
      this.assertCategoryNameFree(name, null)
      const id = catalog.createCategory(name)
      audit.change({
        action: 'category.created',
        actor,
        entity: { type: 'category', id },
        details: { name }
      })
      return id
    })
    return this.requireCategory(categoryId)
  }

  renameCategory(actor: Actor, input: { categoryId: number; name: string }): CategorySummary {
    assertCan(actor, 'product.manage')
    const { db, catalog, audit } = this.deps
    db.transaction(() => {
      const before = this.requireCategory(input.categoryId)
      if (before.name === input.name) return
      this.assertCategoryNameFree(input.name, input.categoryId)
      catalog.renameCategory(input.categoryId, input.name)
      audit.change({
        action: 'category.updated',
        actor,
        entity: { type: 'category', id: input.categoryId },
        details: { changes: { name: { from: before.name, to: input.name } } }
      })
    })
    return this.requireCategory(input.categoryId)
  }

  /** Archived categories stay on their products but can't be chosen for new ones. */
  setCategoryActive(
    actor: Actor,
    { categoryId, active }: { categoryId: number; active: boolean }
  ): CategorySummary {
    assertCan(actor, 'product.manage')
    const { db, catalog, audit } = this.deps
    db.transaction(() => {
      const before = this.requireCategory(categoryId)
      if (before.active === active) return
      catalog.setCategoryActive(categoryId, active)
      audit.change({
        action: active ? 'category.restored' : 'category.archived',
        actor,
        entity: { type: 'category', id: categoryId },
        details: { name: before.name }
      })
    })
    return this.requireCategory(categoryId)
  }

  listUnits(actor: Actor): UnitInfo[] {
    assertCan(actor, 'product.view')
    return this.deps.catalog.listUnits()
  }

  createUnit(
    actor: Actor,
    unit: { unitCode: string; name: string; allowsFraction: boolean }
  ): UnitInfo {
    assertCan(actor, 'product.manage')
    const { db, catalog, audit } = this.deps
    db.transaction(() => {
      if (catalog.findUnit(unit.unitCode)) {
        throw conflict('unitCode', `There is already a unit with the code “${unit.unitCode}”`)
      }
      if (catalog.findUnitByName(unit.name)) {
        throw conflict('name', `There is already a unit called “${unit.name}”`)
      }
      catalog.createUnit(unit)
      audit.change({
        action: 'unit.created',
        actor,
        details: {
          code: unit.unitCode,
          name: unit.name,
          fractions: unit.allowsFraction ? 'yes' : 'no'
        }
      })
    })
    return this.requireUnit(unit.unitCode)
  }

  /** Only the name can change: the code is stored on every bill line, and the fraction rule on stock. */
  renameUnit(actor: Actor, { unitCode, name }: { unitCode: string; name: string }): UnitInfo {
    assertCan(actor, 'product.manage')
    const { db, catalog, audit } = this.deps
    db.transaction(() => {
      const before = this.requireUnit(unitCode)
      if (before.name === name) return
      const other = catalog.findUnitByName(name)
      if (other && other.unitCode !== unitCode) {
        throw conflict('name', `There is already a unit called “${name}”`)
      }
      catalog.renameUnit(unitCode, name)
      audit.change({
        action: 'unit.updated',
        actor,
        details: { code: unitCode, changes: { name: { from: before.name, to: name } } }
      })
    })
    return this.requireUnit(unitCode)
  }

  listTaxClasses(actor: Actor): TaxClassSummary[] {
    assertCan(actor, 'product.view')
    return this.deps.taxClasses.list()
  }

  private assertCategoryNameFree(name: string, exceptId: number | null): void {
    const other = this.deps.catalog.findCategoryByName(name)
    if (other && other.categoryId !== exceptId) {
      throw conflict(
        'name',
        other.active
          ? `There is already a category called “${other.name}”`
          : `There is an archived category called “${other.name}”. Restore it instead.`
      )
    }
  }

  private requireCategory(categoryId: number): CategorySummary {
    const category = this.deps.catalog.findCategory(categoryId)
    if (!category) throw new AppError('NOT_FOUND', 'That category no longer exists.')
    return category
  }

  private requireUnit(unitCode: string): UnitInfo {
    const unit = this.deps.catalog.findUnit(unitCode)
    if (!unit) throw new AppError('NOT_FOUND', 'That unit no longer exists.')
    return unit
  }
}

export function conflict(path: string, message: string): AppError {
  return new AppError('CONFLICT', message, [{ path, message }])
}
