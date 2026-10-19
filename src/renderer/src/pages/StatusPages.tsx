import { Compass, Lock } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'

export function NotFoundPage(): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState
          icon={<Compass />}
          title="There's nothing at this address"
          description="Use the menu on the left, or go back to billing."
          action={
            <Button variant="primary" onClick={() => navigate('/billing')}>
              Go to Billing
            </Button>
          }
        />
      </Card>
    </>
  )
}

export function AccessDeniedPage({ screen }: { screen: string }): React.JSX.Element {
  return (
    <>
      <PageHeader title={screen} />
      <Card>
        <EmptyState
          icon={<Lock />}
          title={`You don't have access to ${screen}`}
          description="Ask a manager or administrator if you need it."
        />
      </Card>
    </>
  )
}
