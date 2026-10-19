import { useInfiniteQuery } from '@tanstack/react-query'
import { History, X } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { AuditLogEntry, AuditLogFilter } from '@shared/ipc/contract'
import { AUDIT_CATEGORIES, auditActionLabel, isAuditAction } from '@shared/audit'
import { describeAuditEntry } from '../audit/describeAuditEntry'
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Select,
  TextInput,
  type Column,
  type SelectOption
} from '../components/ui'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'

const PAGE_SIZE = 50
const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })

/** A yyyy-mm-dd date input value as local midnight, or undefined if it isn't a real date. */
function localMidnight(value: string | null, addDays = 0): number | undefined {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!match) return undefined
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  // Date rolls 2026-13-45 over into 2027; refuse it instead.
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return undefined
  }
  return new Date(year, month, day + addDays).getTime()
}

/**
 * The filters live in the address (?person=3&action=user.updated&from=…&to=…),
 * so Back works, and other screens can link to a filtered view, such as one
 * user's history.
 */
function filterFrom(params: URLSearchParams): AuditLogFilter {
  const filter: AuditLogFilter = {}
  const person = params.get('person')
  if (person === 'system') filter.person = 'system'
  else if (person && /^\d+$/.test(person)) filter.person = Number(person)
  const action = params.get('action')
  if (action) filter.action = action
  const from = localMidnight(params.get('from'))
  if (from !== undefined) filter.from = from
  // The "to" date is inclusive: up to the start of the next day.
  const to = localMidnight(params.get('to'), 1)
  if (to !== undefined) filter.to = to
  const entity = /^([a-z_]+):(\d+)$/.exec(params.get('entity') ?? '')
  if (entity) filter.entity = { type: entity[1] ?? '', id: Number(entity[2]) }
  return filter
}

const columns: Column<AuditLogEntry>[] = [
  {
    id: 'when',
    header: 'When',
    width: '13rem',
    cell: (entry) => (
      <span className="tabular whitespace-nowrap">{when.format(entry.occurredAt)}</span>
    )
  },
  {
    id: 'who',
    header: 'Who',
    cell: (entry) => (
      <div>
        <span className="font-medium">{entry.actor?.displayName ?? 'StorePro'}</span>
        {entry.approvedBy && (
          <div className="text-sm text-fg-muted">Approved by {entry.approvedBy.displayName}</div>
        )}
      </div>
    )
  },
  { id: 'what', header: 'What', cell: (entry) => auditActionLabel(entry.action) },
  {
    id: 'details',
    header: 'Details',
    cell: (entry) => <span className="text-fg-muted">{describeAuditEntry(entry)}</span>
  }
]

/** M07-04: who did what, and when. Read-only: entries can never be changed or removed. */
export default function AuditLogPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const filter = useMemo(() => filterFrom(params), [params])
  const options = useIpcQuery('audit:filter-options')

  const log = useInfiniteQuery({
    queryKey: ['audit:list', filter],
    queryFn: ({ pageParam }) =>
      invoke('audit:list', {
        ...filter,
        limit: PAGE_SIZE,
        ...(pageParam === undefined ? {} : { before: pageParam })
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    // The log grows all the time: show the latest whenever the screen opens.
    staleTime: 0
  })
  const entries = log.data?.pages.flatMap((page) => page.entries) ?? []

  const setParam = (name: string, value: string): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(name, value)
        else next.delete(name)
        return next
      },
      { replace: true }
    )
  }

  const personOptions: SelectOption[] = [
    ...(options.data?.people ?? []).map((person) => ({
      value: String(person.userId),
      label: `${person.displayName} (${person.username})`
    })),
    { value: 'system', label: 'StorePro itself' }
  ]
  const present = new Set(options.data?.actions ?? [])
  const actionOptions: SelectOption[] = [
    ...AUDIT_CATEGORIES.flatMap((category) =>
      category.actions
        .filter((action) => present.has(action.code))
        .map((action) => ({ value: action.code, label: action.label, group: category.label }))
    ),
    // Recorded by a newer version of StorePro.
    ...[...present]
      .filter((code) => !isAuditAction(code))
      .map((code) => ({ value: code, label: code, group: 'Other' }))
  ]
  const filtered = ['person', 'action', 'from', 'to', 'entity'].some((name) => params.has(name))
  const subject = filter.entity ? entries.find((e) => e.entity)?.entity?.label : undefined

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Sign-ins, changes and approvals, newest first. Entries are permanent: nobody can edit or delete them."
      />
      <form
        role="search"
        aria-label="Filter the audit log"
        onSubmit={(event) => event.preventDefault()}
        className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]"
      >
        <Field label="Person">
          <Select
            value={params.get('person') ?? ''}
            onChange={(event) => setParam('person', event.target.value)}
            placeholder="Everyone"
            options={personOptions}
          />
        </Field>
        <Field label="Action">
          <Select
            value={params.get('action') ?? ''}
            onChange={(event) => setParam('action', event.target.value)}
            placeholder="All actions"
            options={actionOptions}
          />
        </Field>
        <Field label="From">
          <TextInput
            type="date"
            value={params.get('from') ?? ''}
            max={params.get('to') ?? undefined}
            onChange={(event) => setParam('from', event.target.value)}
          />
        </Field>
        <Field label="To">
          <TextInput
            type="date"
            value={params.get('to') ?? ''}
            min={params.get('from') ?? undefined}
            onChange={(event) => setParam('to', event.target.value)}
          />
        </Field>
        <Button icon={<X />} disabled={!filtered} onClick={() => setParams({}, { replace: true })}>
          Clear filters
        </Button>
      </form>
      {filter.entity && (
        <p className="mb-4 text-fg-muted">Showing the history of {subject ?? 'one record'} only.</p>
      )}
      {log.error ? (
        <Alert tone="danger" title={describeError(log.error).title}>
          {describeError(log.error).message}
        </Alert>
      ) : (
        <>
          <DataTable
            caption="Audit log entries, newest first"
            columns={columns}
            rows={entries}
            getRowId={(entry) => entry.id}
            loading={log.isPending}
            empty={
              <EmptyState
                icon={<History />}
                title={filtered ? 'No entries match these filters' : 'Nothing recorded yet'}
                description={filtered ? 'Try a wider date range, or clear the filters.' : undefined}
              />
            }
          />
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted" role="status">
              {log.isPending
                ? ''
                : `Showing ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${log.hasNextPage ? '; older entries are available' : ''}.`}
            </p>
            {log.hasNextPage && (
              <Button loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                Show older entries
              </Button>
            )}
          </div>
        </>
      )}
    </>
  )
}
