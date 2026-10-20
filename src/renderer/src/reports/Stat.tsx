import { Card, Money } from '../components/ui'

/** A headline figure with a one-line definition under it, so nobody has to guess what it counts. */
export function Stat({
  label,
  minor,
  value,
  definition,
  tone
}: {
  label: string
  minor?: number
  value?: string | number
  definition: string
  tone?: 'default' | 'danger'
}): React.JSX.Element {
  return (
    <Card>
      <p className="text-sm font-medium text-fg-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>
        {minor === undefined ? value : <Money minor={minor} />}
      </p>
      <p className="mt-2 text-sm text-fg-subtle">{definition}</p>
    </Card>
  )
}
