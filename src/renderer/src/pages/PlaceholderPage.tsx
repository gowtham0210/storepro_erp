import { Construction } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import type { NavItem } from '../navigation/navigation'

/** Stands in for screens that later modules build. */
export function PlaceholderPage({ item }: { item: NavItem }): React.JSX.Element {
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <Card>
        <EmptyState
          icon={<Construction />}
          title="This screen isn't built yet"
          description={`It is planned in ${item.plannedIn}.`}
        />
      </Card>
    </>
  )
}
