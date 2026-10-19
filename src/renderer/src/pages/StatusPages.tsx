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

/** For a role that can open no screen at all: nothing is broken, they just need access. */
export function NoScreensPage(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Welcome" />
      <Card>
        <EmptyState
          icon={<Lock />}
          title="Your role doesn't include any screens yet"
          description="Ask a manager or administrator to give you the access you need."
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
