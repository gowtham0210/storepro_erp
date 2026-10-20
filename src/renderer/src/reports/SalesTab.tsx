import { useQuery } from '@tanstack/react-query'
import { REPORT_METRICS } from '@shared/reports'
import type { DailySalesRow } from '@shared/ipc/contract'
import { Alert, Card, DataTable, Money, Spinner, type Column } from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { ExportButton } from './ExportButton'
import type { ReportRangeState } from './useReportRange'

type Row = DailySalesRow & { isTotal?: boolean }

/** M19-04: sales for each day in the period, with the period's total. */
export function SalesTab({ range }: { range: ReportRangeState }): React.JSX.Element {
  const { from, to } = range
  const sales = useQuery({
    queryKey: ['reports:sales', { from, to }],
    queryFn: () => invoke('reports:sales', { from, to }),
    enabled: range.error === null
  })
  if (range.error) return <></>
  if (sales.error) {
    return (
      <Alert tone="danger" title={describeError(sales.error).title}>
        {describeError(sales.error).message}
      </Alert>
    )
  }
  if (!sales.data) return <Spinner label="Loading the figures" />
  const { summary, days } = sales.data
  const total: Row = {
    date: 'Total',
    isTotal: true,
    billCount: summary.billCount,
    grossMinor: summary.grossMinor,
    discountMinor: summary.discountMinor,
    taxMinor: summary.taxMinor,
    billedMinor: summary.billedMinor,
    refundsMinor: summary.refundsMinor,
    netSalesMinor: summary.netSalesMinor
  }
  const money =
    (pick: (r: Row) => number): ((r: Row) => React.ReactNode) =>
    (r) => (
      <span className={r.isTotal ? 'font-semibold' : undefined}>
        <Money minor={pick(r)} />
      </span>
    )
  const columns: Column<Row>[] = [
    {
      id: 'date',
      header: 'Date',
      cell: (r) => <span className={r.isTotal ? 'font-semibold' : 'tabular'}>{r.date}</span>
    },
    { id: 'bills', header: REPORT_METRICS.bills.label, align: 'right', cell: (r) => r.billCount },
    {
      id: 'gross',
      header: REPORT_METRICS.grossSales.label,
      align: 'right',
      cell: money((r) => r.grossMinor)
    },
    {
      id: 'discounts',
      header: REPORT_METRICS.discounts.label,
      align: 'right',
      cell: money((r) => r.discountMinor)
    },
    { id: 'tax', header: REPORT_METRICS.tax.label, align: 'right', cell: money((r) => r.taxMinor) },
    {
      id: 'billed',
      header: REPORT_METRICS.billed.label,
      align: 'right',
      cell: money((r) => r.billedMinor)
    },
    {
      id: 'refunds',
      header: REPORT_METRICS.refunds.label,
      align: 'right',
      cell: money((r) => r.refundsMinor)
    },
    {
      id: 'net',
      header: REPORT_METRICS.netSales.label,
      align: 'right',
      cell: money((r) => r.netSalesMinor)
    }
  ]
  return (
    <Card
      title="Sales by day"
      flush
      actions={<ExportButton request={{ report: 'sales', from, to }} />}
    >
      <DataTable
        caption="Sales by day"
        columns={columns}
        rows={[...days, total]}
        getRowId={(r) => r.date}
        density="compact"
      />
      <p className="border-t border-divider px-5 py-3 text-sm text-fg-subtle">
        {REPORT_METRICS.netSales.definition} {REPORT_METRICS.refunds.definition}
      </p>
    </Card>
  )
}
