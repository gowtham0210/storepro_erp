import { useQuery } from '@tanstack/react-query'
import { REPORT_METRICS } from '@shared/reports'
import type { PaymentTotal } from '@shared/ipc/contract'
import { Alert, Card, DataTable, EmptyState, Money, Spinner, type Column } from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { Stat } from './Stat'
import type { ReportRangeState } from './useReportRange'

const PAYMENT_COLUMNS: Column<PaymentTotal>[] = [
  { id: 'method', header: 'Payment method', cell: (p) => p.methodName },
  {
    id: 'collected',
    header: REPORT_METRICS.collections.label,
    align: 'right',
    cell: (p) => <Money minor={p.collectedMinor} />
  },
  {
    id: 'paid-back',
    header: REPORT_METRICS.refundPayouts.label,
    align: 'right',
    cell: (p) =>
      p.refundedMinor > 0 ? (
        <Money minor={p.refundedMinor} />
      ) : (
        <span className="text-fg-muted">–</span>
      )
  },
  {
    id: 'net',
    header: REPORT_METRICS.netCollections.label,
    align: 'right',
    cell: (p) => <Money minor={p.netMinor} className="font-medium" />
  }
]

/** M19-03: the dashboard. Defaults to today at the store; any period can be chosen above. */
export function OverviewTab({ range }: { range: ReportRangeState }): React.JSX.Element {
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
  const s = sales.data?.summary
  if (!s) return <Spinner label="Loading the figures" />

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={REPORT_METRICS.netSales.label}
          minor={s.netSalesMinor}
          definition={REPORT_METRICS.netSales.definition}
        />
        <Stat
          label={REPORT_METRICS.bills.label}
          value={s.billCount}
          definition={REPORT_METRICS.bills.definition}
        />
        <Stat
          label={REPORT_METRICS.averageBill.label}
          minor={s.averageBillMinor}
          definition={REPORT_METRICS.averageBill.definition}
        />
        <Stat
          label={REPORT_METRICS.refunds.label}
          minor={s.refundsMinor}
          definition={`${s.refundCount} ${s.refundCount === 1 ? 'return' : 'returns'}. ${REPORT_METRICS.refunds.definition}`}
        />
      </div>

      <Card title="How the figures are made up">
        <dl className="max-w-2xl divide-y divide-border-subtle">
          {(
            [
              ['grossSales', s.grossMinor],
              ['discounts', s.discountMinor],
              ['tax', s.taxMinor],
              ['roundOff', s.roundOffMinor],
              ['billed', s.billedMinor],
              ['refunds', s.refundsMinor],
              ['refundedTax', s.refundedTaxMinor],
              ['netSales', s.netSalesMinor]
            ] as const
          ).map(([key, minor]) => (
            <div key={key} className="grid grid-cols-[1fr_auto] gap-x-4 py-2">
              <dt className={key === 'billed' || key === 'netSales' ? 'font-semibold' : ''}>
                {REPORT_METRICS[key].label}
              </dt>
              <dd className={key === 'billed' || key === 'netSales' ? 'font-semibold' : ''}>
                <Money minor={minor} />
              </dd>
              <dd className="col-span-2 text-sm text-fg-subtle">
                {REPORT_METRICS[key].definition}
              </dd>
            </div>
          ))}
        </dl>
        {s.voidedCount > 0 && (
          <p className="mt-3 text-sm text-fg-muted">
            {s.voidedCount} voided {s.voidedCount === 1 ? 'bill' : 'bills'} (
            <Money minor={s.voidedMinor} />) {s.voidedCount === 1 ? 'is' : 'are'} left out of these
            figures.
          </p>
        )}
      </Card>

      <Card title="Money by payment method" flush>
        <DataTable
          caption="Money by payment method"
          columns={PAYMENT_COLUMNS}
          rows={s.payments}
          getRowId={(p) => p.paymentMethodId}
          empty={<EmptyState title="No payments in this period" />}
        />
      </Card>
    </div>
  )
}
