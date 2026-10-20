/**
 * Report exports as CSV tables (M22-03, FR-095).
 *
 * Each export is built from the same report object the screen shows, never
 * from a second query, so the figures reconcile: the Total row of the sales
 * export is the summary line on screen. Money is written as plain decimals
 * (`1249.00`, no symbol or grouping) and quantities without trailing zeros, so
 * a spreadsheet reads them as numbers. Times are the store's own.
 */
import type {
  ExpensesReport,
  PurchasesReport,
  SalesReport,
  StockMovementsReport,
  StockReportRow,
  StockReportTotals,
  TopProductsReport
} from './ipc/contract'
import type { CsvCell } from './csv'
import { toDecimalString } from './money'
import { formatQuantity } from './quantity'
import { REPORT_METRICS } from './reports'
import { businessDateOf, formatStoreTime } from './storeTime'

export interface CsvContext {
  currency: { minorUnits: number }
  timeZone: string
}

type Table = CsvCell[][]

const MOVEMENT_LABELS: Record<string, string> = {
  sale: 'Sale',
  sale_void: 'Sale voided',
  sale_return: 'Customer return',
  goods_receipt: 'Goods received',
  adjustment: 'Adjustment'
}

function money(minor: number, ctx: CsvContext): string {
  return toDecimalString(minor, ctx.currency.minorUnits)
}

/** Tables, one after another, with a blank row between them. */
function sections(...tables: Table[]): Table {
  return tables.flatMap((table, index) => (index === 0 ? table : [[], ...table]))
}

export function salesCsvRows(report: SalesReport, ctx: CsvContext): Table {
  const m = (minor: number) => money(minor, ctx)
  const s = report.summary
  return sections(
    [
      [
        'Date',
        REPORT_METRICS.bills.label,
        REPORT_METRICS.grossSales.label,
        REPORT_METRICS.discounts.label,
        REPORT_METRICS.tax.label,
        REPORT_METRICS.billed.label,
        REPORT_METRICS.refunds.label,
        REPORT_METRICS.netSales.label
      ],
      ...report.days.map((d) => [
        d.date,
        d.billCount,
        m(d.grossMinor),
        m(d.discountMinor),
        m(d.taxMinor),
        m(d.billedMinor),
        m(d.refundsMinor),
        m(d.netSalesMinor)
      ]),
      [
        'Total',
        s.billCount,
        m(s.grossMinor),
        m(s.discountMinor),
        m(s.taxMinor),
        m(s.billedMinor),
        m(s.refundsMinor),
        m(s.netSalesMinor)
      ]
    ],
    [
      [
        'Payment method',
        REPORT_METRICS.collections.label,
        REPORT_METRICS.refundPayouts.label,
        REPORT_METRICS.netCollections.label
      ],
      ...s.payments.map((p) => [
        p.methodName,
        m(p.collectedMinor),
        m(p.refundedMinor),
        m(p.netMinor)
      ]),
      ['Total', m(s.collectedMinor), m(s.paidBackMinor), m(s.netCollectedMinor)]
    ],
    [
      ['Other figures', 'Count', 'Amount'],
      [REPORT_METRICS.voided.label, s.voidedCount, m(s.voidedMinor)],
      [REPORT_METRICS.refundedTax.label, s.refundCount, m(s.refundedTaxMinor)],
      [REPORT_METRICS.averageBill.label, '', m(s.averageBillMinor)],
      [REPORT_METRICS.roundOff.label, '', m(s.roundOffMinor)]
    ]
  )
}

export function topProductsCsvRows(report: TopProductsReport, ctx: CsvContext): Table {
  return [
    [
      'Item',
      'SKU',
      'Unit',
      'Sold',
      'Returned',
      'Net quantity',
      'Sold value',
      'Returned value',
      'Net value'
    ],
    ...report.items.map((r) => [
      r.name,
      r.sku,
      r.unitCode,
      formatQuantity(r.soldMilli),
      formatQuantity(r.returnedMilli),
      formatQuantity(r.netMilli),
      money(r.soldValueMinor, ctx),
      money(r.returnedValueMinor, ctx),
      money(r.netValueMinor, ctx)
    ])
  ]
}

export function stockCsvRows(
  items: readonly StockReportRow[],
  totals: StockReportTotals,
  ctx: CsvContext
): Table {
  return [
    [
      'Item',
      'SKU',
      'Category',
      'Unit',
      'In stock',
      'Low-stock level',
      'Cost each',
      'Value at cost',
      'Status'
    ],
    ...items.map((r) => [
      r.name,
      r.sku,
      r.categoryName,
      r.unitCode,
      formatQuantity(r.onHandMilli),
      r.reorderLevelMilli === null ? '' : formatQuantity(r.reorderLevelMilli),
      r.costPriceMinor === null ? '' : money(r.costPriceMinor, ctx),
      r.valueMinor === null ? '' : money(r.valueMinor, ctx),
      r.onHandMilli <= 0 ? 'Out of stock' : r.isLow ? 'Low stock' : 'OK'
    ]),
    ['Total', '', '', '', '', '', '', money(totals.valueMinor, ctx), '']
  ]
}

export function movementsCsvRows(report: StockMovementsReport, ctx: CsvContext): Table {
  return [
    ['Date', 'Time', 'What happened', 'Item', 'SKU', 'Unit', 'Change', 'Document'],
    ...report.items.map((r) => [
      businessDateOf(r.occurredAt, ctx.timeZone),
      formatStoreTime(r.occurredAt, ctx.timeZone, 'time'),
      MOVEMENT_LABELS[r.movementType] ?? r.movementType,
      r.name,
      r.sku,
      r.unitCode,
      formatQuantity(r.quantityDeltaMilli),
      r.documentNumber
    ])
  ]
}

export function purchasesCsvRows(report: PurchasesReport, ctx: CsvContext): Table {
  return sections(
    [
      ['Supplier', 'Receipts', 'Bought for'],
      ...report.bySupplier.map((r) => [r.supplierName, r.receiptCount, money(r.totalMinor, ctx)]),
      ['Total', report.receiptCount, money(report.totalMinor, ctx)]
    ],
    [
      ['Receipt', 'Date', 'Time', 'Supplier', 'Order', 'Supplier bill', 'Total'],
      ...report.receipts.map((r) => [
        r.receiptNumber,
        businessDateOf(r.postedAt, ctx.timeZone),
        formatStoreTime(r.postedAt, ctx.timeZone, 'time'),
        r.supplierName,
        r.orderNumber ?? '',
        r.supplierInvoiceNumber ?? '',
        money(r.totalMinor, ctx)
      ])
    ]
  )
}

export function expensesCsvRows(report: ExpensesReport, ctx: CsvContext): Table {
  return sections(
    [
      ['Category', 'Expenses', 'Total'],
      ...report.byCategory.map((r) => [r.name, r.count, money(r.totalMinor, ctx)]),
      ['Total', report.count, money(report.totalMinor, ctx)]
    ],
    [
      ['Paid by', 'Expenses', 'Total'],
      ...report.byMethod.map((r) => [r.methodName, r.count, money(r.totalMinor, ctx)]),
      ['Total', report.count, money(report.totalMinor, ctx)]
    ],
    [
      ['Not counted', 'Expenses', 'Amount'],
      ['Voided', report.voidedCount, money(report.voidedMinor, ctx)]
    ]
  )
}
