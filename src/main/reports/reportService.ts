import type {
  DailySalesRow,
  ExpensesReport,
  ReportExportRequest,
  ReportExportResult,
  PurchasesReport,
  PurchasesReportFilter,
  StockMovementsFilter,
  StockMovementsReport,
  StockReport,
  StockReportFilter,
  PaymentTotal,
  SalesReport,
  SalesSummary,
  TopProductRank,
  TopProductsReport
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { toCsv } from '@shared/csv'
import {
  expensesCsvRows,
  movementsCsvRows,
  purchasesCsvRows,
  salesCsvRows,
  stockCsvRows,
  topProductsCsvRows,
  type CsvContext
} from '@shared/reportCsv'
import { averageBill } from '@shared/reports'
import { addDays, businessDateOf, businessDayRange } from '@shared/storeTime'
import type { AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import type { Clock } from '../lib/clock'
import type { FileSaver } from './fileSaver'
import type { StoreRepository } from '../store/storeRepository'
import type { MethodMoney, ReportRepository } from './reportRepository'

export interface ReportServiceDeps {
  reports: ReportRepository
  store: StoreRepository
  audit: AuditLog
  clock: Clock
  files: FileSaver
}

/** The most rows one export will gather; a longer period must be split. */
export const MAX_EXPORT_ROWS = 500_000

const EXPORT_LABELS: Record<ReportExportRequest['report'], string> = {
  sales: 'Sales',
  'top-products': 'Top items',
  stock: 'Stock',
  'stock-movements': 'Stock movements',
  purchases: 'Purchases',
  expenses: 'Expenses'
}

const DEFAULT_TOP_PRODUCTS = 20
const DEFAULT_PAGE_SIZE = 100

/**
 * Reports and the dashboard (M19). Read-only: each report reads finalised
 * transactions through the ledger views and the store's day boundaries, and
 * never writes. What each figure means is defined in `src/shared/reports.ts`.
 */
export class ReportService {
  constructor(private readonly deps: ReportServiceDeps) {}

  /** M19-03, M19-04: the sales figures for a period, in total and for each day. */
  sales(actor: Actor, range: { from: string; to: string }): SalesReport {
    assertCan(actor, 'report.view')
    const timeZone = this.timeZone()
    const { from, to } = businessDayRange(range.from, range.to, timeZone)
    const { reports } = this.deps

    const totals = reports.salesTotals(from, to)
    const returns = reports.returnFigures(from, to)
    const refundsMinor = returns.reduce((sum, r) => sum + r.refundDueMinor, 0)
    const refundedTaxMinor = returns.reduce((sum, r) => sum + r.taxMinor, 0)
    const payments = this.paymentTotals(
      reports.collections(from, to),
      reports.refundPayouts(from, to)
    )

    const summary: SalesSummary = {
      billCount: totals.billCount,
      grossMinor: totals.grossMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      roundOffMinor: totals.roundOffMinor,
      billedMinor: totals.billedMinor,
      averageBillMinor: averageBill(totals.billedMinor, totals.billCount),
      refundCount: returns.length,
      refundsMinor,
      refundedTaxMinor,
      netSalesMinor: totals.billedMinor - refundsMinor,
      voidedCount: totals.voidedCount,
      voidedMinor: totals.voidedMinor,
      payments,
      collectedMinor: payments.reduce((sum, p) => sum + p.collectedMinor, 0),
      paidBackMinor: payments.reduce((sum, p) => sum + p.refundedMinor, 0),
      netCollectedMinor: payments.reduce((sum, p) => sum + p.netMinor, 0)
    }

    // One row for every date, so a quiet day shows as zeros instead of vanishing.
    const days = new Map<string, DailySalesRow>()
    for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
      days.set(date, {
        date,
        billCount: 0,
        grossMinor: 0,
        discountMinor: 0,
        taxMinor: 0,
        billedMinor: 0,
        refundsMinor: 0,
        netSalesMinor: 0
      })
    }
    for (const sale of reports.saleFigures(from, to)) {
      const row = days.get(businessDateOf(sale.completedAt, timeZone))
      if (!row) continue
      row.billCount += 1
      row.grossMinor += sale.grossMinor
      row.discountMinor += sale.discountMinor
      row.taxMinor += sale.taxMinor
      row.billedMinor += sale.billedMinor
    }
    for (const ret of returns) {
      const row = days.get(businessDateOf(ret.returnedAt, timeZone))
      if (row) row.refundsMinor += ret.refundDueMinor
    }
    for (const row of days.values()) row.netSalesMinor = row.billedMinor - row.refundsMinor

    return { from: range.from, to: range.to, summary, days: [...days.values()] }
  }

  /** M19-05: top-selling items by quantity or by value. */
  topProducts(
    actor: Actor,
    input: { from: string; to: string; rankBy: TopProductRank; limit?: number | undefined }
  ): TopProductsReport {
    assertCan(actor, 'report.view')
    const { from, to } = businessDayRange(input.from, input.to, this.timeZone())
    return {
      from: input.from,
      to: input.to,
      rankBy: input.rankBy,
      items: this.deps.reports.topProducts(
        from,
        to,
        input.rankBy,
        input.limit ?? DEFAULT_TOP_PRODUCTS
      )
    }
  }

  /** M19-06: stock on hand and what it is worth at cost, with the low and out-of-stock counts. */
  stock(actor: Actor, filter: StockReportFilter = {}): StockReport {
    assertCan(actor, 'report.view')
    return this.deps.reports.stock({
      ...filter,
      offset: filter.offset ?? 0,
      limit: filter.limit ?? DEFAULT_PAGE_SIZE
    })
  }

  /** M19-06: every stock movement in the period, across all items. */
  stockMovements(actor: Actor, filter: StockMovementsFilter): StockMovementsReport {
    assertCan(actor, 'report.view')
    const { from, to } = businessDayRange(filter.from, filter.to, this.timeZone())
    const page = this.deps.reports.stockMovements(from, to, {
      movementType: filter.movementType,
      offset: filter.offset ?? 0,
      limit: filter.limit ?? DEFAULT_PAGE_SIZE
    })
    return { from: filter.from, to: filter.to, ...page }
  }

  /** M19-07: posted goods receipts in the period, by supplier and one by one. */
  purchases(actor: Actor, filter: PurchasesReportFilter): PurchasesReport {
    assertCan(actor, 'report.view')
    const { from, to } = businessDayRange(filter.from, filter.to, this.timeZone())
    const { reports } = this.deps
    const bySupplier = reports.purchasesBySupplier(from, to, filter.supplierId)
    return {
      from: filter.from,
      to: filter.to,
      receiptCount: bySupplier.reduce((sum, row) => sum + row.receiptCount, 0),
      totalMinor: bySupplier.reduce((sum, row) => sum + row.totalMinor, 0),
      bySupplier,
      receipts: reports.purchaseReceipts(from, to, {
        supplierId: filter.supplierId,
        offset: filter.offset ?? 0,
        limit: filter.limit ?? DEFAULT_PAGE_SIZE
      })
    }
  }

  /** M19-08: expenses dated in the period, by category and by how they were paid. */
  expenses(actor: Actor, range: { from: string; to: string }): ExpensesReport {
    assertCan(actor, 'report.view')
    // Expenses carry a business date, not an instant, so no time zone conversion is needed.
    return {
      from: range.from,
      to: range.to,
      ...this.deps.reports.expenseTotals(range.from, range.to)
    }
  }

  /**
   * M22-03: save a report as a CSV file. The file is built from the same report
   * the screen shows (all of it, not just the page on screen), so its figures
   * reconcile with what was seen. The person chooses where it goes; cancelling
   * the dialog writes nothing and is not an error.
   */
  async exportReport(actor: Actor, request: ReportExportRequest): Promise<ReportExportResult> {
    assertCan(actor, 'report.view')
    assertCan(actor, 'data.export')
    const store = this.deps.store.get()
    if (!store) throw new AppError('SETUP_REQUIRED', 'Set up the store before exporting reports')
    const ctx: CsvContext = { currency: store.currency, timeZone: store.timeZone }
    const { fileName, rows, dataRows, period } = this.buildExport(actor, request, ctx)

    const saved = await this.deps.files.saveText(fileName, toCsv(rows))
    if (!saved) return { status: 'cancelled' }
    this.deps.audit.event({
      action: 'report.exported',
      actor,
      details: {
        report: EXPORT_LABELS[request.report],
        ...(period ? { period } : {}),
        rows: dataRows,
        file: saved.fileName
      }
    })
    return { status: 'saved', fileName: saved.fileName, rows: dataRows }
  }

  private buildExport(actor: Actor, request: ReportExportRequest, ctx: CsvContext) {
    const { reports } = this.deps
    const span = (from: string, to: string) => (from === to ? from : `${from}_to_${to}`)
    const tooMany = (what: string): never => {
      throw new AppError(
        'VALIDATION_FAILED',
        `There are too many ${what} to export at once. Choose a shorter period.`
      )
    }
    switch (request.report) {
      case 'sales': {
        const report = this.sales(actor, request)
        return {
          fileName: `sales_${span(request.from, request.to)}.csv`,
          rows: salesCsvRows(report, ctx),
          dataRows: report.days.length,
          period: `${request.from} to ${request.to}`
        }
      }
      case 'top-products': {
        const range = businessDayRange(request.from, request.to, ctx.timeZone)
        const report = {
          from: request.from,
          to: request.to,
          rankBy: request.rankBy,
          items: reports.topProducts(range.from, range.to, request.rankBy, 5000)
        }
        return {
          fileName: `top-items_${span(request.from, request.to)}.csv`,
          rows: topProductsCsvRows(report, ctx),
          dataRows: report.items.length,
          period: `${request.from} to ${request.to}`
        }
      }
      case 'stock': {
        const result = reports.stock({
          search: request.search,
          categoryId: request.categoryId,
          level: request.level,
          offset: 0,
          limit: MAX_EXPORT_ROWS
        })
        const today = businessDateOf(this.deps.clock.now(), ctx.timeZone)
        return {
          fileName: `stock_${today}.csv`,
          rows: stockCsvRows(result.items, result.totals, ctx),
          dataRows: result.items.length,
          period: undefined
        }
      }
      case 'stock-movements': {
        const range = businessDayRange(request.from, request.to, ctx.timeZone)
        const filter = { movementType: request.movementType, offset: 0, limit: MAX_EXPORT_ROWS }
        const page = reports.stockMovements(range.from, range.to, filter)
        if (page.total > MAX_EXPORT_ROWS) tooMany('stock movements')
        return {
          fileName: `stock-movements_${span(request.from, request.to)}.csv`,
          rows: movementsCsvRows({ from: request.from, to: request.to, ...page }, ctx),
          dataRows: page.items.length,
          period: `${request.from} to ${request.to}`
        }
      }
      case 'purchases': {
        const range = businessDayRange(request.from, request.to, ctx.timeZone)
        const bySupplier = reports.purchasesBySupplier(range.from, range.to, request.supplierId)
        const receiptCount = bySupplier.reduce((sum, row) => sum + row.receiptCount, 0)
        if (receiptCount > MAX_EXPORT_ROWS) tooMany('receipts')
        const receipts = reports.purchaseReceipts(range.from, range.to, {
          supplierId: request.supplierId,
          offset: 0,
          limit: MAX_EXPORT_ROWS
        })
        const report = {
          from: request.from,
          to: request.to,
          receiptCount,
          totalMinor: bySupplier.reduce((sum, row) => sum + row.totalMinor, 0),
          bySupplier,
          receipts
        }
        return {
          fileName: `purchases_${span(request.from, request.to)}.csv`,
          rows: purchasesCsvRows(report, ctx),
          dataRows: receipts.length,
          period: `${request.from} to ${request.to}`
        }
      }
      case 'expenses': {
        const report = this.expenses(actor, request)
        return {
          fileName: `expenses_${span(request.from, request.to)}.csv`,
          rows: expensesCsvRows(report, ctx),
          dataRows: report.byCategory.length,
          period: `${request.from} to ${request.to}`
        }
      }
    }
  }

  private paymentTotals(collected: MethodMoney[], refunded: MethodMoney[]): PaymentTotal[] {
    const byMethod = new Map<number, PaymentTotal>()
    const entry = (money: MethodMoney): PaymentTotal => {
      let total = byMethod.get(money.paymentMethodId)
      if (!total) {
        total = {
          paymentMethodId: money.paymentMethodId,
          methodName: money.methodName,
          kind: money.kind,
          collectedMinor: 0,
          refundedMinor: 0,
          netMinor: 0
        }
        byMethod.set(money.paymentMethodId, total)
      }
      return total
    }
    for (const money of collected) entry(money).collectedMinor = money.amountMinor
    for (const money of refunded) entry(money).refundedMinor = money.amountMinor
    for (const total of byMethod.values())
      total.netMinor = total.collectedMinor - total.refundedMinor
    return [...byMethod.values()].sort(
      (a, b) => b.collectedMinor - a.collectedMinor || a.methodName.localeCompare(b.methodName)
    )
  }

  private timeZone(): string {
    const store = this.deps.store.get()
    if (!store) throw new AppError('SETUP_REQUIRED', 'Set up the store before running reports')
    return store.timeZone
  }
}
