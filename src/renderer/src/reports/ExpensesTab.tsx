import { useQuery } from '@tanstack/react-query'
import type { ExpenseCategoryTotal, ExpenseMethodTotal } from '@shared/ipc/contract'
import { Alert, Card, DataTable, EmptyState, Money, Spinner, type Column } from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { Stat } from './Stat'
import { ExportButton } from './ExportButton'
import type { ReportRangeState } from './useReportRange'

const CATEGORY_COLUMNS: Column<ExpenseCategoryTotal>[] = [
  { id: 'category', header: 'Category', cell: (r) => r.name },
  { id: 'count', header: 'Expenses', align: 'right', cell: (r) => r.count },
  {
    id: 'total',
    header: 'Total',
    align: 'right',
    cell: (r) => <Money minor={r.totalMinor} className="font-medium" />
  }
]

const METHOD_COLUMNS: Column<ExpenseMethodTotal>[] = [
  { id: 'method', header: 'Paid by', cell: (r) => r.methodName },
  { id: 'count', header: 'Expenses', align: 'right', cell: (r) => r.count },
  {
    id: 'total',
    header: 'Total',
    align: 'right',
    cell: (r) => <Money minor={r.totalMinor} className="font-medium" />
  }
]

/** M19-08: what was spent in the period, by category and by how it was paid. */
export function ExpensesTab({ range }: { range: ReportRangeState }): React.JSX.Element {
  const { from, to } = range
  const report = useQuery({
    queryKey: ['reports:expenses', { from, to }],
    queryFn: () => invoke('reports:expenses', { from, to }),
    enabled: range.error === null
  })
  if (range.error) return <></>
  if (report.error) {
    return (
      <Alert tone="danger" title={describeError(report.error).title}>
        {describeError(report.error).message}
      </Alert>
    )
  }
  const data = report.data
  if (!data) return <Spinner label="Loading the figures" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Stat
          label="Spent"
          minor={data.totalMinor}
          definition="Expenses dated in the period, by the date they were spent. Voided expenses are left out."
        />
        <Stat label="Expenses" value={data.count} definition="How many expenses that is." />
      </div>
      {data.voidedCount > 0 && (
        <p className="text-sm text-fg-muted">
          {data.voidedCount} voided {data.voidedCount === 1 ? 'expense' : 'expenses'} (
          <Money minor={data.voidedMinor} />) {data.voidedCount === 1 ? 'is' : 'are'} not counted.
        </p>
      )}
      <Card
        title="By category"
        flush
        actions={<ExportButton request={{ report: 'expenses', from, to }} />}
      >
        <DataTable
          caption="Expenses by category"
          columns={CATEGORY_COLUMNS}
          rows={data.byCategory}
          getRowId={(r) => r.expenseCategoryId}
          density="compact"
          empty={<EmptyState title="No expenses in this period" />}
        />
      </Card>
      <Card title="By how it was paid" flush>
        <DataTable
          caption="Expenses by payment method"
          columns={METHOD_COLUMNS}
          rows={data.byMethod}
          getRowId={(r) => r.paymentMethodId}
          density="compact"
          empty={<EmptyState title="No expenses in this period" />}
        />
      </Card>
    </div>
  )
}
