import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../components/ui'

/** Previous and Next under a long table, with where you are in it. */
export function Pager({
  page,
  pageSize,
  total,
  onPage
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}): React.JSX.Element | null {
  if (total <= pageSize) return null
  const first = page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <p className="text-sm text-fg-muted" role="status">
        Showing {first}–{last} of {total}
      </p>
      <span className="flex gap-2">
        <Button icon={<ChevronLeft />} disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button icon={<ChevronRight />} disabled={last >= total} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </span>
    </div>
  )
}
