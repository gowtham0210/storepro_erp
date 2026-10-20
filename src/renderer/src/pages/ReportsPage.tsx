import { useSearchParams } from 'react-router'
import { Button, PageHeader } from '../components/ui'
import { ExpensesTab } from '../reports/ExpensesTab'
import { MovementsTab } from '../reports/MovementsTab'
import { OverviewTab } from '../reports/OverviewTab'
import { ProductsTab } from '../reports/ProductsTab'
import { PurchasesTab } from '../reports/PurchasesTab'
import { ReportRange } from '../reports/ReportRange'
import { SalesTab } from '../reports/SalesTab'
import { StockTab } from '../reports/StockTab'
import { useReportRange } from '../reports/useReportRange'

const TABS = [
  ['overview', 'Overview'],
  ['sales', 'Sales'],
  ['products', 'Top items'],
  ['stock', 'Stock'],
  ['movements', 'Stock movements'],
  ['purchases', 'Purchases'],
  ['expenses', 'Expenses']
] as const

type TabId = (typeof TABS)[number][0]

/** M19: the dashboard and reports. Each figure's meaning is defined in `src/shared/reports.ts`. */
export default function ReportsPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const range = useReportRange()
  const requested = params.get('tab')
  const tab: TabId = TABS.some(([id]) => id === requested) ? (requested as TabId) : 'overview'
  // Stock is as of now, so it has no period.
  const usesPeriod = tab !== 'stock'

  const choose = (id: TabId): void =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (id === 'overview') next.delete('tab')
        else next.set('tab', id)
        next.delete('page')
        return next
      },
      { replace: true }
    )

  return (
    <>
      <PageHeader
        title="Reports"
        description="Sales, stock, purchases and expenses, by the store's own days. Gross sales, discounts, tax, refunds and collections are kept apart."
      />
      <div role="tablist" aria-label="Reports" className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => choose(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {usesPeriod && <ReportRange range={range} />}
      {tab === 'overview' && <OverviewTab range={range} />}
      {tab === 'sales' && <SalesTab range={range} />}
      {tab === 'products' && <ProductsTab range={range} />}
      {tab === 'stock' && <StockTab />}
      {tab === 'movements' && <MovementsTab range={range} />}
      {tab === 'purchases' && <PurchasesTab range={range} />}
      {tab === 'expenses' && <ExpensesTab range={range} />}
    </>
  )
}
