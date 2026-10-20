import { Button, Field, TextInput } from '../components/ui'
import { presets, type ReportRangeState } from './useReportRange'

/** From and To dates with quick periods. Both ends are included, in the store's time zone. */
export function ReportRange({ range }: { range: ReportRangeState }): React.JSX.Element {
  return (
    <section
      aria-label="Report period"
      className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-divider bg-surface p-4"
    >
      <Field label="From">
        <TextInput
          type="date"
          value={range.from}
          onChange={(event) => range.setRange(event.target.value, range.to)}
        />
      </Field>
      <Field label="To" error={range.error}>
        <TextInput
          type="date"
          value={range.to}
          onChange={(event) => range.setRange(range.from, event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2 pb-0.5" role="group" aria-label="Quick periods">
        {presets(range.today).map((preset) => (
          <Button
            key={preset.id}
            size="sm"
            variant={range.from === preset.from && range.to === preset.to ? 'primary' : 'secondary'}
            onClick={() => range.setRange(preset.from, preset.to)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </section>
  )
}
