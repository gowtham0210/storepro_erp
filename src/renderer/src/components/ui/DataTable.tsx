import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface Column<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** Numbers and money are right-aligned so digits line up. */
  align?: 'left' | 'right' | 'center'
  width?: string
  sortable?: boolean
}

export interface SortState {
  columnId: string
  direction: 'ascending' | 'descending'
}

interface DataTableProps<T> {
  /** Describes the table for screen readers (visually hidden). */
  caption: string
  columns: readonly Column<T>[]
  rows: readonly T[]
  getRowId: (row: T) => string | number
  /** Pressing Enter/Space on a row, or clicking it. Makes rows keyboard-navigable. */
  onRowActivate?: (row: T) => void
  sort?: SortState | null
  onSortChange?: (sort: SortState) => void
  loading?: boolean
  /** Rows of placeholder shown while loading, so the layout does not jump. */
  skeletonRows?: number
  empty?: ReactNode
  density?: 'compact' | 'comfortable'
  className?: string
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' }

/**
 * A real <table> (so screen readers can move by row and column) with a sticky
 * header, tabular numerals, sortable headers that announce their state, and
 * arrow-key row navigation when rows are actionable.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  onRowActivate,
  sort,
  onSortChange,
  loading = false,
  skeletonRows = 5,
  empty,
  density = 'comfortable',
  className
}: DataTableProps<T>): React.JSX.Element {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const cellPadding = density === 'compact' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5'

  const focusRow = (index: number): void => {
    const target = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]')[index]
    if (!target) return
    setFocusedIndex(index)
    target.focus()
  }

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number, row: T): void => {
    // Keys pressed on a button or field inside the row belong to that control.
    if (event.target !== event.currentTarget) return
    const last = rows.length - 1
    const moves: Record<string, number> = {
      ArrowDown: Math.min(index + 1, last),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: last,
      PageDown: Math.min(index + 10, last),
      PageUp: Math.max(index - 10, 0)
    }
    const next = moves[event.key]
    if (next !== undefined) {
      event.preventDefault()
      focusRow(next)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onRowActivate?.(row)
    }
  }

  return (
    <div className={cx('overflow-auto rounded-lg border border-divider bg-surface', className)}>
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface-muted">
          <tr>
            {columns.map((column) => {
              const sorted = sort?.columnId === column.id ? sort.direction : undefined
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={column.sortable ? (sorted ?? 'none') : undefined}
                  style={column.width ? { width: column.width } : undefined}
                  className={cx(
                    'border-b border-divider text-sm font-semibold text-fg-muted',
                    cellPadding,
                    ALIGN[column.align ?? 'left']
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSortChange({
                          columnId: column.id,
                          direction: sorted === 'ascending' ? 'descending' : 'ascending'
                        })
                      }
                      className={cx(
                        'inline-flex items-center gap-1 rounded hover:text-fg',
                        column.align === 'right' && 'flex-row-reverse'
                      )}
                    >
                      {column.header}
                      {sorted === 'ascending' ? (
                        <ArrowUp aria-hidden className="size-4" />
                      ) : sorted === 'descending' ? (
                        <ArrowDown aria-hidden className="size-4" />
                      ) : (
                        <ArrowUpDown aria-hidden className="size-4 opacity-50" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody ref={bodyRef} aria-busy={loading || undefined}>
          {loading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`skeleton-${i}`} aria-hidden>
                  {columns.map((column) => (
                    <td key={column.id} className={cx('border-b border-divider', cellPadding)}>
                      <span className="block h-4 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => (
                <tr
                  key={getRowId(row)}
                  data-row
                  tabIndex={
                    onRowActivate
                      ? index === Math.min(focusedIndex, rows.length - 1)
                        ? 0
                        : -1
                      : undefined
                  }
                  onClick={onRowActivate ? () => onRowActivate(row) : undefined}
                  onKeyDown={onRowActivate ? (event) => onRowKeyDown(event, index, row) : undefined}
                  onFocus={() => setFocusedIndex(index)}
                  className={cx(
                    'border-b border-divider last:border-b-0',
                    onRowActivate && 'cursor-pointer hover:bg-canvas focus-visible:bg-accent-soft'
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cx(
                        cellPadding,
                        ALIGN[column.align ?? 'left'],
                        column.align === 'right' && 'tabular'
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {loading && (
        <span className="sr-only" role="status">
          Loading
        </span>
      )}
      {!loading &&
        rows.length === 0 &&
        (empty ?? <p className="px-4 py-8 text-center text-fg-muted">Nothing to show.</p>)}
    </div>
  )
}
