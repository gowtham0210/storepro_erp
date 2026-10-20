import {
  purchasesReportSchema,
  reportExportSchema,
  reportRangeSchema,
  stockMovementsReportSchema,
  stockReportSchema,
  topProductsSchema
} from '@shared/schemas/reports'
import type { ReportService } from '../../reports/reportService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'reports:sales'
  | 'reports:top-products'
  | 'reports:stock'
  | 'reports:stock-movements'
  | 'reports:purchases'
  | 'reports:expenses'
  | 'reports:export'

export function createReportHandlers(reports: ReportService): {
  [C in Channel]: HandlerDefinition<C>
} {
  return {
    'reports:sales': {
      access: 'report.view',
      input: reportRangeSchema,
      handle: (input, { actor }) => reports.sales(actor, input)
    },
    'reports:top-products': {
      access: 'report.view',
      input: topProductsSchema,
      handle: (input, { actor }) => reports.topProducts(actor, input)
    },
    'reports:stock': {
      access: 'report.view',
      input: stockReportSchema,
      handle: (input, { actor }) => reports.stock(actor, input)
    },
    'reports:stock-movements': {
      access: 'report.view',
      input: stockMovementsReportSchema,
      handle: (input, { actor }) => reports.stockMovements(actor, input)
    },
    'reports:purchases': {
      access: 'report.view',
      input: purchasesReportSchema,
      handle: (input, { actor }) => reports.purchases(actor, input)
    },
    'reports:expenses': {
      access: 'report.view',
      input: reportRangeSchema,
      handle: (input, { actor }) => reports.expenses(actor, input)
    },
    'reports:export': {
      access: 'data.export',
      input: reportExportSchema,
      handle: (input, { actor }) => reports.exportReport(actor, input)
    }
  }
}
